import { getDb, workspaceId, audit } from "./index.ts";
import { newId, shareSlug, sha256 } from "../id.ts";
import type { CheckResult } from "../checks/types.ts";

export interface ToolRunRecord {
  id: string;
  tool: string;
  share_slug: string;
  input_json: string;
  result_json: string;
  is_public: number;
  created_at: string;
  referrer: string | null;
}

export interface LeadRecord {
  id: string;
  email: string | null;
  name: string | null;
  company: string | null;
  website: string | null;
  message: string | null;
  self_reported_source: string | null;
  source: string | null;
  status: string;
  /** 首次触点 JSON：referrer / landingPath / utm。B3 的归因展示依赖它 */
  first_touch_json?: string | null;
  created_at: string;
  owner?: string | null;
  next_follow_up_at?: string | null;
  notified_at?: string | null;
  notify_error?: string | null;
}

export function createToolRun(params: {
  tool: string;
  input: Record<string, unknown>;
  result: CheckResult;
  ipHash?: string | null;
  userAgent?: string | null;
  referrer?: string | null;
}): { id: string; shareSlug: string } {
  const db = getDb();
  const id = newId("run");
  const slug = shareSlug(12);
  const now = new Date().toISOString();
  const resultJson = JSON.stringify(params.result);

  db.prepare(
    `INSERT INTO tool_runs
      (id, workspace_id, tool, share_slug, input_json, result_json, is_public, status, ip_hash, user_agent, referrer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'done', ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId(),
    params.tool,
    slug,
    JSON.stringify({ ...params.input, contentHash: sha256(resultJson).slice(0, 16) }),
    resultJson,
    params.ipHash ?? null,
    params.userAgent ?? null,
    params.referrer ?? null,
    now,
  );

  return { id, shareSlug: slug };
}

export function getToolRunBySlug(slug: string): ToolRunRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM tool_runs WHERE share_slug = ?")
    .get(slug) as unknown as ToolRunRecord | undefined;
}

export function getToolRunById(id: string): ToolRunRecord | undefined {
  return getDb()
    .prepare("SELECT * FROM tool_runs WHERE id = ?")
    .get(id) as unknown as ToolRunRecord | undefined;
}

/** 用户主动选择公开后，结果页才允许被索引（默认 noindex，持链接可访问；§6.7 / §13） */
export function publishToolRun(id: string): boolean {
  const db = getDb();
  const row = getToolRunById(id);
  if (!row) return false;
  db.prepare("UPDATE tool_runs SET is_public = 1 WHERE id = ? AND workspace_id = ?").run(id, workspaceId());
  audit("publish", "tool_run", id, { previous: row.is_public });
  return true;
}

/**
 * 对外接口一律使用 share_slug（与结果页 URL 同一个标识），不对外暴露内部 row id。
 * slug 为 12 位、约 60 bit 熵，不可枚举。
 */
export function publishToolRunBySlug(slug: string): boolean {
  const row = getToolRunBySlug(slug);
  if (!row) return false;
  return publishToolRun(row.id);
}

export function recordEvent(params: {
  name: string;
  path?: string;
  referrer?: string | null;
  utm?: Record<string, string>;
  sessionId?: string | null;
  toolRunId?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO events (id, workspace_id, name, path, referrer, utm_json, session_id, tool_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("evt"),
      workspaceId(),
      params.name,
      params.path ?? null,
      params.referrer ?? null,
      JSON.stringify(params.utm ?? {}),
      params.sessionId ?? null,
      params.toolRunId ?? null,
      new Date().toISOString(),
    );
}

export function createLead(params: {
  email?: string | null;
  name?: string | null;
  company?: string | null;
  website?: string | null;
  message?: string | null;
  selfReportedSource?: string | null;
  source?: string | null;
  toolRunId?: string | null;
  firstTouch?: Record<string, unknown>;
  owner?: string | null;
  nextFollowUpAt?: string | null;
}): string {
  const db = getDb();
  const id = newId("lead");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO leads
      (id, workspace_id, email, name, company, website, message, self_reported_source, source, status,
       first_touch_json, tool_run_id, owner, next_follow_up_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId(),
    params.email ?? null,
    params.name ?? null,
    params.company ?? null,
    params.website ?? null,
    params.message ?? null,
    params.selfReportedSource ?? null,
    params.source ?? null,
    JSON.stringify(params.firstTouch ?? {}),
    params.toolRunId ?? null,
    params.owner ?? null,
    params.nextFollowUpAt ?? null,
    now,
    now,
  );
  audit("create", "lead", id, { source: params.source });
  return id;
}

/** 记录通知结果。失败原因要落库 —— 只在日志里报错等于没人知道线索没被提醒。 */
export function markLeadNotified(leadId: string, ok: boolean, error?: string): void {
  const db = getDb();
  if (ok) {
    db.prepare("UPDATE leads SET notified_at = ?, notify_error = NULL, updated_at = ? WHERE id = ? AND workspace_id = ?").run(
      new Date().toISOString(),
      new Date().toISOString(),
      leadId,
      workspaceId(),
    );
  } else {
    db.prepare("UPDATE leads SET notify_error = ?, updated_at = ? WHERE id = ? AND workspace_id = ?").run(
      error ?? "未知原因",
      new Date().toISOString(),
      leadId,
      workspaceId(),
    );
  }
}

/** 尚未成功通知过的线索（用于运营台显式列出，避免漏掉） */
export function listUnnotifiedLeads(limit = 50): LeadRecord[] {
  return getDb()
    .prepare(
      `SELECT * FROM leads WHERE workspace_id = ? AND notified_at IS NULL
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(workspaceId(), limit) as unknown as LeadRecord[];
}

export function assignLeadOwner(leadId: string, owner: string, nextFollowUpAt?: string): void {
  getDb()
    .prepare("UPDATE leads SET owner = ?, next_follow_up_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
    .run(owner, nextFollowUpAt ?? null, new Date().toISOString(), leadId, workspaceId());
  audit("assign", "lead", leadId, { owner, nextFollowUpAt: nextFollowUpAt ?? null });
}

export function listLeads(limit = 100): LeadRecord[] {
  return getDb()
    .prepare("SELECT * FROM leads WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(workspaceId(), limit) as unknown as LeadRecord[];
}

export interface ToolRunListItem {
  id: string;
  tool: string;
  share_slug: string;
  input_json: string;
  is_public: number;
  referrer: string | null;
  created_at: string;
  verdict: string;
  headline: string;
  fail: number;
  warn: number;
}

export function listToolRuns(limit = 100): ToolRunListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, tool, share_slug, input_json, is_public, referrer, created_at, result_json
       FROM tool_runs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(workspaceId(), limit) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    let verdict = "—";
    let headline = "";
    let fail = 0;
    let warn = 0;
    try {
      const parsed = JSON.parse(String(r.result_json)) as {
        summary?: { verdict?: string; headline?: string; fail?: number; warn?: number };
      };
      verdict = parsed.summary?.verdict ?? "—";
      headline = parsed.summary?.headline ?? "";
      fail = parsed.summary?.fail ?? 0;
      warn = parsed.summary?.warn ?? 0;
    } catch {
      /* 忽略解析失败 */
    }
    return {
      id: String(r.id),
      tool: String(r.tool),
      share_slug: String(r.share_slug),
      input_json: String(r.input_json),
      is_public: Number(r.is_public),
      referrer: (r.referrer as string | null) ?? null,
      created_at: String(r.created_at),
      verdict,
      headline,
      fail,
      warn,
    };
  });
}

