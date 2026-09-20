import Link from "next/link";
import { IconHelpCircle, IconPlus, IconLock, IconUsers } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field, InlineForm, DangerForm, StatusPill } from "@/components/console-form";
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
import { personaCreate, qsCreate, qsFreeze, questionAdd, questionDelete } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "问题库", robots: { index: false, follow: false } };

const INTENTS = ["认知", "比较", "操作", "风险", "交易", "品牌", "替代"];
const STAGES = ["早期", "中期", "后期"];

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 2：客户问题库。
 *
 * 核心机制是 **Query Set 冻结**：冻结后问题不可直接编辑，只能新建版本。
 * 没有一份固定的问题集，复测就没有可比性 ——「可见度变化」也就无法被证明。
 */
export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ qs?: string }>;
}) {
  const { qs } = await searchParams;
  const querySets = R.listQuerySets();
  const selected = qs ? querySets.find((q) => q.id === qs) : querySets[0];
  const questions = selected ? R.listQuestions(selected.id) : [];
  const personas = R.listPersonas();
  const frozen = selected?.status === "frozen";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconHelpCircle}
        title="客户问题库"
        description="GEO 的指标全部建立在「固定问题集」之上：同一批问题反复采样，才能证明可见度真的变了。因此冻结后的版本不可直接编辑，只能新建版本。"
      />

      <SectionCard
        title="问题集（Query Set）"
        description="建议只维护一份「监测集」并冻结，探索性新问题另开一个草稿集。"
      >
        {querySets.length === 0 ? (
          <EmptyState>还没有问题集。</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {querySets.map((q) => (
              <div
                key={q.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 ${
                  selected?.id === q.id ? "border-primary/30 bg-brand-soft" : ""
                }`}
              >
                <Link href={`/console/questions?qs=${q.id}`} className="font-medium underline-offset-4 hover:underline">
                  {q.name}
                </Link>
                <Badge variant="outline" className="font-mono text-xs">
                  v{q.version}
                </Badge>
                <StatusPill status={q.status} />
                <span className="text-xs text-muted-foreground">{q.question_count} 条问题</span>
                {q.frozen_at && (
                  <span className="text-xs text-muted-foreground">
                    冻结于 {q.frozen_at.slice(0, 16).replace("T", " ")}
                  </span>
                )}
                <div className="ml-auto">
                  {q.status !== "frozen" ? (
                    <InlineForm action={qsFreeze} submitLabel="冻结此版本">
                      <input type="hidden" name="id" value={q.id} />
                    </InlineForm>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <IconLock className="size-3.5" />
                      已冻结，不可编辑
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <form action={qsCreate} className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4">
          <Field label="新建问题集名称">
            <Input name="name" placeholder="海外买家监测集 V1" className="h-8 w-72" required />
          </Field>
          <Button type="submit" size="sm" variant="outline">
            <IconPlus className="size-3.5" />
            新建
          </Button>
        </form>
      </SectionCard>

      {selected && (
        <SectionCard
          title={`问题清单 · ${selected.name}`}
          description={
            frozen
              ? "该版本已冻结。要新增问题请新建一个问题集版本 —— 这是保证复测可比性的代价，也是它的价值。"
              : "每行一条。建议写客户真实会问 AI 的完整问句，而不是关键词。"
          }
          action={<span className="text-xs text-muted-foreground">共 {questions.length} 条</span>}
        >
          {questions.length === 0 ? (
            <EmptyState>这个问题集还没有问题。</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>问题</TableHead>
                    <TableHead className="w-20">意图</TableHead>
                    <TableHead className="w-24">漏斗阶段</TableHead>
                    <TableHead className="w-24">地区 / 语言</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {questions.map((q, i) => (
                    <TableRow key={q.id}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{q.text}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{q.intent ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{q.funnel_stage ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{q.locale}</TableCell>
                      <TableCell>
                        {!frozen && <DangerForm action={questionDelete} hidden={{ id: q.id }} label="删除" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <form action={questionAdd} className="mt-4 flex flex-col gap-3 border-t pt-4">
            <input type="hidden" name="querySetId" value={selected.id} />
            <Field
              label="批量添加问题（每行一条）"
              htmlFor="q-texts"
              hint={
                frozen
                  ? "当前版本已冻结，提交将被拒绝。请先新建一个问题集。"
                  : "例：Which Chinese suppliers handle small MOQ aluminum profile orders?"
              }
            >
              <Textarea
                id="q-texts"
                name="texts"
                className="min-h-32 font-mono text-xs"
                placeholder={
                  "海外买家如何筛选中国铝型材供应商？\nWhich Chinese suppliers handle small MOQ orders?\n铝合金型材最小起订量一般是多少？"
                }
                disabled={frozen}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="意图">
                <select name="intent" className={SELECT_CLS} defaultValue="">
                  <option value="">不指定</option>
                  {INTENTS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="漏斗阶段">
                <select name="funnelStage" className={SELECT_CLS} defaultValue="">
                  <option value="">不指定</option>
                  {STAGES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="地区 / 语言">
                <Input name="locale" defaultValue="zh-CN" className="h-9" />
              </Field>
            </div>
            <div>
              <Button type="submit" size="sm" disabled={frozen}>
                <IconPlus className="size-3.5" />
                添加问题
              </Button>
            </div>
          </form>
        </SectionCard>
      )}

      <SectionCard
        title="买家角色（Persona）"
        description="同一批问题按角色拆分后，可以看清「哪类买家完全没见过我们」。"
      >
        {personas.length === 0 ? (
          <EmptyState>还没有买家角色。</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {personas.map((p) => (
              <Badge key={p.id} variant="outline" className="font-normal">
                <IconUsers className="size-3.5" />
                {p.name}
              </Badge>
            ))}
          </div>
        )}
        <InlineForm action={personaCreate} submitLabel="添加角色" className="mt-3">
          <Input name="name" placeholder="欧洲中小品牌采购" className="h-8 w-52" required />
          <Input name="description" placeholder="描述（可选）" className="h-8 w-52" />
        </InlineForm>
      </SectionCard>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-sm">下一步</CardTitle>
          <CardDescription>
            问题集冻结后，到{" "}
            <Link href="/console/sampling" className="font-medium text-primary underline-offset-4 hover:underline">
              多平台采样
            </Link>{" "}
            按「问题 × 引擎」生成采样任务，然后逐条粘贴真实回答。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
