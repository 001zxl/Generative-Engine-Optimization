import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowRight, IconCircleX, IconAlertTriangle, IconCircleCheck, IconInfoCircle } from "@tabler/icons-react";
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
import {
  AI_BOTS,
  PURPOSE_LABEL,
  EVIDENCE_LABEL,
  EVIDENCE_HINT,
  PHANTOM_BOTS,
  CHINA_AI_MECHANISM,
  ROSTER_UPDATED_AT,
  ROSTER_REVIEW_CYCLE,
  type BotEvidence,
} from "@/lib/checks/bots";
import { abs } from "@/lib/site";

export const metadata: Metadata = {
  title: "AI 爬虫可访问检查（免费）",
  description:
    "检查网站的 robots.txt 是否屏蔽了决定「AI 能否引用你」的检索型爬虫，以及页面能否被抓取、正文是否依赖 JavaScript 渲染、canonical 与 sitemap 是否就位。覆盖 ChatGPT、Perplexity、Claude、Google、以及国内平台的搜索索引爬虫。",
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
    "检查 robots.txt 对已知 AI 爬虫的放行情况，以及页面可抓取性、正文可提取性、canonical、结构化数据与 sitemap 收录。每条判定标注证据等级。",
};

const CHECK_ITEMS = [
  {
    name: "检索型 AI 爬虫放行情况",
    why: "被屏蔽 = 从 AI 的可引用来源中消失。这是唯一会「一票否决」的项。",
  },
  {
    name: "训练型爬虫状态",
    why: "单独列出并说明它不影响 AI 答案可见性 —— 避免为「不贡献训练语料」而误伤检索爬虫。",
  },
  {
    name: "国内平台检索通道",
    why: "国产 AI 助手多复用母公司搜索索引。列出百度 / 搜狗 / 神马系爬虫的实际状态与机制对应关系。",
  },
  {
    name: "「查无实证」的 token",
    why: "识别 robots.txt 里那些没有官方或实测证据的爬虫名（如 Doubao）——屏蔽它们只是虚假的安心感。",
  },
  { name: "页面可抓取性", why: "状态码、内容类型、重定向链、耗时、响应体大小。" },
  { name: "正文可提取性", why: "正文是否直接出现在 HTML 里，还是靠 JavaScript 渲染后才出现。" },
  { name: "canonical / noindex", why: "入口分散会摊薄权重；noindex 则直接排除在索引之外。" },
  { name: "结构化数据与 sitemap", why: "减少实体歧义、加快页面被发现的速度。" },
];

const EVIDENCE_STYLE: Record<BotEvidence, string> = {
  vendor: "border-ok/25 bg-ok-soft text-ok",
  observed: "border-primary/25 bg-brand-soft text-primary",
  reported: "border-border bg-muted text-muted-foreground",
};

function EvidenceBadge({ level }: { level: BotEvidence }) {
  return (
    <Badge variant="outline" className={`font-normal ${EVIDENCE_STYLE[level]}`} title={EVIDENCE_HINT[level]}>
      {EVIDENCE_LABEL[level]}
    </Badge>
  );
}

