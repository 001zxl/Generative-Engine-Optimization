import { NextResponse, type NextRequest } from "next/server";
import { runCrawlerCheck } from "@/lib/checks/crawler";
import { createToolRun, recordEvent } from "@/lib/db/repo";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ipHash = hashIp(clientIp(req));
  const limit = checkRateLimit(`crawl:${ipHash}`, 12, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `检查请求过于频繁，请在 ${limit.retryAfterSec} 秒后重试。` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  if (!url.trim()) {
    return NextResponse.json({ error: "请输入要检查的网址。" }, { status: 400 });
  }

  try {
    const result = await runCrawlerCheck(url);
    const run = createToolRun({
      tool: "crawler",
      input: { url },
      result,
      ipHash,
      userAgent: req.headers.get("user-agent"),
      referrer: req.headers.get("referer"),
    });
    recordEvent({ name: "tool_run", path: "/tools/ai-crawler-check", toolRunId: run.id });
    return NextResponse.json({ runId: run.id, shareSlug: run.shareSlug, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "检查失败，请稍后重试。" },
      { status: 400 },
    );
  }
}
