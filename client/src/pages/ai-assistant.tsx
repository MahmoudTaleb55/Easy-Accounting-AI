import { useState, useRef, useEffect, useMemo } from "react"
import { useChatMessages, useSendMessage } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import {
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
  Wallet,
  ArrowRight,
  ArrowLeft,
  Mic,
  Square,
  Camera,
} from "lucide-react"
import { useLocale } from "@/contexts/locale-context"
import { cn } from "@/lib/utils"
import { JournalEntryRefLink } from "@/components/journal/journal-entry-ref-link"
import { CameraCaptureDialog } from "@/components/camera/camera-capture-dialog"
import { enhanceAndCompressImageFile } from "@/lib/image-enhance"

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Assistant — accounting work surface                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

// Pick a localized string from a 4-language map, with English as fallback.
function pickByLocale<T extends string>(
  locale: string,
  map: { ar: T; en: T; de: T; fr: T },
): T {
  return (map as Record<string, T>)[locale] ?? map.en
}

export default function AiAssistant() {
  const { locale } = useLocale()
  const isAr = locale === "ar"
  const { data: messages, isLoading } = useChatMessages()
  const sendMessage = useSendMessage()
  const { toast } = useToast()

  const [input, setInput] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioStreamRef = useRef<MediaStream | null>(null)

  const t = useMemo(
    () => ({
      sectionLabel: pickByLocale(locale, { ar: "المساعد", en: "Assistant", de: "Assistent", fr: "Assistant" }),
      title: pickByLocale(locale, {
        ar: "اختصر يومك المحاسبي.",
        en: "Shorten your accounting day.",
        de: "Kürzer arbeiten – mehr erledigen.",
        fr: "Raccourcissez votre journée comptable.",
      }),
      subtitle: pickByLocale(locale, {
        ar: "اطلب من المساعد أن يسجّل معاملة، يكتب قيداً، أو يولّد تقريراً. النتائج تُرحّل مباشرة إلى دفاترك.",
        en: "Ask the assistant to post a transaction, write a journal, or build a report. Results post straight to your books.",
        de: "Bitten Sie den Assistenten, eine Transaktion zu buchen, einen Journalbuchungssatz zu erstellen oder einen Bericht zu generieren. Ergebnisse fließen direkt in Ihre Bücher.",
        fr: "Demandez à l'assistant d'enregistrer une transaction, d'écrire un journal ou de générer un rapport. Les résultats sont publiés directement dans vos livres.",
      }),
      quickHeader: pickByLocale(locale, { ar: "عمليات سريعة", en: "Quick actions", de: "Schnellaktionen", fr: "Actions rapides" }),
      placeholder: pickByLocale(locale, {
        ar: "اكتب أو تحدّث… مثلاً: ولّد ميزان مراجعة Excel",
        en: "Type or speak… e.g. Generate a Trial Balance in Excel",
        de: "Tippen oder sprechen… z. B. Generiere eine Saldenliste in Excel",
        fr: "Écrivez ou parlez… ex. Générez une balance dans Excel",
      }),
      placeholderWithImage: pickByLocale(locale, { ar: "أضف ملاحظة (اختياري)…", en: "Add a note (optional)…", de: "Notiz hinzufügen (optional)…", fr: "Ajouter une note (facultatif)…" }),
      sizeError: pickByLocale(locale, { ar: "حجم كبير جداً", en: "File too large", de: "Datei zu groß", fr: "Fichier trop volumineux" }),
      sizeErrorDesc: pickByLocale(locale, { ar: "الحد الأقصى ١٠ ميجابايت.", en: "Maximum size is 10MB.", de: "Maximale Größe: 10 MB.", fr: "Taille maximale : 10 Mo." }),
      typeError: pickByLocale(locale, { ar: "نوع غير مدعوم", en: "Unsupported type", de: "Nicht unterstützter Typ", fr: "Type non pris en charge" }),
      typeErrorDesc: pickByLocale(locale, { ar: "الرجاء اختيار صورة فقط.", en: "Please choose an image file.", de: "Bitte nur Bilddateien wählen.", fr: "Veuillez choisir uniquement une image." }),
      footnote: pickByLocale(locale, {
        ar: "كل ناتج هنا يُسجَّل في اليومية. راجع دفاترك بعد كل عملية.",
        en: "Every result here is recorded in the journal. Review your books after each action.",
        de: "Jedes Ergebnis hier wird im Journal erfasst. Prüfen Sie Ihre Bücher nach jeder Aktion.",
        fr: "Chaque résultat est enregistré dans le journal. Consultez vos livres après chaque action.",
      }),
      uploadAria: pickByLocale(locale, { ar: "ارفع صورة فاتورة", en: "Upload a receipt image", de: "Belegbild hochladen", fr: "Téléverser une image de reçu" }),
      cameraAria: pickByLocale(locale, {
        ar: "صوّر فاتورة بالكاميرا",
        en: "Take a photo with the camera",
        de: "Foto mit Kamera aufnehmen",
        fr: "Prendre une photo avec la caméra",
      }),
      sendAria: pickByLocale(locale, { ar: "إرسال", en: "Send", de: "Senden", fr: "Envoyer" }),
      receipt: pickByLocale(locale, { ar: "فاتورة", en: "Receipt", de: "Beleg", fr: "Reçu" }),
      newChat: pickByLocale(locale, { ar: "محادثة جديدة", en: "New", de: "Neu", fr: "Nouveau" }),
      micStartAria: pickByLocale(locale, { ar: "تحدّث إلى المساعد", en: "Speak to the assistant", de: "Mit dem Assistenten sprechen", fr: "Parler à l'assistant" }),
      micStopAria: pickByLocale(locale, { ar: "إيقاف التسجيل", en: "Stop recording", de: "Aufnahme beenden", fr: "Arrêter l'enregistrement" }),
      micErrorTitle: pickByLocale(locale, { ar: "تعذّر استخدام المايك", en: "Microphone unavailable", de: "Mikrofon nicht verfügbar", fr: "Micro indisponible" }),
      micErrorDesc: pickByLocale(locale, {
        ar: "تأكد من السماح للمتصفح باستخدام المايكروفون.",
        en: "Please allow the browser to use your microphone.",
        de: "Bitte erlauben Sie dem Browser den Mikrofonzugriff.",
        fr: "Autorisez le navigateur à accéder au microphone.",
      }),
      transcribeError: pickByLocale(locale, {
        ar: "تعذّر تحويل الصوت إلى نص.",
        en: "Failed to transcribe audio.",
        de: "Audio konnte nicht transkribiert werden.",
        fr: "Échec de la transcription audio.",
      }),
      capabilities: isAr ? [
        { icon: FileSpreadsheet, label: "ولّد ميزان مراجعة بصيغة Excel", prompt: "ولّد لي ميزان مراجعة بصيغة Excel" },
        { icon: FileText, label: "اطبع قائمة الدخل بصيغة PDF", prompt: "اطبع قائمة الدخل بصيغة PDF" },
        { icon: BookOpen, label: "اكتب قيد يومية مزدوج", prompt: "اكتب قيد: ١٠٠٠ نقدية مدين، ١٠٠٠ مبيعات دائن، وصف: مبيعات نقدية" },
        { icon: CheckCircle2, label: "ما رصيدي وأكبر فئة إنفاق هذا الشهر", prompt: "ما رصيدي الحالي وأكبر فئة إنفاقاً هذا الشهر؟" },
      ] : [
        { icon: FileSpreadsheet, label: "Generate Trial Balance in Excel", prompt: "Generate a Trial Balance in Excel" },
        { icon: FileText, label: "Print Profit & Loss as PDF", prompt: "Print the Profit & Loss statement as PDF" },
        { icon: BookOpen, label: "Post a double-entry journal", prompt: "Post a journal: debit Cash 1000, credit Sales 1000, memo: cash sale" },
        { icon: CheckCircle2, label: "Show balance and top expense this month", prompt: "What's my current balance and top expense this month?" },
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

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px"
  }, [input])

  /* ───────────────────────── handlers ───────────────────────── */

  const attachImageFile = async (
    file: File,
    opts: { alreadyEnhanced?: boolean } = {},
  ) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: t.typeError, description: t.typeErrorDesc, variant: "destructive" })
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: t.sizeError, description: t.sizeErrorDesc, variant: "destructive" })
      return
    }
    // Run the same conservative auto-levels + compression pass that the
    // camera dialog uses, so uploaded receipts are OCR-friendlier and the
    // attached payload is smaller. Camera captures already came through
    // the shared pipeline inside the dialog, so skip re-processing in that
    // case to avoid a redundant lossy recompression. The shared helper
    // already swallows decode errors and falls back to the original file,
    // but we still wrap the whole flow defensively so an unexpected
    // failure can never become an unhandled promise rejection.
    try {
      const processed = opts.alreadyEnhanced
        ? file
        : await enhanceAndCompressImageFile(file)
      const reader = new FileReader()
      reader.onload = () => setImagePreview(reader.result as string)
      reader.readAsDataURL(processed)
    } catch {
      toast({ title: t.typeError, description: t.typeErrorDesc, variant: "destructive" })
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    attachImageFile(file)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const submit = () => {
    if ((!input.trim() && !imagePreview) || sendMessage.isPending) return
    sendMessage.mutate({ content: input.trim(), imageData: imagePreview || undefined })
    setInput("")
    setImagePreview(null)
  }

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); submit() }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() }
  }

  /* ── Voice input — record via MediaRecorder, transcribe via /api/assistant/transcribe ── */

  const stopMicTracks = () => {
    audioStreamRef.current?.getTracks().forEach((tr) => tr.stop())
    audioStreamRef.current = null
  }

  const startRecording = async () => {
    if (isRecording || isTranscribing || sendMessage.isPending) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioStreamRef.current = stream
      // Pick a supported mime — webm/opus on Chromium-family, mp4 on Safari.
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""]
      const mime = mimeCandidates.find(
        (m) => !m || (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)),
      ) || ""
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = async () => {
        stopMicTracks()
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" })
        if (blob.size < 1000) return // ignore empty / accidental taps
        setIsTranscribing(true)
        try {
          const fd = new FormData()
          fd.append("audio", blob, `voice.${(recorder.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm"}`)
          fd.append("locale", locale)
          const r = await fetch("/api/assistant/transcribe", { method: "POST", body: fd, credentials: "include" })
          if (!r.ok) throw new Error(await r.text())
          const j = await r.json()
          const text = String(j?.text || "").trim()
          if (text) setInput((prev) => (prev ? prev + " " + text : text))
        } catch (err) {
          console.error(err)
          toast({ title: t.transcribeError, variant: "destructive" })
        } finally {
          setIsTranscribing(false)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error(err)
      stopMicTracks()
      toast({ title: t.micErrorTitle, description: t.micErrorDesc, variant: "destructive" })
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    setIsRecording(false)
    if (!recorder) {
      stopMicTracks()
      return
    }
    if (recorder.state !== "inactive") {
      try { recorder.stop() } catch { stopMicTracks() }
    } else {
      stopMicTracks()
    }
  }

  // Cleanup on unmount.
  useEffect(() => () => stopMicTracks(), [])

  const handleQuickPrompt = (prompt: string) => {
    if (sendMessage.isPending) return
    sendMessage.mutate({ content: prompt })
  }

  const showEmpty = !isLoading && (!messages || messages.length === 0)
  const Arrow = isAr ? ArrowLeft : ArrowRight

  /* ───────────────────────── render ───────────────────────── */

  return (
    <div
      className="h-[calc(100vh-9rem)] md:h-[calc(100vh-8rem)] flex flex-col"
      data-testid="page-ai-assistant"
    >
      {/* ── Section label ── */}
      <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3">
        <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-muted-foreground">
          {t.sectionLabel}
        </span>
        <span className="text-[11px] text-muted-foreground/70 font-mono tabular-nums">
          {new Date().toLocaleDateString(isAr ? "ar" : "en-US", { day: "2-digit", month: "short", year: "numeric" })}
        </span>
      </div>

      {/* ── Surface ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className={cn("mx-auto max-w-2xl", showEmpty ? "py-8 sm:py-12" : "py-6 space-y-5")}>
            {showEmpty ? (
              <EmptyState
                title={t.title}
                subtitle={t.subtitle}
                quickHeader={t.quickHeader}
                capabilities={t.capabilities}
                onPick={handleQuickPrompt}
                Arrow={Arrow}
              />
            ) : (
              <>
                {isLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
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
        <div className="border-t border-border pt-3">
          {imagePreview && (
            <div className="max-w-2xl mx-auto mb-2.5">
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
            className="max-w-2xl mx-auto"
            data-testid="form-composer"
          >
            <div className="flex items-end gap-2 border border-border bg-background focus-within:border-foreground/40 transition-colors p-2 rounded-md">
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

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCameraOpen(true)}
                disabled={sendMessage.isPending}
                className="text-muted-foreground hover:text-foreground shrink-0"
                data-testid="button-open-camera-capture"
                aria-label={t.cameraAria}
                title={t.cameraAria}
              >
                <Camera className="w-4 h-4" />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing || sendMessage.isPending}
                className={cn(
                  "shrink-0",
                  isRecording
                    ? "text-red-600 hover:text-red-700"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid="button-voice-record"
                aria-label={isRecording ? t.micStopAria : t.micStartAria}
                title={isRecording ? t.micStopAria : t.micStartAria}
              >
                {isTranscribing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isRecording ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </Button>

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={imagePreview ? t.placeholderWithImage : t.placeholder}
                className="flex-1 resize-none bg-transparent border-0 outline-none focus:ring-0 text-[14px] leading-6 py-1 px-1 text-foreground placeholder:text-muted-foreground/60 max-h-[200px]"
                disabled={sendMessage.isPending}
                data-testid="input-chat-message"
              />

              <Button
                type="submit"
                size="icon"
                className={cn(
                  "h-8 w-8 shrink-0 rounded-md",
                  (!input.trim() && !imagePreview) && "opacity-40"
                )}
                disabled={(!input.trim() && !imagePreview) || sendMessage.isPending}
                data-testid="button-send-message"
                aria-label={t.sendAria}
              >
                {sendMessage.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <ArrowUp className="w-3.5 h-3.5" />
                }
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground/70 mt-2 px-0.5">
              {t.footnote}
            </p>
          </form>

          <CameraCaptureDialog
            open={cameraOpen}
            onOpenChange={setCameraOpen}
            onCapture={(file) => attachImageFile(file, { alreadyEnhanced: true })}
            locale={locale}
          />
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Empty state                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

type Cap = { icon: typeof FileSpreadsheet; label: string; prompt: string }

function EmptyState({
  title, subtitle, quickHeader, capabilities, onPick, Arrow,
}: {
  title: string; subtitle: string; quickHeader: string;
  capabilities: Cap[]; onPick: (p: string) => void;
  Arrow: typeof ArrowRight
}) {
  return (
    <div className="space-y-10">
      <div className="space-y-2.5 max-w-xl">
        <h1
          className="text-[26px] sm:text-[30px] font-semibold tracking-tight text-foreground leading-[1.15]"
          data-testid="text-assistant-title"
        >
          {title}
        </h1>
        <p className="text-[14.5px] text-muted-foreground leading-relaxed">
          {subtitle}
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80 font-medium pb-1.5 border-b border-border">
          {quickHeader}
        </div>
        <div className="divide-y divide-border">
          {capabilities.map((c, i) => {
            const Icon = c.icon
            return (
              <button
                key={c.label}
                type="button"
                onClick={() => onPick(c.prompt)}
                data-testid={`button-capability-${i}`}
                className="group w-full flex items-center gap-3 text-start py-3 -mx-2 px-2 hover:bg-muted/40 transition-colors"
              >
                <Icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground shrink-0" strokeWidth={1.75} />
                <span className="flex-1 text-[14px] text-foreground leading-snug">
                  {c.label}
                </span>
                <Arrow className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground/70 transition-colors shrink-0" />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Bubble                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

function Bubble({
  role, children, ...rest
}: {
  role: "user" | "assistant"
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const isUser = role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")} {...rest}>
      <div
        className={cn(
          "max-w-[85%] sm:max-w-[78%] px-3.5 py-2.5 text-foreground",
          isUser
            ? "bg-foreground text-background rounded-lg"
            : "border border-border bg-background rounded-lg"
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
/*  Artifacts — quiet, document-like                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

type Artifact =
  | { kind: "transaction"; type: "income" | "expense"; amount: number; description: string; category: string }
  | { kind: "journal_entry"; id: number; description: string; totalDebit: number; totalCredit: number; lines: number }
  | { kind: "file"; fileId: string; filename: string; mime: string; sizeKB: number; report: string; format: string }
  | { kind: "account"; id: number; code: string; name: string; type: string }
  | { kind: "fixed_asset"; id: number; code: string; name: string; cost: number; currency: string; categoryName: string; usefulLifeMonths: number; method: string }

function parseAssistantContent(content: string): { text: string; artifacts: Artifact[] } {
  if (!content) return { text: "", artifacts: [] }
  const m = content.match(/<<ARTIFACTS>>([\s\S]*?)<<END>>/)
  if (!m) return { text: content.trim(), artifacts: [] }
  let artifacts: Artifact[] = []
  try {
    const parsed = JSON.parse(m[1])
    if (Array.isArray(parsed)) artifacts = parsed as Artifact[]
  } catch { /* ignore */ }
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
        className="group flex items-center gap-3 border border-border bg-background hover:border-foreground/30 transition-colors p-3 rounded-md"
      >
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.75} />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-foreground truncate">
            {reportLabel}
            <span className="ms-2 text-[11px] font-mono uppercase text-muted-foreground/80">
              {isExcel ? "XLSX" : "PDF"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate mt-0.5 font-mono tabular-nums">
            {artifact.filename} · {artifact.sizeKB} KB
          </div>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground group-hover:text-foreground">
          <Download className="w-3.5 h-3.5" />
          {isAr ? "تنزيل" : "Download"}
        </span>
      </a>
    )
  }

  if (artifact.kind === "transaction") {
    const isIncome = artifact.type === "income"
    return (
      <div
        data-testid={`card-tx-${artifact.description}`}
        className="flex items-center gap-3 border border-border bg-background p-3 rounded-md"
      >
        <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.75} />
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium text-foreground truncate">
            {artifact.description}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {artifact.category} · {isAr ? (isIncome ? "إيراد" : "مصروف") : (isIncome ? "Income" : "Expense")}
          </div>
        </div>
        <div className="text-[14px] font-semibold tabular-nums shrink-0 text-foreground font-mono">
          {isIncome ? "+" : "−"}{artifact.amount.toLocaleString()}
        </div>
      </div>
    )
  }

  if (artifact.kind === "account") {
    const typeLabel = isAr
      ? ({ asset: "أصول", liability: "التزامات", equity: "حقوق ملكية", revenue: "إيرادات", expense: "مصروفات" } as Record<string, string>)[artifact.type] ?? artifact.type
      : artifact.type
    return (
      <div
        data-testid={`card-account-${artifact.code}`}
        className="border border-border bg-background p-3 rounded-md"
      >
        <div className="flex items-center gap-3">
          <Wallet className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-foreground truncate">
              <span className="font-mono text-muted-foreground">{artifact.code}</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              {artifact.name}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {isAr ? "تم إضافة الحساب إلى دليل الحسابات" : "Added to chart of accounts"} · {typeLabel}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (artifact.kind === "fixed_asset") {
    return (
      <div
        data-testid={`card-fixed-asset-${artifact.id}`}
        className="border border-border bg-background p-3 rounded-md"
      >
        <div className="flex items-center gap-3">
          <Wallet className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-medium text-foreground truncate">
              <span className="font-mono text-muted-foreground">{artifact.code}</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              {artifact.name}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {artifact.categoryName} · {artifact.usefulLifeMonths} {isAr ? "شهر" : "months"}
            </div>
          </div>
          <div className="text-[14px] font-semibold tabular-nums shrink-0 text-foreground font-mono">
            {artifact.cost.toLocaleString()} {artifact.currency}
          </div>
        </div>
      </div>
    )
  }

  if (artifact.kind === "journal_entry") {
    // Wrap the artifact card in a `JournalEntryRefLink` so the assistant's
    // "Posted JE #N" confirmation is itself navigable: a single tap opens
    // the JE on the Journal page (preserving the existing scroll/highlight
    // flow), and if the JE has since been cascade-reversed by a downstream
    // delete, the same tap surfaces the reversal-trail tombstone instead
    // of dropping the user onto a 404.
    return (
      <JournalEntryRefLink
        id={artifact.id}
        data-testid={`card-je-${artifact.id}`}
        className="block w-full text-start border border-border bg-background hover:border-foreground/30 transition-colors p-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring no-underline"
      >
        <span className="flex items-center gap-3">
          <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.75} />
          <span className="flex-1 min-w-0 block">
            <span className="block text-[13.5px] font-medium text-foreground truncate">
              <span className="font-mono text-muted-foreground">#{artifact.id}</span>
              <span className="mx-1.5 text-muted-foreground/50">·</span>
              {artifact.description}
            </span>
            <span className="block text-[11px] text-muted-foreground mt-0.5 tabular-nums font-mono">
              {artifact.lines} {isAr ? "سطر" : "lines"} · {isAr ? "مدين" : "Dr"} {artifact.totalDebit.toLocaleString()} = {isAr ? "دائن" : "Cr"} {artifact.totalCredit.toLocaleString()}
            </span>
          </span>
        </span>
      </JournalEntryRefLink>
    )
  }

  // Unknown artifact kind — render nothing rather than crashing.
  return null
}
