/**
 * OAuth 2.0 / OIDC integrations for Google and Microsoft.
 *
 * Provides "Sign in with Google" and "Sign in with Microsoft" alongside
 * the primary local (email + password) auth. Both flows land in the same
 * passport session so downstream middleware (rbacMiddleware, etc.) is
 * provider-agnostic.
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID        — from Google Cloud Console (OAuth 2.0 credentials)
 *   GOOGLE_CLIENT_SECRET    — from Google Cloud Console
 *   MICROSOFT_CLIENT_ID     — from Azure AD app registration
 *   MICROSOFT_CLIENT_SECRET — from Azure AD app registration
 *   APP_URL                 — public base URL, e.g. https://app.example.com
 *                             (used to build callback URLs; defaults to
 *                             http://localhost:5000 when absent)
 *
 * Either provider is silently skipped when its env vars are absent, so
 * local-only deployments work without any OAuth config.
 */
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import { authStorage } from "./storage";
import type { User } from "@shared/models/auth";

// ---------------------------------------------------------------------------
// Provider discovery (memoised — one OIDC discovery request per hour)
// ---------------------------------------------------------------------------

const getGoogleConfig = memoize(
  async () => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return null;
    }
    return await client.discovery(
      new URL("https://accounts.google.com"),
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
  },
  { maxAge: 3600 * 1000 },
);

const getMicrosoftConfig = memoize(
  async () => {
    if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
      return null;
    }
    // "common" tenant accepts both personal and work/school accounts.
    return await client.discovery(
      new URL("https://login.microsoftonline.com/common/v2.0"),
      process.env.MICROSOFT_CLIENT_ID,
      process.env.MICROSOFT_CLIENT_SECRET,
    );
  },
  { maxAge: 3600 * 1000 },
);

// ---------------------------------------------------------------------------
// Claim mappers — normalise provider-specific shapes to our users schema
// ---------------------------------------------------------------------------

function mapGoogleClaims(claims: Record<string, unknown>) {
  return {
    email: claims["email"] as string | undefined,
    // Google asserts email_verified (boolean, sometimes serialized as the
    // string "true"). We only trust the email for account identity/linking
    // when the provider says it is verified — otherwise a provider account
    // with an arbitrary unverified email could claim someone else's identity.
    emailVerified:
      claims["email_verified"] === true || claims["email_verified"] === "true",
    firstName: (claims["given_name"] ?? null) as string | null,
    lastName: (claims["family_name"] ?? null) as string | null,
    profileImageUrl: (claims["picture"] ?? null) as string | null,
    provider: "google" as const,
  };
}

function mapMicrosoftClaims(claims: Record<string, unknown>) {
  // Microsoft Entra ID does NOT emit a reliable `email_verified` claim for
  // the v2.0 "common" tenant, and `preferred_username` is a UPN, not a
  // verified email. Only treat the address as verified when the `email`
  // claim is present AND an explicit verification signal is set; otherwise
  // leave it unverified so the upsert refuses to auto-link into an existing
  // local-password account.
  const explicitEmail = claims["email"] as string | undefined;
  return {
    email: (explicitEmail ?? claims["preferred_username"]) as string | undefined,
    emailVerified:
      Boolean(explicitEmail) &&
      (claims["email_verified"] === true || claims["email_verified"] === "true"),
    firstName: (claims["given_name"] ?? null) as string | null,
    lastName: (claims["family_name"] ?? claims["surname"] ?? null) as string | null,
    profileImageUrl: null,
    provider: "microsoft" as const,
  };
}

// ---------------------------------------------------------------------------
// User upsert — returns the full User row so the verify callback can store
// the DB id in the passport session. authStorage.upsertUser conflicts on
// email so a repeat OAuth login updates the existing row rather than
// creating a duplicate. See server/ai/auth/storage.ts for the conflict
// semantics and what fields are/are not overwritten.
// ---------------------------------------------------------------------------

