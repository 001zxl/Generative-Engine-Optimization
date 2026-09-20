"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  IconFileSearch,
  IconBook2,
  IconLayoutDashboard,
  IconMenu2,
  IconMicroscope,
  IconChevronRight,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/tools/ai-crawler-check", label: "AI 爬虫检查", icon: IconFileSearch },
  { href: "/tools/citation-readiness", label: "内容可引用性", icon: IconMicroscope },
  { href: "/methods", label: "方法与边界", icon: IconBook2 },
  { href: "/console", label: "运营台", icon: IconLayoutDashboard },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-5">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            G
          </span>
          <span className="text-[15px]">{site.name}</span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Button
                key={item.href}
                asChild
                variant={active ? "secondary" : "ghost"}
                size="sm"
                className="text-muted-foreground data-[active=true]:text-foreground"
                data-active={active}
              >
                <Link href={item.href}>
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="ml-auto md:hidden" aria-label="打开菜单">
              <IconMenu2 className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle className="text-left">{site.name}</SheetTitle>
            </SheetHeader>
            <Separator />
            <nav className="flex flex-col gap-1 px-4">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent",
                    pathname === item.href ? "bg-accent font-medium" : "text-muted-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  <IconChevronRight className="ml-auto size-3.5 opacity-50" />
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
