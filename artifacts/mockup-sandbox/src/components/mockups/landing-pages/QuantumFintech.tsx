import React from "react";
import { 
  ArrowLeft, 
  Terminal, 
  Activity, 
  Globe, 
  Cpu, 
  Database, 
  Lock, 
  Zap,
  BarChart3,
  MessageSquareCode
} from "lucide-react";

// --- Theming & Vibe ---
// Background: Obsidian/Black (bg-black / bg-zinc-950)
// Accent: Plasma Cyan (text-cyan-400, border-cyan-500/30)
// Type: Arabic sans-serif (Cairo/IBM Plex) + Monospace (Space Mono/JetBrains)
// Grids, borders, dense data feel.

export function QuantumFintech() {
  return (
    <div 
      dir="rtl" 
      className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-cyan-900 selection:text-cyan-50 overflow-x-hidden"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', 'Cairo', system-ui, sans-serif"
      }}
    >
      {/* Background Grid & Noise */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-[0.03]" 
           style={{ backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)', backgroundSize: '40px 40px' }} 
      />
      <div className="fixed inset-0 z-0 pointer-events-none bg-[radial-gradient(circle_at_50%_0%,rgba(6,182,212,0.15),transparent_50%)]" />

      {/* Navbar */}
      <nav className="relative z-10 border-b border-zinc-900 bg-black/50 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-cyan-950 border border-cyan-500/30 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-white font-bold tracking-wide">محاسب ذكي</span>
            <span className="font-mono text-xs text-zinc-600 ml-4 hidden sm:inline-block pl-4 border-l border-zinc-800">OS_V2.0</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-cyan-400 transition-colors">النظام</a>
            <a href="#ai" className="hover:text-cyan-400 transition-colors">الذكاء الاصطناعي</a>
            <a href="#global" className="hover:text-cyan-400 transition-colors">النطاق العالمي</a>
          </div>
          <div className="flex items-center gap-4">
            <button className="text-sm font-medium text-zinc-400 hover:text-white transition-colors">تسجيل الدخول</button>
            <button className="bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-bold py-2 px-4 rounded-sm transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] flex items-center gap-2">
              ابدأ مجاناً
              <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative z-10">
        {/* HERO SECTION */}
        <section className="pt-32 pb-24 px-6 max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/20 bg-cyan-500/5 text-cyan-400 text-xs font-mono mb-4">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
              SYSTEM_ONLINE // IFRS_COMPLIANT
            </div>
            <h1 className="text-5xl lg:text-7xl font-bold text-white leading-[1.1] tracking-tight">
              المركز المالي <br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-l from-cyan-400 to-blue-600">
                للأعمال الحديثة.
              </span>
            </h1>
            <p className="text-lg text-zinc-400 leading-relaxed max-w-xl">
              نظام محاسبي ذكي يتجاوز مجرد مسك الدفاتر. أتمتة كاملة، رؤى مدعومة بالذكاء الاصطناعي، وامتثال لمعايير IFRS في منصة واحدة مصممة للشركات سريعة النمو.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <button className="bg-white hover:bg-zinc-200 text-black text-sm font-bold py-3 px-8 rounded-sm transition-colors flex items-center justify-center gap-2">
                احجز عرضاً
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button className="border border-zinc-800 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-white text-sm font-medium py-3 px-8 rounded-sm transition-all flex items-center justify-center gap-2 font-mono">
                <Terminal className="w-4 h-4 text-cyan-400" />
                INIT_WORKSPACE
              </button>
            </div>
          </div>

          {/* Hero UI Mockup: Decision Cockpit */}
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-tr from-cyan-500/20 to-transparent blur-2xl rounded-3xl z-0"></div>
            <div className="relative z-10 border border-zinc-800 bg-black/80 backdrop-blur-xl rounded-lg overflow-hidden shadow-2xl">
              {/* Mockup Header */}
              <div className="h-10 border-b border-zinc-800 flex items-center px-4 bg-zinc-950 justify-between">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
                  <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
                  <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
                </div>
                <div className="text-[10px] font-mono text-zinc-500">DECISION_COCKPIT_Live</div>
              </div>
              {/* Mockup Body */}
              <div className="p-6 grid grid-cols-2 gap-4">
                {/* KPI 1 */}
                <div className="border border-zinc-800 bg-zinc-950 p-4 rounded">
                  <div className="text-[10px] text-zinc-500 font-mono mb-2 uppercase">Net_Revenue_YTD</div>
                  <div className="text-2xl font-mono text-white">SAR 4.2M</div>
                  <div className="text-xs text-cyan-400 mt-2 flex items-center gap-1">
                    <Activity className="w-3 h-3" /> +18.4% vs last period
                  </div>
                </div>
                {/* KPI 2 */}
                <div className="border border-zinc-800 bg-zinc-950 p-4 rounded">
                  <div className="text-[10px] text-zinc-500 font-mono mb-2 uppercase">Cash_Runway</div>
                  <div className="text-2xl font-mono text-white">14 mo</div>
                  <div className="text-xs text-zinc-400 mt-2">Burn: SAR 280k/mo</div>
                </div>
                {/* Journal Entry Row */}
                <div className="col-span-2 border border-zinc-800 bg-zinc-950 p-4 rounded mt-2">
                  <div className="text-[10px] text-zinc-500 font-mono mb-3 uppercase border-b border-zinc-800 pb-2">Recent_Transactions</div>
                  <div className="space-y-3 font-mono text-xs">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600">10:42</span>
                        <span className="text-zinc-300">AWS EMEA SARL</span>
                      </div>
                      <div className="text-red-400">- SAR 12,450.00</div>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-600">09:15</span>
                        <span className="text-zinc-300">Stripe Payout</span>
                      </div>
                      <div className="text-cyan-400">+ SAR 84,200.00</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST SECTION */}
        <section className="py-12 border-y border-zinc-900 bg-zinc-950/50">
          <div className="max-w-7xl mx-auto px-6">
            <p className="text-center text-xs font-mono text-zinc-500 mb-8 uppercase tracking-widest">
              Processing volume for modern enterprises
            </p>
            <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale">
              <div className="text-xl font-bold tracking-tighter">ACME_CORP</div>
              <div className="text-xl font-bold font-serif italic">GlobalTech</div>
              <div className="text-xl font-bold uppercase tracking-widest">Nexus</div>
              <div className="text-xl font-bold flex items-center gap-1"><Zap className="w-5 h-5"/> STARTUP</div>
            </div>
          </div>
        </section>

        {/* CORE ENGINE SECTION */}
        <section id="features" className="py-32 px-6 max-w-7xl mx-auto">
          <div className="mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">محرك مالي لا ينام.</h2>
            <p className="text-zinc-400 max-w-2xl text-lg">
              من الفواتير إلى القيود المزدوجة، تم تصميم كل جزء من النظام ليكون دقيقاً، سريعاً، وقابلاً للتوسع.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="border border-zinc-900 bg-black p-8 group hover:border-cyan-500/30 transition-colors">
              <Database className="w-6 h-6 text-cyan-400 mb-6" />
              <h3 className="text-xl font-bold text-white mb-3">دفتر أستاذ فائق السرعة</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                قيد مزدوج مع امتثال كامل لمعايير IFRS. معالجة لحظية لملايين القيود دون تأخير.
              </p>
              <div className="mt-auto border-t border-zinc-900 pt-4">
                <div className="font-mono text-xs text-zinc-600 flex justify-between">
                  <span>LATENCY</span>
                  <span className="text-cyan-500">&lt; 12ms</span>
                </div>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="border border-zinc-900 bg-black p-8 group hover:border-cyan-500/30 transition-colors">
              <BarChart3 className="w-6 h-6 text-cyan-400 mb-6" />
              <h3 className="text-xl font-bold text-white mb-3">قوائم مالية حية</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                ميزانية عمومية، أرباح وخسائر، وتدفقات نقدية يتم تحديثها مع كل قيد يتم ترحيله. لا مزيد من إغلاق الشهر اليدوي.
              </p>
              <div className="mt-auto border-t border-zinc-900 pt-4">
                <div className="font-mono text-xs text-zinc-600 flex justify-between">
                  <span>SYNC_STATE</span>
                  <span className="text-cyan-500">REALTIME</span>
                </div>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="border border-zinc-900 bg-black p-8 group hover:border-cyan-500/30 transition-colors">
              <Lock className="w-6 h-6 text-cyan-400 mb-6" />
              <h3 className="text-xl font-bold text-white mb-3">أصول ورواتب مدمجة</h3>
              <p className="text-zinc-500 text-sm leading-relaxed mb-6">
                إهلاك آلي للأصول الثابتة، وإدارة رواتب تتضمن مستحقات نهاية الخدمة (IAS 19) والإجازات.
              </p>
              <div className="mt-auto border-t border-zinc-900 pt-4">
                <div className="font-mono text-xs text-zinc-600 flex justify-between">
                  <span>COMPLIANCE</span>
                  <span className="text-cyan-500">IAS_19 / IFRS_16</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AI SECTION (Data-Dense Mockup) */}
        <section id="ai" className="py-32 border-y border-zinc-900 bg-zinc-950/30 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-[radial-gradient(circle_at_100%_50%,rgba(6,182,212,0.05),transparent_70%)] pointer-events-none" />
          
          <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
            {/* Chat Mockup */}
            <div className="border border-zinc-800 bg-black rounded-lg overflow-hidden shadow-2xl relative order-2 lg:order-1">
              <div className="h-10 border-b border-zinc-800 flex items-center px-4 bg-zinc-950 justify-between">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
                  <div className="w-3 h-3 rounded-full bg-zinc-800"></div>
                </div>
                <div className="text-[10px] font-mono text-cyan-500 flex items-center gap-2">
                  <Activity className="w-3 h-3" />
                  AI_AGENT_ACTIVE
                </div>
              </div>
              <div className="p-6 space-y-6">
                {/* User Message */}
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-zinc-800 flex-shrink-0"></div>
                  <div className="flex-1">
                    <div className="bg-zinc-900 text-sm text-zinc-300 p-3 rounded-r-lg rounded-bl-lg border border-zinc-800">
                      "قم بتسجيل فاتورة استضافة AWS بقيمة 4,500 ريال لشهر أكتوبر، ضريبة 15٪"
                    </div>
                  </div>
                </div>
                {/* AI Response */}
                <div className="flex gap-4 flex-row-reverse">
                  <div className="w-8 h-8 rounded bg-cyan-950 border border-cyan-500/30 flex-shrink-0 flex items-center justify-center">
                    <MessageSquareCode className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div className="flex-1 text-left" dir="ltr">
                    <div className="bg-black border border-cyan-500/20 p-4 rounded-l-lg rounded-br-lg shadow-[0_0_15px_rgba(6,182,212,0.05)]">
                      <div className="text-xs text-zinc-500 font-mono mb-2">Drafting Journal Entry...</div>
                      <table className="w-full text-xs font-mono">
                        <thead className="text-zinc-500 border-b border-zinc-800">
                          <tr>
                            <th className="text-left font-normal pb-2">Account</th>
                            <th className="text-right font-normal pb-2">Debit</th>
                            <th className="text-right font-normal pb-2">Credit</th>
                          </tr>
                        </thead>
                        <tbody className="text-zinc-300">
                          <tr>
                            <td className="py-2">Cloud Infrastructure Exp</td>
                            <td className="text-right text-cyan-400">3,913.04</td>
                            <td className="text-right">-</td>
                          </tr>
                          <tr>
                            <td className="py-2">VAT Receivable (15%)</td>
                            <td className="text-right text-cyan-400">586.96</td>
                            <td className="text-right">-</td>
                          </tr>
                          <tr>
                            <td className="py-2 text-zinc-500">Accounts Payable</td>
                            <td className="text-right">-</td>
                            <td className="text-right text-zinc-400">4,500.00</td>
                          </tr>
                        </tbody>
                      </table>
                      <button className="mt-4 w-full bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs py-2 rounded transition-colors font-mono">
                        POST_ENTRY
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Copy */}
            <div className="order-1 lg:order-2">
              <div className="text-cyan-400 font-mono text-sm mb-4">{"<A_I_ASSISTANT />"}</div>
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">من لغة طبيعية <br/>إلى قيود محاسبية.</h2>
              <p className="text-zinc-400 text-lg mb-8 leading-relaxed">
                لا داعي لإدخال البيانات يدوياً. قم بتحميل إيصال، أو أرسل رسالة نصية، وسيقوم المساعد الذكي بتحليل البيانات، تصنيف الحسابات، واقتراح القيد المحاسبي المتوافق مع IFRS فوراً.
              </p>
              <ul className="space-y-4">
                {[
                  "تحليل الفواتير وقراءتها بدقة",
                  "اقتراح التوجيه المحاسبي الصحيح",
                  "اكتشاف الحالات الشاذة والمصروفات المكررة"
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-zinc-300">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500"></div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* LOCALIZATION SECTION */}
        <section id="global" className="py-32 px-6 max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">مصمم للعمل في منطقتك، <br/>وبمعايير عالمية.</h2>
            <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
              حزم توطين مسبقة الإعداد للضرائب والزكاة والعملات.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { code: "KSA", name: "السعودية", desc: "Zakat & VAT 15%" },
              { code: "UAE", name: "الإمارات", desc: "Corporate Tax & VAT 5%" },
              { code: "EGY", name: "مصر", desc: "E-Invoicing Integration" },
              { code: "INT", name: "دولي", desc: "Multi-currency IFRS" },
            ].map((country) => (
              <div key={country.code} className="border border-zinc-900 bg-zinc-950 p-6 flex flex-col items-center text-center group hover:border-zinc-700 transition-colors">
                <Globe className="w-6 h-6 text-zinc-600 mb-4 group-hover:text-cyan-400 transition-colors" />
                <div className="font-bold text-white mb-1">{country.name}</div>
                <div className="text-[10px] font-mono text-zinc-500 uppercase">{country.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CLOSING CTA */}
        <section className="py-32 border-t border-zinc-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-cyan-900/10 mix-blend-screen" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[500px] bg-[radial-gradient(circle_at_50%_50%,rgba(6,182,212,0.1),transparent_50%)] pointer-events-none blur-3xl" />
          
          <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-4xl md:text-6xl font-bold text-white mb-8">عملك يستحق أكثر من مجرد مسك دفاتر.</h2>
            <p className="text-xl text-zinc-400 mb-10">
              انضم إلى الجيل القادم من الإدارة المالية. تشغيل النظام يستغرق دقائق.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button className="bg-cyan-500 hover:bg-cyan-400 text-black text-lg font-bold py-4 px-10 rounded-sm transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2">
                ابدأ مجاناً
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="py-12 px-6 border-t border-zinc-900 bg-black">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <Terminal className="w-3 h-3 text-cyan-500" />
              </div>
              <span className="text-zinc-400 font-bold text-sm">محاسب ذكي © {new Date().getFullYear()}</span>
            </div>
            <div className="flex gap-6 text-sm text-zinc-500 font-mono">
              <a href="#" className="hover:text-zinc-300 transition-colors">API_DOCS</a>
              <a href="#" className="hover:text-zinc-300 transition-colors">SECURITY</a>
              <a href="#" className="hover:text-zinc-300 transition-colors">STATUS</a>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
