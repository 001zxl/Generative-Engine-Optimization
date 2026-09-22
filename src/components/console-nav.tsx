"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconLayoutDashboard,
  IconUsers,
  IconHistory,
  IconRoute,
  IconBuildingStore,
  IconHelpCircle,
  IconFileCheck,
  IconClipboardText,
  IconChartDots,
  IconFileText,
  IconChartHistogram,
  IconMicroscope,
  IconSend,
  IconChartLine,
  IconLogout,
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
import { logout } from "@/app/console/login/actions";

/**
 * 侧边栏按「使用顺序」组织，而不是按字母或功能分类 ——
 * 核心链路那六项本身就是一条流水线，顺序错了就没法用。
 */
const SECTIONS = [
  {
    label: "总览",
    items: [{ href: "/console", label: "可见度总览", icon: IconLayoutDashboard }],
  },
  {
    label: "核心链路",
    items: [
      { href: "/console/brands", label: "1 · 品牌与竞品", icon: IconBuildingStore },
      { href: "/console/questions", label: "2 · 问题库", icon: IconHelpCircle },
      { href: "/console/claims", label: "3 · 事实与证据", icon: IconFileCheck },
      { href: "/console/sampling", label: "4 · 多平台采样", icon: IconClipboardText },
      { href: "/console/evaluation", label: "5 · 评估与指标", icon: IconChartDots },
      { href: "/console/content", label: "6 · 内容与推广", icon: IconFileText },
      { href: "/console/publishing", label: "7 · 发布与复测", icon: IconSend },
      { href: "/console/experiments", label: "8 · 基线与复测", icon: IconChartLine },
    ],
  },
  {
    label: "获客",
    items: [
      { href: "/console/leads", label: "线索", icon: IconUsers },
      { href: "/console/attribution", label: "9 · 获客归因", icon: IconChartHistogram },
    ],
  },
  {
    label: "其他",
    items: [
      { href: "/console/tool-runs", label: "工具使用记录", icon: IconHistory },
      { href: "/console/roadmap", label: "产品路线图", icon: IconRoute },
    ],
  },
];

export function ConsoleSidebar({ siteName }: { siteName: string }) {
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
                  <span className="truncate text-sm font-semibold">{siteName}</span>
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
              {section.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
                    <Link href={item.href}>
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
          <SidebarMenuItem>
            <form action={logout}>
              <SidebarMenuButton type="submit" tooltip="退出登录">
                <IconLogout className="size-4" />
                <span>退出登录</span>
              </SidebarMenuButton>
            </form>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
