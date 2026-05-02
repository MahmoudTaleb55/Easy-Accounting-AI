import { useLocale } from "@/contexts/locale-context";

type LocaleCode = "ar" | "en" | "de" | "fr";
type Dict = Record<string, Record<LocaleCode, string>>;

export const STRINGS = {
  // Brand
  brand: { ar: "محاسب ذكي", en: "Smart Books", de: "Smart Books", fr: "Smart Books" },

  // Sidebar groups
  group_workspace:    { ar: "مساحة العمل", en: "Workspace", de: "Arbeitsbereich", fr: "Espace de travail" },
  group_books:        { ar: "الدفاتر",     en: "Books",     de: "Bücher",         fr: "Comptabilité" },
  group_people:       { ar: "الموارد والأصول", en: "People & Assets", de: "Personal & Vermögen", fr: "Personnel & Actifs" },
  group_intelligence: { ar: "الذكاء",       en: "Intelligence", de: "Intelligenz", fr: "Intelligence" },
  group_sales:        { ar: "المبيعات",      en: "Sales",     de: "Vertrieb",       fr: "Ventes" },
  group_settings:     { ar: "الإعدادات",     en: "Settings",  de: "Einstellungen", fr: "Paramètres" },

  nav_dashboard:    { ar: "اللوحة الرئيسية", en: "Dashboard",          de: "Übersicht",            fr: "Tableau de bord" },
  nav_inbox:        { ar: "الوارد الذكي",     en: "Smart Inbox",        de: "Smart-Posteingang",    fr: "Boîte intelligente" },
  nav_transactions: { ar: "المعاملات",        en: "Transactions",       de: "Transaktionen",        fr: "Transactions" },
  nav_journal:      { ar: "قيود اليومية",      en: "Journal",            de: "Journal",              fr: "Journal" },
  nav_accounts:     { ar: "دليل الحسابات",     en: "Chart of Accounts",  de: "Kontenplan",           fr: "Plan comptable" },
  nav_reports:      { ar: "التقارير المالية",   en: "Reports",            de: "Berichte",             fr: "Rapports" },
  nav_insights:     { ar: "مركز القرارات",     en: "Insights",           de: "Entscheidungen",       fr: "Décisions" },
  nav_hr:           { ar: "الموارد البشرية",    en: "HR",                 de: "Personal",             fr: "RH" },
  nav_assets:       { ar: "الأصول الثابتة",     en: "Fixed Assets",       de: "Anlagevermögen",       fr: "Immobilisations" },
  nav_ai:           { ar: "المساعد الذكي",     en: "AI Assistant",       de: "KI-Assistent",         fr: "Assistant IA" },
  nav_sales_invoices: { ar: "فواتير المبيعات",  en: "Sales Invoices",     de: "Verkaufsrechnungen",   fr: "Factures de vente" },
  nav_sales_customers:{ ar: "العملاء",          en: "Customers",          de: "Kunden",               fr: "Clients" },
  nav_settings:     { ar: "الإعدادات",         en: "Settings",           de: "Einstellungen",        fr: "Paramètres" },

  // Inventory
  group_inventory:        { ar: "المخزون",          en: "Inventory",           de: "Bestand",            fr: "Stock" },
  nav_inv_items:          { ar: "الأصناف",          en: "Items",               de: "Artikel",            fr: "Articles" },
  nav_inv_categories:     { ar: "تصنيفات المخزون",   en: "Categories",          de: "Kategorien",         fr: "Catégories" },
  nav_inv_locations:      { ar: "المواقع",           en: "Locations",           de: "Standorte",          fr: "Emplacements" },
  nav_inv_transactions:   { ar: "حركات المخزون",     en: "Transactions",        de: "Bestandsbuchungen",  fr: "Mouvements" },
  nav_inv_alerts:         { ar: "تنبيهات المخزون",   en: "Stock alerts",        de: "Bestandsalarme",     fr: "Alertes de stock" },
  nav_inv_valuation:      { ar: "تقييم المخزون",     en: "Stock valuation",     de: "Bestandsbewertung",  fr: "Valorisation" },

  inv_create:             { ar: "إنشاء حركة",        en: "New transaction",     de: "Neue Buchung",       fr: "Nouveau mouvement" },
  inv_purchase:           { ar: "شراء",              en: "Purchase",            de: "Einkauf",            fr: "Achat" },
  inv_sale:               { ar: "بيع",               en: "Sale",                de: "Verkauf",            fr: "Vente" },
  inv_adjustment:         { ar: "تسوية",             en: "Adjustment",          de: "Anpassung",          fr: "Ajustement" },
  inv_transfer:           { ar: "تحويل",             en: "Transfer",            de: "Umlagerung",         fr: "Transfert" },
  inv_reverse:            { ar: "عكس الحركة",        en: "Reverse",             de: "Stornieren",         fr: "Annuler" },
  inv_reversed:           { ar: "معكوسة",            en: "Reversed",            de: "Storniert",          fr: "Annulé" },
  inv_posted:             { ar: "مسجلة",             en: "Posted",              de: "Gebucht",            fr: "Enregistré" },

  inv_code:               { ar: "الرمز",             en: "Code",                de: "Code",               fr: "Code" },
  inv_name_ar:            { ar: "الاسم بالعربية",     en: "Arabic name",         de: "Arabischer Name",    fr: "Nom arabe" },
  inv_name_en:            { ar: "الاسم بالإنجليزية",   en: "English name",        de: "Englischer Name",    fr: "Nom anglais" },
  inv_address:            { ar: "العنوان",           en: "Address",             de: "Adresse",            fr: "Adresse" },
  inv_uom:                { ar: "وحدة القياس",       en: "Unit of measure",     de: "Einheit",            fr: "Unité" },
  inv_min_stock:          { ar: "الحد الأدنى",       en: "Minimum stock",       de: "Mindestbestand",     fr: "Stock minimum" },
  inv_category:           { ar: "التصنيف",           en: "Category",            de: "Kategorie",          fr: "Catégorie" },
  inv_costing:            { ar: "طريقة التكلفة",     en: "Costing method",      de: "Kostenmethode",      fr: "Méthode de coût" },
  inv_costing_fifo:       { ar: "الوارد أولاً",       en: "FIFO",                de: "FIFO",               fr: "FIFO" },
  inv_costing_avg:        { ar: "متوسط مرجّح",       en: "Weighted average",    de: "Gewichteter Durchschnitt", fr: "Moyenne pondérée" },
  inv_quantity:           { ar: "الكمية",            en: "Quantity",            de: "Menge",              fr: "Quantité" },
  inv_unit_cost:          { ar: "تكلفة الوحدة",      en: "Unit cost",           de: "Stückkosten",        fr: "Coût unitaire" },
  inv_total_cost:         { ar: "إجمالي التكلفة",    en: "Total cost",          de: "Gesamtkosten",       fr: "Coût total" },
  inv_on_hand:            { ar: "الرصيد",            en: "On hand",             de: "Bestand",            fr: "Disponible" },
  inv_avg_cost:           { ar: "متوسط التكلفة",     en: "Avg cost",            de: "Ø Kosten",           fr: "Coût moyen" },
  inv_value:              { ar: "القيمة",            en: "Value",               de: "Wert",               fr: "Valeur" },
  inv_location:           { ar: "الموقع",            en: "Location",            de: "Standort",           fr: "Emplacement" },
  inv_dest_location:      { ar: "الموقع الوجهة",     en: "Destination",         de: "Ziel",               fr: "Destination" },
  inv_txn_type:           { ar: "نوع الحركة",        en: "Type",                de: "Typ",                fr: "Type" },
  inv_txn_date:           { ar: "تاريخ الحركة",      en: "Date",                de: "Datum",              fr: "Date" },
  inv_reference:          { ar: "المرجع",            en: "Reference",           de: "Referenz",           fr: "Référence" },
  inv_notes:              { ar: "ملاحظات",          en: "Notes",               de: "Notizen",            fr: "Notes" },
  inv_item:               { ar: "الصنف",             en: "Item",                de: "Artikel",            fr: "Article" },
  inv_add_line:           { ar: "إضافة سطر",         en: "Add line",            de: "Zeile hinzufügen",   fr: "Ajouter une ligne" },
  inv_export_csv:         { ar: "تصدير CSV",         en: "Export CSV",          de: "CSV exportieren",    fr: "Exporter CSV" },
  inv_no_data:            { ar: "لا توجد بيانات",    en: "No data yet",         de: "Keine Daten",        fr: "Aucune donnée" },
  inv_no_alerts:          { ar: "لا توجد تنبيهات",    en: "No low-stock alerts", de: "Keine Alarme",       fr: "Aucune alerte" },
  inv_save:               { ar: "حفظ",               en: "Save",                de: "Speichern",          fr: "Enregistrer" },
  inv_cancel:             { ar: "إلغاء",             en: "Cancel",              de: "Abbrechen",          fr: "Annuler" },
  inv_edit:               { ar: "تعديل",             en: "Edit",                de: "Bearbeiten",         fr: "Modifier" },
  inv_edit_item:          { ar: "تعديل الصنف",       en: "Edit item",           de: "Artikel bearbeiten", fr: "Modifier l'article" },
  inv_actions:            { ar: "إجراءات",           en: "Actions",             de: "Aktionen",           fr: "Actions" },
  inv_costing_default:    { ar: "افتراضي",           en: "Default",             de: "Standard",           fr: "Par défaut" },
  inv_no_category:        { ar: "بدون تصنيف",        en: "No category",         de: "Keine Kategorie",    fr: "Aucune catégorie" },
  inv_confirm_reverse:    { ar: "هل تريد عكس هذه الحركة؟", en: "Reverse this transaction?", de: "Buchung stornieren?", fr: "Annuler ce mouvement ?" },
  inv_total_value:        { ar: "إجمالي قيمة المخزون", en: "Total stock value",   de: "Gesamtbestandswert", fr: "Valeur totale du stock" },

  // Top bar
  search_placeholder:  { ar: "ابحث أو نفّذ أمراً…", en: "Search or run a command…", de: "Suchen oder Befehl ausführen…", fr: "Rechercher ou exécuter une commande…" },
  quick_create:        { ar: "إنشاء", en: "Create", de: "Neu",       fr: "Créer" },
  start_first_tx:      { ar: "ابدأ بأول معاملة", en: "Start with your first transaction", de: "Mit Ihrer ersten Transaktion starten", fr: "Commencez avec votre première transaction" },
  start_first_tx_hint: { ar: "ستظهر مؤشراتك هنا فور تسجيل عملية واحدة.", en: "Metrics appear the moment you log one.", de: "Die Kennzahlen erscheinen, sobald Sie die erste erfassen.", fr: "Les indicateurs apparaissent dès la première saisie." },
  language_label:      { ar: "اللغة", en: "Language", de: "Sprache", fr: "Langue" },
  appearance_label:    { ar: "المظهر", en: "Appearance", de: "Darstellung", fr: "Apparence" },
  light_mode:          { ar: "نهاري", en: "Light", de: "Hell",   fr: "Clair" },
  dark_mode:           { ar: "ليلي",  en: "Dark",  de: "Dunkel", fr: "Sombre" },
  quick_create_tx:     { ar: "معاملة جديدة", en: "New transaction", de: "Neue Transaktion", fr: "Nouvelle transaction" },
  quick_create_je:     { ar: "قيد يومية جديد", en: "New journal entry", de: "Neue Journalbuchung", fr: "Nouvelle écriture" },
  quick_create_account:{ ar: "حساب جديد", en: "New account", de: "Neues Konto", fr: "Nouveau compte" },
  notifications:       { ar: "التنبيهات", en: "Notifications", de: "Benachrichtigungen", fr: "Notifications" },
  profile:             { ar: "الملف الشخصي", en: "Profile", de: "Profil", fr: "Profil" },
  toggle_theme:        { ar: "السمة", en: "Theme", de: "Design", fr: "Thème" },
  toggle_locale:       { ar: "اللغة", en: "Language", de: "Sprache", fr: "Langue" },
  open_ai_rail:        { ar: "افتح المساعد الذكي", en: "Open AI assistant", de: "KI-Assistent öffnen", fr: "Ouvrir l'assistant IA" },
  close_ai_rail:       { ar: "إغلاق المساعد", en: "Close assistant", de: "Assistent schließen", fr: "Fermer l'assistant" },
  open_palette:        { ar: "لوحة الأوامر", en: "Command palette", de: "Befehlspalette", fr: "Palette de commandes" },

  // Period bar
  period_today:    { ar: "اليوم", en: "Today", de: "Heute", fr: "Aujourd'hui" },
  period_week:     { ar: "هذا الأسبوع", en: "This week", de: "Diese Woche", fr: "Cette semaine" },
  period_month:    { ar: "هذا الشهر", en: "This month", de: "Dieser Monat", fr: "Ce mois-ci" },
  period_quarter:  { ar: "هذا الربع", en: "This quarter", de: "Dieses Quartal", fr: "Ce trimestre" },
  period_ytd:      { ar: "منذ بداية السنة", en: "Year to date", de: "Seit Jahresbeginn", fr: "Depuis le début de l'année" },
  period_30d:      { ar: "آخر 30 يوماً", en: "Last 30 days", de: "Letzte 30 Tage", fr: "30 derniers jours" },
  compare_prev:    { ar: "مقارنة بالفترة السابقة", en: "Compare to previous", de: "Mit Vorperiode vergleichen", fr: "Comparer à la période précédente" },
  // Period-empty hint surfaced on the chip / topbar period popover when
  // the active range contains no postings across the whole workspace
  // but other periods do — clicking the hint snaps the period to the
  // window containing the nearest posting (past or future).
  period_empty_hint_short:  { ar: "لا حركات في هذه الفترة", en: "No postings in this period", de: "Keine Buchungen in diesem Zeitraum", fr: "Aucune écriture sur cette période" },
  period_jump_past:         { ar: "الانتقال إلى أحدث حركة سابقة", en: "Jump to latest earlier posting", de: "Zur letzten früheren Buchung springen", fr: "Aller à la dernière écriture précédente" },
  period_jump_future:       { ar: "الانتقال إلى أقرب حركة قادمة", en: "Jump to nearest upcoming posting", de: "Zur nächsten kommenden Buchung springen", fr: "Aller à la prochaine écriture à venir" },
  currency_label:  { ar: "العملة", en: "Currency", de: "Währung", fr: "Devise" },
  synced:          { ar: "آخر مزامنة", en: "Synced", de: "Synchronisiert", fr: "Synchronisé" },

  // KPI strip
  kpi_cash:     { ar: "النقد المتاح", en: "Cash position", de: "Liquiditätsstand", fr: "Trésorerie" },
  kpi_revenue:  { ar: "الإيرادات",    en: "Revenue",       de: "Umsatz",          fr: "Chiffre d'affaires" },
  kpi_expenses: { ar: "المصروفات",    en: "Expenses",      de: "Ausgaben",        fr: "Dépenses" },
  kpi_net:      { ar: "صافي الدخل",    en: "Net",           de: "Ergebnis",        fr: "Résultat net" },
  kpi_runway:   { ar: "مدى الاستمرارية", en: "Runway",        de: "Reichweite",      fr: "Autonomie" },
  vs_previous:  { ar: "مقابل السابقة", en: "vs previous",   de: "ggü. Vorperiode", fr: "vs précédent" },
  days:         { ar: "يوم", en: "days", de: "Tage", fr: "jours" },
  no_burn:      { ar: "صافي إيجابي",  en: "Net positive",  de: "Positiv",         fr: "Résultat positif" },

  // Attention queue
  attention_title:    { ar: "يحتاج انتباهك", en: "Needs your attention", de: "Erfordert Ihre Aufmerksamkeit", fr: "Nécessite votre attention" },
  attention_caught_up_a: { ar: "كل شيء على ما يُرام.", en: "You're caught up.", de: "Alles erledigt.", fr: "Tout est à jour." },
  attention_caught_up_b: { ar: "الدفاتر محدّثة.", en: "Books are current.", de: "Bücher sind aktuell.", fr: "Les livres sont à jour." },
  attention_view:     { ar: "افتح", en: "Open", de: "Öffnen", fr: "Ouvrir" },
  attention_pending_je:{ ar: "قيد يومية بانتظار المراجعة", en: "Pending journal entry", de: "Journalbuchung wartet auf Prüfung", fr: "Écriture en attente de validation" },
  attention_anomaly:  { ar: "إشارة ذكية تحتاج مراجعة", en: "AI flagged signal", de: "KI-Hinweis zu prüfen", fr: "Signal IA à vérifier" },
  attention_inactive: { ar: "لا توجد معاملات هذا الأسبوع — تأكد من المزامنة", en: "No activity this week — verify sync", de: "Keine Aktivität diese Woche — Sync prüfen", fr: "Aucune activité cette semaine — vérifiez la synchronisation" },

  // Charts & sections
  activity_title:   { ar: "النشاط",            en: "Activity",            de: "Aktivität",        fr: "Activité" },
  activity_caption: { ar: "إيرادات ومصروفات يومية", en: "Daily income & spend", de: "Täglich Einnahmen & Ausgaben", fr: "Revenus et dépenses du jour" },
  income:           { ar: "إيرادات",            en: "Income",              de: "Einnahmen",        fr: "Revenus" },
  expense:          { ar: "مصروفات",            en: "Expense",             de: "Ausgaben",         fr: "Dépense" },
  prev_period:      { ar: "الفترة السابقة",     en: "Previous period",     de: "Vorperiode",       fr: "Période précédente" },
  categories_title: { ar: "أعلى فئات الإنفاق",   en: "Top spending categories", de: "Top-Ausgabenkategorien", fr: "Principales catégories de dépenses" },
  no_categories:    { ar: "لا توجد مصروفات بعد.", en: "No spending yet.",   de: "Noch keine Ausgaben.", fr: "Aucune dépense pour l'instant." },

  // Recent activity
  recent_title:    { ar: "أحدث الحركات", en: "Recent activity", de: "Letzte Aktivität", fr: "Activité récente" },
  recent_view_all: { ar: "عرض الكل", en: "View all", de: "Alle anzeigen", fr: "Tout afficher" },
  col_date:        { ar: "التاريخ", en: "Date", de: "Datum", fr: "Date" },
  col_description: { ar: "البيان", en: "Description", de: "Beschreibung", fr: "Description" },
  col_category:    { ar: "الفئة", en: "Category", de: "Kategorie", fr: "Catégorie" },
  col_amount:      { ar: "المبلغ", en: "Amount", de: "Betrag", fr: "Montant" },
  empty_recent:    { ar: "لا توجد معاملات بعد.", en: "No transactions yet.", de: "Noch keine Transaktionen.", fr: "Aucune transaction pour l'instant." },
  empty_recent_add: { ar: "إضافة معاملة", en: "Add transaction", de: "Transaktion hinzufügen", fr: "Ajouter une transaction" },

  // AI rail
  ai_title:      { ar: "المساعد الذكي", en: "AI assistant", de: "KI-Assistent", fr: "Assistant IA" },
  ai_subtitle:   { ar: "اقتراحات على ضوء الفترة المختارة", en: "Suggestions for the current period", de: "Vorschläge für den aktuellen Zeitraum", fr: "Suggestions pour la période en cours" },
  ai_accept:     { ar: "قبول", en: "Accept", de: "Annehmen", fr: "Accepter" },
  ai_reject:     { ar: "رفض", en: "Dismiss", de: "Verwerfen", fr: "Ignorer" },
  ai_no_signals: { ar: "لا اقتراحات الآن.", en: "No suggestions right now.", de: "Derzeit keine Vorschläge.", fr: "Aucune suggestion pour le moment." },

  // Command palette sections
  cp_navigate: { ar: "الانتقال", en: "Navigate", de: "Navigation", fr: "Naviguer" },
  cp_create:   { ar: "إنشاء",   en: "Create",   de: "Neu",        fr: "Créer" },
  cp_search:   { ar: "بحث",    en: "Search",   de: "Suche",      fr: "Rechercher" },
  cp_actions:  { ar: "إجراءات", en: "Run",      de: "Ausführen",  fr: "Exécuter" },
  cp_no_results:{ ar: "لا نتائج.", en: "No results.", de: "Keine Ergebnisse.", fr: "Aucun résultat." },

  // Read-only banner
  readonly_banner_viewer: {
    ar: "أنت مسجَّل دخول بصلاحية «عارض»: يمكنك تصفّح البيانات دون إجراء تغييرات.",
    en: "You're signed in as a Viewer — you can browse data but not make changes.",
    de: "Sie sind als Betrachter angemeldet — Sie können Daten einsehen, aber nicht ändern.",
    fr: "Vous êtes connecté en tant que Lecteur — vous pouvez consulter les données sans les modifier.",
  },
  readonly_banner_dismiss: { ar: "إخفاء", en: "Dismiss", de: "Schließen", fr: "Fermer" },

  // Role chip on profile menu
  role_chip_viewer: { ar: "عارض", en: "Viewer", de: "Betrachter", fr: "Lecteur" },

  // User menu — identity & sign out
  signed_in_as:        { ar: "مسجَّل الدخول باسم", en: "Signed in as", de: "Angemeldet als", fr: "Connecté en tant que" },
  sign_out:            { ar: "تسجيل الخروج", en: "Sign out", de: "Abmelden", fr: "Se déconnecter" },
  signing_out:         { ar: "جارٍ تسجيل الخروج…", en: "Signing out…", de: "Abmelden…", fr: "Déconnexion…" },
} as const satisfies Dict;

export type StringKey = keyof typeof STRINGS;

export function t(key: StringKey, locale: string) {
  const entry = STRINGS[key];
  if (!entry) return String(key);
  if (locale === "ar" || locale === "de" || locale === "fr") return entry[locale];
  return entry.en;
}

export function useT() {
  const { locale } = useLocale();
  return (key: StringKey) => t(key, locale);
}
