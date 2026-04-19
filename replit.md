# Smart Financial Assistant (محاسب ذكي)

## Overview

This is an Arabic-language personal finance management application called "محاسب ذكي" (Smart Accountant). It allows users to:

- Track income and expenses via a transactions dashboard
- View financial summaries and charts (pie charts and bar charts via Recharts)
- Interact with an AI assistant (powered by OpenAI) to log transactions via natural language chat, including image uploads (e.g., receipts)

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
- **UI Components**: shadcn/ui (New York style) built on Radix UI primitives
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