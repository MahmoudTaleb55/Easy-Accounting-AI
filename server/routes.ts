import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage, isAuditEntityType, assertAllOwnedByCompany, JournalEntryReferenceConflictError, LegacyAssetEventBalanceMissingError, AssetEventLaterDependencyError, type AuditContext } from "./storage";
import { accounts as accountsTable, employees as employeesTable } from "@shared/schema";

// Build an AuditContext for user-initiated mutations. The `actor` is derived
// only from the verified session principal (passport `req.user.claims`, set by
// either OIDC or local-auth login) — never from client-controlled headers or
// body, which could be spoofed. We prefer "First Last", then email, then sub.
// If none are available (e.g. unauthenticated edge case), we leave actor null
// so the History drawer falls back to "Actor unavailable".
interface SessionClaims {
  sub?: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface SessionPrincipal {
  claims?: SessionClaims;
}

function getSessionClaims(req: Request): SessionClaims | undefined {
  const principal = req.user as SessionPrincipal | undefined;
  return principal?.claims;
}

function actorName(req: Request): string | null {
  const claims = getSessionClaims(req);
  if (!claims) return null;
  const name = [claims.first_name, claims.last_name]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .join(" ")
    .trim();
  return name || claims.email || claims.sub || null;
}

function userCtx(req: Request): AuditContext {
  return { source: "user", actor: actorName(req) };
}

// Audit context for mutations the AI assistant runs on behalf of a signed-in
// user (chat tool calls, document-extraction posting). We keep `source: "ai"`
// so the History drawer can still flag the AI as the channel, but record the
// human's name so teammates can see who authorised the action. When no human
// is known (e.g. unauth edge), fall back to "AI assistant" to preserve the
// existing visual cue.
function aiCtx(req: Request): AuditContext {
  return { source: "ai", actor: actorName(req) ?? "AI assistant" };
}
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import multer from "multer";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  ObjectPermission,
  canAccessObject,
} from "./replit_integrations/object_storage";
import { ASSISTANT_TOOLS, executeTool, type ToolArtifact } from "./services/assistant-tools";
import { readFile as readGeneratedFile } from "./services/assistant-files";
import { extractDocument, suggestJournalForDocument } from "./services/document-extraction";
import {
  saveDocumentFile,
  readDocumentFile,
  deleteDocumentFileIfOrphaned,
} from "./services/document-storage";
import {
  detectDocumentMimeFromBuffer,
  detectImageMimeFromBuffer,
  InvalidDocumentError,
  InvalidImageError,
} from "./services/image-mime";
import { postDocumentSchema } from "@shared/schema";
import { db, withCompanyScope } from "./db";
import { assetComponents, type AssetComponent } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { PeriodKey } from "./fixed-assets";
import {
  requireAuth,
  attachMembership,
  requireRole,
  requireWriteRoleForMutations,
  type MembershipContext,
} from "./auth/middleware";

/** Pull the active workspace id from the request after `attachMembership`.
 *  Sends 403 if no membership context (e.g. signed-in user with no workspace). */
function cid(req: Request): number {
  const ctx = (req as any).membership as MembershipContext | undefined;
  if (!ctx) throw Object.assign(new Error("No active workspace"), { status: 403 });
  return ctx.companyId;
}

// Routes under /api/* that must remain reachable without authentication
// (login/signup flows, OIDC callbacks, public marketing endpoints).
const PUBLIC_API_PREFIXES = [
  "/api/login",
  "/api/logout",
  "/api/callback",
  "/api/auth/signup",
  "/api/auth/signin",
  "/api/auth/signout",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/invitations/by-token",
  "/api/auth/user", // returns 401 itself when missing — keeps /useAuth polling cheap
];

function isPublic(path: string): boolean {
  return PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p + "/") || path === p);
}

// Auth self-service mutations — any authenticated user can perform these,
// regardless of workspace role (or even before they have any membership).
// They are still behind requireAuth (per-route) and the global requireAuth gate.
const SELF_SERVICE_PREFIXES = [
  "/api/auth/profile",
  "/api/auth/change-password",
  "/api/auth/sessions",
  "/api/auth/invitations/accept",
  "/api/companies", // listing user's workspaces + creating a brand-new workspace
];

