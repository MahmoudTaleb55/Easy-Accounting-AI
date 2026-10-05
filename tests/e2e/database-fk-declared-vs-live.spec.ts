import { test, expect } from "@playwright/test";
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Task #241 — catch foreign keys that migrations declared but never made it
 * onto the live database.
 *
 * Why this exists
 * ---------------
 * `migrations/0011_email_delivery_alert_recipients.sql` declared
 *   "alert_id" varchar NOT NULL
 *      REFERENCES "email_delivery_alerts"("id") ON DELETE CASCADE
 * but the constraint never made it onto the running database — `pg_constraint`
 * only carried the table's primary key. The breakage was completely silent:
 * the alert→recipient cascade never fired, recipients piled up as orphans,
 * and the per-workspace dedupe gate started double-counting until tests had
 * to add a defensive in-test `DELETE FROM email_delivery_alert_recipients`
 * workaround. Task #188 wrote a follow-up migration
 * (`0017_email_delivery_alert_recipients_fk.sql`) and pinned the same FK in
 * `shared/models/auth.ts`, but nothing currently *guards* against another
 * migration shipping with the same kind of inline `REFERENCES` clause that
 * quietly fails to apply on prod.
 *
 * The companion specs `database-rls-policy-coverage.spec.ts` (RLS) and
 * `database-companyid-no-default.spec.ts` (no DEFAULT on company_id) close
 * the same kind of "declared in migration, missing in prod" drift for two
 * other classes of constraint. This spec extends that net to foreign keys.
 *
 * What it checks
 * --------------
 * Walks every `migrations/*.sql`, parses out every declared foreign key —
 * both the inline form
 *     "col" type ... REFERENCES "parent" ("col") ...
 * and the standalone form
 *     ALTER TABLE "child" ADD [CONSTRAINT "name"]
 *       FOREIGN KEY (...) REFERENCES "parent" (...)
 * (the standalone form may sit inside a `DO $$ ... END $$` guard, which is
 * how `0017_email_delivery_alert_recipients_fk.sql` and the composite-FK
 * migrations 0005/0007 add their constraints — the parser doesn't care
 * about the wrapping block, it just finds the FK statement) — and asserts
 * that a matching constraint exists in `pg_constraint` on the running
 * database, identified by (child_table, child_cols, parent_table,
 * parent_cols). We deliberately do NOT match by constraint *name* because
 * the same FK can be re-derived by `drizzle-kit push` from
 * `shared/models/*.ts` under a different auto-generated name (e.g. `_fkey`
 * vs. the migration's `_fk`); what we care about is that the column-level
 * relationship is enforced, not the cosmetic name.
 *
 * The failure message lists the migration filename, child table + columns,
 * and parent table + columns so the next time this happens it's a one-line
 * fix instead of a multi-day investigation.
 *
 * Tagged @db so it can be filtered with the rest of the database-level
 * regression net. Registered as the `migrations-fk-coverage` validation
 * workflow alongside `migrations-prefix` and
 * `migrations-runner`.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

interface DeclaredFk {
  migrationFile: string;
  childTable: string;
  childCols: string[];
  parentTable: string;
  parentCols: string[];
}

interface LiveFkRow {
  child_table: string;
  parent_table: string;
  child_cols: string[];
  parent_cols: string[];
}

// Strip `--` line comments so a commented-out REFERENCES clause inside a
// migration's header doc-block doesn't show up as a declared FK. Block
// comments (`/* ... */`) are not used in any current migration, so we
// don't waste a parser pass on them — if one is added later, this function
// is the one place to extend.
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

// Split a CREATE TABLE body on commas that are at paren-depth 0 — i.e.
// the commas separating column definitions / table-level constraints,
// not the commas inside a nested `numeric(10, 2)` or `("a", "b")`.
// Naïve `body.split(",")` would slice column types in half.
function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Pull each `"col"` token out of a `(...)` column list, in declared order.
// Used for both the child-side and parent-side column lists of every FK.
// The caller has already stripped surrounding parens.
function parseColumnList(list: string): string[] {
  return list
    .split(",")
    .map((s) => s.trim().replace(/^"(.+)"$/, "$1"))
    .filter((s) => s.length > 0);
}

export function parseDeclaredFks(
  filename: string,
  content: string,
): DeclaredFk[] {
  const fks: DeclaredFk[] = [];
  const stripped = stripLineComments(content);

  // ----- (1) Inline REFERENCES inside CREATE TABLE bodies ------------------
  // `CREATE TABLE [IF NOT EXISTS] "name" (...)`. We walk forward from the
  // opening paren balancing parens to find the matching close, then split
  // the body on top-level commas to get one definition per slot.
  const createTableRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createTableRe.exec(stripped)) !== null) {
    const childTable = m[1];
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0) break;
      i++;
    }
    const body = stripped.slice(start, i);
    for (const def of splitTopLevelCommas(body)) {
      const trimmed = def.trim();
      if (!trimmed) continue;

      // Table-level constraint:
      //   [CONSTRAINT "name"] FOREIGN KEY (a, b) REFERENCES "t" (c, d)
      const tableConstraintRe =
        /^(?:CONSTRAINT\s+"[^"]+"\s+)?FOREIGN\s+KEY\s*\(\s*([^)]+)\s*\)\s*REFERENCES\s+"([^"]+)"\s*\(\s*([^)]+)\s*\)/i;
      const tcm = tableConstraintRe.exec(trimmed);
      if (tcm) {
        fks.push({
          migrationFile: filename,
          childTable,
          childCols: parseColumnList(tcm[1]),
          parentTable: tcm[2],
          parentCols: parseColumnList(tcm[3]),
        });
        continue;
      }

      // Column-inline FK: `"col" type ... REFERENCES "table" ("col")`.
      // `[\s\S]*?` (lazy any-char including newlines) lets us skip over
      // type modifiers, `NOT NULL`, `DEFAULT ...`, etc. between the
      // column name and the REFERENCES clause. The split-on-top-level-
      // commas above already isolates one column definition per pass,
      // so the lazy match cannot leak across columns.
      const colRe =
        /^"([^"]+)"\s+[\s\S]*?REFERENCES\s+"([^"]+)"\s*\(\s*"([^"]+)"\s*\)/i;
      const cm = colRe.exec(trimmed);
      if (cm) {
        fks.push({
          migrationFile: filename,
          childTable,
          childCols: [cm[1]],
          parentTable: cm[2],
          parentCols: [cm[3]],
        });
      }
    }
  }

  // ----- (2) Standalone ALTER TABLE ... ADD [CONSTRAINT ...] FOREIGN KEY ---
  // Matches both the bare form and the named form. Whitespace tolerant
  // (`\s+`) so multi-line statements and statements wrapped in
  // `DO $$ ... END $$` guards are picked up — the wrapping block does
  // not matter, only the ALTER TABLE statement inside it.
  const alterFkRe =
    /ALTER\s+TABLE\s+(?:ONLY\s+)?"([^"]+)"\s+ADD\s+(?:CONSTRAINT\s+"[^"]+"\s+)?FOREIGN\s+KEY\s*\(\s*([^)]+)\s*\)\s*REFERENCES\s+"([^"]+)"\s*\(\s*([^)]+)\s*\)/gi;
  while ((m = alterFkRe.exec(stripped)) !== null) {
    fks.push({
      migrationFile: filename,
      childTable: m[1],
      childCols: parseColumnList(m[2]),
      parentTable: m[3],
      parentCols: parseColumnList(m[4]),
    });
  }

  return fks;
}

