import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconDatabase,
  IconExternalLink,
  IconListCheck,
  IconRuler2,
  IconTerminal2,
} from "@tabler/icons-react";
import { getToolRunBySlug } from "@/lib/db/repo";
import type { CheckResult } from "@/lib/checks/types";
import { Disclaimer, DimensionTable, FindingList, MetricCard, StatusBadge, Verdict } from "@/components/check-parts";
import { LeadForm, ResultActions } from "@/components/forms";
import { PageView } from "@/components/page-view";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * 结果页是系统里最重要的传播载体：用户分享结果本身就在替我们获客。
 * 但私人结果默认不被索引，只有用户主动公开后才允许 —— 见 generateMetadata。
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const row = getToolRunBySlug(id);
  if (!row) return { title: "检查结果不存在", robots: { index: false, follow: false } };

  const toolName = row.tool === "crawler" ? "AI 爬虫可访问检查" : "内容可引用性检查";
  const isPublic = row.is_public === 1;

  return {
    title: `${toolName}结果 · ${row.share_slug}`,
    description: "基于确定性规则的 AI 可发现性与内容可引用性检查结果。",
    // 默认私有、不被索引；只有用户主动选择公开后才会放开
    robots: isPublic ? { index: true, follow: true } : { index: false, follow: false, nocache: true },
  };
}

interface Dimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  basis: string;
}

interface CrawlerMeta {
  target: string;
  origin: string;
  page: {
    status: number | null;
    finalUrl: string | null;
    contentType: string | null;
    bytes: number | null;
    elapsedMs: number;
    redirects: string[];
  };
  rendering?: { visibleTextChars: number; htmlChars: number; textToHtmlRatio: number; emptyAppContainers: string[] };
  head?: {
    title: string;
    description: string;
    canonical: string;
    metaRobots: string;
    h1Count: number;
    h1Text: string;
    jsonLdBlocks: number;
  };
  robots?: {
    url: string;
    exists: boolean;
    status: number | null;
    groups: number;
    declaredSitemaps: string[];
    verdicts: Array<{
      token: string;
      operator: string;
      purpose: string;
      impactsAiAnswers: boolean;
      allowed: boolean;
      reason: string;
      note: string;
    }>;
  };
  sitemap?: Array<{ url: string; status: number | null; ok: boolean; containsTarget: boolean | null }>;
}

interface CitabilityMeta {
  source: string;
  chars: number;
  words: number;
  overall: number;
  weightsBasis: string;
  dimensions: Dimension[];
  observed: Record<string, unknown>;
}

/** meta 是 Record<string, unknown>，这里按字段形状显式收窄（不用类型谓词，避免接口无索引签名的问题） */
function asCrawlerMeta(m: Record<string, unknown>): CrawlerMeta | null {
  return typeof m.target === "string" ? (m as unknown as CrawlerMeta) : null;
}
function asCitabilityMeta(m: Record<string, unknown>): CitabilityMeta | null {
  return Array.isArray(m.dimensions) ? (m as unknown as CitabilityMeta) : null;
}

