# Smart Financial Assistant (محاسب ذكي)

## Overview

This is an Arabic-language personal finance management application called "محاسب ذكي" (Smart Accountant). It allows users to:

- Track income and expenses via a transactions dashboard
- View financial summaries and charts (pie charts and bar charts via Recharts)
- Interact with an AI assistant (powered by OpenAI) to log transactions via natural language chat, including image uploads (e.g., receipts)
- Full IFRS-compliant double-entry accounting (Chart of Accounts, Journal Entries, IFRS statements)
- Decision Cockpit (`/insights`): health score, alerts, cash forecast, what-if simulator, budgets, AI coach
- **Multi-country localization** (`/settings`): 7 country packs (INTL, SA, AE, EG, KW, QA, JO) with configurable currency, VAT rate, zakat toggle, weekend days, social-insurance rates, and end-of-service formulas. IFRS is the universal core; country specifics are pluggable.
- **HR & Payroll** (`/hr`): Employees, attendance, leaves, monthly payroll runs with auto-posted journal entries (IAS 19 end-of-service & accrued-leave provisions, social-insurance employer + employee shares, configurable per country pack)

### Key files for the localization + HR layer
- `shared/localization.ts` — country packs and IAS 19 helpers
- `shared/coa-seed.ts` — `PAYROLL_EXTRA_ACCOUNTS` adds 6011/6012/2150/2160/2220 on top of base COA
- `server/payroll.ts` — `computePayrollPreview` + `runPayroll` (30-day standard divisor, fractional EoS rate)
- `server/init-coa.ts` — bootstraps base COA + payroll accounts on every startup
- Settings is a singleton row at `id=1` in the `settings` table
- Currency display in new code uses `useFormatMoney()` from `client/src/lib/format.ts` (older pages still hardcode ر.س; can be migrated incrementally)

The app is built as a full-stack TypeScript monorepo with a React frontend and an Express backend, sharing schema and route definitions through a `shared/` directory.

---

## User Preferences

Preferred communication style: Simple, everyday language.

---

## System Architecture

### Frontend Architecture

- **Framework**: React (with Vite as the bundler)
- **Routing**: `wouter` (lightweight client-side router)
- **State/Data fetching**: TanStack React Query (v5) for server state management, with optimistic updates on mutations
- **UI Components**: shadcn/ui (New York style) built on Radix UI primitives — refined under the v2 visual design system (see "Visual Design System" section below).

### Visual Design System (Phase 1 — April 2026)

A premium fintech aesthetic foundation. Source of truth: `client/src/index.css` (tokens) + `tailwind.config.ts` (mapping).

