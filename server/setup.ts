import type { Express } from "express";
import { randomBytes } from "crypto";
import session from "express-session";
import passport from "passport";
import connectPgSimple from "connect-pg-simple";
import { sessionPool } from "./db";

const PgSession = connectPgSimple(session);

/**
 * Minimum acceptable length for SESSION_SECRET. The secret signs the session
 * cookie; a short/guessable value lets an attacker forge a session and
 * impersonate any user. 32 characters is a pragmatic floor for a random
 * secret (the .env.example ships a placeholder to be replaced).
 */
const MIN_SESSION_SECRET_LENGTH = 32;

/**
 * Resolve and validate the session secret. Fails fast in production with a
 * clear message rather than the previous silent `process.env.SESSION_SECRET!`
 * non-null assertion, which would let the server boot with an undefined or
 * weak secret. In development we fall back to a fixed, clearly-labelled dev
 * secret (with a warning) so `npm run dev` works out of the box without an
 * .env, but that fallback is NEVER used in production.
 */
export function resolveSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
      throw new Error(
        `SESSION_SECRET must be set to a random string of at least ${MIN_SESSION_SECRET_LENGTH} characters in production. ` +
          `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    return secret;
  }

  if (!secret) {
    console.warn(
      "[auth] SESSION_SECRET is not set — generating a random development-only " +
        "secret for this process. Sessions will not survive a restart. Set " +
        "SESSION_SECRET in .env for a stable dev session, and always in production.",
    );
    // SECURITY (scan finding, DEFAULT_CREDENTIALS): generate a RANDOM dev
    // fallback rather than a hardcoded constant, so sessions can't be forged
    // with a value that's committed in the source tree. Production never
    // reaches here — resolveSessionSecret throws above when NODE_ENV is
    // production and the secret is missing/weak.
    return randomBytes(32).toString("hex");
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    console.warn(
      `[auth] SESSION_SECRET is shorter than ${MIN_SESSION_SECRET_LENGTH} characters. ` +
        "This is tolerated in development but will fail to boot in production.",
    );
  }
  return secret;
}

export async function setupAuth(app: Express): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";

  // Trust the first proxy hop in production so that:
  //  1. `secure` cookies are set even though the app sees plain HTTP behind a
  //     TLS-terminating load balancer (Express reads X-Forwarded-Proto).
  //  2. express-rate-limit keys on the real client IP (X-Forwarded-For)
  //     instead of lumping every request under the proxy's IP.
  // `1` (a single hop) is deliberately narrow — `true` would trust an
  // arbitrary chain of forwarded IPs, which lets a client spoof its address.
  if (isProduction) {
    app.set("trust proxy", 1);
  }

  app.use(
    session({
      // Uses the dedicated `sessionPool` (NOT the request-scoped `pool`) so
      // session reads — which run on every request before withCompanyScope —
      // can never be starved waiting behind long-lived request-pinned RLS
      // clients. See the pool-budget note in server/db.ts.
      store: new PgSession({ pool: sessionPool, tableName: "sessions" }),
      secret: resolveSessionSecret(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        // HTTPS-only in production; plain HTTP is fine for local dev.
        secure: isProduction,
        // Not readable from JS — mitigates session theft via XSS. This is the
        // express-session default, set explicitly for clarity.
        httpOnly: true,
        // Sent on top-level navigations (normal login + OAuth redirects work)
        // but withheld on cross-site sub-requests — a baseline CSRF control.
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((user, done) => done(null, user as any));
}
