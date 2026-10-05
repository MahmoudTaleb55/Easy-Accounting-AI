/**
 * Vitest global setup.
 *
 * Loads `.env` into `process.env` before any test module is evaluated, so
 * DB-backed tests (which read DATABASE_URL) see the same configuration the
 * app does in development. Without this, tests that gate on
 * `process.env.DATABASE_URL` skip even when a local `.env` is present,
 * because the vitest runner — unlike server/index.ts — does not import the
 * app's dotenv loader.
 *
 * Mirrors the production posture from server/load-env.ts: this only reads a
 * local file; CI / deployment environments inject variables directly and a
 * missing `.env` is not an error.
 */
import { config as loadDotenv } from "dotenv";

loadDotenv();