// Identity key used to compare a declared FK against the live FKs read
// from `pg_constraint`. The shape (child_table, child_cols, parent_table,
// parent_cols) is the relationship the migration *meant* to install; the
// constraint name is intentionally excluded because the same FK can be
// re-derived by `drizzle-kit push` under a different auto-generated name
// (`_fkey` vs. the migration's `_fk`). A match on shape is what proves
// the cascade / cross-table integrity is actually enforced.
function fkKey(
  childTable: string,
  childCols: string[],
  parentTable: string,
  parentCols: string[],
): string {
  return `${childTable}|${childCols.join(",")}|${parentTable}|${parentCols.join(",")}`;
}

// Produce the list of declared FKs that have no matching constraint on
// the live DB. Pulled out of the test body so the sibling sanity-check
// test (which tampers a live FK in a transaction) can call the exact
// same detection logic — the verification is meaningful only if the
// same code path is what catches the regression.
export function findMissingFks(
  declared: DeclaredFk[],
  live: LiveFkRow[],
): DeclaredFk[] {
  const liveKeys = new Set(
    live.map((r) =>
      fkKey(r.child_table, r.child_cols, r.parent_table, r.parent_cols),
    ),
  );
  return declared.filter(
    (d) =>
      !liveKeys.has(
        fkKey(d.childTable, d.childCols, d.parentTable, d.parentCols),
      ),
  );
}

