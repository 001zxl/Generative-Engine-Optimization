import Link from "next/link";
import {
  IconActivity,
  IconUsers,
  IconHistory,
  IconShare3,
  IconClockExclamation,
} from "@tabler/icons-react";
import { consoleStats } from "@/lib/db/repo";
import { MetricCard, EmptyState } from "@/components/check-parts";
import { DailyChart, FunnelChart, ToolChart, VerdictChart } from "@/components/console-charts";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 运营台首页只回答五个问题（呈现规范要求）：
 *  1. 品牌目前在哪些问题中出现？        → 批次2（需要采样与评估模块）
 *  2. 哪些竞品比品牌出现得更多？        → 批次2
 *  3. AI 主要引用哪些来源？             → 批次2
 *  4. 接下来最值得生产和推广什么内容？   → 批次2
 *  5. 这些内容有没有带来访问和咨询？     → 批次1 已有
 *
 * 批次1 先把第 5 问做扎实，其余显式标注为待建 —— 不放占位图表。
 */
export default function ConsoleHome() {
  const s = consoleStats();

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">可见度总览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          默认工作区 · 统计截止{" "}
          {new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })} (UTC+8)
        </p>
      </div>

      {/* ---------- 顶部指标 ---------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="工具使用（7 天）" value={s.runs7d} sub={`累计 ${s.runsTotal} 次检查`} icon={IconHistory} />
        <MetricCard label="新增线索（7 天）" value={s.leads7d} sub={`累计 ${s.leadsTotal} 条`} icon={IconUsers} />
        <MetricCard label="待跟进线索" value={s.leadsNew} sub="状态为 new" icon={IconClockExclamation} />
        <MetricCard label="行为事件（7 天）" value={s.events7d} sub="访问 / 运行 / 分享 / 导出" icon={IconActivity} />
        <MetricCard label="被公开的结果页" value={s.publicRuns} sub="用户主动选择公开" icon={IconShare3} />
      </div>

      {s.runsTotal === 0 && (
        <EmptyState>
          还没有任何检查记录。
          <br />
          <span className="text-xs">
            去{" "}
            <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
              公开站
            </Link>{" "}
            跑一次检查，这里就会有数据。
          </span>
        </EmptyState>
      )}

      {/* ---------- 主图：第 5 问 ---------- */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
            已上线
          </Badge>
          <h2 className="text-base font-semibold">5. 这些内容有没有带来访问和咨询？</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DailyChart data={s.daily} />
          </div>
          <VerdictChart data={s.byVerdict} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ToolChart data={s.byTool} />
        <FunnelChart data={s.funnel} />
      </div>

      {/* ---------- 来路与来源 ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">检查请求的来路（referrer）</CardTitle>
            <CardDescription>判断免费工具是被搜索、社交还是直接分享带进来的</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {s.byReferrer.length === 0 ? (
              <p className="px-6 pb-2 text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">来源</TableHead>
                    <TableHead className="pr-6 text-right">次数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.byReferrer.map((r) => (
                    <TableRow key={r.referrer}>
                      <TableCell className="pl-6 font-mono text-xs break-all">{r.referrer}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{r.n}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">线索来源标注</CardTitle>
            <CardDescription>「result:工具名」表示该线索来自查看检查结果页时提交</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {s.topSources.length === 0 ? (
              <p className="px-6 pb-2 text-sm text-muted-foreground">
                暂无数据。线索列表见{" "}
                <Link href="/console/leads" className="font-medium text-primary underline-offset-4 hover:underline">
                  线索
                </Link>
                。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">来源</TableHead>
                    <TableHead className="pr-6 text-right">线索数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.topSources.map((r) => (
                    <TableRow key={r.source}>
                      <TableCell className="pl-6">{r.source}</TableCell>
                      <TableCell className="pr-6 text-right tabular-nums">{r.n}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------- 待建 ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">待建模块（批次 2：采样与评估）</CardTitle>
          <CardDescription>
            下面四项需要「品牌 / 问题库 / 事实库 / 多平台采样」支撑。模块尚未实现，因此这里
            <strong className="text-foreground">不放占位图表</strong>
            —— 空图表比没有图表更容易误导决策。
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-2/5 pl-6">运营台首页要回答的问题</TableHead>
                <TableHead>依赖</TableHead>
                <TableHead className="pr-6">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["1. 品牌目前在哪些问题中出现？", "问题库 + 多平台采样 + 提及抽取"],
                ["2. 哪些竞品比品牌出现得更多？", "竞品库 + Share of Voice 计算"],
                ["3. AI 主要引用哪些来源？", "引用抽取 + 域名归类"],
                ["4. 接下来最值得生产和推广什么内容？", "机会分算法（架构文档 §12.3）"],
              ].map(([q, dep]) => (
                <TableRow key={q}>
                  <TableCell className="pl-6 font-medium">{q}</TableCell>
                  <TableCell className="text-muted-foreground">{dep}</TableCell>
                  <TableCell className="pr-6">
                    <Badge variant="secondary" className="font-normal">
                      批次 2
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="pl-6 font-medium">5. 这些内容有没有带来访问和咨询？</TableCell>
                <TableCell className="text-muted-foreground">工具使用 + 事件 + 线索归因</TableCell>
                <TableCell className="pr-6">
                  <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
                    已上线
                  </Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {s.runsTotal === 0 && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground">
            提示：批次 1 的数据全部来自公开站的免费工具。在接入真实域名之前，建议先手动跑 10
            家目标工厂的检查，观察严重问题的占比 —— 这直接决定诊断报告的说服力。
          </p>
        </>
      )}
    </>
  );
}
