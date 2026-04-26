# Smart Financial Assistant (محاسب ذكي)

## Overview

"محاسب ذكي" (Smart Accountant) is an Arabic-language personal finance management application designed for multi-country use, specifically tailored for the MENA region. It provides comprehensive financial tracking, AI-powered assistance, and advanced IFRS-compliant accounting features for individuals and businesses.

Key Capabilities:
- **Financial Tracking**: Income and expense tracking through a dynamic transactions dashboard and visual summaries (charts).
- **AI Assistant**: Natural language processing for logging transactions via chat, including image uploads (e.g., receipts) for intelligent assistance, powered by OpenAI.
- **Double-Entry Accounting**: Full IFRS-compliant system with a Chart of Accounts, Journal Entries, and generation of IFRS statements.
- **Decision Cockpit (`/insights`)**: Offers financial health scores, alerts, cash flow forecasting, what-if simulations, budgeting tools, and an AI financial coach.
- **Multi-Country Localization**: Supports 7 country packs (INTL, SA, AE, EG, KW, QA, JO) with configurable currency, VAT rates, zakat toggles, weekend days, social insurance rates, and end-of-service formulas.
- **HR & Payroll (`/hr`)**: Integrated module for managing employees, attendance, leaves, and automating monthly payroll runs with auto-posted journal entries adhering to IAS 19 provisions.
- **Smart Document Inbox (`/app/inbox`)**: Upload receipt/invoice images **or capture them live with the device camera** (rear-facing by default, switchable to front; uses `react-webcam` + `browser-image-compression` with an autoLevels-style contrast-stretch + gamma enhancement pass before compression — 4-language UI: ar/en/de/fr). An OpenAI vision pipeline extracts vendor, date, totals, VAT (GCC-aware), and proposes a balanced IFRS-correct journal entry against the live chart of accounts. User reviews/edits and posts in one click; the original file is retained and linked to the resulting journal entry. Posting is atomic (`ready→posting→posted`) to prevent duplicate journal entries from concurrent confirms; deduped storage uses reference counting on delete.

The application is built as a full-stack TypeScript monorepo, utilizing a React frontend and an Express backend, with shared schema and route definitions to ensure consistency and a sophisticated user experience.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application is a full-stack TypeScript monorepo utilizing a React frontend and an Express backend, with shared schema and route definitions for consistency.

### Frontend Architecture
- **Framework**: React with Vite.
- **Routing**: `wouter` for client-side navigation.
- **State Management**: TanStack React Query (v5) for server state with optimistic updates.
- **UI Components**: `shadcn/ui` based on Radix UI primitives, adhering to a refined "New York style" v2 visual design system.
- **Visual Design System**: Emphasizes a premium fintech aesthetic with:
    - Custom typography stack: IBM Plex Sans Arabic (primary, RTL), Inter (Latin), JetBrains Mono (tabular figures).
    - Muted color palette: warm off-white/deep ink for light mode, near-black/warm white for dark mode, with a single deep emerald brand color and an earthy 5-color chart palette.
    - Refined radii, shadow tokens, and spacing rhythm tokens for consistent UI.
    - Enhanced UI primitives for `Button`, `Card`, `Input`, `Badge`, and `Table`.
    - Layout shells for `Brand`, `AppNavbar`, and `AppFooter`.
    - New utilities like `.eyebrow`, `.text-display`, `.glass-surface`, and `.hairline`.
    - Signature `.brand-mesh` and `.brand-grain` surface treatments.
    - Comprehensive `/styleguide` as the source of truth for the design system.
    - Updated app shell and cockpit design for authenticated users, including a redesigned sidebar and main content area.
    - Standardized inner page layouts (Transactions, AI Assistant, Chart of Accounts, Journal Entries, Reports, Settings, HR, Fixed Assets, Insights) to align with the visual system, eliminating legacy styling.
    - Improved display of financial metrics with radial progress rings and Mercury/Stripe-inspired currency chips.
    - Decluttered TopBar by consolidating controls and refining gain/loss tones using dedicated color tokens.
    - Custom underline tab strip (`.ledger-tabs`) for editorial surfaces.
    - Public marketing landing page (`/`) built on the visual system, with asymmetric grids, bento layouts, and showcase sections.
- **RTL Layout**: The entire application is built with `dir="rtl"` as a primary consideration, ensuring correct layout for Arabic.
- **Charts**: Recharts is used for displaying financial data.
- **Forms**: React Hook Form with Zod resolvers for validation.
- **Path aliases**: `@/` for `client/src/` and `@shared/` for `shared/`.

### Backend Architecture

