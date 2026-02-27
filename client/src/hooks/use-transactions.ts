import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type TransactionInput } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// Helper for parsing Zod responses safely
function parseWithLogging<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod] ${label} validation failed:`, result.error.format());
    // Fallback to casting if validation fails to prevent full app crashes
    // since we trust our backend shape mostly, but want to log deviations.
    return data as T; 
  }
  return result.data;
}

export function useTransactions() {
  return useQuery({
    queryKey: [api.transactions.list.path],
    queryFn: async () => {
      const res = await fetch(api.transactions.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("فشل في جلب المعاملات");
      const data = await res.json();
      return parseWithLogging<any[]>(api.transactions.list.responses[200], data, "transactions.list");
    },
  });
}

export function useTransactionSummary() {
  return useQuery({
    queryKey: [api.transactions.summary.path],
    queryFn: async () => {
      const res = await fetch(api.transactions.summary.path, { credentials: "include" });
      if (!res.ok) throw new Error("فشل في جلب الملخص");
      const data = await res.json();
      return parseWithLogging<{totalIncome: number, totalExpense: number, balance: number}>(
        api.transactions.summary.responses[200], 
        data, 
        "transactions.summary"
      );
    },
  });
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (data: TransactionInput) => {
      const res = await fetch(api.transactions.create.path, {
        method: api.transactions.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const errData = await res.json();
          throw new Error(errData.message || "بيانات غير صالحة");
        }
        throw new Error("فشل في إضافة المعاملة");
      }
      
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.transactions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.transactions.summary.path] });
      toast({
        title: "تم بنجاح!",
        description: "تمت إضافة المعاملة الجديدة.",
      });
    },
    onError: (error) => {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useDeleteTransaction() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.transactions.delete.path, { id });
      const res = await fetch(url, {
        method: api.transactions.delete.method,
        credentials: "include",
      });
      
      if (!res.ok) throw new Error("فشل في حذف المعاملة");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.transactions.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.transactions.summary.path] });
      toast({
        title: "تم الحذف",
        description: "تم مسح المعاملة بنجاح.",
      });
    },
    onError: (error) => {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}
