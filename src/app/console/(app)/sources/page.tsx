import Link from "next/link";
import { IconBooks, IconAlertTriangle, IconCircleCheck, IconRefresh, IconPlus } from "@tabler/icons-react";
import * as X from "@/lib/db/repo-external";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field, DangerForm } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CLAIM_VERDICT_LABEL, SOURCE_KINDS, checkExternalSource, sourceKindLabel } from "@/lib/external-sources";
import { sourceCheck, sourceCreate, sourceDelete, sourceSetConflict } from "../source-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "第三方信源台账", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 B4：第三方信源台账。
 *
 * 记的是**别人写的、能给我们背书的外部页面**，与"我们自己发的内容"严格分开。
 * 把自家稿件记成第三方报道，对客户是虚假背书 —— 这里从数据结构和文案检查两层堵住。
 */
export default function SourcesPage() {
  const sources = X.listExternalSources();
  const summaries = X.claimSourceSummaries();
  const health = X.ledgerHealth();
  const brands = R.listBrands();
  const approvedClaims = R.listClaims().filter((c) => c.status === "approved");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconBooks}
        title="第三方信源台账"
        description="记录外部真实页面：谁写的、写在哪、什么时候核对过。自有内容与第三方报道严格分开，报告只列仍可访问的来源。"
        badge={
          <Badge variant="outline" className="font-normal">
            {health.total} 条来源
          </Badge>
        }
      />

      <Alert>
        <IconCircleCheck className="size-4" />
        <AlertTitle>不得把自发文章称为独立测评</AlertTitle>
        <AlertDescription>
          自有内容与客户授权渠道<strong>不能</strong>使用「独立测评」「第三方报道」「权威认证」这类说法。
          系统会检查标题、主题与备注里的措辞，命中即判为阻断 ——
          对客户而言这是虚假背书。
        </AlertDescription>
      </Alert>

      {(health.dead > 0 || health.mismatch > 0 || health.conflict > 0) && (
        <Alert className="border-fail/25 bg-fail-soft">
          <IconAlertTriangle className="size-4 text-fail" />
          <AlertTitle>
            台账存在问题：失效 {health.dead} · 内容不符 {health.mismatch} · 冲突 {health.conflict}
          </AlertTitle>
          <AlertDescription>
            失效与内容不符的来源不能继续作为事实依据；冲突需人工判断后才能对外使用该陈述。
          </AlertDescription>
        </Alert>
      )}

      {/* —— 每条事实的来源支持情况 —— */}
      <SectionCard
        title="事实的来源支持情况"
        description="只列仍可访问的来源。只有自有来源时不能声称「第三方已证实」。"
      >
        {summaries.length === 0 ? (
          <EmptyState>
            还没有已批准的事实。先到{" "}
            <Link href="/console/claims" className="text-primary underline-offset-4 hover:underline">
              事实与证据
            </Link>{" "}
            建立事实。
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {summaries.map((s) => (
              <div key={s.claimId} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      s.verdict === "supported"
                        ? "border-ok/30 bg-ok-soft font-normal text-ok"
                        : s.verdict === "conflicting"
                          ? "border-fail/30 bg-fail-soft font-normal text-fail"
                          : "border-warn/30 bg-warn-soft font-normal text-warn"
                    }
                  >
                    {CLAIM_VERDICT_LABEL[s.verdict]}
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground">{s.claimKey}</span>
                  <span className="text-sm">{s.statement}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.note}（可用来源 {s.usable}/{s.total}，其中独立第三方 {s.independent}）
                </p>
                {s.usableSources.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs">
                    {s.usableSources.map((u) => (
                      <li key={u.url}>
                        <span className={u.kind === "independent" ? "text-ok" : "text-muted-foreground"}>{u.label}</span>
                        {" · "}
                        <a href={u.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                          {u.title ?? u.url}
                        </a>
                        {" · "}
                        {u.platform}
                      </li>
                    ))}
                  </ul>
                )}
                {s.unusableSources.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-fail">
                    {s.unusableSources.map((u) => (
                      <li key={u.url}>
                        不可用：{u.title ?? u.url} —— {u.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* —— 台账明细 —— */}
      <SectionCard title={`来源明细（${sources.length}）`} description="按来源性质排序；「核对」会真实抓取该页面判断是否仍可访问。">
        {sources.length === 0 ? (
          <EmptyState>还没有登记任何外部来源。</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {sources.map((row) => {
              const issues = checkExternalSource(X.rowToInput(row));
              const blockers = issues.filter((i) => i.level === "block");
              return (
                <div key={row.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        row.source_kind === "independent"
                          ? "border-ok/30 bg-ok-soft font-normal text-ok"
                          : "border-border font-normal text-muted-foreground"
                      }
                    >
                      {sourceKindLabel(row.source_kind)}
                    </Badge>
                    <span className="text-sm font-medium">{row.title ?? row.url}</span>
                    <span className="text-xs text-muted-foreground">{row.platform}</span>
                    {row.topic && <span className="text-xs text-muted-foreground">· {row.topic}</span>}
                    {blockers.length > 0 && (
                      <Badge variant="outline" className="border-fail/30 bg-fail-soft font-normal text-fail">
                        {blockers.length} 项阻断
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                      {row.url}
                    </a>
                    {row.claim_key && <> · 支持事实 {row.claim_key}</>}
                    {row.published_at && <> · 发布于 {row.published_at.slice(0, 10)}</>}
                    {" · 上次核对 "}
                    {row.last_checked_at ? row.last_checked_at.slice(0, 16).replace("T", " ") : "从未"}
                  </div>
                  {row.last_note && <p className="mt-1 text-xs text-muted-foreground">核对结果：{row.last_note}</p>}
                  {issues.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {issues.map((i) => (
                        <li key={i.code} className={i.level === "block" ? "text-fail" : "text-warn"}>
                          · {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <form action={sourceCheck}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" size="sm" variant="outline" className="h-7">
                        <IconRefresh className="size-3.5" />
                        核对可用性
                      </Button>
                    </form>
                    <form action={sourceSetConflict} className="flex items-end gap-1.5">
                      <input type="hidden" name="id" value={row.id} />
                      <Input name="conflictNote" placeholder="与其它来源冲突的说明" className="h-7 w-60 text-xs" />
                      <Button type="submit" size="sm" variant="outline" className="h-7">
                        标记冲突
                      </Button>
                    </form>
                    <DangerForm action={sourceDelete} hidden={{ id: row.id }} label="删除" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* —— 登记来源 —— */}
      <SectionCard title="登记外部来源" description="同一 URL 不重复登记 —— 否则一篇文章会被当成两次独立背书。">
        <form action={sourceCreate} className="grid gap-3 sm:grid-cols-3">
          <Field label="来源性质" htmlFor="x-kind" hint="决定能否称为「独立测评」">
            <select id="x-kind" name="sourceKind" className={SELECT_CLS} required defaultValue="independent">
              {SOURCE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="平台" htmlFor="x-platform">
            <Input id="x-platform" name="platform" placeholder="行业媒体 / 知乎 / 地方新闻网" required />
          </Field>
          <Field label="发布日期" htmlFor="x-pub">
            <Input id="x-pub" name="publishedAt" type="date" />
          </Field>
          <div className="sm:col-span-3">
            <Field label="公开 URL" htmlFor="x-url" hint="只接受 http(s)，不含账号密码">
              <Input id="x-url" name="url" type="url" placeholder="https://media.example/article" required />
            </Field>
          </div>
          <Field label="标题" htmlFor="x-title" hint="核对时会用它判断页面内容是否已变">
            <Input id="x-title" name="title" placeholder="报道标题" />
          </Field>
          <Field label="内容主题" htmlFor="x-topic">
            <Input id="x-topic" name="topic" placeholder="产能 / 资质 / 交付" />
          </Field>
          <Field label="归属品牌" htmlFor="x-brand">
            <select id="x-brand" name="brandId" className={SELECT_CLS} defaultValue={brands[0]?.id ?? ""}>
              <option value="">（不指定）</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="支持的事实（已批准）" htmlFor="x-claim">
              <select id="x-claim" name="claimId" className={SELECT_CLS} defaultValue="">
                <option value="">（暂不绑定）</option>
                {approvedClaims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.claim_key}：{c.statement.slice(0, 40)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Field label="备注" htmlFor="x-note" hint="措辞里出现「独立测评」等说法时，自有来源会被判为阻断">
              <Textarea id="x-note" name="note" className="min-h-16 text-xs" />
            </Field>
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              登记来源
            </Button>
          </div>
        </form>
      </SectionCard>

      <p className="text-sm text-muted-foreground">
        报告只列仍可访问的来源。失效或与事实不符的来源会被排除，
        并提示替换 —— 引用一个 404 页面比不引用更伤可信度。
      </p>
    </div>
  );
}