function isSelfServiceWrite(path: string): boolean {
  return SELF_SERVICE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

// Using the OpenAI integration blueprint
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---------------------------------------------------------------
  // Public avatar proxy (object storage)
  //
  // Avatars uploaded via POST /api/auth/profile/avatar are stored in
  // the bucket under `avatars/<userId>/<sha>.<ext>` with a public ACL,
  // so an <img src="/objects/avatars/…"/> in the topbar can render
  // without a session cookie.
  //
  // Defence in depth: the route is scoped to the `avatars/` prefix
  // (no other object class can be served through it) AND we still
  // consult the object's ACL via `canAccessObject` before streaming
  // the bytes. An anonymous request (`userId = undefined`) only
  // succeeds when the policy has `visibility: "public"`, so a private
  // object that was somehow saved under this prefix would still be
  // refused.
  // ---------------------------------------------------------------
  {
    const objectStorageService = new ObjectStorageService();
    app.get(/^\/objects\/avatars\/.+$/, async (req, res) => {
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(req.path);
        const allowed = await canAccessObject({
          objectFile,
          requestedPermission: ObjectPermission.READ,
        });
        if (!allowed) {
          return res.status(404).json({ message: "Object not found" });
        }
        await objectStorageService.downloadObject(objectFile, res);
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          return res.status(404).json({ message: "Object not found" });
        }
        console.error("Error serving object:", error);
        return res.status(500).json({ message: "Failed to serve object" });
      }
    });
    // Anything else under /objects/ has no public surface — short-circuit
    // with a 404 so the SPA fallback doesn't return index.html and mask a
    // misrouted request.
    app.all(/^\/objects(\/.*)?$/, (_req, res) => {
      return res.status(404).json({ message: "Object not found" });
    });
  }

  // Global API gate: every /api/* request that is NOT in the public allowlist
  // must be authenticated. Mutations additionally require a workspace role of
  // owner or accountant (viewers are blocked from writes).
  //
  // Once the membership has been attached, the rest of the request runs
  // inside `withCompanyScope(companyId, …)` so the underlying `pg.Client`
  // has `app.current_company_id` set. The row-level-security policies on
  // every workspace-scoped table consult that GUC, which means a query
  // that "forgets" `WHERE company_id = …` returns / touches zero rows
  // for the wrong tenant instead of leaking data. (Task #93 — see
  // docs/design/workspace-isolation-defense-in-depth.md.)
  app.use("/api", (req, res, next) => {
    if (isPublic(req.path)) return next();
    return requireAuth(req, res, (err?: any) => {
      if (err) return next(err);
      attachMembership(req, res, (err2?: any) => {
        if (err2) return next(err2);
        const proceed = (err3?: any) => {
          if (err3) return next(err3);
          const ctx = (req as any).membership as
            | { companyId: number }
            | undefined;
          if (!ctx) return next(); // self-service / pre-membership paths
          return withCompanyScope(ctx.companyId, () =>
            // Register listeners *before* invoking next() so a
            // synchronous res.end() inside the handler can't beat us.
            // Both events are wired so an aborted request still releases
            // the pinned client.
            new Promise<void>((resolve) => {
              const finish = () => resolve();
              res.once("finish", finish);
              res.once("close", finish);
              next();
            }),
          ).catch(next);
        };
        // Reads: any authenticated user with attached membership.
        // Self-service writes (profile, password, sessions, accept invite,
        // create/list workspaces): any authenticated user, no role gate.
        // Everything else: requires admin/accountant role for the active workspace.
        if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return proceed();
        if (isSelfServiceWrite(req.path)) return proceed();
        return requireWriteRoleForMutations(req, res, proceed);
      });
    });
  });

  // Transactions
  app.get(api.transactions.list.path, async (req, res) => {
    const allTransactions = await storage.getTransactions(cid(req));
    res.json(allTransactions);
  });

  app.post(api.transactions.create.path, async (req, res) => {
    try {
      // `insertTransactionSchema` carries no foreign-key id fields (it omits
      // companyId and date) — the only inputs are type/amount/description/
      // category, so there is nothing to cross-tenant validate here.
      const input = api.transactions.create.input.parse(req.body);
      const transaction = await storage.createTransaction(cid(req), input, userCtx(req));
      res.status(201).json(transaction);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.delete(api.transactions.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    await storage.deleteTransaction(cid(req), id, userCtx(req));
    res.status(204).send();
  });

  app.get(api.transactions.summary.path, async (req, res) => {
    const allTransactions = await storage.getTransactions(cid(req));
    let totalIncome = 0;
    let totalExpense = 0;
    
    allTransactions.forEach(tx => {
      const amount = parseFloat(tx.amount.toString());
      if (tx.type === "income") {
        totalIncome += amount;
      } else if (tx.type === "expense") {
        totalExpense += amount;
      }
    });

    res.json({
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense
    });
  });

  // Financial analysis (AI-powered recommendations)
  app.post(api.analysis.generate.path, async (req, res) => {
    try {
      const input = api.analysis.generate.input.parse(req.body);

      const systemPrompt = `أنت مستشار مالي خبير ومدرّب على المعايير الدولية لإعداد التقارير المالية (IFRS) وتحليل أداء المنشآت الصغيرة والمتوسطة. تتحدث العربية الفصحى البسيطة الواضحة. هدفك تقديم تحليل عملي قابل للتنفيذ يساعد صاحب العمل على اتخاذ قرارات أفضل.

ستصلك بيانات مالية موجزة بصيغة JSON. حلّلها وأعد ردّك **فقط** بصيغة JSON صالحة (بدون أي نص قبله أو بعده) بالشكل التالي تماماً:

{
  "healthScore": <عدد صحيح من 0 إلى 100 يعكس صحة الوضع المالي>,
  "summary": "<جملتان أو ثلاث تلخص الوضع العام بصراحة ومهنية>",
  "strengths": ["<نقطة قوة محددة مرتبطة بالأرقام>", ...],
  "weaknesses": ["<نقطة ضعف محددة مرتبطة بالأرقام>", ...],
  "recommendations": [
    { "title": "<عنوان قصير للتوصية>", "detail": "<شرح التوصية وكيفية تنفيذها>", "priority": "high" | "medium" | "low" },
    ...
  ],
  "topAction": "<أهم خطوة واحدة يجب اتخاذها فوراً، جملة واحدة محفّزة وعملية>"
}

قواعد:
- استخدم النسب المئوية والأرقام الفعلية في تحليلك (مثال: "هامش الربح الإجمالي 23% أقل من المعدل الصحي 30%").
- 3 إلى 5 توصيات كحد أقصى، مرتبة حسب الأولوية.
- لا تستخدم لغة جامدة ولا مصطلحات مبهمة، اشرح كأنك تتحدث لصاحب محل صغير.
- إذا كانت الأرقام إيجابية جداً، احتفل بذلك ولكن قدّم اقتراحات للنمو.
- إذا كانت الأرقام سلبية، كن صريحاً ولكن داعماً واقترح خطوات إنقاذ ملموسة.`;

      const userPayload = JSON.stringify(input, null, 2);

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `حلّل البيانات التالية وأعد ردّك بصيغة JSON فقط:\n${userPayload}` },
        ],
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content || "{}";
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(200).json({
          healthScore: 50,
          summary: "تعذر توليد تحليل مفصل، حاول مرة أخرى.",
          strengths: [],
          weaknesses: [],
          recommendations: [],
          topAction: "أعد المحاولة بعد قليل.",
        });
      }

      // Validate & clamp the AI output
      const result = {
        healthScore: Math.max(0, Math.min(100, Number(parsed.healthScore) || 50)),
        summary: String(parsed.summary || "").slice(0, 800),
        strengths: Array.isArray(parsed.strengths)
          ? parsed.strengths.slice(0, 8).map((s: any) => String(s).slice(0, 300))
          : [],
        weaknesses: Array.isArray(parsed.weaknesses)
          ? parsed.weaknesses.slice(0, 8).map((s: any) => String(s).slice(0, 300))
          : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations.slice(0, 6).map((r: any) => ({
              title: String(r?.title || "توصية").slice(0, 120),
              detail: String(r?.detail || "").slice(0, 600),
              priority: ["high", "medium", "low"].includes(r?.priority) ? r.priority : "medium",
            }))
          : [],
        topAction: String(parsed.topAction || "راجع نتائجك المالية بشكل دوري.").slice(0, 300),
      };

      res.json(result);
    } catch (err) {
      console.error("Analysis error", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      res.status(500).json({ message: "حدث خطأ في توليد التحليل" });
    }
  });

  // ----- Chart of Accounts -----
  app.get(api.accounts.list.path, async (req, res) => {
    const list = await storage.getAccounts(cid(req));
    res.json(list);
  });

  app.post(api.accounts.create.path, async (req, res) => {
    try {
      const input = api.accounts.create.input.parse(req.body);
      // `parentId` is the only foreign-key id the client can supply. Verify it
      // points at an account in THIS workspace so the books can't be re-parented
      // under a header from a sibling tenant.
      if (input.parentId != null) {
        if (!(await assertAllOwnedByCompany(accountsTable, cid(req), [input.parentId]))) {
          return res.status(400).json({ message: "حساب أب غير صالح", field: "parentId" });
        }
      }
      const created = await storage.createAccount(cid(req), input, userCtx(req));
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      res.status(500).json({ message: "تعذّر إنشاء الحساب" });
    }
  });

  // Restore the default IFRS chart of accounts for a workspace whose chart
  // is completely empty. Refuses with 409 the moment any account already
  // exists in the workspace, so this can never silently merge into / muddle
  // a real chart of accounts. Auto-seeding at signup also calls
  // `seedDefaultCoaForCompany`; this endpoint is the recovery path for an
  // older workspace that pre-dates auto-seeding.
  app.post(api.accounts.restoreDefaults.path, async (req, res) => {
    const cId = cid(req);
    // Sentinel thrown to abort the transaction with a typed reason so the
    // catch below can distinguish "workspace already had accounts" (409)
    // from a genuine seed failure (500).
    const ALREADY_POPULATED = Symbol("CoA already populated");
    try {
      await db.transaction(async (tx) => {
        // Per-workspace advisory lock so two concurrent restore-defaults
        // (or a restore-defaults racing with the first user-initiated
        // account write) serialize on this id. Released automatically on
        // COMMIT/ROLLBACK.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${cId})`);
        const [{ c }] = await tx
          .select({ c: sql<number>`count(*)::int` })
          .from(accountsTable)
          .where(eq(accountsTable.companyId, cId));
        if (c > 0) {
          throw ALREADY_POPULATED;
        }
        const { seedDefaultCoaInTx } = await import("./init-coa");
        await seedDefaultCoaInTx(tx, cId);
      });
      const after = await storage.getAccounts(cId);
      res.json({ seeded: after.length });
    } catch (err) {
      if (err === ALREADY_POPULATED) {
        return res.status(409).json({
          message:
            "لا يمكن استعادة الدليل الافتراضي عندما توجد حسابات قائمة في هذه المساحة",
        });
      }
      console.error("CoA restore-defaults error", err);
      res.status(500).json({ message: "تعذّر استعادة الدليل الافتراضي" });
    }
  });

  // ----- Accounts: per-account balances -----
  //
  // Powers the trailing balance column on the chart-of-accounts tree. The
  // `period` query param scopes the aggregation:
  //   - `month`: current calendar month (server-local clock)
  //   - `year`:  current calendar year
  //   - `all` (default): no date filter
  //
  // Aggregation runs server-side (SUM/GROUP BY) and is workspace-scoped via
  // `cid(req)`, so cross-tenant leakage is impossible. Header rows are
  // rolled-up client-side from descendant leaves so the response stays a
  // flat list keyed by accountId.
  app.get(api.accounts.balances.path, async (req, res) => {
    const periodParam = String(req.query.period ?? "all").toLowerCase();
    const period: "month" | "year" | "all" =
      periodParam === "month" || periodParam === "year" ? periodParam : "all";

    let range: { from?: Date; to?: Date } | undefined;
    if (period !== "all") {
      const now = new Date();
      const from =
        period === "month"
          ? new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
          : new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const to =
        period === "month"
          ? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
          : new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      range = { from, to };
    }

    const [allAccounts, totals] = await Promise.all([
      storage.getAccounts(cid(req)),
      storage.getAccountBalances(cid(req), range),
    ]);
    const typeById = new Map(allAccounts.map((a) => [a.id, a.type]));

    const rows = Array.from(totals.entries()).map(([accountId, t]) => {
      const type = typeById.get(accountId);
      const isDebitNormal = type === "asset" || type === "expense";
      const balance = isDebitNormal ? t.debit - t.credit : t.credit - t.debit;
      return { accountId, debit: t.debit, credit: t.credit, balance };
    });

    res.json({ period, rows });
  });

  // ----- Journal Entries -----
  app.get(api.journal.list.path, async (req, res) => {
    const entries = await storage.getJournalEntries(cid(req));
    res.json(entries);
  });

  app.post(api.journal.create.path, async (req, res) => {
    try {
      const input = api.journal.create.input.parse(req.body);
      // Reject lines that reference an account from another workspace (cross-tenant write leak).
      const lineAccountIds = input.lines.map((l) => l.accountId);
      if (!(await assertAllOwnedByCompany(accountsTable, cid(req), lineAccountIds))) {
        return res.status(400).json({ message: "حساب غير صالح", field: "lines.accountId" });
      }
      const created = await storage.createJournalEntry(cid(req), input, userCtx(req));
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      console.error("Journal create error", err);
      res.status(500).json({ message: "تعذّر إنشاء القيد" });
    }
  });

  app.delete(api.journal.delete.path, async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    await storage.deleteJournalEntry(cid(req), id, userCtx(req));
    res.status(204).send();
  });

  // ----- Admin: backfill journal entries -----
  //
  // Owner-only recovery hatch for the original `ReferenceError: cash is not
  // defined` regression that left a window of `transactions` rows without
  // their auto-posted JE. Walks the active workspace's transactions, posts
  // a balanced double-entry JE for every row missing one, and reports how
  // many it created vs. skipped (skipped = workspace not yet seeded with a
  // chart of accounts, or the cash/fallback account is somehow missing).
  //
  // The bootstrap path runs the same helper across every workspace at boot
  // (see `server/index.ts → ensureIfrsBootstrap`), so the original backlog
  // is healed automatically on the next deploy. This route exists so an
  // owner can re-run it on demand if a future regression breaks
  // `autoPostFromTransaction` again — without needing a redeploy or a
  // shell on the server.
  //
  // Scope: per-workspace. The handler passes `cid(req)` to the helper, so
  // the owner of company A can never trigger writes against company B.
  app.post(
    api.admin.backfillJournalEntries.path,
    requireRole("owner"),
    async (req, res) => {
      try {
        const { backfillJournalForLegacyTransactions } = await import("./init-coa");
        // Task #236: forward the calling owner's `AuditContext` so every
        // audit row this invocation writes (per-JE + the per-workspace
        // `backfill` summary) carries their name. `triggeredVia:
        // 'admin-route'` distinguishes the row from the boot-time sweep
        // when two owners later argue about who re-paired the books.
        const result = await backfillJournalForLegacyTransactions(cid(req), {
          triggeredVia: "admin-route",
          ctx: userCtx(req),
        });
        res.json(result);
      } catch (err) {
        console.error("Admin backfill-journal-entries error", err);
        res.status(500).json({ message: "تعذّر استكمال قيود اليومية" });
      }
    },
  );

  // Companion read-only endpoint: returns the most recent backfill audit
  // row for the active workspace so /app/settings can render a "Last run
  // by <owner> on <date>" line under the Re-pair card. Owner-only because
  // the row carries an actor name; matching the requireRole("owner") gate
  // on the POST keeps the read/write halves consistent. Task #236.
  app.get(
    api.admin.backfillJournalEntriesLastRun.path,
    requireRole("owner"),
    async (req, res) => {
      try {
        const row = await storage.getLastBackfillRun(cid(req));
        if (!row) {
          return res.json({ lastRun: null });
        }
        // Translate the generic audit row into the focused payload the
        // settings card needs, hiding the `entityType` / `entityId`
        // bookkeeping. Defaults are defensive: an old row pre-dating
        // task #236 (none should exist, but we guard anyway) won't crash
        // the page if the `changes` JSON is empty.
        const changes = (row.changes ?? []) as Array<{
          field: string;
          to?: unknown;
        }>;
        const get = (field: string) => changes.find((c) => c.field === field)?.to;
        const created = Number(get("created"));
        const skipped = Number(get("skipped"));
        const triggeredViaRaw = String(get("triggered_via") ?? "");
        const triggeredVia: "admin-route" | "boot" =
          triggeredViaRaw === "admin-route" ? "admin-route" : "boot";
        res.json({
          lastRun: {
            actor: row.actor,
            source: row.source,
            occurredAt: row.occurredAt.toISOString(),
            created: Number.isFinite(created) ? created : 0,
            skipped: Number.isFinite(skipped) ? skipped : 0,
            triggeredVia,
          },
        });
      } catch (err) {
        console.error("Admin backfill-journal-entries last-run error", err);
        res.status(500).json({ message: "تعذّر جلب سجل آخر إصلاح" });
      }
    },
  );

  // Read-only count preview for the settings "Re-pair missing journal
  // entries" card. Same owner gate and same per-workspace scope as the
  // POST above, so the number an owner sees is computed against the exact
  // same rows the POST would act on. Surfacing it up front lets owners see
  // "fix 0" or "fix 4,000" before they confirm, instead of after.
  app.get(
    api.admin.backfillJournalEntriesPreview.path,
    requireRole("owner"),
    async (req, res) => {
      try {
        const { countTransactionsMissingJournalEntryForCompany } = await import("./init-coa");
        const count = await countTransactionsMissingJournalEntryForCompany(cid(req));
        res.json({ count });
      } catch (err) {
        console.error("Admin backfill-journal-entries preview error", err);
        res.status(500).json({ message: "تعذّر حساب القيود المفقودة" });
      }
    },
  );

  // ----- Audit log -----
  app.get(api.audit.list.path, async (req, res) => {
    const entityType = String(req.params.entityType || "");
    const id = Number(req.params.id);
    if (!isAuditEntityType(entityType)) {
      return res.status(400).json({ message: "Unsupported entity type" });
    }
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }
    // Optional `from` / `to` ISO timestamp params let the period dropdown
    // in `HistoryTimeline` push the window down to the database for very
    // large entity histories, instead of fetching everything and filtering
    // client-side. Bad input (non-ISO, NaN) is rejected with 400 rather
    // than silently ignored so the client can't accidentally over-fetch.
    const parseBound = (v: unknown): Date | "invalid" | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      if (typeof v !== "string") return "invalid";
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? "invalid" : d;
    };
    const from = parseBound(req.query.from);
    const to = parseBound(req.query.to);
    if (from === "invalid" || to === "invalid") {
      return res.status(400).json({ message: "Invalid date range" });
    }
    const owned = await storage.entityBelongsToCompany(entityType, id, cid(req));
    if (!owned) return res.status(404).json({ message: "Not found" });
    const bounds = from || to ? { from, to } : undefined;
    const events = await storage.getAuditLog(cid(req), entityType, id, bounds);
    res.json(events);
  });

  // Reversal-aware journal-entry audit lookup. Used by the JE History drawer
  // so auditors can trace why a JE disappeared from the GL — the JE may have
  // been cascade-deleted by a `reverseAutoPostedJournalEntry` call, in which
  // case the standard `entityBelongsToCompany` check returns false. The
  // workspace-scoped storage method falls back to the `companyId` stamp
  // recorded inside the reversal audit row to verify ownership.
  app.get(api.audit.journalEntryWithReversal.path, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const events = await storage.getJournalEntryAuditWithReversal(cid(req), id);
    if (events === null) return res.status(404).json({ message: "Not found" });
    res.json(events);
  });

  // ----- Reports: Trial Balance -----
  app.get(api.reports.trialBalance.path, async (req, res) => {
    const allAccounts = await storage.getAccounts(cid(req));
    const entries = await storage.getJournalEntries(cid(req));
    const debitMap = new Map<number, number>();
    const creditMap = new Map<number, number>();
    entries.forEach((je) =>
      je.lines.forEach((l) => {
        debitMap.set(l.accountId, (debitMap.get(l.accountId) || 0) + Number(l.debit || 0));
        creditMap.set(l.accountId, (creditMap.get(l.accountId) || 0) + Number(l.credit || 0));
      })
    );
    const rows = allAccounts
      .filter((a) => !a.isHeader)
      .map((a) => {
        const debit = debitMap.get(a.id) || 0;
        const credit = creditMap.get(a.id) || 0;
        // For asset/expense → balance = debit - credit; liability/equity/revenue → credit - debit
        const isDebitNormal = a.type === "asset" || a.type === "expense";
        const balance = isDebitNormal ? debit - credit : credit - debit;
        return {
          accountId: a.id,
          code: a.code,
          nameAr: a.nameAr,
          type: a.type,
          debit,
          credit,
          balance,
        };
      })
      .filter((r) => r.debit !== 0 || r.credit !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));

    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    res.json({ rows, totalDebit, totalCredit });
  });

  // ----- Reports: Balance Sheet -----
  app.get(api.reports.balanceSheet.path, async (req, res) => {
    const allAccounts = await storage.getAccounts(cid(req));
    const entries = await storage.getJournalEntries(cid(req));
    const debitMap = new Map<number, number>();
    const creditMap = new Map<number, number>();
    entries.forEach((je) =>
      je.lines.forEach((l) => {
        debitMap.set(l.accountId, (debitMap.get(l.accountId) || 0) + Number(l.debit || 0));
        creditMap.set(l.accountId, (creditMap.get(l.accountId) || 0) + Number(l.credit || 0));
      })
    );

    const balanceFor = (a: typeof allAccounts[number]) => {
      const debit = debitMap.get(a.id) || 0;
      const credit = creditMap.get(a.id) || 0;
      const isDebitNormal = a.type === "asset" || a.type === "expense";
      return isDebitNormal ? debit - credit : credit - debit;
    };

    const items = (predicate: (a: typeof allAccounts[number]) => boolean) =>
      allAccounts
        .filter((a) => !a.isHeader && predicate(a))
        .map((a) => ({ code: a.code, nameAr: a.nameAr, balance: balanceFor(a) }))
        .filter((i) => i.balance !== 0)
        .sort((a, b) => a.code.localeCompare(b.code));

    const currentAssets = items((a) => a.subtype === "current_asset");
    const nonCurrentAssets = items((a) => a.subtype === "non_current_asset" || a.subtype === "contra_asset");
    const currentLiabilities = items((a) => a.subtype === "current_liability");
    const nonCurrentLiabilities = items((a) => a.subtype === "non_current_liability");
    const equityItems = items((a) => a.type === "equity");

    // Compute net income from period to add to equity
    const totalRevenue = allAccounts
      .filter((a) => a.type === "revenue")
      .reduce((s, a) => s + balanceFor(a), 0);
    const totalExpenses = allAccounts
      .filter((a) => a.type === "expense")
      .reduce((s, a) => s + balanceFor(a), 0);
    const netIncome = totalRevenue - totalExpenses;

    const totalCurrentAssets = currentAssets.reduce((s, x) => s + x.balance, 0);
    const totalNonCurrentAssets = nonCurrentAssets.reduce((s, x) => s + x.balance, 0);
    const totalAssets = totalCurrentAssets + totalNonCurrentAssets;
    const totalCurrentLiabilities = currentLiabilities.reduce((s, x) => s + x.balance, 0);
    const totalNonCurrentLiabilities = nonCurrentLiabilities.reduce((s, x) => s + x.balance, 0);
    const totalLiabilities = totalCurrentLiabilities + totalNonCurrentLiabilities;
    const totalEquityBeforeIncome = equityItems.reduce((s, x) => s + x.balance, 0);
    const totalEquity = totalEquityBeforeIncome + netIncome;

    res.json({
      asOf: new Date().toISOString(),
      assets: {
        current: currentAssets,
        nonCurrent: nonCurrentAssets,
        totalCurrent: totalCurrentAssets,
        totalNonCurrent: totalNonCurrentAssets,
        total: totalAssets,
      },
      liabilities: {
        current: currentLiabilities,
        nonCurrent: nonCurrentLiabilities,
        totalCurrent: totalCurrentLiabilities,
        totalNonCurrent: totalNonCurrentLiabilities,
        total: totalLiabilities,
      },
      equity: {
        items: equityItems,
        netIncome,
        total: totalEquity,
      },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    });
  });

  // ============================================================================
  // Settings (singleton org settings)
  // ============================================================================
  app.get("/api/settings", async (req, res) => {
    res.json(await storage.getSettings(cid(req)));
  });

  // Workspace settings can only be modified by admins (per role matrix:
  // accountant has financial write access but cannot manage workspace
  // configuration).
  app.patch("/api/settings", async (req, res, next) => {
    const ctx = (req as any).membership as MembershipContext | undefined;
    if (!ctx || ctx.role !== "owner") return res.status(403).json({ message: "Owners only" });
    try {
      const { upsertSettingsSchema } = await import("@shared/schema");
      const input = upsertSettingsSchema.parse(req.body);
      const updated = await storage.updateSettings(cid(req), input);
      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      next(err);
    }
  });

  app.get("/api/localization/packs", async (_req, res) => {
    const { LOCALIZATION_PACKS } = await import("@shared/localization");
    res.json(Object.values(LOCALIZATION_PACKS));
  });

  // ============================================================================
  // HR — Employees, Attendance, Leaves, Payroll
  // ============================================================================
  const { insertEmployeeSchema, insertAttendanceSchema, insertLeaveSchema } = await import("@shared/schema");

  app.get("/api/hr/employees", async (req, res) => res.json(await storage.getEmployees(cid(req))));
  app.post("/api/hr/employees", async (req, res) => {
    try {
      const input = insertEmployeeSchema.parse(req.body);
      res.status(201).json(await storage.createEmployee(cid(req), input, userCtx(req)));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الموظف" });
    }
  });
  app.patch("/api/hr/employees/:id", async (req, res) => {
    try {
      const input = insertEmployeeSchema.partial().parse(req.body);
      res.json(await storage.updateEmployee(cid(req), Number(req.params.id), input, userCtx(req)));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });
  app.delete("/api/hr/employees/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      // Verify the employee belongs to the active workspace before doing
      // any cross-table look-ups, so we don't leak information about
      // employees in other workspaces (or their payroll history).
      const employees = await storage.getEmployees(cid(req));
      if (!employees.find((e) => e.id === id)) {
        return res.status(404).json({ message: "غير موجود" });
      }
      // Prevent deletion if linked payroll history exists. Scope the lookup
      // to this workspace by joining on payroll_runs (payroll_lines itself
      // has no companyId column, so without the join a leak would be
      // possible if employee ids ever overlapped).
      const { db } = await import("./db");
      const { payrollLines, payrollRuns } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const existing = await db
        .select({ id: payrollLines.id })
        .from(payrollLines)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.payrollRunId))
        .where(and(eq(payrollLines.employeeId, id), eq(payrollRuns.companyId, cid(req))))
        .limit(1);
      if (existing.length > 0) {
        return res.status(409).json({
          message: "لا يمكن حذف الموظف لأنه مرتبط بكشوف رواتب سابقة. يمكنك تعطيله بدلاً من ذلك.",
        });
      }
      await storage.deleteEmployee(cid(req), id, userCtx(req));
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "تعذر الحذف" });
    }
  });

  app.get("/api/hr/attendance", async (req, res) => {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    const yearMonth = req.query.yearMonth as string | undefined;
    res.json(await storage.getAttendance(cid(req), employeeId, yearMonth));
  });
  app.post("/api/hr/attendance", async (req, res) => {
    try {
      const input = insertAttendanceSchema.parse(req.body);
      // The body's `employeeId` is the only foreign-key id; verify it points
      // at an employee in the active workspace.
      if (!(await assertAllOwnedByCompany(employeesTable, cid(req), [input.employeeId]))) {
        return res.status(400).json({ message: "الموظف غير صالح" });
      }
      res.status(201).json(await storage.upsertAttendance(cid(req), input, userCtx(req)));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الحضور" });
    }
  });

  app.get("/api/hr/leaves", async (req, res) => {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : undefined;
    res.json(await storage.getLeaves(cid(req), employeeId));
  });
  app.post("/api/hr/leaves", async (req, res) => {
    try {
      const input = insertLeaveSchema.parse(req.body);
      // The body's `employeeId` is the only foreign-key id; verify it points
      // at an employee in the active workspace.
      if (!(await assertAllOwnedByCompany(employeesTable, cid(req), [input.employeeId]))) {
        return res.status(400).json({ message: "الموظف غير صالح" });
      }
      res.status(201).json(await storage.createLeave(cid(req), input, userCtx(req)));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الإجازة" });
    }
  });
  app.delete("/api/hr/leaves/:id", async (req, res) => {
    await storage.deleteLeave(cid(req), Number(req.params.id), userCtx(req));
    res.status(204).send();
  });

  app.get("/api/hr/leave-balance/:employeeId", async (req, res) => {
    const { leaveBalance } = await import("./payroll");
    res.json(await leaveBalance(cid(req), Number(req.params.employeeId)));
  });

  const payrollPeriodSchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
  });

  app.get("/api/hr/payroll/preview", async (req, res) => {
    try {
      const { computePayrollPreview } = await import("./payroll");
      const { year, month } = payrollPeriodSchema.parse({
        year: req.query.year || new Date().getFullYear(),
        month: req.query.month || new Date().getMonth() + 1,
      });
      res.json({ year, month, lines: await computePayrollPreview(cid(req), year, month) });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر حساب الرواتب" });
    }
  });

  app.post("/api/hr/payroll/run", async (req, res) => {
    try {
      const { runPayroll } = await import("./payroll");
      const { year, month } = payrollPeriodSchema.parse({
        year: req.body?.year || new Date().getFullYear(),
        month: req.body?.month || new Date().getMonth() + 1,
      });
      res.status(201).json(await runPayroll(cid(req), year, month, userCtx(req)));
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(400).json({ message: err?.message || "تعذر تنفيذ كشف الرواتب" });
    }
  });

  // Past payroll runs — feeds the History list under the Payroll Run tab so
  // users can audit calculate/post/delete events for each run.
  app.get("/api/hr/payroll/runs", async (req, res) => {
    res.json(await storage.listPayrollRuns(cid(req)));
  });

  // Per-employee breakdown for a single posted run — feeds the "Lines" tab
  // inside the payroll-run detail dialog so users can audit any past run
  // end-to-end without re-running the preview. Workspace-scoped via the
  // ownership check + companyId filter inside storage.
  app.get("/api/hr/payroll/runs/:id/lines", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const owned = await storage.entityBelongsToCompany("payroll_run", id, cid(req));
      if (!owned) return res.status(404).json({ message: "غير موجود" });
      res.json(await storage.getPayrollRunLines(cid(req), id));
    } catch (err: any) {
      res.status(500).json({ message: err?.message || "تعذر تحميل تفاصيل كشف الرواتب" });
    }
  });

  app.delete("/api/hr/payroll/runs/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const owned = await storage.entityBelongsToCompany("payroll_run", id, cid(req));
      if (!owned) return res.status(404).json({ message: "غير موجود" });
      await storage.deletePayrollRun(cid(req), id, userCtx(req));
      res.status(204).send();
    } catch (err: any) {
      // Refuse with 409 (Conflict) when the run's auto-posted journal entry is
      // referenced from outside the payroll subsystem — silently dropping the
      // run while leaving the GL twin behind would desynchronise HR & GL.
      if (err instanceof JournalEntryReferenceConflictError) {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err?.message || "تعذر حذف كشف الرواتب" });
    }
  });

  // ============================================================================
  // Decision Cockpit / Insights
  // ============================================================================
  const insights = await import("./insights");

  function parseRange(req: Request): { start: Date; end: Date } | undefined {
    const s = req.query.start ? String(req.query.start) : "";
    const e = req.query.end ? String(req.query.end) : "";
    if (!s || !e) return undefined;
    const start = new Date(s);
    const end = new Date(e);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return undefined;
    return { start, end };
  }

  app.get("/api/insights/health", async (req, res) => {
    const range = parseRange(req);
    const k = await insights.computeKPIs(cid(req), range);
    const health = insights.computeHealthScore(k);
    res.json({ kpis: k, health });
  });

  app.get("/api/insights/alerts", async (req, res) => {
    const alerts = await insights.generateAlerts(cid(req), parseRange(req));
    res.json({ alerts });
  });

  app.get("/api/insights/cash-forecast", async (req, res) => {
    const days = Number(req.query.days || 90);
    const forecast = await insights.projectCash(cid(req), Math.min(Math.max(days, 7), 365), parseRange(req));
    res.json(forecast);
  });

  const scenarioSchema = z.object({
    priceChangePct: z.coerce.number().min(-90).max(200).default(0),
    costChangePct: z.coerce.number().min(-90).max(200).default(0),
    newMonthlyExpense: z.coerce.number().min(0).default(0),
    expenseReductionPct: z.coerce.number().min(0).max(95).default(0),
    monthsAhead: z.coerce.number().int().min(1).max(36).default(12),
  });

  app.post("/api/insights/simulate", async (req, res) => {
    try {
      const input = scenarioSchema.parse(req.body);
      const result = await insights.simulateScenario(cid(req), input, parseRange(req));
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "تعذر تشغيل المحاكاة" });
    }
  });

  app.get("/api/insights/taxes", async (req, res) => {
    const t = await insights.estimateTaxes(cid(req), parseRange(req));
    res.json(t);
  });

  app.get("/api/insights/budget-vs-actual", async (req, res) => {
    const year = Number(req.query.year || new Date().getFullYear());
    const month = Number(req.query.month || new Date().getMonth() + 1);
    const rows = await insights.budgetVsActual(cid(req), year, month);
    res.json({ year, month, rows });
  });

  app.get("/api/budgets", async (req, res) => {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const list = await storage.getBudgets(cid(req), year, month);
    res.json(list);
  });

  app.post("/api/budgets", async (req, res) => {
    try {
      const { insertBudgetSchema } = await import("@shared/schema");
      const input = insertBudgetSchema.extend({
        year: z.coerce.number().int().min(2000).max(2100),
        month: z.coerce.number().int().min(1).max(12),
      }).parse(req.body);
      // `accountId` from the body is verified against the active workspace's
      // chart of accounts (and rejected if it points at a header row), so the
      // budget can never be attached to a foreign-tenant account.
      const acc = await storage.getAccounts(cid(req));
      if (!acc.find((a) => a.id === input.accountId && !a.isHeader)) {
        return res.status(400).json({ message: "حساب غير صالح" });
      }
      const b = await storage.upsertBudget(cid(req), input);
      res.status(201).json(b);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "فشل حفظ الميزانية" });
    }
  });

  app.delete("/api/budgets/:id", async (req, res) => {
    await storage.deleteBudget(cid(req), Number(req.params.id));
    res.status(204).send();
  });

  // ──────────────────────────────────────────────────────────────────
  // Sales Portal — customers, products, sales invoices.
  //
  // Reads use the bare GET handlers (the global /api gate already
  // requires authentication + active workspace). Writes inherit the
  // owner/accountant gate from `requireWriteRoleForMutations`, so we
  // don't redeclare it here. Workspace isolation comes from `cid(req)`
  // being threaded through every storage call (and RLS on the tables).
  //
  // The auto-posting / lifecycle transitions live in `server/sales.ts`
  // so the route layer stays thin. JE conflicts (e.g. trying to delete
  // a posted invoice without going through the cancel flow) bubble up
  // as `JournalEntryReferenceConflictError` → 409.
  // ──────────────────────────────────────────────────────────────────
  {
    const {
      insertCustomerSchema,
      insertProductSchema,
      createSalesInvoiceSchema,
      updateSalesInvoiceSchema,
    } = await import("@shared/schema");
    const sales = await import("./sales");

    // ----- Customers -----
    app.get(api.sales.customersList.path, async (req, res) => {
      res.json(await storage.listCustomers(cid(req)));
    });

    app.get("/api/sales/customers/:id", async (req, res) => {
      const row = await storage.getCustomer(cid(req), Number(req.params.id));
      if (!row) return res.status(404).json({ message: "غير موجود" });
      res.json(row);
    });

    app.post(api.sales.customerCreate.path, async (req, res) => {
      try {
        const input = insertCustomerSchema.parse(req.body);
        res.status(201).json(await storage.createCustomer(cid(req), input, userCtx(req)));
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        res.status(500).json({ message: "تعذر حفظ العميل" });
      }
    });

    app.patch("/api/sales/customers/:id", async (req, res) => {
      try {
        const input = insertCustomerSchema.partial().parse(req.body);
        const row = await storage.updateCustomer(
          cid(req),
          Number(req.params.id),
          input,
          userCtx(req),
        );
        res.json(row);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        if (err?.message?.includes("غير موجود")) {
          return res.status(404).json({ message: err.message });
        }
        res.status(500).json({ message: err?.message || "تعذر التحديث" });
      }
    });

    app.delete("/api/sales/customers/:id", async (req, res) => {
      try {
        await storage.deleteCustomer(cid(req), Number(req.params.id), userCtx(req));
        res.status(204).send();
      } catch (err: any) {
        // Storage throws when the customer still has invoices linked.
        if (err?.message?.includes("مرتبط") || err?.message?.includes("فواتير")) {
          return res.status(409).json({ message: err.message });
        }
        res.status(500).json({ message: err?.message || "تعذر الحذف" });
      }
    });

    app.get("/api/sales/customers/:id/balance", async (req, res) => {
      const balance = await storage.getCustomerBalance(cid(req), Number(req.params.id));
      res.json({ balance });
    });

    app.get("/api/sales/customers/:id/history", async (req, res) => {
      res.json(await storage.getCustomerInvoices(cid(req), Number(req.params.id)));
    });

    // ----- Products -----
    app.get(api.sales.productsList.path, async (req, res) => {
      res.json(await storage.listProducts(cid(req)));
    });

    app.post(api.sales.productCreate.path, async (req, res) => {
      try {
        const input = insertProductSchema.parse(req.body);
        res.status(201).json(await storage.createProduct(cid(req), input, userCtx(req)));
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        res.status(500).json({ message: "تعذر حفظ المنتج" });
      }
    });

    app.patch("/api/sales/products/:id", async (req, res) => {
      try {
        const input = insertProductSchema.partial().parse(req.body);
        const row = await storage.updateProduct(
          cid(req),
          Number(req.params.id),
          input,
          userCtx(req),
        );
        res.json(row);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        if (err?.message?.includes("غير موجود")) {
          return res.status(404).json({ message: err.message });
        }
        res.status(500).json({ message: err?.message || "تعذر التحديث" });
      }
    });

    app.delete("/api/sales/products/:id", async (req, res) => {
      try {
        await storage.deleteProduct(cid(req), Number(req.params.id), userCtx(req));
        res.status(204).send();
      } catch (err: any) {
        if (err?.message?.includes("مرتبط") || err?.message?.includes("فواتير")) {
          return res.status(409).json({ message: err.message });
        }
        res.status(500).json({ message: err?.message || "تعذر الحذف" });
      }
    });

    // ----- Sales invoices -----
    // Live-preview helper for the "create invoice" dialog. Declared
    // BEFORE the `/:id` route so Express doesn't try to parse
    // "next-number" as a numeric id.
    app.get(api.sales.invoiceNextNumber.path, async (req, res) => {
      res.json({ number: await storage.getNextSalesInvoiceNumber(cid(req)) });
    });

    app.get(api.sales.invoicesList.path, async (req, res) => {
      const status = req.query.status as
        | "draft"
        | "posted"
        | "cancelled"
        | undefined;
      const customerId = req.query.customerId
        ? Number(req.query.customerId)
        : undefined;
      res.json(await storage.listSalesInvoices(cid(req), { status, customerId }));
    });

    app.get("/api/sales/invoices/:id", async (req, res) => {
      const inv = await storage.getSalesInvoice(cid(req), Number(req.params.id));
      if (!inv) return res.status(404).json({ message: "الفاتورة غير موجودة" });
      res.json(inv);
    });

    app.post(api.sales.invoiceCreate.path, async (req, res) => {
      try {
        const input = createSalesInvoiceSchema.parse(req.body);
        const inv = await sales.createSalesInvoice(cid(req), input, userCtx(req));
        res.status(201).json(inv);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        res.status(400).json({ message: err?.message || "تعذر إنشاء الفاتورة" });
      }
    });

    app.patch("/api/sales/invoices/:id", async (req, res) => {
      try {
        const input = updateSalesInvoiceSchema.parse(req.body);
        const inv = await sales.updateSalesInvoice(
          cid(req),
          Number(req.params.id),
          input,
          userCtx(req),
        );
        res.json(inv);
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message });
        }
        if (err instanceof JournalEntryReferenceConflictError) {
          return res.status(409).json({ message: err.message });
        }
        if (err?.message?.includes("غير موجود")) {
          return res.status(404).json({ message: err.message });
        }
        res.status(400).json({ message: err?.message || "تعذر التحديث" });
      }
    });

    app.delete("/api/sales/invoices/:id", async (req, res) => {
      try {
        await sales.deleteSalesInvoice(cid(req), Number(req.params.id), userCtx(req));
        res.status(204).send();
      } catch (err: any) {
        if (err instanceof JournalEntryReferenceConflictError) {
          return res.status(409).json({ message: err.message });
        }
        res.status(500).json({ message: err?.message || "تعذر الحذف" });
      }
    });

    // Lifecycle transitions — explicit endpoints so the chat tool list /
    // role gate can target each one independently.
    app.post(api.sales.invoicePost.path, async (req, res) => {
      try {
        const inv = await sales.postSalesInvoice(
          cid(req),
          Number(req.params.id),
          userCtx(req),
        );
        res.json(inv);
      } catch (err: any) {
        if (err?.message?.includes("غير موجود")) {
          return res.status(404).json({ message: err.message });
        }
        res.status(400).json({ message: err?.message || "تعذر ترحيل الفاتورة" });
      }
    });

    app.post(api.sales.invoiceCancel.path, async (req, res) => {
      try {
        const inv = await sales.cancelSalesInvoice(
          cid(req),
          Number(req.params.id),
          userCtx(req),
        );
        res.json(inv);
      } catch (err: any) {
        if (err instanceof JournalEntryReferenceConflictError) {
          return res.status(409).json({ message: err.message });
        }
        if (err?.message?.includes("غير موجود")) {
          return res.status(404).json({ message: err.message });
        }
        res.status(400).json({ message: err?.message || "تعذر إلغاء الفاتورة" });
      }
    });

    // PDF route — renders a sales invoice in whatever locale the caller asks
    // for via `?lang=ar|en|de|fr`. The frontend reads the active locale from
    // `useLocale()` and tacks it on; if absent we fall back to Arabic.
    app.get("/api/sales/invoices/:id/pdf", async (req, res) => {
      try {
        const inv = await storage.getSalesInvoice(cid(req), Number(req.params.id));
        if (!inv) return res.status(404).json({ message: "الفاتورة غير موجودة" });
        const { renderSalesInvoicePdf } = await import("./services/pdf-arabic");
        const { parseLangParam } = await import("./lib/locale");
        const locale = parseLangParam(req);
        const buf = await renderSalesInvoicePdf(cid(req), inv, locale);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `inline; filename="invoice-${inv.number}.pdf"`,
        );
        res.send(buf);
      } catch (err: any) {
        res.status(500).json({ message: err?.message || "تعذر إنشاء ملف PDF" });
      }
    });
  }

  // AI Decision Coach (with simple per-IP rate limit to prevent abuse)
  const coachLimiter = new Map<string, number[]>();
  app.post("/api/insights/ai-coach", async (req, res) => {
    try {
      const ip = (req.ip || req.headers["x-forwarded-for"] || "anon").toString();
      const now = Date.now();
      const win = (coachLimiter.get(ip) || []).filter((t) => now - t < 60_000);
      if (win.length >= 8) {
        return res.status(429).json({ message: "كثرة الطلبات — حاول بعد دقيقة" });
      }
      win.push(now);
      coachLimiter.set(ip, win);
      const question = String(req.body?.question || "").slice(0, 1000);
      if (!question.trim()) return res.status(400).json({ message: "أدخل سؤالك" });

      const k = await insights.computeKPIs(cid(req));
      const cash = await insights.projectCash(cid(req), 90);
      const alerts = await insights.generateAlerts(cid(req));
      const txs = await storage.getTransactions(cid(req));

      const recentTxs = txs.slice(-15).map((t) => ({
        type: t.type,
        amount: Number(t.amount),
        category: t.category,
        description: t.description,
      }));

      const context = {
        kpis: {
          revenue: k.totalRevenue,
          expenses: k.totalExpenses,
          netProfit: k.netProfit,
          netMargin: `${(k.netMargin * 100).toFixed(1)}%`,
          grossMargin: `${(k.grossMargin * 100).toFixed(1)}%`,
          cash: k.cash,
          currentRatio: k.currentRatio.toFixed(2),
          totalAssets: k.totalAssets,
          totalLiabilities: k.totalLiabilities,
          totalEquity: k.totalEquity,
        },
        cashRunwayDays: cash.runwayDays,
        avgDailyNet: cash.avgDailyNet.toFixed(2),
        topAlerts: alerts.slice(0, 3).map((a) => `${a.severity}: ${a.title} — ${a.description}`),
        recentTransactions: recentTxs,
      };

      const systemPrompt = `أنت مستشار مالي ذكي خبير في معايير IFRS وفي قرارات الأعمال الصغيرة والمتوسطة في السوق السعودي.
- جاوب بالعربية الفصحى المختصرة، بأسلوب عملي مباشر بدون حشو.
- استخدم الأرقام الفعلية من السياق المُرفق ولا تخترع أرقاماً.
- نظّم جوابك في 3-5 نقاط واضحة (- نقطة:...).
- اختم برأي قاطع: "توصيتي: …" بجملة أو جملتين.
- إذا الأرقام لا تكفي للإجابة، قل ذلك صراحة واطلب البيانات الناقصة.`;

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `سؤال صاحب العمل: ${question}\n\nالبيانات المالية الحالية:\n${JSON.stringify(context, null, 2)}`,
          },
        ],
      });

      const answer = response.choices[0]?.message?.content || "تعذّر توليد إجابة.";
      res.json({ answer });
    } catch (err) {
      console.error("AI coach error", err);
      res.status(500).json({ message: "حدث خطأ في الحصول على نصيحة المستشار" });
    }
  });

  // Chat — per-workspace history
  app.get(api.chat.list.path, async (req, res) => {
    const messages = await storage.getChatMessages(cid(req));
    res.json(messages);
  });

  // Map of assistant tool name → entity tags whose cached views the client
  // must invalidate after the tool runs. Returned in the chat response as
  // `affected: string[]`. Keep in sync with AFFECTED_KEYS in
  // client/src/hooks/use-chat.ts.
  const TOOL_TO_AFFECTED: Record<string, readonly string[]> = {
    add_quick_transaction: ["transactions", "journal-entries", "accounts", "insights", "reports"],
    create_journal_entry: ["journal-entries", "accounts", "transactions", "insights", "reports"],
    create_account: ["accounts"],
    delete_transaction: ["transactions", "journal-entries", "accounts", "insights", "reports"],
    create_employee: ["employees"],
    record_attendance: ["attendance"],
    record_leave: ["leaves"],
    create_customer: ["customers"],
    create_sales_invoice: [
      "sales-invoices", "customers", "journal-entries", "accounts", "insights", "reports",
    ],
    update_sales_invoice: [
      "sales-invoices", "customers", "journal-entries", "accounts", "insights", "reports",
    ],
    delete_sales_invoice: [
      "sales-invoices", "customers", "journal-entries", "accounts", "insights", "reports",
    ],
    // Read-only tools below intentionally have no side effects to invalidate.
    list_accounts: [],
    list_transactions: [],
    list_employees: [],
    list_fixed_assets: [],
    get_financial_summary: [],
    generate_report: [],
    generate_excel_document: [],
    generate_word_document: [],
    generate_powerpoint_document: [],
    find_customer: [],
    list_recent_sales_invoices: [],
  };

  /**
   * Mirror an image attached to a chat turn into the document inbox so it
   * shows up alongside receipts uploaded the regular way. Returns true on
   * success, false when the data URL was unparseable or the bytes weren't a
   * recognisable image (we don't want to litter the inbox with garbage rows
   * for malformed uploads).
   */
  async function mirrorChatImageToInbox(opts: {
    companyId: number;
    imageDataUrl: string;
    uploadedBy: string | null;
    linkedJournalEntryId: number | null;
    assistantSummary: string;
  }): Promise<boolean> {
    // data URLs look like `data:<mime>;base64,<payload>`. Anything else is
    // either a remote URL we don't want to fetch from the chat path, or a
    // malformed input — bail out either way.
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(opts.imageDataUrl);
    if (!match) return false;
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) return false;
    // Trust the bytes, not the data-URL header — same defence as the
    // `/api/documents` upload path. Spoofed `data:image/png` prefixes
    // wrapping non-image bytes get rejected here.
    const detectedMime = detectImageMimeFromBuffer(buffer);
    if (!detectedMime) return false;

    const ext =
      detectedMime === "image/jpeg" ? "jpg" :
      detectedMime === "image/png"  ? "png" :
      detectedMime === "image/webp" ? "webp" :
      "img";
    const fileName = `chat-receipt-${Date.now()}.${ext}`;

    const saved = await saveDocumentFile({
      companyId: opts.companyId,
      buffer,
      originalName: fileName,
    });

    // If the assistant posted a JE from this image, mark the row "posted"
    // and link to that JE so the inbox renders it as fully ingested. If it
    // didn't, mark it "ready" with a minimal extraction so the user can
    // still see the receipt in their inbox and act on it manually if they
    // want to. This matches what /api/documents would have produced.
    const posted = opts.linkedJournalEntryId != null;
    await storage.createDocument(opts.companyId, {
      companyId: opts.companyId,
      fileName,
      mimeType: detectedMime,
      sizeBytes: saved.sizeBytes,
      storagePath: saved.storagePath,
      status: posted ? "posted" : "ready",
      extractedJson: {
        // Keep a bare-minimum extraction shape so the inbox UI's parser
        // doesn't choke. We don't have structured fields from the chat
        // turn, but the assistant's natural-language summary is useful as
        // a hint for whoever reviews the inbox later.
        documentType: "receipt",
        paymentMethod: "unknown",
        language: "ar",
        lineItems: [],
        confidence: 0.5,
        notes: opts.assistantSummary?.slice(0, 500) || "Captured via AI chat.",
      } as any,
      suggestedJournalJson: null,
      journalEntryId: opts.linkedJournalEntryId ?? null,
      uploadedBy: opts.uploadedBy ?? null,
      extractedAt: new Date(),
      postedAt: posted ? new Date() : null,
    });
    return true;
  }

  app.post(api.chat.message.path, async (req, res) => {
    try {
      const input = api.chat.message.input.parse(req.body);
      const companyId = cid(req);

      // Save user message
      const userContentForDb = input.imageData
        ? (input.content?.trim() || "📎 تم إرفاق فاتورة / إيصال")
        : input.content;
      await storage.createChatMessage({ companyId, role: "user", content: userContentForDb });

      // Resolve workspace currency for tool execution + system prompt
      let currency = "USD";
      try {
        const settings = await (storage as any).getSettings?.(companyId);
        if (settings?.currencyCode) currency = settings.currencyCode;
      } catch { /* settings optional */ }

      const LANG_NAMES: Record<string, string> = {
        ar: "Arabic (العربية)",
        en: "English",
        de: "German (Deutsch)",
        fr: "French (Français)",
      };
      const uiLocale: "ar" | "en" | "de" | "fr" =
        input.locale && LANG_NAMES[input.locale] ? input.locale : "ar";
      const uiLangName = LANG_NAMES[uiLocale];

      const systemPrompt = `You are the executive accounting assistant for the "Mohaseb" platform.

PRIMARY LANGUAGE — STRICT
The user has chosen ${uiLangName} as their interface language.
You MUST reply in ${uiLangName} for every turn, regardless of the language the user typed in.
The only exception: if the user explicitly writes a sentence in another supported language
AND explicitly asks you to switch ("answer in English", "réponds en français", …),
honour the override for that turn only.
Supported languages: Arabic, English, German, French.
For Arabic, use modern standard Arabic (الفصحى البسيطة), right-to-left.
When you call any generate_*_document tool, ALWAYS pass language="${uiLocale}" so the file is produced in the user's language with correct direction.

Your job is to EXECUTE — not just answer. You have real tools that write to the books, manage HR, and produce real downloadable Office files.

═══ FINANCIAL OPERATIONS ═══
• add_quick_transaction — record a single income or expense from one sentence.
• create_journal_entry — full double-entry journal (requires accountId from list_accounts).
• list_accounts — fetch the chart of accounts before any journal entry.
• create_account — add a new GL account when none of the existing ones fits. Pick a code that nests under the right parent (e.g. a new bank under 1120, a new opex under 6000) and pass parentCode. Idempotent on code collision.
• list_transactions — search/filter recent transactions.
• delete_transaction — remove a transaction (confirm first unless the user is explicit).
• get_financial_summary — totals: balance, income, expenses, net.
• generate_report — standard reports (trial_balance, profit_loss, balance_sheet) as Excel or PDF.

═══ HR & PAYROLL ═══
• list_employees, create_employee, record_attendance, record_leave.

═══ FIXED ASSETS ═══
• list_fixed_assets.

═══ CUSTOM OFFICE DOCUMENTS ═══
• generate_excel_document — build any custom .xlsx (multi-sheet, headers + rows).
• generate_word_document — build a .docx (headings, paragraphs, bullets, tables) — RTL-aware for Arabic.
• generate_powerpoint_document — build a .pptx deck (cover + slides with bullets and optional tables).
For ALL three: pass the language ("ar" | "en" | "de" | "fr") so the file gets correct direction and metadata.

═══ EXECUTION RULES ═══
1. The user describes — you execute. Never promise; act, then confirm in one short line.
2. Use list_accounts before any create_journal_entry. Debits MUST equal credits.
3. For receipt/invoice images: extract amount + vendor, then call add_quick_transaction.
4. When the user asks for an Excel/Word/PowerPoint that isn't a standard financial report,
   use the matching generate_*_document tool. Don't paste the data into chat — produce a real file.
5. Workspace currency is ${currency}. Use it for all amounts.
6. Be concise. After a tool runs, one sentence in the user's language is enough — the UI shows
   the artifact card and the download button automatically.`;

      // Build initial messages — include short history for continuity
      const history = await storage.getChatMessages(companyId);
      const recent = history.slice(-10);
      const messages: any[] = [{ role: "system", content: systemPrompt }];
      for (const m of recent) {
        if (m.role === "user" || m.role === "assistant") {
          // strip our embedded artifact marker from prior assistant messages
          const c = String(m.content || "").replace(/<<ARTIFACTS>>[\s\S]*?<<END>>/g, "").trim();
          if (c) messages.push({ role: m.role, content: c });
        }
      }

      let userMessage: any;
      if (input.imageData) {
        const textPart = input.content?.trim() || "هذه صورة فاتورة، استخرج منها تفاصيل المعاملة وسجلها.";
        userMessage = {
          role: "user",
          content: [
            { type: "text", text: textPart },
            { type: "image_url", image_url: { url: input.imageData } },
          ],
        };
      } else {
        userMessage = { role: "user", content: input.content };
      }
      messages.push(userMessage);

      // Function-calling loop — up to 6 iterations (tool → result → tool → …)
      const artifacts: ToolArtifact[] = [];
      // Tools the assistant actually invoked this turn. We use this set both
      // to derive the `affected` payload (so the client knows which caches
      // to invalidate) and to decide whether a chat-uploaded image should be
      // mirrored into the document inbox as a "posted" or "ready" row.
      const toolsCalled = new Set<string>();
      // The first journal-entry id created by a tool, if any. Used to link
      // a chat-uploaded receipt to the JE the assistant posted from it.
      let firstJournalEntryId: number | null = null;
      let finalText = "";
      const MAX_ITERS = 6;

      for (let iter = 0; iter < MAX_ITERS; iter++) {
        const completion = await openai.chat.completions.create({
          model: "gpt-5.2",
          messages,
          tools: ASSISTANT_TOOLS as any,
        });
        const choice = completion.choices[0]?.message;
        if (!choice) break;
        messages.push(choice as any);

        const toolCalls = choice.tool_calls || [];
        if (toolCalls.length === 0) {
          finalText = (choice.content || "").trim();
          break;
        }

        // Execute every tool call (parallel)
        const results = await Promise.all(toolCalls.map(async (tc: any) => {
          let parsed: any = {};
          try { parsed = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
          const result = await executeTool(tc.function.name, parsed, {
            companyId,
            currency,
            actor: actorName(req),
            // Forward the user's UI locale so locale-aware tools (currently
            // `generate_report` for PDF output) render in the same language
            // the rest of the app is showing.
            locale: uiLocale,
          });
          if (result.artifact) artifacts.push(result.artifact);
          toolsCalled.add(tc.function.name);
          // Capture the JE id so we can link the chat-uploaded receipt to
          // it below. Two tools can post a journal entry:
          //   - create_journal_entry returns it directly in modelResult.
          //   - add_quick_transaction auto-posts asynchronously through
          //     `autoPostFromTransaction`; we look the id back up by the
          //     transaction id the tool surfaces in modelResult.
          if (
            firstJournalEntryId == null &&
            tc.function.name === "create_journal_entry" &&
            (result as any).modelResult?.ok &&
            typeof (result as any).modelResult?.journalEntryId === "number"
          ) {
            firstJournalEntryId = (result as any).modelResult.journalEntryId;
          }
          if (
            firstJournalEntryId == null &&
            tc.function.name === "add_quick_transaction" &&
            (result as any).modelResult?.ok &&
            typeof (result as any).modelResult?.transactionId === "number"
          ) {
            try {
              firstJournalEntryId = await storage.getJournalEntryIdByTransactionId(
                companyId,
                (result as any).modelResult.transactionId,
              );
            } catch (lookupErr) {
              // Swallow: failing the lookup just means the mirrored receipt
              // stays in `ready` instead of `posted`, which is the previous
              // behaviour and strictly safer than blocking the chat reply.
              console.warn("[chat] failed to resolve auto-posted JE id", lookupErr);
            }
          }
          return {
            role: "tool" as const,
            tool_call_id: tc.id,
            content: JSON.stringify(result.modelResult),
          };
        }));
        messages.push(...results);
      }

      if (!finalText) finalText = artifacts.length ? "تم ✅" : "تمام.";

      const serialized = artifacts.length
        ? `${finalText}\n\n<<ARTIFACTS>>${JSON.stringify(artifacts)}<<END>>`
        : finalText;

      // ── Mirror chat-uploaded receipts into the document inbox ──────────
      // When the user attaches an image to a chat turn, the assistant
      // typically extracts the data and (often) posts a journal entry. The
      // user reasonably expects that receipt to also show up in the inbox
      // alongside the ones they uploaded the "normal" way. Without this
      // mirror step, every AI-ingested receipt is invisible to the auditor
      // browsing /inbox after the fact.
      const affectedSet = new Set<string>();
      if (input.imageData) {
        try {
          const mirrored = await mirrorChatImageToInbox({
            companyId,
            imageDataUrl: input.imageData,
            uploadedBy: (req as any).user?.claims?.sub ?? null,
            linkedJournalEntryId: firstJournalEntryId,
            assistantSummary: finalText,
          });
          if (mirrored) affectedSet.add("documents");
        } catch (mirrorErr) {
          // Non-fatal: failing to mirror should never block the chat reply.
          // We log and move on so the user still gets their answer.
          console.warn("[chat] failed to mirror image to inbox", mirrorErr);
        }
      }

      // Translate the set of tool names into entity tags the client knows
      // how to invalidate. Keep this map in sync with AFFECTED_KEYS in
      // client/src/hooks/use-chat.ts.
      // (Set.forEach instead of for-of to avoid the downlevelIteration TS
      // diagnostic — the rest of this file follows the same convention.)
      toolsCalled.forEach((tool) => {
        for (const tag of TOOL_TO_AFFECTED[tool] ?? []) {
          affectedSet.add(tag);
        }
      });

      const assistantMessage = await storage.createChatMessage({
        companyId,
        role: "assistant",
        content: serialized,
      });

      res.json({ ...assistantMessage, affected: Array.from(affectedSet) });
    } catch (err) {
      console.error("Chat error", err);
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      // Persist a graceful assistant fallback so the chat doesn't appear stuck
      try {
        const fallback = await storage.createChatMessage({
          companyId: cid(req),
          role: "assistant",
          content: "عذراً، حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى من فضلك. 🙏",
        });
        return res.status(200).json(fallback);
      } catch {
        return res.status(500).json({ message: "حدث خطأ في معالجة الطلب" });
      }
    }
  });

  // ============================================================================
  // Voice — speech-to-text (Whisper) + text-to-speech (gpt-4o-mini-tts)
  // ============================================================================
  // Multipart upload limited to 25 MB (OpenAI's whisper hard cap).
  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith("audio/") && !file.mimetype.startsWith("video/webm")) {
        return cb(new Error("Only audio uploads are supported."));
      }
      cb(null, true);
    },
  });

  app.post(
    "/api/assistant/transcribe",
    audioUpload.single("audio"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: "Missing audio file" });
        const locale =
          typeof req.body?.locale === "string" &&
          ["ar", "en", "de", "fr"].includes(req.body.locale)
            ? (req.body.locale as "ar" | "en" | "de" | "fr")
            : undefined;

        // Pick a sensible filename so OpenAI can sniff the format. Browsers
        // typically record `audio/webm;codecs=opus` from MediaRecorder.
        const ext =
          req.file.mimetype.includes("mp4") || req.file.mimetype.includes("m4a")
            ? "m4a"
            : req.file.mimetype.includes("mpeg") || req.file.mimetype.includes("mp3")
            ? "mp3"
            : req.file.mimetype.includes("wav")
            ? "wav"
            : req.file.mimetype.includes("ogg")
            ? "ogg"
            : "webm";

        // OpenAI's SDK accepts a Web `File` (Node 20+ provides it globally).
        const audioFile = new File([req.file.buffer], `voice.${ext}`, {
          type: req.file.mimetype || "audio/webm",
        });

        const transcription = await openai.audio.transcriptions.create({
          file: audioFile,
          // gpt-4o-mini-transcribe gives better quality on short utterances and
          // handles all four supported languages natively.
          model: "gpt-4o-mini-transcribe",
          language: locale, // hint when known, auto-detect when not
        });

        res.json({ text: transcription.text || "", locale: locale || null });
      } catch (err: any) {
        console.error("[transcribe] failed", err);
        res.status(500).json({ message: err?.message || "Transcription failed" });
      }
    },
  );

  app.post("/api/assistant/speech", async (req, res) => {
    try {
      const text = String(req.body?.text || "").slice(0, 4000);
      if (!text.trim()) return res.status(400).json({ message: "Missing text" });
      // gpt-4o-mini-tts handles AR/EN/DE/FR with the same multilingual voice.
      const speech = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: "alloy",
        input: text,
        response_format: "mp3",
      });
      const buf = Buffer.from(await speech.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.send(buf);
    } catch (err: any) {
      console.error("[tts] failed", err);
      res.status(500).json({ message: err?.message || "Speech synthesis failed" });
    }
  });

  // ============================================================================
  // Generated file downloads (assistant artifacts — Excel/PDF reports)
  // ============================================================================
  app.get("/api/files/:fileId/download", (req, res) => {
    const file = readGeneratedFile(req.params.fileId, cid(req));
    if (!file) return res.status(404).json({ message: "File not found or expired" });
    res.setHeader("Content-Type", file.mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.filename)}"`
    );
    res.setHeader("Content-Length", String(file.buffer.length));
    res.end(file.buffer);
  });

  // ============================================================================
  // AI Document Inbox — receipts/invoices → extracted data → suggested JE
  // ============================================================================
  registerDocumentRoutes(app);

  // ============================================================================
  // Fixed Assets (IAS 16 / IAS 36)
  // ============================================================================
  await registerFixedAssetRoutes(app);

  return httpServer;
}

