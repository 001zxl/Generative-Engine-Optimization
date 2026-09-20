import type { Metadata } from "next";
import { ConsoleSidebar } from "@/components/console-nav";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = {
  title: "GEO 运营台",
  robots: { index: false, follow: false },
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ConsoleSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">GEO 运营台</span>
          <span className="ml-auto text-xs text-muted-foreground">
            数据不出本机 · 单工作区模式
          </span>
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