export default async function ResultPage({ params }: Props) {
  const { id } = await params;
  const row = getToolRunBySlug(id);
  if (!row) notFound();

  const result = JSON.parse(row.result_json) as CheckResult;
  const rawMeta = result.meta as Record<string, unknown>;
  const toolName = result.tool === "crawler" ? "AI 爬虫可访问检查" : "内容可引用性检查";
  const toolHref = result.tool === "crawler" ? "/tools/ai-crawler-check" : "/tools/citation-readiness";

  const citability = asCitabilityMeta(rawMeta);
  const crawler = asCrawlerMeta(rawMeta);

  const checkedAt = new Date(result.checkedAt).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8">
      <PageView toolRunId={row.id} path={`/r/${row.share_slug}`} />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/">首页</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={toolHref}>{toolName}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>结果</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{toolName}结果</h1>
        {row.is_public === 1 ? (
          <Badge variant="outline" className="text-muted-foreground">
            已公开
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            私有 · 未被搜索引擎索引
          </Badge>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <IconExternalLink className="size-3.5" />
          {result.url ? <span className="font-mono text-xs break-all">{result.url}</span> : `粘贴的正文（${String(citability?.chars ?? "—")} 字符）`}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconClock className="size-3.5" />
          {checkedAt} (UTC+8)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconTerminal2 className="size-3.5" />
          规则版本 <span className="font-mono text-xs">{result.version}</span>
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        数据来源：公开可抓取的页面与 robots.txt，确定性规则判定（<strong>无 AI 调用</strong>）
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Verdict result={result} />
        <ResultActions slug={row.share_slug} isPublic={row.is_public === 1} />
      </div>

      {/* ================= 指标条 ================= */}
      {citability && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="加权总分" value={`${citability.overall} / 100`} sub="由下列分项加权得出" icon={IconRuler2} />
          <MetricCard
            label="正文规模"
            value={citability.chars.toLocaleString("en-US")}
            sub={`字符 · 约 ${citability.words.toLocaleString("en-US")} 词`}
            icon={IconDatabase}
          />
          <MetricCard label="分项数" value={citability.dimensions.length} sub="每一项都可单独复核" icon={IconListCheck} />
          <MetricCard label="严重问题" value={result.summary.fail} sub="优先修复这些" icon={IconCircleX} />
        </div>
      )}

      {crawler && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="HTTP 状态码"
            value={crawler.page.status ?? "无响应"}
            sub={crawler.page.contentType ?? "—"}
            icon={IconExternalLink}
          />
          <MetricCard
            label="响应体"
            value={crawler.page.bytes !== null ? `${(crawler.page.bytes / 1024).toFixed(1)} KB` : "—"}
            sub={`耗时 ${crawler.page.elapsedMs}ms`}
            icon={IconDatabase}
          />
          <MetricCard label="重定向" value={crawler.page.redirects.length} sub="跳转次数" icon={IconExternalLink} />
          <MetricCard
            label="正文字符数"
            value={crawler.rendering ? crawler.rendering.visibleTextChars.toLocaleString("en-US") : "—"}
            sub={crawler.rendering ? `文本/HTML 比 ${crawler.rendering.textToHtmlRatio}` : "—"}
            icon={IconRuler2}
          />
        </div>
      )}

      {/* ================= 主内容分栏 ================= */}
      <Tabs defaultValue="findings" className="mt-8">
        <TabsList>
          <TabsTrigger value="findings">
            <IconListCheck className="size-3.5" />
            逐条结论（{result.findings.length}）
          </TabsTrigger>
          {citability && (
            <TabsTrigger value="dimensions">
              <IconRuler2 className="size-3.5" />
              分项与计算方式
            </TabsTrigger>
          )}
          {crawler && (
            <TabsTrigger value="observation">
              <IconDatabase className="size-3.5" />
              原始观测
            </TabsTrigger>
          )}
          <TabsTrigger value="raw">
            <IconTerminal2 className="size-3.5" />
            原始数据
          </TabsTrigger>
        </TabsList>

        {/* ---------- 逐条结论 ---------- */}
        <TabsContent value="findings" className="mt-5">
          <p className="mb-3 text-xs text-muted-foreground">
            按严重程度排序；严重问题与待改进项默认展开，通过项默认收起。
          </p>
          <FindingList findings={result.findings} />
        </TabsContent>

        {/* ---------- 分项与计算方式 ---------- */}
        {citability && (
          <TabsContent value="dimensions" className="mt-5">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="text-base">总分是怎么算出来的</CardTitle>
                <CardDescription>{citability.weightsBasis}</CardDescription>
              </CardHeader>
            </Card>
            <DimensionTable dimensions={citability.dimensions} />
          </TabsContent>
        )}

        {/* ---------- 原始观测 ---------- */}
        {crawler && (
          <TabsContent value="observation" className="mt-5">
            <div className="flex flex-col gap-4">
              {crawler.head && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">页面头部观测</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell className="w-40 align-top font-medium">标题</TableCell>
                          <TableCell className="align-top">
                            {crawler.head.title || <span className="text-muted-foreground">（缺失）</span>}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="align-top font-medium">描述</TableCell>
                          <TableCell className="align-top">
                            {crawler.head.description || <span className="text-muted-foreground">（缺失）</span>}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="align-top font-medium">canonical</TableCell>
                          <TableCell className="align-top font-mono text-xs">
                            {crawler.head.canonical || "（缺失）"}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="align-top font-medium">meta robots</TableCell>
                          <TableCell className="align-top font-mono text-xs">
                            {crawler.head.metaRobots || "（未设置）"}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="align-top font-medium">H1 / JSON-LD</TableCell>
                          <TableCell className="align-top">
                            H1 {crawler.head.h1Count} 个 · JSON-LD {crawler.head.jsonLdBlocks} 块
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {crawler.robots && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">AI 爬虫放行情况</CardTitle>
                    <CardDescription>
                      robots.txt：<span className="font-mono text-xs">{crawler.robots.url}</span>（
                      {crawler.robots.exists
                        ? `HTTP ${crawler.robots.status}，解析出 ${crawler.robots.groups} 个规则组`
                        : "未取得"}
                      ）
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">User-agent</TableHead>
                          <TableHead>运营方</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead className="pr-6">判定依据</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {crawler.robots.verdicts.map((v) => (
                          <TableRow key={v.token}>
                            <TableCell className="pl-6 font-mono text-xs">{v.token}</TableCell>
                            <TableCell>{v.operator}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {v.purpose}
                              {v.impactsAiAnswers && (
                                <Badge variant="outline" className="ml-1.5 border-fail/25 bg-fail-soft text-fail">
                                  影响可见性
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {v.allowed ? (
                                <StatusBadge status="pass" short />
                              ) : v.impactsAiAnswers ? (
                                <StatusBadge status="fail" short />
                              ) : (
                                <StatusBadge status="info" short />
                              )}
                            </TableCell>
                            <TableCell className="pr-6 text-xs text-muted-foreground">{v.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {crawler.sitemap && crawler.sitemap.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">sitemap 观测</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>地址</TableHead>
                          <TableHead className="w-24">状态</TableHead>
                          <TableHead className="w-40">是否包含当前页面</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {crawler.sitemap.map((s) => (
                          <TableRow key={s.url}>
                            <TableCell className="font-mono text-xs break-all">{s.url}</TableCell>
                            <TableCell>{s.status ?? "无响应"}</TableCell>
                            <TableCell>
                              {s.containsTarget === null ? "无法判断" : s.containsTarget ? "包含" : "未包含"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        )}

        {/* ---------- 原始数据 ---------- */}
        <TabsContent value="raw" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">原始观测值</CardTitle>
              <CardDescription>
                用于独立复核。也可以在结果页顶部导出完整 JSON。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-125 overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-xs leading-relaxed">
                {JSON.stringify(citability?.observed ?? rawMeta, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-8 flex flex-col gap-4">
        <Disclaimer text={result.disclaimer} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <IconCircleCheck className="size-4 text-primary" />
              修复的推荐顺序
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex list-decimal flex-col gap-2.5 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">立即修</strong>：所有标记为「严重问题」的项。
                它们会一票否决，其他优化在修好之前基本无效。
              </li>
              <li>
                <strong className="text-foreground">本周处理</strong>：所有「需要改进」中工作量小的项
                （canonical、meta description、H2 层级、FAQ 区块）。
              </li>
              <li>
                <strong className="text-foreground">后续观察</strong>：需要持续产出的项
                （事实密度、来源建设、作者与更新机制）。
              </li>
            </ol>
            <Separator className="my-4" />
            <p className="text-xs text-muted-foreground">
              修完后建议用完全相同的输入重新检查一次，两份结果对比即可看出改动是否生效。
            </p>
          </CardContent>
        </Card>

        <LeadForm source={`result:${result.tool}`} toolRunId={row.id} />
      </div>
    </div>
  );
}
