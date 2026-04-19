import { useState, useRef, useEffect } from "react";
import { useChatMessages, useSendMessage } from "@/hooks/use-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Bot, User, Send, Sparkles, Loader2, ImagePlus, X, Receipt, Wand2 } from "lucide-react";

const QUICK_PROMPTS = [
  { label: "صرفت 50 ر.س على القهوة", icon: "☕" },
  { label: "استلمت راتب 8000 ر.س", icon: "💰" },
  { label: "فاتورة كهرباء 320 ر.س", icon: "💡" },
  { label: "ما هو رصيدي الحالي؟", icon: "📊" },
];

export default function AiAssistant() {
  const { data: messages, isLoading } = useChatMessages();
  const sendMessage = useSendMessage();
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      const viewport = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
      else scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMessage.isPending]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "نوع غير مدعوم", description: "الرجاء اختيار صورة فقط.", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "حجم كبير جداً", description: "الحد الأقصى 10 ميجابايت.", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !imagePreview) || sendMessage.isPending) return;

    sendMessage.mutate({
      content: input.trim(),
      imageData: imagePreview || undefined,
    });
    setInput("");
    setImagePreview(null);
  };

  const handleQuickPrompt = (prompt: string) => {
    if (sendMessage.isPending) return;
    sendMessage.mutate({ content: prompt });
  };

  const showQuickPrompts = !isLoading && (!messages || messages.length <= 1);

  return (
    <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-5rem)] flex flex-col animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3" data-testid="text-assistant-title">
          <div className="p-2 bg-primary/10 rounded-2xl">
            <Bot className="w-7 h-7 text-primary" />
          </div>
          المساعد الذكي
          <span className="text-xs font-bold bg-gradient-to-l from-primary to-emerald-500 text-white px-3 py-1 rounded-full shadow-sm">AI</span>
        </h1>
        <p className="text-muted-foreground mt-2 font-medium">
          صف معاملتك بكلماتك أو ارفع صورة فاتورة، وسأسجلها لك تلقائياً.
        </p>
      </div>

      <div className="flex-1 bg-card border border-border/50 rounded-3xl shadow-xl shadow-black/5 overflow-hidden flex flex-col relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

        <ScrollArea className="flex-1 p-4 sm:p-6" ref={scrollRef}>
          <div className="space-y-6 max-w-3xl mx-auto relative z-10 pb-4">
            {/* Welcome */}
            <div className="flex gap-4 flex-row-reverse" data-testid="message-welcome">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-6 h-6 text-primary" />
              </div>
              <div className="bg-secondary text-secondary-foreground rounded-2xl rounded-tr-sm px-5 py-4 max-w-[85%] shadow-sm">
                <p className="text-base font-medium leading-relaxed">
                  مرحباً! أنا مساعدك المحاسبي الذكي. 💼✨<br /><br />
                  يمكنك:
                  <br />• كتابة معاملة بالعربية: "صرفت 150 ر.س على البقالة"
                  <br />• رفع صورة فاتورة وسأستخرج التفاصيل تلقائياً 📸
                  <br />• سؤالي عن رصيدك أو ملخص حساباتك
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-8 h-8 animate-spin text-primary/50" />
              </div>
            ) : (
              messages?.map((msg) => (
                <div
                  key={msg.id}
                  data-testid={`message-${msg.role}-${msg.id}`}
                  className={`flex gap-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${msg.role === 'user' ? '' : 'flex-row-reverse'}`}
                >
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                    msg.role === 'user' ? 'bg-foreground text-background' : 'bg-primary/10 text-primary'
                  }`}>
                    {msg.role === 'user' ? <User className="w-5 h-5" /> : <Bot className="w-6 h-6" />}
                  </div>

                  <div className={`rounded-3xl px-6 py-4 max-w-[85%] shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-bl from-primary to-primary/90 text-primary-foreground rounded-tl-sm'
                      : 'bg-card border border-border/60 text-foreground rounded-tr-sm'
                  }`}>
                    <p className="text-base font-medium leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ))
            )}

            {sendMessage.isPending && (
              <div className="flex gap-4 flex-row-reverse animate-in fade-in" data-testid="status-thinking">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                </div>
                <div className="bg-secondary/50 rounded-2xl rounded-tr-sm px-6 py-4">
                  <div className="flex gap-1.5 items-center h-6">
                    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {/* Quick prompt suggestions */}
            {showQuickPrompts && (
              <div className="pt-4 animate-in fade-in duration-700">
                <p className="text-sm font-bold text-muted-foreground mb-3 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-primary" />
                  جرّب أحد الاقتراحات:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {QUICK_PROMPTS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleQuickPrompt(p.label)}
                      data-testid={`button-suggestion-${p.label}`}
                      className="text-right p-4 rounded-2xl bg-secondary/50 hover:bg-primary/10 hover:border-primary/30 border border-border/50 transition-all hover:-translate-y-0.5 hover:shadow-md group"
                    >
                      <span className="text-2xl ml-2">{p.icon}</span>
                      <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 sm:p-6 bg-card border-t border-border/50 z-10 relative">
          {/* Image preview */}
          {imagePreview && (
            <div className="max-w-3xl mx-auto mb-3 animate-in fade-in slide-in-from-bottom-2">
              <div className="relative inline-block">
                <img
                  src={imagePreview}
                  alt="معاينة الإيصال"
                  className="h-24 w-24 object-cover rounded-2xl border-2 border-primary/30 shadow-md"
                  data-testid="img-receipt-preview"
                />
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  className="absolute -top-2 -left-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-lg hover:scale-110 transition-transform"
                  data-testid="button-remove-image"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-1 right-1 bg-black/60 text-white text-xs px-2 py-0.5 rounded-md backdrop-blur-sm flex items-center gap-1">
                  <Receipt className="w-3 h-3" /> فاتورة
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2 sm:gap-3 max-w-3xl mx-auto">
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
              size="icon"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={sendMessage.isPending}
              className="h-14 w-14 rounded-2xl shrink-0 border-2 border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary text-primary"
              data-testid="button-upload-image"
              title="ارفع صورة فاتورة"
            >
              <ImagePlus className="w-6 h-6" />
            </Button>

            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={imagePreview ? "أضف ملاحظة (اختياري)..." : "اكتب رسالتك أو ارفع فاتورة..."}
              className="flex-1 h-14 rounded-2xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary/30 focus:ring-primary/20 transition-all text-base font-medium px-6"
              disabled={sendMessage.isPending}
              data-testid="input-chat-message"
            />

            <Button
              type="submit"
              size="icon"
              className="h-14 w-14 rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all shrink-0 disabled:opacity-50"
              disabled={(!input.trim() && !imagePreview) || sendMessage.isPending}
              data-testid="button-send-message"
            >
              <Send className="w-6 h-6 -ml-1 rtl:rotate-180" />
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-3 font-medium">
            <Sparkles className="w-3 h-3 inline ml-1 text-primary" />
            مدعوم بالذكاء الاصطناعي. راجع المعاملات المسجلة دائماً.
          </p>
        </div>
      </div>
    </div>
  );
}
