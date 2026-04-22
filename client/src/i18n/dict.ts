import { useLocale } from "@/contexts/locale-context";

type Dict = Record<string, { ar: string; en: string }>;

export const STRINGS = {
  // Brand
  brand: { ar: "محاسب ذكي", en: "Smart Books" },

  // Sidebar groups
  group_workspace:    { ar: "مساحة العمل", en: "Workspace" },
  group_books:        { ar: "الدفاتر",     en: "Books" },
  group_people:       { ar: "الموارد والأصول", en: "People & Assets" },
  group_intelligence: { ar: "الذكاء",       en: "Intelligence" },
  group_settings:     { ar: "الإعدادات",     en: "Settings" },

  nav_dashboard:    { ar: "اللوحة الرئيسية", en: "Dashboard" },
  nav_inbox:        { ar: "الوارد الذكي",     en: "Smart Inbox" },
  nav_transactions: { ar: "المعاملات",        en: "Transactions" },
  nav_journal:      { ar: "قيود اليومية",      en: "Journal" },
  nav_accounts:     { ar: "دليل الحسابات",     en: "Chart of Accounts" },
  nav_reports:      { ar: "التقارير المالية",   en: "Reports" },
  nav_insights:     { ar: "مركز القرارات",     en: "Insights" },
  nav_hr:           { ar: "الموارد البشرية",    en: "HR" },
  nav_assets:       { ar: "الأصول الثابتة",     en: "Fixed Assets" },
  nav_ai:           { ar: "المساعد الذكي",     en: "AI Assistant" },
  nav_settings:     { ar: "الإعدادات",         en: "Settings" },

  // Top bar
  search_placeholder:  { ar: "ابحث أو نفّذ أمراً…", en: "Search or run a command…" },
  quick_create:        { ar: "إنشاء", en: "Create" },
  start_first_tx:      { ar: "ابدأ بأول معاملة", en: "Start with your first transaction" },
  start_first_tx_hint: { ar: "ستظهر مؤشراتك هنا فور تسجيل عملية واحدة.", en: "Metrics appear the moment you log one." },
  language_label:      { ar: "اللغة", en: "Language" },
  appearance_label:    { ar: "المظهر", en: "Appearance" },
  light_mode:          { ar: "نهاري", en: "Light" },
  dark_mode:           { ar: "ليلي",  en: "Dark" },
  quick_create_tx:     { ar: "معاملة جديدة", en: "New transaction" },
  quick_create_je:     { ar: "قيد يومية جديد", en: "New journal entry" },
  quick_create_account:{ ar: "حساب جديد", en: "New account" },
  notifications:       { ar: "التنبيهات", en: "Notifications" },
  profile:             { ar: "الملف الشخصي", en: "Profile" },
  toggle_theme:        { ar: "السمة", en: "Theme" },
  toggle_locale:       { ar: "اللغة", en: "Language" },
  open_ai_rail:        { ar: "افتح المساعد الذكي", en: "Open AI assistant" },
  close_ai_rail:       { ar: "إغلاق المساعد", en: "Close assistant" },
  open_palette:        { ar: "لوحة الأوامر", en: "Command palette" },

  // Period bar
  period_today:    { ar: "اليوم", en: "Today" },
  period_week:     { ar: "هذا الأسبوع", en: "This week" },
  period_month:    { ar: "هذا الشهر", en: "This month" },
  period_quarter:  { ar: "هذا الربع", en: "This quarter" },
  period_ytd:      { ar: "منذ بداية السنة", en: "Year to date" },
  period_30d:      { ar: "آخر 30 يوماً", en: "Last 30 days" },
  compare_prev:    { ar: "مقارنة بالفترة السابقة", en: "Compare to previous" },
  currency_label:  { ar: "العملة", en: "Currency" },
  synced:          { ar: "آخر مزامنة", en: "Synced" },

  // KPI strip
  kpi_cash:     { ar: "النقد المتاح", en: "Cash position" },
  kpi_revenue:  { ar: "الإيرادات",    en: "Revenue" },
  kpi_expenses: { ar: "المصروفات",    en: "Expenses" },
  kpi_net:      { ar: "صافي الدخل",    en: "Net" },
  kpi_runway:   { ar: "مدى الاستمرارية", en: "Runway" },
  vs_previous:  { ar: "مقابل السابقة", en: "vs previous" },
  days:         { ar: "يوم", en: "days" },
  no_burn:      { ar: "صافي إيجابي",  en: "Net positive" },

  // Attention queue
  attention_title:    { ar: "يحتاج انتباهك", en: "Needs your attention" },
  attention_caught_up_a: { ar: "كل شيء على ما يُرام.", en: "You're caught up." },
  attention_caught_up_b: { ar: "الدفاتر محدّثة.", en: "Books are current." },
  attention_view:     { ar: "افتح", en: "Open" },
  attention_pending_je:{ ar: "قيد يومية بانتظار المراجعة", en: "Pending journal entry" },
  attention_anomaly:  { ar: "إشارة ذكية تحتاج مراجعة", en: "AI flagged signal" },
  attention_inactive: { ar: "لا توجد معاملات هذا الأسبوع — تأكد من المزامنة", en: "No activity this week — verify sync" },

  // Charts & sections
  activity_title:   { ar: "النشاط",            en: "Activity" },
  activity_caption: { ar: "إيرادات ومصروفات يومية", en: "Daily income & spend" },
  income:           { ar: "إيرادات",            en: "Income" },
  expense:          { ar: "مصروفات",            en: "Expense" },
  prev_period:      { ar: "الفترة السابقة",     en: "Previous period" },
  categories_title: { ar: "أعلى فئات الإنفاق",   en: "Top spending categories" },
  no_categories:    { ar: "لا توجد مصروفات بعد.", en: "No spending yet." },

  // Recent activity
  recent_title:    { ar: "أحدث الحركات", en: "Recent activity" },
  recent_view_all: { ar: "عرض الكل", en: "View all" },
  col_date:        { ar: "التاريخ", en: "Date" },
  col_description: { ar: "البيان", en: "Description" },
  col_category:    { ar: "الفئة", en: "Category" },
  col_amount:      { ar: "المبلغ", en: "Amount" },
  empty_recent:    { ar: "لا توجد معاملات بعد.", en: "No transactions yet." },

  // AI rail
  ai_title:      { ar: "المساعد الذكي", en: "AI assistant" },
  ai_subtitle:   { ar: "اقتراحات على ضوء الفترة المختارة", en: "Suggestions for the current period" },
  ai_accept:     { ar: "قبول", en: "Accept" },
  ai_reject:     { ar: "رفض", en: "Dismiss" },
  ai_no_signals: { ar: "لا اقتراحات الآن.", en: "No suggestions right now." },

  // Command palette sections
  cp_navigate: { ar: "الانتقال", en: "Navigate" },
  cp_create:   { ar: "إنشاء",   en: "Create" },
  cp_search:   { ar: "بحث",    en: "Search" },
  cp_actions:  { ar: "إجراءات", en: "Run" },
  cp_no_results:{ ar: "لا نتائج.", en: "No results." },

  // Read-only banner
  readonly_banner_reviewer: {
    ar: "أنت مسجَّل دخول كـ«مراجِع»: يمكنك الاطلاع والتعليق فقط، وأي تعديل معطَّل.",
    en: "You're signed in as a Reviewer — view and comment only. Editing is disabled.",
  },
  readonly_banner_readonly: {
    ar: "أنت مسجَّل دخول بصلاحية «قراءة فقط»: يمكنك تصفّح البيانات دون إجراء تغييرات.",
    en: "You're signed in with Read-only access — you can browse data but not make changes.",
  },
  readonly_banner_dismiss: { ar: "إخفاء", en: "Dismiss" },
} as const satisfies Dict;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, locale: "ar" | "en") {
  const entry = STRINGS[key];
  return entry ? entry[locale] : String(key);
}

export function useT() {
  const { locale } = useLocale();
  return (key: StringKey) => t(key, locale);
}