- **Framework**: Express 5 (TypeScript, ESM).
- **Entry Point**: `server/index.ts` handles route registration.
- **API Contract**: Shared `shared/routes.ts` defines API paths, HTTP methods, and Zod schemas for input/response validation, ensuring client-server consistency.
- **Storage Layer**: `server/storage.ts` provides an `IStorage` interface for database abstraction.
- **AI Integration**: OpenAI client integrated for AI chat assistance, using environment variables for API keys and base URLs.
- **Development**: Vite middleware embedded into Express for dev server.
- **Production**: `script/build.ts` orchestrates Vite (frontend) and esbuild (backend) builds.

### Data Storage

- **Database**: PostgreSQL, accessed via `drizzle-orm/node-postgres`.
- **ORM**: Drizzle ORM with schema defined in `shared/schema.ts`.
- **Schema**: Includes tables for `transactions`, `chatMessages`, `conversations`, `messages`, and `budgets`.
- **Migrations**: Managed by Drizzle Kit.
- **Seed Data**: `seed.ts` populates initial data.

### Workspace Isolation (Defense in Depth)

The app is multi-tenant; every workspace-scoped table carries `company_id`. Three independent layers prevent cross-workspace leaks — each is sufficient on its own, and any one regressing is caught by an e2e regression spec.

