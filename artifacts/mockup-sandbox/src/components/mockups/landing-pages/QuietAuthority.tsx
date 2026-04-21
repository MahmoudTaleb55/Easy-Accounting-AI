import React, { useEffect } from "react";
import { ArrowLeft, ArrowUpRight, Globe, Command, Shield, BarChart3, Fingerprint, Sparkles } from "lucide-react";

export function QuietAuthority() {
  // Add custom fonts for the "Quiet Authority" editorial feel
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div 
      dir="rtl" 
      className="min-h-screen bg-[#FDFCF8] text-[#1A1A1A] selection:bg-[#9B4A22] selection:text-white"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      <style>{`
        .font-serif-ar { font-family: 'Amiri', serif; }
        .hairline-b { border-bottom: 1px solid rgba(26, 26, 26, 0.1); }
        .hairline-t { border-top: 1px solid rgba(26, 26, 26, 0.1); }
      `}</style>

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#FDFCF8]/90 backdrop-blur-md hairline-b">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="text-xl font-serif-ar font-bold tracking-tight">
            محاسب ذكي <span className="text-[#9B4A22]">.</span>
          </div>
          <div className="hidden md:flex items-center gap-12 text-sm font-medium tracking-wide text-[#1A1A1A]/70">
            <a href="#platform" className="hover:text-[#1A1A1A] transition-colors">المنصة</a>
            <a href="#intelligence" className="hover:text-[#1A1A1A] transition-colors">الذكاء الاصطناعي</a>
            <a href="#localization" className="hover:text-[#1A1A1A] transition-colors">النطاق العالمي</a>
          </div>
          <div className="flex items-center gap-6">
            <button className="text-sm font-medium text-[#1A1A1A] hover:text-[#9B4A22] transition-colors">
              تسجيل الدخول
            </button>
            <button className="text-sm font-medium bg-[#1A1A1A] text-[#FDFCF8] px-6 py-2.5 rounded-none hover:bg-[#9B4A22] transition-colors flex items-center gap-2">
              ابدأ مجاناً
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-48 pb-32 px-6 max-w-7xl mx-auto relative">
        <div className="max-w-4xl">
          <p className="text-[#9B4A22] text-sm tracking-[0.2em] uppercase mb-8 flex items-center gap-3">
            <span className="w-8 h-[1px] bg-[#9B4A22]"></span>
            نظام التشغيل المالي
          </p>
          <h1 className="text-5xl md:text-7xl font-serif-ar font-bold leading-[1.2] tracking-tight mb-10 text-[#1A1A1A]">
            النظام المحاسبي الذكي المصمم للأعمال الحديثة.
          </h1>
          <p className="text-xl md:text-2xl text-[#1A1A1A]/60 leading-relaxed max-w-2xl mb-16 font-light">
            أدر عملياتك المالية من مركز قيادة واحد. محاسبة، أتمتة، ورؤى استراتيجية — في منصة ذكية واحدة متوافقة مع المعايير الدولية (IFRS).
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <button className="w-full sm:w-auto bg-[#1A1A1A] text-[#FDFCF8] px-8 py-4 text-sm font-medium hover:bg-[#9B4A22] transition-colors flex items-center justify-center gap-3">
              شاهد المنصة
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button className="w-full sm:w-auto px-8 py-4 text-sm font-medium text-[#1A1A1A] border border-[#1A1A1A]/20 hover:border-[#1A1A1A] transition-colors flex items-center justify-center gap-3">
              احجز عرضاً
            </button>
          </div>
        </div>

        {/* Hero Abstract UI Mockup */}
        <div className="mt-32 relative">
          <div className="absolute -inset-1 bg-gradient-to-b from-[#1A1A1A]/5 to-transparent blur-2xl"></div>
          <div className="relative bg-white border border-[#1A1A1A]/10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] p-8 max-w-5xl mx-auto">
            <div className="flex items-center justify-between mb-12 hairline-b pb-6">
              <div>
                <h3 className="text-sm font-medium text-[#1A1A1A]/50 uppercase tracking-widest mb-1">Q3 Financials</h3>
                <p className="text-xl font-serif-ar">الميزانية العمومية</p>
              </div>
              <div className="text-left">
                <p className="text-3xl font-light font-mono tracking-tight text-[#1A1A1A]">SAR 4,285,900</p>
                <p className="text-sm text-[#9B4A22] mt-1">+12.4% vs Last Quarter</p>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-12">
              <div className="space-y-6">
                <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wider">الأصول المتداولة</p>
                <div className="space-y-4">
                  <div className="flex justify-between items-end hairline-b pb-2">
                    <span className="text-sm text-[#1A1A1A]/80">النقد وما يعادله</span>
                    <span className="font-mono text-sm">1,250,000</span>
                  </div>
                  <div className="flex justify-between items-end hairline-b pb-2">
                    <span className="text-sm text-[#1A1A1A]/80">الذمم المدينة</span>
                    <span className="font-mono text-sm">845,400</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6">
                <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wider">الالتزامات</p>
                <div className="space-y-4">
                  <div className="flex justify-between items-end hairline-b pb-2">
                    <span className="text-sm text-[#1A1A1A]/80">الذمم الدائنة</span>
                    <span className="font-mono text-sm">320,100</span>
                  </div>
                  <div className="flex justify-between items-end hairline-b pb-2">
                    <span className="text-sm text-[#1A1A1A]/80">الضرائب المستحقة</span>
                    <span className="font-mono text-sm">145,800</span>
                  </div>
                </div>
              </div>
              <div className="space-y-6 bg-[#FAFAFA] -m-8 p-8 border-r border-[#1A1A1A]/5">
                <p className="text-xs font-semibold text-[#1A1A1A]/40 uppercase tracking-wider mb-8">AI Insights</p>
                <div className="flex gap-4">
                  <div className="w-1 bg-[#9B4A22]"></div>
                  <p className="text-sm leading-relaxed text-[#1A1A1A]/70">
                    تم اكتشاف زيادة بنسبة ١٥٪ في النفقات التشغيلية مقارنة بالربع الماضي. يوصى بمراجعة عقود الموردين التقنيين.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Signal */}
      <section className="py-20 hairline-t hairline-b bg-[#FAFAFA]">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-[0.3em] mb-12">
            موثوق من قبل الشركات الرائدة في المنطقة
          </p>
          <div className="flex flex-wrap justify-center gap-16 opacity-60 grayscale">
            {['الرياض', 'دبي', 'القاهرة', 'عمان', 'الكويت', 'الدوحة'].map((city, i) => (
              <span key={i} className="text-xl font-serif-ar font-bold text-[#1A1A1A]">{city}</span>
            ))}
          </div>
        </div>
      </section>

      {/* The Platform / Breadth */}
      <section id="platform" className="py-40 px-6 max-w-7xl mx-auto">
        <div className="mb-24 md:w-2/3">
          <h2 className="text-4xl md:text-5xl font-serif-ar mb-8">عملياتك المالية، بوضوح تام.</h2>
          <p className="text-xl text-[#1A1A1A]/60 font-light leading-relaxed">
            من الفواتير إلى الرؤى الاستراتيجية. نظام متكامل يغطي جميع جوانب المحاسبة المزدوجة، الأصول الثابتة، والرواتب، متوافق كلياً مع معايير IFRS.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-32">
          <div className="space-y-16">
            <div className="relative">
              <div className="w-12 h-12 bg-[#1A1A1A] text-[#FDFCF8] flex items-center justify-center rounded-sm mb-6">
                <Command className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-serif-ar mb-4">دفاتر الأستاذ والقيود</h3>
              <p className="text-[#1A1A1A]/60 leading-relaxed mb-10">
                قيود يومية مزدوجة دقيقة. شجرة حسابات مرنة قابلة للتخصيص. وتقارير مالية لحظية تعكس الواقع المالي لشركتك بدقة متناهية.
              </p>
              
              {/* Mini UI: Journal Entry */}
              <div className="bg-white border border-[#1A1A1A]/10 p-6 text-sm">
                <div className="flex justify-between text-xs text-[#1A1A1A]/40 uppercase tracking-wider mb-4 pb-2 hairline-b">
                  <span>Account</span>
                  <div className="flex gap-12">
                    <span>Debit</span>
                    <span>Credit</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">مصاريف التسويق</span>
                    <div className="flex gap-12 font-mono">
                      <span>45,000</span>
                      <span className="text-transparent">00,000</span>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-[#1A1A1A]/60">
                    <span>البنك - الحساب الجاري</span>
                    <div className="flex gap-12 font-mono">
                      <span className="text-transparent">00,000</span>
                      <span>45,000</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="w-12 h-12 border border-[#1A1A1A]/20 flex items-center justify-center rounded-sm mb-6">
                <Shield className="w-5 h-5 text-[#1A1A1A]" />
              </div>
              <h3 className="text-2xl font-serif-ar mb-4">الأصول الثابتة والإهلاك</h3>
              <p className="text-[#1A1A1A]/60 leading-relaxed">
                إدارة دورة حياة الأصول بالكامل. حساب الإهلاك التلقائي وفقاً لمعايير IFRS. تتبع مواقع الأصول وعهد الموظفين بكل سهولة.
              </p>
            </div>
          </div>

          <div className="space-y-16 md:mt-32">
            <div className="relative">
              <div className="w-12 h-12 bg-[#9B4A22] text-[#FDFCF8] flex items-center justify-center rounded-sm mb-6">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h3 className="text-2xl font-serif-ar mb-4">الموارد البشرية والمسيرات</h3>
              <p className="text-[#1A1A1A]/60 leading-relaxed mb-10">
                إدارة متكاملة للرواتب، مع حساب مخصصات نهاية الخدمة (IAS 19) والإجازات تلقائياً. ربط مباشر مع القيود المحاسبية.
              </p>
              
              {/* Mini UI: Payroll summary */}
              <div className="bg-[#1A1A1A] text-[#FDFCF8] p-6 text-sm">
                <div className="flex justify-between items-end mb-6">
                  <span className="text-white/50">مسير رواتب أكتوبر</span>
                  <span className="font-mono text-xl">SAR 284,500</span>
                </div>
                <div className="space-y-4">
                  <div className="bg-white/5 p-4 flex justify-between">
                    <span className="text-white/80">مخصص نهاية الخدمة</span>
                    <span className="font-mono text-[#9B4A22]">12,400+</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* AI Dimension */}
      <section id="intelligence" className="py-32 bg-[#1A1A1A] text-[#FDFCF8]">
        <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-24 items-center">
          <div>
            <p className="text-[#9B4A22] text-sm tracking-[0.2em] uppercase mb-6 flex items-center gap-3">
              <Sparkles className="w-4 h-4" />
              المساعد المالي الذكي
            </p>
            <h2 className="text-4xl md:text-5xl font-serif-ar mb-8 leading-tight">
              لا تكتب القيود.<br/>تحدث معها.
            </h2>
            <p className="text-[#FDFCF8]/60 text-lg leading-relaxed mb-12 font-light">
              قم بتحميل صورة فاتورة، أو اكتب تعليمة بسيطة. سيقوم الذكاء الاصطناعي بتحليل المستند، استخراج البيانات، وتجهيز القيد المحاسبي كاملاً لمراجعتك.
            </p>
            <button className="bg-[#FDFCF8] text-[#1A1A1A] px-8 py-4 text-sm font-medium hover:bg-[#9B4A22] hover:text-white transition-colors">
              جرّب المساعد الذكي
            </button>
          </div>

          {/* Chat Mockup */}
          <div className="border border-white/10 bg-white/5 p-6 space-y-6 font-light">
            <div className="flex gap-4 items-start">
              <div className="w-8 h-8 rounded-full bg-white/10 flex-shrink-0"></div>
              <div className="bg-white/10 rounded-2xl rounded-tr-none p-4 text-sm max-w-[80%]">
                لقد دفعت 450 ريال لتجديد اشتراك البرمجيات من بطاقة الشركة.
              </div>
            </div>
            
            <div className="flex gap-4 items-start flex-row-reverse">
              <div className="w-8 h-8 rounded-full bg-[#9B4A22] flex-shrink-0 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="bg-[#1A1A1A] border border-white/10 rounded-2xl rounded-tl-none p-5 text-sm max-w-[90%]">
                <p className="mb-4 text-white/80">تم تجهيز القيد المحاسبي لتجديد الاشتراك:</p>
                <div className="bg-white/5 p-4 rounded-sm space-y-3 font-mono text-xs">
                  <div className="flex justify-between text-white/40 pb-2 border-b border-white/10">
                    <span>Account</span><span>Dr</span><span>Cr</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Software Subscriptions</span><span>450.00</span><span></span>
                  </div>
                  <div className="flex justify-between text-white/60">
                    <span>Corporate Card</span><span></span><span>450.00</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-3">
                  <button className="bg-white text-black px-4 py-2 text-xs font-medium">اعتماد القيد</button>
                  <button className="border border-white/20 text-white px-4 py-2 text-xs">تعديل</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Localization */}
      <section id="localization" className="py-40 px-6 max-w-7xl mx-auto text-center">
        <Globe className="w-8 h-8 mx-auto mb-8 text-[#1A1A1A]/40" />
        <h2 className="text-4xl font-serif-ar mb-6">مصمم للمنطقة. بمعايير عالمية.</h2>
        <p className="text-xl text-[#1A1A1A]/60 font-light max-w-2xl mx-auto mb-20">
          متوافق مع الهيئات الضريبية في 7 دول. حساب تلقائي لضريبة القيمة المضافة (VAT) والزكاة، وتقارير جاهزة للتقديم المباشر.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-16 text-left max-w-4xl mx-auto" dir="ltr">
          {[
            { c: 'Saudi Arabia', t: 'ZATCA Phase 2 E-Invoicing' },
            { c: 'UAE', t: 'FTA Compliant & Corporate Tax' },
            { c: 'Egypt', t: 'ETA E-Invoicing Integration' },
            { c: 'International', t: 'IFRS Multi-currency' }
          ].map((item, i) => (
            <div key={i} className="border-l border-[#1A1A1A]/10 pl-6 text-right" dir="rtl">
              <p className="font-serif-ar text-xl mb-2 text-[#1A1A1A]">{item.c}</p>
              <p className="text-xs text-[#1A1A1A]/50 font-mono tracking-wide">{item.t}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="py-32 hairline-t bg-[#FAFAFA]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-serif-ar mb-8 leading-tight text-[#1A1A1A]">
            عملك يستحق أكثر من مجرد مسك دفاتر.<br/>إنه يحتاج إلى نظام تشغيل.
          </h2>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-12">
            <button className="w-full sm:w-auto bg-[#1A1A1A] text-[#FDFCF8] px-10 py-4 text-sm font-medium hover:bg-[#9B4A22] transition-colors flex items-center justify-center gap-3">
              ابدأ مجاناً اليوم
              <ArrowLeft className="w-4 h-4" />
            </button>
            <button className="w-full sm:w-auto px-10 py-4 text-sm font-medium text-[#1A1A1A] border border-[#1A1A1A]/20 hover:border-[#1A1A1A] transition-colors">
              التواصل مع المبيعات
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1A1A1A] text-[#FDFCF8]/40 py-12 px-6 text-sm font-light">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-xl font-serif-ar font-bold text-[#FDFCF8] tracking-tight">
            محاسب ذكي <span className="text-[#9B4A22]">.</span>
          </div>
          <div className="flex gap-8">
            <a href="#" className="hover:text-white transition-colors">المنتج</a>
            <a href="#" className="hover:text-white transition-colors">الأسعار</a>
            <a href="#" className="hover:text-white transition-colors">الموارد</a>
            <a href="#" className="hover:text-white transition-colors">الشركة</a>
          </div>
          <div className="text-xs font-mono">
            &copy; 2024 Smart Accountant OS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
