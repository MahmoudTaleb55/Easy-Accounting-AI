import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import pg from "pg";
// @ts-ignore — express-session ships these without bundled types
import cookieSignature from "cookie-signature";
// @ts-ignore
import uidSafe from "uid-safe";
import type { Page } from "@playwright/test";

/**
 * Shared end-to-end auth + session-forging helpers.
 *
 * Background — why we forge sessions instead of signing in for real:
 *   • The signup endpoint is rate-limited (8/hour/IP). Re-signing-up on
 *     every test run would flake.
 *   • The dev server's `connect.sid` cookie is `Secure`, which a browser
 *     refuses to retain over plain HTTP. We sidestep that by inserting the
 *     session row ourselves (matching express-session's `connect-pg-simple`
 *     schema) and signing the cookie with the same `SESSION_SECRET` the
 *     server uses, then planting the signed cookie as non-Secure into the
 *     browser context.
 *
 * Each helper is intentionally narrow so a per-suite setup file owns
 * the seed data unique to its spec while sharing the auth machinery.
 */

const COOKIE_SECRET =
  process.env.SESSION_SECRET || process.env.WM_COOKIE_SECRET;

export function requireDbUrl(context: string): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error(`DATABASE_URL must be set for ${context}.`);
  return dbUrl;
}

export function requireCookieSecret(context: string): string {
  if (!COOKIE_SECRET) {
    throw new Error(
      `SESSION_SECRET (or WM_COOKIE_SECRET) must be set for ${context} ` +
        `to sign the connect.sid cookie.`,
    );
  }
  return COOKIE_SECRET;
}

export interface EnsureUserOptions {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Insert (or refresh) a known test user with a bcrypt password hash.
 * Returns the user id. Idempotent across runs.
 */
export async function ensureUser(
  client: pg.Client,
  opts: EnsureUserOptions,
): Promise<string> {
  const passwordHash = await bcrypt.hash(opts.password, 10);
  const existing = (
    await client.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [
      opts.email,
    ])
  ).rows[0];
  if (existing) {
    await client.query(
      `UPDATE users SET password_hash=$1, first_name=$2, last_name=$3 WHERE id=$4`,
      [passwordHash, opts.firstName, opts.lastName, existing.id],
    );
    return existing.id as string;
  }
  const userId = crypto.randomUUID();
  await client.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, preferred_locale)
     VALUES ($1, $2, $3, $4, $5, 'en')`,
    [userId, opts.email, passwordHash, opts.firstName, opts.lastName],
  );
  return userId;
}

export interface EnsureCompanyOptions {
  userId: string;
  /**
   * Membership role to look up + insert. Defaults to `'owner'`, which is
   * the canonical role after `unifyRoleEnumOnStartup` runs. Pass an
   * alternate role for legacy seeds that haven't been migrated.
   */
  role?: string;
  /** Name to use when creating a fresh company. */
  companyName: string;
  /**
   * If `true`, attempt to adopt an orphan (`owner_user_id IS NULL`)
   * company before creating a fresh one. Some suites want to re-use
   * pre-existing seed companies; others want a clean fresh row.
   */
  adoptOrphan?: boolean;
}

/**
 * Ensure the user owns at least one workspace via the `memberships`
 * table — that single canonical row is what the server reads to derive
 * role on every request. Returns the company id.
 */
export async function ensureCompany(
  client: pg.Client,
  opts: EnsureCompanyOptions,
): Promise<number> {
  const role = opts.role ?? "owner";
  let companyRow = (
    await client.query(
      `SELECT c.id FROM memberships m
       JOIN companies c ON c.id = m.company_id
       WHERE m.user_id = $1 AND m.role = $2
       ORDER BY m.created_at ASC LIMIT 1`,
      [opts.userId, role],
    )
  ).rows[0];

  if (!companyRow) {
    if (opts.adoptOrphan) {
      const orphan = (
        await client.query(
          `SELECT id FROM companies WHERE owner_user_id IS NULL ORDER BY id ASC LIMIT 1`,
        )
      ).rows[0];
      if (orphan) {
        await client.query(
          `UPDATE companies SET owner_user_id=$1 WHERE id=$2`,
          [opts.userId, orphan.id],
        );
        companyRow = orphan;
      }
    }
    if (!companyRow) {
      companyRow = (
        await client.query(
          `INSERT INTO companies (name, owner_user_id, functional_currency, currency_symbol, is_default)
           VALUES ($1, $2, 'USD', '$', true)
           RETURNING id`,
          [opts.companyName, opts.userId],
        )
      ).rows[0];
    }
    await client.query(
      `INSERT INTO memberships (id, user_id, company_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), opts.userId, companyRow.id, role],
    );
  }
  return Number(companyRow.id);
}

