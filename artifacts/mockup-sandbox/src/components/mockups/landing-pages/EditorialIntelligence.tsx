import React from "react";
import { ArrowLeft, Check, Globe, Sparkles, TrendingUp, Receipt, FileText, BarChart3, Building2, Calculator, ChevronDown, ArrowRight, User } from "lucide-react";
import { cn } from "@/lib/utils";

// Helper components for UI mockups
const UIMiniPanel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white border border-stone-200 shadow-sm rounded-none overflow-hidden", className)}>
    {children}
  </div>
);

const UITableRow = ({ date, desc, amount, status }: { date: string; desc: string; amount: string; status: "completed" | "pending" }) => (
  <div className="flex items-center justify-between py-3 border-b border-stone-100 last:border-0 text-sm">
    <div className="flex items-center gap-4">
      <span className="text-stone-400 font-mono text-xs">{date}</span>
      <span className="text-stone-800 font-medium">{desc}</span>
    </div>
    <div className="flex items-center gap-4">
      <span className={cn("text-xs px-2 py-0.5 rounded-none", status === "completed" ? "bg-stone-100 text-stone-600" : "bg-orange-50 text-orange-600")}>
        {status === "completed" ? "مكتمل" : "معلق"}
      </span>
      <span className="font-mono font-medium text-stone-900">{amount}</span>
    </div>
  </div>
);

