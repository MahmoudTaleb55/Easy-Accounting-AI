import { useState, useRef, useEffect, useMemo } from "react"
import { useChatMessages, useSendMessage } from "@/hooks/use-chat"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import {
  Send,
  Sparkles,
  Loader2,
  ImagePlus,
  X,
  Receipt,
  ArrowUp,
} from "lucide-react"
import { useLocale } from "@/contexts/locale-context"
import { cn } from "@/lib/utils"

export default function AiAssistant() {
  const { locale } = useLocale()
  const { data: messages, isLoading } = useChatMessages()
  const sendMessage = useSendMessage()
  const { toast } = useToast()
  const [input, setInput] = useState("")
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const t = useMemo(
    () => ({
      eyebrow: locale === "ar" ? "المساعد الذكي" : "AI assistant",
      title:
        locale === "ar"
          ? "اوصف معاملتك. سأكتب القيد."
          : "Describe a transaction. I'll write the entry.",
      subtitle:
        locale === "ar"
          ? "اكتب بلغتك الطبيعية أو ارفع صورة فاتورة. سأستخرج التفاصيل وأرحّل القيد إلى اليومية."
          : "Type in plain language or upload a receipt. I'll extract the details and post the entry.",
      welcome:
        locale === "ar"
          ? "مرحباً. أستطيع تسجيل معاملاتك من جملة واحدة، أو من صورة فاتورة، والإجابة على أسئلتك المالية."
          : "Hi. I can record your transactions from a single sentence or a receipt photo, and answer your financial questions.",
      welcomeBullets:
        locale === "ar"
          ? [
              "صرفت ١٥٠ ر.س على البقالة اليوم",
              "ارفع صورة فاتورة → استخرج المبلغ والمورّد تلقائياً",
              "ما رصيدي؟ ما أكبر فئة إنفاقاً هذا الشهر؟",
            ]
          : [
              "Spent $150 on groceries today",
              "Upload a receipt → I extract amount and vendor",
              "What's my balance? My top expense category?",
            ],
      tryThese: locale === "ar" ? "جرّب أحد الاقتراحات" : "Try one of these",
      placeholder:
        locale === "ar"
          ? "اكتب رسالتك… مثل: استلمت دفعة 3,500 من العميل"
          : "Type your message… e.g. Received a $3,500 payment from client",
      placeholderWithImage:
        locale === "ar"
          ? "أضف ملاحظة (اختياري)…"
          : "Add a note (optional)…",
      sizeError: locale === "ar" ? "حجم كبير جداً" : "File too large",
      sizeErrorDesc:
        locale === "ar" ? "الحد الأقصى ١٠ ميجابايت." : "Maximum size is 10MB.",
      typeError: locale === "ar" ? "نوع غير مدعوم" : "Unsupported type",
      typeErrorDesc:
        locale === "ar" ? "الرجاء اختيار صورة فقط." : "Please choose an image file.",
      footnote:
        locale === "ar"
          ? "كل قيد يظهر هنا يُرحَّل تلقائياً إلى اليومية. راجع الدفاتر دائماً."
          : "Every entry posted here flows into the journal. Always review your books.",
      uploadAria: locale === "ar" ? "ارفع صورة فاتورة" : "Upload a receipt image",
      sendAria: locale === "ar" ? "إرسال" : "Send",
      receipt: locale === "ar" ? "فاتورة" : "Receipt",
    }),
    [locale]
  )

  const QUICK_PROMPTS = useMemo(
    () =>
      locale === "ar"
        ? [
            "صرفت ٥٠ ر.س على القهوة",
            "استلمت راتب ٨٠٠٠ ر.س",
            "فاتورة كهرباء ٣٢٠ ر.س",
            "ما رصيدي الحالي؟",
          ]
        : [
            "Spent $50 on coffee",
            "Received $8,000 salary",
            "Electric bill $320",
            "What's my current balance?",
          ],
    [locale]
  )

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      ) as HTMLElement | null
      if (viewport) viewport.scrollTop = viewport.scrollHeight
      else scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, sendMessage.isPending])

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((!input.trim() && !imagePreview) || sendMessage.isPending) return
    sendMessage.mutate({
      content: input.trim(),
      imageData: imagePreview || undefined,
    })
    setInput("")
    setImagePreview(null)
  }

  const handleQuickPrompt = (prompt: string) => {
    if (sendMessage.isPending) return
    sendMessage.mutate({ content: prompt })
  }

  const showQuickPrompts = !isLoading && (!messages || messages.length <= 1)

  return (
    <div className="h-[calc(100vh-9rem)] md:h-[calc(100vh-8rem)] flex flex-col" data-testid="page-ai-assistant">
      {/* Header */}
      <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-2 max-w-2xl">
          <div className="eyebrow text-muted-foreground/80 flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            {t.eyebrow}
          </div>
          <h1
            className="text-2xl md:text-[28px] font-semibold tracking-tight text-foreground leading-tight"
            data-testid="text-assistant-title"
          >
            {t.title}
          </h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
      </header>

      {/* Chat surface */}
      <Card variant="default" className="flex-1 flex flex-col overflow-hidden p-0 min-h-0">
        <ScrollArea className="flex-1" ref={scrollRef}>
          <div className="px-4 sm:px-6 py-6 space-y-5 max-w-3xl mx-auto">
            {/* Welcome bubble */}
            <Bubble role="assistant" data-testid="message-welcome">
              <p className="text-sm leading-relaxed text-foreground">{t.welcome}</p>
              <ul className="mt-3 space-y-1.5">
                {t.welcomeBullets.map((b, i) => (
                  <li
                    key={i}
                    className="text-[13px] text-muted-foreground flex items-start gap-2"
                  >
                    <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-primary shrink-0" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </Bubble>

            {isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              messages?.map((msg) => (
                <Bubble
                  key={msg.id}
                  role={msg.role as "user" | "assistant"}
                  data-testid={`message-${msg.role}-${msg.id}`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </p>
                </Bubble>
              ))
            )}

            {sendMessage.isPending && (
              <Bubble role="assistant" data-testid="status-thinking">
                <div className="flex gap-1.5 items-center h-4" aria-label="thinking">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
                </div>
              </Bubble>
            )}

            {showQuickPrompts && (
              <div className="pt-2">
                <div className="eyebrow text-muted-foreground/80 mb-2.5">{t.tryThese}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleQuickPrompt(p)}
                      data-testid={`button-suggestion-${p}`}
                      className="text-start px-3.5 py-2.5 rounded-md border border-border bg-card hover:border-foreground/30 hover:bg-muted/40 transition-colors text-[13px] text-foreground"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="border-t border-border bg-background/60 backdrop-blur px-4 sm:px-6 py-3">
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
            className="max-w-3xl mx-auto flex items-center gap-2"
            data-testid="form-composer"
          >
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

            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={imagePreview ? t.placeholderWithImage : t.placeholder}
              className="flex-1 h-10"
              disabled={sendMessage.isPending}
              data-testid="input-chat-message"
            />

            <Button
              type="submit"
              size="icon"
              className={cn(
                "h-10 w-10 shrink-0",
                (!input.trim() && !imagePreview) && "opacity-60"
              )}
              disabled={(!input.trim() && !imagePreview) || sendMessage.isPending}
              data-testid="button-send-message"
              aria-label={t.sendAria}
            >
              <ArrowUp className="w-4 h-4" />
            </Button>
          </form>

          <p className="text-center text-[11px] text-muted-foreground/80 mt-2.5 flex items-center justify-center gap-1.5">
            <Sparkles className="w-3 h-3" />
            {t.footnote}
          </p>
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Bubble                                                               */
/* ------------------------------------------------------------------ */

function Bubble({
  role,
  children,
  ...rest
}: {
  role: "user" | "assistant"
  children: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  const isUser = role === "user"
  return (
    <div
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
      {...rest}
    >
      <div
        className={cn(
          "max-w-[88%] sm:max-w-[80%] px-4 py-2.5 rounded-xl",
          isUser
            ? "bg-foreground text-background rounded-br-sm rtl:rounded-br-xl rtl:rounded-bl-sm"
            : "bg-muted/60 border border-border text-foreground rounded-bl-sm rtl:rounded-bl-xl rtl:rounded-br-sm"
        )}
      >
        {children}
      </div>
    </div>
  )
}
