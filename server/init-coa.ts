import { db } from "./db";
import { accounts, journalEntries, journalLines, transactions } from "@shared/schema";
import { DEFAULT_COA, CASH_ACCOUNT_CODE, pickExpenseAccountCode, pickRevenueAccountCode, PAYROLL_EXTRA_ACCOUNTS, FIXED_ASSETS_EXTRA_ACCOUNTS, FA_CATEGORY_DEFAULTS, FA_ACCUM_IMP_CODE, FA_DEP_EXPENSE_CODE, FA_IMP_LOSS_CODE, FA_REVAL_SURPLUS_CODE, FA_GAIN_LOSS_DISPOSAL_CODE } from "@shared/coa-seed";
import { companies, assetCategories } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

/**
 * Converge the chart of accounts to the canonical seed defined in
 * `@shared/coa-seed`. Idempotent and non-destructive to real data:
 *
 * 1. Any row whose `code` is in the canonical seed but whose name / type /
 *    subtype drifted (e.g. an older seed where 6110 meant "Depreciation
 *    Expense" but the new seed maps 6110 to "Social Insurance Expense") is
 *    UPDATED in place so a subsequent constant-by-code lookup lands on the
 *    semantically correct account.
 * 2. Any row whose `code` is NOT in the canonical seed is dropped — but
 *    only if it has no journal_lines, no asset_categories, and no child
 *    accounts pointing at it. Anything still referenced is left alone so
 *    historical postings stay valid.
 * 3. Any canonical code that does not yet exist in the table is inserted.
 *
 * The whole thing runs inside a single transaction so a partial converge
 * cannot leave the chart of accounts in a half-migrated state.
 */
/**
 * Returns true if the row carries *semantic* references — i.e. references
 * whose meaning would silently change if we relabeled the row.
 *
 * Journal lines and asset_category FK columns count: those rows post real
 * money against this account id, so renaming the row from e.g. "Depreciation
 * Expense" to "Social Insurance Expense" would corrupt the books.
 *
 * Child accounts (`accounts.parent_id`) do NOT count: a child pointing at
 * its parent by id is a structural link, not a semantic one. Renaming a
 * drifted header in place is exactly what we want — the children stay
 * correctly attached and the canonical name reaches the UI.
 */
async function rowIsReferenced(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  accountId: number,
): Promise<boolean> {
  const [{ c: jl }] = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(journalLines)
    .where(eq(journalLines.accountId, accountId));
  if (jl > 0) return true;

  const acColumns = [
    assetCategories.assetCostAccountId,
    assetCategories.accumulatedDepAccountId,
    assetCategories.depExpenseAccountId,
    assetCategories.accumulatedImpAccountId,
    assetCategories.impLossAccountId,
    assetCategories.revalSurplusAccountId,
    assetCategories.gainLossDisposalAccountId,
  ];
  for (const col of acColumns) {
    const [{ c }] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(assetCategories)
      .where(eq(col, accountId));
    if (c > 0) return true;
  }

  return false;
}

/**
 * Seed body for the IFRS-aligned default chart of accounts. Runs against an
 * already-open transaction so a caller (workspace creation) can compose it
 * with `companies` + `settings` writes inside one atomic unit — meaning a
 * workspace either commits with its full chart of accounts or commits with
 * nothing, never half-bootstrapped.
 *
 * See `seedDefaultCoaForCompany` below for the high-level idempotency
 * contract. The two share the exact same body; the only difference is who
 * owns the transaction.
 */