- **Typography stack**: IBM Plex Sans Arabic (primary, RTL), Inter (Latin pairing), JetBrains Mono (tabular figures, codes, KPIs). Loaded non-blocking from `client/index.html`. Cairo retained as fallback only. All numerals are tabular by default (`font-variant-numeric: tabular-nums` applied globally to `td`, `th`, `.tabular-nums`, `[data-num]`).
- **Color palette**: warm off-white paper (`36 14% 98%`) + deep ink foreground (`222 24% 11%`) on light; near-black (`220 18% 7%`) + warm white on dark. Single brand action color = deep emerald (`158 64% 28%` light / `158 56% 52%` dark). Earthy 5-color chart palette (emerald / ink-blue / ochre / coral / slate). No generic SaaS blue, no purple gradients, no rainbow charts.
- **Radii**: `--radius: 0.625rem` (10px) base, with Tailwind's `xl`/`lg`/`md`/`sm`/`xs` mapped relatively (14/10/8/6/4 px). The previous 1rem (16px) "very rounded friendly corners" is gone — refined fintech, not consumer-app.
- **Shadow tokens**: `--shadow-xs/sm/md/lg/xl` (soft, premium, low-opacity slate) + `--shadow-ring` for focus states. Replaces the `translate-Y` "lift" hover with a subtler `bg-accent` hover transition.
- **Spacing rhythm tokens**: `--space-section` (96px), `--space-block` (64px), `--space-card` (24px), `--space-tight` (12px). Use these to keep section/block spacing consistent across pages.
- **Refined primitives**: `Button` (added `subtle`, `link` variants and `xl`, `icon-sm` sizes; brand emerald default with hairline darker border), `Card` (variants: `default`, `flat`, `raised`, `ghost`), `Input` (refined hairline border, tabular numerals, focus uses brand color), `Badge` (tonal status pills: `success`, `warning`, `info`, `destructive`, `brand`, `muted` + `sm`/`md`/`lg` sizes), `Table` (eyebrow-style uppercase headers, tabular figures, density `compact`/`comfortable`).
- **Layout shells**: `client/src/components/layout/Brand.tsx` (typographic wordmark — no icon-in-circle), `AppNavbar.tsx` (sticky, glass-on-scroll, hairline, restrained), `AppFooter.tsx` (multi-column, eyebrow labels, hairline meta bar). Standalone, ready for Phase 2 landing page and Phase 3 app-shell consumption.
- **New utilities**: `.eyebrow` (mono uppercase tracked label), `.text-display`/`-lg`/`-xl` (clamp-based marketing display sizes), `.glass-surface` (translucent backdrop-blur), `.hairline` / `.hairline-v` (1px rules). Custom focus ring via global `:where` rule using `--shadow-ring`.

The dashboard widgets (`dashboard.tsx`) and other page-level surfaces still use legacy hardcoded colors (e.g. blue-cyan gradient on the balance card, rose/emerald icon-on-circle treatments). These are out of scope for Phase 1 and will be addressed in Phase 3 (Dashboard & app-shell redesign).

### App Shell & Cockpit Redesign (Phase 3 — April 2026)

The authenticated product shell at `/app/*` was rewritten to match the public surface. Three files changed:

- `client/src/components/layout/app-sidebar.tsx` — replaced the legacy Wallet-icon-in-circle header and tall `py-6 rounded-xl` items with the typographic `<Brand>` wordmark, dense `h-9` items grouped by section (Overview / Books / People & assets / System) with eyebrow labels and a 2px primary active-indicator. Labels are bilingual via `useLocale`. RTL-aware: `side="right"` + left border in RTL, `side="left"` + right border in LTR. Footer carries a pulsing "متصل · مزامنة لحظية" / "Connected · live sync" status pill. `MobileHeader` now uses `<Brand size="sm">`.

- `client/src/components/layout/main-layout.tsx` — new `<TopBar>` with `<SidebarTrigger>`, a ⌘K-style global-search placeholder (cosmetic), the company switcher, language/theme/notifications buttons, and a sticky `top-0` glass background. Sidebar width tightened (`18rem → 16rem`), main content widened (`max-w-7xl → max-w-[1400px]`).

- `client/src/pages/dashboard.tsx` — full rewrite as the **Cockpit**. Uses `useLocale` for bilingual copy, `useFormatMoney` for currency, and design-system tokens throughout. Layout:
  - **Header** — eyebrow + display title + subtitle + outline "open ledger" / primary "new entry" actions (arrow icons mirror under RTL).
  - **KPI band (4-up)** — one dark inverse hero KPI for Net balance (background = `foreground`, text = `background`) plus three flat siblings (Revenue / Expenses / Margin). Each KPI carries an eyebrow label, a tabular-numeric value, an optional hint, and a delta pill colored by `--success` / `--expense`. No icon-on-circle treatments.
  - **Cash flow** — 30-day cumulative area chart drawn in `--chart-1` over a soft gradient with a reference line at 0; chart container is forced `dir="ltr"` so the time axis flows naturally even in RTL pages.
  - **Top spending categories** — horizontal mini-bars (`h-1.5` track, `--chart-1..5` per-rank fill, share labels via `font-numeric tabular-nums`).
  - **AI insight banner** — a dynamic sentence built from the top expense category, including a "reduce by 10% would free X/month" projection. Bilingual.
  - **Recent activity** — hairline-divided list with subtle `bg-success/10` / `bg-expense/10` icon chips, eyebrow category label, mono date, and right-aligned signed amount in `font-numeric tabular-nums`.