export interface ForgeSessionOptions {
  page: Page;
  dbUrl: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  /**
   * Where to write the resulting `storageState` JSON. Optional — when
   * omitted (e.g. for an inline forge inside a `*.spec.ts` that doesn't
   * share state across tests) the cookies are still planted into the
   * page's browser context but no file is written.
   */
  storagePath?: string;
  /**
   * Optional override for the local server origin used when planting the
   * cookie. Defaults to `http://127.0.0.1:${PORT||5000}`.
   */
  baseURL?: string;
  /**
   * Optional hook invoked after the cookie is planted but before
   * `/api/auth/user` is verified. Lets a suite, e.g., navigate to the
   * app and pre-seed `localStorage` (such as `active_company_id`) so
   * that the very first authenticated render uses the right scope.
   */
  afterCookiesPlanted?: (page: Page) => Promise<void>;
}

/**
 * Forge a passport session row, sign the matching `connect.sid` cookie,
 * plant it into the browser context, verify `/api/auth/user` returns
 * 200, and persist the resulting storage state to `storagePath`.
 *
 * Opens its own short-lived pg connection for the session insert so the
 * caller can close their seed connection before invoking this.
 */
export async function forgeSession(opts: ForgeSessionOptions): Promise<void> {
  const cookieSecret = requireCookieSecret("forgeSession");

  const sessionId = await uidSafe(24);
  const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;
  const sessionExpire = new Date(Date.now() + sessionTtlMs);
  const sessionPayload = {
    cookie: {
      originalMaxAge: sessionTtlMs,
      expires: sessionExpire.toISOString(),
      httpOnly: true,
      path: "/",
      secure: true,
    },
    passport: {
      user: {
        _local: true,
        claims: {
          sub: opts.userId,
          email: opts.email,
          first_name: opts.firstName,
          last_name: opts.lastName,
          profile_image_url: null,
        },
      },
    },
  };

  const sessionClient = new pg.Client({ connectionString: opts.dbUrl });
  await sessionClient.connect();
  try {
    await sessionClient.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sessionId, JSON.stringify(sessionPayload), sessionExpire],
    );
  } finally {
    await sessionClient.end();
  }

  const signedSid = "s:" + cookieSignature.sign(sessionId, cookieSecret);
  const baseURL =
    opts.baseURL ?? `http://127.0.0.1:${process.env.PORT || "5000"}`;

  await opts.page.context().addCookies([
    {
      name: "connect.sid",
      value: signedSid,
      url: baseURL,
      // Stored as non-Secure so the local HTTP test server still
      // receives it — the server only enforces Secure on the *outbound*
      // Set-Cookie, not on inbound requests.
      sameSite: "Lax",
    },
  ]);

  if (opts.afterCookiesPlanted) {
    await opts.afterCookiesPlanted(opts.page);
  }

  const me = await opts.page.request.get("/api/auth/user");
  if (me.status() !== 200) {
    const cookies = await opts.page.context().cookies();
    throw new Error(
      `Expected /api/auth/user to be 200 after session injection but got ${me.status()}.\n` +
        `userId=${opts.userId} sid=${sessionId}\n` +
        `Context cookies: ${JSON.stringify(cookies)}\n` +
        `Body: ${await me.text()}`,
    );
  }

  if (opts.storagePath) {
    fs.mkdirSync(path.dirname(opts.storagePath), { recursive: true });
    await opts.page.context().storageState({ path: opts.storagePath });
  }
}
