/**
 * Development-only .env loader.
 *
 * This module is imported for its SIDE EFFECT — it must be the very first
 * import in server/index.ts so that `.env` is populated into `process.env`
 * before any other module (notably `./db`, which reads DATABASE_URL at load
 * time and throws when it is missing) is evaluated.
 *
 * Production intentionally does NOT load a file: deployments inject
 * environment variables through the platform (IAM roles, secrets managers,
 * container env), and reading a committed/copied `.env` in production would
 * be both unnecessary and a footgun. `.env` stays out of version control
 * (see .gitignore), so this loader only helps local development.
 *
 * dotenv does not override variables that are already set, so a value
 * exported in the shell (or injected by a process manager) always wins over
 * the file — matching the requirement "production uses deployment-provided
 * environment variables."
 */
import { config as loadDotenv } from "dotenv";

if (process.env.NODE_ENV !== "production") {
  const result = loadDotenv();
  if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
    // A missing .env file is fine (ENOENT) — developers may export vars in
    // their shell instead. Any other parse/read error is worth surfacing.
    console.warn("[env] failed to load .env:", result.error.message);
  }
}