// Reading every public-schema FK in one shot is faster and more robust
// than one query per declared FK: a single round-trip stays consistent
// even if the schema changes mid-test. `array_agg ORDER BY u.ord`
// preserves the *declared* column order on both sides, which matters
// for composite FKs where (a, b) -> (id, company_id) is a different
// constraint from (b, a) -> (id, company_id).
const LIVE_FK_QUERY = `
  SELECT
    cls.relname AS child_table,
    pcls.relname AS parent_table,
    (SELECT array_agg(att.attname::text ORDER BY u.ord)
       FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = u.attnum
    )::text[] AS child_cols,
    (SELECT array_agg(att.attname::text ORDER BY u.ord)
       FROM unnest(c.confkey) WITH ORDINALITY AS u(attnum, ord)
       JOIN pg_attribute att ON att.attrelid = c.confrelid AND att.attnum = u.attnum
    )::text[] AS parent_cols
  FROM pg_constraint c
  JOIN pg_class cls  ON cls.oid  = c.conrelid
  JOIN pg_class pcls ON pcls.oid = c.confrelid
  JOIN pg_namespace ns ON ns.oid = cls.relnamespace
  WHERE c.contype = 'f' AND ns.nspname = 'public'
  ORDER BY cls.relname, c.conname
`;

function loadAllDeclaredFks(): DeclaredFk[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const fks: DeclaredFk[] = [];
  for (const name of files) {
    const content = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
    fks.push(...parseDeclaredFks(name, content));
  }
  return fks;
}

