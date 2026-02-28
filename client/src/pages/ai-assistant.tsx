import { useState, useRef, useEffect } from "react";
import { useChatMessages, useSendMessage } from "@/hooks/use-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, User, Send, Sparkles, Loader2 } from "lucide-react";

export default function AiAssistant() {
  const { data: messages, isLoading } = useChatMessages();
  const sendMessage = useSendMessage();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sendMessage.isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMessage.isPending) return;
    
    sendMessage.mutate({ content: input.trim() });
    setInput("");
  };

  return (
    <div className="h-[calc(100vh-6rem)] md:h-[calc(100vh-5rem)] flex flex-col animate-in fade-in zoom-in-95 duration-500">
      <div className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary" />
          المساعد الذكي
        </h1>
        <p className="text-muted-foreground mt-2 font-medium">
          أخبرني عن مصاريفك، مبيعاتك، أو حتى تفاصيل فاتورة. سأقوم بتحويلها إلى معاملة مسجلة!
        </p>
      </div>

      <div className="flex-1 bg-card border border-border/50 rounded-3xl shadow-xl shadow-black/5 overflow-hidden flex flex-col relative">
        {/* Background ambient decoration */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl pointer-events-none"></div>
        
        <ScrollArea className="flex-1 p-4 sm:p-6" ref={scrollRef}>
          <div className="space-y-6 max-w-3xl mx-auto relative z-10 pb-4">
            {/* Welcome Message */}
            <div className="flex gap-4 flex-row-reverse">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-6 h-6 text-primary" />
              </div>
              <div className="bg-secondary text-secondary-foreground rounded-2xl rounded-tr-sm px-5 py-4 max-w-[85%] shadow-sm">
                <p className="text-base font-medium leading-relaxed">
                  مرحباً! أنا مساعدك المحاسبي الذكي. 💼✨<br/><br/>
                  يمكنك أن تقول لي أشياء مثل:<br/>
                  "فاتورة سوبر ماركت بقيمة 120 ريال"<br/>
                  "سجل إيراد 5000 ريال من مبيعات المتجر"<br/>
                  "اشتريت مستلزمات مكتبية بـ 300 ريال"
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
                  className={`flex gap-4 ${msg.role === 'user' ? '' : 'flex-row-reverse'}`}
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
              <div className="flex gap-4 flex-row-reverse animate-in fade-in">
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
          </div>
        </ScrollArea>

        <div className="p-4 sm:p-6 bg-card border-t border-border/50 z-10 relative">
          <form 
            onSubmit={handleSubmit}
            className="flex gap-3 max-w-3xl mx-auto"
          >
            <Input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="اكتب رسالتك هنا..." 
              className="flex-1 h-14 rounded-2xl bg-secondary/50 border-transparent focus:bg-background focus:border-primary/30 focus:ring-primary/20 transition-all text-base font-medium px-6"
              disabled={sendMessage.isPending}
            />
            <Button 
              type="submit" 
              size="icon" 
              className="h-14 w-14 rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 hover:shadow-xl hover:-translate-y-0.5 transition-all shrink-0"
              disabled={!input.trim() || sendMessage.isPending}
            >
              <Send className="w-6 h-6 -ml-1 rtl:rotate-180" /> {/* Flip send icon for RTL if needed, though default Send points right. In RTL, sending left is natural. RTL rotate-180 fixes it usually depending on icon */}
            </Button>
          </form>
          <p className="text-center text-xs text-muted-foreground mt-3 font-medium">
            المساعد الذكي قد يخطئ أحياناً، يرجى مراجعة المعاملات التي يسجلها.
          </p>
        </div>
      </div>
    </div>
  );
}
