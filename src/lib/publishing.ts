import { getDb, workspaceId, audit } from "./db/index.ts";
import { newId, sha256 } from "./id.ts";
import { fetchPage } from "./net/fetch-page.ts";
import { parseRobots, isAllowed, declaredSitemaps } from "./net/robots.ts";
import { CRITICAL_BOTS } from "./checks/bots.ts";
import { markdownToHtml, markdownToPlainText } from "./markdown.ts";
import { buildPublicationStatus, type CitationEvidence, type PublicationStatusView } from "./publication-status.ts";
import { articleJsonLd as articleJsonLdFrom, serializeJsonLd } from "./jsonld.ts";

export const PUBLISH_CHANNELS = [
  { id: "own_site", name: "本站知识页" },
  { id: "wordpress", name: "WordPress" },
  { id: "webhook", name: "已配置的发布 Webhook" },
] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number]["id"];
export type DispatchStatus = "pending" | "sending" | "succeeded" | "failed" | "uncertain";
export interface EvidenceLink { title: string; url: string; publisher: string | null; evidenceLevel: string }
export interface PublishSnapshot { title: string; body: string; author: string; evidences: EvidenceLink[] }
export interface PublicationDispatch {
  id: string; asset_id: string; task_id: string; publication_id: string | null;
  channel: PublishChannel; status: DispatchStatus; idempotency_key: string;
  content_hash: string; slug: string; snapshot_json: string; attempts: number;
  remote_id: string | null; published_url: string | null; error: string | null;
  created_at: string; updated_at: string;
}
export interface PublishedKnowledge extends PublishSnapshot {
  id: string; slug: string; url: string; publishedAt: string;
}
const timestamp = () => new Date().toISOString();
const siteBase = () => (process.env.APP_BASE_URL ?? "http://localhost:3100").replace(/\/+$/, "");

/** Links are rendered only as http(s); credentials and active URL schemes are never persisted. */
export function safePublicationUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

function trustedEndpoint(raw: string | undefined): URL {
  const clean = safePublicationUrl(raw);
  if (!clean) throw new Error("发布端点未配置或不是有效网址");
  const u = new URL(clean);
  if (u.protocol !== "https:" || u.hash || u.search) throw new Error("发布端点必须使用 HTTPS 且不能包含查询参数、片段或凭据");
  return u;
}

export function publishingChannelStatus(): Array<{ id: PublishChannel; name: string; configured: boolean }> {
  return PUBLISH_CHANNELS.map((channel) => {
    let configured = channel.id === "own_site";
    try {
      if (channel.id === "wordpress") {
        trustedEndpoint(process.env.WORDPRESS_BASE_URL);
        configured = !!process.env.WORDPRESS_USERNAME && !!process.env.WORDPRESS_APP_PASSWORD;
      }
      if (channel.id === "webhook") {
        trustedEndpoint(process.env.PUBLISH_WEBHOOK_URL);
        configured = !!process.env.PUBLISH_WEBHOOK_TOKEN;
      }
    } catch { configured = false; }
    return { ...channel, configured };
  });
}

function readApprovedSnapshot(assetId: string): PublishSnapshot {
  const db = getDb();
  const asset = db.prepare("SELECT title, body_md, author, status FROM content_assets WHERE id = ? AND workspace_id = ?")
    .get(assetId, workspaceId()) as { title: string; body_md: string | null; author: string | null; status: string } | undefined;
  if (!asset || !["approved", "published"].includes(asset.status)) throw new Error("只能发布已审核通过的内容");
  if (!asset.body_md?.trim() || !asset.title.trim()) throw new Error("发布前请补全标题与正文，并完成审核");
  if (asset.body_md.length > 200_000) throw new Error("正文不能超过 20 万字符");
  const invalid = db.prepare(`SELECT c.id FROM content_claim_links l JOIN claims c ON c.id = l.claim_id
    WHERE l.asset_id = ? AND (c.workspace_id <> ? OR c.status <> 'approved'
    OR (c.valid_until IS NOT NULL AND c.valid_until <> '' AND c.valid_until < ?)
    OR (c.valid_from IS NOT NULL AND c.valid_from <> '' AND c.valid_from > ?)) LIMIT 1`)
    .get(assetId, workspaceId(), timestamp().slice(0, 10), timestamp().slice(0, 10));
  if (invalid) throw new Error("绑定事实尚未审核、已过期或未生效，请先修订内容并重新审核");
  const rows = db.prepare(`SELECT DISTINCT e.title, e.url, e.publisher, e.evidence_level AS evidenceLevel
    FROM content_claim_links l JOIN evidences e ON e.claim_id = l.claim_id
    WHERE l.asset_id = ? AND e.workspace_id = ? ORDER BY e.title, e.url`).all(assetId, workspaceId()) as unknown as EvidenceLink[];
  const evidences = rows.flatMap((e) => { const url = safePublicationUrl(e.url); return url ? [{ ...e, url }] : []; });
  return { title: asset.title.trim(), body: asset.body_md.trim(), author: asset.author?.trim() || "内容团队", evidences };
}