export function EditorialIntelligence() {
  return (
    <div dir="rtl" className="min-h-screen bg-[#f4f4f0] text-[#0a0a0a] font-['IBM_Plex_Sans_Arabic',sans-serif] selection:bg-[#e04b3a] selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 mix-blend-difference text-white p-6 flex justify-between items-center">
        <div className="text-2xl font-bold tracking-tight">محاسب ذكي<span className="text-[#e04b3a]">.</span></div>
        <div className="hidden md:flex gap-8 text-sm uppercase tracking-widest font-mono">
          <a href="#features" className="hover:text-[#e04b3a] transition-colors">النظام</a>
          <a href="#ai" className="hover:text-[#e04b3a] transition-colors">الذكاء الاصطناعي</a>
          <a href="#global" className="hover:text-[#e04b3a] transition-colors">عالمي</a>
        </div>
        <button className="bg-white text-black hover:bg-[#e04b3a] hover:text-white transition-colors px-6 py-2 text-sm uppercase tracking-wider font-medium">
          ابدأ مجاناً
        </button>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6 md:px-12 max-w-[1600px] mx-auto min-h-[90vh] flex flex-col justify-center">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-end">
          <div className="lg:col-span-8">
            <h1 className="text-6xl md:text-8xl lg:text-[8rem] font-bold leading-[0.9] tracking-tight mb-8">
              نظام المحاسبة <br/>الذكي للأعمال<br/> <span className="text-[#e04b3a] italic font-serif">الحديثة.</span>
            </h1>
            <p className="text-xl md:text-2xl text-stone-600 max-w-2xl leading-relaxed">
              أكثر من مجرد مسك دفاتر. نظام تشغيل مالي متكامل يجمع بين المحاسبة، الأتمتة، والذكاء الاصطناعي في منصة واحدة.
            </p>
          </div>
          
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="border-t border-stone-300 pt-6">
              <p className="font-mono text-sm uppercase tracking-widest text-stone-500 mb-2">The Accounting OS</p>
              <p className="text-stone-800 font-medium">Run your finance operations from one smart command center.</p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 mt-8">
              <button className="bg-[#0a0a0a] text-white hover:bg-[#e04b3a] transition-colors px-8 py-4 text-lg font-medium flex items-center justify-center gap-2 group">
                شاهد المنصة
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
              <button className="border border-stone-300 hover:border-[#0a0a0a] transition-colors px-8 py-4 text-lg font-medium">
                احجز عرضاً
              </button>
            </div>
          </div>
        </div>

        {/* Hero Visual / UI Mockup */}
        <div className="mt-24 grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <UIMiniPanel className="col-span-1 lg:col-span-2 p-6 lg:p-8">
            <div className="flex justify-between items-end mb-8 border-b border-stone-200 pb-4">
              <div>
                <p className="font-mono text-sm text-stone-500 mb-1">Q3 Revenue</p>
                <p className="text-4xl font-bold font-mono">SAR 2,450,000</p>
              </div>
              <div className="flex items-center gap-2 text-[#e04b3a] bg-red-50 px-3 py-1 font-mono text-sm">
                <TrendingUp className="w-4 h-4" /> +18.4%
              </div>
            </div>
            <div className="space-y-1">
              <UITableRow date="24 OCT" desc="فاتورة مبيعات #INV-2023-089" amount="+14,500" status="completed" />
              <UITableRow date="23 OCT" desc="دفعة مورد - Tech Solutions" amount="-3,200" status="pending" />
              <UITableRow date="22 OCT" desc="تحصيل اشتراكات سنوية" amount="+85,000" status="completed" />
              <UITableRow date="21 OCT" desc="رسوم خدمات سحابية" amount="-1,150" status="completed" />
            </div>
          </UIMiniPanel>
          
          <UIMiniPanel className="col-span-1 p-6 bg-[#0a0a0a] text-white border-none h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 text-[#e04b3a] mb-6">
                <Sparkles className="w-5 h-5" />
                <span className="font-mono text-sm uppercase tracking-widest">AI Insight</span>
              </div>
              <p className="text-xl leading-relaxed text-stone-300">
                تدفقك النقدي إيجابي، لكن هناك التزامات ضريبية (Zakat) بقيمة <span className="text-white font-mono">45,000 SAR</span> تستحق خلال 14 يوماً. هل أقوم بجدولة الدفعة؟
              </p>
            </div>
            <button className="w-full mt-8 bg-white/10 hover:bg-white/20 transition-colors py-3 text-sm font-medium border border-white/10">
              جدولة الدفعة
            </button>
          </UIMiniPanel>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20 border-y border-stone-300 bg-stone-200/50">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <p className="font-mono text-sm uppercase tracking-widest text-stone-500 max-w-xs">
            Trusted by modern finance teams across MENA
          </p>
          <div className="flex flex-wrap gap-12 opacity-50 grayscale mix-blend-multiply">
            {/* Abstract logos represented by text for elegant typography feel */}
            <span className="text-2xl font-bold font-serif italic">Tamara</span>
            <span className="text-2xl font-bold tracking-tighter">Sary</span>
            <span className="text-2xl font-bold font-mono">FLOW</span>
            <span className="text-2xl font-bold tracking-widest uppercase">Tabby</span>
            <span className="text-2xl font-bold">Foodics</span>
          </div>
        </div>
      </section>

      {/* Editorial Features Grid */}
      <section id="features" className="py-32 px-6 md:px-12 max-w-[1600px] mx-auto">
        <div className="mb-20 grid grid-cols-1 md:grid-cols-2 gap-12 items-end">
          <h2 className="text-5xl md:text-7xl font-bold leading-none tracking-tight">
            نظام متكامل،<br/>بأدق التفاصيل.
          </h2>
          <p className="text-xl text-stone-600 leading-relaxed md:max-w-md">
            صمم ليتوافق مع معايير IFRS العالمية، ويغطي كافة احتياجاتك من القيود المزدوجة إلى إدارة الأصول الثابتة.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="col-span-1 lg:col-span-2 bg-stone-200 p-8 md:p-12 flex flex-col justify-between min-h-[500px] group">
            <div className="max-w-md mb-12">
              <h3 className="text-3xl font-bold mb-4">قوائم مالية فورية</h3>
              <p className="text-stone-600 text-lg">ميزانية عمومية، أرباح وخسائر، وتدفقات نقدية تحدث في الوقت الفعلي مع كل قيد.</p>
            </div>
            <UIMiniPanel className="mt-auto transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
              <div className="p-4 border-b border-stone-100 bg-stone-50 flex justify-between items-center">
                <span className="font-medium">Balance Sheet (IFRS)</span>
                <span className="font-mono text-xs text-stone-500">AS OF TODAY</span>
              </div>
              <div className="p-4 space-y-3 font-mono text-sm">
                <div className="flex justify-between text-stone-500"><span className="font-sans">Assets</span></div>
                <div className="flex justify-between pl-4"><span>Current Assets</span><span>1,245,000</span></div>
                <div className="flex justify-between pl-4"><span>Fixed Assets</span><span>850,000</span></div>
                <div className="flex justify-between font-bold pt-2 border-t border-stone-100"><span>Total Assets</span><span>2,095,000</span></div>
              </div>
            </UIMiniPanel>
          </div>

          <div className="bg-[#e04b3a] text-white p-8 md:p-12 flex flex-col justify-between min-h-[500px]">
            <div>
              <h3 className="text-3xl font-bold mb-4">إدارة الأصول الثابتة</h3>
              <p className="text-white/80 text-lg mb-12">احتساب تلقائي للإهلاك المتراكم بناءً على معايير IFRS.</p>
            </div>
            <div className="space-y-4">
              <div className="bg-white/10 p-4 border border-white/20">
                <div className="text-xs uppercase tracking-widest text-white/60 mb-1">MacBook Pro Fleet</div>
                <div className="text-2xl font-mono mb-2">SAR 45,000</div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Depreciation</span>
                  <span className="font-mono">-2,500 / mo</span>
                </div>
              </div>
              <div className="bg-white/10 p-4 border border-white/20">
                <div className="text-xs uppercase tracking-widest text-white/60 mb-1">Office Furniture</div>
                <div className="text-2xl font-mono mb-2">SAR 120,000</div>
                <div className="flex justify-between text-sm">
                  <span className="text-white/60">Depreciation</span>
                  <span className="font-mono">-1,200 / mo</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-[#0a0a0a] text-white p-8 md:p-12 flex flex-col justify-between min-h-[500px]">
             <div>
              <h3 className="text-3xl font-bold mb-4">الموارد البشرية والرواتب</h3>
              <p className="text-stone-400 text-lg mb-12">إدارة متكاملة للرواتب، مع احتساب تلقائي لمخصصات نهاية الخدمة (IAS 19) والإجازات.</p>
            </div>
            <div className="flex items-center gap-4 mt-auto">
              <div className="w-12 h-12 bg-white/10 flex items-center justify-center rounded-full"><User className="w-5 h-5" /></div>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="font-medium">Ahmed Al-Sayed</span>
                  <span className="font-mono text-sm">SAR 18,500</span>
                </div>
                <div className="w-full bg-white/10 h-1 mt-2">
                  <div className="bg-[#e04b3a] h-1 w-3/4"></div>
                </div>
                <p className="text-xs text-stone-500 mt-2 font-mono">EOSB ACCRUAL: SAR 1,540 / MO</p>
              </div>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-2 border border-stone-300 p-8 md:p-12 flex flex-col md:flex-row gap-8 items-center">
             <div className="flex-1">
              <h3 className="text-3xl font-bold mb-4">القيود المزدوجة المؤتمتة</h3>
              <p className="text-stone-600 text-lg">لا مزيد من الإدخال اليدوي. كل عملية بيع، شراء، أو صرف تولد قيودها المحاسبية تلقائياً في الخلفية.</p>
            </div>
            <UIMiniPanel className="w-full md:w-1/2 p-0">
              <div className="bg-stone-900 text-white p-3 text-xs font-mono flex justify-between">
                <span>SYSTEM GENERATED ENTRY</span>
                <span>#JE-8492</span>
              </div>
              <div className="p-4 space-y-2 text-sm font-mono">
                <div className="grid grid-cols-4 gap-4 text-stone-500 border-b border-stone-100 pb-2">
                  <div className="col-span-2">ACCOUNT</div>
                  <div className="text-right">DEBIT</div>
                  <div className="text-right">CREDIT</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-1">
                  <div className="col-span-2">Cash (1001)</div>
                  <div className="text-right">1,150.00</div>
                  <div className="text-right">-</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-1">
                  <div className="col-span-2">Sales Rev (4001)</div>
                  <div className="text-right">-</div>
                  <div className="text-right">1,000.00</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-1 text-[#e04b3a]">
                  <div className="col-span-2">VAT Payable (2100)</div>
                  <div className="text-right">-</div>
                  <div className="text-right">150.00</div>
                </div>
              </div>
            </UIMiniPanel>
          </div>
        </div>
      </section>

      {/* AI Dimension */}
      <section id="ai" className="py-32 bg-[#0a0a0a] text-white">
        <div className="max-w-[1600px] mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <div className="font-mono text-sm uppercase tracking-widest text-[#e04b3a] mb-6">From invoices to insight — powered by AI</div>
            <h2 className="text-5xl md:text-7xl font-bold leading-[1.1] mb-8">
              تحدث مع <br/>أرقامك.
            </h2>
            <p className="text-xl text-stone-400 leading-relaxed mb-12 max-w-lg">
              المساعد الذكي ليس مجرد واجهة بحث. إنه محاسب آلي يفهم الإيصالات، ينشئ القيود من لغتك الطبيعية، ويحلل بياناتك للإجابة على أصعب أسئلتك المالية.
            </p>
            
            <button className="border border-white hover:bg-white hover:text-black transition-colors px-8 py-4 text-lg font-medium flex items-center gap-2">
              جرّب المساعد الذكي
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-[#e04b3a]/20 to-transparent blur-3xl rounded-full"></div>
            <UIMiniPanel className="relative bg-[#111] border-[#333] text-stone-300">
              <div className="p-4 border-b border-[#333] flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-[#e04b3a]" />
                <span className="font-medium text-white">Mohaseb AI</span>
              </div>
              <div className="p-6 space-y-6">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-stone-800 flex-shrink-0 flex items-center justify-center text-xs">Me</div>
                  <div className="bg-stone-800 p-4 text-sm leading-relaxed rounded-tl-none rounded-xl">
                    سددنا فاتورة استضافة AWS بقيمة 450 دولار عبر بطاقة الشركة الائتمانية.
                  </div>
                </div>
                
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-[#e04b3a] flex-shrink-0 flex items-center justify-center text-white"><Sparkles className="w-4 h-4" /></div>
                  <div className="bg-[#222] border border-[#333] p-4 text-sm leading-relaxed rounded-tr-none rounded-xl w-full">
                    <p className="mb-4">تم تسجيل المصروف. قمت بتحويل المبلغ إلى الريال السعودي (1,687.50 SAR) بناءً على سعر الصرف اليوم، وإنشاء القيد التالي:</p>
                    <div className="bg-[#111] p-3 font-mono text-xs space-y-2 border border-[#333]">
                      <div className="flex justify-between"><span className="text-stone-400">Software Expenses (5200)</span><span className="text-white">DR 1,687.50</span></div>
                      <div className="flex justify-between"><span className="text-stone-400">Corporate Card (2050)</span><span className="text-white">CR 1,687.50</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-[#333]">
                <div className="bg-[#222] text-stone-500 p-3 text-sm flex items-center justify-between">
                  اسأل عن أي شيء...
                  <div className="w-6 h-6 bg-[#333] rounded flex items-center justify-center"><ArrowLeft className="w-3 h-3 text-white" /></div>
                </div>
              </div>
            </UIMiniPanel>
          </div>
        </div>
      </section>

      {/* Localization Section */}
      <section id="global" className="py-32 px-6 md:px-12 max-w-[1600px] mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-5xl font-bold mb-6">مبني للشرق الأوسط، بمعايير عالمية.</h2>
          <p className="text-xl text-stone-600">
            يدعم النظام 7 حزم محلية متكاملة تشمل الضرائب، الزكاة، ومتطلبات الفوترة الإلكترونية الخاصة بكل دولة.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {[
            { name: "السعودية", eng: "Saudi Arabia", code: "SA", active: true },
            { name: "الإمارات", eng: "UAE", code: "AE", active: false },
            { name: "مصر", eng: "Egypt", code: "EG", active: false },
            { name: "الكويت", eng: "Kuwait", code: "KW", active: false },
            { name: "قطر", eng: "Qatar", code: "QA", active: false },
            { name: "الأردن", eng: "Jordan", code: "JO", active: false },
            { name: "دولي", eng: "International", code: "INT", active: false },
          ].map((country) => (
            <div key={country.code} className={cn(
              "p-6 border flex flex-col items-center justify-center text-center gap-4 transition-colors cursor-pointer",
              country.active ? "border-[#0a0a0a] bg-[#0a0a0a] text-white" : "border-stone-200 hover:border-[#0a0a0a] hover:bg-stone-50"
            )}>
              <span className="text-3xl font-serif">{country.code}</span>
              <div>
                <div className="font-bold">{country.name}</div>
                <div className={cn("text-xs font-mono mt-1", country.active ? "text-stone-400" : "text-stone-500")}>{country.eng}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 bg-stone-100 p-8 flex flex-col md:flex-row items-center justify-between gap-6 max-w-4xl mx-auto">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-[#0a0a0a] text-white flex items-center justify-center">
              <Receipt className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-bold text-lg">متوافق مع هيئة الزكاة والدخل (ZATCA)</h4>
              <p className="text-stone-600 text-sm">الفوترة الإلكترونية المرحلة الثانية مدعومة بالكامل.</p>
            </div>
          </div>
          <Check className="w-6 h-6 text-[#e04b3a]" />
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-[#e04b3a] text-white text-center px-6">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-6xl md:text-8xl font-bold tracking-tight mb-8">
            حان الوقت <br/>لترقية نظامك.
          </h2>
          <p className="text-2xl text-white/90 mb-12">
            Your business deserves more than bookkeeping. It needs an Accounting OS.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button className="bg-[#0a0a0a] text-white hover:bg-white hover:text-[#0a0a0a] transition-colors px-10 py-5 text-xl font-bold">
              ابدأ مجاناً / Start free
            </button>
            <button className="border-2 border-[#0a0a0a] text-[#0a0a0a] hover:bg-[#0a0a0a] hover:text-white transition-colors px-10 py-5 text-xl font-bold">
              احجز عرضاً / Book a demo
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0a0a0a] text-stone-400 py-12 px-6 md:px-12 border-t border-[#333]">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-2xl font-bold tracking-tight text-white">محاسب ذكي<span className="text-[#e04b3a]">.</span></div>
          <div className="flex gap-6 text-sm font-mono">
            <a href="#" className="hover:text-white transition-colors">Twitter</a>
            <a href="#" className="hover:text-white transition-colors">LinkedIn</a>
            <a href="#" className="hover:text-white transition-colors">System Status</a>
          </div>
          <div className="text-sm font-mono text-stone-600">
            © 2024 Mohaseb Thaki OS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
