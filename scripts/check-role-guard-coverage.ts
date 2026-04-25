#!/usr/bin/env tsx
/**
 * Static check: every `button-*` test id wrapped by <WriteGuard>,
 * <OwnerGuard> or <OwnerOnly> in `client/src/` must be referenced by
 * the role-based gating spec for all three roles (owner / accountant /
 * viewer).
 *
 * Why this exists: `tests/e2e/role-based-buttons.spec.ts` enumerates
 * each guarded surface by hand. When a developer adds a new page that
 * uses one of the role guards, they must remember to add a matching
 * assertion under all three roles, or the regression net silently
 * misses the new control. This script scans the codebase, builds a
 * list of guarded button ids, and cross-references them against the
 * spec — failing CI if any role coverage is missing.
 *
 * The script is intentionally dependency-free (no TS compiler API,
 * no parser5 / babel, etc.) so it can run as a fast precommit or CI
 * check. It uses a stack-based regex scanner for the JSX tag matching
 * which is robust enough for the simple guard-wraps-button pattern
 * used throughout the codebase.
 *
 * Run directly:   `tsx scripts/check-role-guard-coverage.ts`
 * Run in CI via:  `tests/e2e/role-guard-coverage.spec.ts`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const PROJECT_ROOT = process.cwd();
export const CLIENT_SRC = join(PROJECT_ROOT, "client/src");
export const SPEC_PATH = join(PROJECT_ROOT, "tests/e2e/role-based-buttons.spec.ts");

const GUARD_TAGS = ["WriteGuard", "OwnerGuard", "OwnerOnly"] as const;
type GuardTag = (typeof GUARD_TAGS)[number];

const ROLES = ["owner", "accountant", "viewer"] as const;
type Role = (typeof ROLES)[number];

export interface GuardedButton {
  /** Repo-relative path to the .tsx file. */
  file: string;
  /** 1-indexed line of the *opening* guard tag. */
  line: number;
  /** Which guard wraps the button. */
  guard: GuardTag;
  /** Human-readable id template, e.g. `button-add-x` or `button-delete-${tx.id}`. */
  buttonId: string;
  /**
   * Substrings the spec must contain to count as covering this id.
   * For a static id this is `[id]`. For a template literal with a
   * single trailing `${expr}` this is `[literalPrefix]`. For
   * template literals with multiple `${expr}` parts this is the
   * full inner template text (which the spec is expected to mirror
   * verbatim). All listed tokens must appear in each role block.
   */
  tokens: string[];
  /**
   * `static` for `data-testid="button-foo"`,
   * `prefix` for `data-testid={\`button-foo-${expr}\`}`,
   * `template` for the multi-interpolation case where the spec is
   * expected to mirror the same template literal text.
   */
  tokenKind: "static" | "prefix" | "template";
}

export interface MissingCoverage {
  button: GuardedButton;
  /** Roles whose describe() block does not reference any of the tokens. */
  missingRoles: Role[];
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function* walkTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTsx(full);
    } else if (entry.endsWith(".tsx")) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// JSX guard span extraction
// ---------------------------------------------------------------------------

