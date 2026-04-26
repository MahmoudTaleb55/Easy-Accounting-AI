import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ChatMessageInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";
import { useLocale } from "@/contexts/locale-context";
import { invalidateAccountBalances } from "@/lib/queryClient";

function parseWithLogging<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    return data as T; 
  }
  return result.data;
}

export function useChatMessages() {
  return useQuery({
    queryKey: [api.chat.list.path],
    queryFn: async () => {
      const res = await fetch(api.chat.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("فشل في جلب المحادثات");
      const data = await res.json();
      return parseWithLogging<any[]>(api.chat.list.responses[200], data, "chat.list");
    },
  });
}

/**
 * Map of "entity tag returned by the server" → list of TanStack Query keys
 * that surface that entity in the UI. The server (chat handler) inspects which
 * tools the assistant invoked and returns a list of tags in the
 * `affected` array on the response. We invalidate every matching key so the
 * inbox / journal / transactions / accounts / reports pages refresh
 * automatically — no manual reload required after the assistant writes.
 *
 * Keep this in sync with the server-side `toolToAffected` map in
 * server/routes.ts.
 */
const AFFECTED_KEYS: Record<string, ReadonlyArray<readonly unknown[]>> = {
  documents: [["/api/documents"]],
  transactions: [
    [api.transactions.list.path],
    [api.transactions.summary.path],
  ],
  "journal-entries": [["/api/journal-entries"]],
  accounts: [["/api/accounts"]],
  "fixed-assets": [["/api/fixed-assets"]],
  employees: [["/api/hr/employees"]],
  attendance: [["/api/hr/attendance"]],
  leaves: [["/api/hr/leaves"]],
  payroll: [["/api/hr/payroll/runs"]],
  insights: [
    // Use the *prefix* query keys here (no date/range arguments). TanStack
    // Query's default invalidation matches anything that *starts with* the
    // given key, so this single entry per endpoint invalidates every cached
    // variant — current period, prior period, custom date range, etc.
    ["/api/insights/alerts"],
    ["/api/insights/cash-forecast"],
    ["/api/insights/health"],
    ["/api/insights/taxes"],
    ["/api/insights/budget-vs-actual"],
  ],
  reports: [
    ["/api/reports/trial-balance"],
    ["/api/reports/balance-sheet"],
    ["/api/reports/profit-loss"],
  ],
};

export function useSendMessage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { locale } = useLocale();

  return useMutation({
    mutationFn: async (data: ChatMessageInput) => {
      // Always pass the active UI locale so the assistant replies in the
      // same language the user is viewing the app in.
      const payload: ChatMessageInput = { locale, ...data };
      const res = await fetch(api.chat.message.path, {
        method: api.chat.message.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error("حدث خطأ في الاتصال بالمساعد");
      }
      
      return await res.json();
    },
    onMutate: async (newMessage) => {
      // Optimistic update for better UX
      await queryClient.cancelQueries({ queryKey: [api.chat.list.path] });
      const previousMessages = queryClient.getQueryData([api.chat.list.path]);
      
      const optimisticContent = newMessage.imageData
        ? (newMessage.content?.trim() || "📎 تم إرفاق فاتورة / إيصال")
        : newMessage.content;

      queryClient.setQueryData([api.chat.list.path], (old: any[] = []) => [
        ...old,
        {
          id: Math.random(), // temp id
          role: 'user',
          content: optimisticContent,
          createdAt: new Date().toISOString()
        }
      ]);
      
      return { previousMessages };
    },
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.chat.list.path] });

      // The server returns `affected: string[]` listing the entity tags whose
      // cached views may now be stale. Walk that list and invalidate every
      // matching query key so the inbox/journal/transactions/accounts pages
      // refresh on their own — addressing the user-reported "I have to
      // manually refresh after the assistant adds something" bug.
      //
      // We're defensive about the response shape (it might be the raw chat
      // message object on older deployments, or a `{ ...message, affected }`
      // envelope on newer ones), and fall back to invalidating the historical
      // "transactions only" set when no `affected` array is present so the
      // hook is fully backward-compatible.
      const affected: string[] = Array.isArray(response?.affected)
        ? (response.affected as string[])
        : [];

      // If the user attached an image to this turn, the inbox cache is
      // *always* potentially stale (the chat handler now mirrors uploaded
      // receipts into the document inbox). Pre-seed the affected set so the
      // inbox refreshes even when the server forgot to include it.
      const effective = new Set(affected);
      if (variables?.imageData) effective.add("documents");
      // Always include the historical transactions/accounts invalidation —
      // the assistant might add a row through any of several tool paths and
      // we'd rather over-invalidate by a few cheap queries than leave the
      // user staring at a stale list.
      effective.add("transactions");
      effective.add("accounts");

      const seen = new Set<string>();
      effective.forEach((tag) => {
        const keys = AFFECTED_KEYS[tag];
        if (!keys) return;
        for (const key of keys) {
          // Cheap dedupe so we only fire one invalidation per query key per
          // mutation, even if multiple tags map to overlapping keys.
          const sig = JSON.stringify(key);
          if (seen.has(sig)) continue;
          seen.add(sig);
          queryClient.invalidateQueries({ queryKey: key as unknown[] });
        }
      });

      // Account trailing balances are computed client-side per period, so
      // they don't live behind a single query key — invalidate them through
      // the dedicated helper that walks every cached period.
      if (
        effective.has("transactions") ||
        effective.has("journal-entries") ||
        effective.has("accounts")
      ) {
        invalidateAccountBalances();
      }
    },
    onError: (err, _, context) => {
      queryClient.setQueryData([api.chat.list.path], context?.previousMessages);
      toast({
        title: "عذراً",
        description: err.message,
        variant: "destructive",
      });
    }
  });
}