The Phase 1 visual system tokens (`--chart-1..5`, `--income/--expense/--success/--warning`, `--sidebar-*`, `--shadow-*`) are now exercised end-to-end on the most-trafficked surface.

### Inner-page polish (Phase 4 — April 2026)

Four high-traffic inner pages were rewritten to share the cockpit's language. All use `useLocale` for AR/EN copy and `useFormatMoney` for currency; legacy patterns (`rounded-2xl/3xl`, `font-extrabold/black`, gradient CTAs, `bg-emerald-100`/`bg-rose-100` icon circles, hardcoded `ر.س`, oversized `h-12/h-14` controls, `shadow-lg shadow-primary/20`) were removed.

- `client/src/pages/transactions.tsx` — eyebrow + display title header, single primary CTA, segmented filter pills (`bg-muted/50` with `bg-background` selected state), Card-as-table with hairline-divided rows. Each row carries a small token-colored icon chip (`bg-success/10` or `bg-expense/10` with matching border), uppercase eyebrow category, mono date, and right-aligned signed amount in `font-numeric tabular-nums`. Income amounts are the only colored values (Mercury convention); expenses stay foreground.

- `client/src/pages/ai-assistant.tsx` — full chat-surface rewrite. Pulsing-dot eyebrow, big bilingual title ("اوصف معاملتك. سأكتب القيد." / "Describe a transaction. I'll write the entry."), welcome bubble with bullet hints. New `<Bubble>` component: user bubbles use `bg-foreground text-background` (dark inverse), assistant bubbles use `bg-muted/60` with hairline border, both with asymmetric corner radius for direction. Composer is a single sticky strip — `ImagePlus` ghost icon, plain `Input`, `ArrowUp` send button — plus an inline image-preview chip. Quick-prompt suggestions render as bordered cards instead of gradient pills.

- `client/src/pages/chart-of-accounts.tsx` — eyebrow + IFRS-aligned display title. Five account-type buckets each render in a Card with a 1px×14px accent bar mapped to a `--chart-N` token (assets→chart-1, liabilities→chart-3, equity→chart-5, revenue→chart-2, expenses→chart-4) and a small count chip. Account rows are hairline-divided list items with a fixed-width `font-numeric` code column, Arabic name in foreground, English name in muted (right-aligned). Header rows use `bg-muted/30` and reduced indentation.

- `client/src/pages/journal-entries.tsx` — eyebrow + display title ("كل قيد، متوازن، مرحَّل."). Each entry renders as a Card with a metadata header (reference chip, memo, date · source · total) followed by a real ledger-style table: `<thead>` with uppercase tracked column labels, debit/credit columns right-aligned in `font-numeric tabular-nums`, source badge for manual/auto/AI. The "new entry" dialog has a trimmed table with `h-9` controls, an outline "add line" button, and a `--success`/`--warning` balance indicator that shows the live difference until the entry zeros out.

All four pages share the same header pattern (Eyebrow → display title → subtitle → primary CTA right-aligned in LTR / left-aligned in RTL) and the same Card variants from `client/src/components/ui/card.tsx`. The `bg-rose-100` / `bg-emerald-100` icon-circle pattern is now extinct from the high-traffic surfaces.

### Public Landing Page (Phase 2 — April 2026)

A new public marketing page lives at `/` (`client/src/pages/landing.tsx`), built fully on the Phase 1 visual system. Authenticated app routes were re-anchored: the dashboard moved from `/` to `/dashboard`, and `client/src/App.tsx` now branches at the route layer — `/` renders **without** `MainLayout` (no sidebar, no company-switcher), while every other route is wrapped in the authenticated app shell. The `Brand` wordmark accepts an `href` prop so it can point at `/` (public) or `/dashboard` (in-app) depending on context.

