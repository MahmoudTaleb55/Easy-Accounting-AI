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
import { ArrowRight, ArrowLeft, FileDown, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import type { SalesInvoiceWithLines, SalesInvoiceStatus } from "@shared/schema";

const STATUS_VARIANTS: Record<SalesInvoiceStatus, "secondary" | "default" | "destructive"> = {
  draft: "secondary",
  posted: "default",
  cancelled: "destructive",
};

export default function SalesInvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = Number(params.id);
  const { locale } = useLocale();
  const isAr = locale === "ar";
  const formatMoney = useFormatMoney();
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: invoice, isLoading } = useQuery<SalesInvoiceWithLines>({
    queryKey: ["/api/sales/invoices", invoiceId],
    enabled: Number.isFinite(invoiceId) && invoiceId > 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/sales/invoices"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales/invoices", invoiceId] });
    queryClient.invalidateQueries({ queryKey: ["/api/sales/customers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
  };

  const postMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/sales/invoices/${invoiceId}/post`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: isAr ? "تم ترحيل الفاتورة" : "Invoice posted" });
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
      const res = await apiRequest("POST", `/api/sales/invoices/${invoiceId}/cancel`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: isAr ? "تم إلغاء الفاتورة" : "Invoice cancelled" });
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
      await apiRequest("DELETE", `/api/sales/invoices/${invoiceId}`);
    },
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      toast({ title: isAr ? "تم حذف الفاتورة" : "Invoice deleted" });
      window.history.back();
    },
    onError: (err: any) =>
      toast({
        title: isAr ? "تعذر الحذف" : "Delete failed",
        description: err?.message,
        variant: "destructive",
      }),
  });

  const downloadPdf = async () => {
    try {
      // Forward the active UI locale so the server renders the PDF in the
      // same language the user is currently viewing the app in. Default
      // (no `?lang=`) is Arabic on the server side.
      const res = await fetch(`/api/sales/invoices/${invoiceId}/pdf?lang=${encodeURIComponent(locale)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice?.number || "invoice"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({
        title: isAr ? "تعذر تنزيل الملف" : "Download failed",
        description: err?.message,
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="sales-invoice-detail-loading">
        <div className="h-8 w-40 bg-muted animate-pulse rounded" />
        <div className="h-72 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-sm text-muted-foreground" data-testid="sales-invoice-not-found">
        {isAr ? "الفاتورة غير موجودة." : "Invoice not found."}
      </div>
    );
  }

  const status = invoice.status as SalesInvoiceStatus;
  const BackIcon = isAr ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6" data-testid="sales-invoice-detail-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <Link href="/app/sales/invoices">
            <Button variant="ghost" size="sm" data-testid="button-back-to-invoices">
              <BackIcon className="size-4 me-1" />
              {isAr ? "كل الفواتير" : "All invoices"}
            </Button>
          </Link>
          <h1
            className="text-2xl font-semibold tracking-tight font-mono"
            data-testid="text-invoice-number"
          >
            {invoice.number}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[status]} data-testid="badge-invoice-status">
              {invoice.status}
            </Badge>
            {invoice.journalEntryReference && (
              <span className="text-xs text-muted-foreground font-mono" data-testid="text-je-reference">
                {invoice.journalEntryReference}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={downloadPdf}
            data-testid="button-download-pdf"
          >
            <FileDown className="size-4 me-1" />
            PDF
          </Button>
          {status === "draft" && (
            <WriteGuard>
              <Button
                onClick={() => postMut.mutate()}
                disabled={postMut.isPending}
                data-testid="button-post-invoice"
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
                data-testid="button-cancel-invoice"
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
                  <Button variant="ghost" data-testid="button-delete-invoice">
                    <Trash2 className="size-4 me-1 text-destructive" />
                    {isAr ? "حذف" : "Delete"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {isAr ? "حذف الفاتورة؟" : "Delete invoice?"}
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
                  <TableHead className="text-end">{isAr ? "السعر" : "Price"}</TableHead>
                  <TableHead className="text-end">{isAr ? "ض.ق.م" : "VAT"}</TableHead>
                  <TableHead className="text-end">{isAr ? "الإجمالي" : "Total"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((line) => (
                  <TableRow key={line.id} data-testid={`row-line-${line.id}`}>
                    <TableCell>{line.description || "—"}</TableCell>
                    <TableCell className="text-end font-mono">
                      {Number(line.quantity)}
                    </TableCell>
                    <TableCell className="text-end font-mono">
                      {formatMoney(Number(line.unitPrice))}
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
            <Row label={isAr ? "العميل" : "Customer"}>
              {invoice.customer?.nameAr || invoice.customer?.nameEn || `#${invoice.customerId}`}
            </Row>
            <Row label={isAr ? "التاريخ" : "Date"}>{invoice.invoiceDate}</Row>
            {invoice.dueDate && (
              <Row label={isAr ? "الاستحقاق" : "Due"}>{invoice.dueDate}</Row>
            )}
            <Row label={isAr ? "طريقة الدفع" : "Payment"}>
              {invoice.paymentMethod === "cash" ? (isAr ? "نقدي" : "Cash") : isAr ? "آجل" : "Credit"}
            </Row>
            <div className="border-t pt-2 mt-2 space-y-2">
              <Row label={isAr ? "قبل الضريبة" : "Subtotal"}>
                <span className="font-mono" data-testid="text-detail-subtotal">
                  {formatMoney(Number(invoice.subtotal))}
                </span>
              </Row>
              <Row label={isAr ? "ضريبة القيمة المضافة" : "VAT"}>
                <span className="font-mono" data-testid="text-detail-vat">
                  {formatMoney(Number(invoice.vatAmount))}
                </span>
              </Row>
              <Row label={isAr ? "الإجمالي" : "Total"}>
                <span className="font-mono font-semibold" data-testid="text-detail-total">
                  {formatMoney(Number(invoice.totalAmount))}
                </span>
              </Row>
            </div>
            {invoice.notes && (
              <div className="border-t pt-2 mt-2 text-muted-foreground whitespace-pre-wrap">
                {invoice.notes}
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
