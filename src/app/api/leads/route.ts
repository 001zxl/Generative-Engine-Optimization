import { NextResponse, type NextRequest } from "next/server";
import { createLead, markLeadNotified, recordEvent } from "@/lib/db/repo";
import { notifyLead } from "@/lib/notify";
import { site } from "@/lib/site";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { hashIp } from "@/lib/id";
import { checkLeadEmail } from "@/lib/lead-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const emailCheck = checkLeadEmail(email);
  if (!emailCheck.ok) {
    // 保留域名不是「格式错误」，而是测试数据 —— 如实说明原因，不假装成功
    return NextResponse.json({ error: emailCheck.message }, { status: 400 });
  }
  // 极简蜜罐：正常用户不会填写这个字段
  if (typeof body.honeypot === "string" && body.honeypot.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const createdAt = new Date().toISOString();
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

  // 先入库、再通知：通知失败绝不能影响线索保存。
  // 失败原因写回 leads.notify_error，运营台可见 —— 不静默丢掉。
  try {
    const r = await notifyLead({
      leadId: id,
      email,
      company,
      website,
      message,
      source,
      selfReportedSource,
      createdAt,
      consoleUrl: `${site.baseUrl}/console/leads`,
    });
    if (r.ok) {
      markLeadNotified(id, true);
    } else if (r.skipped === "not_configured") {
      markLeadNotified(id, false, "未配置 LEAD_NOTIFY_WEBHOOK，未发出任何提醒");
    } else {
      markLeadNotified(id, false, r.error ?? "未知原因");
    }
  } catch (e) {
    markLeadNotified(id, false, e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({ ok: true, leadId: id });
}