// ----------------------------------------------------------------------------
// AI document inbox routes
// ----------------------------------------------------------------------------

function registerDocumentRoutes(app: Express) {
  // 10 MB cap is generous for phone-camera receipts and well below Express's
  // default body limit. Memory storage keeps the upload in RAM long enough
  // for us to hash + persist + send to vision API in one pass.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // First-line gate based on the caller-supplied Content-Type. The
      // real defence is the magic-bytes sniff inside the route handler
      // (a forged `image/png` MIME on a shell script would otherwise
      // sail through this branch); see task #196 / #248. PDF support
      // was added in #248 so vendor invoices can be forwarded straight
      // from email without printing-then-scanning.
      const ok =
        file.mimetype.startsWith("image/") ||
        file.mimetype === "application/pdf";
      if (!ok) {
        return cb(
          new Error(
            "Only image uploads (PNG, JPEG, WEBP, GIF) and PDF files are supported.",
          ),
        );
      }
      cb(null, true);
    },
  });

  function userIdFromReq(req: Request): string | null {
    const u = (req as any).user;
    return (u?.claims?.sub as string | undefined) ?? null;
  }

  // List inbox
  app.get("/api/documents", async (req, res) => {
    const rows = await storage.listDocuments(cid(req));
    res.json(rows);
  });

  // Upload + extract (extraction runs synchronously here so the user gets
  // immediate feedback; for very large workspaces this can be moved to a
  // background queue without changing the API contract).
  app.post("/api/documents", upload.single("file"), async (req, res, next) => {
    try {
      const companyId = cid(req);
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      // The multer fileFilter above only checks the caller-supplied
      // `Content-Type`, which is trivially forgeable (`curl -F
      // file=@evil.sh;type=image/png` would otherwise be enough to feed
      // arbitrary bytes into the AI vision extractor and persist them as
      // an "ingested invoice"). Sniff the actual file signature here, BEFORE
      // any extraction or storage write, and trust the bytes — not the
      // caller. Mirrors the avatar route's defence; see task #196 (image
      // formats) and task #248 (PDF support).
      const detectedMime = detectDocumentMimeFromBuffer(file.buffer);
      if (!detectedMime) {
        throw new InvalidDocumentError();
      }

      const saved = await saveDocumentFile({
        companyId,
        buffer: file.buffer,
        originalName: file.originalname,
      });

      const created = await storage.createDocument(companyId, {
        companyId,
        fileName: file.originalname,
        // Persist the sniffed MIME, not the caller-supplied one — otherwise
        // a forged `Content-Type` would still leak through to the row's
        // `mimeType` and the GET /api/documents/:id/file response header.
        mimeType: detectedMime,
        sizeBytes: saved.sizeBytes,
        storagePath: saved.storagePath,
        status: "extracting",
        uploadedBy: userIdFromReq(req),
      });

      // Kick off extraction. We await so the response carries the result
      // (and any errors are surfaced to the user immediately).
      try {
        const extracted = await extractDocument(file.buffer, detectedMime);
        const accounts = await storage.getAccounts(companyId);
        const settings = await storage.getSettings(companyId);
        const suggestion = await suggestJournalForDocument(extracted, accounts, settings);

        const updated = await storage.updateDocumentExtraction(companyId, created.id, {
          status: "ready",
          extractedJson: extracted,
          suggestedJournalJson: suggestion,
        });
        res.status(201).json(updated);
      } catch (err: any) {
        const msg = err?.message ?? "Extraction failed";
        const failed = await storage.updateDocumentExtraction(companyId, created.id, {
          status: "error",
          errorMessage: String(msg).slice(0, 500),
        });
        res.status(201).json(failed);
      }
    } catch (err) {
      next(err);
    }
  });

  // Detail
  app.get("/api/documents/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const row = await storage.getDocument(cid(req), id);
    if (!row) return res.status(404).json({ message: "Not found" });
    res.json(row);
  });

  // Original-file passthrough (workspace-scoped — we never serve a doc
  // belonging to another company even if the path is guessed correctly).
  app.get("/api/documents/:id/file", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const row = await storage.getDocument(cid(req), id);
      if (!row) return res.status(404).json({ message: "Not found" });
      const buffer = await readDocumentFile(row.storagePath);
      res.setHeader("Content-Type", row.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(row.fileName)}"`,
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      res.end(buffer);
    } catch (err) {
      next(err);
    }
  });

  // Confirm + post → create journal entry, link doc → JE
  app.post("/api/documents/:id/post", async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const companyId = cid(req);
      const input = postDocumentSchema.parse(req.body);

      // Atomic ready→posting claim: prevents two concurrent confirm clicks
      // from each creating a journal entry against the same source document.
      const claimed = await storage.claimDocumentForPosting(companyId, id);
      if (!claimed) {
        const row = await storage.getDocument(companyId, id);
        if (!row) return res.status(404).json({ message: "Not found" });
        if (row.status === "posted") {
          return res.status(409).json({ message: "Document already posted" });
        }
        return res
          .status(409)
          .json({ message: `Document not ready to post (status: ${row.status})` });
      }
      const row = claimed;

      // Defensive balance + accounts-belong-to-workspace check before
      // creating the JE — the user could have edited the suggestion freely.
      const totalDebit = input.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const totalCredit = input.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.005 || totalDebit <= 0) {
        return res.status(400).json({ message: "Debits and credits must balance and be > 0" });
      }
      const accounts = await storage.getAccounts(companyId);
      const validIds = new Set(accounts.filter((a) => !a.isHeader).map((a) => a.id));
      for (const l of input.lines) {
        if (!validIds.has(l.accountId)) {
          return res.status(400).json({ message: `Unknown account id ${l.accountId}` });
        }
      }

      try {
        const je = await storage.createJournalEntry(
          companyId,
          {
            description: input.description,
            entryDate: input.entryDate ?? new Date().toISOString().slice(0, 10),
            source: "ai",
            lines: input.lines.map((l) => ({
              accountId: l.accountId,
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0),
              description: l.description,
            })),
          },
          // The journal entry is built from an AI-extracted suggestion, so we
          // record `source: "ai"` while still naming the human who confirmed
          // the post in the History drawer.
          aiCtx(req),
        );
        const updated = await storage.markDocumentPosted(companyId, id, je.id);
        res.status(201).json({ document: updated, journalEntry: je });
      } catch (jeErr) {
        // Roll the document back to `ready` so the user can retry. Without
        // this the row would be stuck in `posting` forever.
        await storage.updateDocumentExtraction(companyId, id, {
          status: "ready",
          extractedJson: row.extractedJson as any,
          suggestedJournalJson: row.suggestedJournalJson as any,
        });
        throw jeErr;
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      next(err);
    }
  });

  app.delete("/api/documents/:id", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const companyId = cid(req);
    try {
      const removed = await storage.deleteDocument(companyId, id, userCtx(req));
      if (removed) {
        await deleteDocumentFileIfOrphaned(removed.storagePath, async () => {
          const remaining = await storage.countDocumentsByStoragePath(
            companyId,
            removed.storagePath,
          );
          return remaining > 0;
        });
      }
      res.status(204).send();
    } catch (err: any) {
      // 409 when the document's posted JE is referenced elsewhere — same
      // contract as DELETE /api/hr/payroll/runs/:id.
      if (err instanceof JournalEntryReferenceConflictError) {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err?.message || "تعذر حذف المستند" });
    }
  });

  // Multer / fileFilter errors → 400 instead of 500. The `InvalidDocumentError`
  // branch is the magic-bytes gate from task #196 (extended for PDFs in
  // task #248) — a renamed text file with a forged `image/png` Content-Type
  // passes the multer filter but fails the signature sniff in the route
  // handler. `InvalidImageError` is kept around because legacy callers
  // (and the avatar route's shared error class) may still surface here.
  app.use("/api/documents", (err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof InvalidDocumentError || err instanceof InvalidImageError) {
      return res.status(400).json({ message: err.message });
    }
    if (
      err &&
      (err instanceof multer.MulterError ||
        /Only image uploads/.test(err.message ?? ""))
    ) {
      return res.status(400).json({ message: err.message });
    }
    return next(err);
  });
}

