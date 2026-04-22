import { useState, useRef, useEffect, useMemo } from "react"
import { useChatMessages, useSendMessage } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import {
  Sparkles,
  Loader2,
  ImagePlus,
  X,
  Receipt,
  ArrowUp,
  Download,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  BookOpen,
  Wand2,
  Command,
} from "lucide-react"
import { useLocale } from "@/contexts/locale-context"
import { cn } from "@/lib/utils"

/* ══════════════════════════════════════════════════════════════════════════ */
/*  AI Assistant — command center                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

export default function AiAssistant() {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const { data: messages, isLoading } = useChatMessages()
  const sendMessage = useSendMessage()
  const { toast } = useToast()

  const [input, setInput] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const t = useMemo(
    () => ({
      eyebrow: isAr ? "المساعد التنفيذي" : "Executive Assistant",
      live: isAr ? "متّصل" : "Live",
      model: isAr ? "نموذج محاسبي مدرّب" : "Accounting-tuned model",
      title: isAr
        ? "اطلب. أنفّذ."
        : "Ask. I execute.",
      subtitle: isAr
        ? "سجّل المعاملات، اكتب القيود المزدوجة، وولّد تقارير Excel و PDF جاهزة — كله من سطر محادثة واحد."
        : "Post transactions, write double-entry journals, and generate ready-to-download Excel & PDF reports — from a single line of chat.",
      tryHeader: isAr ? "ابدأ من قدرة" : "Start from a capability",
      placeholder: isAr
        ? "اطلب أي شيء… مثل: ولّد ميزان مراجعة Excel"
        : "Ask anything… e.g. Generate a Trial Balance in Excel",
      placeholderWithImage: isAr ? "أضف ملاحظة (اختياري)…" : "Add a note (optional)…",
      sizeError: isAr ? "حجم كبير جداً" : "File too large",
      sizeErrorDesc: isAr ? "الحد الأقصى ١٠ ميجابايت." : "Maximum size is 10MB.",
      typeError: isAr ? "نوع غير مدعوم" : "Unsupported type",
      typeErrorDesc: isAr ? "الرجاء اختيار صورة فقط." : "Please choose an image file.",
      footnote: isAr
        ? "كل قيد ينفّذه المساعد يُرحَّل تلقائياً إلى اليومية. راجع الدفاتر دائماً."
        : "Every entry the assistant posts is logged to the journal. Always review your books.",
      uploadAria: isAr ? "ارفع صورة فاتورة" : "Upload a receipt image",
      sendAria: isAr ? "إرسال" : "Send",
      receipt: isAr ? "فاتورة" : "Receipt",
      kbdHint: isAr ? "Enter للإرسال · Shift+Enter لسطر جديد" : "Enter to send · Shift+Enter newline",
      capabilities: isAr ? [
        { icon: FileSpreadsheet, title: "ميزان مراجعة Excel", subtitle: "ملف XLSX جاهز فوراً", prompt: "ولّد لي ميزان مراجعة بصيغة Excel", tone: "emerald" as const },
        { icon: FileText, title: "قائمة دخل PDF", subtitle: "تقرير مهنّي في ثانية", prompt: "اطبع قائمة الدخل بصيغة PDF", tone: "rose" as const },
        { icon: BookOpen, title: "قيد يومية مزدوج", subtitle: "حسابات حقيقية من دليلك", prompt: "اكتب قيد: ١٠٠٠ نقدية مدين، ١٠٠٠ مبيعات دائن، وصف: مبيعات نقدية", tone: "blue" as const },
        { icon: CheckCircle2, title: "ملخّص لحظي", subtitle: "رصيدك وأكبر فئة إنفاق", prompt: "ما رصيدي الحالي وأكبر فئة إنفاقاً هذا الشهر؟", tone: "violet" as const },
      ] : [
        { icon: FileSpreadsheet, title: "Trial Balance · Excel", subtitle: "Ready XLSX in seconds", prompt: "Generate a Trial Balance in Excel", tone: "emerald" as const },
        { icon: FileText, title: "P&L · PDF", subtitle: "Polished, board-ready", prompt: "Print the Profit & Loss statement as PDF", tone: "rose" as const },
        { icon: BookOpen, title: "Double-entry journal", subtitle: "Real accounts from your CoA", prompt: "Post a journal: debit Cash 1000, credit Sales 1000, memo: cash sale", tone: "blue" as const },
        { icon: CheckCircle2, title: "Live snapshot", subtitle: "Balance & top spend now", prompt: "What's my current balance and top expense this month?", tone: "violet" as const },
      ],
    }),
    [isAr]
  )

  /* ───────────────────────── side-effects ───────────────────────── */

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement | null
      if (viewport) viewport.scrollTop = viewport.scrollHeight
      else scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sendMessage.isPending])

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px"
  }, [input])

  /* ───────────────────────── handlers ───────────────────────── */

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast({ title: t.typeError, description: t.typeErrorDesc, variant: "destructive" })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: t.sizeError, description: t.sizeErrorDesc, variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result as string)
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const submit = () => {
    if ((!input.trim() && !imagePreview) || sendMessage.isPending) return
    sendMessage.mutate({ content: input.trim(), imageData: imagePreview || undefined })
    setInput("")
    setImagePreview(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    submit()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const handleQuickPrompt = (prompt: string) => {
    if (sendMessage.isPending) return
    sendMessage.mutate({ content: prompt })
  }

  const showEmpty = !isLoading && (!messages || messages.length === 0)

  /* ───────────────────────── render ───────────────────────── */

  return (
    <div
      className="h-[calc(100vh-9rem)] md:h-[calc(100vh-8rem)] flex flex-col"
      data-testid="page-ai-assistant"
    >
      {/* ── Workspace strip ── */}
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
            <Sparkles className="w-3 h-3 text-primary" />
            <span className="font-medium text-foreground">{t.eyebrow}</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {t.live}
          </span>
        </div>
        <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
          <Wand2 className="w-3 h-3" />
          {t.model}
        </span>
      </div>

      {/* ── Surface ── */}
      <div className="flex-1 flex flex-col overflow-hidden rounded-xl border border-border bg-card min-h-0 shadow-sm">
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className={cn("mx-auto max-w-3xl px-4 sm:px-8", showEmpty ? "py-10 sm:py-14" : "py-6 space-y-5")}>
            {showEmpty ? (
              <EmptyState
                title={t.title}
                subtitle={t.subtitle}
                tryHeader={t.tryHeader}
                capabilities={t.capabilities}
                onPick={handleQuickPrompt}
                isAr={isAr}
              />
            ) : (
              <>
                {isLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  messages?.map((msg) => {
                    const { text, artifacts } = parseAssistantContent(msg.content)
                    return (
                      <Bubble
                        key={msg.id}
                        role={msg.role as "user" | "assistant"}
                        data-testid={`message-${msg.role}-${msg.id}`}
                      >
                        {text && (
                          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
                            {text}
                          </p>
                        )}
                        {artifacts.length > 0 && (
                          <div className={cn("space-y-2", text && "mt-3")}>
                            {artifacts.map((a, i) => (
                              <ArtifactCard key={i} artifact={a} isAr={isAr} />
                            ))}
                          </div>
                        )}
                      </Bubble>
                    )
                  })
                )}

                {sendMessage.isPending && (
                  <Bubble role="assistant" data-testid="status-thinking">
                    <ThinkingIndicator />
                  </Bubble>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* ── Composer ── */}
        <div className="border-t border-border bg-background/40 backdrop-blur-sm px-4 sm:px-6 py-3.5">
          {imagePreview && (
            <div className="max-w-3xl mx-auto mb-2.5">
              <div className="relative inline-block">
                <img
                  src={imagePreview}
                  alt={t.receipt}
                  className="h-20 w-20 object-cover rounded-md border border-border"
                  data-testid="img-receipt-preview"
                />
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center hover:opacity-90"
                  data-testid="button-remove-image"
                  aria-label="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
                <span className="absolute bottom-1 start-1 inline-flex items-center gap-1 bg-background/90 text-foreground text-[10px] px-1.5 py-0.5 rounded border border-border">
                  <Receipt className="w-2.5 h-2.5" /> {t.receipt}
                </span>
              </div>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="max-w-3xl mx-auto"
            data-testid="form-composer"
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-colors p-1.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file-upload"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={sendMessage.isPending}
                className="text-muted-foreground hover:text-foreground shrink-0"
                data-testid="button-upload-image"
                aria-label={t.uploadAria}
                title={t.uploadAria}
              >
                <ImagePlus className="w-4 h-4" />
              </Button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={imagePreview ? t.placeholderWithImage : t.placeholder}
                className="flex-1 resize-none bg-transparent border-0 outline-none focus:ring-0 text-[14px] leading-6 py-1.5 px-1 text-foreground placeholder:text-muted-foreground/70 max-h-[200px]"
                disabled={sendMessage.isPending}
                data-testid="input-chat-message"
              />

              <Button
                type="submit"
                size="icon"
                className={cn(
                  "h-9 w-9 shrink-0 rounded-lg",
                  (!input.trim() && !imagePreview) && "opacity-50"
                )}
                disabled={(!input.trim() && !imagePreview) || sendMessage.isPending}
                data-testid="button-send-message"
                aria-label={t.sendAria}
              >
                {sendMessage.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <ArrowUp className="w-4 h-4" />
                }
              </Button>
            </div>

            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-[10.5px] text-muted-foreground/70 hidden sm:inline-flex items-center gap-1.5">
                <kbd className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-mono text-muted-foreground">
                  <Command className="w-2.5 h-2.5" />K
                </kbd>
                {t.kbdHint}
              </span>
              <span className="text-[10.5px] text-muted-foreground/70 inline-flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                {t.footnote}
              </span>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Empty state (hero + capability grid)                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

type Cap = { icon: typeof FileSpreadsheet; title: string; subtitle: string; prompt: string; tone: "emerald" | "rose" | "blue" | "violet" }

const TONE: Record<Cap["tone"], { bg: string; text: string; ring: string }> = {
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-600 dark:text-emerald-400", ring: "group-hover:ring-emerald-500/30" },
  rose:    { bg: "bg-rose-500/10",    text: "text-rose-600 dark:text-rose-400",       ring: "group-hover:ring-rose-500/30" },
  blue:    { bg: "bg-blue-500/10",    text: "text-blue-600 dark:text-blue-400",       ring: "group-hover:ring-blue-500/30" },
  violet:  { bg: "bg-violet-500/10",  text: "text-violet-600 dark:text-violet-400",   ring: "group-hover:ring-violet-500/30" },
}

function EmptyState({
  title, subtitle, tryHeader, capabilities, onPick, isAr,
}: {
  title: string; subtitle: string; tryHeader: string;
  capabilities: Cap[]; onPick: (p: string) => void; isAr: boolean
}) {
  return (
    <div className="space-y-10">
      <div className="text-center space-y-3 max-w-2xl mx-auto">
        <h1
          className="text-3xl sm:text-4xl md:text-[44px] font-semibold tracking-tight text-foreground leading-[1.1]"
          data-testid="text-assistant-title"
        >
          {title}
        </h1>
        <p className="text-[15px] sm:text-base text-muted-foreground leading-relaxed">
          {subtitle}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground/80 font-medium">
          <span className="h-px flex-1 bg-border" />
          <span>{tryHeader}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {capabilities.map((c) => {
            const Icon = c.icon
            const tone = TONE[c.tone]
            return (
              <button
                key={c.title}
                type="button"
                onClick={() => onPick(c.prompt)}
                data-testid={`button-capability-${c.title}`}
                className={cn(
                  "group relative flex items-start gap-3.5 text-start p-4 rounded-xl border border-border bg-background hover:border-foreground/20 hover:shadow-md hover:shadow-black/[0.04] transition-all",
                  "ring-1 ring-transparent",
                  tone.ring
                )}
              >
                <span className={cn("shrink-0 grid place-items-center w-10 h-10 rounded-lg", tone.bg, tone.text)}>
                  <Icon className="w-5 h-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-foreground leading-tight">
                    {c.title}
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
                    {c.subtitle}
                  </div>
                </div>
                <ArrowUp className={cn(
                  "w-4 h-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0 mt-1",
                  isAr ? "-rotate-45" : "rotate-45"
                )} />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Bubble — assistant has avatar, user is solid                             */
/* ══════════════════════════════════════════════════════════════════════════ */

function Bubble({
  role, children, ...rest
}: {
  role: "user" | "assistant"
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const isUser = role === "user"
  return (
    <div className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")} {...rest}>
      {!isUser && (
        <div className="shrink-0 grid place-items-center w-7 h-7 rounded-md bg-primary/10 text-primary mt-0.5">
          <Sparkles className="w-3.5 h-3.5" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[78%] px-4 py-2.5 rounded-2xl text-foreground",
          isUser
            ? "bg-foreground text-background rounded-br-md rtl:rounded-br-2xl rtl:rounded-bl-md"
            : "bg-muted/50 border border-border/70 rounded-bl-md rtl:rounded-bl-2xl rtl:rounded-br-md"
        )}
      >
        {children}
      </div>
    </div>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-1 items-center h-4" aria-label="thinking">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Artifact parsing + rendering                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

type Artifact =
  | { kind: "transaction"; type: "income" | "expense"; amount: number; description: string; category: string }
  | { kind: "journal_entry"; id: number; description: string; totalDebit: number; totalCredit: number; lines: number }
  | { kind: "file"; fileId: string; filename: string; mime: string; sizeKB: number; report: string; format: string }

function parseAssistantContent(content: string): { text: string; artifacts: Artifact[] } {
  if (!content) return { text: "", artifacts: [] }
  const m = content.match(/<<ARTIFACTS>>([\s\S]*?)<<END>>/)
  if (!m) return { text: content.trim(), artifacts: [] }
  let artifacts: Artifact[] = []
  try {
    const parsed = JSON.parse(m[1])
    if (Array.isArray(parsed)) artifacts = parsed as Artifact[]
  } catch { /* ignore malformed */ }
  const text = content.replace(/<<ARTIFACTS>>[\s\S]*?<<END>>/, "").trim()
  return { text, artifacts }
}

function ArtifactCard({ artifact, isAr }: { artifact: Artifact; isAr: boolean }) {
  if (artifact.kind === "file") {
    const isExcel = artifact.format === "excel"
    const Icon = isExcel ? FileSpreadsheet : FileText
    const reportLabel =
      artifact.report === "trial_balance" ? (isAr ? "ميزان المراجعة" : "Trial Balance")
      : artifact.report === "profit_loss" ? (isAr ? "قائمة الدخل" : "Profit & Loss")
      : (isAr ? "قائمة المركز المالي" : "Balance Sheet")

    return (
      <a
        href={`/api/files/${artifact.fileId}/download`}
        download={artifact.filename}
        data-testid={`link-download-${artifact.fileId}`}
        className={cn(
          "group flex items-center gap-3 rounded-xl border border-border bg-background p-3.5",
          "hover:border-foreground/20 hover:shadow-md hover:shadow-black/[0.04] transition-all"
        )}
      >
        <div
          className={cn(
            "shrink-0 grid place-items-center w-11 h-11 rounded-lg ring-1",
            isExcel
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/15"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/15"
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-foreground truncate">{reportLabel}</span>
            <span className={cn(
              "text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded",
              isExcel ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
            )}>
              {isExcel ? "XLSX" : "PDF"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">
            {artifact.filename} · {artifact.sizeKB} KB
          </div>
        </div>
        <div className={cn(
          "shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground group-hover:text-foreground"
        )}>
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">{isAr ? "تنزيل" : "Download"}</span>
        </div>
      </a>
    )
  }

  if (artifact.kind === "transaction") {
    const isIncome = artifact.type === "income"
    return (
      <div
        data-testid={`card-tx-${artifact.description}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-background p-3.5"
      >
        <div
          className={cn(
            "shrink-0 grid place-items-center w-11 h-11 rounded-lg ring-1",
            isIncome
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/15"
              : "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-rose-500/15"
          )}
        >
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-foreground truncate">
            {artifact.description}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {artifact.category} · {isAr ? (isIncome ? "إيراد" : "مصروف") : (isIncome ? "Income" : "Expense")}
          </div>
        </div>
        <div className={cn(
          "text-[15px] font-semibold tabular-nums shrink-0",
          isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
        )}>
          {isIncome ? "+" : "−"}
          {artifact.amount.toLocaleString()}
        </div>
      </div>
    )
  }

  // journal_entry
  return (
    <div
      data-testid={`card-je-${artifact.id}`}
      className="rounded-xl border border-border bg-background p-3.5"
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0 grid place-items-center w-11 h-11 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/15">
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-foreground truncate">
            {isAr ? `قيد #${artifact.id}` : `Journal #${artifact.id}`} — {artifact.description}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
            {artifact.lines} {isAr ? "سطر" : "lines"} · {isAr ? "مدين" : "Dr"} {artifact.totalDebit.toLocaleString()} = {isAr ? "دائن" : "Cr"} {artifact.totalCredit.toLocaleString()}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
          {isAr ? "متوازن" : "Balanced"}
        </span>
      </div>
    </div>
  )
}