export async function seedDefaultCoaInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
): Promise<void> {
  const allSeed = [...DEFAULT_COA, ...PAYROLL_EXTRA_ACCOUNTS, ...FIXED_ASSETS_EXTRA_ACCOUNTS];
  const seedByCode = new Map(allSeed.map((s) => [s.code, s]));

  {
    const fullExisting = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.companyId, companyId));
    const existingByCode = new Map(fullExisting.map((a) => [a.code, a] as const));

    // (1) Reconcile drift on any seed code that already exists with stale
    // name/type/subtype/header flag.
    //
    // If the existing row is *unreferenced* (no journal lines, no asset
    // categories, no children), we update it in place — its id is purely
    // cosmetic.
    //
    // If it IS referenced, we cannot safely rewrite its name/type, because
    // every existing reference (e.g. an asset_category's depExpenseAccountId
    // or a journal line) would silently start meaning something different.
    // In that case we renumber the legacy row out of the canonical band
    // (suffixing its code with `_legacy`) so the fresh insert in step (3)
    // can take over the canonical code without touching prior bookings.
    const renamedLegacyIds = new Set<number>();
    for (const [code, seed] of seedByCode) {
      const row = existingByCode.get(code);
      if (!row) continue;
      const headerFlag = ("isHeader" in seed ? seed.isHeader : false) ?? false;
      const drifted =
        row.nameAr !== seed.nameAr ||
        row.nameEn !== seed.nameEn ||
        row.type !== seed.type ||
        row.subtype !== seed.subtype ||
        row.isHeader !== headerFlag;
      if (!drifted) continue;

      const isReferenced = await rowIsReferenced(tx, row.id);
      if (!isReferenced) {
        await tx
          .update(accounts)
          .set({
            nameAr: seed.nameAr,
            nameEn: seed.nameEn,
            type: seed.type,
            subtype: seed.subtype,
            isHeader: headerFlag,
          })
          .where(eq(accounts.id, row.id));
      } else {
        // Suffix the code so the fresh insert in step (3) doesn't collide
        // on the per-workspace UNIQUE on (company_id, code). The row keeps
        // its id and every downstream reference still resolves to the same
        // semantics it had before this boot.
        let legacyCode = `${row.code}_legacy`;
        // In the unlikely event _legacy already exists too, append a
        // counter so we never lose a row to a unique-violation.
        let n = 2;
        while (existingByCode.has(legacyCode)) {
          legacyCode = `${row.code}_legacy${n++}`;
        }
        await tx
          .update(accounts)
          .set({ code: legacyCode })
          .where(eq(accounts.id, row.id));
        existingByCode.delete(row.code);
        existingByCode.set(legacyCode, { ...row, code: legacyCode });
        renamedLegacyIds.add(row.id);
      }
    }

    // (2) Drop accounts in this workspace whose code is not in the
    // canonical seed AND that nothing references — keeps the COA tree
    // tidy without ever touching data the books depend on.
    const orphanCandidates = fullExisting.filter((a) => !seedByCode.has(a.code));
    if (orphanCandidates.length > 0) {
      const orphanIds = orphanCandidates.map((a) => a.id);
      const referenced = new Set<number>();

      const jlRefs = await tx
        .select({ accountId: journalLines.accountId })
        .from(journalLines)
        .where(inArray(journalLines.accountId, orphanIds));
      jlRefs.forEach((r) => referenced.add(r.accountId));

      // Asset categories reference accounts via a half-dozen FK columns —
      // one targeted query per column is the simplest portable form.
      const acColumns = [
        assetCategories.assetCostAccountId,
        assetCategories.accumulatedDepAccountId,
        assetCategories.depExpenseAccountId,
        assetCategories.accumulatedImpAccountId,
        assetCategories.impLossAccountId,
        assetCategories.revalSurplusAccountId,
        assetCategories.gainLossDisposalAccountId,
      ];
      for (const col of acColumns) {
        const rows = await tx
          .select({ id: col })
          .from(assetCategories)
          .where(inArray(col, orphanIds));
        for (const r of rows) {
          if (r.id != null) referenced.add(r.id);
        }
      }

      // Children that haven't been deleted yet still need their parent.
      const childRefs = await tx
        .select({ parentId: accounts.parentId })
        .from(accounts)
        .where(inArray(accounts.parentId, orphanIds));
      childRefs.forEach((r) => r.parentId != null && referenced.add(r.parentId));

      const droppable = orphanCandidates.filter((a) => !referenced.has(a.id));
      if (droppable.length > 0) {
        // Delete in ascending depth order so a parent isn't yanked while a
        // child still points at it. Sort by parent_id NULLs last is a good
        // proxy: leaves first, then headers.
        droppable.sort((a, b) => Number(b.parentId != null) - Number(a.parentId != null));
        for (const row of droppable) {
          await tx.delete(accounts).where(eq(accounts.id, row.id));
        }
      }
    }

    // (3) Insert anything from the canonical seed that still isn't present
    // in this workspace. Reload after the converge/drop steps so parent
    // ids are accurate.
    const refreshed = await tx
      .select()
      .from(accounts)
      .where(eq(accounts.companyId, companyId));
    const codeToId = new Map<string, number>(refreshed.map((a) => [a.code, a.id]));

    for (const seed of allSeed) {
      if (codeToId.has(seed.code)) continue;
      const parentId = seed.parentCode ? codeToId.get(seed.parentCode) ?? null : null;
      const [created] = await tx
        .insert(accounts)
        .values({
          companyId,
          code: seed.code,
          nameAr: seed.nameAr,
          nameEn: seed.nameEn,
          type: seed.type,
          subtype: seed.subtype,
          parentId: parentId ?? undefined,
          isHeader: ("isHeader" in seed ? seed.isHeader : false) ?? false,
        })
        .returning();
      codeToId.set(created.code, created.id);
    }
  }
}

