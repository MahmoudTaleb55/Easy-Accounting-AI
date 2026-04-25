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
        200: z.array(z.custom<typeof transactions.$inferSelect>()),
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
        200: z.custom<typeof chatMessages.$inferSelect>(),
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
