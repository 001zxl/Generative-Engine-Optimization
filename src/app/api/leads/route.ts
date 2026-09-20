import { NextResponse, type NextRequest } from "next/server";
import { createLead, recordEvent } from "@/lib/db/repo";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, max);
}

export async function POST(req: NextRequest) {
  const ipHash = hashIp(clientIp(req));
  const limit = checkRateLimit(`lead:${ipHash}`, 6, 60 * 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "提交过于频繁，请稍后再试。" }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求格式不正确。" }, { status: 400 });

  const email = str(body.email, 200);
  const name = str(body.name, 100);
  const company = str(body.company, 200);
  const website = str(body.website, 300);
  const message = str(body.message, 2000);
  const selfReportedSource = str(body.selfReportedSource, 200);
  const source = str(body.source, 200);
  const toolRunId = str(body.toolRunId, 100);

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "请填写有效的邮箱地址。" }, { status: 400 });
  }
  // 极简蜜罐：正常用户不会填写这个字段
  if (typeof body.honeypot === "string" && body.honeypot.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const id = createLead({
    email,
    name,
    company,
    website,
    message,
    selfReportedSource,
    source,
    toolRunId,
    firstTouch: {
      referrer: req.headers.get("referer") ?? null,
      landingPath: str(body.landingPath, 300),
      utm: body.utm && typeof body.utm === "object" ? body.utm : {},
    },
  });

  recordEvent({ name: "lead_submit", path: source ?? undefined, toolRunId, referrer: req.headers.get("referer") });
  return NextResponse.json({ ok: true, leadId: id });
}
