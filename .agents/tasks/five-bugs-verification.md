# Five-Bugs Fix — Verification Note

Branch: `fix/five-bugs` (worktree `.worktrees/five-bug-fixes`)
Baseline commit: `63ed67a`.
Environment: Windows + PowerShell. `node_modules` was installed in the worktree
with `npm ci` (the worktree shipped without one). `DATABASE_URL` is NOT set in
this environment, so DB-gated suites skip or (for one unguarded file) fail at
import — see "Pre-existing failures" below.

## Commands run and results

### 1. Type-check — PASS (exit 0)
```
node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Exit code 0, no diagnostics. Run after all edits were applied.

### 2. Full test suite
```
node ./node_modules/vitest/vitest.mjs run
```
Result: `Test Files 4 failed | 22 passed | 5 skipped (31)`,
`Tests 5 failed | 226 passed | 18 skipped (249)`.

- The **5 failing tests** are all in `server/__tests__/session-secret.test.ts`.
  They fail with `DATABASE_URL must be set. Did you forget to provision a
  database?` — thrown at *import* time because that test imports `../setup`,
  which pulls in `../db` (reads `DATABASE_URL` on module load). This is an
  ENVIRONMENTAL failure, not a regression.
- The **3 "(0 test)" files**
  (`depreciation-run-delete-atomic-rollback`, `purchases`, `sales-payments`)
  are DB-gated with `describe.skip` when `DATABASE_URL` is absent, so they
  collect zero tests. Also environmental.

#### Proof the failures are pre-existing (not caused by these changes)
Stashing all eight edited files back to baseline `63ed67a` and re-running the
session-secret file still yields `5 failed`:
```
git stash push -- <the 8 edited files>
node ./node_modules/vitest/vitest.mjs run server/__tests__/session-secret.test.ts
# → Tests 5 failed (5)   (DATABASE_URL must be set)
git stash pop
```
None of the edited files touch `session-secret.test.ts`, `server/setup.ts`, or
`server/db.ts`. No NEW failures were introduced vs baseline.

### 3. New banking-route coercion test — PASS (3/3)
```
node ./node_modules/vitest/vitest.mjs run server/__tests__/banking-opening-balance-coercion.test.ts
```
`Test Files 1 passed (1)`, `Tests 3 passed (3)`:
- raw `insertBankAccountSchema` REJECTS a numeric `openingBalance: 0` (the
  original HTTP 400),
- the route's extended schema ACCEPTS numeric `0` and coerces it to the string
  `"0"` (the DB numeric column then stores the `"0.00"`-style value),
- the sibling `POST /api/banking/transactions` `amount` coercion accepts a
  numeric body and coerces to a string.

No live DB is required — the test exercises the exact zod schemas the routes
build at their validation boundary, so it runs green in this environment.

## Code-inspection confirmations
- **Inbox upload** (`client/src/pages/inbox.tsx`): the upload mutation now calls
  `uploadFormData("/api/documents", fd)` (new helper in `queryClient.ts`) which
  sends the `X-Company-Id` header via `buildHeaders()` and does NOT set
  `Content-Type` (browser sets the multipart boundary). Camera capture shares
  the same mutation.
- **Four HR reads** now send `X-Company-Id`:
  attendance records (`hr.tsx` ~337), payroll preview current + previous month
  (~771, ~784), and payroll-run lines (~1245) — each custom `queryFn` passes
  `headers: { "X-Company-Id": localStorage.getItem("active_company_id") ?? "" }`
  with `credentials: "include"`. (The default `getQueryFn` here does
  `queryKey.join("/")` and cannot serialize object params, so the header-in-
  custom-queryFn fallback from the task was used rather than deleting the fns.)
- **HR i18n**: `client/src/pages/hr.tsx` has NO remaining Arabic string literals
  (regex scan `[\u0600-\u06FF]` → no matches). All user-facing strings resolve
  through `t()` (via `useT()`), and every HR dialog uses `dir={dir}` from
  `useLocale()` instead of a hardcoded `dir="rtl"`. New keys added to
  `client/src/i18n/dict.ts` with ar/en/de/fr.
- **Add-item button** (`client/src/pages/inventory/items.tsx`): renders inside
  `<WriteGuard>` in the header right slot (`data-testid="button-add-item"`),
  opening a create dialog that POSTs via `apiRequest("POST","/api/sales/products")`
  and invalidates the same caches as the edit mutation.
- **Journal** (`client/src/pages/journal-entries.tsx`): defaults this page to
  year-to-date once on mount (only overriding the inherited global `"month"`
  default; a user's later explicit selection is left alone). No 63ed67a
  accounting-integrity guard was weakened.
- **S3** (`server/ai/object_storage/objectStorage.ts`): `@aws-sdk/credential-providers`
  is NOT a declared dependency, so per the task constraint it was NOT added.
  A clear comment documents the ambient-chain reliance and that `AWS_PROFILE`
  must resolve. `OBJECT_STORAGE_PROVIDER=s3` behavior is unchanged.
