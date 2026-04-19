import { z } from 'zod';
import { insertTransactionSchema, transactions, chatMessages, insertChatMessageSchema } from './schema';

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