Eleven sections, deliberately varied in rhythm — no repetition of "three identical feature cards":
1. **Hero** — asymmetric grid: copy on RTL right + windowed product mockup on the left, with two floating chips (auto-posted entry, profit delta) and a soft dual-glow background.
2. **Trust strip** — wordmark row + four-up metric band (entries posted, uptime, latency, SOC 2).
3. **Why different** — editorial intro (display + lede) followed by a 2×2 grid of numbered principles. No icons-in-circles.
4. **Core capabilities** — 6-column **bento grid**: one large cockpit card (col-span-4 row-span-2), one tall AI card (col-span-2 row-span-2), two wide cards, three small cards. Each card has a distinct internal treatment.
5. **AI assistant** — split layout, copy on RTL right, full chat-mockup window on the left (achieved via explicit `lg:col-start-1` / `lg:col-start-8` rather than fragile flex `order` swaps, which reverse meaning under RTL).
6. **Dashboard showcase** — full-width browser-frame mock of the cockpit (sidebar + KPIs + cash-forecast chart + alerts + AI insight callout), with a horizontal feature-toggle strip beneath.
7. **Automation** — 5-step horizontal flow diagram (chips connected by hairlines + arrows), plus a 3-up case row showing supplier invoice / new employee / fixed asset journey.
8. **Security** — 4-up dense grid with hairline separators (NOT cards): SOC 2, AES-256/TLS 1.3, immutable IFRS audit trail, MENA data residency.
9. **Use cases** — accessible WAI-ARIA tab pattern (Founders / Accountants / Teams) with persona quote + outcomes list, RTL-aware arrow-key navigation.
10. **FAQ** — six Q&A items via shadcn Accordion.
11. **Final CTA** — full-width bordered band with subtle grid texture and decorative emerald glow, mailto-based primary/secondary CTAs, deep-link to showcase.

Internal landmark sections are linked from the navbar (`#platform`, `#ai`, `#automation`, `#security`, `#use-cases`, `#faq`) and from in-page CTAs (`#cta`, `#showcase`). Self-contained UI primitives (`BrowserFrame`, `MiniKPI`, `SparkChart`, `ChatBubble`, `FloatingChip`, `Metric`, `BentoCard`, `AlertRow`) are defined inside the file to keep the landing page hermetic and easy to evolve without bleeding helpers into the broader component library.
- **Styling**: Tailwind CSS with CSS variables for theming; Cairo Arabic font loaded via Google Fonts
- **RTL Layout**: The entire app uses `dir="rtl"` in the main layout wrapper (`main-layout.tsx`), Arabic-first interface
- **Charts**: Recharts (`PieChart`, `BarChart`) used on the dashboard
- **Forms**: React Hook Form with Zod resolvers for validation
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

### Backend Architecture

- **Framework**: Express 5 (TypeScript, ESM)
- **Entry point**: `server/index.ts` → registers routes via `server/routes.ts`
- **Route definitions**: Shared between frontend and backend via `shared/routes.ts` (typed API contract with Zod schemas for inputs/responses)
- **Storage layer**: `server/storage.ts` defines `IStorage` interface and `DatabaseStorage` class (clean separation allows future storage swaps)
- **AI Integration**: OpenAI client (`openai` npm package) used in `server/routes.ts` for the AI chat assistant; uses `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` env vars
- **Dev server**: Vite middleware is embedded into Express in development mode (`server/vite.ts`)
- **Production build**: `script/build.ts` runs both Vite (frontend) and esbuild (backend) builds; backend is bundled to `dist/index.cjs` with select dependencies inlined

### Data Storage

- **Database**: PostgreSQL via `drizzle-orm/node-postgres` (`pg` Pool)
- **ORM**: Drizzle ORM with schema defined in `shared/schema.ts`
- **Schema**:
  - `transactions`: id, type (income/expense), amount (numeric 12,2), description, category, date
  - `chatMessages`: id, role (user/assistant), content, createdAt
  - `conversations` + `messages`: used by Replit integration modules for structured chat history
