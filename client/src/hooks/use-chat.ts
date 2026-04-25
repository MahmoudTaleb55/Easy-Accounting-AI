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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.chat.list.path] });
      // The AI might have added a transaction, so we invalidate those too
      queryClient.invalidateQueries({ queryKey: [api.transactions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.transactions.summary.path] });
      // Any AI-added transaction also auto-posts a JE, so the chart of
      // accounts trailing balances need to be invalidated for every
      // period the user might flip back to.
      invalidateAccountBalances();
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
