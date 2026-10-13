import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormatMoney } from "@/lib/format";
import { useLocale } from "@/contexts/locale-context";
import { useT } from "@/i18n/dict";
import { mapErrorKey } from "@/lib/error-messages";
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
  const { locale, dir } = useLocale();
  const t = useT();
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
      toast({ title: t("salesinv_toast_posted") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("salesinv_post_failed"),
        description: t(mapErrorKey(err)),
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
      toast({ title: t("salesinv_toast_cancelled") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("salesinv_cancel_failed"),
        description: t(mapErrorKey(err)),
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
      toast({ title: t("salesinv_toast_deleted") });
      window.history.back();
    },
    onError: (err: unknown) =>
      toast({
        title: t("salesinv_delete_failed"),
        description: t(mapErrorKey(err)),
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
    } catch (err: unknown) {
      toast({
        title: t("salesinv_download_failed"),
        description: t(mapErrorKey(err)),
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
        {t("salesinv_not_found")}
      </div>
    );
  }

  const status = invoice.status as SalesInvoiceStatus;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6" data-testid="sales-invoice-detail-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <Link href="/app/sales/invoices">
            <Button variant="ghost" size="sm" data-testid="button-back-to-invoices">
              <BackIcon className="size-4 me-1" />
              {t("salesinv_all")}
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
                {t("salesinv_post")}
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
                {t("salesinv_cancel_reverse")}
              </Button>
            </WriteGuard>
          )}
          {status !== "posted" && (
            <WriteGuard>
              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" data-testid="button-delete-invoice">
                    <Trash2 className="size-4 me-1 text-destructive" />
                    {t("salesinv_delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("salesinv_delete_q")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("salesinv_delete_desc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">
                      {t("sales_cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate()}
                      data-testid="button-confirm-delete"
                    >
                      {t("salesinv_delete")}
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
            <CardTitle>{t("salesinv_lines")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("salesinv_description")}</TableHead>
                  <TableHead className="text-end">{t("salesinv_qty")}</TableHead>
                  <TableHead className="text-end">{t("salesinv_price")}</TableHead>
                  <TableHead className="text-end">{t("sales_vat")}</TableHead>
                  <TableHead className="text-end">{t("sales_total")}</TableHead>
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
            <CardTitle>{t("salesinv_summary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t("sales_customer")}>
              {invoice.customer?.nameAr || invoice.customer?.nameEn || `#${invoice.customerId}`}
            </Row>
            <Row label={t("sales_date")}>{invoice.invoiceDate}</Row>
            {invoice.dueDate && (
              <Row label={t("salesinv_due")}>{invoice.dueDate}</Row>
            )}
            <Row label={t("sales_payment")}>
              {invoice.paymentMethod === "cash" ? t("sales_cash") : t("sales_credit")}
            </Row>
            <div className="border-t pt-2 mt-2 space-y-2">
              <Row label={t("sales_subtotal")}>
                <span className="font-mono" data-testid="text-detail-subtotal">
                  {formatMoney(Number(invoice.subtotal))}
                </span>
              </Row>
              <Row label={t("sales_vat")}>
                <span className="font-mono" data-testid="text-detail-vat">
                  {formatMoney(Number(invoice.vatAmount))}
                </span>
              </Row>
              <Row label={t("sales_total")}>
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
