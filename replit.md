# Smart Financial Assistant (محاسب ذكي)

## Overview

This project is an Arabic-language personal finance management application named "محاسب ذكي" (Smart Accountant). Its primary purpose is to provide users with comprehensive financial tracking, analysis, and intelligent assistance, designed to meet the specific needs of the MENA region.

Key capabilities include:
- Tracking income and expenses through a dynamic transactions dashboard.
- Visualizing financial data with summary charts.
- Interacting with an AI assistant to log transactions via natural language chat, supporting image uploads for receipts.
- Implementing IFRS-compliant double-entry accounting with a Chart of Accounts, Journal Entries, and IFRS statements.
- A "Decision Cockpit" offering financial health scores, alerts, cash flow forecasting, a what-if simulator, budgeting tools, and an AI financial coach.
- Multi-country localization with configurable currency, VAT rates, Zakat toggles, weekend days, social insurance rates, and end-of-service formulas for 7 different country packs (INTL, SA, AE, EG, KW, QA, JO).
- Integrated HR & Payroll module supporting employee management, attendance, leaves, and monthly payroll runs with auto-posted journal entries adhering to IAS 19 provisions.

The application aims to provide a sophisticated, localized financial management solution with a focus on intuitive user experience and robust accounting principles.

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

- **Database**: PostgreSQL.
- **ORM**: Drizzle ORM with schema defined in `shared/schema.ts`.
- **Schema**: Includes tables for `transactions`, `chatMessages`, `conversations`, `messages`, and `budgets`.
- **Migrations**: Managed by Drizzle Kit.
- **Seed Data**: `seed.ts` populates initial data.

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
- **OpenAI API**: Utilized for AI chat, speech-to-text, text-to-speech, voice chat streaming, and image generation, configured via `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL`.

### Database
- **PostgreSQL**: The primary database, requiring a `DATABASE_URL` environment variable.

### Key npm Dependencies
- **Data & ORM**: `drizzle-orm`, `drizzle-kit`, `drizzle-zod`.
- **Validation**: `zod`.
- **Frontend**: `@tanstack/react-query`, `wouter`, `recharts`, `react-hook-form`, `@hookform/resolvers`.
- **UI**: `shadcn/ui`, `radix-ui`, `tailwind-merge`, `clsx`, `vaul`.
- **Utilities**: `date-fns`, `nanoid`, `p-limit`, `p-retry`.
- **Backend**: `openai`.

### Environment Variables Required
- `DATABASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`
- `AI_INTEGRATIONS_OPENAI_BASE_URL`

## Automated UI Checks

- **Mobile horizontal overflow** — `tests/e2e/mobile-overflow.spec.ts` is a
  Playwright check that loads every dense-table app page (Journal, Reports,
  Insights, Fixed Assets, HR, Chart of Accounts, Transactions) at a 360x720
  viewport in both English (LTR) and Arabic (RTL) and asserts the document
  itself does not overflow horizontally. This is the regression net for new
  pages that forget the `.table-sticky-first` table wrapper or ship an
  `inline-flex` toolbar that would push the page wider than a phone viewport.
  Run it with `PLAYWRIGHT_NO_WEBSERVER=1 npx playwright test --reporter=line`
  while the dev server is up, or via the registered `mobile-overflow`
  validation command. See `tests/mobile-overflow-check.md` for the full
  rationale and failure-mode playbook.