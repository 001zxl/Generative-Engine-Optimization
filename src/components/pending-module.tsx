import Link from "next/link";
import { IconTool, IconArrowLeft } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/**
 * 批次 2 待建模块的统一占位页。
 *
 * 刻意不使用假图表、假数字：空图表比没有图表更容易误导决策。
 * 这里只说明「这个模块要回答什么问题、依赖什么、数据表是否已就位」。
 */
export function PendingModule({
  title,
  question,
  depends,
  tables,
  schemaReady = true,
}: {
  title: string;
  question: string;
  depends: string[];
  tables: string[];
  schemaReady?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-2">
        <IconTool className="size-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Badge variant="secondary" className="font-normal">
          批次 2 · 待建
        </Badge>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">这个模块要回答的问题</CardTitle>
          <CardDescription className="text-sm text-foreground/80">{question}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Separator />
          <div>
            <div className="text-sm font-medium">依赖</div>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {depends.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              数据表
              {schemaReady ? (
                <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
                  已建好
                </Badge>
              ) : (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  待建
                </Badge>
              )}
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {schemaReady
                ? "批次 1 已按架构文档 §7 建好相关表，批次 2 可直接写入，不需要中途迁移："
                : "相关表尚未建立。"}
            </p>
            {schemaReady && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tables.map((t) => (
                  <code key={t} className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                    {t}
                  </code>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="mt-5 text-xs text-muted-foreground">
        为什么这里不放占位图表：空图表比没有图表更容易误导决策 —— 你会开始为一条并不存在的趋势做判断。
        该模块上线前，总览页会显式标注为「批次 2 待建」。
      </p>

      <Button asChild variant="outline" size="sm" className="mt-6">
        <Link href="/console">
          <IconArrowLeft className="size-3.5" />
          返回可见度总览
        </Link>
      </Button>
    </div>
  );
}
