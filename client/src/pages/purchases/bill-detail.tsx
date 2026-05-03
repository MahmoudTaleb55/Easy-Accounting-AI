import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatMoney } from "@/lib/format";
import { useLocale } from "@/contexts/locale-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { WriteGuard } from "@/components/auth/write-guard";
import { ArrowRight, ArrowLeft, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import type { PurchaseInvoiceWithLines, PurchaseInvoiceStatus } from "@shared/schema";

const STATUS_VARIANTS: Record<PurchaseInvoiceStatus, "secondary" | "default" | "destructive"> = {
  draft: "secondary",
  posted: "default",
  cancelled: "destructive",
};

export default function PurchaseBillDetailPage() {
  const params = useParams<{ id: string }>();
  const billId = Number(params.id);
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: bill, isLoading } = useQuery<PurchaseInvoiceWithLines>({
    queryKey: ["/api/purchases/bills", billId],
    enabled: Number.isFinite(billId) && billId > 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/purchases/bills"] });
    queryClient.invalidateQueries({ queryKey: ["/api/purchases/bills", billId] });
    queryClient.invalidateQueries({ queryKey: ["/api/purchases/vendors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/purchases/aging"] });
    queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
  };

  const postMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/purchases/bills/${billId}/post`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: isAr ? "تم ترحيل الفاتورة" : "Bill posted" });
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر الترحيل" : "Posting failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/purchases/bills/${billId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: isAr ? "تم إلغاء الفاتورة" : "Bill cancelled" });
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر الإلغاء" : "Cancel failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/purchases/bills/${billId}`);
    },
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      toast({ title: isAr ? "تم حذف الفاتورة" : "Bill deleted" });
      window.history.back();
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر الحذف" : "Delete failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="purchase-bill-detail-loading">
        <div className="h-8 w-40 bg-muted animate-pulse rounded" />
        <div className="h-72 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="purchase-bill-not-found">
        {isAr ? "الفاتورة غير موجودة." : "Bill not found."}
      </div>
    );
  }

  const status = bill.status as PurchaseInvoiceStatus;
  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6" data-testid="purchase-bill-detail-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <Link href="/app/purchases/bills">
            <Button variant="ghost" size="sm" data-testid="button-back-to-bills">
              <BackIcon className="size-4 me-1" />
              {isAr ? "كل الفواتير" : "All bills"}
            </Button>
          </Link>
          <h1
            className="text-2xl font-semibold tracking-tight font-mono"
            data-testid="text-bill-number"
          >
            {bill.number}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[status]} data-testid="badge-bill-status">
              {bill.status}
            </Badge>
            {bill.journalEntryReference && (
              <span className="text-xs text-muted-foreground font-mono" data-testid="text-je-reference">
                {bill.journalEntryReference}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {status === "draft" && (
            <WriteGuard>
              <Button
                onClick={() => postMut.mutate()}
                disabled={postMut.isPending}
                data-testid="button-post-bill"
              >
                <CheckCircle2 className="size-4 me-1" />
                {isAr ? "ترحيل" : "Post"}
              </Button>
            </WriteGuard>
          )}
          {status === "posted" && (
            <WriteGuard>
              <Button
                variant="outline"
                onClick={() => cancelMut.mutate()}
                disabled={cancelMut.isPending}
                data-testid="button-cancel-bill"
              >
                <XCircle className="size-4 me-1" />
                {isAr ? "إلغاء وعكس القيد" : "Cancel & reverse"}
              </Button>
            </WriteGuard>
          )}
          {status !== "posted" && (
            <WriteGuard>
              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" data-testid="button-delete-bill">
                    <Trash2 className="size-4 me-1 text-destructive" />
                    {isAr ? "حذف" : "Delete"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isAr ? "حذف الفاتورة؟" : "Delete bill?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {isAr
                        ? "لا يمكن التراجع عن هذا الإجراء."
                        : "This action cannot be undone."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">
                      {isAr ? "إلغاء" : "Cancel"}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate()}
                      data-testid="button-confirm-delete"
                    >
                      {isAr ? "حذف" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </WriteGuard>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{isAr ? "البنود" : "Lines"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isAr ? "الوصف" : "Description"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الكمية" : "Qty"}</TableHead>
                  <TableHead className="text-end">{isAr ? "التكلفة" : "Cost"}</TableHead>
                  <TableHead className="text-end">{isAr ? "ض.ق.م" : "VAT"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الإجمالي" : "Total"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bill.lines.map((line) => (
                  <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                    <TableCell>{line.description || "—"}</TableCell>
                    <TableCell className="text-end font-mono">
                      {Number(line.quantity)}
                    </TableCell>
                    <TableCell className="text-end font-mono">
                      {formatMoney(Number(line.unitCost))}
                    </TableCell>
                    <TableCell className="text-end font-mono">
                      {formatMoney(Number(line.lineVat))}
                    </TableCell>
                    <TableCell className="text-end font-mono">
                      {formatMoney(Number(line.lineTotal))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isAr ? "الملخص" : "Summary"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={isAr ? "المورد" : "Vendor"}>
              {bill.vendor?.nameAr || bill.vendor?.nameEn || `#${bill.vendorId}`}
            </Row>
            <Row label={isAr ? "التاريخ" : "Date"}>{bill.invoiceDate}</Row>
            {bill.dueDate && (
              <Row label={isAr ? "الاستحقاق" : "Due"}>{bill.dueDate}</Row>
            )}
            <Row label={isAr ? "طريقة الدفع" : "Payment"}>
              {bill.paymentMethod === "cash" ? (isAr ? "نقدي" : "Cash") : isAr ? "آجل" : "Credit"}
            </Row>
            {bill.vendorReference && (
              <Row label={isAr ? "مرجع المورد" : "Vendor ref"}>
                <span className="font-mono">{bill.vendorReference}</span>
              </Row>
            )}
            <div className="border-t pt-2 mt-2 space-y-2">
              <Row label={isAr ? "قبل الضريبة" : "Subtotal"}>
                <span className="font-mono" data-testid="text-detail-subtotal">
                  {formatMoney(Number(bill.subtotal))}
                </span>
              </Row>
              <Row label={isAr ? "ضريبة المدخلات" : "Input VAT"}>
                <span className="font-mono" data-testid="text-detail-vat">
                  {formatMoney(Number(bill.vatAmount))}
                </span>
              </Row>
              <Row label={isAr ? "الإجمالي" : "Total"}>
                <span className="font-mono font-semibold" data-testid="text-detail-total">
                  {formatMoney(Number(bill.totalAmount))}
                </span>
              </Row>
              <Row label={isAr ? "المدفوع" : "Paid"}>
                <span className="font-mono" data-testid="text-detail-paid">
                  {formatMoney(Number(bill.paidAmount))}
                </span>
              </Row>
              <Row label={isAr ? "المتبقي" : "Open"}>
                <span className="font-mono font-semibold" data-testid="text-detail-open">
                  {formatMoney(Number(bill.totalAmount) - Number(bill.paidAmount))}
                </span>
              </Row>
            </div>
            {bill.notes && (
              <div className="border-t pt-2 mt-2 text-muted-foreground whitespace-pre-wrap">
                {bill.notes}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}
