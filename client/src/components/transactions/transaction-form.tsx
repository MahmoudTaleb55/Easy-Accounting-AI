import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { insertTransactionSchema } from "@shared/schema";
import { useCreateTransaction } from "@/hooks/use-transactions";
import { Loader2 } from "lucide-react";

// The schema expects amount to be string or number, we'll cast it properly
const formSchema = insertTransactionSchema.extend({
  amount: z.coerce.number().min(0.01, "المبلغ يجب أن يكون أكبر من 0"),
  description: z.string().min(2, "الوصف مطلوب"),
  category: z.string().min(2, "الفئة مطلوبة"),
});

type FormValues = z.infer<typeof formSchema>;

export function TransactionForm({ onSuccess }: { onSuccess?: () => void }) {
  const mutation = useCreateTransaction();
  
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "expense",
      amount: 0,
      description: "",
      category: "",
    },
  });

  const onSubmit = async (data: FormValues) => {
    mutation.mutate(data, {
      onSuccess: () => {
        form.reset();
        onSuccess?.();
      },
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-semibold">نوع المعاملة</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value} dir="rtl">
                  <FormControl>
                    <SelectTrigger className="h-12 rounded-xl bg-background border-2 focus:ring-primary/20 transition-all">
                      <SelectValue placeholder="اختر النوع" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="income" className="font-medium text-emerald-600 focus:text-emerald-700">إيراد (+)</SelectItem>
                    <SelectItem value="expense" className="font-medium text-rose-600 focus:text-rose-700">مصروف (-)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-base font-semibold">المبلغ</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input 
                      placeholder="0.00" 
                      type="number" 
                      step="0.01" 
                      className="h-12 rounded-xl bg-background border-2 pl-12 focus:ring-primary/20 transition-all text-lg font-bold" 
                      {...field} 
                    />
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">ر.س</span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">الفئة</FormLabel>
              <FormControl>
                <Input 
                  placeholder="مثال: رواتب، إيجار، طعام..." 
                  className="h-12 rounded-xl bg-background border-2 focus:ring-primary/20 transition-all" 
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-base font-semibold">الوصف</FormLabel>
              <FormControl>
                <Input 
                  placeholder="وصف تفصيلي للمعاملة" 
                  className="h-12 rounded-xl bg-background border-2 focus:ring-primary/20 transition-all" 
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button 
          type="submit" 
          disabled={mutation.isPending}
          className="w-full h-14 text-lg font-bold rounded-xl bg-gradient-to-l from-primary to-primary/80 hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 active:translate-y-0 transition-all"
        >
          {mutation.isPending ? (
            <><Loader2 className="w-5 h-5 ml-2 animate-spin" /> جاري الحفظ...</>
          ) : (
            "إضافة المعاملة"
          )}
        </Button>
      </form>
    </Form>
  );
}
