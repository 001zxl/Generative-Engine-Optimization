import { IconFileCheck, IconPlus, IconAlertTriangle, IconBan } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field, InlineForm, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { claimCreate, claimReview, evidenceAdd, phraseAdd } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "事实与证据", robots: { index: false, follow: false } };

const EVIDENCE_LEVELS = [
  { value: "third_party", label: "第三方（媒体/协会/评测）" },
  { value: "official", label: "官方（认证/检测报告/标准）" },
  { value: "audited", label: "审计/年报" },
  { value: "self", label: "自述（仅官网）" },
];

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 3：品牌事实与证据库。
 *
 * 两个用途：
 *  1. 作为「事实一致性」评估的比对基准 —— AI 说错了什么，要有权威版本可对照
 *  2. 作为内容生产的约束 —— 未批准的事实不能进入对外内容
 *
 * 注意：只有「已批准」的 Claim 会参与评估，草稿不会被拿去比对。
 */
export default function ClaimsPage() {
  const claims = R.listClaims();
  const conflicts = R.listClaimConflicts();
  const phrases = R.listProhibitedPhrases();
  const approvedCount = claims.filter((c) => c.status === "approved").length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconFileCheck}
        title="品牌事实与证据"
        description="事实库既是「AI 说错了什么」的比对基准，也是内容生产的约束来源。只有状态为「已批准」的事实才会参与一致性评估。"
        badge={
          <Badge variant="outline" className="font-normal">
            已批准 {approvedCount} / {claims.length}
          </Badge>
        }
      />

      {conflicts.length > 0 && (
        <Card className="border-warn/30 bg-warn-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <IconAlertTriangle className="size-4 text-warn" />
              检测到 {conflicts.length} 组事实冲突
            </CardTitle>
            <CardDescription>
              同一个 claim key 下存在多条不同陈述。评估时会出现自相矛盾的比对基准，请先收敛。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {conflicts.map((c) => (
              <div key={c.claim_key} className="rounded-md border border-warn/25 bg-background p-2">
                <span className="font-mono text-xs font-medium">{c.claim_key}</span>
                <span className="ml-2 text-xs text-muted-foreground">（{c.n} 个不同版本）</span>
                <div className="mt-1 text-xs text-muted-foreground">{c.statements}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <SectionCard title="事实清单（Claim）" description="claim key 是机器可读标识（如 moq、lead_time），用于按维度比对。">
        {claims.length === 0 ? (
          <EmptyState>还没有事实条目。</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            {claims.map((c) => {
              const evs = R.listEvidences(c.id);
              return (
                <div key={c.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-primary">{c.claim_key}</span>
                    <StatusPill status={c.status} />
                    {c.category && (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        {c.category}
                      </Badge>
                    )}
                    {c.valid_until && (
                      <span className="text-xs text-muted-foreground">有效期至 {c.valid_until}</span>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{evs.length} 条证据</span>
                  </div>
                  <p className="mt-2 text-sm">{c.statement}</p>

                  {evs.length > 0 && (
                    <div className="mt-3 flex flex-col gap-1">
                      {evs.map((e) => (
                        <div key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className="font-normal text-muted-foreground">
                            {EVIDENCE_LEVELS.find((l) => l.value === e.evidence_level)?.label ?? e.evidence_level}
                          </Badge>
                          {e.url ? (
                            <a
                              href={e.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="text-primary underline-offset-4 hover:underline"
                            >
                              {e.title}
                            </a>
                          ) : (
                            <span>{e.title}</span>
                          )}
                          {e.publisher && <span className="text-muted-foreground">· {e.publisher}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-start gap-4 border-t pt-3">
                    <InlineForm action={claimReview} submitLabel={c.status === "approved" ? "驳回" : "批准"}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="decision" value={c.status === "approved" ? "rejected" : "approved"} />
                    </InlineForm>

                    <InlineForm action={evidenceAdd} submitLabel="添加证据" className="flex-1">
                      <input type="hidden" name="claimId" value={c.id} />
                      <Input name="title" placeholder="证据标题" className="h-8 w-44" required />
                      <Input name="url" placeholder="链接（可选）" className="h-8 w-52" />
                      <Input name="publisher" placeholder="发布方" className="h-8 w-32" />
                      <select name="evidenceLevel" className={SELECT_CLS} style={{ width: "12rem", height: "2rem" }}>
                        {EVIDENCE_LEVELS.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </InlineForm>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="新增事实"
        description="陈述里尽量带上具体数值（如「500 件起订」）—— 事实一致性评估依赖数值比对，纯形容词无法自动核验。"
      >
        <form action={claimCreate} className="grid gap-3 sm:grid-cols-4">
          <Field label="claim key" htmlFor="c-key" hint="机器标识，如 moq">
            <Input id="c-key" name="claimKey" placeholder="moq" required />
          </Field>
          <Field label="分类" htmlFor="c-cat">
            <Input id="c-cat" name="category" placeholder="交付 / 资质 / 产能" />
          </Field>
          <Field label="有效期至" htmlFor="c-valid" hint="留空表示长期有效">
            <Input id="c-valid" name="validUntil" type="date" />
          </Field>
          <Field label="数值（用于自动核验）" htmlFor="c-num" hint="可选，如 500 件">
            <Input id="c-num" name="numHint" placeholder="500 件" disabled title="数值直接从陈述中解析，此处仅作提示" />
          </Field>
          <div className="sm:col-span-4">
            <Field label="对外标准陈述" htmlFor="c-stmt">
              <Textarea
                id="c-stmt"
                name="statement"
                className="min-h-20 text-sm"
                placeholder="标准规格 500 件起订，定制开模 3000 件起订，常规交期 12 个工作日。"
                required
              />
            </Field>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              创建（状态为草稿）
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="禁用表述"
        description="这些词不应出现在对外内容里。与工具 B 的「绝对化表述词表」互补 —— 这里是客户自定义的行业红词。"
      >
        {phrases.length === 0 ? (
          <EmptyState>还没有禁用表述。</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {phrases.map((p) => (
              <Badge
                key={p.id}
                variant="outline"
                className={p.severity === "block" ? "border-fail/25 bg-fail-soft text-fail" : "font-normal"}
              >
                <IconBan className="size-3.5" />
                {p.phrase}
              </Badge>
            ))}
          </div>
        )}
        <InlineForm action={phraseAdd} submitLabel="添加" className="mt-3">
          <Input name="phrase" placeholder="如：100% 保证" className="h-8 w-52" required />
          <select name="severity" className={SELECT_CLS} style={{ width: "10rem", height: "2rem" }} defaultValue="warn">
            <option value="warn">提醒</option>
            <option value="block">禁止</option>
          </select>
          <Input name="reason" placeholder="原因（可选）" className="h-8 w-52" />
        </InlineForm>
      </SectionCard>

      {approvedCount === 0 && claims.length > 0 && (
        <Card className="border-warn/25 bg-warn-soft">
          <CardHeader>
            <CardTitle className="text-sm">还没有已批准的事实</CardTitle>
            <CardDescription>
              事实一致性评估只会拿「已批准」的条目做比对。请至少批准一条，否则评估里的
              <span className="font-mono text-xs"> facts </span>
              环节不会产出任何结论。
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
