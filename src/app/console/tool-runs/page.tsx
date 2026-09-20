import Link from "next/link";
import { IconHistory, IconExternalLink } from "@tabler/icons-react";
import { listToolRuns } from "@/lib/db/repo";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const TOOL_LABEL: Record<string, string> = {
  crawler: "AI 爬虫检查",
  citability: "内容可引用性",
};

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  critical: { label: "严重", cls: "border-fail/25 bg-fail-soft text-fail" },
  needs_work: { label: "需改进", cls: "border-warn/25 bg-warn-soft text-warn" },
  ok: { label: "通过", cls: "border-ok/25 bg-ok-soft text-ok" },
};

function targetOf(inputJson: string): string {
  try {
    const o = JSON.parse(inputJson) as { url?: string | null; textChars?: number | null };
    if (o.url) return o.url;
    if (o.textChars) return `粘贴正文（${o.textChars} 字符）`;
    return "—";
  } catch {
    return "—";
  }
}

export default function ToolRunsPage() {
  const runs = listToolRuns(200);

  return (
    <>
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IconHistory className="size-5 text-muted-foreground" />
          工具使用记录
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          共 {runs.length} 条。这一页回答的是「免费工具到底有没有人用、用在哪」——
          也是判断工具型获客是否成立的原始数据。
        </p>
      </div>

      {runs.length === 0 ? (
        <EmptyState>还没有检查记录。</EmptyState>
      ) : (
        <Card className="py-0">
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">时间</TableHead>
                  <TableHead>工具</TableHead>
                  <TableHead>检查目标</TableHead>
                  <TableHead>结论</TableHead>
                  <TableHead className="text-right">严重 / 待改</TableHead>
                  <TableHead>来路</TableHead>
                  <TableHead className="pr-6">结果页</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const style = VERDICT_STYLE[r.verdict] ?? {
                    label: r.verdict,
                    cls: "border-border text-muted-foreground",
                  };
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="pl-6 font-mono text-xs whitespace-nowrap">
                        {r.created_at.slice(0, 16).replace("T", " ")}
                      </TableCell>
                      <TableCell className="text-sm">{TOOL_LABEL[r.tool] ?? r.tool}</TableCell>
                      <TableCell className="max-w-64 font-mono text-xs break-all">{targetOf(r.input_json)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-normal ${style.cls}`}>
                          {style.label}
                        </Badge>
                        <div className="mt-1 max-w-56 text-xs text-muted-foreground">{r.headline}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="text-fail">{r.fail}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-warn">{r.warn}</span>
                      </TableCell>
                      <TableCell className="max-w-44 text-xs break-all text-muted-foreground">
                        {r.referrer ?? "（直接访问）"}
                      </TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center gap-2">
                          <Button asChild variant="ghost" size="sm" className="-ml-2">
                            <Link href={`/r/${r.share_slug}`}>
                              打开
                              <IconExternalLink className="size-3.5" />
                            </Link>
                          </Button>
                          {r.is_public === 1 && (
                            <Badge variant="outline" className="font-normal text-muted-foreground">
                              已公开
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
