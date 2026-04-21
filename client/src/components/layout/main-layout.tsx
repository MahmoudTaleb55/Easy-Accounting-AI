import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileHeader } from "./app-sidebar";
import { CompanyProvider, useCompany } from "@/contexts/company-context";
import { useLocale } from "@/contexts/locale-context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2 } from "lucide-react";

function CompanySwitcher() {
  const { companies, activeCompanyId, setActiveCompanyId } = useCompany();
  if (companies.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="header-company-switcher">
      <Building2 className="w-4 h-4 text-muted-foreground" />
      <Select value={activeCompanyId ? String(activeCompanyId) : ""} onValueChange={(v) => setActiveCompanyId(Number(v))}>
        <SelectTrigger className="h-9 w-52" data-testid="select-active-company"><SelectValue placeholder="اختر الشركة" /></SelectTrigger>
        <SelectContent>
          {companies.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.functionalCurrency})</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function MainLayout({ children }: { children: React.ReactNode }) {
  const { dir } = useLocale();
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4.5rem",
  } as React.CSSProperties;

  return (
    <CompanyProvider>
      <SidebarProvider style={style}>
        <div className="flex min-h-screen w-full bg-background font-sans text-foreground" dir={dir}>
          <AppSidebar />
          <div className="flex flex-col flex-1 w-full relative">
            <MobileHeader />
            <div className="hidden md:flex items-center justify-end gap-3 px-6 py-3 border-b border-border/50 bg-background/80 backdrop-blur">
              <CompanySwitcher />
            </div>
            <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 lg:p-10 animate-in fade-in duration-500">
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </CompanyProvider>
  );
}
