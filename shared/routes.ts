import { z } from 'zod';
import {
  insertTransactionSchema,
  transactions,
  chatMessages,
  insertChatMessageSchema,
  accounts,
  insertAccountSchema,
  createJournalEntrySchema,
  journalEntries,
  type TransactionWithJournal,
  insertCustomerSchema,
  insertProductSchema,
  createSalesInvoiceSchema,
  updateSalesInvoiceSchema,
  type Customer,
  type Product,
  type SalesInvoice,
  type SalesInvoiceWithLines,
  SALES_INVOICE_STATUSES,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  transactions: {
    list: {
      method: 'GET' as const,
      path: '/api/transactions' as const,
      responses: {
        // Each row carries an optional journalEntryId/journalEntryReference so
        // the transaction detail dialog can deep-link into the auto-posted
        // journal entry. See `TransactionWithJournal` in `shared/schema.ts`.
        200: z.array(z.custom<TransactionWithJournal>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/transactions' as const,
      input: insertTransactionSchema,
      responses: {
        201: z.custom<typeof transactions.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/transactions/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    summary: {
      method: 'GET' as const,
      path: '/api/transactions/summary' as const,
      responses: {
        200: z.object({
          totalIncome: z.number(),
          totalExpense: z.number(),
          balance: z.number(),
        }),
      },
    },
  },
  accounts: {
    list: {
      method: 'GET' as const,
      path: '/api/accounts' as const,
      responses: {
        200: z.array(z.custom<typeof accounts.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/accounts' as const,
      input: insertAccountSchema,
      responses: {
        201: z.custom<typeof accounts.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    restoreDefaults: {
      method: 'POST' as const,
      path: '/api/accounts/restore-defaults' as const,
      input: z.object({}).optional(),
      responses: {
        200: z.object({ seeded: z.number() }),
        409: errorSchemas.validation,
        500: errorSchemas.internal,
      },
    },
    // Per-account aggregated debit/credit/balance for the chart-of-accounts
    // tree. The `period` query param scopes the aggregation to a date range:
    //   - `month`: current calendar month
    //   - `year`:  current calendar year
    //   - `all`:   no date filter (default)
    // The handler aggregates server-side, scoped to the active workspace, so
    // there is no cross-tenant leakage.
    balances: {
      method: 'GET' as const,
      path: '/api/accounts/balances' as const,
      responses: {
        200: z.object({
          period: z.enum(['month', 'year', 'all']),
          rows: z.array(
            z.object({
              accountId: z.number(),
              debit: z.number(),
              credit: z.number(),
              balance: z.number(),
            })
          ),
        }),
      },
    },
  },
  journal: {
    list: {
      method: 'GET' as const,
      path: '/api/journal-entries' as const,
      responses: {
        200: z.array(z.any()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/journal-entries' as const,
      input: createJournalEntrySchema,
      responses: {
        201: z.any(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/journal-entries/:id' as const,
      responses: {
        204: z.void(),
      },
    },
  },
  reports: {
    trialBalance: {
      method: 'GET' as const,
      path: '/api/reports/trial-balance' as const,
      responses: {
        200: z.object({
          rows: z.array(
            z.object({
              accountId: z.number(),
              code: z.string(),
              nameAr: z.string(),
              type: z.string(),
              debit: z.number(),
              credit: z.number(),
              balance: z.number(),
            })
          ),
          totalDebit: z.number(),
          totalCredit: z.number(),
        }),
      },
    },
    balanceSheet: {
      method: 'GET' as const,
      path: '/api/reports/balance-sheet' as const,
      responses: {
        200: z.any(),
      },
    },
    incomeStatement: {
      method: 'GET' as const,
      path: '/api/reports/income-statement' as const,
      query: z.object({
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      responses: {
        200: z.object({
          revenueItems: z.array(z.object({ category: z.string(), amount: z.number() })),
          totalRevenue: z.number(),
          cogsItems: z.array(z.object({ category: z.string(), amount: z.number() })),
          totalCogs: z.number(),
          grossProfit: z.number(),
          operatingExpenseItems: z.array(
            z.object({ category: z.string(), amount: z.number() })
          ),
          totalOperatingExpenses: z.number(),
          otherIncomeItems: z.array(z.object({ category: z.string(), amount: z.number() })),
          totalOtherIncome: z.number(),
          netProfit: z.number(),
        }),
      },
    },
  },
  analysis: {
    generate: {
      method: 'POST' as const,
      path: '/api/analysis' as const,
      input: z.object({
        period: z.string().max(50),
        totals: z.object({
          revenue: z.number(),
          cogs: z.number(),
          grossProfit: z.number(),
          operatingExpenses: z.number(),
          netProfit: z.number(),
          txCount: z.number(),
        }),
        ratios: z.object({
          grossMargin: z.number(),
          operatingMargin: z.number(),
          netMargin: z.number(),
          expenseRatio: z.number(),
          topExpenseShare: z.number(),
          topExpenseCategory: z.string().max(80),
        }),
        topExpenses: z
          .array(z.object({ category: z.string().max(80), amount: z.number() }))
          .max(10),
      }),
      responses: {
        200: z.object({
          healthScore: z.number(),
          summary: z.string(),
          strengths: z.array(z.string()),
          weaknesses: z.array(z.string()),
          recommendations: z.array(
            z.object({
              title: z.string(),
              detail: z.string(),
              priority: z.enum(['high', 'medium', 'low']),
            })
          ),
          topAction: z.string(),
        }),
        400: errorSchemas.validation,
      },
    },
  },
  audit: {
    list: {
      method: 'GET' as const,
      path: '/api/audit/:entityType/:id' as const,
      responses: {
        200: z.array(z.any()),
      },
    },
    // Reversal-aware audit lookup for journal entries: returns history even
    // when the JE was cascade-deleted by a `reverseAutoPostedJournalEntry`
    // call, so auditors can trace why a JE disappeared from the GL.
    journalEntryWithReversal: {
      method: 'GET' as const,
      path: '/api/audit/journal_entry/:id/with-reversal' as const,
      responses: {
        200: z.array(z.any()),
      },
    },
  },
  admin: {
    // Owner-only recovery endpoint: posts a balanced double-entry JE for
    // every transaction in the active workspace that has no matching
    // `journal_entries.sourceTransactionId`. Re-running it is a no-op once
    // the backlog is cleared. The boot path runs the same helper across
    // every workspace; this route exists so a workspace owner can re-run it
    // on demand if a future regression breaks `autoPostFromTransaction`
    // again (the original incident this was authored for).
    backfillJournalEntries: {
      method: 'POST' as const,
      path: '/api/admin/backfill-journal-entries' as const,
      input: z.object({}).optional(),
      responses: {
        200: z.object({
          created: z.number(),
          skipped: z.number(),
        }),
        403: errorSchemas.notFound,
        500: errorSchemas.internal,
      },
    },
    // Companion read-only endpoint that returns the most recent
    // backfill audit row for the active workspace, so the settings card
    // can render a "Last run by <owner> on <date>" line under the
    // Re-pair button. Returns `{ lastRun: null }` when no backfill has
    // ever been recorded for this workspace. See task #236.
    backfillJournalEntriesLastRun: {
      method: 'GET' as const,
      path: '/api/admin/backfill-journal-entries/last-run' as const,
      responses: {
        200: z.object({
          lastRun: z
            .object({
              actor: z.string().nullable(),
              source: z.string(),
              occurredAt: z.string(),
              created: z.number(),
              skipped: z.number(),
              triggeredVia: z.enum(['admin-route', 'boot']),
            })
            .nullable(),
        }),
        403: errorSchemas.notFound,
        500: errorSchemas.internal,
      },
    },
    // Read-only count of transactions in the active workspace that are
    // missing a `journal_entries.sourceTransactionId` row pointing back at
    // them — i.e. exactly the rows the POST above will act on. The settings
    // "Re-pair missing journal entries" card uses this to show owners
    // "N transactions are missing journal entries" before they confirm,
    // so a click that would create 0 entries (or 4,000) is visible up front
    // instead of being a surprise after the POST returns. Owner-gated like
    // the POST so the count itself can never leak across role boundaries.
    backfillJournalEntriesPreview: {
      method: 'GET' as const,
      path: '/api/admin/backfill-journal-entries/preview' as const,
      responses: {
        200: z.object({
          count: z.number(),
        }),
        403: errorSchemas.notFound,
        500: errorSchemas.internal,
      },
    },
  },
  sales: {
    // ----- Customers -----
    customersList: {
      method: 'GET' as const,
      path: '/api/sales/customers' as const,
      responses: { 200: z.array(z.custom<Customer>()) },
    },
    customerGet: {
      method: 'GET' as const,
      path: '/api/sales/customers/:id' as const,
      responses: { 200: z.custom<Customer>(), 404: errorSchemas.notFound },
    },
    customerCreate: {
      method: 'POST' as const,
      path: '/api/sales/customers' as const,
      input: insertCustomerSchema,
      responses: { 201: z.custom<Customer>(), 400: errorSchemas.validation },
    },
    customerUpdate: {
      method: 'PATCH' as const,
      path: '/api/sales/customers/:id' as const,
      input: insertCustomerSchema.partial(),
      responses: {
        200: z.custom<Customer>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    customerDelete: {
      method: 'DELETE' as const,
      path: '/api/sales/customers/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        409: errorSchemas.validation,
      },
    },
    // Open AR balance for the active customer (sum of total - paid on
    // posted credit invoices). Returns 0 when no posted activity exists.
    customerBalance: {
      method: 'GET' as const,
      path: '/api/sales/customers/:id/balance' as const,
      responses: { 200: z.object({ balance: z.number() }) },
    },
    customerHistory: {
      method: 'GET' as const,
      path: '/api/sales/customers/:id/history' as const,
      responses: { 200: z.array(z.custom<SalesInvoice>()) },
    },
    // ----- Products -----
    productsList: {
      method: 'GET' as const,
      path: '/api/sales/products' as const,
      responses: { 200: z.array(z.custom<Product>()) },
    },
    productCreate: {
      method: 'POST' as const,
      path: '/api/sales/products' as const,
      input: insertProductSchema,
      responses: { 201: z.custom<Product>(), 400: errorSchemas.validation },
    },
    productUpdate: {
      method: 'PATCH' as const,
      path: '/api/sales/products/:id' as const,
      input: insertProductSchema.partial(),
      responses: {
        200: z.custom<Product>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    productDelete: {
      method: 'DELETE' as const,
      path: '/api/sales/products/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        409: errorSchemas.validation,
      },
    },
    // ----- Sales invoices -----
    invoicesList: {
      method: 'GET' as const,
      path: '/api/sales/invoices' as const,
      responses: { 200: z.array(z.custom<SalesInvoiceWithLines>()) },
    },
    invoiceGet: {
      method: 'GET' as const,
      path: '/api/sales/invoices/:id' as const,
      responses: {
        200: z.custom<SalesInvoiceWithLines>(),
        404: errorSchemas.notFound,
      },
    },
    invoiceCreate: {
      method: 'POST' as const,
      path: '/api/sales/invoices' as const,
      input: createSalesInvoiceSchema,
      responses: {
        201: z.custom<SalesInvoiceWithLines>(),
        400: errorSchemas.validation,
      },
    },
    invoiceUpdate: {
      method: 'PATCH' as const,
      path: '/api/sales/invoices/:id' as const,
      input: updateSalesInvoiceSchema,
      responses: {
        200: z.custom<SalesInvoiceWithLines>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        409: errorSchemas.validation,
      },
    },
    invoiceDelete: {
      method: 'DELETE' as const,
      path: '/api/sales/invoices/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
        409: errorSchemas.validation,
      },
    },
    // Status transitions live as dedicated endpoints rather than a generic
    // PATCH so the API contract makes the lifecycle (`draft` → `posted` →
    // `cancelled`) explicit and the role gate / Tool list can target each
    // transition independently.
    invoicePost: {
      method: 'POST' as const,
      path: '/api/sales/invoices/:id/post' as const,
      responses: {
        200: z.custom<SalesInvoiceWithLines>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    invoiceCancel: {
      method: 'POST' as const,
      path: '/api/sales/invoices/:id/cancel' as const,
      responses: {
        200: z.custom<SalesInvoiceWithLines>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        409: errorSchemas.validation,
      },
    },
    invoicePdf: {
      method: 'GET' as const,
      path: '/api/sales/invoices/:id/pdf' as const,
      responses: {
        // Binary PDF body. Documented as `z.any()` so the OpenAPI / TS
        // shape doesn't pretend it's JSON.
        200: z.any(),
        404: errorSchemas.notFound,
      },
    },
    invoiceNextNumber: {
      method: 'GET' as const,
      path: '/api/sales/invoices/next-number' as const,
      responses: { 200: z.object({ number: z.string() }) },
    },
  },
  chat: {
    list: {
      method: 'GET' as const,
      path: '/api/chat' as const,
      responses: {
        200: z.array(z.custom<typeof chatMessages.$inferSelect>()),
      },
    },
    message: {
      method: 'POST' as const,
      path: '/api/chat' as const,
      input: z.object({
        content: z.string().max(4000),
        imageData: z
          .string()
          .regex(
            /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/,
            'صيغة صورة غير صالحة'
          )
          .refine((s) => {
            // Decoded byte size limit: ~10 MB. Base64 length ≈ 4/3 * bytes.
            const base64 = s.split(',')[1] || '';
            const bytes = (base64.length * 3) / 4;
            return bytes <= 10 * 1024 * 1024;
          }, 'حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت)')
          .optional(),
        // UI locale of the active session — drives the assistant's reply language.
        locale: z.enum(['ar', 'en', 'de', 'fr']).optional(),
      }),
      responses: {
        // The chat handler returns the assistant message *plus* an
        // `affected: string[]` payload so the client can invalidate exactly
        // the TanStack Query keys that the LLM's tool calls touched (e.g.
        // ["transactions", "journal-entries", "documents"]). The list is
        // always present — empty when no tools ran.
        200: z.custom<
          typeof chatMessages.$inferSelect & { affected: string[] }
        >(),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type TransactionInput = z.infer<typeof api.transactions.create.input>;
export type TransactionResponse = z.infer<typeof api.transactions.create.responses[201]>;
export type ChatMessageInput = z.infer<typeof api.chat.message.input>;