function lineOf(src: string, charIdx: number): number {
  let line = 1;
  for (let i = 0; i < charIdx; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

interface GuardSpan {
  guard: GuardTag;
  openLine: number;
  contentStart: number;
  contentEnd: number;
}

/**
 * Find every `<Guard>...</Guard>` span for the given tag, accounting
 * for nesting of the same tag (rare but possible). Self-closing tags
 * `<Guard ... />` are ignored as they wrap nothing.
 */
function findGuardSpans(src: string, tag: GuardTag): GuardSpan[] {
  // [^>]*? keeps us from spanning lines we shouldn't; the codebase
  // never embeds a literal `>` inside a guard's attribute expression
  // (verified by `rg`), so a non-greedy non-`>` attr scan is safe.
  const re = new RegExp(`<\\/?${tag}\\b([^>]*?)>`, "g");
  const stack: Array<{ contentStart: number; openLine: number }> = [];
  const spans: GuardSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const tok = m[0];
    const isClose = tok.startsWith("</");
    const isSelfClose = tok.endsWith("/>");
    if (isClose) {
      const opened = stack.pop();
      if (opened) {
        spans.push({
          guard: tag,
          openLine: opened.openLine,
          contentStart: opened.contentStart,
          contentEnd: m.index,
        });
      }
    } else if (!isSelfClose) {
      stack.push({
        contentStart: m.index + tok.length,
        openLine: lineOf(src, m.index),
      });
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// data-testid extraction inside a guard span
// ---------------------------------------------------------------------------

/** Static `data-testid="button-..."` or `data-testid='button-...'`. */
const STATIC_TESTID_RE = /data-testid=(?:"([^"]+)"|'([^']+)')/g;
/** Template literal `data-testid={`button-...`}`. */
const TEMPLATE_TESTID_RE = /data-testid=\{`([^`]+)`\}/g;

/**
 * Resolve a template-literal id into the search tokens that must
 * appear in the spec. The spec mirrors the source's id construction:
 *   - `button-foo` (no interpolation) → token "button-foo"
 *   - `button-foo-${bar}` (single trailing expr) → token "button-foo-"
 *     (matches both `'button-foo-...'` and `[data-testid^="button-foo-"]`
 *     selectors used in the spec)
 *   - `button-${a}-${b}` (multi-interpolation) → token
 *     "button-${a}-${b}" — the spec is expected to construct the id
 *     with the same template literal, so the verbatim inner text is
 *     a precise enough fingerprint.
 */
function tokensForTemplate(
  template: string,
): { tokens: string[]; kind: "static" | "prefix" | "template" } {
  // Split into literal | expression parts.
  type Part = { type: "literal" | "expr"; text: string };
  const parts: Part[] = [];
  let i = 0;
  while (i < template.length) {
    const dollar = template.indexOf("${", i);
    if (dollar === -1) {
      parts.push({ type: "literal", text: template.slice(i) });
      break;
    }
    if (dollar > i) parts.push({ type: "literal", text: template.slice(i, dollar) });
    // Find matching `}` accounting for nested braces.
    let depth = 1;
    let j = dollar + 2;
    while (j < template.length && depth > 0) {
      const ch = template[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      j++;
    }
    parts.push({ type: "expr", text: template.slice(dollar + 2, j - 1) });
    i = j;
  }

  const isDynamic = parts.some((p) => p.type === "expr");
  if (!isDynamic) {
    return { tokens: [template], kind: "static" };
  }
  // Single trailing expression → a literal prefix is the right anchor.
  if (parts.length === 2 && parts[0].type === "literal" && parts[1].type === "expr") {
    return { tokens: [parts[0].text], kind: "prefix" };
  }
  // Generic case → require the spec to contain the exact same template
  // literal text. This catches multi-interpolation patterns like
  // `button-${action}-${assetId}` which the spec constructs the same way.
  return { tokens: [template], kind: "template" };
}

function extractGuardedButtons(src: string, file: string, span: GuardSpan): GuardedButton[] {
  const inside = src.slice(span.contentStart, span.contentEnd);
  const found: GuardedButton[] = [];

  STATIC_TESTID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_TESTID_RE.exec(inside)) !== null) {
    const value = m[1] ?? m[2];
    if (!value || !value.startsWith("button-")) continue;
    found.push({
      file,
      line: span.openLine,
      guard: span.guard,
      buttonId: value,
      tokens: [value],
      tokenKind: "static",
    });
  }

  TEMPLATE_TESTID_RE.lastIndex = 0;
  while ((m = TEMPLATE_TESTID_RE.exec(inside)) !== null) {
    const template = m[1];
    if (!template.startsWith("button-")) continue;
    const { tokens, kind } = tokensForTemplate(template);
    found.push({
      file,
      line: span.openLine,
      guard: span.guard,
      buttonId: template,
      tokens,
      tokenKind: kind,
    });
  }

  return found;
}

// ---------------------------------------------------------------------------
// Spec coverage matching
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/**
 * True when the given token from the source is referenced inside the
 * given role-describe block. Matching is purposely strict for prefix
 * tokens so that e.g. `button-revoke-` is NOT considered covered by
 * `button-revoke-invite-` — these are distinct ids that must each be
 * tested separately.
 *
 * Rules per token kind:
 *   - static    : a substring match anywhere in the block.
 *   - prefix    : the prefix must be followed by an identifier
 *                 terminator — `"`, `'`, `\``, or `${` — so we don't
 *                 false-match longer ids that share the same head.
 *   - template  : the verbatim multi-interpolation template text must
 *                 appear in the block (the spec is expected to mirror
 *                 the same template literal).
 *
 * Loop fallback (prefix tokens only): the fixed-assets describe blocks
 * cover impairment / revaluation / dispose / delete via
 *
 *   for (const action of ["impairment","revaluation","dispose","delete"]) {
 *     ... `button-${action}-${assetId}` ...
 *   }
 *
 * which leaves no literal "button-impairment-" string to match against.
 * To avoid forcing every per-row action button to be unrolled in the
 * spec, accept a prefix `button-WORD-` as covered when the block both
 *   (a) contains a `\`button-${...}-...\`` template, AND
 *   (b) mentions the literal "WORD" / 'WORD' as a quoted string.
 */
export function tokenAppearsInBlock(
  token: string,
  kind: GuardedButton["tokenKind"],
  block: string,
): boolean {
  if (kind === "static" || kind === "template") {
    return block.includes(token);
  }
  // kind === "prefix" — strict next-char check.
  const followBy = new RegExp(`${escapeRegex(token)}(?:["'\`]|\\$\\{)`);
  if (followBy.test(block)) return true;

  // Loop fallback: `button-WORD-` where WORD is a single segment.
  if (!token.startsWith("button-") || !token.endsWith("-")) return false;
  const word = token.slice("button-".length, -1);
  if (!word || word.includes("-")) return false;
  if (!/`button-\$\{[^}]+\}-/.test(block)) return false;
  return block.includes(`"${word}"`) || block.includes(`'${word}'`);
}

// ---------------------------------------------------------------------------
// Spec parsing — split into per-role describe blocks
// ---------------------------------------------------------------------------

/**
 * The spec uses one `test.use({ storageState: ROLE_FILES.<role> })`
 * statement per role-describe block. Splitting on those markers gives
 * us the source text we need to search per role. We accept any text
 * after the marker as belonging to that role until the next role
 * marker (or EOF for the last one).
 */
export function splitSpecByRole(specSrc: string): Record<Role, string> {
  const markers = ROLES.map((role) => {
    const marker = `ROLE_FILES.${role}`;
    const idx = specSrc.indexOf(marker, specSrc.indexOf("test.use") - 1 >= 0 ? 0 : 0);
    // The first occurrence of `ROLE_FILES.<role>` is inside `test.use(...)`
    // for the matching describe block (the const-decl above uses the bare
    // key `<role>:` instead of the dotted access).
    return { role, idx };
  }).sort((a, b) => a.idx - b.idx);

  for (const m of markers) {
    if (m.idx === -1) {
      throw new Error(
        `role-based-buttons.spec.ts is missing the marker 'ROLE_FILES.${m.role}'; ` +
          `the role-guard coverage check relies on those markers to split ` +
          `the file into per-role describe blocks.`,
      );
    }
  }

  const out = {} as Record<Role, string>;
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].idx;
    const end = i + 1 < markers.length ? markers[i + 1].idx : specSrc.length;
    out[markers[i].role] = specSrc.slice(start, end);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface CoverageReport {
  buttons: GuardedButton[];
  missing: MissingCoverage[];
}

export function checkRoleGuardCoverage(): CoverageReport {
  // 1. Collect every guarded button across the client tree.
  const buttons: GuardedButton[] = [];
  for (const file of walkTsx(CLIENT_SRC)) {
    let src: string;
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!GUARD_TAGS.some((g) => src.includes(`<${g}`))) continue;

    const rel = relative(PROJECT_ROOT, file);
    for (const tag of GUARD_TAGS) {
      for (const span of findGuardSpans(src, tag)) {
        buttons.push(...extractGuardedButtons(src, rel, span));
      }
    }
  }

  // 2. Deduplicate identical (file, buttonId, guard) entries that arise
  //    when a button id is captured by multiple nested guard tags or
  //    repeated regex sweeps. Keep the first occurrence (lowest line).
  const dedup = new Map<string, GuardedButton>();
  for (const b of buttons) {
    const key = `${b.file}|${b.guard}|${b.buttonId}`;
    const prior = dedup.get(key);
    if (!prior || b.line < prior.line) dedup.set(key, b);
  }
  const uniqueButtons = [...dedup.values()].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );

  // 3. Cross-reference against the spec.
  const specSrc = readFileSync(SPEC_PATH, "utf8");
  const perRole = splitSpecByRole(specSrc);

  const missing: MissingCoverage[] = [];
  for (const button of uniqueButtons) {
    const missingRoles: Role[] = [];
    for (const role of ROLES) {
      const block = perRole[role];
      // A button is "covered" for a role when *every* required token
      // (usually one) appears at least once in that role's block.
      const covered = button.tokens.every((tok) =>
        tokenAppearsInBlock(tok, button.tokenKind, block),
      );
      if (!covered) missingRoles.push(role);
    }
    if (missingRoles.length > 0) {
      missing.push({ button, missingRoles });
    }
  }

  return { buttons: uniqueButtons, missing };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatMissing(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(
    `Found ${report.missing.length} guarded button(s) without complete role coverage in tests/e2e/role-based-buttons.spec.ts:`,
    "",
  );
  for (const { button, missingRoles } of report.missing) {
    lines.push(
      `  • ${button.file}:${button.line}  <${button.guard}>  data-testid="${button.buttonId}"`,
      `      missing role coverage: ${missingRoles.join(", ")}`,
      `      spec must reference token(s): ${button.tokens.map((t) => JSON.stringify(t)).join(", ")}`,
    );
  }
  lines.push(
    "",
    "Add one assertion per role to tests/e2e/role-based-buttons.spec.ts so",
    "the new control is exercised under owner / accountant / viewer.",
  );
  return lines.join("\n");
}

function isMain(): boolean {
  // tsx/node both populate process.argv[1] with the entry script path.
  const entry = process.argv[1] ?? "";
  return entry.endsWith("check-role-guard-coverage.ts") ||
    entry.endsWith("check-role-guard-coverage.js");
}

if (isMain()) {
  const report = checkRoleGuardCoverage();
  if (report.missing.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `role-guard coverage OK — ${report.buttons.length} guarded button id(s) all have owner / accountant / viewer assertions`,
    );
    process.exit(0);
  } else {
    // eslint-disable-next-line no-console
    console.error(formatMissing(report));
    process.exit(1);
  }
}
