# Smart Financial Assistant (محاسب ذكي)

## Overview

"محاسب ذكي" (Smart Accountant) is an Arabic-language personal finance management application designed for multi-country use, specifically tailored for the MENA region. It provides comprehensive financial tracking, AI-powered assistance, and advanced IFRS-compliant accounting features for individuals and businesses.

Key Capabilities:
- **Financial Tracking**: Income and expense tracking with dynamic dashboards and visual summaries.
- **AI Assistant**: Natural language processing for logging transactions via chat, including image uploads (e.g., receipts) for intelligent assistance, powered by OpenAI.
- **Double-Entry Accounting**: Full IFRS-compliant system with Chart of Accounts, Journal Entries, and IFRS statement generation.
- **Decision Cockpit (`/insights`)**: Offers financial health scores, alerts, cash flow forecasting, what-if simulations, budgeting tools, and an AI financial coach.
- **Multi-Country Localization**: Supports 7 country packs (INTL, SA, AE, EG, KW, QA, JO) with configurable currency, VAT rates, zakat toggles, weekend days, social insurance rates, and end-of-service formulas.
- **HR & Payroll (`/hr`)**: Integrated module for managing employees, attendance, leaves, and automating monthly payroll runs with auto-posted journal entries adhering to IAS 19 provisions.
- **Smart Document Inbox (`/app/inbox`)**: Upload receipt/invoice images or capture them live with the device camera. An OpenAI vision pipeline extracts key data and proposes a balanced IFRS-correct journal entry.

The application is built as a full-stack TypeScript monorepo, utilizing a React frontend and an Express backend, with shared schema and route definitions for consistency and a sophisticated user experience.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

The application is a full-stack TypeScript monorepo with a React frontend and an Express backend, using shared schema and route definitions for consistency.

### Frontend Architecture
- **Framework & Routing**: React with Vite, utilizing `wouter` for navigation.
- **State Management**: TanStack React Query (v5) for server state with optimistic updates.
- **UI Components**: `shadcn/ui` based on Radix UI primitives.
- **Visual Design System**: Emphasizes a premium fintech aesthetic with:
    - Custom typography stack: IBM Plex Sans Arabic (primary, RTL), Inter (Latin), JetBrains Mono (tabular figures).
    - Muted color palette with a deep emerald brand color and an earthy 5-color chart palette.
    - Refined radii, shadow tokens, and spacing rhythm tokens for consistent UI.
    - Enhanced UI primitives and layout shells.
    - Signature `.brand-mesh` and `.brand-grain` surface treatments.
    - Comprehensive `/styleguide` as the source of truth.
    - Redesigned app shell, cockpit, sidebar, and main content area for authenticated users.
    - Standardized inner page layouts and improved display of financial metrics.
    - Decluttered TopBar and custom underline tab strip (`.ledger-tabs`).
    - Public marketing landing page built on the visual system.
- **RTL Layout**: Primary consideration for Arabic layout.
- **Charts**: Recharts for displaying financial data.
- **Forms**: React Hook Form with Zod resolvers for validation.

### Backend Architecture
- **Framework**: Express 5 (TypeScript, ESM).
- **API Contract**: Shared `shared/routes.ts` defines API paths, HTTP methods, and Zod schemas for input/response validation.
- **Storage Layer**: `server/storage.ts` provides an `IStorage` interface for database abstraction.
- **AI Integration**: OpenAI client integrated for AI chat assistance.
- **Build System**: Vite for frontend development and esbuild for backend production builds.

### Data Storage
- **Database**: PostgreSQL, accessed via `drizzle-orm/node-postgres`.
- **ORM**: Drizzle ORM with schema defined in `shared/schema.ts`.
- **Migrations**: Managed by Drizzle Kit.

### Workspace Isolation (Defense in Depth)

Multi-tenant architecture with three independent layers to prevent cross-workspace data leaks:
1. **Route guard**: `requireAuth` + `attachMembership` reject unauthorized API requests based on company ID.
2. **Composite foreign keys**: Database-level enforcement of parent-child relationships including `company_id`.
3. **Postgres row-level security (RLS)**: Every workspace-scoped table has RLS enabled with policies keyed on `app.current_company_id` GUC.

