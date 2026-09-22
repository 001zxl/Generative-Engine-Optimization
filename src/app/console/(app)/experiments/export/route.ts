import { requireConsoleSession } from "@/lib/console-auth";
import { compareExperiment } from "@/lib/experiments";
import { audit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await requireConsoleSession();
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  try {
    const result = compareExperiment(id, url.searchParams.get("run") ?? undefined);
    audit("export", "geo_experiment", id, { runId: result.runId });
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), ...result }, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="geo-experiment-${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json"`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "导出失败" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
