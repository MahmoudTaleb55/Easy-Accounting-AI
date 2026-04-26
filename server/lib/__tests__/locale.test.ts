import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { parseLangParam } from "../locale";

/**
 * Locks down the locale-resolution precedence used by every endpoint that
 * emits localized output. The chain is:
 *
 *   1. `?lang=` query parameter    (frontend's PDF download flow)
 *   2. `body.locale` field         (chat / AI assistant)
 *   3. fallback to "ar"            (default workspace language)
 *
 * Anything that isn't one of `ar | en | de | fr` (or isn't a string) is
 * rejected at every level — we never echo an attacker-controlled string
 * straight into the PDF metadata or pdf-strings lookup.
 */
function fakeReq(opts: { query?: Record<string, unknown>; body?: unknown } = {}): Request {
  return { query: opts.query ?? {}, body: opts.body } as unknown as Request;
}

describe("parseLangParam — query precedence", () => {
  for (const lang of ["ar", "en", "de", "fr"] as const) {
    it(`returns "${lang}" from ?lang=${lang}`, () => {
      expect(parseLangParam(fakeReq({ query: { lang } }))).toBe(lang);
    });
  }

  it("query param wins over body.locale when both are present and valid", () => {
    expect(parseLangParam(fakeReq({ query: { lang: "fr" }, body: { locale: "de" } }))).toBe("fr");
  });

  it("ignores an invalid query param (es) and falls through to body.locale", () => {
    expect(parseLangParam(fakeReq({ query: { lang: "es" }, body: { locale: "de" } }))).toBe("de");
  });
});

describe("parseLangParam — body fallback", () => {
  it("returns body.locale when no ?lang= is present", () => {
    expect(parseLangParam(fakeReq({ body: { locale: "en" } }))).toBe("en");
  });

  it("ignores a non-string body.locale and falls through to default", () => {
    expect(parseLangParam(fakeReq({ body: { locale: 123 } }))).toBe("ar");
    expect(parseLangParam(fakeReq({ body: { locale: null } }))).toBe("ar");
  });

  it("ignores a body that isn't an object", () => {
    expect(parseLangParam(fakeReq({ body: "fr" }))).toBe("ar");
  });
});

describe("parseLangParam — default fallback", () => {
  it("falls back to ar when no locale is supplied at all", () => {
    expect(parseLangParam(fakeReq())).toBe("ar");
  });

  it("falls back to ar when ?lang= is an invalid value (uppercase, region, junk)", () => {
    for (const bad of ["AR", "ar-EG", "english", "es", "", "  ", "zh"]) {
      expect(parseLangParam(fakeReq({ query: { lang: bad } }))).toBe("ar");
    }
  });

  it("ignores ?lang= when it's not a string (Express may parse arrays)", () => {
    expect(parseLangParam(fakeReq({ query: { lang: ["fr", "de"] as unknown as string } }))).toBe("ar");
  });
});
