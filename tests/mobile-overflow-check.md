# Mobile horizontal overflow regression check

Automated Playwright check that catches a future page (or table) that
forgets the `.table-sticky-first` wrapper or otherwise overflows the viewport
on a small phone. It is intentionally cheap and selector-free: it loads each
app and public marketing page at 360x720 and asserts that the document itself
does not overflow horizontally. Overflow inside an intentional scroll container (e.g. a table
wrapped in `.table-sticky-first` or `overflow-x-auto`) is allowed by design —
only the document/body overflowing the viewport fails the check.

- Test file: `tests/e2e/mobile-overflow.spec.ts`
- Config: `playwright.config.ts`

## How to run

The dev server must be running on port 5000 (the project's `Start application`
workflow does this automatically). Then either:

```bash
# Reuse the already-running dev server (fast, recommended in this Repl):
PLAYWRIGHT_NO_WEBSERVER=1 npx playwright test --reporter=line

# Or let Playwright spin up `npm run dev` itself:
npx playwright test --reporter=line
```

The same command is registered as the `mobile-overflow` validation step in
this Repl, so it can be invoked through the project's validation runner.

## What it covers

Pages × locales (20 combinations total):

App shell (authenticated, dense tables):

| Page                  | Path                  |
| --------------------- | --------------------- |
| Journal Entries       | `/app/journal`        |
| Reports               | `/app/reports`        |
| Insights              | `/app/insights`       |
| Fixed Assets          | `/app/fixed-assets`   |
| HR / Payroll          | `/app/hr`             |
| Chart of Accounts     | `/app/accounts`       |
| Transactions          | `/app/transactions`   |

Public marketing surface (the first thing prospects see on a phone):

| Page            | Path                                    |
| --------------- | --------------------------------------- |
| Landing         | `/`                                     |
| Demo request    | `/demo`                                 |
| Invite accept   | `/invite/sample-overflow-check-token`   |

Each is loaded once with `app.locale` set to `en` (LTR) and once with `ar`
(RTL) — the second pass also exercises the RTL sticky-shadow direction in
`.table-sticky-first`. The invite token does not need to be valid: the page
renders its accept form regardless and only hits the API on submit.

For every (path × locale) the test asserts:

- `document.documentElement.dir` matches the active locale (`ltr` / `rtl`).
- `document.documentElement.scrollWidth <= window.innerWidth + 1` (1px slack
  for sub-pixel rounding).
- `document.body.scrollWidth <= window.innerWidth + 1`.

## What it intentionally does NOT cover

* Tables wrapped in `overflow-x-auto` / `.table-sticky-first` are expected to
  scroll horizontally. The check only flags the document itself overflowing.
* Visual regressions (pixel diffs) — that is a separate check.
* Authentication flows — the workspace owner cookie is bootstrapped on the
  first `/app` request, so no login UI is required.

## When this fails

A failure means one of:

1. A new dense table was added without the `.table-sticky-first` wrapper.
2. A toolbar (segmented control, tab row, etc.) is `inline-flex` and
   overflows. Wrap it in `-mx-4 overflow-x-auto px-4 lg:overflow-visible
   lg:mx-0 lg:px-0` so it scrolls inside the page padding instead of pushing
   the document wider.
3. A KPI grid forgot to collapse to a single column at the smallest
   breakpoint.

The relevant CSS helper lives in `client/src/index.css` (`.table-sticky-first`,
roughly lines 460–484).
