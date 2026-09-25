import Link from "next/link";
import {
  IconClipboardList,
  IconCopy,
  IconLock,
  IconAlertTriangle,
  IconInfoCircle,
  IconPlus,
} from "@tabler/icons-react";
import * as P from "@/lib/db/repo-protocol";
import * as R from "@/lib/db/repo-domains";
import { listAnchors } from "@/lib/db/repo-local";
import { PageHead, SectionCard, Field } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { QUESTION_CATEGORIES, SAMPLING_SURFACES, compareProtocols, describeProtocol } from "@/lib/protocol";
import { LOCATION_MODES, DAYPARTS } from "@/lib/db/schema-local";
import { protocolClone, protocolCreate } from "../protocol-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "采样协议", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 B1：采样协议。
 *
 * 协议 = 把"在什么条件下采的"固定下来。指标按协议分组，跨协议不混算 ——
 * 这是"同条件复测"能成立的前提。
 */
export default function ProtocolsPage() {
  const protocols = P.listProtocols();
  const frozenSets = R.listQuerySets().filter((q) => q.status === "frozen");
  const engines = R.listEngines();
  const anchors = listAnchors();
  const unbound = P.listUnboundRuns();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconClipboardList}
        title="采样协议"
        description="把平台、联网开关、界面、定位方式、重复次数固定成一份协议。复测从协议复制，跨协议的数据不做差值判断。"
        badge={
          <Badge variant="outline" className="font-normal">
            {protocols.length} 份协议
          </Badge>
        }
      />

      <Alert>
        <IconLock className="size-4" />
        <AlertTitle>协议一旦建立，条件即锁定</AlertTitle>
        <AlertDescription>
          要改条件就新建一份协议，不要改旧的 —— 改了之后历史样本就无法解释了。
          复测只允许覆盖地区、模型版本、时段、锚点这四项环境条件；
          平台、联网开关、界面、问题集版本不可更改，否则不叫复测。
        </AlertDescription>
      </Alert>

      {unbound.length > 0 && (
        <Alert className="border-warn/25 bg-warn-soft">
          <IconAlertTriangle className="size-4 text-warn" />
          <AlertTitle>{unbound.length} 个批次没有绑定协议</AlertTitle>
          <AlertDescription>
            这些批次的数据<strong>不参与任何前后对比</strong>，只作为单次观察。
            需要对比时请在采样批次上选择协议。
            <ul className="mt-2 space-y-0.5">
              {unbound.slice(0, 5).map((r) => (
                <li key={r.id} className="text-xs">
                  {r.label} · {r.sample_count} 条样本
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* —— 协议列表 —— */}
      {protocols.length === 0 ? (
        <EmptyState>
          <p className="font-medium text-foreground">还没有任何协议</p>
          <p className="mt-1">协议必须基于已冻结的问题集建立 —— 未冻结的问题还会变，条件就不固定。</p>
        </EmptyState>
      ) : (
        <SectionCard title="协议清单" description="同一份协议用于基线与各次复测；复制出的复测协议会记录来源。">
          <div className="flex flex-col gap-3">
            {protocols.map((p) => {
              const conditions = P.rowToConditions(p);
              const runs = P.listRunsForProtocol(p.id);
              const source = p.cloned_from ? protocols.find((x) => x.id === p.cloned_from) : undefined;
              const comparison = source ? compareProtocols(P.rowToConditions(source), conditions) : null;
              return (
                <div key={p.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.label}</span>
                    <Badge variant="outline" className="font-normal">
                      v{p.query_set_version}
                    </Badge>
                    {source && (
                      <Badge variant="outline" className="font-normal">
                        复制自 {source.label}
                      </Badge>
                    )}
                    {comparison && (
                      <Badge
                        variant="outline"
                        className={
                          comparison.comparable
                            ? "border-ok/30 bg-ok-soft font-normal text-ok"
                            : "border-fail/30 bg-fail-soft font-normal text-fail"
                        }
                      >
                        {comparison.comparable ? "可与来源对比" : "与来源不可直接对比"}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{describeProtocol(conditions)}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">指纹 {p.fingerprint.slice(0, 64)}…</p>
                  {comparison && !comparison.comparable && <p className="mt-1 text-xs text-fail">{comparison.note}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{runs.length} 个批次</span>
                    {runs.length > 0 && <span>· 样本 {runs.reduce((n, r) => n + r.sample_count, 0)} 条</span>}
                    {runs.length > 1 && (
                      <Link href="/console/geo-report" className="text-primary underline-offset-2 hover:underline">
                        · 到效果报告查看对比
                      </Link>
                    )}
                  </div>
                  <form action={protocolClone} className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
                    <input type="hidden" name="sourceId" value={p.id} />
                    <Field label="复测协议名称" htmlFor={`pc-${p.id}`}>
                      <Input id={`pc-${p.id}`} name="label" placeholder={`${p.label} · 复测`} className="h-8 w-56 text-xs" />
                    </Field>
                    <Field label="地区（可覆盖）" htmlFor={`pcr-${p.id}`}>
                      <Input id={`pcr-${p.id}`} name="region" placeholder={p.region ?? "留空沿用"} className="h-8 w-24 text-xs" />
                    </Field>
                    <Field label="模型版本（可覆盖）" htmlFor={`pcm-${p.id}`}>
                      <Input id={`pcm-${p.id}`} name="modelVersion" placeholder={p.model_version ?? "留空沿用"} className="h-8 w-36 text-xs" />
                    </Field>
                    <Button type="submit" size="sm" variant="outline" className="h-8">
                      <IconCopy className="size-3.5" />
                      复制为复测协议
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* —— 新建协议 —— */}
      <SectionCard
        title="新建协议"
        description="只能基于已冻结的问题集。同一组条件不会重复建立协议 —— 指纹相同会直接复用。"
      >
        {frozenSets.length === 0 ? (
          <EmptyState>
            还没有已冻结的问题集。先到{" "}
            <Link href="/console/questions" className="text-primary underline-offset-4 hover:underline">
              问题库
            </Link>{" "}
            建好问题并冻结。
          </EmptyState>
        ) : (
          <form action={protocolCreate} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="协议名称" htmlFor="pr-label">
                <Input id="pr-label" name="label" placeholder="潍坊炒菜 · 基线协议" required />
              </Field>
              <Field label="问题集（仅已冻结）" htmlFor="pr-qs">
                <select id="pr-qs" name="querySetId" className={SELECT_CLS} required>
                  <option value="">选择问题集…</option>
                  {frozenSets.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}（v{q.version}，{q.question_count} 条）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="采样界面" htmlFor="pr-surface" hint="消费者界面与官方 API 的回答可能有差异">
                <select id="pr-surface" name="surface" className={SELECT_CLS} defaultValue="manual_ui">
                  {SAMPLING_SURFACES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="地区" htmlFor="pr-region">
                <Input id="pr-region" name="region" placeholder="CN" className="h-9" />
              </Field>
              <Field label="每问重复次数" htmlFor="pr-rep" hint="AI 回答有随机性，建议 ≥3">
                <Input id="pr-rep" name="repetition" type="number" min={1} max={10} defaultValue={3} className="h-9" />
              </Field>
              <Field label="模型版本" htmlFor="pr-model" hint="平台会静默更新模型，记录版本才能解释变化">
                <Input id="pr-model" name="modelVersion" placeholder="留空表示未记录" className="h-9" />
              </Field>
              <Field label="定位方式" htmlFor="pr-loc" hint="没记录就留「未标注」，不能默认成真实定位">
                <select id="pr-loc" name="locationMode" className={SELECT_CLS} defaultValue="unspecified">
                  {LOCATION_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="测试锚点" htmlFor="pr-anchor">
                <select id="pr-anchor" name="anchorId" className={SELECT_CLS} defaultValue="">
                  <option value="">（无锚点）</option>
                  {anchors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="时段" htmlFor="pr-daypart">
                <select id="pr-daypart" name="daypart" className={SELECT_CLS} defaultValue="">
                  <option value="">（未指定）</option>
                  {DAYPARTS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox name="webSearch" />
              <span>
                平台开启联网检索
                <span className="ml-1 text-xs text-muted-foreground">
                  —— 联网与不联网是两个不同的系统，不能混为一组数据
                </span>
              </span>
            </label>

            <Field label="目标平台（可多选）">
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

            <Button type="submit" size="sm" className="self-start">
              <IconPlus className="size-3.5" />
              建立并锁定协议
            </Button>
          </form>
        )}
      </SectionCard>

      {/* —— 三类问题说明 —— */}
      <SectionCard
        title="三类问题（分类决定数字怎么算）"
        description="问题库里的每一条问题都应归入其中一类。未分类的问题不参与分类统计。"
      >
        <div className="flex flex-col gap-3">
          {QUESTION_CATEGORIES.map((c) => (
            <div key={c.value} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.label}</span>
                {c.countsTowardRecommendation ? (
                  <Badge variant="outline" className="border-ok/30 bg-ok-soft font-normal text-ok">
                    计入推荐判断
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-warn/30 bg-warn-soft font-normal text-warn">
                    不计入推荐判断
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <IconInfoCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            认知题里出现品牌是必然的 —— 把它算进推荐率会把数字做得很好看，但那是自欺。
            因此只有推荐题与场景题参与「能否被推荐」的判断。
          </span>
        </p>
      </SectionCard>
    </div>
  );
}
