import { NextResponse, type NextRequest } from "next/server";
import { recordEvent } from "@/lib/db/repo";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "page_view",
  "tool_run",
  "tool_share",
  "tool_export",
  "lead_submit",
  "cta_click",
  "console_view",
]);

export async function POST(req: NextRequest) {
  const ipHash = hashIp(clientIp(req));
  const limit = checkRateLimit(`evt:${ipHash}`, 120, 10 * 60_000);
  if (!limit.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name : "";
  if (!ALLOWED.has(name)) return NextResponse.json({ ok: false, error: "未知事件类型" }, { status: 400 });

  recordEvent({
    name,
    path: typeof body?.path === "string" ? body.path.slice(0, 300) : undefined,
    referrer: req.headers.get("referer"),
    sessionId: typeof body?.sessionId === "string" ? body.sessionId.slice(0, 64) : null,
    toolRunId: typeof body?.toolRunId === "string" ? body.toolRunId.slice(0, 100) : null,
  });
  return NextResponse.json({ ok: true });
}
