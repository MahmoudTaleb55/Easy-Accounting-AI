#!/usr/bin/env tsx
/**
 * Static check on `server/auth/local-routes.ts`:
 *
 *   1. Every dev-only-route reference (lazy `devRequire("./email-dev-stub")`,
 *      `registerEmailStubDevRoute(...)` call, or any direct
 *      `app.<verb>("/api/dev/...")` registration) must sit inside an
 *      `if (process.env.NODE_ENV !== "production") { ... }` block.
 *   2. `readDevSkipCooldownFromQuery` must short-circuit with
 *      `return false` when `NODE_ENV === "production"`.
 *
 * Source-only complement to `tests/e2e/dev-only-routes-production-
 * gate.spec.ts`. The runtime spec verifies *behaviour* by importing
 * the server graph under `NODE_ENV=production`; this scanner verifies
 * *shape* in well under a second so it can run in the pre-commit
 * hook. The spec backstops cases where the gates are structurally
 * present but logically broken.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const LOCAL_ROUTES_PATH = path.resolve(
  process.cwd(),
  "server/auth/local-routes.ts",
);

export interface SourcePos {
  line: number;
  column: number;
}

export interface DevReference {
  description: string;
  pos: SourcePos;
  inProductionGate: boolean;
}

export interface DevOnlyRoutesGateReport {
  devReferences: DevReference[];
  ungatedDevReferences: DevReference[];
  skipCooldownHasProductionGuard: boolean;
}

/**
 * Replace string-literal contents and comments with same-length
 * whitespace, preserving line / column positions so brace-counting
 * downstream isn't unbalanced by `{` / `}` inside a string or
 * comment. Template-literal text is also blanked, but `${...}`
 * interiors are preserved so brace balance stays correct.
 */
export function neutralizeStringsAndComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  let inTemplate = false;
  let templateBraceDepth = 0;

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    if (!inTemplate && ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (!inTemplate && ch === "/" && next === "*") {
      out.push("  ");
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < n) {
        out.push("  ");
        i += 2;
      }
      continue;
    }
    if (!inTemplate && (ch === '"' || ch === "'")) {
      const quote = ch;
      out.push(quote);
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\" && i + 1 < n) {
          out.push("  ");
          i += 2;
          continue;
        }
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < n) {
        out.push(quote);
        i++;
      }
      continue;
    }
    if (!inTemplate && ch === "`") {
      inTemplate = true;
      templateBraceDepth = 0;
      out.push("`");
      i++;
      continue;
    }
    if (inTemplate) {
      if (templateBraceDepth === 0 && ch === "`") {
        inTemplate = false;
        out.push("`");
        i++;
        continue;
      }
      if (templateBraceDepth === 0 && ch === "$" && next === "{") {
        out.push("${");
        templateBraceDepth = 1;
        i += 2;
        continue;
      }
      if (templateBraceDepth > 0) {
        if (ch === "{") templateBraceDepth++;
        if (ch === "}") {
          templateBraceDepth--;
          if (templateBraceDepth === 0) {
            out.push("}");
            i++;
            continue;
          }
        }
        out.push(ch);
        i++;
        continue;
      }
      if (ch === "\\" && i + 1 < n) {
        out.push("  ");
        i += 2;
        continue;
      }
      out.push(ch === "\n" ? "\n" : " ");
      i++;
      continue;
    }
    out.push(ch);
    i++;
  }
  return out.join("");
}

/**
 * Find every `if (process.env.NODE_ENV !== "production") { ... }`
 * block and return `[openBrace, closeBrace]` byte ranges. Match the
 * header on `original` (so `"production"` is visible) and walk the
 * matching `}` on `neutralized` (so braces in strings/comments don't
 * unbalance the count). Strict-inequality only.
 */
