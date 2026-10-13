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
  const { dir } = useLocale();
  const t = useT();
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
      toast({ title: t("bill_toast_posted") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("bill_post_failed"),
        description: t(mapErrorKey(err)),
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
      toast({ title: t("bill_toast_cancelled") });
    },
    onError: (err: unknown) =>
      toast({
        title: t("bill_cancel_failed"),
        description: t(mapErrorKey(err)),
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
      toast({ title: t("bill_toast_deleted") });
      window.history.back();
    },
    onError: (err: unknown) =>
      toast({
        title: t("bill_delete_failed"),
        description: t(mapErrorKey(err)),
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
        {t("bill_not_found")}
      </div>
    );
  }

  const status = bill.status as PurchaseInvoiceStatus;
  const BackIcon = dir === "rtl" ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-6" data-testid="purchase-bill-detail-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <Link href="/app/purchases/bills">
            <Button variant="ghost" size="sm" data-testid="button-back-to-bills">
              <BackIcon className="size-4 me-1" />
              {t("bill_all")}
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
                {t("bill_post")}
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
                {t("bill_cancel_reverse")}
              </Button>
            </WriteGuard>
          )}
          {status !== "posted" && (
            <WriteGuard>
              <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" data-testid="button-delete-bill">
                    <Trash2 className="size-4 me-1 text-destructive" />
                    {t("bill_delete")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("bill_delete_q")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("bill_delete_desc")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">
                      {t("purch_cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMut.mutate()}
                      data-testid="button-confirm-delete"
                    >
                      {t("bill_delete")}
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
            <CardTitle>{t("bill_lines")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("bill_description")}</TableHead>
                  <TableHead className="text-end">{t("bill_qty")}</TableHead>
                  <TableHead className="text-end">{t("bill_cost")}</TableHead>
                  <TableHead className="text-end">{t("bill_vat")}</TableHead>
                  <TableHead className="text-end">{t("purch_total")}</TableHead>
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
            <CardTitle>{t("bill_summary")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t("purch_vendor")}>
              {bill.vendor?.nameAr || bill.vendor?.nameEn || `#${bill.vendorId}`}
            </Row>
            <Row label={t("purch_date")}>{bill.invoiceDate}</Row>
            {bill.dueDate && (
              <Row label={t("bill_due")}>{bill.dueDate}</Row>
            )}
            <Row label={t("purch_payment")}>
              {bill.paymentMethod === "cash" ? t("purch_cash") : t("purch_credit")}
            </Row>
            {bill.vendorReference && (
              <Row label={t("bill_vendor_ref")}>
                <span className="font-mono">{bill.vendorReference}</span>
              </Row>
            )}
            <div className="border-t pt-2 mt-2 space-y-2">
              <Row label={t("purch_subtotal")}>
                <span className="font-mono" data-testid="text-detail-subtotal">
                  {formatMoney(Number(bill.subtotal))}
                </span>
              </Row>
              <Row label={t("purch_input_vat")}>
                <span className="font-mono" data-testid="text-detail-vat">
                  {formatMoney(Number(bill.vatAmount))}
                </span>
              </Row>
              <Row label={t("purch_total")}>
                <span className="font-mono font-semibold" data-testid="text-detail-total">
                  {formatMoney(Number(bill.totalAmount))}
                </span>
              </Row>
              <Row label={t("bill_paid")}>
                <span className="font-mono" data-testid="text-detail-paid">
                  {formatMoney(Number(bill.paidAmount))}
                </span>
              </Row>
              <Row label={t("purch_open")}>
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
