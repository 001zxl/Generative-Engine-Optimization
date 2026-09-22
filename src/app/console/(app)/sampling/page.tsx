import Link from "next/link";
import { IconClipboardText, IconPlus, IconUpload, IconWorld, IconDeviceDesktop } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { sampleImportCsv, samplingRunCreate } from "../actions";
import { observationSave, perplexityCollect } from "./actions";
import { getApiAttempt, getSampleProvenance, perplexityConfigured } from "@/lib/sampling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "多平台采样", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 4：多平台采样。
 *
 * 刻意先做「人工粘贴 + CSV 导入」，原因有两个，都不是偷懒：
 *  1. 国内平台（豆包/千问/元宝）基本没有合规的公开检索 API，只能人工采样；
 *  2. 官方 API 的回答与消费端界面存在差异，混在一起统计会得出错误结论。
 * 因此每条样本都必须记录 sampling_mode，且不同 mode 不合并计算。
 */
export default async function SamplingPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string; message?: string; error?: string }>;
}) {
  const { run: runParam, message, error } = await searchParams;
  const engines = R.listEngines();
  const runs = R.listSamplingRuns();
  const querySets = R.listQuerySets().filter((q) => q.status === "frozen");
  const selected = runParam ? runs.find((r) => r.id === runParam) : runs[0];
  const tasks = selected ? R.listSamplingTasks(selected.id) : [];
  const pending = tasks.filter((t) => t.status === "pending");
  const samples = selected ? R.listSamples(selected.id) : [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconClipboardText}
        title="多平台采样"
        description="保存各平台的回答原文、模型、采集时间和引用。消费者界面人工采样与官方 API 采样分开记录。当前自动连接器仅覆盖 Perplexity Sonar。"
      />
      {(message || error) && <p role="status" className={`rounded-lg border p-3 text-sm ${error ? "border-fail/25 bg-fail-soft text-fail" : "border-ok/25 bg-ok-soft text-ok"}`}>{error || message}</p>}

      {querySets.length === 0 && (
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="text-sm">需要先冻结一个问题集</CardTitle>
            <CardDescription>
              采样任务由「冻结的问题 × 引擎」生成。请先到{" "}
              <Link href="/console/questions" className="font-medium text-primary underline-offset-4 hover:underline">
                问题库
              </Link>{" "}
              建立问题并冻结。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* —— 引擎清单 —— */}
      <SectionCard
        title={`引擎清单（${engines.length} 个）`}
        description="名册表示平台是否有官方 API；本系统目前只接入 Perplexity Sonar。其余平台可使用人工界面采样。"
      >
        <div className="flex flex-wrap gap-1.5">
          {engines.map((e) => (
            <Badge
              key={e.id}
              variant="outline"
              className={e.has_public_api ? "font-normal" : "border-warn/25 bg-warn-soft font-normal text-warn"}
              title={e.note ?? undefined}
            >
              {e.region === "cn" ? <IconDeviceDesktop className="size-3.5" /> : <IconWorld className="size-3.5" />}
              {e.name}
              <span className="text-muted-foreground">{e.has_public_api ? "·有API" : "·仅人工"}</span>
            </Badge>
          ))}
        </div>
      </SectionCard>

      {/* —— 新建采样批次 —— */}
      <SectionCard
        title="新建采样批次"
        description="任务按「问题 × 引擎 × 重复次数」生成。相同问题可建立多个批次，以便前后复测。"
      >
        <form action={samplingRunCreate} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="批次名称" htmlFor="r-label">
              <Input id="r-label" name="label" placeholder="2026-09 基线采样" required />
            </Field>
            <Field label="问题集（仅已冻结的）" htmlFor="r-qs">
              <select id="r-qs" name="querySetId" className={SELECT_CLS} required disabled={querySets.length === 0}>
                <option value="">选择问题集…</option>
                {querySets.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}（{q.question_count} 条）
                  </option>
                ))}
              </select>
            </Field>
            <Field label="采样方式" htmlFor="r-mode" hint="不同方式的样本不会被合并统计">
              <select id="r-mode" name="samplingMode" className={SELECT_CLS} defaultValue="manual_ui">
                {R.SAMPLING_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="地区" htmlFor="r-region" hint="人工采样可记录 DE / US；当前 Perplexity API 连接器请留空">
              <Input id="r-region" name="region" placeholder="DE" className="h-9" />
            </Field>
            <Field label="每问重复次数" htmlFor="r-rep" hint="AI 回答有随机性，建议 ≥3">
              <Input id="r-rep" name="repetition" type="number" min={1} max={10} defaultValue={1} className="h-9" />
            </Field>
          </div>

          <Field label="目标引擎（可多选）">
            <div className="grid gap-2 sm:grid-cols-3">
              {engines.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm">
                  <Checkbox name="engines" value={e.name} />
                  <span>
                    {e.name}
                    <span className="ml-1 text-xs text-muted-foreground">{e.vendor}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <div>
            <Button type="submit" size="sm" disabled={querySets.length === 0}>
              <IconPlus className="size-3.5" />
              生成采样任务
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 批次列表 —— */}
      {runs.length > 0 && (
        <SectionCard title="采样批次" description="点批次名切换下方的录入区。">
          <div className="flex flex-col gap-2">
            {runs.map((r) => (
              <div
                key={r.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${
                  selected?.id === r.id ? "border-primary/30 bg-brand-soft" : ""
                }`}
              >
                <Link href={`/console/sampling?run=${r.id}`} className="font-medium underline-offset-4 hover:underline">
                  {r.label}
                </Link>
                <StatusPill status={r.status} />
                <Badge variant="outline" className="font-mono text-xs">
                  {r.sampling_mode}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  任务 {r.task_count} · 已采 {r.sample_count}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.created_at.slice(0, 16).replace("T", " ")}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* —— 任务录入 —— */}
      {selected && (
        <>
          <SectionCard
            title={`录入回答 · ${selected.label}`}
            description="人工采样请粘贴完整原文并登记模型、带时区时间与引用；Perplexity 官方 API 批次可逐任务采集。未提供分享链接时仍可记录无引用回答。"
            action={
              <span className="text-xs text-muted-foreground">
                待采 {pending.length} / 共 {tasks.length}
              </span>
            }
          >
            {pending.length === 0 ? (
              <EmptyState>该批次的任务都已采集完成。</EmptyState>
            ) : (
              <div className="flex flex-col gap-5">
                {pending.slice(0, 12).map((t) => (
                  <div key={t.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-normal">
                        {t.engine}
                      </Badge>
                      {t.region && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {t.region}
                        </Badge>
                      )}
                      {t.repetition > 1 && (
                        <span className="text-xs text-muted-foreground">第 {t.repetition} 次</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium">{t.question_text}</p>
                    {selected.sampling_mode === "official_api" ? (
                      <form action={perplexityCollect} className="mt-3 space-y-2">
                        <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="runId" value={selected.id} />
                        <p className="text-xs text-muted-foreground">仅 Perplexity 官方 Sonar API；与消费者界面回答分开比较。{!perplexityConfigured() && "尚未设置 PERPLEXITY_API_KEY。"}</p>
                        {getApiAttempt(t.id)?.last_error && <p className="text-xs text-fail">{getApiAttempt(t.id)?.last_error}</p>}
                        <Button type="submit" size="sm" disabled={t.engine !== "Perplexity" || !perplexityConfigured() || Boolean(getApiAttempt(t.id) && getApiAttempt(t.id)?.state !== "failed")}>采集此题的真实 API 回答</Button>
                      </form>
                    ) : selected.sampling_mode === "manual_ui" || selected.sampling_mode === "approved_browser" ? (
                    <form action={observationSave} className="mt-3 space-y-2">
                    <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="runId" value={selected.id} />
                    <Textarea
                      name="rawAnswer"
                      className="mt-2 min-h-24 font-mono text-xs"
                      placeholder="把该平台对这个问题的完整回答粘贴到这里（含引用来源的 URL）…"
                      required
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input name="modelVersion" required placeholder="实际模型版本，例如平台界面显示值" className="h-8" />
                      <Input name="collectedAt" required defaultValue={new Date().toISOString()} aria-label="采集时间（带时区）" className="h-8" />
                      <Input name="sourceUrl" type="url" placeholder="回答分享链接（可选）" className="h-8" />
                      <Textarea name="citationUrls" placeholder="引用网址（每行一条，选填）" className="min-h-16 text-xs" />
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Button type="submit" size="sm">
                        保存回答
                      </Button>
                    </div>
                    </form>
                    ) : <p className="mt-3 text-xs text-muted-foreground">请使用下方 CSV 导入，并保留原始采样凭据。导入记录不会作为可追溯实验的真实基线。</p>}
                  </div>
                ))}
                {pending.length > 12 && (
                  <p className="text-xs text-muted-foreground">
                    还有 {pending.length - 12} 个待采任务未显示。也可用下方 CSV 批量导入。
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="CSV 批量导入"
            description="兼容旧数据批量导入。导入记录缺少可核验来源，不能作为真实效果实验的基线。官方 API 批次禁止使用 CSV 冒充接口采样。"
          >
            <form action={sampleImportCsv} className="flex flex-col gap-3">
              <input type="hidden" name="runId" value={selected.id} />
              <Field label="粘贴 CSV 内容" htmlFor="csv">
                <Textarea
                  id="csv"
                  name="csv"
                  className="min-h-32 font-mono text-xs"
                  placeholder={"question,engine,answer\n海外买家如何筛选中国供应商？,ChatGPT,\"我推荐 Nordic Profiles（https://nordic-profiles.se），因为…\"\n海外买家如何筛选中国供应商？,豆包,国内供应商方面…"}
                  required
                />
              </Field>
              <div>
                <Button type="submit" size="sm" variant="outline">
                  <IconUpload className="size-3.5" />
                  导入
                </Button>
              </div>
            </form>
          </SectionCard>

          {samples.length > 0 && (
            <SectionCard
              title={`已采集样本（${samples.length}）`}
              description="原始回答永久保留 —— 结果页的每个指标都能回到这里。"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">引擎</TableHead>
                      <TableHead className="w-24">方式</TableHead>
                      <TableHead>问题</TableHead>
                      <TableHead className="w-24">已评估</TableHead>
                      <TableHead className="w-32">采集时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {samples.slice(0, 30).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="text-sm font-medium">{s.engine}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{s.sampling_mode}</TableCell>
                        <TableCell className="max-w-96">
                          <div className="truncate text-sm">{s.question_text ?? "（问题已删除）"}</div>
                          <div className="truncate text-xs text-muted-foreground">{s.raw_answer.slice(0, 100)}…</div>
                          <div className="text-xs text-muted-foreground">{getSampleProvenance(s.id)?.model_version ?? "旧记录 · 缺来源证明"}</div>
                        </TableCell>
                        <TableCell>
                          {s.evaluated > 0 ? (
                            <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
                              是
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-muted-foreground">
                              否
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {s.collected_at.slice(0, 16).replace("T", " ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </SectionCard>
          )}

          <Card className="bg-muted/40">
            <CardHeader>
              <CardTitle className="text-sm">下一步</CardTitle>
              <CardDescription>
                样本录入后，到{" "}
                <Link href="/console/evaluation" className="font-medium text-primary underline-offset-4 hover:underline">
                  评估与指标
                </Link>{" "}
                运行评估，把原始回答转成提及率、首推率、Share of Voice 等指标。
              </CardDescription>
            </CardHeader>
          </Card>
        </>
      )}

    </div>
  );
}