/**
 * Seed (or top up) the IFRS-aligned default chart of accounts for a single
 * workspace, while reconciling drift on any seed code that already exists
 * with a stale name / type / subtype / header flag.
 *
 * Idempotent and non-destructive to real data:
 *
 *   1. Any row in this workspace whose `code` is in the canonical seed but
 *      whose name / type / subtype / header flag drifted is UPDATED in
 *      place when nothing references it. If it IS referenced (journal
 *      lines, asset_category FKs, child accounts), the row is renumbered
 *      out of the canonical band (suffixing its code with `_legacy`) so a
 *      fresh insert in step (3) can take over the canonical code without
 *      touching prior bookings.
 *   2. Any row in this workspace whose `code` is NOT in the canonical seed
 *      is dropped — but only if nothing references it.
 *   3. Any canonical code missing from this workspace is inserted, with
 *      `companyId` set so the composite (company_id, code) UNIQUE
 *      constraint is satisfied. Parent → child links are kept correct
 *      because each insert immediately registers its new id in `codeToId`
 *      before any later seed row references it as a parent.
 *
 * Standalone wrapper that opens its own transaction. New-workspace flows
 * compose `seedDefaultCoaInTx` directly into the workspace-creation
 * transaction so the workspace + its CoA commit (or roll back) together.
 */
export async function seedDefaultCoaForCompany(companyId: number): Promise<void> {
  await db.transaction((tx) => seedDefaultCoaInTx(tx, companyId));
}

export async function initChartOfAccounts(): Promise<void> {
  // Bootstrap path: seed the CoA for every existing workspace that doesn't
  // already have one. New workspaces get their CoA at creation time via
  // `seedDefaultCoaForCompany` directly — see `storage.createCompany` and
  // `auth/storage.createCompanyForOwner`.
  const existingCompanies = await db.select({ id: companies.id }).from(companies);
  for (const c of existingCompanies) {
    await seedDefaultCoaForCompany(c.id);
  }
}

/**
 * Backfill: any existing transaction without a corresponding journal entry
 * gets one auto-generated against the default cash and category-mapped account.
 *
 * Account lookups are scoped per workspace: a transaction in company 13 can
 * only ever reference an account that lives in company 13. If a workspace
 * hasn't had its chart of accounts seeded yet (no cash account on file), the
 * transaction is left for that workspace's bootstrap to handle later — it is
 * never paired with another workspace's account. This is enforced by the
 * composite (id, company_id) foreign keys on `journal_lines`, but doing it
 * explicitly here keeps the boot path noise-free.
 *
 * Two callers:
 *   1. Boot path (`ensureIfrsBootstrap`) — passes no filter, sweeps every
 *      workspace under `withRlsBypass`.
 *   2. Admin route (`POST /api/admin/backfill-journal-entries`) — passes the
 *      caller's active `companyId` so an owner can fix only their own
 *      backlog after a future regression, without needing cross-tenant
 *      privileges.
 *
 * JE references are numbered per-workspace (matching `nextJournalReference`
 * in `storage.ts`), so a backfilled JE slots cleanly into the workspace's
 * existing JE-NNNNN sequence instead of inheriting a global counter that
 * would skip ahead by other workspaces' JE counts.
 *
 * Returns `{ created, skipped }` so callers can report how many orphan
 * transactions were paired with a JE versus left untouched (workspace not
 * seeded yet, or fallback account also missing).
 */
