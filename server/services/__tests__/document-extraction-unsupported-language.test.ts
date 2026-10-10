import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Server-side regression for the unsupported-language guard.
 *
 * Task #345 introduced two layers of defence against the model returning
 * a language we cannot serve:
 *
 *   1. The prompt asks the model to set `language: "unsupported"`
 *      explicitly when the document isn't AR/EN/DE/FR.
 *
 *   2. Belt-and-braces, the route also rejects ANY language string that
 *      isn't in the accepted set (`ar | en | de | fr | mixed`). This
 *      protects the user from generic "schema parse failed" toasts when
 *      the model ignores the prompt and just returns `es`, `it`, `zh`,
 *      etc.
 *
 * This test pins both behaviours by stubbing the `openai` SDK and
 * driving `extractDocument` with controlled responses.
 */

// vi.mock is hoisted to the top of the file before any non-hoisted code
// runs, so a reference to a plain `const chatCreateMock = vi.fn()` would
// be evaluated before the mock factory has access to it. `vi.hoisted`
// is the documented escape hatch: anything inside it is hoisted to the
// same point as `vi.mock`, so the spy and the factory see each other.
const { chatCreateMock } = vi.hoisted(() => ({ chatCreateMock: vi.fn() }));

// Mock the openai package directly. `document-extraction.ts` constructs
// `new OpenAI({...})` at module load, so the mock must replace the
// default export with a class whose `.chat.completions.create` is the
// vitest spy above.
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: chatCreateMock } };
  },
}));

import {
  extractDocument,
  DocumentExtractionError,
} from "../document-extraction";

function makeResponse(payload: object) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
  };
}

const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe("extractDocument → unsupported-language guard", () => {
  beforeEach(() => {
    chatCreateMock.mockReset();
    // `extractDocument` now short-circuits with `ai_not_configured` when
    // OPENAI_API_KEY is missing (BUG D). This suite exercises the
    // *language* guard, which runs only once the key check passes, so
    // give it a dummy key — the OpenAI SDK is mocked, so the value is
    // never used for a real request.
    process.env.OPENAI_API_KEY = "test-key";
  });

  it('throws DocumentExtractionError("unsupported_language") on the explicit "unsupported" sentinel', async () => {
    chatCreateMock.mockResolvedValue(makeResponse({ language: "unsupported" }));
    await expect(extractDocument(TINY_JPEG, "image/jpeg")).rejects.toBeInstanceOf(
      DocumentExtractionError,
    );
    await expect(extractDocument(TINY_JPEG, "image/jpeg")).rejects.toMatchObject({
      code: "unsupported_language",
    });
  });

  it.each(["es", "it", "zh", "tr", "ru", "hi"])(
    'throws unsupported_language when the model returns out-of-set ISO code "%s"',
    async (code) => {
      chatCreateMock.mockResolvedValueOnce(
        makeResponse({ language: code, vendor: "x", total: 1 }),
      );
      await expect(extractDocument(TINY_JPEG, "image/jpeg")).rejects.toMatchObject({
        code: "unsupported_language",
      });
    },
  );

  it.each(["ar", "en", "de", "fr", "mixed"])(
    'does NOT throw unsupported_language for accepted language "%s"',
    async (code) => {
      chatCreateMock.mockResolvedValueOnce(
        makeResponse({
          language: code,
          vendor: "ACME",
          documentDate: "2026-01-01",
          total: 100,
        }),
      );
      const out = await extractDocument(TINY_JPEG, "image/jpeg");
      expect(out.language).toBe(code);
    },
  );
});
