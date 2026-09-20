import type { Metadata } from "next";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.baseUrl),
  title: {
    default: `${site.name} · ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description:
    "免费检查网站能否被 AI 搜索系统抓取与引用：robots.txt 对 AI 爬虫的放行情况、内容结构是否具备被摘录条件。基于可复核的确定性规则，不承诺 AI 推荐结果。",
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name} · ${site.tagline}`,
    description: "免费、可复核的 AI 可发现性与内容可引用性检查。",
    url: site.baseUrl,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <TooltipProvider delayDuration={200}>
          <SiteHeader />
          <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
          <SiteFooter />
          <Toaster position="top-center" richColors />
        </TooltipProvider>
      </body>
    </html>
  );
}
