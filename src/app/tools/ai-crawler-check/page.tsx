import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight, IconCircleX, IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { CrawlCheckForm } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AI_BOTS, PURPOSE_LABEL } from "@/lib/checks/bots";
import { abs } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI 爬虫可访问检查（免费）",
  description:
    "检查网站的 robots.txt 是否屏蔽了决定「AI 能否引用你」的检索型爬虫，以及页面能否被抓取、正文是否依赖 JavaScript 渲染、canonical 与 sitemap 是否就位。",
  alternates: { canonical: abs("/tools/ai-crawler-check") },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "AI 爬虫可访问检查",
  applicationCategory: "SEO Tool",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  description:
    "检查 robots.txt 对已知 AI 爬虫的放行情况，以及页面可抓取性、正文可提取性、canonical、结构化数据与 sitemap 收录。",
};

const CHECK_ITEMS = [
  { name: "检索型 AI 爬虫放行情况", why: "被屏蔽 = 从 AI 的可引用来源中消失。这是唯一会「一票否决」的项。", tone: "fail" as const },
  {
    name: "训练型爬虫状态",
    why: "单独列出并说明它不影响 AI 答案可见性 —— 避免为「不贡献训练语料」而误伤检索爬虫。",
    tone: "info" as const,
  },
  { name: "页面可抓取性", why: "状态码、内容类型、重定向链、耗时、响应体大小。", tone: "muted" as const },
  { name: "正文可提取性", why: "正文是否直接出现在 HTML 里，还是靠 JavaScript 渲染后才出现。", tone: "muted" as const },
  { name: "canonical / noindex", why: "入口分散会摊薄权重；noindex 则直接排除在索引之外。", tone: "muted" as const },
  { name: "结构化数据与 sitemap", why: "减少实体歧义、加快页面被发现的速度。", tone: "muted" as const },
];

export default function Page() {
  const searchBots = AI_BOTS.filter((b) => b.impactsAiAnswers);
  const trainBots = AI_BOTS.filter((b) => !b.impactsAiAnswers);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
        免费工具 · 抓取与索引层
      </Badge>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">AI 爬虫可访问检查</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        一个页面能不能出现在 AI 答案里，第一步取决于<strong className="text-foreground">检索型爬虫能不能取到它</strong>。
        这个检查会逐条给出证据。
      </p>

      <div className="mt-7">
        <CrawlCheckForm />
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">检查项</h2>
      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-64">检查项</TableHead>
              <TableHead>为什么重要</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CHECK_ITEMS.map((c) => (
              <TableRow key={c.name}>
                <TableCell className="align-top font-medium">{c.name}</TableCell>
                <TableCell className="align-top text-muted-foreground">{c.why}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">
        被检查的 AI 爬虫（{AI_BOTS.length} 个）
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        区分「训练」与「检索」是这份检查里最容易被忽略、但对决策影响最大的一件事。
      </p>

      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User-agent</TableHead>
              <TableHead>运营方</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="w-40">影响 AI 答案可见性</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {AI_BOTS.map((b) => (
              <TableRow key={b.token}>
                <TableCell className="font-mono text-xs">{b.token}</TableCell>
                <TableCell>{b.operator}</TableCell>
                <TableCell className="text-muted-foreground">{PURPOSE_LABEL[b.purpose]}</TableCell>
                <TableCell>
                  {b.impactsAiAnswers ? (
                    <Badge variant="outline" className="border-fail/25 bg-fail-soft text-fail">
                      <IconCircleX className="size-3.5" />
                      会影响
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      <IconCircleCheck className="size-3.5" />
                      不影响
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card className="border-fail/25 bg-fail-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconCircleX className="size-4 text-fail" />
              屏蔽后会影响 AI 答案可见性（{searchBots.length} 个）
            </CardTitle>
            <CardDescription className="font-mono text-xs break-words">
              {searchBots.map((b) => b.token).join(" · ")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconAlertTriangle className="size-4 text-warn" />
              屏蔽后不影响 AI 答案可见性（{trainBots.length} 个）
            </CardTitle>
            <CardDescription className="font-mono text-xs break-words">
              {trainBots.map((b) => b.token).join(" · ")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">「只拒绝训练、保留检索」的正确写法</CardTitle>
          <CardDescription>
            如果你不希望内容被用于模型训练，但希望仍然能被 AI 检索引用 —— 这两件事可以分开处理：
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto rounded-lg bg-foreground p-4 font-mono text-xs leading-relaxed text-background">
            {`# 拒绝训练用途
User-agent: GPTBot
Disallow: /
User-agent: Google-Extended
Disallow: /
User-agent: CCBot
Disallow: /

# 放行检索 / 索引用途（决定 AI 答案里能否引用到你）
User-agent: OAI-SearchBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Claude-SearchBot
Allow: /

Sitemap: ${abs("/sitemap.xml")}`}
          </pre>
        </CardContent>
      </Card>

      <Separator className="my-10" />

      <Link
        href="/tools/citation-readiness"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        下一步：检查内容是否具备被引用的条件
        <IconArrowRight className="size-4" />
      </Link>
    </div>
  );
}
