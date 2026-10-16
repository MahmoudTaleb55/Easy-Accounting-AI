import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * H-1 regression (scan-078393cf, SESSION_TOKEN_VULNERABILITIES): session
 * revocation must actually delete rows.
 *
 * The passport session stores the user as { id, email, provider, ... } at
 * sess.passport.user.id. The pre-fix queries matched on `_uid` / `claims.sub`
 * (dead legacy `claims.sub` shape), so deleteSessionsForUserExcept matched ZERO rows —
 * password-reset, change-password and "sign out other sessions" silently
 * revoked nothing, and listSessionsForUser showed nothing.
 *
 * This test seeds real-shaped session rows directly, then drives the storage
 * methods and asserts the right rows are listed / deleted / kept.
 *
 * Gated on DATABASE_URL; skips cleanly otherwise.
 */

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const TAG = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const USER_ID = `user-${TAG}`;
const OTHER_USER_ID = `other-${TAG}`;

let authBizStorage: typeof import("../auth/storage").authBizStorage;
let pgc: pg.Client;

const SID_A = `sidA-${TAG}`;
const SID_B = `sidB-${TAG}`;
const SID_OTHER = `sidOther-${TAG}`;

async function seedSession(sid: string, userId: string) {
  const sess = {
    cookie: { originalMaxAge: 86400000, httpOnly: true, path: "/", secure: false },
    passport: { user: { id: userId, email: `${userId}@test.local`, provider: "local" } },
  };
  const expire = new Date(Date.now() + 86400000);
  await pgc.query(
    `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::json, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [sid, JSON.stringify(sess), expire],
  );
}

async function sidExists(sid: string): Promise<boolean> {
  const r = await pgc.query(`SELECT 1 FROM sessions WHERE sid = $1`, [sid]);
  return r.rowCount! > 0;
}

beforeAll(async () => {
  if (!HAS_DB) return;
  ({ authBizStorage } = await import("../auth/storage"));
  pgc = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgc.connect();
  await pgc.query(`SET app.rls_bypass = 'on'`);
});

afterAll(async () => {
  if (!HAS_DB) return;
  await pgc
    .query(`DELETE FROM sessions WHERE sid IN ($1,$2,$3)`, [SID_A, SID_B, SID_OTHER])
    .catch(() => undefined);
  await pgc.end().catch(() => {});
});

d("session revocation actually deletes rows (H-1)", () => {
  it("listSessionsForUser finds the user's real-shaped sessions", async () => {
    await seedSession(SID_A, USER_ID);
    await seedSession(SID_B, USER_ID);
    await seedSession(SID_OTHER, OTHER_USER_ID);

    const rows = await authBizStorage.listSessionsForUser(USER_ID);
    const sids = rows.map((r: any) => r.sid);
    expect(sids).toContain(SID_A);
    expect(sids).toContain(SID_B);
    expect(sids).not.toContain(SID_OTHER); // belongs to a different user
  });

  it("deleteSessionsForUserExcept keeps the current session, deletes the rest", async () => {
    await seedSession(SID_A, USER_ID);
    await seedSession(SID_B, USER_ID);

    await authBizStorage.deleteSessionsForUserExcept(USER_ID, SID_A);

    expect(await sidExists(SID_A)).toBe(true); // kept (current)
    expect(await sidExists(SID_B)).toBe(false); // revoked
  });

  it("deleteSessionsForUserExcept with no keepSid revokes ALL the user's sessions", async () => {
    await seedSession(SID_A, USER_ID);
    await seedSession(SID_B, USER_ID);
    await seedSession(SID_OTHER, OTHER_USER_ID);

    await authBizStorage.deleteSessionsForUserExcept(USER_ID);

    expect(await sidExists(SID_A)).toBe(false);
    expect(await sidExists(SID_B)).toBe(false);
    // Another user's session must be untouched.
    expect(await sidExists(SID_OTHER)).toBe(true);
  });
});