async function upsertOAuthUser(
  mapped: ReturnType<typeof mapGoogleClaims> | ReturnType<typeof mapMicrosoftClaims>,
): Promise<User | null> {
  if (!mapped.email) return null;
  // SECURITY (scan finding, AUTHENTICATION_BYPASS / account takeover): never
  // link an OAuth login into an account on an unverified provider email. A
  // provider account whose email the IdP did not verify could otherwise claim
  // an existing user's identity by matching the email string.
  if (!mapped.emailVerified) return null;
  return authStorage.upsertUser({
    email: mapped.email,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    profileImageUrl: mapped.profileImageUrl,
    provider: mapped.provider,
  });
}

// ---------------------------------------------------------------------------
// Route registration — call this after setupAuth (server/setup.ts) has
// mounted the session and passport middleware.
// ---------------------------------------------------------------------------

export async function setupOAuthRoutes(app: Express): Promise<void> {
  const appUrl = process.env.APP_URL ?? "http://localhost:5000";

  const [googleConfig, microsoftConfig] = await Promise.all([
    getGoogleConfig(),
    getMicrosoftConfig(),
  ]);

  // ---- Google ----
  if (googleConfig) {
    const verify: VerifyFunction = async (tokens, verified) => {
      const claims = tokens.claims() as Record<string, unknown>;
      const user = await upsertOAuthUser(mapGoogleClaims(claims));
      // Refused (unverified email, or email owned by a local-password
      // account) → fail the login cleanly (passport routes to
      // failureRedirect) instead of minting a session with id: undefined.
      if (!user) return verified(null, false);
      verified(null, {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        provider: "google",
      });
    };

    passport.use(
      "google",
      new Strategy(
        {
          name: "google",
          config: googleConfig,
          scope: "openid email profile",
          callbackURL: `${appUrl}/api/auth/callback/google`,
        },
        verify,
      ),
    );

    app.get(
      "/api/auth/login/google",
      passport.authenticate("google", { prompt: "select_account" }),
    );

    app.get(
      "/api/auth/callback/google",
      passport.authenticate("google", {
        successReturnToOrRedirect: "/",
        failureRedirect: "/login?error=google_failed",
      }),
    );

    console.log("[oauth] Google sign-in enabled");
  }

  // ---- Microsoft ----
  if (microsoftConfig) {
    const verify: VerifyFunction = async (tokens, verified) => {
      const claims = tokens.claims() as Record<string, unknown>;
      const user = await upsertOAuthUser(mapMicrosoftClaims(claims));
      // Refused (unverified email, or email owned by a local-password
      // account) → fail the login cleanly instead of a broken session.
      if (!user) return verified(null, false);
      verified(null, {
        id: user.id,
        email: user.email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        provider: "microsoft",
      });
    };

    passport.use(
      "microsoft",
      new Strategy(
        {
          name: "microsoft",
          config: microsoftConfig,
          scope: "openid email profile",
          callbackURL: `${appUrl}/api/auth/callback/microsoft`,
        },
        verify,
      ),
    );

    app.get(
      "/api/auth/login/microsoft",
      passport.authenticate("microsoft", { prompt: "select_account" }),
    );

    app.get(
      "/api/auth/callback/microsoft",
      passport.authenticate("microsoft", {
        successReturnToOrRedirect: "/",
        failureRedirect: "/login?error=microsoft_failed",
      }),
    );

    console.log("[oauth] Microsoft sign-in enabled");
  }

  if (!googleConfig && !microsoftConfig) {
    console.log("[oauth] No OAuth providers configured — local auth only");
  }

  // Advertise which OAuth providers are enabled so the sign-in UI can render
  // only the buttons that actually lead somewhere. Returns booleans ONLY —
  // never the client ids/secrets — so no credential crosses to the frontend.
  // Derived from the resolved configs above so it can't drift from the set of
  // strategies actually registered.
  const enabledProviders = {
    google: Boolean(googleConfig),
    microsoft: Boolean(microsoftConfig),
  };
  app.get("/api/auth/providers", (_req, res) => {
    res.json(enabledProviders);
  });
}

// ---------------------------------------------------------------------------
// isAuthenticated middleware — works for both local and OAuth sessions
// ---------------------------------------------------------------------------

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};