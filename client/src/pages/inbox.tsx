import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Trash2,
  Check,
  AlertTriangle,
  Search,
  ArrowUpRight,
  CornerDownLeft,
} from "lucide-react";
import type {
  DocumentRow,
  ExtractedDocument,
  SuggestedJournal,
  Account,
} from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────────────────────

type Status = "extracting" | "ready" | "posting" | "posted" | "error";
type FilterStatus = "all" | "review" | "posted" | "error";

function fmtMoney(n: number | null | undefined) {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortDate(d: string | Date | null | undefined, ar: boolean) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(ar ? "ar-EG-u-nu-latn" : "en-GB", {
    day: "2-digit",
    month: "short",
  });
}

function timeAgo(d: string | Date | null | undefined, ar: boolean): string {
  if (!d) return "";
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return ar ? "الآن" : "now";
  if (m < 60) return ar ? `قبل ${m}د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return ar ? `قبل ${h}س` : `${h}h ago`;
  const days = Math.floor(h / 24);
  return ar ? `قبل ${days}ي` : `${days}d ago`;
}

function statusBucket(s: Status): "review" | "posted" | "error" {
  if (s === "posted") return "posted";
  if (s === "error") return "error";
  return "review";
}

// ─────────────────────────────────────────────────────────────────────────────
// Status indicator — a single hairline dot, no badge soup
// ─────────────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Status }) {
  const cls =
    status === "posted"
      ? "bg-emerald-500"
      : status === "error"
      ? "bg-destructive"
      : status === "ready"
      ? "bg-foreground"
      : "bg-muted-foreground/40";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} />;
}

function StatusLabel({ status, ar }: { status: Status; ar: boolean }) {
  const map: Record<Status, string> = {
    extracting: ar ? "قيد القراءة" : "Reading",
    ready: ar ? "جاهز" : "Ready",
    posting: ar ? "ترحيل…" : "Posting",
    posted: ar ? "مُرحَّل" : "Posted",
    error: ar ? "خطأ" : "Error",
  };
  return (
    <span
      className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
      data-testid={`status-${status}`}
    >
      {map[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const { data: docs = [], isLoading } = useQuery<DocumentRow[]>({
    queryKey: ["/api/documents"],
    refetchInterval: (q) => {
      const data = q.state.data as DocumentRow[] | undefined;
      return data?.some((d) => d.status === "extracting" || d.status === "posting")
        ? 2000
        : false;
    },
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
  });

  // ── KPI counts (this calendar month, by uploaded_at) ───────────────────
  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, []);

  const stats = useMemo(() => {
    const inMonth = (d: DocumentRow) =>
      new Date(d.uploadedAt!).getTime() >= monthStart;
    const review = docs.filter((d) => d.status === "ready").length;
    const reading = docs.filter(
      (d) => d.status === "extracting" || d.status === "posting",
    ).length;
    const postedThisMonth = docs.filter(
      (d) => d.status === "posted" && inMonth(d),
    );
    const totalThisMonth = postedThisMonth.reduce((s, d) => {
      const ext = d.extractedJson as ExtractedDocument | null;
      return s + (Number(ext?.total) || 0);
    }, 0);
    return {
      review,
      reading,
      postedCount: postedThisMonth.length,
      totalThisMonth,
    };
  }, [docs, monthStart]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter((d) => {
      if (filter !== "all" && statusBucket(d.status as Status) !== filter) return false;
      if (!q) return true;
      const ext = d.extractedJson as ExtractedDocument | null;
      const hay = `${ext?.vendor ?? ""} ${ext?.invoiceNumber ?? ""} ${d.fileName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [docs, filter, query]);

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  );

  // Auto-select first row of the visible list.
  useEffect(() => {
    if (selectedId == null && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    } else if (selectedId != null && !filtered.some((d) => d.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  // ── Keyboard navigation: j/k between rows, u to upload ──────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (filtered.length === 0) return;
      const idx = filtered.findIndex((d) => d.id === selectedId);
      if (e.key === "j") {
        e.preventDefault();
        setSelectedId(filtered[Math.min(filtered.length - 1, idx + 1)]?.id ?? null);
      } else if (e.key === "k") {
        e.preventDefault();
        setSelectedId(filtered[Math.max(0, idx - 1)]?.id ?? null);
      } else if (e.key === "u") {
        e.preventDefault();
        fileInput.current?.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedId]);

  // ── Mutations ───────────────────────────────────────────────────────────
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

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      Array.from(files)
        .filter((f) => f.type.startsWith("image/"))
        .forEach((f) => uploadMut.mutate(f));
    },
    [uploadMut],
  );

  return (
    <div className="space-y-6 px-6 py-8 max-w-[1480px] mx-auto" dir={ar ? "rtl" : "ltr"}>
      {/* ─── Header strip ─────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
            {ar ? "محاسب · ذكي" : "Smart Accountant"} · {ar ? "الوارد" : "Inbox"}
          </div>
          <h1
            className={`text-[28px] leading-[1.1] tracking-tight ${
              ar ? "font-semibold" : "font-display"
            }`}
            data-testid="heading-inbox"
          >
            {ar
              ? "كل فاتورة، قيدٌ موزون."
              : "Every receipt, a balanced entry."}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {ar
              ? "ارفع، راجع، ورحّل. نقرأ المستند، نطابق الحسابات، ونقترح القيد المحاسبي الصحيح."
              : "Upload, review, post. We read the document, map the accounts, and propose the correct journal entry."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="hidden md:inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            U
          </kbd>
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={uploadMut.isPending}
            data-testid="button-upload"
          >
            <Upload className="me-2 h-4 w-4" />
            {ar ? "رفع مستند" : "Upload document"}
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
      </header>

      {/* ─── KPI strip — disciplined, mono numerics ───────────────── */}
      <section
        className="grid grid-cols-2 md:grid-cols-4 border-y border-border divide-x divide-border rtl:divide-x-reverse"
        data-testid="kpi-strip"
      >
        <Kpi
          label={ar ? "للمراجعة" : "To review"}
          value={String(stats.review)}
          hint={ar ? "بانتظار قرارك" : "awaiting your decision"}
          accent={stats.review > 0}
        />
        <Kpi
          label={ar ? "قيد القراءة" : "Reading"}
          value={String(stats.reading)}
          hint={ar ? "تتم المعالجة" : "in progress"}
        />
        <Kpi
          label={ar ? "مُرحَّل هذا الشهر" : "Posted this month"}
          value={String(stats.postedCount)}
          hint={ar ? "قيد محاسبي" : "journal entries"}
        />
        <Kpi
          label={ar ? "إجمالي الشهر" : "Month total"}
          value={fmtMoney(stats.totalThisMonth)}
          hint={ar ? "قيمة المُرحَّل" : "value posted"}
          mono
        />
      </section>

      {/* ─── Filter + search row ─────────────────────────────────── */}
      <section className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          {(["all", "review", "posted", "error"] as FilterStatus[]).map((f) => {
            const labels: Record<FilterStatus, string> = {
              all: ar ? "الكل" : "All",
              review: ar ? "للمراجعة" : "Review",
              posted: ar ? "مُرحَّل" : "Posted",
              error: ar ? "أخطاء" : "Errors",
            };
            const counts: Record<FilterStatus, number> = {
              all: docs.length,
              review: docs.filter((d) => statusBucket(d.status as Status) === "review").length,
              posted: docs.filter((d) => d.status === "posted").length,
              error: docs.filter((d) => d.status === "error").length,
            };
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 rounded-sm border transition-colors ${
                  active
                    ? "border-foreground/30 bg-foreground/5 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`filter-${f}`}
              >
                {labels[f]}
                <span className="ms-1.5 font-mono text-[10px] opacity-70">
                  {counts[f]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ar ? "بحث المورد، رقم الفاتورة…" : "Search vendor, invoice #…"}
            className="h-8 ps-7 text-xs"
            data-testid="input-search"
          />
        </div>
      </section>

      {/* ─── Bento layout ─────────────────────────────────────────── */}
      <section
        className="grid gap-px bg-border rounded-md overflow-hidden border border-border"
        style={{ gridTemplateColumns: "minmax(360px, 380px) 1fr", minHeight: "72vh" }}
      >
        {/* List column */}
        <div className="bg-background flex flex-col">
          <div
            className={`px-4 py-2.5 text-xs border-b border-border flex items-center justify-between transition-colors ${
              dragOver ? "bg-accent/50" : ""
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
            <span className="uppercase tracking-[0.14em] text-muted-foreground text-[10px]">
              {ar ? "اسحب وأفلت أو اضغط U" : "Drag & drop · press U"}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {filtered.length}/{docs.length}
            </span>
          </div>

          {isLoading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-sm" />
              ))}
            </div>
          ) : filtered.length === 0 && docs.length === 0 ? (
            <EmptyState ar={ar} onPick={() => fileInput.current?.click()} />
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-muted-foreground">
              {ar ? "لا نتائج للفلتر الحالي" : "No documents match this filter"}
            </div>
          ) : (
            <ul
              className="divide-y divide-border overflow-y-auto"
              data-testid="list-documents"
            >
              {filtered.map((d) => {
                const ext = (d.extractedJson as ExtractedDocument | null) ?? null;
                const isSel = selectedId === d.id;
                const status = d.status as Status;
                return (
                  <li key={d.id} className="relative">
                    {isSel && (
                      <span
                        className={`absolute top-0 bottom-0 ${
                          ar ? "right-0" : "left-0"
                        } w-[2px] bg-foreground`}
                      />
                    )}
                    <button
                      onClick={() => setSelectedId(d.id)}
                      className={`w-full text-start px-4 py-3 transition-colors ${
                        isSel ? "bg-accent/40" : "hover:bg-muted/40"
                      }`}
                      data-testid={`row-document-${d.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <StatusDot status={status} />
                            <span className="text-sm font-medium truncate">
                              {ext?.vendor || d.fileName}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">
                            {ext?.invoiceNumber ? `#${ext.invoiceNumber} · ` : ""}
                            {shortDate(ext?.documentDate ?? d.uploadedAt, ar)}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          <span className="font-mono text-sm tabular-nums">
                            {fmtMoney(ext?.total)}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {ext?.currency ?? ""}
                          </span>
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
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI tile
// ─────────────────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  hint,
  mono,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="px-5 py-4 first:ps-0 last:pe-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1.5">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono tabular-nums" : ""} text-2xl leading-none ${
          accent ? "font-semibold text-foreground" : "font-medium"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1.5">{hint}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state — typography-only, instructive, no clip art
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ ar, onPick }: { ar: boolean; onPick: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-14">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
        {ar ? "لا مستندات بعد" : "Nothing here yet"}
      </div>
      <div className="text-base font-medium mb-2 max-w-xs">
        {ar
          ? "ابدأ بصورة فاتورة أو إيصال."
          : "Start with a photo of an invoice or receipt."}
      </div>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mb-5">
        {ar
          ? "PNG، JPEG، WEBP حتى 10 ميجابايت. ندعم العربية والإنجليزية وضرائب القيمة المضافة الخليجية."
          : "PNG, JPEG, WEBP up to 10 MB. Bilingual AR/EN with GCC VAT awareness."}
      </p>
      <Button size="sm" onClick={onPick} variant="outline" data-testid="button-empty-upload">
        <Upload className="me-2 h-3.5 w-3.5" />
        {ar ? "اختر ملفاً" : "Choose file"}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Document detail — bento: preview · facts · journal editor
// ─────────────────────────────────────────────────────────────────────────────

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
  const status = doc.status as Status;

  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [lines, setLines] = useState<
    { accountId: number; debit: number; credit: number; description: string }[]
  >([]);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate the form once the AI suggestion arrives. `key={doc.id}` on
  // this component means the flag resets per-document automatically.
  useEffect(() => {
    if (hydrated) return;
    if (!sug && status !== "ready") return;
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
  }, [sug, ext, status, hydrated]);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const drift = totalDebit - totalCredit;
  const balanced = Math.abs(drift) < 0.005 && totalDebit > 0;
  const allAccountsPicked = lines.every((l) => l.accountId > 0);

  const postable = accounts.filter((a) => !a.isHeader && a.isActive);

  const postMut = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/documents/${doc.id}/post`, {
        description,
        entryDate,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
          description: l.description || undefined,
        })),
      }),
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

  // ⌘/Ctrl + Enter posts when the form is balanced.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (status === "ready" && balanced && allAccountsPicked && !postMut.isPending) {
          e.preventDefault();
          postMut.mutate();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, balanced, allAccountsPicked, postMut]);

  const showImage = doc.mimeType.startsWith("image/");

  return (
    <div className="flex flex-col h-full">
      {/* ── Detail header ──────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <StatusDot status={status} />
            <StatusLabel status={status} ar={ar} />
            <span className="text-[10px] text-muted-foreground font-mono">
              · {timeAgo(doc.uploadedAt!, ar)}
            </span>
          </div>
          <h2
            className={`${ar ? "text-xl font-semibold" : "text-2xl font-display"} leading-tight tracking-tight truncate`}
            data-testid="text-vendor"
          >
            {ext?.vendor || doc.fileName}
          </h2>
          {ext?.invoiceNumber && (
            <div className="text-xs text-muted-foreground font-mono mt-0.5">
              #{ext.invoiceNumber} · {shortDate(ext.documentDate, ar)}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive shrink-0"
          data-testid="button-delete-document"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Bento body ─────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(320px,_460px)_1fr]">
        {/* Original document preview */}
        <div className="p-6 bg-muted/30 border-b lg:border-b-0 lg:border-e border-border flex items-start justify-center">
          {showImage ? (
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="block w-full"
              data-testid="link-open-original"
            >
              <img
                src={`/api/documents/${doc.id}/file`}
                alt={doc.fileName}
                className="w-full max-h-[72vh] object-contain rounded-sm border border-border bg-background shadow-sm"
                data-testid="img-document"
              />
              <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>{ar ? "المستند الأصلي" : "Original document"}</span>
                <span className="inline-flex items-center gap-1">
                  {ar ? "فتح" : "Open"} <ArrowUpRight className="h-3 w-3" />
                </span>
              </div>
            </a>
          ) : (
            <div className="text-sm text-muted-foreground">
              {ar ? "معاينة غير متوفرة" : "Preview unavailable"}
            </div>
          )}
        </div>

        {/* Right: facts + JE editor */}
        <div className="overflow-y-auto">
          {status === "extracting" && <ExtractingSkeleton ar={ar} />}

          {status === "error" && (
            <div className="p-6">
              <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex gap-3">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div className="font-medium">
                    {ar ? "تعذّر قراءة المستند" : "Couldn't read this document"}
                  </div>
                  <div className="text-xs opacity-90 leading-relaxed">
                    {doc.errorMessage}
                  </div>
                  <div className="text-xs opacity-75 mt-2">
                    {ar
                      ? "جرب صورة أوضح أو ملف أقل حجماً."
                      : "Try a clearer image or smaller file."}
                  </div>
                </div>
              </div>
            </div>
          )}

          {ext && (status === "ready" || status === "posted" || status === "posting") && (
            <div className="p-6 space-y-7">
              {/* Hero total — display weight, mono, tabular */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  {ar ? "الإجمالي" : "Total"}
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-mono tabular-nums text-[40px] leading-none font-semibold tracking-tight"
                    data-testid="text-hero-total"
                  >
                    {fmtMoney(ext.total)}
                  </span>
                  <span className="text-sm text-muted-foreground font-mono">
                    {ext.currency ?? ""}
                  </span>
                </div>
                {(ext.subtotal != null || ext.vatAmount != null) && (
                  <div className="text-xs text-muted-foreground font-mono mt-2">
                    {ext.subtotal != null && (
                      <span>
                        {ar ? "صافي " : "net "}
                        {fmtMoney(ext.subtotal)}
                      </span>
                    )}
                    {ext.vatAmount != null && (
                      <>
                        {" · "}
                        {ar ? "ض.ق.م " : "VAT "}
                        {fmtMoney(ext.vatAmount)}
                        {ext.vatRate ? ` (${(ext.vatRate * 100).toFixed(0)}%)` : ""}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Facts grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-border pt-5">
                <Field label={ar ? "المورد" : "Vendor"} value={ext.vendor} />
                <Field
                  label={ar ? "رقم الفاتورة" : "Invoice #"}
                  value={ext.invoiceNumber}
                  mono
                />
                <Field
                  label={ar ? "تاريخ المستند" : "Document date"}
                  value={shortDate(ext.documentDate, ar)}
                  mono
                />
                <Field
                  label={ar ? "طريقة الدفع" : "Payment"}
                  value={ext.paymentMethod}
                />
              </div>

              {/* Posted state */}
              {status === "posted" && (
                <div className="border-t border-border pt-5">
                  <div className="rounded-sm border border-emerald-700/30 bg-emerald-500/5 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-sm">
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {ar
                          ? `تم الترحيل كقيد رقم ${doc.journalEntryId}`
                          : `Posted as journal entry #${doc.journalEntryId}`}
                      </span>
                    </div>
                    <Link
                      href="/app/journal"
                      className="text-xs underline-offset-4 hover:underline text-foreground/70 inline-flex items-center gap-1"
                      data-testid="link-view-journal"
                    >
                      {ar ? "عرض" : "View"} <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>
                  {doc.postedAt && (
                    <div className="text-[11px] text-muted-foreground font-mono mt-2">
                      {ar ? "وقت الترحيل · " : "posted · "}
                      {timeAgo(doc.postedAt, ar)}
                    </div>
                  )}
                </div>
              )}

              {/* JE editor — only when ready/posting */}
              {(status === "ready" || status === "posting") && (
                <div className="border-t border-border pt-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {ar ? "القيد المقترح" : "Suggested journal"}
                      </div>
                      {sug?.reasoning && (
                        <p className="text-xs text-muted-foreground mt-1 italic max-w-md leading-relaxed">
                          {sug.reasoning}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {ar ? "الوصف" : "Description"}
                      </Label>
                      <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        className="h-9"
                        data-testid="input-je-description"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {ar ? "تاريخ القيد" : "Entry date"}
                      </Label>
                      <Input
                        type="date"
                        value={entryDate}
                        onChange={(e) => setEntryDate(e.target.value)}
                        className="h-9 font-mono"
                        data-testid="input-je-date"
                      />
                    </div>
                  </div>

                  {/* JE table */}
                  <div className="border border-border rounded-sm overflow-hidden">
                    <div className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                            <SelectTrigger
                              className="h-8 text-sm"
                              data-testid={`select-account-${i}`}
                            >
                              <SelectValue
                                placeholder={ar ? "اختر حساباً" : "Select account"}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {postable.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  <span className="font-mono text-xs text-muted-foreground me-2">
                                    {a.code}
                                  </span>
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
                            className="text-muted-foreground hover:text-destructive disabled:opacity-30 mx-auto"
                            disabled={lines.length <= 2}
                            data-testid={`button-remove-line-${i}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 bg-muted/40 border-t border-border text-sm">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground self-center">
                        {ar ? "الإجمالي" : "Totals"}
                      </div>
                      <div
                        className="text-end font-mono tabular-nums"
                        data-testid="text-total-debit"
                      >
                        {fmtMoney(totalDebit)}
                      </div>
                      <div
                        className="text-end font-mono tabular-nums"
                        data-testid="text-total-credit"
                      >
                        {fmtMoney(totalCredit)}
                      </div>
                      <div></div>
                    </div>
                  </div>

                  {/* Sticky action bar */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setLines([
                            ...lines,
                            { accountId: 0, debit: 0, credit: 0, description: "" },
                          ])
                        }
                        className="text-xs text-muted-foreground hover:text-foreground"
                        data-testid="button-add-line"
                      >
                        {ar ? "+ إضافة سطر" : "+ Add line"}
                      </button>
                      <span
                        className={`text-[11px] font-mono ${
                          balanced
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground"
                        }`}
                        data-testid="text-balance"
                      >
                        {balanced
                          ? ar
                            ? "متوازن ✓"
                            : "balanced ✓"
                          : ar
                          ? `فرق ${fmtMoney(Math.abs(drift))}`
                          : `drift ${fmtMoney(Math.abs(drift))}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="hidden md:inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                        ⌘ <CornerDownLeft className="h-2.5 w-2.5" />
                      </kbd>
                      <Button
                        onClick={() => postMut.mutate()}
                        disabled={
                          !balanced ||
                          !allAccountsPicked ||
                          postMut.isPending ||
                          status === "posting"
                        }
                        data-testid="button-post-document"
                      >
                        <Check className="me-2 h-4 w-4" />
                        {status === "posting"
                          ? ar
                            ? "جارٍ الترحيل…"
                            : "Posting…"
                          : ar
                          ? "ترحيل القيد"
                          : "Post entry"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Audit trail micro-line */}
              <div className="border-t border-border pt-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono flex items-center justify-between">
                <span>
                  {ar ? "رفع " : "uploaded "} {timeAgo(doc.uploadedAt!, ar)}
                </span>
                <span>
                  {(doc.sizeBytes / 1024).toFixed(0)}KB · {doc.mimeType.split("/")[1]}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton during extraction
// ─────────────────────────────────────────────────────────────────────────────

function ExtractingSkeleton({ ar }: { ar: boolean }) {
  return (
    <div className="p-6 space-y-7">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {ar ? "جارٍ القراءة" : "Reading"}
        </div>
        <Skeleton className="h-10 w-48 rounded-sm" />
        <Skeleton className="h-3 w-32 rounded-sm mt-2" />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border pt-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16 rounded-sm" />
            <Skeleton className="h-4 w-24 rounded-sm" />
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-5 space-y-3">
        <Skeleton className="h-3 w-32 rounded-sm" />
        <Skeleton className="h-9 w-full rounded-sm" />
        <Skeleton className="h-9 w-full rounded-sm" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Field — uniform key/value cell
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
        {label}
      </div>
      <div
        className={`${mono ? "font-mono tabular-nums" : ""} text-sm text-foreground`}
        data-testid={`field-${label.toLowerCase().replace(/\W+/g, "-")}`}
      >
        {value == null || value === "" ? "—" : value}
      </div>
    </div>
  );
}
