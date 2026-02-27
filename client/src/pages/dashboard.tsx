import { useTransactions, useTransactionSummary } from "@/hooks/use-transactions";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { ArrowDownRight, ArrowUpRight, Wallet, Activity, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useTransactionSummary();
  const { data: transactions, isLoading: isTxLoading } = useTransactions();

  const recentTransactions = transactions?.slice(0, 5) || [];

  return (
    <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">نظرة عامة</h1>
        <p className="text-muted-foreground mt-2 font-medium">مرحباً بك! إليك ملخص لأموالك اليوم.</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isSummaryLoading ? (
          <>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </>
        ) : (
          <>
            <Card className="rounded-2xl border-none shadow-lg shadow-black/5 bg-gradient-to-br from-card to-card hover:shadow-xl transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors"></div>
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold text-muted-foreground">الرصيد الإجمالي</CardTitle>
                <div className="p-3 bg-primary/10 rounded-2xl text-primary">
                  <Wallet className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-4xl font-black text-foreground">
                  {summary?.balance.toLocaleString('ar-SA')} <span className="text-lg text-muted-foreground font-medium">ر.س</span>
                </div>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1 font-medium">
                  <Activity className="w-3 h-3" /> متاح حالياً
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-none shadow-lg shadow-emerald-500/5 hover:shadow-xl hover:shadow-emerald-500/10 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-colors"></div>
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold text-emerald-600/80">إجمالي الإيرادات</CardTitle>
                <div className="p-3 bg-emerald-100 text-emerald-600 rounded-2xl">
                  <ArrowUpRight className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-3xl font-black text-emerald-600">
                  {summary?.totalIncome.toLocaleString('ar-SA')} <span className="text-lg font-medium opacity-80">ر.س</span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-none shadow-lg shadow-rose-500/5 hover:shadow-xl hover:shadow-rose-500/10 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl group-hover:bg-rose-500/10 transition-colors"></div>
              <CardHeader className="flex flex-row items-center justify-between pb-2 z-10 relative">
                <CardTitle className="text-sm font-bold text-rose-600/80">إجمالي المصروفات</CardTitle>
                <div className="p-3 bg-rose-100 text-rose-600 rounded-2xl">
                  <ArrowDownRight className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="z-10 relative">
                <div className="text-3xl font-black text-rose-600">
                  {summary?.totalExpense.toLocaleString('ar-SA')} <span className="text-lg font-medium opacity-80">ر.س</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="mt-12">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-secondary rounded-lg">
            <ReceiptText className="w-5 h-5 text-foreground" />
          </div>
          <h2 className="text-2xl font-bold">أحدث المعاملات</h2>
        </div>
        
        <Card className="rounded-2xl border-none shadow-lg shadow-black/5 overflow-hidden">
          <div className="divide-y divide-border/50">
            {isTxLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-6 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Skeleton className="w-12 h-12 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="w-32 h-4" />
                      <Skeleton className="w-20 h-3" />
                    </div>
                  </div>
                  <Skeleton className="w-24 h-6" />
                </div>
              ))
            ) : recentTransactions.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                <ReceiptText className="w-12 h-12 opacity-20 mb-4" />
                <p className="font-medium text-lg">لا توجد معاملات حتى الآن</p>
                <p className="text-sm opacity-70">اذهب إلى صفحة المعاملات لإضافة أول معاملة لك.</p>
              </div>
            ) : (
              recentTransactions.map((tx) => (
                <div key={tx.id} className="p-6 flex items-center justify-between hover:bg-muted/30 transition-colors group">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                      tx.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                    }`}>
                      {tx.type === 'income' ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="font-bold text-foreground text-lg">{tx.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-semibold px-2 py-1 bg-secondary text-secondary-foreground rounded-md">
                          {tx.category}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                          {format(new Date(tx.date || new Date()), 'd MMMM yyyy', { locale: ar })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={`font-black text-xl flex items-center gap-1 ${
                    tx.type === 'income' ? 'text-emerald-600' : 'text-rose-600'
                  }`}>
                    {tx.type === 'income' ? '+' : '-'}
                    {Number(tx.amount).toLocaleString('ar-SA')}
                    <span className="text-sm font-medium opacity-70">ر.س</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