test.describe("foreign keys declared by migrations must exist on the live DB @db", () => {
  test.skip(
    !DATABASE_URL,
    "DATABASE_URL not set — DB-level FK coverage test cannot run",
  );

  let pool: pg.Pool;

  test.beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  test.afterAll(async () => {
    await pool?.end();
  });

  test("every migration-declared FK is present in pg_constraint", async () => {
    const declared = loadAllDeclaredFks();

    // Belt-and-braces: if the parser ever silently regresses to picking
    // up zero FKs (e.g. a regex break) the test below would vacuously
    // pass with an empty `missing` list. Anchor on a known FK from
    // migration 0011 — the very drift that motivated this spec — so a
    // parser regression fails loudly here instead.
    expect(
      declared.length,
      "Parser found 0 declared FKs across all migrations. Either the " +
        "migrations folder is empty or the parser has regressed — every " +
        "FK declared in migrations would silently pass the live-DB check.",
    ).toBeGreaterThan(0);
    const anchor = declared.find(
      (d) =>
        d.migrationFile === "0011_email_delivery_alert_recipients.sql" &&
        d.childTable === "email_delivery_alert_recipients" &&
        d.childCols.length === 1 &&
        d.childCols[0] === "alert_id" &&
        d.parentTable === "email_delivery_alerts",
    );
    expect(
      anchor,
      "Parser failed to extract the inline `alert_id REFERENCES " +
        "email_delivery_alerts(id)` FK from " +
        "0011_email_delivery_alert_recipients.sql. This is the canonical " +
        "example of the silent-FK-drop the spec exists to catch — if the " +
        "parser misses it, the spec would silently pass even with the " +
        "constraint missing.",
    ).toBeDefined();

    const { rows: live } = await pool.query<LiveFkRow>(LIVE_FK_QUERY);
    const missing = findMissingFks(declared, live);

    expect(
      missing,
      missing.length === 0
        ? ""
        : "One or more migration-declared foreign keys are missing from " +
            "pg_constraint on the live database. This is the exact class " +
            "of silent drift that broke the email_delivery_alert_recipients " +
            "cascade in task #188 — the migration declared the FK but the " +
            "constraint never made it onto the running DB, so the cascade " +
            "never fired:\n" +
            missing
              .map(
                (m) =>
                  `  - ${m.migrationFile}: ` +
                  `"${m.childTable}" (${m.childCols.join(", ")}) ` +
                  `-> "${m.parentTable}" (${m.parentCols.join(", ")})`,
              )
              .join("\n") +
            "\n\nFix: add a follow-up migration that re-creates the FK " +
            "(guarded by a `pg_constraint` check so it stays idempotent — " +
            "see migrations/0017_email_delivery_alert_recipients_fk.sql " +
            "for the template) and pin the same FK in the relevant " +
            "`shared/models/*.ts` so `drizzle-kit push` keeps it in place.",
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The test above only checks that the helper *passes* on the current DB.
  // That alone is not enough proof the helper actually fires: a regex
  // change that returned zero declared FKs, or a query change that joined
  // every constraint into the live set, would also pass vacuously. The
  // sanity check below tampers a known live FK in a transaction (DROP it),
  // re-runs the helper, and asserts it names the constraint that just went
  // missing. The transaction is always rolled back so the production
  // constraint is restored even if the assertions throw.
  // -------------------------------------------------------------------------
  test("the missing-FK detector trips when a known FK is dropped", async () => {
    const declared = loadAllDeclaredFks();

    // Pick an FK from migration 0017 — it's the canonical "we re-installed
    // this FK" constraint and is definitely present on every freshly
    // migrated DB. If a future schema change ever removes it, this anchor
    // fails loudly so a future engineer knows to pick a different one
    // rather than silently weakening the sanity check.
    const TARGET_CHILD = "email_delivery_alert_recipients";
    const TARGET_CONSTRAINT = "email_delivery_alert_recipients_alert_id_fk";
    const targetDeclared = declared.find(
      (d) =>
        d.childTable === TARGET_CHILD &&
        d.childCols.length === 1 &&
        d.childCols[0] === "alert_id",
    );
    expect(
      targetDeclared,
      `No declared FK on "${TARGET_CHILD}.alert_id" was parsed out of any ` +
        `migration. The sanity-check anchor needs an FK that's both ` +
        `migration-declared *and* present on the live DB — pick a ` +
        `different one.`,
    ).toBeDefined();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // ALTER TABLE ... DROP CONSTRAINT is transactional in Postgres, so
      // the ROLLBACK in `finally` truly undoes the drop — no leaked
      // missing FK.
      await client.query(
        `ALTER TABLE "${TARGET_CHILD}" DROP CONSTRAINT IF EXISTS "${TARGET_CONSTRAINT}"`,
      );
      // Drizzle-kit push may have *also* installed an autogenerated
      // `_fkey` variant of the same FK; drop it too so the helper sees
      // a genuinely missing relationship. Both names are scoped to the
      // same conrelid so we'll only ever drop FKs on this child table.
      await client.query(
        `ALTER TABLE "${TARGET_CHILD}" DROP CONSTRAINT IF EXISTS "${TARGET_CHILD}_alert_id_fkey"`,
      );

      const { rows: live } = await client.query<LiveFkRow>(LIVE_FK_QUERY);
      const missing = findMissingFks(declared, live);

      const flagged = missing.find(
        (m) =>
          m.childTable === TARGET_CHILD &&
          m.childCols.length === 1 &&
          m.childCols[0] === "alert_id",
      );
      expect(
        flagged,
        `findMissingFks() failed to flag the dropped FK on ` +
          `"${TARGET_CHILD}.alert_id". The detector is a no-op — the ` +
          `production-facing test above would silently pass on a real ` +
          `regression.`,
      ).toBeDefined();
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }

    // Belt-and-braces: after rollback, re-read the live FKs and assert
    // the dropped constraint is back. If this fails, the rollback didn't
    // take and the production FK is now genuinely missing — fail loudly
    // so the operator knows to re-apply the migration immediately.
    const { rows: postRollback } = await pool.query<LiveFkRow>(LIVE_FK_QUERY);
    const stillThere = postRollback.find(
      (r) =>
        r.child_table === TARGET_CHILD &&
        r.child_cols.length === 1 &&
        r.child_cols[0] === "alert_id" &&
        r.parent_table === "email_delivery_alerts",
    );
    expect(
      stillThere,
      `After ROLLBACK, the FK on "${TARGET_CHILD}.alert_id" is missing ` +
        `from pg_constraint. The rollback may not have restored it — ` +
        `re-run migrations/0017_email_delivery_alert_recipients_fk.sql ` +
        `immediately.`,
    ).toBeDefined();
  });
});