1. **Route guard (task #52)** — `requireAuth` + `attachMembership` reject any API request whose URL company id doesn't match an active membership. Exercised by `tests/e2e/workspace-isolation.spec.ts`.
2. **Composite foreign keys (tasks #70, #91)** — every child row has a composite `(parent_id, company_id)` FK back to the parent's `(id, company_id)`, so the database physically refuses cross-workspace writes regardless of route code. Installed by `migrations/0005_workspace_composite_fks.sql` and `migrations/0007_workspace_composite_fks_extension.sql` (applied on boot exactly once by the SQL migration runner in `server/migrate.ts`) and pinned by `tests/e2e/database-fk-cross-workspace.spec.ts`.
3. **Postgres row-level security (task #93)** — every workspace-scoped table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and a single `workspace_isolation` policy keyed on the `app.current_company_id` GUC. Per-request middleware (`server/db.ts → withCompanyScope`) checks out a pooled `pg.Client`, sets the GUC, and `SET ROLE app_api` (a non-superuser created by `migrations/0008_workspace_rls.sql` so superuser bypass doesn't defeat the policies) for the lifetime of the request via an `AsyncLocalStorage`-scoped Drizzle Proxy. A narrowly-audited `withRlsBypass(reason, fn)` escape hatch lets boot helpers and cross-workspace cron sweeps (e.g. email-delivery alerts) opt out. Pinned by `tests/e2e/database-rls-cross-workspace.spec.ts`. Full decision record: `docs/design/workspace-isolation-defense-in-depth.md`.

### Shared Contract Pattern

- `shared/routes.ts` and `shared/schema.ts` form the core shared contract, defining API endpoints and database schemas that are utilized by both frontend and backend to prevent discrepancies.

### Replit Integration Modules

Modular, plug-in-style integrations are located in `server/replit_integrations/` and `client/replit_integrations/`:
- **Chat**: Manages conversation and message storage, and OpenAI chat routes.
- **Audio**: Handles voice recording, PCM16 audio playback, speech-to-text/TTS via OpenAI, and WebM→WAV conversion via ffmpeg.
- **Image**: Supports image generation and editing via OpenAI.
- **Batch**: Provides utilities for rate-limited, auto-retry batch processing.

## External Dependencies

### APIs and AI
- **OpenAI API**: Used for AI chat, speech-to-text, text-to-speech, voice chat streaming, and image generation. Configured via `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`.

### Database
- **PostgreSQL**: Primary database. Connection string supplied via `DATABASE_URL`.

### Key npm Dependencies
- `drizzle-orm`, `drizzle-kit`, `drizzle-zod`: ORM and schema management.
- `zod`: Runtime validation.
- `@tanstack/react-query`: Client-side data fetching and server state management (v5).
- `wouter`: Lightweight React router.
- `recharts`: Charting library for financial data.
- `react-hook-form`, `@hookform/resolvers`: Form management and validation.
- `shadcn/ui`, `Radix UI`: UI component library adhering to the design system.
- `date-fns`: Date formatting (with `ar` locale).
- `openai`: OpenAI SDK.
- `p-limit`, `p-retry`: Batch processing utilities.
- `tailwind-merge`, `clsx`, `vaul`: UI utilities.

### Environment Variables Required
- `DATABASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Automated UI Checks

- **Mobile horizontal overflow** — `tests/e2e/mobile-overflow.spec.ts` is a Playwright check that loads every dense-table app page (Journal, Reports, Insights, Fixed Assets, HR, Chart of Accounts, Transactions) at a 360x720 viewport in both English (LTR) and Arabic (RTL) and asserts the document itself does not overflow horizontally. This is the regression net for new pages that forget the `.table-sticky-first` table wrapper or ship an `inline-flex` toolbar that would push the page wider than a phone viewport. Run it with `PLAYWRIGHT_NO_WEBSERVER=1 npx playwright test --reporter=line` while the dev server is up, or via the registered `mobile-overflow` validation command. See `tests/mobile-overflow-check.md` for the full rationale and failure-mode playbook.
- **Pre-commit role-guard hook** — `.husky/pre-commit` runs `scripts/check-role-guard-coverage.ts` before every `git commit`, blocking the commit locally with the same actionable message the `role-guard-coverage` validation step prints if a `<WriteGuard>` / `<OwnerGuard>` / `<OwnerOnly>` button is missing owner/accountant/viewer coverage in `tests/e2e/role-based-buttons.spec.ts`. The hook is wired up by `scripts/post-merge.sh` (sets `git config core.hooksPath .husky`) so every clone picks it up after the first task merge — or set it once manually with `git config core.hooksPath .husky`. The static check itself runs in ~0.5s; bypass with `git commit --no-verify` if absolutely necessary (the validation pipeline still catches the regression later).
- **Bilingual dashboard shell** — `tests/e2e/dashboard-shell.spec.ts` is a Playwright suite that authenticates a seeded test user (via `tests/e2e/dashboard-shell.setup.ts`, which forges a signed `connect.sid` straight into the `sessions` table so the browser can present the cookie over plain HTTP) and then asserts: (1) pixel-stable visual snapshots of `/app` for the four locale × theme combinations en-light, en-dark, ar-light, ar-dark with timestamps and currency cells masked, (2) the ⌘K command palette opens on `Meta+K` and closes on `Escape`, (3) every KPI card is reachable via Tab focus, and (4) WCAG AA contrast (≥4.5:1) on KPI delta chips and Recent Activity rows in both themes — computed with a hand-rolled `getComputedStyle` luminance calculator so no extra a11y dep is required. Snapshots live under `tests/e2e/dashboard-shell.spec.ts-snapshots/`. The suite runs as part of the same `mobile-overflow` validation command (Playwright executes every project unless filtered).

## Locale-aware PDF rendering

Every server-generated PDF (sales invoice, Trial Balance, Profit & Loss, Balance Sheet) renders in whichever of the four supported locales (`ar` / `en` / `de` / `fr`) the user has selected — no hardcoded ar+en bilingual strings.

- **Translation tables (`server/i18n/pdf-strings.ts`)** — single source of truth for every PDF label, in all four locales. Exposes `t(locale, key)`, `dirFor(locale)`, `pickName(locale, nameAr, nameEn)`, `formatLocaleDate(locale, date)`, plus enum helpers `invoiceStatus`, `paymentMethod`, `accountType`, and the type guard `isLocale`. Coverage is enforced by `server/i18n/__tests__/pdf-strings.test.ts` (no key may be missing, empty, or fall through to `undefined` in any locale).
- **Arabic shaping pipeline (`server/services/pdf-arabic.ts`)** — hand-rolled Presentation-Forms shaper + bidi flip for pdfkit (Helvetica has no Arabic coverage). Three regression-locked invariants: (1) `stripBidiControls()` removes embedded U+200E/U+200F/U+061C/U+202A-E/U+2066-9 before shaping (they used to leak through as missing-glyph rectangles); (2) every `.text()` call drawing a pre-shaped Arabic string passes `lineBreak: false` via `arabicTextOptions()` so pdfkit's word-wrap, which runs *after* bidi, no longer eats the inter-word space (the "النقد بالصندوق" → "النقدبالصندوق" bug); (3) pure-Arabic strings (no digits, no paired brackets, no Latin) bypass `bidi-js` and just reverse the reshaped char array — bidi-js's neutral-handling collapses inter-word space on short cell strings. Strings containing Arabic-Indic digits (U+0660..U+0669), Eastern Arabic-Indic digits (U+06F0..U+06F9), or paired brackets are kicked back to bidi-js so digit runs stay in logical order and brackets get mirrored correctly. Tests in `server/services/__tests__/pdf-arabic.test.ts`.
- **Locale plumbing (`server/lib/locale.ts`)** — `parseLangParam(req)` reads `?lang=` first, then `body.locale`, then falls back to `"ar"`, validating against the four-locale set. `GET /api/sales/invoices/:id/pdf` consumes it; the chat route forwards the user's UI locale into `executeTool` ctx so the AI assistant's `generate_report` tool produces PDFs in the same language the user is viewing.
- **Frontend** — `client/src/pages/sales/invoice-detail.tsx :: downloadPdf` appends `?lang=${locale}` from `useLocale()` so the PDF download honours whatever the locale switcher (or `?lang=` URL override) is currently showing.
- **E2E lock** — `tests/e2e/sales-invoice-pdf-locale.spec.ts` hits the route with each of the four `?lang=` values + the no-param default + an invalid value, and asserts the PDF's `/Info` Title metadata contains the expected localized title (and none of the other three locales' titles), guaranteeing French users no longer get Arabic-titled PDFs.
