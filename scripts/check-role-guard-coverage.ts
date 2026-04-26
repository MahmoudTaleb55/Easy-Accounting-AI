#!/usr/bin/env tsx
/**
 * Static check: every interactive test id wrapped by <WriteGuard>,
 * <OwnerGuard> or <OwnerOnly> in `client/src/` must be referenced by
 * the role-based gating spec for all three roles (owner / accountant /
 * viewer).
 *
 * "Interactive" here means a test id whose prefix matches one of the
 * surfaces a developer is plausibly placing inside a role guard:
 *
 *   button-  inputs that fire mutations (the original surface)
 *   input-   text / number / date inputs that bind to write payloads
 *   link-    anchors / clickable rows that drill into a write surface
 *   select-  shadcn Select triggers backing a write payload
 *   tab-     TabsTriggers that gate access to a write tab
 *
 * Why this exists: `tests/e2e/role-based-buttons.spec.ts` enumerates
 * each guarded surface by hand. When a developer adds a new page that
 * uses one of the role guards, they must remember to add a matching
 * assertion under all three roles, or the regression net silently
 * misses the new control. This script scans the codebase, builds a
 * list of guarded test ids, and cross-references them against the
 * spec — failing CI if any role coverage is missing.
 *
 * The script is intentionally dependency-free (no TS compiler API,
 * no parser5 / babel, etc.) so it can run as a fast precommit or CI
 * check. It uses a stack-based regex scanner for the JSX tag matching
 * which is robust enough for the simple guard-wraps-control pattern
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

/**
 * Test-id prefixes we treat as "interactive enough" to require role
 * coverage. Adding a new prefix here will retro-actively flag any
 * existing guarded controls that match it, so the spec must be
 * updated in the same commit.
 */
export const GUARDED_TESTID_PREFIXES = [
  "button-",
  "input-",
  "link-",
  "select-",
  "tab-",
] as const;

export interface GuardedSurface {
  /** Repo-relative path to the .tsx file. */
  file: string;
  /** 1-indexed line of the *opening* guard tag. */
  line: number;
  /** Which guard wraps the control. */
  guard: GuardTag;
  /** Human-readable id template, e.g. `button-add-x` or `input-foo-${id}`. */
  testId: string;
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
  surface: GuardedSurface;
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

/** Static `data-testid="<prefix>..."` or `data-testid='<prefix>...'`. */
const STATIC_TESTID_RE = /data-testid=(?:"([^"]+)"|'([^']+)')/g;
/** Template literal `data-testid={`<prefix>...`}`. */
const TEMPLATE_TESTID_RE = /data-testid=\{`([^`]+)`\}/g;

function hasGuardedPrefix(value: string): boolean {
  return GUARDED_TESTID_PREFIXES.some((p) => value.startsWith(p));
}

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

function extractGuardedSurfaces(src: string, file: string, span: GuardSpan): GuardedSurface[] {
  const inside = src.slice(span.contentStart, span.contentEnd);
  const found: GuardedSurface[] = [];

  STATIC_TESTID_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STATIC_TESTID_RE.exec(inside)) !== null) {
    const value = m[1] ?? m[2];
    if (!value || !hasGuardedPrefix(value)) continue;
    found.push({
      file,
      line: span.openLine,
      guard: span.guard,
      testId: value,
      tokens: [value],
      tokenKind: "static",
    });
  }

  TEMPLATE_TESTID_RE.lastIndex = 0;
  while ((m = TEMPLATE_TESTID_RE.exec(inside)) !== null) {
    const template = m[1];
    if (!hasGuardedPrefix(template)) continue;
    const { tokens, kind } = tokensForTemplate(template);
    found.push({
      file,
      line: span.openLine,
      guard: span.guard,
      testId: template,
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
 * spec, accept a prefix `<surface>-WORD-` as covered when the block
 * both:
 *   (a) contains a `\`<surface>-${...}-...\`` template, AND
 *   (b) mentions the literal "WORD" / 'WORD' as a quoted string.
 *
 * The loop fallback is generalized over every supported prefix so a
 * future `for (const action of [...]) { \`tab-${action}-...\` }` pattern
 * would Just Work without any further script changes.
 */
export function tokenAppearsInBlock(
  token: string,
  kind: GuardedSurface["tokenKind"],
  block: string,
): boolean {
  if (kind === "static" || kind === "template") {
    return block.includes(token);
  }
  // kind === "prefix" — strict next-char check.
  const followBy = new RegExp(`${escapeRegex(token)}(?:["'\`]|\\$\\{)`);
  if (followBy.test(block)) return true;

  // Loop fallback: `<surface>-WORD-` where WORD is a single segment.
  if (!token.endsWith("-")) return false;
  const matchedPrefix = GUARDED_TESTID_PREFIXES.find((p) => token.startsWith(p));
  if (!matchedPrefix) return false;
  const word = token.slice(matchedPrefix.length, -1);
  if (!word || word.includes("-")) return false;
  const loopTemplateRe = new RegExp(`\`${escapeRegex(matchedPrefix)}\\$\\{[^}]+\\}-`);
  if (!loopTemplateRe.test(block)) return false;
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
  surfaces: GuardedSurface[];
  missing: MissingCoverage[];
}

export function checkRoleGuardCoverage(): CoverageReport {
  // 1. Collect every guarded surface across the client tree.
  const surfaces: GuardedSurface[] = [];
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
        surfaces.push(...extractGuardedSurfaces(src, rel, span));
      }
    }
  }

  // 2. Deduplicate identical (file, testId, guard) entries that arise
  //    when an id is captured by multiple nested guard tags or
  //    repeated regex sweeps. Keep the first occurrence (lowest line).
  const dedup = new Map<string, GuardedSurface>();
  for (const s of surfaces) {
    const key = `${s.file}|${s.guard}|${s.testId}`;
    const prior = dedup.get(key);
    if (!prior || s.line < prior.line) dedup.set(key, s);
  }
  const uniqueSurfaces = [...dedup.values()].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );

  // 3. Cross-reference against the spec.
  const specSrc = readFileSync(SPEC_PATH, "utf8");
  const perRole = splitSpecByRole(specSrc);

  const missing: MissingCoverage[] = [];
  for (const surface of uniqueSurfaces) {
    const missingRoles: Role[] = [];
    for (const role of ROLES) {
      const block = perRole[role];
      // A surface is "covered" for a role when *every* required token
      // (usually one) appears at least once in that role's block.
      const covered = surface.tokens.every((tok) =>
        tokenAppearsInBlock(tok, surface.tokenKind, block),
      );
      if (!covered) missingRoles.push(role);
    }
    if (missingRoles.length > 0) {
      missing.push({ surface, missingRoles });
    }
  }

  return { surfaces: uniqueSurfaces, missing };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function formatMissing(report: CoverageReport): string {
  const lines: string[] = [];
  lines.push(
    `Found ${report.missing.length} guarded surface(s) without complete role coverage in tests/e2e/role-based-buttons.spec.ts:`,
    "",
  );
  for (const { surface, missingRoles } of report.missing) {
    lines.push(
      `  • ${surface.file}:${surface.line}  <${surface.guard}>  data-testid="${surface.testId}"`,
      `      missing role coverage: ${missingRoles.join(", ")}`,
      `      spec must reference token(s): ${surface.tokens.map((t) => JSON.stringify(t)).join(", ")}`,
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
      `role-guard coverage OK — ${report.surfaces.length} guarded test id(s) all have owner / accountant / viewer assertions`,
    );
    process.exit(0);
  } else {
    // eslint-disable-next-line no-console
    console.error(formatMissing(report));
    process.exit(1);
  }
}
