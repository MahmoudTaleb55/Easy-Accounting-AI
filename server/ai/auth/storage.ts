import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db, withUnscopedDb } from "../../db";
import { eq } from "drizzle-orm";

export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  // Returns null when the OAuth login must be refused (e.g. the email already
  // belongs to a local-password account) — the caller fails the login.
  upsertUser(user: UpsertUser): Promise<User | null>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    return withUnscopedDb(
      "auth: lookup user by id before any workspace membership is known",
      async () => {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user;
      },
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return withUnscopedDb(
      "auth: lookup user by email before any workspace membership is known",
      async () => {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        return user;
      },
    );
  }

  /**
   * Upsert a user row from an OAuth callback. Conflicts on `email` so that:
   *   - A repeat OAuth login updates the display fields of the existing row.
   *   - A local user who signs in with OAuth (same email) merges into their
   *     existing account instead of creating a duplicate.
   *
   * Deliberately does NOT overwrite `passwordHash` or `preferredLocale` —
   * those belong to the user's own settings and must not be clobbered by
   * provider claims on every sign-in.
   */
  async upsertUser(userData: UpsertUser): Promise<User | null> {
    return withUnscopedDb(
      "auth: upsert user from OAuth claims before any workspace membership exists",
      async () => {
        // An OAuth upsert without an email cannot be matched to an identity.
        // (upsertOAuthUser already guards !email, but the UpsertUser type
        // allows null/undefined, so narrow it here before the lookup.)
        if (!userData.email) return null;
        // SECURITY (scan finding, AUTHENTICATION_BYPASS): do not silently
        // merge an OAuth login into a pre-existing LOCAL password account.
        // Blindly conflicting on email let an OAuth account take over a
        // local-password user with the same address. Look the row up first:
        //   - no existing row            → create the OAuth user.
        //   - existing row, no password  → safe to update display fields and
        //                                    stamp the provider (pure OAuth acct).
        //   - existing row WITH password → refuse auto-link (return null); the
        //                                    user must sign in with their
        //                                    password (and link OAuth from a
        //                                    settings flow in the future).
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, userData.email));

        if (existing) {
          if (existing.passwordHash) {
            // A local-password account already owns this email. Refuse.
            return null;
          }
          const [updated] = await db
            .update(users)
            .set({
              firstName: userData.firstName,
              lastName: userData.lastName,
              profileImageUrl: userData.profileImageUrl,
              provider: userData.provider,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existing.id))
            .returning();
          return updated;
        }

        const [created] = await db.insert(users).values(userData).returning();
        return created;
      },
    );
  }
}

export const authStorage = new AuthStorage();