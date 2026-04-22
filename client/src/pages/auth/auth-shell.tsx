import { Link } from "wouter";
import { Wallet } from "lucide-react";
import { useLocale } from "@/contexts/locale-context";
import { Button } from "@/components/ui/button";

interface AuthShellProps {
  title: string;
  subtitle?: string;
  side?: { title: string; lede: string; bullets?: string[] };
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Split-screen auth layout that picks up the landing page's serif/typography. */
export function AuthShell({ title, subtitle, side, children, footer }: AuthShellProps) {
  const { locale, dir, toggleLocale } = useLocale();
  const ar = locale === "ar";

  return (
    <div className="min-h-screen w-full bg-background text-foreground" dir={dir}>
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        {/* Brand / value-prop side */}
        <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary/8 via-background to-background p-10">
          <div className="flex items-center justify-between">
            <Link href="/" data-testid="link-brand-home">
              <a className="flex items-center gap-2.5">
                <div className="bg-primary/10 p-2 rounded-md">
                  <Wallet className="h-5 w-5 text-primary" />
                </div>
                <span className="font-serif text-xl tracking-tight">
                  {ar ? "محاسبي الذكي" : "Smart Accountant"}
                </span>
              </a>
            </Link>
            <Button variant="ghost" size="sm" onClick={toggleLocale} data-testid="button-toggle-locale">
              {ar ? "EN" : "ع"}
            </Button>
          </div>

          <div className="max-w-md">
            <h2 className="font-serif text-display-md leading-tight">
              {side?.title ?? (ar ? "ادفع كتبك إلى الأمام، بثقة." : "Move the books forward, with confidence.")}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              {side?.lede ??
                (ar
                  ? "محاسبة متعددة العملات، مصممة للفرق الصغيرة والمتوسطة. أنشئ مساحة عمل خلال دقائق وادعُ المحاسب والمراجع."
                  : "Multi-currency accounting designed for small and mid-sized teams. Spin up a workspace in minutes and invite your accountant and reviewer.")}
            </p>

            {side?.bullets && (
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                {side.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Smart Accountant.</p>
        </aside>

        {/* Form side */}
        <main className="flex items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[420px]">
            {/* Top bar (mobile) */}
            <div className="mb-8 flex items-center justify-between lg:hidden">
              <Link href="/" data-testid="link-brand-home-mobile">
                <a className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-primary" />
                  <span className="font-serif text-lg">{ar ? "محاسبي الذكي" : "Smart Accountant"}</span>
                </a>
              </Link>
              <Button variant="ghost" size="sm" onClick={toggleLocale}>
                {ar ? "EN" : "ع"}
              </Button>
            </div>

            <header className="mb-7">
              <h1 className="font-serif text-display-sm leading-tight">{title}</h1>
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
