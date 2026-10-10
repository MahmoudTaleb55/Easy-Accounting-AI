import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DocumentExtractionError,
  extractDocument,
} from "../services/document-extraction";

/**
 * BUG D regression — a missing/empty OpenAI API key must surface as a stable
 * `ai_not_configured` code, never as the SDK's raw 401 ("You didn't provide
 * an API key…"). `extractDocument` checks `process.env.OPENAI_API_KEY` at
 * call time and throws before any network call, so unsetting the env var is
 * enough to exercise the guard.
 */
describe("BUG D — document extraction without an OpenAI key", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it("rejects with a DocumentExtractionError('ai_not_configured') and makes no network call", async () => {
    // A 1x1 PNG header is enough — the key guard runs before any parsing.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(extractDocument(png, "image/png")).rejects.toMatchObject({
      code: "ai_not_configured",
    });
    await expect(extractDocument(png, "image/png")).rejects.toBeInstanceOf(
      DocumentExtractionError,
    );
  });

  it("also guards an empty/whitespace key", async () => {
    process.env.OPENAI_API_KEY = "   ";
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await expect(extractDocument(png, "image/png")).rejects.toMatchObject({
      code: "ai_not_configured",
    });
  });
});