function getDispatch(id: string): PublicationDispatch {
  const row = getDb().prepare("SELECT * FROM publication_dispatches WHERE id = ? AND workspace_id = ?")
    .get(id, workspaceId()) as unknown as PublicationDispatch | undefined;
  if (!row) throw new Error("发布任务不存在");
  return row;
}

export function listPublicationDispatches(): PublicationDispatch[] {
  return getDb().prepare("SELECT * FROM publication_dispatches WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200")
    .all(workspaceId()) as unknown as PublicationDispatch[];
}

/** Content snapshots prevent subsequent edits from silently changing a published page. */
export function createPublicationDispatch(assetId: string, channel: string): string {
  if (!PUBLISH_CHANNELS.some((c) => c.id === channel)) throw new Error("未知发布渠道");
  const snapshot = readApprovedSnapshot(assetId);
  const contentHash = sha256(JSON.stringify(snapshot));
  const key = sha256(`${workspaceId()}:${assetId}:${channel}:${contentHash}`);
  const db = getDb();
  const existing = db.prepare("SELECT id FROM publication_dispatches WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId("dispatch"), task = newId("pubtask"), t = timestamp();
  const channelId = `managed_${sha256(`${workspaceId()}:${channel}`).slice(0, 24)}`;
  const slug = `${snapshot.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "article"}-${key.slice(0, 10)}`;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT OR IGNORE INTO distribution_channels (id, workspace_id, kind, name, note, created_at) VALUES (?, ?, 'owned', ?, '系统发布适配器', ?)`)
      .run(channelId, workspaceId(), PUBLISH_CHANNELS.find((c) => c.id === channel)!.name, t);
    db.prepare(`INSERT INTO publication_tasks (id, workspace_id, asset_id, channel_id, status, owner, created_at, updated_at) VALUES (?, ?, ?, ?, 'planned', 'operator', ?, ?)`)
      .run(task, workspaceId(), assetId, channelId, t, t);
    db.prepare(`INSERT INTO publication_dispatches (id, workspace_id, asset_id, task_id, channel, idempotency_key, content_hash, slug, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, workspaceId(), assetId, task, channel, key, contentHash, slug, JSON.stringify(snapshot), t, t);
    audit("publish_queued", "content_asset", assetId, { dispatchId: id, channel, contentHash }, "operator");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return id;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * 发布正文 → HTML。
 *
 * 复用知识页同一个解析器（`@/lib/markdown`）：此前这里是第二份只认标题和
 * 段落的实现，导致发布出去的正文丢掉列表与表格，而页面上却有 ——
 * 同一篇文章两个样子，抓取到的和看到的不一致。
 */
export function publicationHtml(snapshot: PublishSnapshot): string {
  const parts = [markdownToHtml(snapshot.body)];
  if (snapshot.evidences.length) {
    parts.push(
      `<h2>证据与参考来源</h2><ul>${snapshot.evidences
        .map((e) => {
          const href = safePublicationUrl(e.url);
          const title = escapeHtml(e.title);
          const publisher = e.publisher ? ` — ${escapeHtml(e.publisher)}` : "";
          // 不合格的链接只显示文字，不输出 href
          return href
            ? `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>${publisher}</li>`
            : `<li>${title}${publisher}</li>`;
        })
        .join("")}</ul>`,
    );
  }
  return parts.join("\n");
}

export type AdapterResult = { ok: true; url: string; remoteId?: string } | { ok: false; uncertain: boolean; error: string };

/** Credentials remain in environment/request headers; response bodies and exception text are never logged. */
export async function sendPublication(
  dispatch: PublicationDispatch,
  fetcher: typeof fetch = fetch,
): Promise<AdapterResult> {
  const snapshot = JSON.parse(dispatch.snapshot_json) as PublishSnapshot;
  if (dispatch.channel === "own_site") return { ok: true, url: `${siteBase()}/knowledge/${encodeURIComponent(dispatch.slug)}` };
  let endpoint: URL, headers: Record<string, string>, body: unknown;
  try {
    headers = { "content-type": "application/json", "Idempotency-Key": dispatch.idempotency_key };
    if (dispatch.channel === "wordpress") {
      const base = trustedEndpoint(process.env.WORDPRESS_BASE_URL);
      if (!process.env.WORDPRESS_USERNAME || !process.env.WORDPRESS_APP_PASSWORD) throw new Error("missing credentials");
      endpoint = new URL(`${base.toString().replace(/\/$/, "")}/wp-json/wp/v2/posts`);
      headers.authorization = `Basic ${Buffer.from(`${process.env.WORDPRESS_USERNAME}:${process.env.WORDPRESS_APP_PASSWORD}`).toString("base64")}`;
      // WordPress official REST API: POST /wp/v2/posts, status=publish; Application Password over HTTPS.
      body = { title: snapshot.title, content: publicationHtml(snapshot), slug: dispatch.slug, status: "publish", comment_status: "closed", ping_status: "closed" };
    } else {
      endpoint = trustedEndpoint(process.env.PUBLISH_WEBHOOK_URL);
      if (!process.env.PUBLISH_WEBHOOK_TOKEN) throw new Error("missing credentials");
      headers.authorization = `Bearer ${process.env.PUBLISH_WEBHOOK_TOKEN}`;
      body = { type: "geo.publish", idempotencyKey: dispatch.idempotency_key, assetId: dispatch.asset_id,
        title: snapshot.title, contentHtml: publicationHtml(snapshot), contentText: snapshot.body,
        slug: dispatch.slug, author: snapshot.author, evidenceLinks: snapshot.evidences };
    }
  } catch { return { ok: false, uncertain: false, error: "渠道未配置完整：请检查服务器发布环境变量" }; }
  try {
    const response = await fetcher(endpoint, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      // A 5xx / timeout / conflict can occur after remote commit. Do not blindly repeat POST.
      const definitive = [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status);
      return { ok: false, uncertain: !definitive, error: `发布接口返回 HTTP ${response.status}${definitive ? "，请修正后重试" : "，请先到目标平台核对是否已发布"}` };
    }
    const data = await response.json() as Record<string, unknown>;
    const url = safePublicationUrl(dispatch.channel === "wordpress" ? data.link : data.url);
    if (!url || (dispatch.channel === "wordpress" && (data.status !== "publish" || new URL(url).origin !== endpoint.origin)) || (dispatch.channel === "webhook" && data.status !== "published")) {
      return { ok: false, uncertain: true, error: "接口已接收请求，但未返回有效的已发布 URL；请到目标平台核对后补回" };
    }
    return { ok: true, url, remoteId: typeof data.id === "number" || typeof data.id === "string" ? String(data.id).slice(0, 150) : undefined };
  } catch { return { ok: false, uncertain: true, error: "网络异常、超时或响应无法解析；远端状态未知，请核对后补回 URL，勿重复发送" }; }
}

function finalizePublication(dispatch: PublicationDispatch, result: Extract<AdapterResult, { ok: true }>, manual = false): void {
  const db = getDb(), t = timestamp(), pubId = newId("pub");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (getDispatch(dispatch.id).status === "succeeded") { db.exec("COMMIT"); return; }
    db.prepare(`INSERT INTO publications (id, workspace_id, task_id, asset_id, url, published_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(pubId, workspaceId(), dispatch.task_id, dispatch.asset_id, result.url, t, manual ? "运营人员已在平台核对后补回" : `发布适配器：${dispatch.channel}`, t);
    db.prepare("UPDATE publication_dispatches SET status = 'succeeded', publication_id = ?, published_url = ?, remote_id = ?, error = NULL, updated_at = ? WHERE id = ?")
      .run(pubId, result.url, result.remoteId ?? null, t, dispatch.id);
    db.prepare("UPDATE publication_tasks SET status = 'published', updated_at = ? WHERE id = ?").run(t, dispatch.task_id);
    db.prepare("UPDATE content_assets SET status = 'published', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ? AND workspace_id = ?")
      .run(t, t, dispatch.asset_id, workspaceId());
    audit(manual ? "publish_reconciled" : "publish_succeeded", "content_asset", dispatch.asset_id, { dispatchId: dispatch.id, publicationId: pubId, channel: dispatch.channel, url: result.url }, "operator");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export async function executePublicationDispatch(id: string, fetcher: typeof fetch = fetch): Promise<PublicationDispatch> {
  const dispatch = getDispatch(id);
  if (dispatch.status === "succeeded") return dispatch;
  if (dispatch.status === "sending" || dispatch.status === "uncertain") throw new Error("发布状态尚不确定，请先到目标平台核对；不会重复发送");
  const snapshot = readApprovedSnapshot(dispatch.asset_id);
  if (sha256(JSON.stringify(snapshot)) !== dispatch.content_hash) throw new Error("内容或证据已变更，请重新审核并创建新的发布任务");
  const db = getDb();
  const claim = db.prepare("UPDATE publication_dispatches SET status = 'sending', attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')")
    .run(timestamp(), id);
  if (!claim.changes) return getDispatch(id);
  db.prepare("UPDATE publication_tasks SET status = 'preparing', updated_at = ? WHERE id = ?").run(timestamp(), dispatch.task_id);
  audit("publish_attempt", "content_asset", dispatch.asset_id, { dispatchId: id, channel: dispatch.channel }, "operator");
  const result = await sendPublication(dispatch, fetcher);
  if (result.ok) finalizePublication(dispatch, result);
  else {
    db.prepare("UPDATE publication_dispatches SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(result.uncertain ? "uncertain" : "failed", result.error, timestamp(), id);
    audit("publish_failed", "content_asset", dispatch.asset_id, { dispatchId: id, uncertain: result.uncertain, error: result.error }, "operator");
  }
  return getDispatch(id);
}

/** Explicit operator reconciliation is the only recovery from an unknown remote outcome. */
export function reconcilePublicationDispatch(id: string, urlInput: string, confirmed: boolean): void {
  if (!confirmed) throw new Error("请确认已在目标平台打开并核对正文");
  const dispatch = getDispatch(id);
  if (!["uncertain", "sending"].includes(dispatch.status) || dispatch.channel === "own_site") throw new Error("此任务不需要人工补回");
  // Avoid reconciling while a request is still live. Requests are bounded to 20 seconds.
  if (dispatch.status === "sending" && Date.now() - Date.parse(dispatch.updated_at) < 60_000) throw new Error("请求仍在执行，请稍后核对");
  const url = safePublicationUrl(urlInput);
  if (!url || new URL(url).protocol !== "https:") throw new Error("请填写不含凭据的 HTTPS 公开网址");
  if (dispatch.channel === "wordpress" && new URL(url).origin !== trustedEndpoint(process.env.WORDPRESS_BASE_URL).origin) throw new Error("回填 URL 必须属于已配置的 WordPress 网站");
  finalizePublication(dispatch, { ok: true, url }, true);
}

export function resetUnpublishedDispatch(id: string, confirmed: boolean): void {
  if (!confirmed) throw new Error("请先在目标平台搜索并确认没有发布成功");
  const dispatch = getDispatch(id);
  if (!["uncertain", "sending"].includes(dispatch.status)) throw new Error("当前任务不需要重置");
  if (Date.now() - Date.parse(dispatch.updated_at) < 60_000) throw new Error("请至少等待一分钟再核对目标平台");
  getDb().prepare("UPDATE publication_dispatches SET status = 'pending', error = NULL, updated_at = ? WHERE id = ?").run(timestamp(), id);
  getDb().prepare("UPDATE publication_tasks SET status = 'planned', updated_at = ? WHERE id = ?").run(timestamp(), dispatch.task_id);
  audit("publish_confirmed_absent", "content_asset", dispatch.asset_id, { dispatchId: id }, "operator");
}

export function listPublishedKnowledge(): PublishedKnowledge[] {
  const rows = getDb().prepare(`SELECT d.* FROM publication_dispatches d JOIN content_assets a ON a.id = d.asset_id
    WHERE d.workspace_id = ? AND d.channel = 'own_site' AND d.status = 'succeeded' AND a.status <> 'archived'
    ORDER BY d.updated_at DESC`).all(workspaceId()) as unknown as PublicationDispatch[];
  return rows.map((row) => ({ ...(JSON.parse(row.snapshot_json) as PublishSnapshot), id: row.id, slug: row.slug,
    url: `${siteBase()}/knowledge/${encodeURIComponent(row.slug)}`, publishedAt: row.updated_at }));
}

export function getPublishedKnowledge(slug: string): PublishedKnowledge | undefined {
  // App Router may provide an encoded route segment for non-ASCII slugs.
  let decoded = slug;
  for (let i = 0; i < 2 && decoded.includes("%"); i++) {
    try { decoded = decodeURIComponent(decoded); } catch { return undefined; }
  }
  return listPublishedKnowledge().find((article) => article.slug === decoded);
}

/**
 * 文章结构化数据。
 *
 * 统一走 @/lib/jsonld：空字段会被剔除、`<` 会被转义（防止 JSON-LD 提前闭合
 * script 标签）。此前这里是手写 JSON.stringify，缺少转义。
 */
export function articleJsonLd(article: PublishedKnowledge): string {
  return serializeJsonLd(
    articleJsonLdFrom({
      title: article.title,
      body: article.body,
      author: article.author,
      publishedAt: article.publishedAt,
      url: article.url,
      description: markdownToPlainText(article.body, 160),
      // 只把合格链接写进 citation，不合格的宁可不写
      citations: article.evidences.map((e) => safePublicationUrl(e.url)).filter((u): u is string => !!u),
    }, { baseUrl: siteBase(), path: new URL(article.url).pathname }),
  );
}

export async function checkPublicationDispatch(id: string): Promise<{ ok: boolean; note: string }> {
  const dispatch = getDispatch(id);
  if (dispatch.status !== "succeeded" || !dispatch.publication_id || !dispatch.published_url) throw new Error("只能复测已发布的内容");
  let ok = false, status: number | null = null, note: string;
  const hostname = new URL(dispatch.published_url).hostname;
  if (dispatch.channel === "own_site" && isLoopbackHost(hostname)) {
    ok = !!getPublishedKnowledge(dispatch.slug);
    note = ok ? "本机内容快照可读取；未执行公网抓取，不能据此判断搜索引擎收录" : "本站知识页已不可见";
  } else {
    const result = await fetchPage(dispatch.published_url);
    status = result.status ?? null;
    const snapshot = JSON.parse(dispatch.snapshot_json) as PublishSnapshot;
    // Title presence guards against a 200 login page or unrelated redirect.
    const normalized = (result.body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    ok = result.ok && !!result.body && (result.body.includes(escapeHtml(snapshot.title)) || normalized.includes(snapshot.title));
    note = ok ? "公开 URL 可抓取且找到文章标题；这不代表已收录或已被 AI 引用" : result.error || "页面不可访问或未找到文章标题，请检查登录墙、重定向和发布结果";
  }
  // 复核时同时跑三项门槛：页面可抓取 / robots 未拦 AI 抓取方 / 站点地图已收录。
  // 网络异常不应让整个复测失败 —— 门槛检查失败本身就是有效结论。
  let gates: PublishGate[] = [];
  let gatesJson = "[]";
  try {
    const readiness = await checkPublishReadiness(dispatch.published_url);
    gates = readiness.gates;
    gatesJson = JSON.stringify(gates);
    // 用 reachable 判定"抓到没"：HTTP + 正文可读 + 未被 robots 拦截。
    // reachable 为 null 表示"未检查"（例如本机地址被 SSRF 防护拒绝），
    // 这时保持原有判定，不因为"我们没查"就把任务标成失败。
    if (readiness.reachable === false) ok = false;
  } catch {
    gates = [
      { id: "http", label: "HTTP 可访问", ok: false, state: "fail", detail: "门槛检查未能完成（网络或解析错误）" },
    ];
    gatesJson = JSON.stringify(gates);
    ok = false;
  }

  getDb().prepare("INSERT INTO publication_checks (id, publication_id, status_code, ok, note, checked_at, gates_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(newId("pubcheck"), dispatch.publication_id, status, Number(ok), note, timestamp(), gatesJson);
  getDb().prepare("UPDATE publication_tasks SET status = ?, updated_at = ? WHERE id = ?")
    .run(ok ? "verified" : "published", timestamp(), dispatch.task_id);
  audit("publication_checked", "publication", dispatch.publication_id, { ok, note }, "operator");
  return { ok, note };
}

export function listPublicationChecks(): Array<{ id: string; publication_id: string; ok: number; status_code: number | null; note: string; checked_at: string; gates_json: string }> {
  const rows = getDb().prepare(`SELECT c.* FROM publication_checks c JOIN publications p ON p.id = c.publication_id
    WHERE p.workspace_id = ? ORDER BY c.checked_at DESC LIMIT 100`).all(workspaceId()) as unknown as Array<Record<string, unknown>>;
  // 旧库补列前可能没有 gates_json，统一兜底成空数组，避免界面拿到 undefined
  return rows.map((r) => ({ ...r, gates_json: (r.gates_json as string) ?? "[]" })) as unknown as ReturnType<typeof listPublicationChecks>;
}


/* ------------------------------------------------------------------ *
 * 发布后验收：页面 / 站点地图 / 可抓取性
 *
 * 三项都要过才算「发布可用」，任何一项不过都必须显示原因 ——
 * 「页面 200」不等于「AI 能看见」，中间还隔着 robots.txt 和 sitemap。
 * ------------------------------------------------------------------ */

/**
 * 发布后逐项门槛。
 *
 * 方案要求分开记录 HTTP、正文可读、canonical、robots、sitemap、结构化数据 ——
 * 合并成一句「页面正常」会掩盖「页面 200 但没有 canonical」这类问题，
 * 而后者直接影响能不能被正确收录。
 */
export type PublishGateId = "http" | "readable" | "canonical" | "robots" | "sitemap" | "structuredData";

/**
 * 门槛状态。
 *
 * 必须有第三态：SSRF 防护会拒绝抓取本机/内网地址，这时"我们没查"不等于
 * "页面有问题"。把它算成未通过是假阴性 —— 本地开发会永远是红的，
 * 久而久之没人再看这个检查。
 */
export type PublishGateState = "pass" | "fail" | "not_checked";

export interface PublishGate {
  id: PublishGateId;
  label: string;
  ok: boolean;
  state: PublishGateState;
  detail: string;
}

/** 各门槛不通过时，这句话说明后果 —— 不能只说"失败"，要说清"会导致什么" */
export const GATE_CONSEQUENCE: Record<PublishGateId, string> = {
  http: "抓取方拿不到页面",
  readable: "抓到的是空壳，正文无法被引用",
  canonical: "同一内容可能被当成多个页面，权重分散",
  robots: "被拦的抓取方完全看不到这页",
  sitemap: "搜索引擎可能发现不了这页",
  structuredData: "抓取方难以确认页面主题与实体",
};

export interface PublishReadiness {
  url: string;
  /** 全部门槛通过 —— 严格口径，"发布可用"的判据 */
  ok: boolean;
  /**
   * 抓取方确实能拿到并读到内容：HTTP + 正文可读 + 未被 robots 拦截。
   *
   * 与 ok 分开：sitemap 未收录、canonical 缺失、没有结构化数据，
   * 都不影响"能不能抓到"，但必须在界面上单独显示为未通过。
   * null = 未检查（例如本机地址被 SSRF 防护拒绝抓取）。
   */
  reachable: boolean | null;
  /** 搜索引擎可发现（站点地图已收录）。null = 未检查 */
  discoverable: boolean | null;
  /** 标记规范（canonical 指向本页且有结构化数据）。null = 未检查 */
  wellFormed: boolean | null;
  gates: PublishGate[];
  checkedAt: string;
}

/** 抓取器签名。抽成参数是为了让门槛逻辑可被单测覆盖 —— 只靠人工点击验证不算验证。 */
export type PublishGateFetcher = (url: string) => Promise<{ ok: boolean; status: number | null; body: string | null; error?: string }>;

const defaultGateFetcher: PublishGateFetcher = async (url) => {
  try {
    const r = await fetchPage(url, { allowTypes: ["text/plain", "text/html", "application/xml", "text/xml"] });
    return { ok: r.ok, status: r.status ?? null, body: r.body ?? null, error: r.error };
  } catch (e) {
    return { ok: false, status: null, body: null, error: e instanceof Error ? e.message : "抓取失败" };
  }
};

/**
 * 检查一个已发布 URL 是否真的「对 AI 可见」。
 *
 * robots 门槛只对 CRITICAL_BOTS（有厂商一手证据的 AI 抓取方）判定：
 * 一个冷门爬虫被挡不构成阻断，但把 GPTBot / Bytespider 挡住就是实质阻断。
 */
/** 本机/环回地址：SSRF 防护默认拒绝抓取，因此无法验证公网可抓取性 */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"];

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOOPBACK_HOSTS.includes(h) || h.endsWith(".localhost");
}

export async function checkPublishReadiness(rawUrl: string, fetcher: PublishGateFetcher = defaultGateFetcher): Promise<PublishReadiness> {
  const checkedAt = timestamp();
  const gates: PublishGate[] = [];

  const parsed = new URL(rawUrl);
  const path = parsed.pathname + parsed.search;
  const origin = parsed.origin;

  // 抓取器本身抛错时不能把异常抛给调用方：门槛检查失败本身就是结论。
  const safeFetch: PublishGateFetcher = async (url) => {
    try {
      return await fetcher(url);
    } catch (e) {
      return { ok: false, status: null, body: null, error: e instanceof Error ? e.message : "抓取失败" };
    }
  };

  // —— 门槛 1：HTTP ——
  const page = await safeFetch(rawUrl);

  /**
   * 被 SSRF 防护拒绝 ≠ 页面有问题。
   *
   * 这里刻意"先抓再分类"，而不是事先按主机名短路：逃生口
   * （EXTRA_TRUSTED_CIDRS）允许在本地显式放行时，短路会让本地永远
   * 无法验证真实门槛。分类依据是抓取器给出的拒绝原因。
   */
  const ssrfBlocked =
    !page.ok &&
    !!page.error &&
    /不允许访问本机地址|不允许访问内网地址|该域名解析到内网地址/.test(page.error);
  if (ssrfBlocked) {
    const reason =
      `${page.error}（SSRF 防护拒绝抓取本机/内网地址）—— 无法据此验证公网可抓取性。` +
      "如需在本地验证，可在确认目标确实是自己的测试实例后，用 EXTRA_TRUSTED_CIDRS 显式放行。";
    const notChecked = (id: PublishGateId, label: string): PublishGate => ({
      id,
      label,
      ok: false,
      state: "not_checked",
      detail: reason,
    });
    gates.push(
      notChecked("http", "HTTP 可访问"),
      notChecked("readable", "正文可读"),
      notChecked("canonical", "canonical 指向本页"),
      notChecked("robots", "robots.txt 未拦截 AI 抓取方"),
      notChecked("sitemap", "站点地图已收录该 URL"),
      notChecked("structuredData", "含可解析的结构化数据"),
    );
    return { url: rawUrl, ok: false, reachable: null, discoverable: null, wellFormed: null, gates, checkedAt };
  }

  const httpOk = page.ok && page.status !== null && page.status >= 200 && page.status < 300;
  gates.push({
    id: "http",
    label: "HTTP 可访问",
    ok: httpOk,
    state: httpOk ? "pass" : "fail",
    detail: httpOk
      ? `HTTP ${page.status}`
      : page.error || `HTTP ${page.status ?? "无响应"} —— 抓取方拿不到页面`,
  });

  // —— 门槛 2：正文可读（与 HTTP 分开：200 也可能是空壳）——
  const html = page.body ?? "";
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const readableOk = visible.length > 200;
  gates.push({
    id: "readable",
    label: "正文可读",
    ok: readableOk,
    state: readableOk ? "pass" : "fail",
    detail: readableOk
      ? `正文约 ${visible.length} 字`
      : `正文仅 ${visible.length} 字（疑似登录墙、纯前端渲染或空壳页）`,
  });

  // —— 门槛 3：canonical ——
  // 相对与绝对都接受，但必须指向本页：指向别处等于把权重让出去
  const canonicalRaw = /<link[^>]+rel=["']canonical["'][^>]*>/i.exec(html)?.[0] ?? "";
  const canonicalHref = /href=["']([^"']+)["']/i.exec(canonicalRaw)?.[1] ?? null;
  let canonicalOk = false;
  let canonicalDetail: string;
  if (!canonicalHref) {
    canonicalDetail = "页面未声明 canonical —— 同一内容可能被当成多个页面";
  } else {
    try {
      const resolved = new URL(canonicalHref, rawUrl);
      const same = resolved.origin === parsed.origin && resolved.pathname === parsed.pathname;
      canonicalOk = same;
      canonicalDetail = same
        ? `canonical 指向本页：${resolved.pathname}`
        : `canonical 指向 ${resolved.href}，不是本页 —— 权重会被让给别的地址`;
    } catch {
      canonicalDetail = `canonical 值无法解析：${canonicalHref}`;
    }
  }
  gates.push({ id: "canonical", label: "canonical 指向本页", ok: canonicalOk, state: canonicalOk ? "pass" : "fail", detail: canonicalDetail });

  // —— 门槛 4：robots.txt 未挡住 AI 抓取方 ——
  const robots = await safeFetch(`${origin}/robots.txt`);
  if (!robots.ok || !robots.body) {
    // 没有 robots.txt 等于默认全放行，不是失败
    gates.push({
      id: "robots",
      label: "robots.txt 未拦截 AI 抓取方",
      ok: true,
      state: "pass",
      detail: `未读到 robots.txt（HTTP ${robots.status ?? "无响应"}）。缺失按全放行处理。`,
    });
  } else {
    const parsedRobots = parseRobots(robots.body);
    const blocked = CRITICAL_BOTS.filter((b) => !isAllowed(parsedRobots, b.token, path).allowed);
    gates.push({
      id: "robots",
      label: "robots.txt 未拦截 AI 抓取方",
      ok: blocked.length === 0,
      state: blocked.length === 0 ? "pass" : "fail",
      detail: blocked.length === 0
        ? `已核对 ${CRITICAL_BOTS.length} 个关键 AI 抓取方，${path} 全部放行`
        : `被拦截：${blocked.map((b) => b.token).join("、")} —— 这些抓取方看不到本页`,
    });
  }

  // —— 门槛 5：站点地图包含该 URL ——
  const sitemaps = robots.ok && robots.body ? declaredSitemaps(parseRobots(robots.body)) : [];
  const candidates = sitemaps.length > 0 ? sitemaps : [`${origin}/sitemap.xml`];
  const docs = await Promise.all(candidates.slice(0, 3).map((sm) => safeFetch(sm)));
  const hitIndex = docs.findIndex((d) => d.ok && d.body && (d.body.includes(rawUrl) || d.body.includes(path)));
  gates.push({
    id: "sitemap",
    label: "站点地图已收录该 URL",
    ok: hitIndex >= 0,
    state: hitIndex >= 0 ? "pass" : "fail",
    detail: hitIndex >= 0
      ? `在 ${candidates[hitIndex]} 中找到该 URL`
      : `已检查 ${candidates.slice(0, 3).join("、")}，均未包含该 URL —— 搜索引擎可能发现不了这页`,
  });

  // —— 门槛 6：结构化数据 ——
  // 只判断"有没有可解析的 JSON-LD 且带 @type"。字段是否与页面一致由 A3 的
  // checkJsonLdConsistency 负责，这里不重复也不越权。
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  let ldTypes: string[] = [];
  let ldBroken = 0;
  for (const block of ldBlocks) {
    try {
      const data = JSON.parse(block.replace(/\\u003c/g, "<")) as unknown;
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        const t = (item as Record<string, unknown> | null)?.["@type"];
        if (typeof t === "string") ldTypes.push(t);
        else if (Array.isArray(t)) ldTypes.push(...t.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      ldBroken++;
    }
  }
  gates.push({
    id: "structuredData",
    label: "含可解析的结构化数据",
    ok: ldTypes.length > 0,
    state: ldTypes.length > 0 ? "pass" : "fail",
    detail:
      ldTypes.length > 0
        ? `JSON-LD 类型：${[...new Set(ldTypes)].join("、")}${ldBroken > 0 ? `（另有 ${ldBroken} 段无法解析）` : ""}`
        : ldBlocks.length > 0
          ? `有 ${ldBlocks.length} 段 JSON-LD 但都无法解析出 @type`
          : "页面没有 JSON-LD —— 抓取方难以确认页面主题与实体",
  });

  const stateOf = (id: PublishGateId) => gates.find((g) => g.id === id)?.state;
  /** 任一项未检查 → 整组未知（null），不把"没查"算成"通过"或"不通过" */
  const rollup = (ids: PublishGateId[]): boolean | null => {
    const states = ids.map(stateOf);
    if (states.some((x) => x === "not_checked" || x === undefined)) return null;
    return states.every((x) => x === "pass");
  };
  return {
    url: rawUrl,
    ok: gates.every((g) => g.ok),
    reachable: rollup(["http", "readable", "robots"]),
    discoverable: rollup(["sitemap"]),
    wellFormed: rollup(["canonical", "structuredData"]),
    gates,
    checkedAt,
  };
}


/* ------------------------------------------------------------------ *
 * 四项状态分开呈现（已发布 / 可抓取 / 已收录 / 被 AI 引用）
 * ------------------------------------------------------------------ */

/**
 * 收集采样得到的引用证据。
 *
 * 只读 evaluation_results（evaluator='citations'），不重算 ——
 * 状态必须复现评测当时的结论，否则"被引用"这件事前后口径会变。
 */
export function citationEvidence(): { citations: CitationEvidence[]; evaluatedSampleCount: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT e.result_json FROM evaluation_results e
        JOIN response_samples s ON s.id = e.sample_id
       WHERE e.workspace_id = ? AND e.evaluator = 'citations'`,
    )
    .all(workspaceId()) as unknown as Array<{ result_json: string }>;
  const citations: CitationEvidence[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.result_json) as Array<{ url?: unknown; domain?: unknown }>;
      if (!Array.isArray(parsed)) continue;
      for (const c of parsed) {
        citations.push({
          url: typeof c?.url === "string" ? c.url : null,
          domain: typeof c?.domain === "string" ? c.domain : null,
        });
      }
    } catch {
      // 坏 JSON 跳过：宁可少算，也不能把解析失败当成"有引用"
    }
  }
  const count = (db
    .prepare("SELECT COUNT(*) AS n FROM response_samples WHERE workspace_id = ? AND id IN (SELECT sample_id FROM evaluation_results WHERE workspace_id = ?)")
    .get(workspaceId(), workspaceId()) as { n: number } | undefined)?.n ?? 0;
  return { citations, evaluatedSampleCount: count };
}

