import Link from "next/link";
import { IconUsers, IconAlertTriangle, IconCircleCheck, IconBellOff } from "@tabler/icons-react";
import { listLeads, listUnnotifiedLeads } from "@/lib/db/repo";
import { isNotifyConfigured } from "@/lib/notify";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "线索", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  new: "待跟进",
  contacted: "已联系",
  qualified: "有意向",
  won: "已成交",
  lost: "已流失",
};

function aging(createdAt: string): { text: string; urgent: boolean } {
  const h = (Date.now() - Date.parse(createdAt)) / 3_600_000;
  if (!Number.isFinite(h)) return { text: "—", urgent: false };
  if (h < 1) return { text: `${Math.max(1, Math.round(h * 60))} 分钟前`, urgent: false };
  if (h < 24) return { text: `${Math.round(h)} 小时前`, urgent: h >= 8 };
  return { text: `${Math.round(h / 24)} 天前`, urgent: true };
}

/**
 * 线索列表。
 *
 * 这一页要回答的核心问题不是"有哪些线索"，而是**"有没有线索被漏掉"**。
 * 因此三件事被显式呈现：
 *   1. 通知是否真的发出去了（notified_at / notify_error）
 *   2. 有没有指派跟进责任人
 *   3. 线索放了多久（未跟进的线索随时间贬值）
 */
export default function LeadsPage() {
  const leads = listLeads(200);
  const unnotified = listUnnotifiedLeads(200);
  const configured = isNotifyConfigured();
  const unowned = leads.filter((l) => !l.owner);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconUsers className="size-5 text-muted-foreground" />
          线索
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          共 {leads.length} 条。来源标注为「result:工具名」表示该线索是在查看检查结果页时提交的。
        </p>
      </div>

      {/* —— 通知通道状态：没配就必须显眼 —— */}
      {!configured && (
        <Alert className="border-warn/30 bg-warn-soft">
          <IconBellOff className="size-4 text-warn" />
          <AlertTitle>未配置线索提醒通道</AlertTitle>
          <AlertDescription>
            新线索会正常入库，但<strong>不会提醒任何人</strong> —— 你只在主动打开这一页时才会发现。
            正式获客前请配置环境变量 <code className="font-mono">LEAD_NOTIFY_WEBHOOK</code>
            （钉钉 / 企业微信 / 飞书机器人的入站 Webhook 均可，按 URL 自动识别格式）。
          </AlertDescription>
        </Alert>
      )}

      {configured && unnotified.length > 0 && (
        <Alert className="border-warn/30 bg-warn-soft">
          <IconAlertTriangle className="size-4 text-warn" />
          <AlertTitle>有 {unnotified.length} 条线索未能成功通知</AlertTitle>
          <AlertDescription>
            这些线索已入库但提醒未送达，请手工核对。最近一次失败原因见下表「通知」列。
          </AlertDescription>
        </Alert>
      )}

      {configured && unnotified.length === 0 && leads.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCircleCheck className="size-4 text-ok" />
          所有线索均已成功通知
        </div>
      )}

      {unowned.length > 0 && (
        <p className="text-sm text-muted-foreground">
          其中 <strong className="text-foreground">{unowned.length}</strong> 条尚未指派跟进责任人。
          没有责任人的线索等于没人跟进。
        </p>
      )}

      {leads.length === 0 ? (
        <EmptyState>
          还没有线索。
          <br />
          <span className="text-xs">
            去公开站跑一次检查，
            <Link href="/" className="mx-0.5 font-medium text-primary underline-offset-4 hover:underline">
              结果页
            </Link>
            底部就是线索入口。
          </span>
        </EmptyState>
      ) : (
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">时间 / 存放时长</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead className="w-28">通知</TableHead>
                  <TableHead className="w-28">责任人</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="pr-6">留言</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => {
                  const age = aging(l.created_at);
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="pl-6 font-mono text-xs whitespace-nowrap">
                        {l.created_at.slice(0, 16).replace("T", " ")}
                        <div className={age.urgent ? "text-fail" : "text-muted-foreground"}>
                          {age.text}
                          {age.urgent && " ⚠"}
                        </div>
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
                        {l.self_reported_source && <div className="text-xs">自述：{l.self_reported_source}</div>}
                      </TableCell>
                      <TableCell>
                        {l.notified_at ? (
                          <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
                            已通知
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-warn/25 bg-warn-soft font-normal text-warn"
                            title={l.notify_error ?? undefined}
                          >
                            未通知
                          </Badge>
                        )}
                        {l.notify_error && (
                          <div className="mt-1 line-clamp-2 text-xs text-fail" title={l.notify_error}>
                            {l.notify_error}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {l.owner ?? <span className="text-muted-foreground">未指派</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">
                          {STATUS_LABEL[l.status] ?? l.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-56 pr-6 text-xs text-muted-foreground">{l.message ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        指派责任人与状态流转在{" "}
        <Link href="/console/attribution" className="font-medium text-primary underline-offset-4 hover:underline">
          获客归因
        </Link>{" "}
        页操作。
      </p>
    </div>
  );
}