async function registerFixedAssetRoutes(app: Express) {
  const {
    insertCompanySchema,
    insertFxRateSchema,
    insertAssetCategorySchema,
    insertFixedAssetSchema,
    insertAssetComponentSchema,
    DEPRECIATION_METHODS,
  } = await import("@shared/schema");
  const fa = await import("./fixed-assets");
  const {
    CASH_ACCOUNT_CODE,
  } = await import("@shared/coa-seed");

  const RETAINED_EARNINGS_CODE = "3200";

  async function resolveAccountId(companyId: number, code: string): Promise<number | null> {
    const acc = await storage.getAccountByCode(companyId, code);
    return acc?.id ?? null;
  }

  // Helper: load a fixed asset and verify it belongs to the active workspace.
  async function loadOwnedAsset(req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "معرّف غير صالح" });
      return null;
    }
    const asset = await storage.getFixedAsset(id);
    if (!asset || asset.companyId !== cid(req)) {
      res.status(404).json({ message: "الأصل غير موجود" });
      return null;
    }
    return asset;
  }

  // Companies — scoped to the signed-in user's memberships only.
  app.get("/api/companies", async (req, res) => {
    const { authBizStorage } = await import("./auth/storage");
    const userId = (req.user as any)?.claims?.sub as string | undefined;
    if (!userId) return res.json([]);
    const ms = await authBizStorage.listMembershipsForUser(userId);
    const cos = ms.map((m) => m.company).filter(Boolean);
    res.json(cos);
  });
  app.post("/api/companies", async (req, res) => {
    try {
      // Workspace-scoped owner gate. Creating a company is *self-service* for
      // a brand-new account that has no memberships yet (the bootstrap path
      // used by signup → "create your first workspace"), but once the caller
      // already has any membership, only the owner of the active workspace
      // may add another company. This mirrors the OwnerGuard wrapper on the
      // <button-add-company> control in the UI: viewers and accountants are
      // shown the button disabled, and the server must reject the same call
      // if it bypasses the disable.
      //
      // Important: do *not* gate solely on the presence of `membership`.
      // A non-owner user can force `membership` to be missing on the
      // request by sending a bogus `x-company-id` / `?companyId=` value
      // that fails the membership lookup in `attachMembership`. If we
      // only checked `if (ctx && ctx.role !== "owner")`, that bypass
      // would still let a viewer or accountant self-service into a
      // brand-new owner workspace. Instead, when `ctx` is absent we
      // look up the caller's memberships directly and only allow the
      // bootstrap path when they truly have none.
      const userId = (req.user as any)?.claims?.sub as string | undefined;
      const ctx = (req as Request & { membership?: MembershipContext }).membership;
      if (ctx) {
        if (ctx.role !== "owner") return res.status(403).json({ message: "Owners only" });
      } else if (userId) {
        const { authBizStorage } = await import("./auth/storage");
        const ms = await authBizStorage.listMembershipsForUser(userId);
        if (ms.length > 0) return res.status(403).json({ message: "Owners only" });
      }
      const input = insertCompanySchema.parse(req.body);
      // Pull the owner-membership wire-up into `createCompany`'s
      // single transaction (task #218). Previously this route committed
      // the company + chart-of-accounts seed first and then issued a
      // separate `createMembership` call; if that second write blew up
      // (RLS regression, network blip, future unique constraint), the
      // request 500'd but the company row + its CoA tree were already
      // committed with no membership — which made the workspace
      // invisible to its creator (the `/api/companies` list is filtered
      // by membership) and orphaned the accounts. Passing
      // `ownerMembership` here makes company + CoA + owner-link an all-
      // or-nothing atomic write so a half-bootstrapped workspace can
      // never be left behind.
      const company = await storage.createCompany(
        { ...input, ownerUserId: userId ?? null },
        userId ? { ownerMembership: { userId, role: "owner" } } : undefined,
      );
      res.status(201).json(company);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ الشركة" });
    }
  });
  app.patch("/api/companies/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const ctx = (req as Request & { membership?: MembershipContext }).membership;
      // Authorization: must be owner of the active workspace, and the target
      // workspace must match it (no cross-tenant edits).
      if (!ctx || ctx.role !== "owner" || id !== ctx.companyId) {
        return res.status(403).json({ message: "Owners only" });
      }
      const input = insertCompanySchema.partial().parse(req.body);
      res.json(await storage.updateCompany(id, input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });

  // FX Rates — always scoped to the active workspace; client-provided companyId is ignored.
  app.get("/api/fx-rates", async (req, res) => {
    res.json(await storage.getFxRates(cid(req)));
  });
  app.post("/api/fx-rates", async (req, res) => {
    // Owner-only mutation. The matching <button-save-fx> control is wrapped
    // in <OwnerGuard>; viewers and accountants must hit a 403 here too if
    // they bypass the disabled state and call the API directly.
    const ctx = (req as Request & { membership?: MembershipContext }).membership;
    if (!ctx || ctx.role !== "owner") return res.status(403).json({ message: "Owners only" });
    try {
      const input = insertFxRateSchema.parse(req.body);
      res.status(201).json(await storage.createFxRate({ ...input, companyId: cid(req) }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ سعر الصرف" });
    }
  });
  app.delete("/api/fx-rates/:id", async (req, res) => {
    // Owner-only mutation — see POST /api/fx-rates above. The per-row
    // <button-delete-fx-{id}> in the FX panel is OwnerGuard-wrapped.
    const ctx = (req as Request & { membership?: MembershipContext }).membership;
    if (!ctx || ctx.role !== "owner") return res.status(403).json({ message: "Owners only" });
    const id = Number(req.params.id);
    const rates = await storage.getFxRates(cid(req));
    if (!rates.find((r) => r.id === id)) return res.status(404).json({ message: "غير موجود" });
    await storage.deleteFxRate(id);
    res.status(204).send();
  });

  // Asset Categories — always scoped to the active workspace.
  app.get("/api/asset-categories", async (req, res) => {
    res.json(await storage.getAssetCategories(cid(req)));
  });
  // Account-id fields on an asset category that must belong to the active workspace.
  const ASSET_CATEGORY_ACCOUNT_FIELDS = [
    "assetCostAccountId",
    "accumulatedDepAccountId",
    "depExpenseAccountId",
    "accumulatedImpAccountId",
    "impLossAccountId",
    "revalSurplusAccountId",
    "gainLossDisposalAccountId",
  ] as const;
  function categoryAccountIds(input: Partial<Record<(typeof ASSET_CATEGORY_ACCOUNT_FIELDS)[number], number>>): number[] {
    return ASSET_CATEGORY_ACCOUNT_FIELDS
      .map((f) => input[f])
      .filter((v): v is number => typeof v === "number");
  }

  app.post("/api/asset-categories", async (req, res) => {
    try {
      const input = insertAssetCategorySchema.parse(req.body);
      // Reject account ids from a foreign workspace.
      if (!(await assertAllOwnedByCompany(accountsTable, cid(req), categoryAccountIds(input)))) {
        return res.status(400).json({ message: "حساب غير صالح" });
      }
      res.status(201).json(await storage.createAssetCategory({ ...input, companyId: cid(req) }));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر حفظ التصنيف" });
    }
  });
  app.patch("/api/asset-categories/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const cats = await storage.getAssetCategories(cid(req));
      if (!cats.find((c) => c.id === id)) return res.status(404).json({ message: "غير موجود" });
      const input = insertAssetCategorySchema.partial().parse(req.body);
      if (!(await assertAllOwnedByCompany(accountsTable, cid(req), categoryAccountIds(input)))) {
        return res.status(400).json({ message: "حساب غير صالح" });
      }
      res.json(await storage.updateAssetCategory(id, input));
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر التحديث" });
    }
  });

  // Fixed Assets - list (always scoped to active workspace)
  app.get("/api/fixed-assets", async (req, res) => {
    const all = await storage.getFixedAssets(cid(req));
    res.json(all.map((a) => ({
      ...a,
      carryingAmount: fa.carryingAmount({ cost: a.cost, accumDepreciation: a.accumDepreciation, accumImpairment: a.accumImpairment }),
    })));
  });

  app.get("/api/fixed-assets/:id", async (req, res) => {
    const asset = await loadOwnedAsset(req, res);
    if (!asset) return;
    const id = asset.id;
    const [components, schedule, impairments, revaluations, disposalsList, depreciations] = await Promise.all([
      storage.getAssetComponents(id),
      storage.getSchedule(id),
      storage.getImpairmentEvents(id),
      storage.getRevaluationEvents(id),
      storage.getDisposals(id),
      storage.getDepreciationPostingsByAsset(id),
    ]);
    res.json({
      ...asset,
      carryingAmount: fa.carryingAmount({ cost: asset.cost, accumDepreciation: asset.accumDepreciation, accumImpairment: asset.accumImpairment }),
      components,
      schedule,
      impairments,
      revaluations,
      disposals: disposalsList,
      depreciations,
    });
  });

  app.post("/api/fixed-assets/preview-schedule", async (req, res) => {
    try {
      const body = z.object({
        cost: z.coerce.number().positive(),
        residual: z.coerce.number().nonnegative().default(0),
        usefulLifeMonths: z.coerce.number().int().positive(),
        method: z.enum(DEPRECIATION_METHODS),
        inServiceDate: z.string().min(1),
        unitsTotal: z.coerce.number().positive().optional().nullable(),
      }).parse(req.body);
      const sched = fa.generateSchedule({
        cost: body.cost,
        residual: body.residual,
        usefulLifeMonths: body.usefulLifeMonths,
        method: body.method,
        unitsTotal: body.unitsTotal ?? null,
        inServiceDate: body.inServiceDate,
        accumDepreciation: 0,
        accumImpairment: 0,
      });
      res.json({ schedule: sched });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر توليد الجدول" });
    }
  });

  app.post("/api/fixed-assets", async (req, res) => {
    try {
      const companyId = cid(req);
      const componentsSchema = z.array(insertAssetComponentSchema.omit({ assetId: true })).optional().default([]);
      // The insert schema already strips companyId so the workspace is always derived server-side.
      const body = insertFixedAssetSchema.extend({
        components: componentsSchema,
      }).parse(req.body);
      // `categoryId` is the only foreign-key id the client supplies (component
      // rows have `assetId` stripped by the schema and are stamped server-side
      // below). Verify the category against THIS workspace's catalog.
      const cat = (await storage.getAssetCategories(companyId)).find((c) => c.id === body.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف الأصل غير صالح" });
      const cost = Number(body.txCost) * Number(body.fxRate ?? 1);
      const { components, customSchedule, ...rest } = body;
      const created = await storage.createFixedAsset({
        ...rest,
        companyId,
        cost,
        customSchedule: customSchedule ? JSON.stringify(customSchedule) : null,
      }, userCtx(req));

      for (const comp of components || []) {
        await storage.createAssetComponent({ ...comp, assetId: created.id, companyId });
      }
      // Generate planned schedule (best-effort; skip for units_of_production / custom)
      if (created.method !== "units_of_production" && created.method !== "custom") {
        const sched = fa.generateSchedule(fa.unitFromAsset(created));
        await storage.replaceSchedule(companyId, created.id, sched.map((r) => ({
          periodYear: r.year, periodMonth: r.month, plannedAmount: r.amount,
        })));
      }
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error(err);
      res.status(500).json({ message: "تعذر حفظ الأصل" });
    }
  });

  app.delete("/api/fixed-assets/:id", async (req, res) => {
    const asset = await loadOwnedAsset(req, res);
    if (!asset) return;
    await storage.deleteFixedAsset(asset.id, userCtx(req));
    res.status(204).send();
  });

  // Depreciation runs — always scoped to active workspace
  app.get("/api/depreciation-runs", async (req, res) => {
    const runs = await storage.getDepreciationRuns(cid(req));
    res.json(runs);
  });

  app.get("/api/depreciation-runs/:id", async (req, res) => {
    const run = await storage.getDepreciationRun(Number(req.params.id));
    if (!run || run.companyId !== cid(req)) return res.status(404).json({ message: "غير موجود" });
    const postings = await storage.getDepreciationPostings(run.id);
    res.json({ ...run, postings });
  });

  // Reverse a posted depreciation run + its journal entry, or refuse with 409
  // if the JE is referenced from another module. Mirrors the payroll-run
  // delete contract.
  app.delete("/api/depreciation-runs/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid id" });
      }
      const run = await storage.getDepreciationRun(id);
      if (!run || run.companyId !== cid(req)) {
        return res.status(404).json({ message: "غير موجود" });
      }
      await storage.deleteDepreciationRun(cid(req), id, userCtx(req));
      res.status(204).send();
    } catch (err: any) {
      if (err instanceof JournalEntryReferenceConflictError) {
        return res.status(409).json({ message: err.message });
      }
      res.status(500).json({ message: err?.message || "تعذر حذف دورة الإهلاك" });
    }
  });

  // Reverse an impairment / revaluation / disposal event + its journal entry
  // — same contract. We don't currently expose a per-asset event listing
  // route, so the lookup keys on (event id, active workspace company) and
  // 404s otherwise.
  async function deleteFixedAssetEvent(
    req: Request,
    res: Response,
    kind: "impairment" | "revaluation" | "disposal",
  ): Promise<void> {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) {
        res.status(400).json({ message: "Invalid id" });
        return;
      }
      const companyId = cid(req);
      const ctx = userCtx(req);
      // Cross-check ownership against the underlying event row.
      const events =
        kind === "impairment"
          ? await storage.getImpairmentEvents()
          : kind === "revaluation"
            ? await storage.getRevaluationEvents()
            : await storage.getDisposals();
      const owned = events.find((e) => e.id === id && e.companyId === companyId);
      if (!owned) {
        res.status(404).json({ message: "غير موجود" });
        return;
      }
      if (kind === "impairment") {
        await storage.deleteImpairmentEvent(companyId, id, ctx);
      } else if (kind === "revaluation") {
        await storage.deleteRevaluationEvent(companyId, id, ctx);
      } else {
        await storage.deleteDisposal(companyId, id, ctx);
      }
      res.status(204).send();
    } catch (err: any) {
      if (err instanceof JournalEntryReferenceConflictError) {
        res.status(409).json({ message: err.message });
        return;
      }
      // Task #208: legacy rows posted before migration 0015 don't carry an
      // `asset_balance_delta` snapshot, so a delete would silently leave the
      // asset row's balances stale. Refuse with 409 so the user repairs the
      // asset row by hand instead.
      if (err instanceof LegacyAssetEventBalanceMissingError) {
        res.status(409).json({ message: err.message });
        return;
      }
      // Task #209: refuse deletes when a later event of any kind exists on
      // the same asset, since the delta-rollback would invalidate that later
      // event's snapshot.
      if (err instanceof AssetEventLaterDependencyError) {
        res.status(409).json({ message: err.message });
        return;
      }
      res
        .status(500)
        .json({ message: err?.message || "تعذر حذف الحدث" });
    }
  }

  app.delete("/api/impairment-events/:id", (req, res) =>
    deleteFixedAssetEvent(req, res, "impairment"),
  );
  app.delete("/api/revaluation-events/:id", (req, res) =>
    deleteFixedAssetEvent(req, res, "revaluation"),
  );
  app.delete("/api/disposals/:id", (req, res) =>
    deleteFixedAssetEvent(req, res, "disposal"),
  );

  // Preview depreciation for a given month — returns per-asset amounts & totals.
  // companyId is derived from the active workspace; never accepted from the client.
  const depRunBodySchema = z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    // Optional per-asset/per-component units for units_of_production assets.
    usage: z.array(z.object({
      assetId: z.coerce.number().int().positive(),
      componentId: z.coerce.number().int().positive().optional().nullable(),
      units: z.coerce.number().nonnegative(),
    })).optional().default([]),
  });

  // The `usage[]` body of /api/depreciation-runs/{preview,post} carries
  // `assetId` and `componentId` from the client. We do NOT trust them as
  // a way to pull data — both handlers iterate over `getFixedAssets(cid)`
  // and `getAssetComponents(asset.id)` (workspace-scoped) and only consult
  // this map keyed by those server-derived ids. A foreign id from the body
  // simply never matches a key the loop ever queries, so it can't bleed
  // depreciation across tenants.
  function usageLookup(usage: Array<{ assetId: number; componentId?: number | null; units: number }>): (assetId: number, componentId?: number | null) => number {
    const map = new Map<string, number>();
    usage.forEach((u) => map.set(`${u.assetId}:${u.componentId ?? ""}`, u.units));
    return (assetId, componentId) => map.get(`${assetId}:${componentId ?? ""}`) ?? 0;
  }

  app.post("/api/depreciation-runs/preview", async (req, res) => {
    try {
      const body = depRunBodySchema.parse(req.body);
      const companyId = cid(req);
      const existing = await storage.findPostedRun(companyId, body.year, body.month);
      if (existing) {
        return res.status(409).json({ message: "تم ترحيل قيد إهلاك لهذا الشهر مسبقاً" });
      }
      const all = await storage.getFixedAssets(companyId);
      const cats = await storage.getAssetCategories(companyId);
      const catById = new Map(cats.map((c) => [c.id, c]));
      const usageOf = usageLookup(body.usage);
      const period: PeriodKey = { year: body.year, month: body.month };

      // Identify UoP units that lack provided usage so the UI can prompt for it
      const needsUsage: Array<{ assetId: number; componentId: number | null; assetName: string; method: string }> = [];

      const postings: { assetId: number; componentId?: number | null; amount: number; categoryId: number; assetName: string }[] = [];
      for (const a of all) {
        if (a.status !== "active") continue;
        const cat = catById.get(a.categoryId);
        if (!cat) continue;
        const comps = await storage.getAssetComponents(a.id);
        if (comps.length > 0) {
          for (const c of comps) {
            const u = fa.unitFromComponent(c, a.inServiceDate);
            const units = usageOf(a.id, c.id);
            if (u.method === "units_of_production" && units === 0) needsUsage.push({ assetId: a.id, componentId: c.id, assetName: `${a.name} / ${c.name}`, method: u.method });
            const amt = fa.depreciationForPeriod(u, period, units);
            if (amt > 0) postings.push({ assetId: a.id, componentId: c.id, amount: amt, categoryId: cat.id, assetName: `${a.name} / ${c.name}` });
          }
        } else {
          const u = fa.unitFromAsset(a);
          const units = usageOf(a.id, null);
          if (u.method === "units_of_production" && units === 0) needsUsage.push({ assetId: a.id, componentId: null, assetName: a.name, method: u.method });
          const amt = fa.depreciationForPeriod(u, period, units);
          if (amt > 0) postings.push({ assetId: a.id, amount: amt, categoryId: cat.id, assetName: a.name });
        }
      }
      const total = postings.reduce((s, p) => s + p.amount, 0);
      const byCategory = new Map<number, { categoryName: string; amount: number }>();
      postings.forEach((p) => {
        const cat = catById.get(p.categoryId)!;
        const cur = byCategory.get(p.categoryId) || { categoryName: cat.name, amount: 0 };
        cur.amount += p.amount;
        byCategory.set(p.categoryId, cur);
      });
      res.json({
        postings,
        total: Math.round(total * 100) / 100,
        byCategory: Array.from(byCategory.entries()).map(([categoryId, v]) => ({ categoryId, ...v })),
        needsUsage,
      });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: "تعذر توليد المعاينة" });
    }
  });

  // Confirm and post depreciation run -> creates JE
  app.post("/api/depreciation-runs/post", async (req, res) => {
    try {
      const body = depRunBodySchema.parse(req.body);
      const companyId = cid(req);

      const existing = await storage.findPostedRun(companyId, body.year, body.month);
      if (existing) return res.status(409).json({ message: "تم الترحيل مسبقاً لهذا الشهر" });

      const all = await storage.getFixedAssets(companyId);
      const cats = await storage.getAssetCategories(companyId);
      const catById = new Map(cats.map((c) => [c.id, c]));
      const usageOf = usageLookup(body.usage);

      type Posting = { assetId: number; componentId?: number | null; amount: number; noImpAmount: number; categoryId: number };
      const postings: Posting[] = [];
      const componentMap = new Map<number, AssetComponent[]>();
      const period: PeriodKey = { year: body.year, month: body.month };

      for (const a of all) {
        if (a.status !== "active") continue;
        const cat = catById.get(a.categoryId);
        if (!cat) continue;
        const comps = await storage.getAssetComponents(a.id);
        componentMap.set(a.id, comps);
        if (comps.length > 0) {
          for (const c of comps) {
            const u = fa.unitFromComponent(c, a.inServiceDate);
            const units = usageOf(a.id, c.id);
            if (u.method === "units_of_production" && units === 0) continue;
            const amt = fa.depreciationForPeriod(u, period, units);
            // Hypothetical depreciation if no impairment had happened (for IAS 36 cap)
            const noImpUnit = { ...u, accumDepreciation: Number(c.accumDepreciation), accumImpairment: 0 };
            const noImpAmt = fa.depreciationForPeriod(noImpUnit, period, units);
            if (amt > 0) postings.push({ assetId: a.id, componentId: c.id, amount: amt, noImpAmount: noImpAmt, categoryId: cat.id });
          }
        } else {
          const u = fa.unitFromAsset(a);
          const units = usageOf(a.id, null);
          if (u.method === "units_of_production" && units === 0) continue;
          const amt = fa.depreciationForPeriod(u, period, units);
          const noImpUnit = { ...u, accumDepreciation: Number(a.accumDepNoImpairment), accumImpairment: 0 };
          const noImpAmt = fa.depreciationForPeriod(noImpUnit, period, units);
          if (amt > 0) postings.push({ assetId: a.id, amount: amt, noImpAmount: noImpAmt, categoryId: cat.id });
        }
      }

      if (postings.length === 0) return res.status(400).json({ message: "لا يوجد إهلاك مستحق لهذا الشهر" });

      const byCat = new Map<number, { depExpenseAccountId: number; accumDepAccountId: number; amount: number }>();
      postings.forEach((p) => {
        const cat = catById.get(p.categoryId)!;
        const cur = byCat.get(p.categoryId) || { depExpenseAccountId: cat.depExpenseAccountId, accumDepAccountId: cat.accumulatedDepAccountId, amount: 0 };
        cur.amount += p.amount;
        byCat.set(p.categoryId, cur);
      });

      const periodStr = `${body.year}-${String(body.month).padStart(2, "0")}`;
      const built = fa.buildDepreciationJE(postings.reduce((s, p) => s + p.amount, 0), byCat, `إهلاك شهر ${periodStr}`);
      const je = await storage.createJournalEntry(cid(req), {
        description: built.description,
        entryDate: new Date(`${periodStr}-28`),
        source: "manual",
        lines: built.lines,
      }, userCtx(req));

      const run = await storage.createDepreciationRun({ companyId, year: body.year, month: body.month, postings });
      const posted = await storage.markRunPosted(run.id, je.id);
      await storage.markScheduledPosted(companyId, run.id, period, postings.map((p) => ({ assetId: p.assetId, componentId: p.componentId ?? null, amount: p.amount })));

      // Aggregate per-asset deltas before applying to DB (handles multi-component sums)
      type Delta = { accumDep: number; noImp: number };
      const assetDeltas = new Map<number, Delta>();
      for (const p of postings) {
        const cur = assetDeltas.get(p.assetId) || { accumDep: 0, noImp: 0 };
        cur.accumDep += p.amount;
        cur.noImp += p.noImpAmount;
        assetDeltas.set(p.assetId, cur);
        if (p.componentId) {
          const comps = componentMap.get(p.assetId) || [];
          const c = comps.find((x) => x.id === p.componentId);
          if (c) {
            await db.update(assetComponents).set({
              accumDepreciation: String(Number(c.accumDepreciation) + p.amount),
            }).where(eq(assetComponents.id, c.id));
          }
        }
      }
      for (const [assetId, d] of Array.from(assetDeltas.entries())) {
        const a = all.find((x) => x.id === assetId)!;
        await storage.updateFixedAssetBalances(a.id, {
          accumDepreciation: Number(a.accumDepreciation) + d.accumDep,
          accumDepNoImpairment: Number(a.accumDepNoImpairment) + d.noImp,
          lastDepreciatedPeriod: periodStr,
        }, userCtx(req));
      }
      res.status(201).json({ ...posted, journalEntryId: je.id });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      console.error(err);
      res.status(500).json({ message: err?.message || "تعذر ترحيل الإهلاك" });
    }
  });

  // Impairment
  app.post("/api/fixed-assets/:id/impairment", async (req, res) => {
    try {
      const asset = await loadOwnedAsset(req, res);
      if (!asset) return;
      const id = asset.id;
      const body = z.object({
        eventDate: z.string().min(1),
        recoverableAmount: z.coerce.number().nonnegative(),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const carrying = fa.carryingAmount({ cost: asset.cost, accumDepreciation: asset.accumDepreciation, accumImpairment: asset.accumImpairment });
      // IAS 36 cap: hypothetical carrying amount as if no impairment had ever been recorded.
      // We use the running counter `accumDepNoImpairment` (kept in sync by the depreciation
      // post handler). The hypothetical NBV cannot exceed (cost - accumDepNoImpairment).
      const hypoCarrying = Math.max(0, Number(asset.cost) - Number(asset.accumDepNoImpairment));
      let isReversal = false;
      let amount = 0;
      if (body.recoverableAmount < carrying) {
        amount = fa.impairmentLoss(carrying, body.recoverableAmount);
      } else if (body.recoverableAmount > carrying && Number(asset.accumImpairment) > 0) {
        amount = fa.impairmentReversal(carrying, body.recoverableAmount, hypoCarrying);
        isReversal = true;
      }
      const preview = {
        carrying, recoverableAmount: body.recoverableAmount, amount, isReversal,
        hypotheticalCarrying: hypoCarrying,
        reversalCap: Math.max(0, hypoCarrying - carrying),
        newCarrying: carrying + (isReversal ? amount : -amount),
      };
      if (!body.confirm) return res.json({ preview });

      if (amount <= 0.005) return res.status(400).json({ message: "لا يوجد فرق يتطلب قيد انخفاض" });
      const built = fa.buildImpairmentJE(cat, amount, isReversal, asset.name);
      const je = await storage.createJournalEntry(cid(req), {
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      }, userCtx(req));
      const signedDelta = isReversal ? -amount : amount;
      const newAccumImp = Number(asset.accumImpairment) + signedDelta;
      await storage.updateFixedAssetBalances(id, { accumImpairment: newAccumImp }, userCtx(req));

      // Propagate impairment to components proportionally to current carrying
      // amount, so that future component-level depreciation reflects the
      // impairment per IAS 36. If there are no components, the asset-level
      // accumImpairment alone is used by `unitFromAsset`.
      //
      // Track the per-component delta we actually applied (after the
      // non-negative clamp) so the matching delete can roll the same
      // amount back without going negative on the asset row either.
      const componentDeltas: Array<{ id: number; accumImpairment: number }> = [];
      const comps = await storage.getAssetComponents(id);
      if (comps.length > 0) {
        const carryings = comps.map((c) => Math.max(0, Number(c.cost) - Number(c.accumDepreciation) - Number(c.accumImpairment)));
        const totalCarry = carryings.reduce((s, v) => s + v, 0);
        if (totalCarry > 0.005) {
          let allocated = 0;
          for (let i = 0; i < comps.length; i++) {
            const c = comps[i];
            const isLast = i === comps.length - 1;
            const share = isLast ? signedDelta - allocated : Math.round((signedDelta * carryings[i] / totalCarry) * 100) / 100;
            allocated += share;
            const before = Number(c.accumImpairment);
            const nextImp = Math.max(0, before + share);
            const appliedDelta = nextImp - before;
            await db.update(assetComponents).set({ accumImpairment: String(nextImp) }).where(eq(assetComponents.id, c.id));
            if (appliedDelta !== 0) {
              componentDeltas.push({ id: c.id, accumImpairment: appliedDelta });
            }
          }
        }
      }

      // Snapshot the deltas we just applied so the matching DELETE route
      // can subtract them off precisely (task #157).
      const event = await storage.createImpairmentEvent({
        companyId: asset.companyId,
        assetId: id,
        eventDate: body.eventDate,
        recoverableAmount: body.recoverableAmount,
        lossAmount: isReversal ? -amount : amount,
        journalEntryId: je.id,
        notes: body.notes,
        assetBalanceDelta: {
          asset: { accumImpairment: signedDelta },
          components: componentDeltas,
        },
      });

      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر معالجة الانخفاض" });
    }
  });

  // Revaluation
  app.post("/api/fixed-assets/:id/revaluation", async (req, res) => {
    try {
      const asset = await loadOwnedAsset(req, res);
      if (!asset) return;
      const id = asset.id;
      const body = z.object({
        eventDate: z.string().min(1),
        fairValue: z.coerce.number().nonnegative(),
        method: z.enum(["elimination", "proportional"]).default("elimination"),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const result = fa.applyRevaluation(
        Number(asset.cost),
        Number(asset.accumDepreciation),
        Number(asset.accumImpairment),
        Number(asset.revalSurplus),
        Number(asset.accumRevalLoss),
        body.fairValue,
        body.method
      );
      const preview = {
        result,
        current: {
          cost: Number(asset.cost),
          accumDep: Number(asset.accumDepreciation),
          accumImp: Number(asset.accumImpairment),
          surplus: Number(asset.revalSurplus),
          priorPLLoss: Number(asset.accumRevalLoss),
        },
      };
      if (!body.confirm) return res.json({ preview });

      const built = fa.buildRevaluationJE(
        cat,
        asset,
        { cost: Number(asset.cost), accumDep: Number(asset.accumDepreciation), accumImp: Number(asset.accumImpairment) },
        { cost: result.newGrossCost, accumDep: result.newAccumDep, accumImp: result.newAccumImp },
        result.surplusDelta,
        result.plImpact,
      );
      const je = await storage.createJournalEntry(cid(req), {
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      }, userCtx(req));
      // Update accumulated P&L loss tracker:
      //  - downward revaluations with negative plImpact ADD to the running loss
      //  - upward revaluations that reverse part of that loss SUBTRACT from it
      const newAccumRevalLoss = Math.max(
        0,
        Number(asset.accumRevalLoss) - Math.max(0, result.plImpact) + Math.max(0, -result.plImpact),
      );
      const newRevalSurplus = Number(asset.revalSurplus) + result.surplusDelta;
      await storage.updateFixedAssetBalances(id, {
        cost: result.newGrossCost,
        accumDepreciation: result.newAccumDep,
        accumImpairment: result.newAccumImp,
        revalSurplus: newRevalSurplus,
        accumRevalLoss: newAccumRevalLoss,
      }, userCtx(req));
      // Snapshot the per-asset deltas so the DELETE route can roll the
      // asset row back precisely (task #157).
      const event = await storage.createRevaluationEvent({
        companyId: asset.companyId,
        assetId: id,
        eventDate: body.eventDate,
        fairValue: body.fairValue,
        method: body.method,
        surplusDelta: result.surplusDelta,
        plImpact: result.plImpact,
        journalEntryId: je.id,
        notes: body.notes,
        assetBalanceDelta: {
          asset: {
            cost: result.newGrossCost - Number(asset.cost),
            accumDepreciation: result.newAccumDep - Number(asset.accumDepreciation),
            accumImpairment: result.newAccumImp - Number(asset.accumImpairment),
            revalSurplus: result.surplusDelta,
            accumRevalLoss: newAccumRevalLoss - Number(asset.accumRevalLoss),
          },
        },
      });
      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر إعادة التقييم" });
    }
  });

  // Disposal
  app.post("/api/fixed-assets/:id/dispose", async (req, res) => {
    try {
      const asset = await loadOwnedAsset(req, res);
      if (!asset) return;
      const id = asset.id;
      const body = z.object({
        eventDate: z.string().min(1),
        proceeds: z.coerce.number().nonnegative().default(0),
        method: z.enum(["sale", "scrap", "writeoff"]).default("sale"),
        notes: z.string().max(500).optional().default(""),
        confirm: z.boolean().optional().default(false),
      }).parse(req.body);
      if (asset.status === "disposed") return res.status(400).json({ message: "تم استبعاد هذا الأصل مسبقاً" });
      const cat = (await storage.getAssetCategories(asset.companyId)).find((c) => c.id === asset.categoryId);
      if (!cat) return res.status(400).json({ message: "تصنيف غير موجود" });

      const cashAccountId = await resolveAccountId(asset.companyId, CASH_ACCOUNT_CODE);
      const reAccountId = await resolveAccountId(asset.companyId, RETAINED_EARNINGS_CODE);
      if (!cashAccountId || !reAccountId) return res.status(500).json({ message: "حساب النقدية أو الأرباح المحتجزة غير موجود" });

      const result = fa.computeDisposal(Number(asset.cost), Number(asset.accumDepreciation), Number(asset.accumImpairment), Number(asset.revalSurplus), body.proceeds);
      const preview = { result, carrying: Number(asset.cost) - Number(asset.accumDepreciation) - Number(asset.accumImpairment) };
      if (!body.confirm) return res.json({ preview });

      const built = fa.buildDisposalJE(cat, asset, Number(asset.cost), Number(asset.accumDepreciation), Number(asset.accumImpairment), body.proceeds, result, cashAccountId, reAccountId);
      const je = await storage.createJournalEntry(cid(req), {
        description: built.description,
        entryDate: new Date(body.eventDate),
        source: "manual",
        lines: built.lines,
      }, userCtx(req));
      await storage.updateFixedAssetBalances(id, {
        status: "disposed",
        revalSurplus: Number(asset.revalSurplus) - result.surplusTransferred,
      }, userCtx(req));
      // Snapshot the per-asset deltas so the DELETE route can roll the
      // asset row (status + surplus) back precisely (task #157).
      const event = await storage.createDisposal({
        companyId: asset.companyId,
        assetId: id,
        eventDate: body.eventDate,
        proceeds: body.proceeds,
        method: body.method,
        gainLoss: result.gainLoss,
        surplusTransferred: result.surplusTransferred,
        journalEntryId: je.id,
        notes: body.notes,
        assetBalanceDelta: {
          asset: {
            revalSurplus: -result.surplusTransferred,
            statusBefore: asset.status,
            statusAfter: "disposed",
          },
        },
      });
      res.status(201).json({ event, journalEntryId: je.id, preview });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
      res.status(500).json({ message: err?.message || "تعذر استبعاد الأصل" });
    }
  });
}
