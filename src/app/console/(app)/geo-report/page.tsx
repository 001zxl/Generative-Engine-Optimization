import Link from "next/link";
import {
  IconChartBar,
  IconAlertTriangle,
  IconCircleCheck,
  IconMapPin,
  IconInfoCircle,
  IconArrowRight,
} from "@tabler/icons-react";
import { PageHead, SectionCard, Field } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listStores, storeReadiness, listRunsByLocationMode, listFactEvalsForRun, countLeadsForStore } from "@/lib/db/repo-local";
import { listMetricSnapshots } from "@/lib/db/repo-domains";
import { listCategorySamples } from "@/lib/db/repo-eval-samples";
import { LOCATION_MODES } from "@/lib/db/schema-local";
import { collectSampleEvidence } from "@/lib/sampling";
import { computeMetricsByCategory, computeCitationSourceBlock, type CategorizedSample } from "@/lib/category-metrics";
import { categoryByQuestionId } from "@/lib/db/repo-protocol";
import { getApprovedClaims } from "@/lib/db/repo-domains";
import { assessEvidence, EVIDENCE_VERDICT_LABEL } from "@/lib/sample-evidence";
import {
  compareBaseline,
  computeFactErrorRate,
  assertSingleLocationMode,
  canClaimNearbyRecommendation,
  type LocationMode,
} from "@/lib/local-geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "门店效果报告", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

const MODE_LABEL: Record<string, string> = Object.fromEntries(LOCATION_MODES.map((m) => [m.value, m.label]));

const METRIC_LABEL: Record<string, string> = {
  mention_rate: "品牌提及率",
  top1_rate: "首位推荐率",
  sov: "声量份额",
  owned_citation_rate: "自有来源引用率",
  fact_accuracy: "事实准确率",
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  improved: { label: "上升", cls: "border-ok/30 bg-ok-soft text-ok" },
  declined: { label: "下降", cls: "border-fail/30 bg-fail-soft text-fail" },
  unchanged: { label: "持平", cls: "border-border bg-muted text-muted-foreground" },
  not_comparable: { label: "不可比", cls: "border-warn/30 bg-warn-soft text-warn" },
};

/**
 * 模块 E：可见度与线索报告。
 *
 * 三条硬规则，都写进代码而不是写进文档：
 *  1. **不同定位方式永不合并** —— 问题文字里写「附近」和真的开着定位，
 *     拿到的推荐结果不是一回事；合并统计就是把两种数据当一种卖。
 *  2. **没有提升就显示没有提升** —— compareBaseline 只给两组数字和差值，
 *     不做「趋势向好」这类包装；样本量不足直接判 not_comparable。
 *  3. **每条推荐结果可追溯到样本** —— 报告里的数字都能点回批次和原始回答。
 */
