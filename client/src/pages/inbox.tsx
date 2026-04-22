import { useEffect, useMemo, useRef, useState } from "react";
// `key={selected.id}` on <DocumentDetail /> means each new selection mounts a
// fresh component, so `hydrated` resets per-document automatically.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocale } from "@/contexts/locale-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Trash2, Check, AlertTriangle, Loader2 } from "lucide-react";
import type {
  DocumentRow,
  ExtractedDocument,
  SuggestedJournal,
  Account,
} from "@shared/schema";

type Status = "extracting" | "ready" | "posted" | "error";

function fmtMoney(n: number | null | undefined, code = "") {
  if (n == null || isNaN(Number(n))) return "—";
  return `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${code ? " " + code : ""}`;
}

function StatusPill({ status, ar }: { status: Status; ar: boolean }) {
  const map: Record<Status, { label: string; cls: string }> = {
    extracting: {
      label: ar ? "قيد القراءة" : "Reading",
      cls: "border-border text-muted-foreground bg-muted/40",
    },
    ready: {
      label: ar ? "جاهز للمراجعة" : "Ready to review",
      cls: "border-foreground/20 text-foreground bg-background",
    },
    posted: {
      label: ar ? "مُرحَّل" : "Posted",
      cls: "border-emerald-700/30 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5",
    },
    error: {
      label: ar ? "خطأ" : "Error",
      cls: "border-destructive/30 text-destructive bg-destructive/5",
    },
  };
  const it = map[status] ?? map.extracting;
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider font-medium ${it.cls}`}
      data-testid={`status-${status}`}
    >
      {it.label}
    </span>
  );
}

export default function InboxPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: docs = [], isLoading } = useQuery<DocumentRow[]>({
    queryKey: ["/api/documents"],
    refetchInterval: (q) => {
      const data = q.state.data as DocumentRow[] | undefined;
      return data?.some((d) => d.status === "extracting") ? 2000 : false;
    },
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  );

  // Auto-select the most recent ready/posted doc on first load.
  useEffect(() => {
    if (selectedId == null && docs.length > 0) {
      setSelectedId(docs[0].id);
    }
  }, [docs, selectedId]);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/documents", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `${res.status}`);
      }
      return (await res.json()) as DocumentRow;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setSelectedId(row.id);
    },
    onError: (e: Error) => {
      toast({
        variant: "destructive",
        title: ar ? "فشل الرفع" : "Upload failed",
        description: e.message.replace(/^\d+:\s*/, ""),
      });
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/documents/${id}`),
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      if (selectedId === id) setSelectedId(null);
    },
  });

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => uploadMut.mutate(f));
  }

  return (
    <div className="px-6 py-8 max-w-[1400px] mx-auto" dir={ar ? "rtl" : "ltr"}>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
            {ar ? "صندوق الوارد" : "Inbox"}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="heading-inbox">
            {ar ? "التقاط الفواتير والإيصالات" : "Capture receipts & invoices"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {ar
              ? "ارفع صورة أو إيصالاً ممسوحاً ضوئياً، نقرأه ونقترح عليك القيد المحاسبي الصحيح للمراجعة بنقرة."
              : "Upload a photo or scan. We read it and suggest the correct journal entry for one-click posting."}
          </p>
        </div>
        <Button
          onClick={() => fileInput.current?.click()}
          disabled={uploadMut.isPending}
          data-testid="button-upload"
        >
          {uploadMut.isPending ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="me-2 h-4 w-4" />
          )}
          {ar ? "رفع مستند" : "Upload"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
          data-testid="input-file"
        />
      </div>

      <div
        className={`grid gap-px bg-border rounded-md overflow-hidden border border-border ${
          ar ? "grid-cols-[420px_1fr]" : "grid-cols-[420px_1fr]"
        }`}
        style={{ minHeight: "70vh" }}
      >
        {/* List column */}
        <div className="bg-background flex flex-col">
          <div
            className={`p-4 text-sm border-b border-border ${
              dragOver ? "bg-muted/40" : ""
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            data-testid="dropzone"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="uppercase tracking-wider">
                {ar ? "اسحب وأفلت" : "Drag & drop"}
              </span>
              <span className="font-mono">
                {docs.length} {ar ? "مستند" : "docs"}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              {ar ? "جارٍ التحميل…" : "Loading…"}
            </div>
          ) : docs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto h-8 w-8 mb-3 opacity-40" strokeWidth={1.5} />
              <div className="mb-1">{ar ? "لا مستندات بعد" : "No documents yet"}</div>
              <div className="text-xs">
                {ar
                  ? "اسحب صورة فاتورة أو إيصال هنا، أو اضغط رفع."
                  : "Drop an invoice or receipt here, or click upload."}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-y-auto" data-testid="list-documents">
              {docs.map((d) => {
                const ext = (d.extractedJson as ExtractedDocument | null) ?? null;
                const isSel = selectedId === d.id;
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={`w-full text-start px-4 py-3 hover:bg-muted/40 transition-colors ${
                        isSel ? "bg-muted/60" : ""
                      }`}
                      data-testid={`row-document-${d.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">
                            {ext?.vendor || d.fileName}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {ext?.documentDate ?? new Date(d.uploadedAt!).toLocaleDateString()}
                            {ext?.invoiceNumber ? ` · ${ext.invoiceNumber}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="font-mono text-sm tabular-nums">
                            {fmtMoney(ext?.total ?? null, ext?.currency ?? "")}
                          </span>
                          <StatusPill status={d.status as Status} ar={ar} />
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Detail column */}
        <div className="bg-background overflow-y-auto">
          {selected ? (
            <DocumentDetail
              key={selected.id}
              doc={selected}
              accounts={accounts}
              ar={ar}
              onDelete={() => deleteMut.mutate(selected.id)}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-10 text-sm text-muted-foreground">
              {ar ? "اختر مستنداً من القائمة" : "Select a document"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentDetail({
  doc,
  accounts,
  ar,
  onDelete,
}: {
  doc: DocumentRow;
  accounts: Account[];
  ar: boolean;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const ext = (doc.extractedJson as ExtractedDocument | null) ?? null;
  const sug = (doc.suggestedJournalJson as SuggestedJournal | null) ?? null;

  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [lines, setLines] = useState<
    { accountId: number; debit: number; credit: number; description: string }[]
  >([]);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate the form whenever a new suggestion arrives. The same row can
  // transition extracting → ready in-place (we poll the inbox list), so
  // initializing only via `useState` would leave the form stuck on stale
  // defaults until the user re-selects the row.
  useEffect(() => {
    if (hydrated) return;
    if (!sug && doc.status !== "ready") return;
    setDescription(
      sug?.description ??
        `${ext?.vendor ?? "Document"}${ext?.invoiceNumber ? ` #${ext.invoiceNumber}` : ""}`,
    );
    setEntryDate(
      sug?.entryDate ?? ext?.documentDate ?? new Date().toISOString().slice(0, 10),
    );
    setLines(
      sug?.lines.map((l) => ({
        accountId: l.accountId,
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        description: l.description ?? "",
      })) ?? [
        { accountId: 0, debit: 0, credit: 0, description: "" },
        { accountId: 0, debit: 0, credit: 0, description: "" },
      ],
    );
    setHydrated(true);
  }, [sug, ext, doc.status, hydrated]);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const postable = accounts.filter((a) => !a.isHeader && a.isActive);

  const postMut = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/documents/${doc.id}/post`, {
        description,
        entryDate,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description || undefined,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/journal-entries"] });
      toast({
        title: ar ? "تم الترحيل" : "Posted",
        description: ar
          ? "تم إنشاء قيد اليومية وربطه بالمستند."
          : "Journal entry created and linked.",
      });
    },
    onError: (e: Error) => {
      toast({
        variant: "destructive",
        title: ar ? "فشل الترحيل" : "Post failed",
        description: e.message.replace(/^\d+:\s*/, ""),
      });
    },
  });

  const showImage = doc.mimeType.startsWith("image/");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 divide-x divide-border h-full">
      {/* Left: original document image */}
      <div className="p-6 bg-muted/30 flex items-start justify-center">
        {showImage ? (
          <img
            src={`/api/documents/${doc.id}/file`}
            alt={doc.fileName}
            className="max-w-full max-h-[80vh] object-contain rounded-sm border border-border bg-background"
            data-testid="img-document"
          />
        ) : (
          <div className="text-sm text-muted-foreground">
            {ar ? "معاينة غير متوفرة" : "Preview unavailable"}
          </div>
        )}
      </div>

      {/* Right: extracted data + JE preview */}
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
              {ar ? "ملخّص المستند" : "Document summary"}
            </div>
            <div className="text-base font-medium">
              {ext?.vendor || doc.fileName}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            data-testid="button-delete-document"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {doc.status === "extracting" && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {ar ? "جارٍ قراءة المستند…" : "Reading document…"}
          </div>
        )}

        {doc.status === "error" && (
          <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium mb-0.5">{ar ? "تعذّر القراءة" : "Could not read"}</div>
              <div className="text-xs opacity-90">{doc.errorMessage}</div>
            </div>
          </div>
        )}

        {ext && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label={ar ? "المورد" : "Vendor"} value={ext.vendor} />
            <Field label={ar ? "رقم الفاتورة" : "Invoice #"} value={ext.invoiceNumber} mono />
            <Field label={ar ? "التاريخ" : "Date"} value={ext.documentDate} mono />
            <Field label={ar ? "العملة" : "Currency"} value={ext.currency} mono />
            <Field
              label={ar ? "المجموع الفرعي" : "Subtotal"}
              value={ext.subtotal != null ? fmtMoney(ext.subtotal) : null}
              mono
            />
            <Field
              label={ar ? `ضريبة القيمة المضافة${ext.vatRate ? ` (${(ext.vatRate * 100).toFixed(0)}%)` : ""}` : `VAT${ext.vatRate ? ` (${(ext.vatRate * 100).toFixed(0)}%)` : ""}`}
              value={ext.vatAmount != null ? fmtMoney(ext.vatAmount) : null}
              mono
            />
            <Field
              label={ar ? "الإجمالي" : "Total"}
              value={ext.total != null ? fmtMoney(ext.total) : null}
              mono
              strong
            />
            <Field
              label={ar ? "طريقة الدفع" : "Payment"}
              value={ext.paymentMethod}
            />
          </div>
        )}

        {doc.status === "ready" && (
          <div className="border-t border-border pt-5 space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
                {ar ? "القيد المقترح" : "Suggested journal"}
              </div>
              {sug?.reasoning && (
                <p className="text-xs text-muted-foreground mt-1">{sug.reasoning}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "الوصف" : "Description"}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  data-testid="input-je-description"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{ar ? "التاريخ" : "Date"}</Label>
                <Input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  data-testid="input-je-date"
                />
              </div>
            </div>

            <div className="border border-border rounded-sm overflow-hidden">
              <div className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <div>{ar ? "الحساب" : "Account"}</div>
                <div className="text-end">{ar ? "مدين" : "Debit"}</div>
                <div className="text-end">{ar ? "دائن" : "Credit"}</div>
                <div></div>
              </div>
              <div className="divide-y divide-border">
                {lines.map((ln, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 items-center"
                    data-testid={`row-je-line-${i}`}
                  >
                    <Select
                      value={ln.accountId ? String(ln.accountId) : ""}
                      onValueChange={(v) => {
                        const next = [...lines];
                        next[i] = { ...next[i], accountId: parseInt(v, 10) };
                        setLines(next);
                      }}
                    >
                      <SelectTrigger className="h-8 text-sm" data-testid={`select-account-${i}`}>
                        <SelectValue placeholder={ar ? "اختر حساباً" : "Select account"} />
                      </SelectTrigger>
                      <SelectContent>
                        {postable.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            <span className="font-mono text-xs text-muted-foreground me-2">{a.code}</span>
                            {ar ? a.nameAr : a.nameEn}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={ln.debit || ""}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = {
                          ...next[i],
                          debit: parseFloat(e.target.value) || 0,
                          credit: 0,
                        };
                        setLines(next);
                      }}
                      className="h-8 text-end font-mono text-sm tabular-nums"
                      data-testid={`input-debit-${i}`}
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={ln.credit || ""}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = {
                          ...next[i],
                          credit: parseFloat(e.target.value) || 0,
                          debit: 0,
                        };
                        setLines(next);
                      }}
                      className="h-8 text-end font-mono text-sm tabular-nums"
                      data-testid={`input-credit-${i}`}
                    />
                    <button
                      type="button"
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                      disabled={lines.length <= 2}
                      data-testid={`button-remove-line-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 bg-muted/40 border-t border-border text-sm">
                <div className="text-xs text-muted-foreground self-center">
                  {ar ? "الإجمالي" : "Totals"}
                </div>
                <div className="text-end font-mono tabular-nums" data-testid="text-total-debit">
                  {fmtMoney(totalDebit)}
                </div>
                <div className="text-end font-mono tabular-nums" data-testid="text-total-credit">
                  {fmtMoney(totalCredit)}
                </div>
                <div></div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setLines([...lines, { accountId: 0, debit: 0, credit: 0, description: "" }])
                }
                className="text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-add-line"
              >
                {ar ? "+ إضافة سطر" : "+ Add line"}
              </button>
              <div className="flex items-center gap-3">
                {!balanced && (
                  <span className="text-xs text-muted-foreground">
                    {ar ? "غير متوازن" : "Unbalanced"}
                  </span>
                )}
                <Button
                  onClick={() => postMut.mutate()}
                  disabled={!balanced || postMut.isPending || lines.some((l) => !l.accountId)}
                  data-testid="button-post-document"
                >
                  {postMut.isPending ? (
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="me-2 h-4 w-4" />
                  )}
                  {ar ? "ترحيل القيد" : "Post entry"}
                </Button>
              </div>
            </div>
          </div>
        )}

        {doc.status === "posted" && (
          <div className="border-t border-border pt-5 text-sm">
            <div className="rounded-sm border border-emerald-700/30 bg-emerald-500/5 px-3 py-2 text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <Check className="h-4 w-4" />
              {ar
                ? `تم الترحيل كـ قيد رقم ${doc.journalEntryId}`
                : `Posted as journal entry #${doc.journalEntryId}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono tabular-nums" : ""} ${
          strong ? "font-semibold" : ""
        } text-sm`}
      >
        {value == null || value === "" ? "—" : value}
      </div>
    </div>
  );
}
