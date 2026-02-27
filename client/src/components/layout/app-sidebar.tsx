import { Link, useLocation } from "wouter";
import { 
  Home, 
  ListOrdered, 
  Bot,
  Wallet,
  Menu
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const items = [
  { title: "الرئيسية", url: "/", icon: Home },
  { title: "المعاملات", url: "/transactions", icon: ListOrdered },
  { title: "المساعد الذكي", url: "/ai-assistant", icon: Bot },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar className="border-l" side="right">
      <SidebarHeader className="p-4 border-b border-border/50">
        <div className="flex items-center gap-3 text-primary">
          <div className="bg-primary/10 p-2 rounded-xl">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <h2 className="font-bold text-xl tracking-tight">محاسب ذكي</h2>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground font-medium text-sm px-4 py-2 mt-4 mb-2">القائمة الرئيسية</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={item.title}
                      className={`
                        py-6 rounded-xl mx-2 my-1 hover-elevate transition-all
                        ${isActive ? 'bg-primary/10 text-primary font-bold shadow-sm' : 'text-foreground/70 hover:text-foreground hover:bg-secondary'}
                      `}
                    >
                      <Link href={item.url} className="flex items-center gap-3">
                        <item.icon className={`w-5 h-5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="text-base">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export function MobileHeader() {
  const { toggleSidebar } = useSidebar();
  
  return (
    <div className="md:hidden flex items-center justify-between p-4 bg-card border-b sticky top-0 z-50 shadow-sm">
      <div className="flex items-center gap-2">
        <Wallet className="w-6 h-6 text-primary" />
        <h2 className="font-bold text-lg text-foreground">محاسب ذكي</h2>
      </div>
      <Button variant="ghost" size="icon" onClick={toggleSidebar}>
        <Menu className="w-6 h-6" />
      </Button>
    </div>
  );
}
