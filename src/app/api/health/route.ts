import { NextResponse } from "next/server";
import { getDb, isPilotDb } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const row = getDb().prepare("SELECT 1 AS ok").get() as { ok: number };
    // pilot 字段用于让端到端脚本自查目标：写测试数据前必须确认不是试点库
    return NextResponse.json(
      { ok: row.ok === 1, pilot: isPilotDb() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch { return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
