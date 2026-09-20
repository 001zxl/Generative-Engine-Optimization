import { NextResponse, type NextRequest } from "next/server";
import { runCitabilityCheck } from "@/lib/checks/citability";
import { createToolRun, recordEvent } from "@/lib/db/repo";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PASTED = 200_000;

export async function POST(req: NextRequest) {
  const ipHash = hashIp(clientIp(req));
  const limit = checkRateLimit(`cite:${ipHash}`, 12, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: `检查请求过于频繁，请在 ${limit.retryAfterSec} 秒后重试。` },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { url?: unknown; text?: unknown; heading?: unknown }
    | null;

  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const text = typeof body?.text === "string" ? body.text : "";
  const heading = typeof body?.heading === "string" ? body.heading : undefined;

  if (!url && !text.trim()) {
    return NextResponse.json({ error: "请提供页面地址，或粘贴正文内容。" }, { status: 400 });
  }
  if (text.length > MAX_PASTED) {
    return NextResponse.json(
      { error: `粘贴内容过长（上限 ${MAX_PASTED.toLocaleString("en-US")} 字符）。` },
      { status: 413 },
    );
  }

  try {
    const result = await runCitabilityCheck({ url: url || undefined, text: text || undefined, heading });
    const run = createToolRun({
      tool: "citability",
      input: { url: url || null, textChars: text.length || null, heading: heading ?? null },
      result,
      ipHash,
      userAgent: req.headers.get("user-agent"),
      referrer: req.headers.get("referer"),
    });
    recordEvent({ name: "tool_run", path: "/tools/citation-readiness", toolRunId: run.id });
    return NextResponse.json({ runId: run.id, shareSlug: run.shareSlug, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "检查失败，请稍后重试。" },
      { status: 400 },
    );
  }
}
