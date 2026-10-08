# Five-bug fix — independent review

The branch `fix/five-bugs` (single commit `66aafce` on base `63ed67a`) resolves the five
pre-existing ERP bugs documented in `five-bugs-investigation.md`: Smart Inbox upload, Journal
period visibility, bank-account 400, missing Add-item button, and HR workspace scoping + i18n.
The implementation follows the "smallest safe fix" proposed for each bug, adds one new helper
and one new test, and leaves accounting-integrity guards and `.env` untouched. The coder's
tsc run was clean (exit 0) and the vitest suite shows no new failures — the 5 failing tests are
environmental (`DATABASE_URL` unset at import time) and reproduce on the stashed baseline.

Watch for: nothing blocking. All five fixes land on the exact root causes the report identified.

**Verdict**: APPROVED

<details>
<summary>Issues (0)</summary>

No blocking or actionable findings.

</details>

---

## BUG 1 — Smart Inbox upload (+ camera) — PASS

The primary root cause (raw `fetch` to `/api/documents` omitting `X-Company-Id`) is fixed
cleanly. A new `uploadFormData(url, fd)` helper in `client/src/lib/queryClient.ts:76-87` posts
the multipart body with `headers: buildHeaders()` (which injects `X-Company-Id` from
`active_company_id`) and crucially does **not** set `Content-Type`, so the browser supplies the
multipart boundary. `inbox.tsx:308-319` now calls this helper instead of the bare fetch, and the
camera path shares the same `uploadMut` mutation, so both upload paths are fixed by the single
change. S3 behavior is preserved.

The S3 secondary fix matches the report's constraint: `@aws-sdk/credential-providers` is not a
declared dependency, so instead of adding `fromIni`, the coder documented the ambient-chain
reliance at `server/ai/object_storage/objectStorage.ts:108-117` with a clear comment explaining
that `AWS_PROFILE` must resolve valid credentials and what the 500 symptom means. Storage was
not switched to local disk. This is the acceptable alternative the task allowed.

## BUG 2 — Journal period visibility — PASS

`journal-entries.tsx:65-78` adds a one-shot mount effect (guarded by a `useRef`) that calls
`setPeriodKey("ytd")` only when the inherited global key is `"month"`. `ytd` is a valid
`PeriodKey` (`period-context.tsx:7`) and `setPeriodKey` is exposed by the context. Because the
effect runs once and only overrides the `"month"` default, a user's later explicit period
selection is left alone, and the global default for other pages is unchanged. No `63ed67a`
accounting-integrity guard (forced `source:"manual"`, header-account guard, transaction-JE
delete refusal) was weakened — the diff touches only the client page.

## BUG 3 — Bank account 400 — PASS

`server/routes.ts:3877-3884` extends `insertBankAccountSchema` with
`openingBalance: z.coerce.string().optional()` at the `POST /api/banking/accounts` boundary, so a
numeric body coerces to a string and validates (201) instead of failing with the drizzle-zod
"expected string" 400. The same coercion is applied to the sibling `POST /api/banking/transactions`
`amount` field at `routes.ts:3933-3939` (`z.coerce.string()`), as required. `z` is already
imported (`routes.ts:38`). The new test `server/__tests__/banking-opening-balance-coercion.test.ts`
asserts the raw schema rejects a numeric `0`, the extended account schema coerces it to a string,
and the transaction `amount` coercion works — 3/3 green per the verification note.

## BUG 4 — Add-item button — PASS

`items.tsx` now renders an "Add item" button in the header right slot inside `<WriteGuard>`
(`data-testid="button-add-item"`), wired to `setCreating(true)`. The `createMut` mutation POSTs
`apiRequest("POST", "/api/sales/products", data)` and, on success, invalidates the same five
caches as `updateMut` via the shared `invalidateProductCaches()` helper (`/api/sales/products`,
`/api/products`, inventory alerts/valuation/stock-levels). The create dialog is a new sibling of
the existing edit dialog (driven by a separate `creating` boolean), not a duplicate — the edit
dialog remains bound to `editing`. The create schema picks the full createable field set
(sku/names/prices/unit/minStock/category/costing/isService) via `insertProductSchema.pick`, and
`onError` surfaces the server 400 (e.g. duplicate SKU). New keys `inv_add_item`, `inv_create_item`,
`inv_is_service` exist in `dict.ts` with all four locales.

## BUG 5a — HR dependent reads carry X-Company-Id — PASS

All four HR raw-`fetch` reads now send the workspace header
`{ "X-Company-Id": localStorage.getItem("active_company_id") ?? "" }` with `credentials: "include"`:
attendance records (`hr.tsx:345-348`), payroll preview current month (`hr.tsx:806-809`), payroll
preview previous month (`hr.tsx:818-821`), and payroll-run lines (`hr.tsx:1287-1290`). Each is
documented with a comment explaining the prior wrong-workspace symptom. This routes the dependent
reads to the same workspace as the header-carrying employee create, so a newly added employee now
appears in the Attendance and Payroll-preview tables. No server change was needed.

## BUG 5b — HR i18n re-keying — PASS

The re-keying is complete. A Unicode scan for Arabic literals (`[\u0600-\u06FF]`) over `hr.tsx`
returns zero matches — no stray rendered Arabic remains when English is active. Every component
imports and uses `useT()` and resolves user-facing strings through `t()`. Every HR dialog uses
`dir={dir}` from `useLocale()` (`hr.tsx:170, 282, 485, 699, 1149, 1194`) instead of a hardcoded
`dir="rtl"`; a scan for the `"rtl"`/`'rtl'` literal returns zero matches. The 153 new `hr_*` keys
added to `dict.ts` all carry ar/en/de/fr entries (153/153).

## Cross-cutting — PASS

`.env` is not in the diff (untouched). The changed-file set is confined to the eight files the
fixes require plus the verification note and the new test — no unrelated refactors. tsc is clean
and the vitest failures are pre-existing/environmental (`DATABASE_URL` unset), proven by the
coder's stash-to-baseline re-run; no new failures were introduced. Per the task constraint, the
coder's tsc and full-suite runs were not re-executed; the narrow spot-checks above (dict locale
completeness, Arabic/rtl literal scans, import presence, period-key validity) left no articulable
doubt requiring a suite re-run.

<details>
<summary>File map</summary>

- `client/src/lib/queryClient.ts` — new `uploadFormData` helper (header-carrying multipart POST).
- `client/src/pages/inbox.tsx` — upload mutation routed through `uploadFormData`.
- `client/src/pages/journal-entries.tsx` — default page period to ytd once on mount.
- `server/routes.ts` — openingBalance + amount coercion at banking route boundaries.
- `client/src/pages/inventory/items.tsx` — Add-item button, create dialog + mutation.
- `client/src/pages/hr.tsx` — four reads send X-Company-Id; full i18n re-key; `dir` from locale.
- `client/src/i18n/dict.ts` — new inv_* and 153 hr_* keys (ar/en/de/fr).
- `server/ai/object_storage/objectStorage.ts` — documented ambient AWS credential-chain reliance.
- `server/__tests__/banking-opening-balance-coercion.test.ts` — new coercion test (3 cases).
- `.agents/tasks/five-bugs-verification.md` — coder's verification note.

Full diff: `git -C <worktree> diff 63ed67a...fix/five-bugs`

</details>
