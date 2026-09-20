import { NextResponse, type NextRequest } from "next/server";
import { publishToolRunBySlug } from "@/lib/db/repo";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主动公开结果页。参数是 share_slug（与结果页 URL 同一个标识，不对外暴露内部 row id）。
 *
 * 默认所有检查结果都是私有的（noindex），只有用户显式调用这个接口之后，
 * 结果页才允许被索引 —— 这是「私人检查默认不公开」的落地方式。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const ipHash = hashIp(clientIp(req));
  const limit = checkRateLimit(`publish:${ipHash}`, 30, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "操作过于频繁，请稍后重试。" }, { status: 429 });
  }

  const { slug } = await ctx.params;
  const ok = publishToolRunBySlug(slug);
  if (!ok) return NextResponse.json({ error: "未找到该检查结果。" }, { status: 404 });
  return NextResponse.json({ ok: true, publicUrl: `/r/${slug}` });
}