function latestCheckFor(publicationId: string | null): { gates: PublishGate[]; ok: boolean; checkedAt: string } | null {
  if (!publicationId) return null;
  const row = getDb()
    .prepare("SELECT gates_json, ok, checked_at FROM publication_checks WHERE publication_id = ? ORDER BY checked_at DESC LIMIT 1")
    .get(publicationId) as { gates_json: string; ok: number; checked_at: string } | undefined;
  if (!row) return null;
  let gates: PublishGate[] = [];
  try {
    const parsed = JSON.parse(row.gates_json) as PublishGate[];
    if (Array.isArray(parsed)) gates = parsed.filter((g) => g && typeof g.id === "string");
  } catch {
    gates = [];
  }
  return { gates, ok: row.ok === 1, checkedAt: row.checked_at };
}

/** 计算一个发布任务的四项状态。任何一步都不由前一步推断。 */
export function publicationStatusFor(dispatchId: string): PublicationStatusView {
  const dispatch = getDispatch(dispatchId);
  const check = latestCheckFor(dispatch.publication_id);
  const { citations, evaluatedSampleCount } = citationEvidence();
  const gateOk = (id: string) => check?.gates.find((g) => g.id === id)?.ok === true;
  const reachable = check ? gateOk("http") && gateOk("readable") && gateOk("robots") : null;
  return buildPublicationStatus({
    url: dispatch.published_url,
    publishedAt: dispatch.status === "succeeded" ? dispatch.updated_at : null,
    channel: dispatch.channel,
    gates: check?.gates ?? [],
    reachable,
    checkedAt: check?.checkedAt ?? null,
    citations,
    evaluatedSampleCount,
  });
}