function BotTable({ bots, title, desc }: { bots: typeof AI_BOTS; title: string; desc: string }) {
  return (
    <>
      <h3 className="mt-8 text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
      <Card className="mt-3 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User-agent</TableHead>
              <TableHead>运营方</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="w-28">证据等级</TableHead>
              <TableHead className="w-36">影响 AI 答案可见性</TableHead>
              <TableHead>该索引还服务于</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bots.map((b) => (
              <TableRow key={b.token}>
                <TableCell className="font-mono text-xs">
                  {b.token}
                  {b.aggressive && (
                    <Badge variant="outline" className="ml-1.5 border-warn/25 bg-warn-soft text-warn">
                      激进
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm">{b.operator}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{PURPOSE_LABEL[b.purpose]}</TableCell>
                <TableCell>
                  <EvidenceBadge level={b.evidence} />
                </TableCell>
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
                <TableCell className="text-xs text-muted-foreground">
                  {b.alsoPowers?.length ? b.alsoPowers.join("、") : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export default function Page() {
  const globalBots = AI_BOTS.filter((b) => b.region === "global");
  const cnBots = AI_BOTS.filter((b) => b.region === "cn");
  const critical = AI_BOTS.filter((b) => b.impactsAiAnswers && b.evidence !== "reported");
  const reported = AI_BOTS.filter((b) => b.evidence === "reported");

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
        免费工具 · 抓取与索引层
      </Badge>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">AI 爬虫可访问检查</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        一个页面能不能出现在 AI 答案里，第一步取决于<strong className="text-foreground">检索型爬虫能不能取到它</strong>。
        这个检查会逐条给出证据，并标注每条判定的证据等级。
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

      {/* ================= 国内平台机制 ================= */}
      <h2 className="mt-14 text-xl font-semibold tracking-tight">为什么找不到「豆包爬虫」</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        这是国内 GEO 里最常见的误解。多数国产 AI 助手<strong className="text-foreground">不自己抓网页</strong>，
        而是复用母公司的搜索索引 —— 所以「豆包爬虫」「Kimi 爬虫」这类以 AI 产品命名的爬虫，
        在服务器日志与实测 agent 库里都不存在。真正决定你在这些平台问答里能否被引用的，
        是它们背后那套搜索索引的抓取条件。
      </p>

      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-56">AI 产品</TableHead>
              <TableHead className="w-52">真正的杠杆点</TableHead>
              <TableHead>机制</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CHINA_AI_MECHANISM.map((m) => (
              <TableRow key={m.product}>
                <TableCell className="align-top font-medium">{m.product}</TableCell>
                <TableCell className="align-top font-mono text-xs text-primary">{m.lever}</TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">{m.detail}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* ================= 假 token ================= */}
      <h2 className="mt-12 text-xl font-semibold tracking-tight">常见的「查无实证」token</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        下面这些名字被大量写进 robots.txt 模板，但我们<strong className="text-foreground">没有找到官方文档或实测证据</strong>
        表明它们真实存在。屏蔽它们不会有任何效果，却会让人以为「AI 抓取问题已经处理过了」。
      </p>
      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">token</TableHead>
              <TableHead className="w-40">本该属于</TableHead>
              <TableHead>实际情况</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PHANTOM_BOTS.map((p) => (
              <TableRow key={p.token}>
                <TableCell className="align-top font-mono text-xs">{p.token}</TableCell>
                <TableCell className="align-top text-sm">{p.wouldBe}</TableCell>
                <TableCell className="align-top text-sm text-muted-foreground">{p.reality}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* ================= 名册 ================= */}
      <h2 className="mt-14 text-xl font-semibold tracking-tight">被检查的 AI 爬虫（{AI_BOTS.length} 个）</h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        每条都标注<strong className="text-foreground">证据等级</strong>：
        <span className="ml-1">
          {(["vendor", "observed", "reported"] as BotEvidence[]).map((e) => (
            <span key={e} className="mr-3 inline-flex items-center gap-1.5 whitespace-nowrap">
              <EvidenceBadge level={e} />
              <span className="text-xs">{EVIDENCE_HINT[e]}</span>
            </span>
          ))}
        </span>
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <IconInfoCircle className="mr-1 inline size-3.5" />
          名册最后核对：<span className="font-mono">{ROSTER_UPDATED_AT}</span> · {ROSTER_REVIEW_CYCLE}
        </span>
        <span>
          证据等级为「社区清单」的条目<strong className="text-foreground">不参与严重级别判定</strong>
          —— 我们不会因为一个未经证实的 token 说你的网站有严重问题。
        </span>
      </p>

      <BotTable
        bots={globalBots}
        title={`全球平台（${globalBots.length} 个）`}
        desc="决定你在 ChatGPT、Perplexity、Claude、Google AI Overviews、Copilot 等平台能否被引用。"
      />
      <BotTable
        bots={cnBots}
        title={`中国平台（${cnBots.length} 个）`}
        desc="国内 AI 助手多复用母公司搜索索引，这一组才是国内可见性的实际杠杆点。"
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Card className="border-fail/25 bg-fail-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconCircleX className="size-4 text-fail" />
              屏蔽即失去 AI 引用（{critical.length} 个）
            </CardTitle>
            <CardDescription className="font-mono text-xs break-words">
              {critical.map((b) => b.token).join(" · ")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconAlertTriangle className="size-4 text-warn" />
              屏蔽不影响 AI 答案（{AI_BOTS.filter((b) => !b.impactsAiAnswers && b.evidence !== "reported").length} 个）
            </CardTitle>
            <CardDescription className="font-mono text-xs break-words">
              {AI_BOTS.filter((b) => !b.impactsAiAnswers && b.evidence !== "reported")
                .map((b) => b.token)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconInfoCircle className="size-4 text-muted-foreground" />
              证据不足、仅供参考（{reported.length} 个）
            </CardTitle>
            <CardDescription className="font-mono text-xs break-words">
              {reported.map((b) => b.token).join(" · ")}
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

# 国内平台：这些搜索索引才是豆包 / 元宝 / 夸克背后的实际通道
User-agent: Baiduspider
Allow: /
User-agent: Baiduspider-render
Allow: /
User-agent: Sogou web spider
Allow: /
User-agent: YisouSpider
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
