import Link from "next/link";
import { IconFileText, IconPlus, IconSend, IconLink } from "@tabler/icons-react";
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
import { assetCreate, assetPublish, assetReview, briefCreate, channelCreate } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "内容与推广", robots: { index: false, follow: false } };

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

const CHANNEL_KINDS = [
  { value: "owned", label: "自有（官网/博客/帮助中心）" },
  { value: "earned", label: "赢得（媒体/协会/合作方）" },
  { value: "community", label: "社区（问答/论坛）" },
  { value: "social", label: "社交（公众号/小红书/领英）" },
  { value: "directory", label: "目录（行业名录/企业库）" },
  { value: "partner", label: "伙伴（客户案例/联合研究）" },
];

/**
 * 模块 6：内容任务与发布。
 *
 * 闭环是「问题缺口 → Brief → 内容 → 审核 → 发布 → 回填 URL → 复测」。
 * 刻意不做自动发布：第三方平台一律人工确认后回填 URL，避免违反平台规则
 * 与出现未经审核的内容。
 */
export default function ContentPage() {
  const briefs = R.listBriefs();
  const assets = R.listAssets();
  const channels = R.listChannels();
  const publications = R.listPublications();
  const questions = R.listQuestions().slice(0, 60);
  const claims = R.listClaims().filter((c) => c.status === "approved");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconFileText}
        title="内容与推广"
        description="把「诊断出的缺口」变成「已发布的内容」。不做自动发布 —— 第三方平台一律人工确认后回填 URL，避免违反平台规则或发布未经审核的内容。"
        badge={
          <Badge variant="outline" className="font-normal">
            {assets.length} 篇内容 · {publications.length} 次发布
          </Badge>
        }
      />

      {/* —— Brief —— */}
      <SectionCard
        title="内容 Brief"
        description="每个 Brief 应对应一个已诊断出的问题缺口（哪类提问我们完全没出现）。"
      >
        {briefs.length === 0 ? (
          <EmptyState>还没有 Brief。</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {briefs.map((b) => (
              <div key={b.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.title}</span>
                  <StatusPill status={b.status} />
                  <span className="ml-auto text-xs text-muted-foreground">{b.asset_count} 篇产出</span>
                </div>
                {b.gap_reason && <p className="mt-1.5 text-xs text-muted-foreground">缺口：{b.gap_reason}</p>}
                {b.outline && <p className="mt-1 text-xs text-muted-foreground">提纲：{b.outline}</p>}
              </div>
            ))}
          </div>
        )}

        <form action={briefCreate} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          <Field label="Brief 标题" htmlFor="b-title">
            <Input id="b-title" name="title" placeholder="小批量铝型材开模的完整报价指南" required />
          </Field>
          <Field label="缺口原因" htmlFor="b-gap" hint="来自哪个问题、竞品是否已覆盖">
            <Input id="b-gap" name="gapReason" placeholder="问题「500 件能开模吗」竞品出现 8 次、我们 0 次" />
          </Field>
          <Field label="提纲" htmlFor="b-outline">
            <Input id="b-outline" name="outline" placeholder="起订量 → 开模费 → 交期 → 案例" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" variant="outline">
              <IconPlus className="size-3.5" />
              创建 Brief
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 内容资产 —— */}
      <SectionCard title="内容资产" description="绑定问题与已批准的事实 —— 这让「内容是否真的在回答缺口」可被检查。">
        {assets.length === 0 ? (
          <EmptyState>还没有内容。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-24">类型</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-20 text-right">发布</TableHead>
                  <TableHead className="w-56">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="font-medium">{a.title}</div>
                      {a.slug && <div className="font-mono text-xs text-muted-foreground">/{a.slug}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.kind}</TableCell>
                    <TableCell>
                      <StatusPill status={a.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{a.pub_count}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        {a.status !== "approved" && a.status !== "published" && (
                          <InlineForm action={assetReview} submitLabel="审核通过">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="decision" value="approved" />
                          </InlineForm>
                        )}
                        {a.status === "approved" && (
                          <form action={assetPublish} className="flex flex-wrap items-center gap-1.5">
                            <input type="hidden" name="id" value={a.id} />
                            <Input name="url" placeholder="发布后的 URL" className="h-7 w-44 text-xs" required />
                            <select name="channelId" className={SELECT_CLS} style={{ width: "8.5rem", height: "1.75rem" }}>
                              <option value="">渠道…</option>
                              {channels.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              <IconSend className="size-3.5" />
                              回填
                            </Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* —— 新建内容 —— */}
      <SectionCard title="新建内容" description="选中它要回答的问题、以及允许引用的事实 —— 未批准的事实不应进入对外内容。">
        {questions.length === 0 ? (
          <EmptyState>需要先在问题库建立问题。</EmptyState>
        ) : (
          <form action={assetCreate} className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="标题" htmlFor="a-title">
                <Input id="a-title" name="title" placeholder="铝合金型材最小起订量（MOQ）怎么算" required />
              </Field>
              <Field label="类型" htmlFor="a-kind">
                <select id="a-kind" name="kind" className={SELECT_CLS} defaultValue="article">
                  <option value="article">文章</option>
                  <option value="faq">FAQ</option>
                  <option value="comparison">对比选型</option>
                  <option value="research">研究/数据</option>
                  <option value="case">案例</option>
                </select>
              </Field>
              <Field label="作者" htmlFor="a-author">
                <Input id="a-author" name="author" placeholder="张工（材料工程师）" />
              </Field>
            </div>

            <Field label="正文（Markdown）" htmlFor="a-body" hint="建议第一段就直答问题，随后用表格与列表展开。">
              <Textarea id="a-body" name="bodyMd" className="min-h-24 font-mono text-xs" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="关联问题（可多选）">
                <div className="max-h-40 overflow-auto rounded-md border p-2">
                  {questions.slice(0, 30).map((q) => (
                    <label key={q.id} className="flex items-start gap-2 py-0.5 text-xs">
                      <input type="checkbox" name="questionIds" value={q.id} className="mt-0.5" />
                      <span className="line-clamp-2">{q.text}</span>
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="引用的事实（仅已批准，可多选）">
                <div className="max-h-40 overflow-auto rounded-md border p-2">
                  {claims.length === 0 && (
                    <p className="text-xs text-muted-foreground">没有已批准的事实，先到「事实与证据」批准。</p>
                  )}
                  {claims.map((c) => (
                    <label key={c.id} className="flex items-start gap-2 py-0.5 text-xs">
                      <input type="checkbox" name="claimIds" value={c.id} className="mt-0.5" />
                      <span className="line-clamp-2">
                        <span className="font-mono">{c.claim_key}</span> {c.statement}
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
            </div>

            <div>
              <Button type="submit" size="sm">
                <IconPlus className="size-3.5" />
                创建内容（草稿）
              </Button>
            </div>
          </form>
        )}
      </SectionCard>

      {/* —— 渠道 —— */}
      <SectionCard
        title="发布渠道"
        description="不同内容类型匹配不同渠道：原始研究适合媒体与伙伴，FAQ 适合官网与社区。"
      >
        {channels.length === 0 ? (
          <EmptyState>还没有渠道。</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {channels.map((c) => (
              <Badge key={c.id} variant="outline" className="font-normal">
                {c.name}
                <span className="ml-1 text-muted-foreground">
                  {CHANNEL_KINDS.find((k) => k.value === c.kind)?.label.split("（")[0] ?? c.kind}
                </span>
              </Badge>
            ))}
          </div>
        )}
        <InlineForm action={channelCreate} submitLabel="添加渠道" className="mt-3">
          <select name="kind" className={SELECT_CLS} style={{ width: "16rem", height: "2rem" }} defaultValue="owned">
            {CHANNEL_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <Input name="name" placeholder="渠道名称" className="h-8 w-48" required />
        </InlineForm>
      </SectionCard>

      {/* —— 发布记录 —— */}
      {publications.length > 0 && (
        <SectionCard title={`发布记录（${publications.length}）`} description="回填的 URL 是后续「引用检查」的输入。">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>内容</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-32">发布时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {publications.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">{p.asset_title ?? "—"}</TableCell>
                  <TableCell>
                    {p.url ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 font-mono text-xs text-primary underline-offset-4 hover:underline"
                      >
                        <IconLink className="size-3" />
                        {p.url.slice(0, 60)}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {(p.published_at ?? "").slice(0, 16).replace("T", " ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionCard>
      )}

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-sm">闭环的下一步</CardTitle>
          <CardDescription>
            内容发布并回填 URL 后，应对同一批问题做第二次采样，用{" "}
            <Link href="/console/evaluation" className="font-medium text-primary underline-offset-4 hover:underline">
              评估与指标
            </Link>{" "}
            对比基线与复测 —— 这才是「内容有没有起作用」的唯一可验证答案。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
