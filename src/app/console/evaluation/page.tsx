import Link from "next/link";
import { IconChartDots, IconPlayerPlay, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { evaluateRun } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "评估与指标", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

const METRIC_LABEL: Record<string, string> = {
  mention_rate: "品牌提及率",
  top1_rate: "首推率",
  sov: "Share of Voice",
  owned_citation_rate: "自有域引用率",
};

const METRIC_HINT: Record<string, string> = {
  mention_rate: "在多少比例的提问里，AI 提到了目标品牌",
  top1_rate: "在被列为可选方案时，目标品牌排在第一位的比例",
  sov: "目标品牌提及次数 ÷ 全部被跟踪实体提及次数",
  owned_citation_rate: "引用了你自己的域名（而非第三方）的样本比例",
};

/**
 * 模块 5：评估与指标。
 *
 * 三类约束贯穿此页：
 *  1. 每个指标都展示分子/分母与计算口径 —— 不允许出现无法解释的数字；
 *  2. 分母为 0 时显示「无法计算」而不是 0 —— 0 会被误读成"表现差"；
 *  3. 事实一致性一律进人工复核 —— 启发式判断不能直接当事实展示。
 */
export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run: runParam } = await searchParams;
  const runs = R.listSamplingRuns();
  const selected = runParam ? runs.find((r) => r.id === runParam) : runs[0];
  const snapshots = R.listMetricSnapshots(selected?.id);
  const pendingReviews = R.countPendingReviews();
  const brands = R.listBrands();
  const approvedClaims = R.getApprovedClaims();

  // 每个指标只显示最新一次快照
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) {
    if (!latest.has(s.metric)) latest.set(s.metric, s);
  }
  const summary = (snapshots[0] ? JSON.parse(snapshots[0].dimension_json) : {}) as { sampleCount?: number };

  const samples = selected ? R.listSamples(selected.id) : [];
  const evals = R.listEvaluations(samples.map((s) => s.id));
  const mentionCount = new Map<string, number>();
  const citeCount = new Map<string, number>();
  for (const e of evals) {
    const arr = JSON.parse(e.result_json) as unknown[];
    if (e.evaluator === "mentions") mentionCount.set(e.sample_id, arr.length);
    if (e.evaluator === "citations") citeCount.set(e.sample_id, arr.length);
  }
  const factEvals = evals.filter((e) => e.evaluator === "facts");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconChartDots}
        title="评估与指标"
        description="把原始回答转成可追溯的指标。每个数字都带分子、分母与计算口径；无法计算时显示「无法计算」而不是 0。"
        badge={
          pendingReviews > 0 ? (
            <Badge variant="outline" className="border-warn/25 bg-warn-soft font-normal text-warn">
              待复核 {pendingReviews}
            </Badge>
          ) : undefined
        }
      />

      {brands.length === 0 && (
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="text-sm">需要先建立品牌与竞品</CardTitle>
            <CardDescription>
              评估需要知道「哪些名字算提到了我们」。请先到{" "}
              <Link href="/console/brands" className="font-medium text-primary underline-offset-4 hover:underline">
                品牌与竞品
              </Link>{" "}
              建立品牌实体与别名。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* —— 运行评估 —— */}
      <SectionCard
        title="运行评估"
        description="对选定批次的所有样本重算：提及、引用、事实一致性，并生成指标快照。重复运行会覆盖同一评估器的旧结果，不会重复累加。"
      >
        <form action={evaluateRun} className="flex flex-wrap items-end gap-3">
          <Field label="采样批次">
            <select name="runId" className={SELECT_CLS} style={{ width: "20rem" }} disabled={runs.length === 0}>
              <option value="">全部样本（最近 200 条）</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}（{r.sample_count} 条样本）
                </option>
              ))}
            </select>
          </Field>
          <Field label="目标品牌">
            <select name="brandId" className={SELECT_CLS} style={{ width: "16rem" }} disabled={brands.length === 0}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" size="sm" disabled={brands.length === 0}>
            <IconPlayerPlay className="size-3.5" />
            运行评估
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          当前参与比对的事实条目（已批准）：
          <span className="ml-1 font-medium text-foreground">{approvedClaims.length}</span> 条
          {approvedClaims.length === 0 && (
            <span className="ml-1">
              —— 没有已批准事实，事实一致性环节不会产出结论。到{" "}
              <Link href="/console/claims" className="text-primary underline-offset-4 hover:underline">
                事实与证据
              </Link>{" "}
              批准至少一条。
            </span>
          )}
        </p>
      </SectionCard>

      {/* —— 指标卡片 —— */}
      <SectionCard
        title="核心指标"
        description={
          selected
            ? `批次：${selected.label}`
            : "选择批次后展示。不同采样方式（人工界面 / 官方 API）的样本不会被合并统计。"
        }
        action={
          summary.sampleCount ? (
            <span className="text-xs text-muted-foreground">基于 {summary.sampleCount} 个样本</span>
          ) : undefined
        }
      >
        {latest.size === 0 ? (
          <EmptyState>
            还没有指标快照。
            <br />
            <span className="text-xs">
              先在{" "}
              <Link href="/console/sampling" className="text-primary underline-offset-4 hover:underline">
                多平台采样
              </Link>{" "}
              录入回答，再点上方「运行评估」。
            </span>
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...latest.entries()].map(([metric, snap]) => {
              const dim = JSON.parse(snap.dimension_json) as { basis?: string };
              return (
                <Card key={metric} className="gap-1 py-4">
                  <CardContent className="px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{METRIC_LABEL[metric] ?? metric}</span>
                      <span
                        className="text-muted-foreground"
                        title={METRIC_HINT[metric]}
                        aria-label={METRIC_HINT[metric]}
                      >
                        <IconInfoCircle className="size-3.5" />
                      </span>
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tracking-tight tabular-nums">
                        {(snap.value * 100).toFixed(1)}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {snap.numerator} / {snap.denominator}
                      </span>
                    </div>
                    <Progress value={snap.value * 100} className="mt-2 h-1.5" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">计算口径：</span>
                      {dim.basis ?? "—"}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* —— 未产出的指标 —— */}
      {latest.size > 0 && latest.size < 4 && (
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconAlertTriangle className="size-4 text-warn" />
              有 {4 - latest.size} 个指标无法计算
            </CardTitle>
            <CardDescription>
              这通常不是"表现差"，而是数据不足。常见原因：
              回答不是列表形式（首推率无从判断）、回答里没有可识别的引用来源（引用率无从计算）。
              系统刻意不把这些显示成 0 —— 那会被误读。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* —— 事实一致性 —— */}
      {factEvals.length > 0 && (
        <SectionCard
          title="事实一致性"
          description="与事实库比对的结果。判定基于数值匹配的启发式算法，因此一律标记为待人工复核，不作为结论直接展示。"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">样本</TableHead>
                  <TableHead className="w-24">结论</TableHead>
                  <TableHead className="w-24">置信度</TableHead>
                  <TableHead>依据</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factEvals.slice(0, 20).map((e) => {
                  const facts = JSON.parse(e.result_json) as Array<{
                    claimKey: string;
                    verdict: string;
                    evidence: string;
                    confidence: number;
                  }>;
                  const worst = facts.find((f) => f.verdict === "conflict") ?? facts[0];
                  return (
                    <TableRow key={e.sample_id}>
                      <TableCell className="font-mono text-xs">{e.sample_id.slice(-8)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            worst?.verdict === "conflict"
                              ? "border-fail/25 bg-fail-soft font-normal text-fail"
                              : worst?.verdict === "consistent"
                                ? "border-ok/25 bg-ok-soft font-normal text-ok"
                                : "font-normal text-muted-foreground"
                          }
                        >
                          {worst?.verdict === "conflict"
                            ? "疑似冲突"
                            : worst?.verdict === "consistent"
                              ? "一致"
                              : "无法判断"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">
                        {e.confidence.toFixed(2)}
                      </TableCell>
                      <TableCell className="max-w-lg text-xs text-muted-foreground">
                        <span className="font-mono">{worst?.claimKey}</span>：{worst?.evidence}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}

      {/* —— 样本级明细 —— */}
      {samples.length > 0 && (
        <SectionCard title={`样本明细（${samples.length}）`} description="每个指标都能追溯到这一层，再往下就是原始回答原文。">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">引擎</TableHead>
                  <TableHead>问题</TableHead>
                  <TableHead className="w-20 text-right">提及</TableHead>
                  <TableHead className="w-20 text-right">引用</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {samples.slice(0, 30).map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm font-medium">{s.engine}</TableCell>
                    <TableCell className="max-w-96">
                      <div className="truncate text-sm">{s.question_text ?? "（问题已删除）"}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {mentionCount.get(s.id) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{citeCount.get(s.id) ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