- **Migrations**: Drizzle Kit with `drizzle.config.ts` pointing to `shared/schema.ts`; run via `npm run db:push`
- **Seed**: `seed.ts` at root populates sample transactions and a welcome chat message

### Shared Contract Pattern

- `shared/routes.ts` defines the full API surface (paths, HTTP methods, Zod input schemas, response schemas)
- Both frontend hooks and backend route handlers import from `shared/routes.ts` — this prevents drift between client/server expectations
- `shared/schema.ts` exports Drizzle table definitions and `drizzle-zod`-generated insert schemas

### Replit Integration Modules

The `server/replit_integrations/` and `client/replit_integrations/` directories contain modular, plug-in-style integrations:
- **chat**: conversation/message storage and OpenAI chat routes
- **audio**: voice recording (client), PCM16 audio playback via AudioWorklet (client), speech-to-text/TTS via OpenAI (server), WebM→WAV conversion via ffmpeg (server)
- **image**: image generation and editing via OpenAI `gpt-image-1`
- **batch**: rate-limited, auto-retry batch processing utility using `p-limit` and `p-retry`

---

## External Dependencies

### APIs and AI
- **OpenAI API** (via Replit AI Integrations): Used for the AI chat assistant (natural language transaction parsing), speech-to-text, text-to-speech, voice chat streaming, and image generation. Configured via:
  - `AI_INTEGRATIONS_OPENAI_API_KEY`
  - `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Database
- **PostgreSQL**: Required; connection string via `DATABASE_URL` env var
- **connect-pg-simple**: Mentioned in dependencies (session store for PostgreSQL, if sessions are added later)

### Key npm Dependencies
| Package | Purpose |
|---|---|
| `drizzle-orm` + `drizzle-kit` | ORM and migrations |
| `drizzle-zod` | Auto-generate Zod schemas from Drizzle tables |
| `zod` | Runtime validation (shared between client/server) |
| `@tanstack/react-query` | Client-side data fetching and caching |
| `wouter` | Lightweight React router |
| `recharts` | Dashboard charts |
| `react-hook-form` + `@hookform/resolvers` | Forms with Zod validation |
| `shadcn/ui` + Radix UI | Accessible UI component primitives |
| `tailwind-merge` + `clsx` | Class name utilities |
| `date-fns` | Date formatting (with Arabic locale `ar`) |
| `openai` | OpenAI SDK (server-side) |
| `p-limit` + `p-retry` | Batch concurrency and retry logic |
| `nanoid` | Unique ID generation |
| `vaul` | Drawer component |

### Environment Variables Required
- `DATABASE_URL` — PostgreSQL connection string
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI API key (Replit integration)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI base URL (Replit integration)
## Decision Cockpit (مركز القرارات) - Added Apr 2026

A complete decision-support layer at /insights with 6 tabs:
1. **القيادة (Cockpit)**: 5-component health score (profitability 30% / liquidity 20% / cash 20% / discipline 20% / solvency 10%), KPIs, VAT & Zakat estimates.
2. **الإنذارات (Alerts)**: 7 alert types (cash runway, expense ratio, net loss, category anomalies, revenue drop, outliers, all-clear).
3. **تنبؤ النقد (Cash Forecast)**: 30/60/90/180-day projection chart with runway calc.
4. **المحاكي (What-If Simulator)**: price/cost/expense scenarios + monthly break-even revenue.
5. **الميزانية (Budget vs Actual)**: per-account monthly budgets with variance bars.
6. **المستشار (AI Coach)**: GPT-5.2 with full live financial context, Arabic prompt, rate-limited.

### Key files
- shared/schema.ts: budgets table
- server/insights.ts: analytics engine (~430 lines)
- server/routes.ts: /api/insights/* + /api/budgets endpoints
- client/src/pages/insights.tsx: single-file page with 6 tab components