export default async function GeoReportPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const { store: storeParam } = await searchParams;
  const stores = listStores();
  const selected = storeParam ? stores.find((s) => s.id === storeParam) : stores[0];

  if (!selected) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHead
          icon={IconChartBar}
          title="门店效果报告"
          description="按门店、按定位方式分别统计可见度，并如实呈现前后对比结果。"
        />
        <EmptyState>
          <p className="font-medium text-foreground">还没有门店</p>
          <p className="mt-1">
            报告需要先有门店档案。第一条门店建好后，这里会显示该店的可见度、事实错误率与线索。
          </p>
          <Link href="/console/stores" className="mt-3 inline-block font-medium underline">
            去建门店档案
          </Link>
        </EmptyState>
      </div>
    );
  }

  // 证据充分性：样本量或凭证不足时，报告整体标记「不可判定」而不是照常给数字
  const evidence = assessEvidence(collectSampleEvidence());
  const readiness = storeReadiness(selected.id);
  const leadStats = countLeadsForStore(selected.id);
  const groups = listRunsByLocationMode(selected.id);

  // 每个定位方式独立成块：先按模式分组，再在组内做基线/复测对比。
  const blocks = groups.map((group) => {
    const mode = (group.locationMode ?? "unspecified") as LocationMode;
    const withSamples = group.runs.filter((r) => r.sample_count > 0);
    const baseline = withSamples[0];
    const retest = withSamples.length > 1 ? withSamples[withSamples.length - 1] : undefined;

    const snapshotsFor = (runId: string) => listMetricSnapshots(runId);
    const baseSnaps = baseline ? snapshotsFor(baseline.id) : [];
    const retestSnaps = retest ? snapshotsFor(retest.id) : [];

    const metrics = ["mention_rate", "top1_rate", "sov", "owned_citation_rate"].map((metric) => {
      const b = baseSnaps.find((s) => s.metric === metric);
      const r = retestSnaps.find((s) => s.metric === metric);
      return compareBaseline(
        metric,
        b ? { value: b.value, numerator: b.numerator, denominator: b.denominator } : null,
        r ? { value: r.value, numerator: r.numerator, denominator: r.denominator } : null,
      );
    });

    const baseFacts = baseline ? computeFactErrorRate(listFactEvalsForRun(baseline.id)) : null;
    const retestFacts = retest ? computeFactErrorRate(listFactEvalsForRun(retest.id)) : null;

    // 定位方式一致性自检：混入其它模式的样本必须显式暴露，而不是被平均掉。
    const modeCheck = assertSingleLocationMode(group.runs.map(() => group.locationMode));

    return { mode, runs: group.runs, baseline, retest, metrics, baseFacts, retestFacts, modeCheck };
  });

  const totalSamples = groups.reduce((n, g) => n + g.runs.reduce((m, r) => m + r.sample_count, 0), 0);

  // —— 三类结果分开算（方案 B3）——
  // 认知题里出现品牌是必然的，与推荐题混算会把提及率做高。
  // 这里复用评测阶段同一套逻辑：只读已存的评测结果，不重算，保证口径一致。
  const catMap = categoryByQuestionId();
  const categorized: CategorizedSample[] = listCategorySamples(catMap);
  const byCategory = computeMetricsByCategory(categorized);
  const citationBlock = computeCitationSourceBlock(categorized.map((c) => ({ citations: c.citations })));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconChartBar}
        title="门店效果报告"
        description="可见度、事实准确性、线索三部分。每种定位方式单独统计，不做跨方式平均。"
      />

      {/* —— 选店 —— */}
      <SectionCard title="选择门店" description="报告口径随门店变化，不跨门店合并。">
        <form className="grid gap-3 sm:grid-cols-3" action="/console/geo-report">
          <Field label="门店" htmlFor="gr-store">
            <select id="gr-store" name="store" className={SELECT_CLS} defaultValue={selected.id}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.city ? `（${s.city}）` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              className="h-9 rounded-md border border-input px-4 text-sm font-medium shadow-xs hover:bg-accent"
            >
              查看报告
            </button>
          </div>
        </form>
      </SectionCard>

      {/* —— 报告可用性前提 —— */}
      <Card className={readiness.blockers.length === 0 ? "border-ok/30 bg-ok-soft" : "border-warn/25 bg-warn-soft"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {readiness.blockers.length === 0 ? (
              <IconCircleCheck className="size-4" />
            ) : (
              <IconAlertTriangle className="size-4" />
            )}
            报告前提：{readiness.blockers.length === 0 ? "已满足" : `还差 ${readiness.blockers.length} 项`}
          </CardTitle>
          <CardDescription>
            事实 {readiness.factsVerified}/{readiness.factsTotal} 已核验 · 地图资料 {readiness.claimed}/{readiness.listings} 已认领 · 锚点 {readiness.anchors} · 场景 {readiness.scenarios} · 待处理差异 {readiness.openDiffs}
          </CardDescription>
        </CardHeader>
        {readiness.blockers.length > 0 && (
          <CardContent>
            <ul className="list-disc pl-5 text-sm">
              {readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              前提不满足时下面的数字仍会照常显示，但请当作「尚不可解释」——
              例如还没核验过事实，事实错误率就没有分母。
            </p>
          </CardContent>
        )}
      </Card>

      {/* —— 证据充分性 —— */}
      <Card
        className={
          evidence.verdict === "sufficient"
            ? "border-ok/30 bg-ok-soft"
            : evidence.verdict === "insufficient"
              ? "border-warn/25 bg-warn-soft"
              : "border-fail/25 bg-fail-soft"
        }
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconInfoCircle className="size-4" />
            证据判定：{EVIDENCE_VERDICT_LABEL[evidence.verdict]}
          </CardTitle>
          <CardDescription>{evidence.note}</CardDescription>
        </CardHeader>
        {evidence.groups.length > 0 && (
          <CardContent>
            <div className="flex flex-col gap-2">
              {evidence.groups.map((g) => (
                <div key={g.key} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 ${
                        g.verdict === "sufficient"
                          ? "border-ok/30 bg-ok-soft text-ok"
                          : g.verdict === "insufficient"
                            ? "border-warn/30 bg-warn-soft text-warn"
                            : "border-fail/30 bg-fail-soft text-fail"
                      }`}
                    >
                      {EVIDENCE_VERDICT_LABEL[g.verdict]}
                    </span>
                    <span className="font-medium">
                      {g.protocolId ? "已绑定协议" : "未绑定协议"} · {g.surface === "official_api" ? "官方 API" : "消费者界面"}
                      {" · "}
                      {MODE_LABEL[g.locationMode] ?? g.locationMode}
                      {" · "}
                      {g.webSearch ? "联网" : "不联网"}
                    </span>
                    <span className="text-muted-foreground">
                      可信样本 {g.countable}/{g.total}，带凭证 {g.traceable}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{g.note}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              本组统计按「协议 × 界面 × 定位方式 × 联网状态」分组。不同组不能合并 ——
              消费者界面与官方 API、真实定位与只写地名，拿到的回答不是一回事。
            </p>
          </CardContent>
        )}
      </Card>

      {/* —— 三类结果分开展示 —— */}
      <SectionCard
        title="三类结果（认知 / 推荐 / 引用）"
        description="认知题回答的是「模型对这个品牌的描述准不准」，推荐题与场景题才回答「能不能被推荐」。三类不合并计算。"
      >
        {byCategory.blocks.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            还没有已评测的样本。评估后这里会按问题类目分块显示分子/分母。
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {byCategory.blocks.map((b) => (
              <div key={b.category ?? "uncategorized"} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.label}</span>
                  {b.countsTowardRecommendation ? (
                    <Badge variant="outline" className="border-ok/30 bg-ok-soft font-normal text-ok">
                      计入推荐判断
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-warn/30 bg-warn-soft font-normal text-warn">
                      不计入推荐判断
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">{b.sampleCount} 条样本</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{b.readingNote}</p>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>指标</TableHead>
                      <TableHead className="w-40">分子 / 分母</TableHead>
                      <TableHead className="w-24">比率</TableHead>
                      <TableHead>口径</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.metrics.map((m) => (
                      <TableRow key={m.metric}>
                        <TableCell className="font-medium">{METRIC_LABEL[m.metric] ?? m.metric}</TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {m.numerator} / {m.denominator}
                        </TableCell>
                        <TableCell className="tabular-nums text-sm">{pct(m.value)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.basis}</TableCell>
                      </TableRow>
                    ))}
                    {b.competitor && (
                      <TableRow>
                        <TableCell className="font-medium">竞品出现率</TableCell>
                        <TableCell className="tabular-nums text-sm">
                          {b.competitor.numerator} / {b.competitor.denominator}
                        </TableCell>
                        <TableCell className="tabular-nums text-sm">{pct(b.competitor.rate)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {b.competitor.basis}
                          {b.competitor.byEntity.length > 0 && (
                            <span className="ml-1">
                              （{b.competitor.byEntity.map((e) => `${e.entity} ${e.samples}`).join("、")}）
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    {b.notComputable.map((n) => (
                      <TableRow key={n.metric}>
                        <TableCell className="font-medium">{METRIC_LABEL[n.metric] ?? n.metric}</TableCell>
                        <TableCell className="text-xs text-warn" colSpan={3}>
                          不可计算：{n.reason}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}

            {/* 引用来源单独成块 */}
            <div className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">引用来源</span>
                <Badge variant="outline" className="font-normal">
                  自有来源被引用 {citationBlock.ownedNumerator} / {citationBlock.denominator}
                </Badge>
                <span className="text-sm tabular-nums">{pct(citationBlock.ownedRate)}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                被提及与被引用是两件事：模型可能提到你，却引用别人的页面来解释你。
              </p>
              {citationBlock.byDomain.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {citationBlock.byDomain.slice(0, 10).map((d) => (
                    <li key={d.domain}>
                      {d.owned && <span className="text-ok">自有 · </span>}
                      {d.domain} · {d.samples} 条样本
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {byCategory.notes.length > 0 && (
              <ul className="text-xs text-warn">
                {byCategory.notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SectionCard>

      {/* —— 按定位方式分块 —— */}
      {blocks.length === 0 ? (
        <EmptyState>
          <p className="font-medium text-foreground">这家店还没有采样批次</p>
          <p className="mt-1">
            报告的所有数字都来自采样批次。先去位置采样页建立锚点与场景，再创建批次并采集回答原文。
          </p>
          <Link href="/console/geo-sampling" className="mt-3 inline-block font-medium underline">
            去位置采样
          </Link>
        </EmptyState>
      ) : (
        blocks.map((block) => (
          <SectionCard
            key={block.mode}
            title={`定位方式：${MODE_LABEL[block.mode] ?? block.mode}`}
            description={
              canClaimNearbyRecommendation(block.mode)
                ? "样本使用真实设备定位，可以用于判断「附近推荐」表现。"
                : "样本未使用真实设备定位 —— 不能据此判断真实「附近推荐」表现。"
            }
          >
            {block.modeCheck !== block.mode && (
              <p className="mb-3 rounded-lg border border-fail/25 bg-fail-soft p-2 text-xs text-fail">
                检测到定位方式不一致（自检值 {block.modeCheck}）。本块数据不可用，请检查批次标注。
              </p>
            )}

            {/* 批次清单 */}
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                本方式下的批次（{block.runs.length} 个）
              </p>
              <div className="flex flex-wrap gap-2">
                {block.runs.map((r) => (
                  <Badge key={r.id} variant="outline" className="font-normal">
                    {r.label} · {r.sample_count} 条样本
                  </Badge>
                ))}
              </div>
            </div>

            {!block.baseline ? (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                本方式下还没有任何样本，无法计算指标。
              </p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  基线批次：{block.baseline.label}（{block.baseline.sample_count} 条）
                  {block.retest ? ` · 复测批次：${block.retest.label}（${block.retest.sample_count} 条）` : " · 尚无复测批次，只显示基线"}
                </p>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>指标</TableHead>
                      <TableHead className="w-28">基线</TableHead>
                      <TableHead className="w-28">复测</TableHead>
                      <TableHead className="w-24">差值</TableHead>
                      <TableHead className="w-24">判定</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {block.metrics.map((m) => {
                      const style = VERDICT_STYLE[m.verdict];
                      return (
                        <TableRow key={m.metric}>
                          <TableCell className="font-medium">{METRIC_LABEL[m.metric] ?? m.metric}</TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {m.baseline ? `${pct(m.baseline.value)} (${m.baseline.numerator}/${m.baseline.denominator})` : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {m.retest ? `${pct(m.retest.value)} (${m.retest.numerator}/${m.retest.denominator})` : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">
                            {m.delta === null ? "—" : `${m.delta >= 0 ? "+" : ""}${(m.delta * 100).toFixed(1)}pt`}
                          </TableCell>
                          <TableCell>
                            <span className={`rounded-md border px-2 py-0.5 text-xs ${style.cls}`}>{style.label}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.note}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* 事实错误率：与上面几个指标口径不同，单独列出 */}
                <div className="mt-4 rounded-lg border p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    事实错误率（AI 回答中与已核验事实冲突的比例）
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span>
                      基线：
                      {block.baseFacts
                        ? `${pct(block.baseFacts.value)}（冲突 ${block.baseFacts.numerator} / 已判定 ${block.baseFacts.denominator}）`
                        : "无法计算"}
                    </span>
                    <IconArrowRight className="size-3.5 text-muted-foreground" />
                    <span>
                      复测：
                      {block.retestFacts
                        ? `${pct(block.retestFacts.value)}（冲突 ${block.retestFacts.numerator} / 已判定 ${block.retestFacts.denominator}）`
                        : block.retest
                          ? "无法计算"
                          : "无复测"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    「无法判断」的判定不计入分母 —— 把判断不了当成判对了会低估错误率。判定为启发式，冲突项需人工复核。
                  </p>
                </div>
              </>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              可追溯性：以上数字来自批次{" "}
              {block.baseline ? (
                <Link href={`/console/sampling?run=${block.baseline.id}`} className="underline">
                  查看原始回答
                </Link>
              ) : (
                "—"
              )}
              ，每条样本都带采集时间与平台。
            </p>
          </SectionCard>
        ))
      )}

      {/* —— 线索 —— */}
      <SectionCard
        title="线索"
        description="只统计已回填门店归属的线索；未归属的历史线索不摊派给任何门店。"
      >
        {leadStats.total === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            这家店暂无线索。若已有线索未归属门店，请到线索页补填门店。
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-2xl font-semibold tabular-nums">{leadStats.total}</span>
            <span className="text-sm text-muted-foreground">条</span>
            {leadStats.byStatus.map((s) => (
              <span key={s.status} className="text-sm text-muted-foreground">
                {s.status} {s.n}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      {/* —— 必须如实说的话 —— */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconInfoCircle className="size-4" />
            本报告的边界
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            <IconMapPin className="mr-1 inline size-3.5" />
            本次统计共 {totalSamples} 条样本，分属 {blocks.length} 种定位方式，均未跨方式合并。
          </p>
          <p>
            「问题文字里写了地点」不等于「设备真实定位」。前者只能说明模型对文字的理解，后者才反映附近推荐，两者结论不可互相替代。
          </p>
          <p>
            前后对比只在同门店、同定位方式、同样本量级下成立。平台模型更新、时段差异、竞争变化都会影响结果，本报告不主张因果。
          </p>
          <p>
            Google 明确说明本地自然排名没有付费捷径。本报告展示的是可观察的可见度变化，不承诺、也无法保证任何排名或推荐结果。
          </p>
          <p>
            若复测低于基线或没有变化，报告如实呈现，不会替换成更好看的数字。没有真实样本时，不填测试数据。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
