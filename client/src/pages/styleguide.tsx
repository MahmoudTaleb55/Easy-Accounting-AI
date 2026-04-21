import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/contexts/theme-context";
import { useLocale } from "@/contexts/locale-context";
import { Sun, Moon, Languages } from "lucide-react";

const tokenColors = [
  { name: "background", token: "bg-background", text: "text-foreground" },
  { name: "surface", token: "bg-surface", text: "text-surface-foreground" },
  { name: "card", token: "bg-card", text: "text-card-foreground" },
  { name: "primary", token: "bg-primary", text: "text-primary-foreground" },
  { name: "secondary", token: "bg-secondary", text: "text-secondary-foreground" },
  { name: "muted", token: "bg-muted", text: "text-muted-foreground" },
  { name: "accent", token: "bg-accent", text: "text-accent-foreground" },
  { name: "income", token: "bg-income", text: "text-income-foreground" },
  { name: "expense", token: "bg-expense", text: "text-expense-foreground" },
  { name: "success", token: "bg-success", text: "text-success-foreground" },
  { name: "warning", token: "bg-warning", text: "text-warning-foreground" },
  { name: "danger", token: "bg-danger", text: "text-danger-foreground" },
];

const elevations = [
  { name: "flat", cls: "shadow-flat" },
  { name: "subtle", cls: "shadow-subtle" },
  { name: "raised", cls: "shadow-raised" },
  { name: "overlay", cls: "shadow-overlay" },
];

const radii = [
  { name: "sm (6px)", cls: "rounded-sm" },
  { name: "md (8px)", cls: "rounded-md" },
  { name: "lg (12px)", cls: "rounded-lg" },
  { name: "xl (16px)", cls: "rounded-xl" },
];

const typeScale = [
  { cls: "text-display-lg", label: "display-lg / 60px" },
  { cls: "text-display", label: "display / 48px" },
  { cls: "text-h1", label: "h1 / 36px" },
  { cls: "text-h2", label: "h2 / 28px" },
  { cls: "text-h3", label: "h3 / 22px" },
  { cls: "text-h4", label: "h4 / 18px" },
  { cls: "text-body-lg", label: "body-lg / 17px" },
  { cls: "text-body", label: "body / 15px" },
  { cls: "text-small", label: "small / 13px" },
  { cls: "text-caption", label: "caption / 11px" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-h3 font-semibold tracking-tight">{title}</h2>
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
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
            <div>
              <h1 className="text-h4 font-semibold">Styleguide</h1>
              <p className="text-caption text-muted-foreground">Phase 1 — visual system foundation</p>
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

        <main className="mx-auto max-w-6xl space-y-12 px-6 py-10" dir={effectiveDir}>
          <Section title="Color tokens">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {tokenColors.map((c) => (
                <div key={c.name} className={`rounded-md border border-border ${c.token} ${c.text} p-4`} data-testid={`swatch-${c.name}`}>
                  <div className="text-small font-medium">{c.name}</div>
                  <div className="font-numeric text-caption opacity-80">--{c.name}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Type scale">
            <div className="space-y-3">
              {typeScale.map((t) => (
                <div key={t.cls} className="flex items-baseline gap-6">
                  <span className="w-32 shrink-0 font-numeric text-caption text-muted-foreground">{t.label}</span>
                  <span className={`${t.cls} font-semibold`}>The quick brown fox — ١٢٣٤٥٦٧٨٩٠</span>
                </div>
              ))}
              <div className="pt-4">
                <div className="text-caption text-muted-foreground">Numeric (font-numeric, tabular)</div>
                <div className="font-numeric text-h2">$ 12,345,678.90</div>
                <div className="font-numeric text-body">1,000.00 · 2,500.50 · 9,999.99</div>
              </div>
            </div>
          </Section>

          <Section title="Radius scale">
            <div className="flex flex-wrap items-end gap-4">
              {radii.map((r) => (
                <div key={r.name} className="flex flex-col items-center gap-2">
                  <div className={`size-20 border border-border bg-card ${r.cls}`} />
                  <span className="text-caption text-muted-foreground">{r.name}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Elevation">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {elevations.map((e) => (
                <div key={e.name} className={`rounded-md border border-border bg-card p-5 ${e.cls}`}>
                  <div className="text-small font-medium">{e.name}</div>
                  <div className="font-numeric text-caption text-muted-foreground">{e.cls}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Buttons">
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

          <Section title="Cards">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Account balance</CardTitle>
                  <CardDescription>Operating account · USD</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="font-numeric text-h1">$ 248,930.75</div>
                  <div className="mt-2 flex gap-2">
                    <Badge variant="income">+ 4.2% MoM</Badge>
                    <Badge variant="outline">USD</Badge>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" size="sm">View transactions</Button>
                </CardFooter>
              </Card>
              <Card className="shadow-raised">
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
                </CardContent>
              </Card>
            </div>
          </Section>

          <Section title="Badges">
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

          <Section title="Inputs">
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

          <Section title="Table (denser, tabular numerics)">
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead className="numeric">Debit</TableHead>
                    <TableHead className="numeric">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { d: "2026-04-19", desc: "Stripe payout", a: "Operating", db: "—", cr: "12,450.00" },
                    { d: "2026-04-18", desc: "AWS invoice", a: "Operating", db: "1,820.32", cr: "—" },
                    { d: "2026-04-17", desc: "Payroll April", a: "Payroll", db: "48,900.00", cr: "—" },
                    { d: "2026-04-16", desc: "Customer wire", a: "Operating", db: "—", cr: "98,000.00" },
                  ].map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-numeric text-muted-foreground">{r.d}</TableCell>
                      <TableCell>{r.desc}</TableCell>
                      <TableCell><Badge variant="outline">{r.a}</Badge></TableCell>
                      <TableCell className="numeric">{r.db}</TableCell>
                      <TableCell className="numeric">{r.cr}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </Section>

          <Section title="Tooltip & Separator">
            <div className="flex items-center gap-6">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltips use the overlay elevation</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-8" />
              <span className="text-small text-muted-foreground">Vertical separator</span>
            </div>
            <Separator className="my-4" />
            <span className="text-small text-muted-foreground">Horizontal separator</span>
          </Section>

          <Section title="Bilingual sample">
            <div className="grid gap-4 md:grid-cols-2">
              <Card dir="ltr">
                <CardHeader>
                  <CardTitle>English (LTR)</CardTitle>
                  <CardDescription>Latin pair — Inter / IBM Plex Mono</CardDescription>
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
        </main>
      </div>
    </TooltipProvider>
  );
}