### Shared Contract Pattern

- `shared/routes.ts` and `shared/schema.ts` define API endpoints and database schemas used by both frontend and backend for consistency.

### Replit Integration Modules

Modular, plug-in-style integrations in `server/replit_integrations/` and `client/replit_integrations/`:
- **Chat**: Manages conversation, message storage, and OpenAI chat routes.
- **Audio**: Handles voice recording, speech-to-text/TTS via OpenAI, and WebM→WAV conversion.
- **Image**: Supports image generation and editing via OpenAI.
- **Batch**: Provides utilities for rate-limited, auto-retry batch processing.

### Automated UI Checks

- **Mobile horizontal overflow**: Playwright checks for horizontal overflow on dense-table pages across different viewports and languages.
- **Pre-commit role-guard hook**: Husky hook runs `scripts/check-role-guard-coverage.ts` to ensure proper role-based access control for UI elements.
- **Bilingual dashboard shell**: Playwright suite asserts visual snapshots, command palette functionality, keyboard navigation, and WCAG AA contrast for the dashboard in various locales and themes.

### Purchases Portal (Task #368)

End-to-end Purchase Invoices module mirroring the Sales Portal:
- **Vendors** (`VEND-####`): code/name (ar+en)/tax/contact, RLS-scoped per workspace.
- **Bills** (`BILL-####`): draft → posted → cancelled lifecycle. Posting auto-issues an IFRS journal entry via the inventory inbound engine (`Dr Expense / Dr 1230 Input VAT / Cr 2100 AP` for credit; `Cr 1100 Cash` for cash bills). Cancelling reverses the JE in place.
- **AP Payments** (`APPAY-####`): multi-bill allocations against open bills, posts `Dr 2100 AP / Cr 1100 Cash`. Reversing un-allocates and re-opens the linked bills.
- **AP Aging Report**: 0-30 / 31-60 / 61-90 / 90+ buckets per vendor.
- Server: `server/purchases.ts` business logic + storage in `server/storage.ts`; routes under `/api/purchases/*`.
- Frontend: `/app/purchases/{vendors,bills,bill-detail,payments,ap-aging}` with i18n (ar/en/de/fr) and `WriteGuard`-wrapped controls covered by `tests/e2e/role-based-buttons.spec.ts`.
- Tests: `server/__tests__/purchases.test.ts` (vitest, 3 lifecycle round-trips) + `tests/e2e/purchases-portal.spec.ts` (Playwright, 2 happy-path + draft-delete).

### Locale-aware PDF rendering

Server-generated PDFs render in the user's selected locale (`ar`/`en`/`de`/`fr`).
- **Translation tables**: `server/i18n/pdf-strings.ts` is the single source of truth for PDF labels in all four locales.
- **Arabic shaping pipeline**: Hand-rolled Presentation-Forms shaper + bidi flip for `pdfkit` to correctly render Arabic text.
- **Locale plumbing**: `server/lib/locale.ts` manages locale parsing for PDF generation requests.
- **E2E lock**: `tests/e2e/sales-invoice-pdf-locale.spec.ts` ensures correct localized PDF titles.

## External Dependencies

### APIs and AI
- **OpenAI API**: Used for AI chat, speech-to-text, text-to-speech, voice chat streaming, and image generation.

### Database
- **PostgreSQL**: Primary database.

### Key npm Dependencies
- `drizzle-orm`, `drizzle-kit`, `drizzle-zod`: ORM and schema management.
- `zod`: Runtime validation.
- `@tanstack/react-query`: Client-side data fetching and server state management (v5).
- `wouter`: Lightweight React router.
- `recharts`: Charting library.
- `react-hook-form`, `@hookform/resolvers`: Form management and validation.
- `shadcn/ui`, `Radix UI`: UI component library.
- `date-fns`: Date formatting.
- `openai`: OpenAI SDK.

### Environment Variables Required
- `DATABASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
