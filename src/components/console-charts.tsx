"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/* ------------------------- 近 7 天：检查 / 线索 / 事件 ------------------------- */
const dailyConfig = {
  runs: { label: "完成检查", color: "var(--chart-1)" },
  leads: { label: "新增线索", color: "var(--chart-3)" },
  events: { label: "行为事件", color: "var(--chart-4)" },
} satisfies ChartConfig;

export function DailyChart({
  data,
}: {
  data: Array<{ day: string; runs: number; leads: number; events: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">最近 7 天：检查、线索与行为事件</CardTitle>
        <CardDescription>
          线索数通常远小于检查数 —— 这条落差就是「钩子够不够强」的直接读数
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={dailyConfig} className="h-56 w-full">
          <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
            <defs>
              {Object.entries(dailyConfig).map(([key, v]) => (
                <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={v.color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={v.color} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
            <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            {Object.keys(dailyConfig).map((key) => (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                fill={`url(#fill-${key})`}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/* --------------------------- 结论分布（严重程度） --------------------------- */
const VERDICT_LABEL: Record<string, string> = {
  critical: "存在严重问题",
  needs_work: "需要改进",
  ok: "通过",
  unknown: "未知",
};
const VERDICT_COLOR: Record<string, string> = {
  critical: "var(--fail)",
  needs_work: "var(--warn)",
  ok: "var(--ok)",
  unknown: "var(--muted-foreground)",
};

export function VerdictChart({ data }: { data: Array<{ verdict: string; n: number }> }) {
  const rows = data.map((d) => ({
    key: d.verdict,
    label: VERDICT_LABEL[d.verdict] ?? d.verdict,
    n: d.n,
    fill: VERDICT_COLOR[d.verdict] ?? "var(--muted-foreground)",
  }));
  const total = rows.reduce((n, r) => n + r.n, 0);

  const config = Object.fromEntries(
    rows.map((r) => [r.key, { label: r.label, color: r.fill }]),
  ) as ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">检查结论分布</CardTitle>
        <CardDescription>
          共 {total} 次检查。严重占比高说明「钩子痛感强」，这是诊断报告能转化的前提
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">还没有检查记录</div>
        ) : (
          <ChartContainer config={config} className="mx-auto h-56 w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
              <Pie data={rows} dataKey="n" nameKey="key" innerRadius={52} outerRadius={82} strokeWidth={2}>
                {rows.map((r) => (
                  <Cell key={r.key} fill={r.fill} />
                ))}
              </Pie>
              <ChartLegend content={<ChartLegendContent nameKey="key" />} />
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------- 按工具对比 ------------------------------- */
const toolConfig = {
  runs: { label: "检查次数", color: "var(--chart-1)" },
  critical: { label: "严重问题", color: "var(--fail)" },
  leads: { label: "带来线索", color: "var(--chart-3)" },
} satisfies ChartConfig;

const TOOL_LABEL: Record<string, string> = {
  crawler: "AI 爬虫检查",
  citability: "内容可引用性",
};

export function ToolChart({
  data,
}: {
  data: Array<{ tool: string; runs: number; critical: number; leads: number }>;
}) {
  const rows = data.map((d) => ({ ...d, tool: TOOL_LABEL[d.tool] ?? d.tool }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">按工具：使用量、严重问题与转化</CardTitle>
        <CardDescription>哪个工具真的有人用，以及它有没有带来线索</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="grid h-56 place-items-center text-sm text-muted-foreground">还没有检查记录</div>
        ) : (
          <ChartContainer config={toolConfig} className="h-56 w-full">
            <BarChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="tool" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} width={28} fontSize={11} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="runs" fill="var(--color-runs)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="critical" fill="var(--color-critical)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="leads" fill="var(--color-leads)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ 关键行为 ------------------------------ */
/**
 * 注意：这四项是「独立计数」，不是嵌套漏斗 —— 一次检查可以产生 0 个或多个线索，
 * 导出与分享也可能发生在检查之后很久。所以这里统一以「完成检查」为分母，
 * 而不是显示"上一步的 X%"（那会算出 150% 这种没有意义的数字）。
 */
export function FunnelChart({ data }: { data: Array<{ stage: string; n: number }> }) {
  const base = data[0]?.n ?? 0;
  const max = Math.max(1, ...data.map((d) => d.n));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">关键行为：从检查到线索</CardTitle>
        <CardDescription>
          四项是独立计数而非嵌套阶段，因此百分比统一以「完成检查」为分母。
          每一层都能回到原始事件记录，不是估算值。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.map((d, i) => {
          const pct = (d.n / max) * 100;
          const shareOfChecks = base > 0 ? Math.round((d.n / base) * 100) : null;
          return (
            <div key={d.stage}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{d.stage}</span>
                <span className="tabular-nums text-muted-foreground">
                  {d.n}
                  {i > 0 && shareOfChecks !== null && (
                    <span className="ml-2 text-xs">完成检查的 {shareOfChecks}%</span>
                  )}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", i === 0 ? "bg-chart-1" : "bg-chart-2")}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
