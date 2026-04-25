import { Link } from "wouter";
import { ArrowUpRight, Check, Languages } from "lucide-react";
import { useLocale, type Locale } from "@/contexts/locale-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/brand/mark";

const LANG_NATIVE: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  de: "Deutsch",
  fr: "Français",
};

interface AuthShellProps {
  title: string;
  subtitle?: string;
  side?: { title: string; lede: string; bullets?: string[] };
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Split-screen auth layout.
 * Brand side carries the signature mesh + grain + a quiet "live ledger"
 * preview to mirror the landing page's product surface.
 * Form side stays single-column, hushed, max-w 420.
 */
export function AuthShell({ title, subtitle, side, children, footer }: AuthShellProps) {
  const { locale, dir, toggleLocale } = useLocale();
  const ar = locale === "ar";

  const sideTitle =
    side?.title ?? (ar ? "ادفع كتبك إلى الأمام، بثقة." : "Move the books forward, with confidence.");
  const sideLede =
    side?.lede ??
    (ar
      ? "محاسبة متعدّدة العملات، مصمّمة للفرق الصغيرة والمتوسّطة. أنشئ مساحة عمل خلال دقائق وادعُ المحاسب والعارضين."
      : "Multi-currency accounting designed for small and mid-sized teams. Spin up a workspace in minutes and invite your accountant and viewers.");
  const sideBullets =
    side?.bullets ??
    (ar
      ? ["دفتر يوميّة وفق IFRS تلقائيّاً", "أدوار: مالك، محاسب، عارض", "تدقيق وسجلّات لكلّ تعديل"]
      : ["IFRS-compliant journal, posted automatically", "Roles: owner, accountant, viewer", "Full audit log on every change"]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground" dir={dir}>
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        {/* Brand / value-prop side */}
        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-background p-10 brand-grain">
          {/* Signature mesh, feathered to soft edges */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 brand-mesh [mask-image:radial-gradient(80%_70%_at_30%_30%,black,transparent)]"
          />
          {/* Hairline divider against form side */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-8 end-0 w-px bg-border"
          />

          <div className="flex items-center justify-between relative">
            <Link
              href="/"
              data-testid="link-brand-home"
              className="hover:opacity-90 transition-opacity"
            >
              <BrandMark withWordmark locale={locale} size="md" />
            </Link>
            <LocalePicker />
          </div>

          <div className="max-w-md relative">
            <div className="eyebrow mb-4">{ar ? "محاسب · ذكي" : "Smart · Accountant"}</div>
            <h2 className="font-serif text-display-md leading-[1.05] tracking-tight">
              {sideTitle}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              {sideLede}
            </p>

            <ul className="mt-7 space-y-2.5 text-sm text-muted-foreground">
              {sideBullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            {/* Quiet "live ledger" preview — mirrors landing's product surface */}
            <div className="mt-9 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="eyebrow">{ar ? "آخر قيد · #٢٤٧٨" : "Latest entry · #2478"}</div>
                <span className="inline-flex items-center gap-1 rounded-md bg-gain-tint px-1.5 py-0.5 text-[11px] font-medium text-gain">
                  <ArrowUpRight className="h-3 w-3" />
                  {ar ? "متوازن" : "Balanced"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-sm tabular-nums">
                <span className="text-muted-foreground">{ar ? "مصروف تسويق" : "Marketing expense"}</span>
                <span className="font-display">1,200.00</span>
                <span className="text-muted-foreground/60">—</span>
                <span className="text-muted-foreground">{ar ? "النقدية" : "Cash"}</span>
                <span className="text-muted-foreground/60">—</span>
                <span className="font-display">1,200.00</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground relative">
            © {new Date().getFullYear()} {ar ? "محاسب · ذكي" : "Smart · Accountant"}
          </p>
        </aside>

        {/* Form side */}
        <main className="flex items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[420px]">
            {/* Top bar (mobile) */}
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link
                href="/"
                data-testid="link-brand-home-mobile"
                className="hover:opacity-90 transition-opacity"
              >
                <BrandMark withWordmark locale={locale} size="sm" />
              </Link>
              <LocalePicker testId="button-toggle-locale-mobile" />
            </div>

            <header className="mb-7">
              <h1 className="font-serif text-display-sm leading-tight tracking-tight">{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            </header>

            {children}

            {footer && <div className="mt-7 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Language picker shown on the auth shell (sign-in / sign-up / accept invite).
 * Replaces the prior binary "EN/ع" toggle which only let the user reach
 * Arabic and English even though the app supports German and French too.
 */
function LocalePicker({ testId = "button-toggle-locale" }: { testId?: string } = {}) {
  const { locale, setLocale } = useLocale();
  const ar = locale === "ar";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={ar ? "تغيير اللغة" : "Change language"}
          data-testid={testId}
          title={LANG_NATIVE[locale]}
          className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md text-sm text-foreground/80 hover:text-foreground hover-elevate transition-colors duration-150"
        >
          <Languages className="size-4 opacity-70" />
          <span className="text-small font-medium">{LANG_NATIVE[locale]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="shadow-md min-w-[10rem]">
        {(["ar", "en", "de", "fr"] as const).map((code) => (
          <DropdownMenuItem
            key={code}
            onClick={() => setLocale(code)}
            data-testid={`menu-lang-${code}`}
            className="text-small"
          >
            <Check className={`size-3.5 me-2 ${locale === code ? "opacity-100" : "opacity-0"}`} />
            {LANG_NATIVE[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
