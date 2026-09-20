import Link from "next/link";
import { IconChartHistogram, IconUserSearch, IconPlus } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { listLeads } from "@/lib/db/repo";
import { PageHead, SectionCard, Field, InlineForm, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { leadStatusUpdate, touchpointAdd } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "获客归因", robots: { index: false, follow: false } };

const STATUSES = [
  { value: "new", label: "待跟进" },
  { value: "contacted", label: "已联系" },
  { value: "qualified", label: "有意向" },
  { value: "won", label: "已成交" },
  { value: "lost", label: "已流失" },
];

const TOUCHPOINT_KINDS = [
  { value: "first_touch", label: "First Touch（首次接触）" },
  { value: "last_non_direct", label: "Last Non-direct（末次非直接）" },
  { value: "self_reported", label: "自述来源" },
  { value: "assist", label: "辅助触点" },
];

const SELECT_CLS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring";

/**
 * 模块 7：获客归因。
 *
 * 刻意不做多触点加权模型 —— 那会产出「看起来很精确、实际无法验证」的数字。
 * 这里只并列展示三种可解释的口径：First Touch、Last Non-direct、自述来源。
 * 客户可以自己判断该信哪个，而不是被一个黑盒权重说服。
 */
export default function AttributionPage() {
  const leads = listLeads(200);
  const summary = R.getAttributionSummary();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconChartHistogram}
        title="获客归因"
        description="打通「工具使用 → 结果分享 → 留资 → 跟进 → 成交」。不做多触点加权模型 —— 只并列展示三种可解释口径，让你自己判断该信哪个。"
        badge={
          <Badge variant="outline" className="font-normal">
            {leads.length} 条线索
          </Badge>
        }
      />

      {/* —— 三种归因口径 —— */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "First Touch", desc: "首次接触的落地页", rows: summary.firstTouch },
          { title: "Last Non-direct", desc: "最后一次非直接访问的来源", rows: summary.lastNonDirect },
          { title: "自述来源", desc: "客户自己填写的来源", rows: summary.selfReported },
        ].map((m) => (
          <Card key={m.title}>
            <CardHeader>
              <CardTitle className="text-sm">{m.title}</CardTitle>
              <CardDescription className="text-xs">{m.desc}</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {m.rows.length === 0 ? (
                <p className="px-6 pb-2 text-xs text-muted-foreground">暂无数据</p>
              ) : (
                <Table>
                  <TableBody>
                    {m.rows.map((r) => (
                      <TableRow key={r.label}>
                        <TableCell className="max-w-40 truncate pl-6 text-xs" title={r.label}>
                          {r.label}
                        </TableCell>
                        <TableCell className="pr-6 text-right tabular-nums text-xs">{r.n}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* —— 线索状态 —— */}
      <SectionCard
        title="线索与状态流转"
        description="每次状态变更都会写入历史表 —— 成交归因必须能追溯，不能只有一个最终状态。"
      >
        {leads.length === 0 ? (
          <EmptyState>
            还没有线索。
            <br />
            <span className="text-xs">
              到{" "}
              <Link href="/" className="text-primary underline-offset-4 hover:underline">
                公开站
              </Link>{" "}
              跑一次检查，结果页底部就是线索入口。
            </span>
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">时间</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead className="w-40">来源</TableHead>
                  <TableHead className="w-32">状态</TableHead>
                  <TableHead className="w-72">流转</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.slice(0, 40).map((l) => {
                  const history = R.listLeadHistory(l.id);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {l.created_at.slice(0, 16).replace("T", " ")}
                      </TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{l.email}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.company ?? "—"}
                          {l.website ? ` · ${l.website}` : ""}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {l.source ?? "—"}
                        {l.self_reported_source && (
                          <div className="text-xs">自述：{l.self_reported_source}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={l.status} />
                        {history.length > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">{history.length} 次变更</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <InlineForm action={leadStatusUpdate} submitLabel="更新状态">
                          <input type="hidden" name="leadId" value={l.id} />
                          <select
                            name="status"
                            className={SELECT_CLS}
                            style={{ width: "7.5rem", height: "2rem" }}
                            defaultValue={l.status}
                          >
                            {STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          <Input name="note" placeholder="备注" className="h-8 w-36" />
                        </InlineForm>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* —— 手工补触点 —— */}
      <SectionCard
        title="手工补记触点"
        description="系统只能自动记录站内可观测的行为。销售在微信/电话/展会上的接触需要人工补记，否则归因链会断。"
      >
        {leads.length === 0 ? (
          <EmptyState>需要先有线索。</EmptyState>
        ) : (
          <form action={touchpointAdd} className="grid gap-3 sm:grid-cols-4">
            <Field label="线索" htmlFor="tp-lead">
              <select id="tp-lead" name="leadId" className={SELECT_CLS} required>
                {leads.slice(0, 50).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.email ?? l.id.slice(-6)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="触点类型" htmlFor="tp-kind">
              <select id="tp-kind" name="kind" className={SELECT_CLS} defaultValue="assist">
                {TOUCHPOINT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="路径 / 位置" htmlFor="tp-path">
              <Input id="tp-path" name="path" placeholder="微信 / 广交会展位 A12" />
            </Field>
            <Field label="备注" htmlFor="tp-note">
              <Input id="tp-note" name="note" placeholder="客户提到…" />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm" variant="outline">
                <IconPlus className="size-3.5" />
                记录触点
              </Button>
            </div>
          </form>
        )}
      </SectionCard>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <IconUserSearch className="size-4 text-muted-foreground" />
            为什么不做多触点加权
          </CardTitle>
          <CardDescription>
            加权模型需要一个「各渠道贡献度」的先验，而那个先验在本行业没有任何可靠数据支撑。
            给出一个 0.3/0.2/0.5 的权重表，只会让结论看起来精确、实则不可验证。
            因此这里并列三种口径，把判断权交回给你。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