export async function backfillJournalForLegacyTransactions(
  companyIdFilter?: number,
): Promise<{ created: number; skipped: number }> {
  const allAccounts =
    companyIdFilter !== undefined
      ? await db.select().from(accounts).where(eq(accounts.companyId, companyIdFilter))
      : await db.select().from(accounts);
  // companyId -> (code -> account.id), so we never cross workspace boundaries.
  const codeToIdByCompany = new Map<number, Map<string, number>>();
  for (const a of allAccounts) {
    let m = codeToIdByCompany.get(a.companyId);
    if (!m) {
      m = new Map();
      codeToIdByCompany.set(a.companyId, m);
    }
    m.set(a.code, a.id);
  }

  const allTx =
    companyIdFilter !== undefined
      ? await db
          .select()
          .from(transactions)
          .where(eq(transactions.companyId, companyIdFilter))
      : await db.select().from(transactions);

  // Restrict the "already covered" set to the same scope so a per-workspace
  // call doesn't scan global JE rows it has no reason to touch.
  const coveredWhere =
    companyIdFilter !== undefined
      ? and(
          sql`${journalEntries.sourceTransactionId} is not null`,
          eq(journalEntries.companyId, companyIdFilter),
        )
      : sql`${journalEntries.sourceTransactionId} is not null`;
  const existingJEs = await db
    .select({ src: journalEntries.sourceTransactionId })
    .from(journalEntries)
    .where(coveredWhere);
  const covered = new Set(existingJEs.map((j) => j.src));

  // Per-workspace JE reference counter, lazily seeded from the existing
  // JE count in that workspace so a backfilled JE continues the workspace's
  // own JE-NNNNN sequence (mirrors `nextJournalReference` in storage.ts).
  const counters = new Map<number, number>();
  const nextRef = async (companyId: number): Promise<string> => {
    let c = counters.get(companyId);
    if (c === undefined) {
      const [{ c: existing }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(journalEntries)
        .where(eq(journalEntries.companyId, companyId));
      c = existing ?? 0;
    }
    c += 1;
    counters.set(companyId, c);
    return `JE-${String(c).padStart(5, "0")}`;
  };

  let created = 0;
  let skipped = 0;

  for (const tx of allTx) {
    if (covered.has(tx.id)) continue;

    const codeToId = codeToIdByCompany.get(tx.companyId);
    const cashId = codeToId?.get(CASH_ACCOUNT_CODE);
    // Skip transactions whose workspace has no chart of accounts seeded yet
    // rather than borrow another workspace's accounts.
    if (!codeToId || !cashId) {
      skipped += 1;
      continue;
    }

    let dr: number | undefined;
    let cr: number | undefined;
    if (tx.type === "income") {
      dr = cashId;
      cr = codeToId.get(pickRevenueAccountCode(tx.category, tx.description)) ?? codeToId.get("4100");
    } else {
      dr = codeToId.get(pickExpenseAccountCode(tx.category, tx.description)) ?? codeToId.get("6900");
      cr = cashId;
    }
    if (!dr || !cr) {
      skipped += 1;
      continue;
    }

    const ref = await nextRef(tx.companyId);
    const amt = Number(tx.amount);

    const [je] = await db
      .insert(journalEntries)
      .values({
        companyId: tx.companyId,
        reference: ref,
        entryDate: tx.date ?? new Date(),
        description: tx.description,
        source: "transaction",
        sourceTransactionId: tx.id,
      })
      .returning();

    await db.insert(journalLines).values([
      { companyId: tx.companyId, journalEntryId: je.id, accountId: dr, debit: amt.toFixed(2), credit: "0", description: tx.description },
      { companyId: tx.companyId, journalEntryId: je.id, accountId: cr, debit: "0", credit: amt.toFixed(2), description: tx.description },
    ]);

    created += 1;
  }

  return { created, skipped };
}

export async function ensureDefaultCompanyAndCategories(): Promise<void> {
  const existingCompanies = await db.select().from(companies);
  let companyId: number;
  if (existingCompanies.length === 0) {
    const [created] = await db
      .insert(companies)
      .values({ name: "Default Company", functionalCurrency: "USD", currencySymbol: "$", isDefault: true, isActive: true })
      .returning();
    companyId = created.id;
  } else {
    companyId = (existingCompanies.find((c) => c.isDefault) ?? existingCompanies[0]).id;
  }

  const existingCats = await db.select().from(assetCategories).where(eq(assetCategories.companyId, companyId));
  if (existingCats.length > 0) return;

  const allAccounts = await db.select().from(accounts);
  const codeToId = new Map(allAccounts.map((a) => [a.code, a.id]));
  const get = (code: string) => codeToId.get(code);

  const depExpense = get(FA_DEP_EXPENSE_CODE);
  const accumImp = get(FA_ACCUM_IMP_CODE);
  const impLoss = get(FA_IMP_LOSS_CODE);
  const revalSurplus = get(FA_REVAL_SURPLUS_CODE);
  const gainLoss = get(FA_GAIN_LOSS_DISPOSAL_CODE);
  if (!depExpense || !accumImp || !impLoss || !revalSurplus || !gainLoss) return;

  for (const def of FA_CATEGORY_DEFAULTS) {
    const cost = get(def.assetCostCode);
    const accDep = get(def.accumDepCode);
    if (!cost || !accDep) continue;
    await db.insert(assetCategories).values({
      companyId,
      name: def.name,
      measurementModel: "cost",
      defaultUsefulLifeMonths: def.defaultUsefulLifeMonths,
      defaultMethod: "straight_line",
      assetCostAccountId: cost,
      accumulatedDepAccountId: accDep,
      depExpenseAccountId: depExpense,
      accumulatedImpAccountId: accumImp,
      impLossAccountId: impLoss,
      revalSurplusAccountId: revalSurplus,
      gainLossDisposalAccountId: gainLoss,
    });
  }
}

export async function ensureIfrsBootstrap(): Promise<void> {
  await initChartOfAccounts();
  await backfillJournalForLegacyTransactions();
  await ensureDefaultCompanyAndCategories();
}
