import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    const row = getDb().prepare("SELECT 1 AS ok").get() as { ok: number };
    return NextResponse.json({ ok: row.ok === 1 }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
