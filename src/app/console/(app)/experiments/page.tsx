import Link from "next/link";
import { PageHead, SectionCard, Field } from "@/components/console-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listBrands, listSamplingRuns } from "@/lib/db/repo-domains";
import { compareExperiment, listExperiments, listRetests, type ExperimentSample } from "@/lib/experiments";
import { requireConsoleSession } from "@/lib/console-auth";
import { experimentCreate, experimentRetest, experimentNotesSave } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "基线与复测实验", robots: { index: false, follow: false } };
const SELECT = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const metricNames: Record<string, string> = { mention_rate: "品牌提及率", top1_rate: "被跟踪实体中的首位率", sov: "被跟踪实体提及份额", owned_citation_rate: "含引用回答中的自有域引用率" };
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function Evidence({ samples, title }: { samples: ExperimentSample[]; title: string }) {
  return <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{title} · {samples.length} 条原文与来源</summary>
    <div className="mt-3 space-y-3">{samples.map((s) => <details key={s.id} className="rounded-md border p-3 text-xs">
      <summary className="cursor-pointer">{s.engine} · {s.model ?? "模型未记录"} · {s.region || "地区未填写"} · 第 {s.repetition} 次 · {s.id}</summary>
      <p className="mt-2 text-muted-foreground">{s.collectedAt} · {s.evidenceKind === "fixture" ? "测试夹具（不计入）" : s.evidenceKind === "official_api" ? `官方 API · 响应 ${s.providerResponseId ?? "ID 未记录"}` : s.evidenceKind === "manual_ui" ? "消费者界面 · 人工来源登记" : "来源未登记"}</p>
      {s.sourceUrl && /^https?:\/\//.test(s.sourceUrl) ? <a className="mt-1 block text-primary underline" href={s.sourceUrl} target="_blank" rel="noreferrer">打开回答来源</a> : s.evidenceKind === "manual_ui" ? <p className="mt-1 text-muted-foreground">未提供分享链接，来源为采样人员自报。</p> : null}
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 font-sans">{s.rawAnswer}</pre>
    </details>)}</div>
  </details>;
}

export default async function ExperimentsPage({ searchParams }: { searchParams: Promise<{ id?: string; run?: string; error?: string }> }) {
  await requireConsoleSession();
  const params = await searchParams;
  const experiments = listExperiments();
  const brands = listBrands();
  const runs = listSamplingRuns();
  const selected = experiments.find((e) => e.id === params.id) ?? experiments[0];
  let result: ReturnType<typeof compareExperiment> | null = null;
  let comparisonError = "";
  if (selected) {
    try { result = compareExperiment(selected.id, params.run); } catch (error) { comparisonError = error instanceof Error ? error.message : "无法读取比较"; }
  }
  const retests = selected ? listRetests(selected.id) : [];
  const comparison = result?.comparison;
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
    <PageHead title="基线与复测实验" description="先采集同一冻结问题集的真实回答，再锁定基线；记录发布内容，按原协议生成复测。变化只代表本实验观测，不承诺 AI 排名或归因。" />
    {(params.error || comparisonError) && <p role="alert" className="rounded-lg border border-fail/25 bg-fail-soft p-3 text-sm text-fail">{params.error || comparisonError}</p>}
    <SectionCard title="锁定一个真实基线" description="基线必须采齐，记录来源类型、模型版本与采集时间。原文、问题、品牌匹配口径和请求参数一起锁定；测试夹具不能作为基线。">
      <form action={experimentCreate} className="grid gap-3 sm:grid-cols-3">
        <Field label="实验名称"><Input name="name" required maxLength={200} placeholder="官网 FAQ 改版 · 第一轮观察" /></Field>
        <Field label="品牌"><select name="brandId" className={SELECT} required><option value="">选择品牌</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="已采齐的基线批次"><select name="baselineRunId" className={SELECT} required><option value="">选择采样批次</option>{runs.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.sample_count}/{r.task_count} · {r.sampling_mode}</option>)}</select></Field>
        <div className="sm:col-span-3"><Button type="submit" size="sm" disabled={!runs.length || !brands.length}>锁定基线并建立实验</Button><Link href="/console/sampling" className="ml-3 text-sm text-primary underline">去采集真实回答</Link></div>
      </form>
    </SectionCard>
    {experiments.length > 0 && <div className="flex flex-wrap gap-2">{experiments.map((e) => <Link key={e.id} href={`/console/experiments?id=${e.id}`} className={`rounded-md border px-3 py-2 text-sm ${e.id === selected?.id ? "border-primary bg-brand-soft" : ""}`}>{e.name}</Link>)}</div>}
    {selected && <>
      <SectionCard title={selected.name} description="干预记录用于解释时间关系；第三方收录与 AI 引用可能滞后，计划日期不会自动触发付费 API。">
        <form action={experimentNotesSave} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="id" value={selected.id} />
          <Field label="本轮修改 / 发布了什么"><Textarea name="intervention" defaultValue={selected.intervention} maxLength={20000} placeholder="例如：为 3 个高意图问题发布有来源支持的 FAQ，并更新产品页面。" /></Field>
          <Field label="实际发布 URL（每行一个）"><Textarea name="publishedUrls" defaultValue={(JSON.parse(selected.published_urls_json) as string[]).join("\n")} placeholder="https://example.com/faq" /></Field>
          <Field label="计划复测日期"><Input type="date" name="retestDueAt" defaultValue={selected.retest_due_at?.slice(0, 10) ?? ""} /></Field>
          <div className="self-end"><Button type="submit" variant="outline" size="sm">保存干预与复测计划</Button></div>
        </form>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={experimentRetest}><input type="hidden" name="id" value={selected.id} /><Button size="sm">按锁定协议生成复测任务</Button></form>
          <Link className="text-sm text-primary underline" href={`/console/sampling?run=${selected.baseline_run_id}`}>查看基线采样批次</Link>
          <a className="text-sm text-primary underline" href={`/console/experiments/export?id=${selected.id}${result?.runId ? `&run=${result.runId}` : ""}`}>导出协议、原文与比较 JSON</a>
        </div>
      </SectionCard>
      {retests.length > 0 && <div className="flex flex-wrap gap-2">{retests.map((r) => <Link key={r.run_id} href={`/console/experiments?id=${selected.id}&run=${r.run_id}`} className={`rounded-md border px-3 py-2 text-sm ${result?.runId === r.run_id ? "border-primary bg-brand-soft" : ""}`}>{r.label}</Link>)}</div>}
      {comparison ? <SectionCard title="前后观测比较" description={comparison.interpretation} action={<Badge variant="outline">{comparison.status === "comparable" ? "同协议完整观察" : comparison.status === "incomplete" ? "未完成：缺少有效样本" : "不可比较：协议或配置不同"}</Badge>}>
        <p className="text-sm">有效覆盖：基线 {comparison.beforeValid}/{comparison.expected}，复测 {comparison.afterValid}/{comparison.expected}。测试夹具与未登记来源的历史回答不进入分母。</p>
        {comparison.reasons.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{comparison.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
        {result?.runId && <Link className="mt-3 inline-block text-sm text-primary underline" href={`/console/sampling?run=${result.runId}`}>继续本轮复测采样</Link>}
        <div className="mt-4 space-y-5">{comparison.groups.map((group) => <div key={[group.engine, group.mode, group.region, group.model].join("|")} className="rounded-lg border p-3">
          <p className="text-sm font-medium">{group.engine} · {group.mode} · {group.region || "地区未填写"} · {group.model}</p>
          <p className="mt-1 text-xs text-muted-foreground">本组有效回答：基线 {group.before}，复测 {group.after}；固定任务覆盖 {pct(group.beforeCoverage)} → {pct(group.afterCoverage)}</p>
          <Table><TableHeader><TableRow><TableHead>指标及口径</TableHead><TableHead>基线</TableHead><TableHead>复测</TableHead><TableHead>变化（百分点）</TableHead></TableRow></TableHeader>
            <TableBody>{group.metrics.map((metric) => <TableRow key={metric.metric}><TableCell>{metricNames[metric.metric]}</TableCell><TableCell>{metric.before ? `${metric.before.numerator}/${metric.before.denominator} · ${pct(metric.before.value)}` : "不可计算"}</TableCell><TableCell>{metric.after ? `${metric.after.numerator}/${metric.after.denominator} · ${pct(metric.after.value)}` : "不可计算"}</TableCell><TableCell>{metric.deltaPercentagePoints === null ? "—" : `${metric.deltaPercentagePoints > 0 ? "+" : ""}${metric.deltaPercentagePoints.toFixed(1)}`}</TableCell></TableRow>)}</TableBody>
          </Table>
          {group.notComputable.length > 0 && <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">查看不可计算原因与指标边界</summary><p className="mt-2">{group.notComputable.join("；")}</p></details>}
        </div>)}</div>
        {comparison.excluded.length > 0 && <details className="mt-4 text-sm"><summary className="cursor-pointer">被排除的 {comparison.excluded.length} 条回答</summary><ul className="mt-2 list-disc space-y-1 pl-5">{comparison.excluded.map((s) => <li key={`${s.side}-${s.sampleId}`}>{s.side === "before" ? "基线" : "复测"} {s.sampleId}：{s.reason}</li>)}</ul></details>}
      </SectionCard> : !comparisonError && <p className="rounded-lg border p-4 text-sm text-muted-foreground">基线已锁定。记录本轮实际发布内容后，生成复测任务并采集新的真实回答。</p>}
      {result && <>
        <Evidence title="锁定基线" samples={result.protocol.baselineSamples} />
        {result.runId && <Evidence title="本轮复测" samples={result.retestSamples} />}
      </>}
    </>}
  </div>;
}