export function findProductionGateRanges(
  original: string,
  neutralized: string,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re =
    /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*["']production["']\s*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    let depth = 1;
    let i = openBrace + 1;
    while (i < neutralized.length && depth > 0) {
      const c = neutralized[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    if (depth === 0) ranges.push([openBrace, i - 1]);
  }
  return ranges;
}

function indexToPos(src: string, index: number): SourcePos {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

export function checkSkipCooldownProductionGuard(src: string): boolean {
  const neutralized = neutralizeStringsAndComments(src);
  // Match the signature on neutralized (the parameter list contains
  // a `{ ... }` type annotation, so `[^)]*` won't span it; on the
  // neutralized source the structural punctuation is intact and
  // string contents are blanked).
  const declRe =
    /export\s+function\s+readDevSkipCooldownFromQuery\s*\([\s\S]*?\)\s*:\s*boolean\s*\{/;
  const declMatch = declRe.exec(neutralized);
  if (!declMatch) return false;
  const open = declMatch.index + declMatch[0].length - 1;
  let depth = 1;
  let i = open + 1;
  while (i < neutralized.length && depth > 0) {
    const c = neutralized[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  if (depth !== 0) return false;
  // Slice from the original source so `"production"` survives for
  // the regex below.
  const body = src.slice(open + 1, i - 1);
  const guardRe =
    /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*(?:\{\s*)?return\s+false\b/;
  return guardRe.test(body);
}

export function checkDevOnlyRoutesProductionGate(
  source?: string,
): DevOnlyRoutesGateReport {
  const src = source ?? readFileSync(LOCAL_ROUTES_PATH, "utf8");
  const neutralized = neutralizeStringsAndComments(src);
  const gateRanges = findProductionGateRanges(src, neutralized);
  const devReferences: DevReference[] = [];

  const recordRef = (
    re: RegExp,
    description: (m: RegExpExecArray) => string,
  ) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const idx = m.index;
      // Skip matches inside a comment or string literal — neutralized
      // source has those characters blanked, so a first-character
      // mismatch means the match isn't real code.
      if (src[idx] !== neutralized[idx]) continue;
      const inProductionGate = gateRanges.some(
        ([open, close]) => idx > open && idx < close,
      );
      devReferences.push({
        description: description(m),
        pos: indexToPos(src, idx),
        inProductionGate,
      });
    }
  };

  recordRef(
    /\bapp\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'](\/api\/dev\/[^"']*)["']/g,
    (m) => `app.${m[1]}("${m[2]}") direct registration`,
  );
  recordRef(
    /devRequire\s*\(\s*["']\.\/email-dev-stub(?:\.ts)?["']\s*\)/g,
    () => `devRequire("./email-dev-stub.ts") lazy import`,
  );
  recordRef(
    /\bregisterEmailStubDevRoute\s*\(/g,
    () => `registerEmailStubDevRoute(...) call`,
  );

  return {
    devReferences,
    ungatedDevReferences: devReferences.filter((r) => !r.inProductionGate),
    skipCooldownHasProductionGuard: checkSkipCooldownProductionGuard(src),
  };
}

function formatReport(report: DevOnlyRoutesGateReport): string | null {
  const errors: string[] = [];

  if (report.devReferences.length === 0) {
    errors.push(
      [
        "no dev-only-route references found in server/auth/local-routes.ts.",
        "If the dev routes were intentionally removed, also remove this",
        "check; otherwise the scanner can no longer locate them.",
      ].join(" "),
    );
  }

  if (report.ungatedDevReferences.length > 0) {
    errors.push(
      [
        'Dev-only-route reference(s) outside the required `if (process.env.NODE_ENV !== "production") { ... }` gate in server/auth/local-routes.ts:',
        "",
        ...report.ungatedDevReferences.map(
          (r) => `  • line ${r.pos.line}: ${r.description}`,
        ),
        "",
        "Move each reference back inside the gate so the dev module is",
        "not even import-resolved in a production build (task #242).",
      ].join("\n"),
    );
  }

  if (!report.skipCooldownHasProductionGuard) {
    errors.push(
      [
        "`readDevSkipCooldownFromQuery` no longer short-circuits with",
        '`return false` when `process.env.NODE_ENV === "production"`.',
        "Without that guard, `?skipCooldown=1` would let production",
        "workspaces bypass the email-delivery alert cooldown.",
      ].join(" "),
    );
  }

  return errors.length > 0 ? errors.join("\n\n") : null;
}

export function runCheck(): { ok: boolean; message: string } {
  const report = checkDevOnlyRoutesProductionGate();
  const error = formatReport(report);
  if (error === null) {
    return {
      ok: true,
      message: `dev-only-routes production gate OK — ${report.devReferences.length} dev-route reference(s) all gated; readDevSkipCooldownFromQuery production short-circuit intact`,
    };
  }
  return { ok: false, message: error };
}

function isMain(): boolean {
  const entry = process.argv[1] ?? "";
  return (
    entry.endsWith("check-dev-only-routes-production-gate.ts") ||
    entry.endsWith("check-dev-only-routes-production-gate.js")
  );
}

if (isMain()) {
  const { ok, message } = runCheck();
  // eslint-disable-next-line no-console
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