export interface ConsoleStats {
  /* 顶部指标 */
  runsTotal: number;
  runs7d: number;
  leadsTotal: number;
  leads7d: number;
  leadsNew: number;
  events7d: number;
  publicRuns: number;
  /* 图表数据 */
  daily: Array<{ day: string; runs: number; leads: number; events: number }>;
  byTool: Array<{ tool: string; runs: number; critical: number; warn: number; leads: number }>;
  byVerdict: Array<{ verdict: string; n: number }>;
  byReferrer: Array<{ referrer: string; n: number }>;
  funnel: Array<{ stage: string; n: number }>;
  topSources: Array<{ source: string; n: number }>;
}

/**
 * 运营台首页的全部数据。
 *
 * 原则（呈现规范）：首页只回答"这些内容有没有带来访问和咨询"这一个问题，
 * 不做二三十个无关图表；每个数字都必须能追溯到原始记录。
 */
export function consoleStats(): ConsoleStats {
  const db = getDb();
  const ws = workspaceId();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const one = (sql: string, ...args: unknown[]) =>
    Number((db.prepare(sql).get(...(args as never[])) as { n?: number } | undefined)?.n ?? 0);
  const rows = <T,>(sql: string, ...args: unknown[]) =>
    db.prepare(sql).all(...(args as never[])) as unknown as T[];

  /* 近 7 天逐日：检查 / 线索 / 事件 */
  const daily: ConsoleStats["daily"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({
      day: d.slice(5),
      runs: one("SELECT COUNT(*) n FROM tool_runs WHERE workspace_id=? AND substr(created_at,1,10)=?", ws, d),
      leads: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=? AND substr(created_at,1,10)=?", ws, d),
      events: one("SELECT COUNT(*) n FROM events WHERE workspace_id=? AND substr(created_at,1,10)=?", ws, d),
    });
  }

  /* 一次遍历所有检查记录，同时算出「按工具」与「结论分布」。
     注意：必须在 JS 里逐条解析 result_json，不能用 GROUP BY tool —— 那样每组只会
     拿到任意一条记录，严重项计数会错。 */
  const toolAgg: Record<string, { tool: string; runs: number; critical: number; warn: number; leads: number }> = {};
  const verdictMap: Record<string, number> = {};
  for (const r of rows<{ tool: string; result_json: string }>(
    "SELECT tool, result_json FROM tool_runs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 1000",
    ws,
  )) {
    if (!toolAgg[r.tool]) toolAgg[r.tool] = { tool: r.tool, runs: 0, critical: 0, warn: 0, leads: 0 };
    toolAgg[r.tool].runs += 1;
    try {
      const summary = (JSON.parse(r.result_json) as { summary?: { verdict?: string; warn?: number } }).summary;
      const v = summary?.verdict ?? "unknown";
      verdictMap[v] = (verdictMap[v] ?? 0) + 1;
      if (v === "critical") toolAgg[r.tool].critical += 1;
      toolAgg[r.tool].warn += summary?.warn ?? 0;
    } catch {
      /* 忽略解析失败的单条记录，不影响其他统计 */
    }
  }
  const byTool = Object.values(toolAgg)
    .map((t) => ({
      ...t,
      leads: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=? AND source=?", ws, `result:${t.tool}`),
    }))
    .sort((a, b) => b.runs - a.runs);

  const eventCount = (name: string) => one("SELECT COUNT(*) n FROM events WHERE workspace_id=? AND name=?", ws, name);

  return {
    runsTotal: one("SELECT COUNT(*) n FROM tool_runs WHERE workspace_id=?", ws),
    runs7d: one("SELECT COUNT(*) n FROM tool_runs WHERE workspace_id=? AND created_at>=?", ws, since7),
    leadsTotal: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=?", ws),
    leads7d: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=? AND created_at>=?", ws, since7),
    leadsNew: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=? AND status='new'", ws),
    events7d: one("SELECT COUNT(*) n FROM events WHERE workspace_id=? AND created_at>=?", ws, since7),
    publicRuns: one("SELECT COUNT(*) n FROM tool_runs WHERE workspace_id=? AND is_public=1", ws),

    daily,
    byTool,
    byVerdict: Object.entries(verdictMap).map(([verdict, n]) => ({ verdict, n })),
    byReferrer: rows<{ referrer: string; n: number }>(
      `SELECT COALESCE(NULLIF(referrer,''),'(直接访问)') referrer, COUNT(*) n FROM tool_runs
       WHERE workspace_id=? GROUP BY referrer ORDER BY n DESC LIMIT 6`,
      ws,
    ),
    /* 关键行为计数（独立计数，非嵌套漏斗）—— 详见 console-charts.tsx 的说明 */
    funnel: [
      { stage: "完成检查", n: one("SELECT COUNT(*) n FROM tool_runs WHERE workspace_id=?", ws) },
      { stage: "打开结果页", n: eventCount("page_view") },
      { stage: "主动分享或公开", n: eventCount("tool_share") },
      { stage: "导出原始数据", n: eventCount("tool_export") },
      { stage: "提交线索", n: one("SELECT COUNT(*) n FROM leads WHERE workspace_id=?", ws) },
    ],
    topSources: rows<{ source: string; n: number }>(
      "SELECT COALESCE(source,'(未标注)') source, COUNT(*) n FROM leads WHERE workspace_id=? GROUP BY source ORDER BY n DESC LIMIT 6",
      ws,
    ),
  };
}
