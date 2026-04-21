import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import {
  Home, ListOrdered, BookText, BookOpen, BarChart3, Sparkles, Users, Building2, Bot, Settings as SettingsIcon,
  Plus, Search,
} from "lucide-react";
import { useT } from "@/i18n/dict";
import { useLocale } from "@/contexts/locale-context";
import { useCompany } from "@/contexts/company-context";
import type { Transaction } from "@shared/schema";

interface Props { open: boolean; onOpenChange: (v: boolean) => void; }

export function CommandPalette({ open, onOpenChange }: Props) {
  const [, setLocation] = useLocation();
  const t = useT();
  const { dir } = useLocale();
  const { companies, setActiveCompanyId } = useCompany();
  const [query, setQuery] = useState("");

  const { data: txs } = useQuery<Transaction[]>({ queryKey: ["/api/transactions"], enabled: open });
  const { data: accounts } = useQuery<any[]>({ queryKey: ["/api/accounts"], enabled: open });

  const go = (path: string) => { onOpenChange(false); setLocation(path); };

  const NAV: { key: string; label: string; icon: any; path: string }[] = useMemo(() => [
    { key: "nav-dash",   label: t("nav_dashboard"),    icon: Home,        path: "/app" },
    { key: "nav-tx",     label: t("nav_transactions"), icon: ListOrdered, path: "/app/transactions" },
    { key: "nav-je",     label: t("nav_journal"),      icon: BookText,    path: "/app/journal" },
    { key: "nav-acc",    label: t("nav_accounts"),     icon: BookOpen,    path: "/app/accounts" },
    { key: "nav-rep",    label: t("nav_reports"),      icon: BarChart3,   path: "/app/reports" },
    { key: "nav-ins",    label: t("nav_insights"),     icon: Sparkles,    path: "/app/insights" },
    { key: "nav-hr",     label: t("nav_hr"),           icon: Users,       path: "/app/hr" },
    { key: "nav-fa",     label: t("nav_assets"),       icon: Building2,   path: "/app/fixed-assets" },
    { key: "nav-ai",     label: t("nav_ai"),           icon: Bot,         path: "/app/ai-assistant" },
    { key: "nav-set",    label: t("nav_settings"),     icon: SettingsIcon,path: "/app/settings" },
  ], [t]);

  const filteredTx = useMemo(() => {
    if (!txs || !query.trim()) return [];
    const q = query.toLowerCase();
    return txs.filter((x) =>
      x.description?.toLowerCase().includes(q) ||
      x.category?.toLowerCase().includes(q) ||
      String(x.amount).includes(q)
    ).slice(0, 6);
  }, [txs, query]);

  const filteredAcc = useMemo(() => {
    if (!accounts || !query.trim()) return [];
    const q = query.toLowerCase();
    return accounts.filter((a: any) =>
      a.code?.toLowerCase().includes(q) ||
      a.nameAr?.toLowerCase().includes(q) ||
      a.nameEn?.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [accounts, query]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div dir={dir} data-testid="command-palette">
        <CommandInput
          placeholder={t("search_placeholder")}
          value={query}
          onValueChange={setQuery}
          data-testid="input-command-search"
        />
        <CommandList>
          <CommandEmpty>{t("cp_no_results")}</CommandEmpty>

          <CommandGroup heading={t("cp_navigate")}>
            {NAV.map((n) => (
              <CommandItem key={n.key} value={`${n.label} ${n.path}`} onSelect={() => go(n.path)} data-testid={`cmd-${n.key}`}>
                <n.icon className="w-4 h-4 opacity-70" />
                <span>{n.label}</span>
                <span className="ms-auto text-[10px] uppercase tracking-wider text-muted-foreground">{n.path}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t("cp_create")}>
            <CommandItem value="create transaction" onSelect={() => go("/app/transactions?new=1")} data-testid="cmd-create-tx">
              <Plus className="w-4 h-4 opacity-70" /> {t("quick_create_tx")}
            </CommandItem>
            <CommandItem value="create journal entry" onSelect={() => go("/app/journal?new=1")} data-testid="cmd-create-je">
              <Plus className="w-4 h-4 opacity-70" /> {t("quick_create_je")}
            </CommandItem>
            <CommandItem value="create account" onSelect={() => go("/app/accounts?new=1")} data-testid="cmd-create-acc">
              <Plus className="w-4 h-4 opacity-70" /> {t("quick_create_account")}
            </CommandItem>
          </CommandGroup>

          {(filteredTx.length > 0 || filteredAcc.length > 0) && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("cp_search")}>
                {filteredTx.map((tx) => (
                  <CommandItem
                    key={`tx-${tx.id}`}
                    value={`tx ${tx.description} ${tx.category} ${tx.amount}`}
                    onSelect={() => go("/app/transactions")}
                    data-testid={`cmd-tx-${tx.id}`}
                  >
                    <ListOrdered className="w-4 h-4 opacity-70" />
                    <span className="truncate">{tx.description}</span>
                    <span className="ms-auto tabular-nums text-xs text-muted-foreground">
                      {Number(tx.amount).toLocaleString()} · {tx.category}
                    </span>
                  </CommandItem>
                ))}
                {filteredAcc.map((a: any) => (
                  <CommandItem
                    key={`acc-${a.id}`}
                    value={`acc ${a.code} ${a.nameAr} ${a.nameEn}`}
                    onSelect={() => go("/app/accounts")}
                    data-testid={`cmd-acc-${a.id}`}
                  >
                    <BookOpen className="w-4 h-4 opacity-70" />
                    <span className="font-mono text-xs me-2">{a.code}</span>
                    <span className="truncate">{a.nameAr || a.nameEn}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {companies.length > 1 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("cp_actions")}>
                {companies.map((c) => (
                  <CommandItem
                    key={`co-${c.id}`}
                    value={`switch company ${c.name}`}
                    onSelect={() => { setActiveCompanyId(c.id); onOpenChange(false); }}
                    data-testid={`cmd-co-${c.id}`}
                  >
                    <Building2 className="w-4 h-4 opacity-70" />
                    <span>{c.name}</span>
                    <span className="ms-auto text-xs text-muted-foreground">{c.functionalCurrency}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </div>
    </CommandDialog>
  );
}

export function useCommandPaletteShortcut(setOpen: (v: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      className="group flex h-9 items-center gap-2 rounded-md border border-border bg-card/80 px-3 text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors w-full max-w-md"
      data-testid="button-open-command-palette"
      title={`${t("open_palette")} (⌘K)`}
    >
      <Search className="w-4 h-4 opacity-60" />
      <span className="truncate">{t("search_placeholder")}</span>
      <kbd className="ms-auto hidden md:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted/60 px-1.5 font-mono text-[10px] text-muted-foreground">
        ⌘K
      </kbd>
    </button>
  );
}
