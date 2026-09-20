import { NextResponse } from "next/server";
import { getToolRunBySlug, recordEvent } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 导出原始检查结果 JSON：客户可以拿去做自己的复核。参数是 share_slug。 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const row = getToolRunBySlug(slug);
  if (!row) return NextResponse.json({ error: "未找到该检查结果。" }, { status: 404 });

  recordEvent({ name: "tool_export", toolRunId: row.id });

  const payload = {
    tool: row.tool,
    shareSlug: row.share_slug,
    input: JSON.parse(row.input_json) as unknown,
    result: JSON.parse(row.result_json) as unknown,
    exportedAt: new Date().toISOString(),
    note: "本文件为原始检查输出，可用于独立复核。判定规则见 /methods。",
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="geo-check-${row.tool}-${row.share_slug}.json"`,
    },
  });
}
