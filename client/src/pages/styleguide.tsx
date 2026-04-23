import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/theme-context";
import { useLocale } from "@/contexts/locale-context";
import { Sun, Moon, Languages, Check } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * Styleguide — the single, living source of truth for the visual system.
 * Every token shown here corresponds to an actual design token defined in
 * `client/src/index.css` and `tailwind.config.ts`. If a screen doesn't look
 * right, this is the page to compare against.
 * ────────────────────────────────────────────────────────────────────────── */

const tokenColors: { name: string; bg: string; fg: string; meaning: string }[] = [
  { name: "background",   bg: "bg-background",   fg: "text-foreground",          meaning: "Page surface" },
  { name: "card",         bg: "bg-card",         fg: "text-card-foreground",     meaning: "Resting card" },
  { name: "popover",      bg: "bg-popover",      fg: "text-popover-foreground",  meaning: "Floating overlays" },
  { name: "primary",      bg: "bg-primary",      fg: "text-primary-foreground",  meaning: "Brand / primary CTA" },
  { name: "secondary",    bg: "bg-secondary",    fg: "text-secondary-foreground",meaning: "Secondary actions" },
  { name: "muted",        bg: "bg-muted",        fg: "text-muted-foreground",    meaning: "Quiet surface" },
  { name: "accent",       bg: "bg-accent",       fg: "text-accent-foreground",   meaning: "Hover / selected" },
  { name: "destructive",  bg: "bg-destructive",  fg: "text-destructive-foreground", meaning: "Delete / dangerous" },
  { name: "success",      bg: "bg-success",      fg: "text-success-foreground",  meaning: "Confirmation" },
  { name: "warning",      bg: "bg-warning",      fg: "text-warning-foreground",  meaning: "Caution" },
  { name: "info",         bg: "bg-info",         fg: "text-info-foreground",     meaning: "Informational" },
  { name: "income",       bg: "bg-income",       fg: "text-income-foreground",   meaning: "Money in" },
  { name: "expense",      bg: "bg-expense",      fg: "text-expense-foreground",  meaning: "Money out" },
  { name: "gain",         bg: "bg-gain",         fg: "text-gain-foreground",     meaning: "Positive delta" },
  { name: "loss",         bg: "bg-loss",         fg: "text-loss-foreground",     meaning: "Negative delta" },
];

const chartSwatches = [
  { n: 1, cls: "bg-chart-1" },
  { n: 2, cls: "bg-chart-2" },
  { n: 3, cls: "bg-chart-3" },
  { n: 4, cls: "bg-chart-4" },
  { n: 5, cls: "bg-chart-5" },
];

const elevations = [
  { name: "xs",      cls: "shadow-xs",      use: "Hairline lift, sticky bars" },
  { name: "sm",      cls: "shadow-sm",      use: "Resting cards" },
  { name: "md",      cls: "shadow-md",      use: "Hovered cards, popovers" },
  { name: "lg",      cls: "shadow-lg",      use: "Dialogs, dropdowns" },
  { name: "xl",      cls: "shadow-xl",      use: "Sheets, command palette" },
  { name: "ring",    cls: "shadow-ring",    use: "Focus ring" },
];

const radii = [
  { name: "xs (4px)",  cls: "rounded-xs" },
  { name: "sm (6px)",  cls: "rounded-sm" },
  { name: "md (8px)",  cls: "rounded-md" },
  { name: "lg (10px)", cls: "rounded-lg" },
  { name: "xl (14px)", cls: "rounded-xl" },
  { name: "full",      cls: "rounded-full" },
];

const typeScale = [
  { cls: "text-display-xl", label: "display-xl",  note: "Hero, landing only" },
  { cls: "text-display-lg", label: "display-lg",  note: "Section openers" },
  { cls: "text-display",    label: "display",     note: "Marketing H2" },
  { cls: "text-h1",         label: "h1 / 32px",   note: "App page title" },
  { cls: "text-h2",         label: "h2 / 24px",   note: "Section title" },
  { cls: "text-h3",         label: "h3 / 20px",   note: "Card title" },
  { cls: "text-h4",         label: "h4 / 17px",   note: "Subsection" },
  { cls: "text-body-lg",    label: "body-lg",     note: "Long-form lead" },
  { cls: "text-body",       label: "body / 15px", note: "Default body" },
  { cls: "text-small",      label: "small / 13px",note: "Helper / chrome" },
  { cls: "text-caption",    label: "caption / 11px", note: "Meta, labels" },
];

