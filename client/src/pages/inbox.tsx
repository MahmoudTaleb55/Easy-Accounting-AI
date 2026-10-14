import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link";
import { useLocale, type Locale } from "@/contexts/locale-context";
import { useT, type StringKey } from "@/i18n/dict";
import { detectedLanguageLabel, resolveInboxError } from "@/lib/inbox-error-i18n";
import { enhanceAndCompressImageFile } from "@/lib/image-enhance";
import { apiRequest, queryClient, invalidateAccountBalances, uploadFormData } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  ChevronsUpDown,
  ShieldCheck,
  Camera,
} from "lucide-react";
import { CameraCaptureDialog } from "@/components/camera/camera-capture-dialog";
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

function timeAgo(d: string | Date | null | undefined, t: (k: StringKey) => string): string {
  if (!d) return "";
  const ms = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t("inbox_time_now");
  if (m < 60) return t("inbox_time_min").replace("{n}", String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return t("inbox_time_hour").replace("{n}", String(h));
  const days = Math.floor(h / 24);
  return t("inbox_time_day").replace("{n}", String(days));
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

function StatusLabel({ status }: { status: Status }) {
  const t = useT();
  const map: Record<Status, string> = {
    extracting: t("inbox_status_extracting"),
    ready: t("inbox_status_ready"),
    posting: t("inbox_status_posting"),
    posted: t("inbox_status_posted"),
    error: t("inbox_status_error"),
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
// Searchable account picker — typeahead, no scrolling 200 rows
// ─────────────────────────────────────────────────────────────────────────────

function AccountPicker({
  accounts,
  value,
  onChange,
  ar,
  testid,
}: {
  accounts: Account[];
  value: number;
  onChange: (id: number) => void;
  ar: boolean;
  testid: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = accounts.find((a) => a.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full flex items-center justify-between gap-2 px-2.5 rounded-sm border border-input bg-transparent text-sm hover:bg-muted/40 transition-colors text-start"
          data-testid={testid}
        >
          {selected ? (
            <span className="truncate flex items-center gap-2 min-w-0">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                {selected.code}
              </span>
              <span className="truncate">{ar ? selected.nameAr : selected.nameEn}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {t("inbox_select_account")}
            </span>
          )}
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[320px]" align="start">
        <Command>
          <CommandInput
            placeholder={t("inbox_search_account")}
            className="h-9"
          />
          <CommandList>
            <CommandEmpty>{t("inbox_no_accounts")}</CommandEmpty>
            <CommandGroup>
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  value={`${a.code} ${a.nameEn} ${a.nameAr}`}
                  onSelect={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                  data-testid={`option-account-${a.id}`}
                >
                  <span className="font-mono text-xs text-muted-foreground me-2 w-12 shrink-0">
                    {a.code}
                  </span>
                  <span className="truncate">{ar ? a.nameAr : a.nameEn}</span>
                  {value === a.id && <Check className="ms-auto h-3.5 w-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const t = useT();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

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
      // Route through uploadFormData so the request carries the
      // X-Company-Id workspace header (via buildHeaders); a bare fetch
      // omitted it and the upload silently landed in the user's fallback
      // (oldest) workspace, making it invisible in the current inbox. We
      // must NOT set Content-Type here — the browser sets the multipart
      // boundary itself. The camera-capture path shares this same mutation.
      const res = await uploadFormData("/api/documents", fd);
      return (await res.json()) as DocumentRow;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setSelectedId(row.id);
    },
    onError: (e: Error) => {
      toast({
        variant: "destructive",
        title: t("inbox_upload_failed"),
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
      // Mirror the server-side gate (image/* + application/pdf, see
      // server/services/image-mime.ts → detectDocumentMimeFromBuffer).
      // The browser-supplied `type` is advisory here — the real check is
      // the magic-bytes sniff on the server — but filtering up front
      // means a stray .docx dropped on the inbox doesn't trigger a
      // pointless 400 round-trip.
      Array.from(files)
        .filter(
          (f) => f.type.startsWith("image/") || f.type === "application/pdf",
        )
        .forEach(async (f) => {
          // Enhance direct image uploads to match camera-capture output;
          // PDFs and undecodable images fall through unchanged via the
          // helper. Camera captures bypass this path entirely.
          const processed =
            f.type.startsWith("image/")
              ? await enhanceAndCompressImageFile(f)
              : f;
          uploadMut.mutate(processed);
        });
    },
    [uploadMut],
  );

  return (
    <div className="space-y-6 px-6 py-8 max-w-[1480px] mx-auto" dir={ar ? "rtl" : "ltr"}>
      {/* ─── Header strip ─────────────────────────────────────────── */}
      <header className="flex items-end justify-between gap-6 flex-wrap">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
            {t("inbox_brand")} · {t("inbox_label")}
          </div>
          <h1
            className={`text-[28px] leading-[1.1] tracking-tight ${
              ar ? "font-semibold" : "font-display"
            }`}
            data-testid="heading-inbox"
          >
            {t("inbox_title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            {t("inbox_subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <kbd className="hidden md:inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
            U
          </kbd>
          <Button
            variant="outline"
            onClick={() => setCameraOpen(true)}
            disabled={uploadMut.isPending}
            data-testid="button-camera"
          >
            <Camera className="me-2 h-4 w-4" />
            {t("inbox_camera")}
          </Button>
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={uploadMut.isPending}
            data-testid="button-upload"
          >
            <Upload className="me-2 h-4 w-4" />
            {t("inbox_upload_doc")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
            data-testid="input-file"
          />
        </div>
        <CameraCaptureDialog
          open={cameraOpen}
          onOpenChange={setCameraOpen}
          onCapture={(file) => uploadMut.mutate(file)}
          locale={locale}
        />
      </header>

      {/* ─── KPI strip — disciplined, mono numerics ───────────────── */}
      <section
        className="grid grid-cols-2 md:grid-cols-4 border-y border-border divide-x divide-border rtl:divide-x-reverse"
        data-testid="kpi-strip"
      >
        <Kpi
          label={t("inbox_kpi_review")}
          value={String(stats.review)}
          hint={t("inbox_kpi_review_hint")}
          accent={stats.review > 0}
        />
        <Kpi
          label={t("inbox_kpi_reading")}
          value={String(stats.reading)}
          hint={t("inbox_kpi_reading_hint")}
        />
        <Kpi
          label={t("inbox_kpi_posted_month")}
          value={String(stats.postedCount)}
          hint={t("inbox_kpi_posted_hint")}
        />
        <Kpi
          label={t("inbox_kpi_month_total")}
          value={fmtMoney(stats.totalThisMonth)}
          hint={t("inbox_kpi_month_total_hint")}
          mono
        />
      </section>

      {/* ─── Filter + search row ─────────────────────────────────── */}
      <section className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-xs">
          {(["all", "review", "posted", "error"] as FilterStatus[]).map((f) => {
            const labels: Record<FilterStatus, string> = {
              all: t("inbox_filter_all"),
              review: t("inbox_filter_review"),
              posted: t("inbox_filter_posted"),
              error: t("inbox_filter_error"),
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
            placeholder={t("inbox_search_docs")}
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
              {t("inbox_drag_drop")}
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
            <EmptyState onPick={() => fileInput.current?.click()} />
          ) : filter === "review" && filtered.length === 0 ? (
            <ZeroInboxState docs={docs} />
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-xs text-muted-foreground">
              {t("inbox_no_filter_match")}
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
                            {(() => {
                              const langLabel = detectedLanguageLabel(ext?.language, locale);
                              if (!langLabel) return null;
                              return (
                                <span
                                  className="ms-auto shrink-0 rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
                                  data-testid={`badge-language-${d.id}`}
                                  title={langLabel}
                                >
                                  {ext!.language}
                                </span>
                              );
                            })()}
                          </div>
                          {status === "error" ? (
                            <div
                              className="text-[11px] text-destructive truncate"
                              data-testid={`text-row-error-${d.id}`}
                            >
                              {resolveInboxError(d.errorMessage, locale).title}
                            </div>
                          ) : (
                            <div className="text-[11px] text-muted-foreground font-mono truncate">
                              {ext?.invoiceNumber ? `#${ext.invoiceNumber} · ` : ""}
                              {shortDate(ext?.documentDate ?? d.uploadedAt, ar)}
                            </div>
                          )}
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
              locale={locale}
              pileIndex={
                docs.filter((d) => d.status === "ready").findIndex((d) => d.id === selected.id) + 1
              }
              pileTotal={docs.filter((d) => d.status === "ready").length}
              onDelete={() => deleteMut.mutate(selected.id)}
              onPosted={() => {
                // Auto-advance to the next "ready" doc to keep the operator in flow.
                const ready = docs
                  .filter((d) => d.status === "ready" && d.id !== selected.id);
                if (ready.length > 0) {
                  setSelectedId(ready[0].id);
                }
              }}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-10 text-sm text-muted-foreground">
              {t("inbox_select_doc")}
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

function ZeroInboxState({ docs }: { docs: DocumentRow[] }) {
  const t = useT();
  const { locale } = useLocale();
  const ar = locale === "ar";
  const recent = docs
    .filter((d) => d.status === "posted")
    .sort((a, b) => new Date(b.postedAt!).getTime() - new Date(a.postedAt!).getTime())
    .slice(0, 5);
  return (
    <div className="flex-1 flex flex-col">
      <div className="px-6 py-10 text-center">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {t("inbox_zero_title")}
        </div>
        <div className={`text-base font-medium mb-1 ${ar ? "" : "font-display text-lg"}`}>
          {t("inbox_zero_desc")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("inbox_zero_hint")}
        </p>
      </div>
      {recent.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2 px-1">
            {t("inbox_recently_posted")}
          </div>
          <ul className="divide-y divide-border" data-testid="list-recent-posted">
            {recent.map((d) => {
              const ext = (d.extractedJson as ExtractedDocument | null) ?? null;
              return (
                <li
                  key={d.id}
                  className="px-1 py-2 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-foreground/80">
                      {ext?.vendor || d.fileName}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {d.journalEntryId ? (
                        <JournalEntryRefLink
                          id={d.journalEntryId}
                          className="text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm"
                          data-testid={`link-journal-entry-recent-${d.id}`}
                          title={t("inbox_open_je").replace("{id}", String(d.journalEntryId))}
                        >
                          JE #{d.journalEntryId}
                        </JournalEntryRefLink>
                      ) : "—"} · {timeAgo(d.postedAt!, t)}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums text-foreground/70 shrink-0">
                    {fmtMoney(ext?.total)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  const t = useT();
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-14">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
        {t("inbox_nothing_yet")}
      </div>
      <div className="text-base font-medium mb-2 max-w-xs">
        {t("inbox_nothing_hint")}
      </div>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mb-5">
        {t("inbox_formats_hint")}
      </p>
      <Button size="sm" onClick={onPick} variant="outline" data-testid="button-empty-upload">
        <Upload className="me-2 h-3.5 w-3.5" />
        {t("inbox_choose_file")}
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
  locale,
  onDelete,
  onPosted,
  pileIndex,
  pileTotal,
}: {
  doc: DocumentRow;
  accounts: Account[];
  ar: boolean;
  // Full 4-language locale handle (separate from the legacy `ar` boolean
  // most of this component still keys off). Required so the localized
  // error block can resolve `unsupported_language` copy in DE/FR too —
  // task #345.
  locale: Locale;
  onDelete: () => void;
  onPosted: () => void;
  pileIndex: number;
  pileTotal: number;
}) {
  const { toast } = useToast();
  const t = useT();
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
      invalidateAccountBalances();
      toast({
        title: t("inbox_toast_posted"),
        description: t("inbox_toast_posted_desc"),
      });
      onPosted();
    },
    onError: (e: Error) => {
      toast({
        variant: "destructive",
        title: t("inbox_toast_post_failed"),
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
            <StatusLabel status={status} />
            <span className="text-[10px] text-muted-foreground font-mono">
              · {timeAgo(doc.uploadedAt!, t)}
            </span>
            {pileTotal > 1 && pileIndex > 0 && (
              <span
                className="ms-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono inline-flex items-center gap-1.5"
                data-testid="text-pile-progress"
              >
                <span>
                  {t("inbox_reviewing")}
                  {pileIndex}/{pileTotal}
                </span>
                <span className="inline-block h-px w-12 bg-border relative overflow-hidden">
                  <span
                    className="absolute inset-y-0 start-0 bg-foreground"
                    style={{ width: `${(pileIndex / pileTotal) * 100}%` }}
                  />
                </span>
              </span>
            )}
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
                <span>{t("inbox_original_doc")}</span>
                <span className="inline-flex items-center gap-1">
                  {t("inbox_open")} <ArrowUpRight className="h-3 w-3" />
                </span>
              </div>
            </a>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t("inbox_preview_unavailable")}
            </div>
          )}
        </div>

        {/* Right: facts + JE editor */}
        <div className="overflow-y-auto">
          {status === "extracting" && <ExtractingSkeleton />}

          {status === "error" && (() => {
            // Map persisted server error code → friendly localized copy.
            // The server may store a stable code (e.g. `unsupported_language`)
            // OR a free-form message; the helper handles both.
            const copy = resolveInboxError(doc.errorMessage, locale);
            return (
              <div className="p-6">
                <div
                  className="rounded-sm border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex gap-3"
                  data-testid="callout-document-error"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <div className="font-medium" data-testid="text-document-error-title">
                      {copy.title}
                    </div>
                    <div
                      className="text-xs opacity-90 leading-relaxed"
                      data-testid="text-document-error-body"
                    >
                      {copy.body}
                    </div>
                    <div
                      className="text-xs opacity-75 mt-2"
                      data-testid="text-document-error-hint"
                    >
                      {copy.hint}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {ext && (status === "ready" || status === "posted" || status === "posting") && (
            <div className="p-6 space-y-7">
              {/* Hero total — display weight, mono, tabular */}
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  {t("inbox_total")}
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
                        {t("inbox_net")}
                        {fmtMoney(ext.subtotal)}
                      </span>
                    )}
                    {ext.vatAmount != null && (
                      <>
                        {" · "}
                        {t("inbox_vat_label")}
                        {fmtMoney(ext.vatAmount)}
                        {ext.vatRate ? ` (${(ext.vatRate * 100).toFixed(0)}%)` : ""}
                      </>
                    )}
                  </div>
                )}
                {(() => {
                  // Quiet trust signal: only show when the math actually
                  // reconciles (subtotal + vat ≈ total, within 1 cent).
                  const sub = Number(ext.subtotal ?? NaN);
                  const vat = Number(ext.vatAmount ?? NaN);
                  const tot = Number(ext.total ?? NaN);
                  const reconciled =
                    !isNaN(sub) && !isNaN(vat) && !isNaN(tot) &&
                    Math.abs(sub + vat - tot) < 0.01;
                  if (!reconciled) return null;
                  return (
                    <div
                      className="mt-2.5 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-400"
                      data-testid="text-vat-reconciled"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {t("inbox_vat_matched").replace("{extra}", ext.vatRate ? ` · ${(ext.vatRate * 100).toFixed(0)}%` : "")}
                    </div>
                  );
                })()}
              </div>

              {/* Facts grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-border pt-5">
                <Field label={t("inbox_vendor")} value={ext.vendor} />
                <Field
                  label={t("inbox_invoice_no")}
                  value={ext.invoiceNumber}
                  mono
                />
                <Field
                  label={t("inbox_doc_date")}
                  value={shortDate(ext.documentDate, ar)}
                  mono
                />
                <Field
                  label={t("inbox_payment")}
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
                        {t("inbox_posted_as_je")}
                        {doc.journalEntryId ? (
                          <JournalEntryRefLink
                            id={doc.journalEntryId}
                            className="underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none rounded-sm font-medium"
                            data-testid={`link-journal-entry-posted-${doc.id}`}
                            title={t("inbox_open_je_short").replace("{id}", String(doc.journalEntryId))}
                          >
                            {ar ? doc.journalEntryId : `#${doc.journalEntryId}`}
                          </JournalEntryRefLink>
                        ) : <span className="text-muted-foreground">—</span>}
                      </span>
                    </div>
                    {doc.journalEntryId ? (
                      <JournalEntryRefLink
                        id={doc.journalEntryId}
                        className="text-xs underline-offset-4 hover:underline text-foreground/70 inline-flex items-center gap-1"
                        data-testid="link-view-journal"
                      >
                        {t("inbox_view")} <ArrowUpRight className="h-3 w-3" />
                      </JournalEntryRefLink>
                    ) : (
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1" data-testid="link-view-journal-disabled">
                        {t("inbox_view")} <ArrowUpRight className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  {doc.postedAt && (
                    <div className="text-[11px] text-muted-foreground font-mono mt-2">
                      {t("inbox_posted_time")}
                      {timeAgo(doc.postedAt, t)}
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
                        {t("inbox_suggested_journal")}
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
                        {t("inbox_description")}
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
                        {t("inbox_entry_date")}
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
                      <div>{t("inbox_account")}</div>
                      <div className="text-end">{t("inbox_debit")}</div>
                      <div className="text-end">{t("inbox_credit")}</div>
                      <div></div>
                    </div>
                    <div className="divide-y divide-border">
                      {lines.map((ln, i) => (
                        <div
                          key={i}
                          className="grid grid-cols-[1fr_120px_120px_28px] gap-2 px-3 py-2 items-center"
                          data-testid={`row-je-line-${i}`}
                        >
                          <AccountPicker
                            accounts={postable}
                            value={ln.accountId}
                            onChange={(id) => {
                              const next = [...lines];
                              next[i] = { ...next[i], accountId: id };
                              setLines(next);
                            }}
                            ar={ar}
                            testid={`select-account-${i}`}
                          />
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
                        {t("inbox_totals")}
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
                        {t("inbox_add_line")}
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
                          ? t("inbox_balanced")
                          : t("inbox_diff").replace("{v}", fmtMoney(Math.abs(drift)))}
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
                        {status === "posting" ? t("inbox_posting_progress") : t("inbox_post_entry")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Audit trail micro-line */}
              <div className="border-t border-border pt-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-mono flex items-center justify-between">
                <span>
                  {t("inbox_uploaded")} {timeAgo(doc.uploadedAt!, t)}
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

function ExtractingSkeleton() {
  const t = useT();
  return (
    <div className="p-6 space-y-7">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {t("inbox_reading")}
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
