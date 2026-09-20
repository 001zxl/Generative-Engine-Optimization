import Link from "next/link";
import { IconUsers } from "@tabler/icons-react";
import { listLeads } from "@/lib/db/repo";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

const STATUS_LABEL: Record<string, string> = {
  new: "待跟进",
  contacted: "已联系",
  qualified: "有意向",
  won: "已成交",
  lost: "已流失",
};

export default function LeadsPage() {
  const leads = listLeads(200);

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconUsers className="size-5 text-muted-foreground" />
          线索
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          共 {leads.length} 条。来源标注为「result:工具名」表示该线索是在查看检查结果页时提交的。
        </p>
      </div>

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
                  <TableHead className="pl-6">时间</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>公司 / 网站</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>自述来源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="pr-6">留言</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-6 font-mono text-xs whitespace-nowrap">
                      {l.created_at.slice(0, 16).replace("T", " ")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.email}</TableCell>
                    <TableCell>
                      {l.company ?? "—"}
                      {l.website && (
                        <>
                          <br />
                          <span className="font-mono text-xs text-muted-foreground">{l.website}</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{l.source ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{l.self_reported_source ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {STATUS_LABEL[l.status] ?? l.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-64 pr-6 text-xs text-muted-foreground">{l.message ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        批次 1 只做记录与展示。线索状态流转、多触点归因（First / Last non-direct / 自述）在后续批次补上；
        数据表 <code className="font-mono">leads.first_touch_json</code> 已按此设计预留。
      </p>
    </>
  );
}
