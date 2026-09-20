"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconUsers,
  IconHistory,
  IconBuildingStore,
  IconHelpCircle,
  IconFileCheck,
  IconChartDots,
  IconMicroscope,
} from "@tabler/icons-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { site } from "@/lib/site";

const SECTIONS = [
  {
    label: "总览",
    items: [{ href: "/console", label: "可见度总览", icon: IconLayoutDashboard }],
  },
  {
    label: "批次 1 · 已上线",
    items: [
      { href: "/console/leads", label: "线索", icon: IconUsers },
      { href: "/console/tool-runs", label: "工具使用记录", icon: IconHistory },
    ],
  },
  {
    label: "批次 2 · 待建",
    items: [
      { href: "/console/brands", label: "品牌与竞品", icon: IconBuildingStore },
      { href: "/console/questions", label: "问题库", icon: IconHelpCircle },
      { href: "/console/claims", label: "事实与证据", icon: IconFileCheck },
      { href: "/console/sampling", label: "采样与评估", icon: IconChartDots },
    ],
  },
];

export function ConsoleSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                  G
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">{site.name}</span>
                  <span className="truncate text-xs text-muted-foreground">GEO 运营台</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarMenu>
              {section.items.map((item) => {
                const active = pathname === item.href;
                const pending = section.label.includes("待建");
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                        {pending && (
                          <Badge
                            variant="secondary"
                            className="ml-auto h-4 px-1 text-[10px] font-normal group-data-[collapsible=icon]:hidden"
                          >
                            批次2
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="回到公开站">
              <Link href="/">
                <IconMicroscope className="size-4" />
                <span>回到公开站</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