const motionTokens = [
  { name: "focus",            duration: "120ms ease-out",           use: "Focus ring (static)" },
  { name: "hover-actionable", duration: "150ms ease-out",           use: "Hover bg / border" },
  { name: "enter",            duration: "220ms cubic-bezier(.2,.8,.2,1)", use: ".motion-enter — pages, drawers" },
  { name: "confirm",          duration: "320ms ease-out",           use: ".motion-confirm — success ping" },
];

function Section({ title, eyebrow, description, children }: { title: string; eyebrow?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 motion-enter">
      <div className="space-y-1.5">
        {eyebrow && <div className="eyebrow text-muted-foreground/80">{eyebrow}</div>}
        <h2 className="text-h3 font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-small text-muted-foreground max-w-2xl">{description}</p>}
      </div>
      <Separator />
      <div>{children}</div>
    </section>
  );
}

export default function Styleguide() {
  const { theme, toggleTheme } = useTheme();
  const { locale, dir, toggleLocale } = useLocale();
  const [previewDir, setPreviewDir] = useState<"rtl" | "ltr" | "follow">("follow");
  const effectiveDir = previewDir === "follow" ? dir : previewDir;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground" dir={dir}>
        <header className="sticky top-0 z-30 border-b border-border glass-surface">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <div>
              <div className="eyebrow text-muted-foreground/80">Design system v2</div>
              <h1 className="text-h4 font-semibold tracking-tight">Styleguide</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={toggleLocale} data-testid="button-toggle-locale">
                <Languages className="size-4" />
                {locale === "ar" ? "EN" : "AR"}
              </Button>
              <Button variant="outline" size="sm" onClick={toggleTheme} data-testid="button-toggle-theme">
                {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
                {theme === "light" ? "Dark" : "Light"}
              </Button>
              <Select value={previewDir} onValueChange={(v) => setPreviewDir(v as any)}>
                <SelectTrigger className="h-8 w-32" data-testid="select-preview-dir">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="follow">dir: app</SelectItem>
                  <SelectItem value="ltr">dir: ltr</SelectItem>
                  <SelectItem value="rtl">dir: rtl</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>

        {/* Brand surface preview */}
        <div className="relative border-b border-border brand-grain">
          <div className="absolute inset-0 brand-mesh [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-6 py-14">
            <div className="eyebrow text-muted-foreground/80">Brand surface</div>
            <h2 className="mt-2 text-display-lg max-w-3xl text-foreground">A finance-grade visual system, documented in one place.</h2>
            <p className="mt-3 max-w-2xl text-body text-muted-foreground">
              Every token below is real. If a screen doesn't match, fix the screen — not the token.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge variant="outline">light · dark</Badge>
              <Badge variant="outline">RTL · LTR</Badge>
              <Badge variant="outline">AA contrast</Badge>
              <Badge variant="outline">prefers-reduced-motion aware</Badge>
            </div>
          </div>
        </div>

        <main className="mx-auto max-w-6xl space-y-14 px-6 py-12" dir={effectiveDir}>

          <Section title="Color tokens" eyebrow="Foundation"
            description="All colors are HSL CSS variables in :root and .dark. Reference them via Tailwind utilities — never raw hex.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {tokenColors.map((c) => (
                <div key={c.name} className={`rounded-lg border border-border ${c.bg} ${c.fg} p-4 shadow-xs`} data-testid={`swatch-${c.name}`}>
                  <div className="text-small font-medium">{c.name}</div>
                  <div className="mt-1 text-caption opacity-80">{c.meaning}</div>
                  <div className="mt-3 font-mono text-caption opacity-70">--{c.name}</div>
                </div>
              ))}
            </div>
            <div className="mt-6 space-y-2">
              <div className="text-small font-medium text-foreground">Chart palette</div>
              <div className="grid grid-cols-5 gap-2">
                {chartSwatches.map((s) => (
                  <div key={s.n} className={`h-12 rounded-md border border-border ${s.cls}`} title={`chart-${s.n}`} />
                ))}
              </div>
            </div>
          </Section>

          <Section title="Type scale" eyebrow="Typography"
            description="Display sizes are clamp()-based for marketing surfaces. App headings (h1–h4) and body sizes are fixed for product chrome density. Numerics use the mono stack and tabular figures.">
            <div className="space-y-3">
              {typeScale.map((t) => (
                <div key={t.cls} className="flex items-baseline gap-6">
                  <span className="w-32 shrink-0 font-mono text-caption text-muted-foreground">{t.label}</span>
                  <span className={`${t.cls} text-foreground`}>The quick brown fox — ١٢٣٤٥٦٧٨٩٠</span>
                  <span className="ms-auto hidden text-caption text-muted-foreground md:inline">{t.note}</span>
                </div>
              ))}
              <div className="pt-4">
                <div className="eyebrow text-muted-foreground/80">Numeric (font-numeric, tabular)</div>
                <div className="mt-1 font-numeric text-h2 text-foreground">$ 12,345,678.90</div>
                <div className="font-numeric text-body text-muted-foreground">1,000.00 · 2,500.50 · 9,999.99</div>
              </div>
              <div className="pt-2">
                <div className="eyebrow text-muted-foreground/80">Eyebrow label</div>
                <div className="eyebrow mt-1">Section opener · used above page titles</div>
              </div>
            </div>
          </Section>

          <Section title="Radius scale" eyebrow="Geometry"
            description="Built from a single --radius (10px) token with offsets. Use sm for inputs/badges, md for buttons/cards, lg for cards, xl for hero panels.">
            <div className="flex flex-wrap items-end gap-5">
              {radii.map((r) => (
                <div key={r.name} className="flex flex-col items-center gap-2">
                  <div className={`size-20 border border-border bg-card ${r.cls}`} />
                  <span className="text-caption text-muted-foreground">{r.name}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Elevation" eyebrow="Depth"
            description="Six tokens, one purpose each. Don't invent ad-hoc shadows.">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {elevations.map((e) => (
                <div key={e.name} className={`rounded-lg border border-border bg-card p-4 ${e.cls}`}>
                  <div className="text-small font-medium">{e.name}</div>
                  <div className="font-mono text-caption text-muted-foreground">{e.cls}</div>
                  <div className="mt-2 text-caption text-muted-foreground">{e.use}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Motion vocabulary" eyebrow="Motion"
            description="Four named motions, all gated behind prefers-reduced-motion. Nothing else is allowed.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {motionTokens.map((m) => (
                <Card key={m.name} className="motion-enter">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-h4">{m.name}</CardTitle>
                    <CardDescription className="font-mono text-caption">{m.duration}</CardDescription>
                  </CardHeader>
                  <CardContent className="text-small text-muted-foreground">{m.use}</CardContent>
                </Card>
              ))}
            </div>
          </Section>

          <Section title="Buttons" eyebrow="Components">
            <div className="flex flex-wrap gap-3">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button disabled>Disabled</Button>
            </div>
          </Section>

          <Section title="Badges" eyebrow="Components">
            <div className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="income">Income</Badge>
              <Badge variant="expense">Expense</Badge>
            </div>
          </Section>

          <Section title="Cards & elevation" eyebrow="Components">
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="hover-elevate">
                <CardHeader>
                  <CardTitle>Account balance</CardTitle>
                  <CardDescription>Operating account · USD</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="font-numeric text-h1 text-foreground">$ 248,930.75</div>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="income">+ 4.2% MoM</Badge>
                    <Badge variant="outline">USD</Badge>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" size="sm">View transactions</Button>
                </CardFooter>
              </Card>
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle>Cash flow</CardTitle>
                  <CardDescription>Last 30 days</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-small text-muted-foreground">Income</span>
                    <span className="font-numeric text-income">+ 89,420.00</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-small text-muted-foreground">Expense</span>
                    <span className="font-numeric text-expense">− 42,180.55</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-small font-medium">Net</span>
                    <span className="font-numeric font-semibold text-foreground">+ 47,239.45</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section title="Inputs & forms" eyebrow="Components">
            <div className="grid max-w-xl gap-3">
              <Input placeholder="Search transactions" data-testid="input-demo" />
              <Textarea placeholder="Notes…" data-testid="textarea-demo" />
              <Select>
                <SelectTrigger data-testid="select-demo">
                  <SelectValue placeholder="Select an account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="op">Operating</SelectItem>
                  <SelectItem value="sv">Savings</SelectItem>
                  <SelectItem value="px">Payroll</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Section>

          <Section title="Tabs — pill & ledger" eyebrow="Components"
            description="Use shadcn Tabs by default. Use .ledger-tabs for editorial / report pages where the underline reads as a column rule.">
            <div className="space-y-5">
              <Tabs defaultValue="a" className="w-full max-w-md">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="a">Overview</TabsTrigger>
                  <TabsTrigger value="b">Activity</TabsTrigger>
                  <TabsTrigger value="c">Settings</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs defaultValue="a" className="w-full">
                <TabsList className="ledger-tabs">
                  <TabsTrigger value="a">Income statement</TabsTrigger>
                  <TabsTrigger value="b">Balance sheet</TabsTrigger>
                  <TabsTrigger value="c">Cash flow</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </Section>

          <Section title="Table — financial density" eyebrow="Components"
            description="Wrap in .table-sticky-first on small viewports to keep the description column visible while horizontally scrolling.">
            <Card className="overflow-hidden">
              <div className="table-sticky-first">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Debit</TableHead>
                      <TableHead className="text-right">Credit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { d: "2026-04-19", desc: "Stripe payout",   a: "Operating", db: "—",         cr: "12,450.00" },
                      { d: "2026-04-18", desc: "AWS invoice",     a: "Operating", db: "1,820.32",  cr: "—" },
                      { d: "2026-04-17", desc: "Payroll April",   a: "Payroll",   db: "48,900.00", cr: "—" },
                      { d: "2026-04-16", desc: "Customer wire",   a: "Operating", db: "—",         cr: "98,000.00" },
                    ].map((r, i) => (
                      <TableRow key={i} className="row-actionable">
                        <TableCell className="font-numeric text-muted-foreground">{r.d}</TableCell>
                        <TableCell>{r.desc}</TableCell>
                        <TableCell><Badge variant="outline">{r.a}</Badge></TableCell>
                        <TableCell className="font-numeric text-right">{r.db}</TableCell>
                        <TableCell className="font-numeric text-right">{r.cr}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </Section>

          <Section title="Tooltip & utilities" eyebrow="Components">
            <div className="flex flex-wrap items-center gap-6">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltips use the lg shadow elevation</TooltipContent>
              </Tooltip>
              <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
                <Check className="size-4 text-success" />
                <code className="font-mono">.motion-confirm</code> ping on success
              </span>
              <span className="inline-flex items-center gap-1.5 text-small text-muted-foreground">
                <span className="status-dot bg-success" /> live status dot
              </span>
            </div>
          </Section>

          <Section title="Bilingual sample" eyebrow="i18n parity"
            description="Cairo for Arabic, Inter for Latin, IBM Plex Mono for numerics. Numbers always render with tabular figures.">
            <div className="grid gap-4 md:grid-cols-2">
              <Card dir="ltr">
                <CardHeader>
                  <CardTitle>English (LTR)</CardTitle>
                  <CardDescription>Inter / IBM Plex Mono</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body">Modern fintech tooling for finance teams that demand precision.</p>
                  <p className="font-numeric mt-2">$ 1,204,890.55</p>
                </CardContent>
              </Card>
              <Card dir="rtl">
                <CardHeader>
                  <CardTitle>عربي (RTL)</CardTitle>
                  <CardDescription>Cairo + IBM Plex Mono للأرقام</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-body">أدوات مالية حديثة للفرق التي تتطلب الدقة والوضوح.</p>
                  <p className="font-numeric mt-2">١٬٢٠٤٬٨٩٠٫٥٥</p>
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section title="Page header pattern" eyebrow="Patterns"
            description="Every internal page must use this header: eyebrow + display title + muted subtitle. No exceptions.">
            <Card className="p-8">
              <div className="space-y-2">
                <div className="eyebrow text-muted-foreground/80">القسم · Section</div>
                <h1 className="font-display text-3xl md:text-4xl tracking-tight text-foreground">
                  Title that earns its weight.
                </h1>
                <p className="text-sm text-muted-foreground max-w-xl">
                  One line of subtitle that explains the page's purpose to a busy operator.
                </p>
              </div>
            </Card>
          </Section>
        </main>
      </div>
    </TooltipProvider>
  );
}
