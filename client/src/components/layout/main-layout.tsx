import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar, MobileHeader } from "./app-sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
  // CSS variables for sidebar styling
  const style = {
    "--sidebar-width": "18rem",
    "--sidebar-width-icon": "4.5rem",
  } as React.CSSProperties;

  return (
    <SidebarProvider style={style}>
      <div className="flex min-h-screen w-full bg-background font-sans text-foreground" dir="rtl">
        <AppSidebar />
        <div className="flex flex-col flex-1 w-full relative">
          <MobileHeader />
          <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8 lg:p-10 animate-in fade-in duration-500">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
