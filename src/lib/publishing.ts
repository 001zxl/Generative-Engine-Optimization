import { getDb, workspaceId, audit } from "./db/index.ts";
import { newId, sha256 } from "./id.ts";
import { fetchPage } from "./net/fetch-page.ts";

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

/** Deliberately small Markdown subset: headings + paragraphs, no raw HTML execution. */
export function publicationHtml(snapshot: PublishSnapshot): string {
  const blocks = snapshot.body.split(/\n\s*\n/).map((block) => {
    const heading = /^(#{1,6})\s+([^\n]+)$/.exec(block.trim());
    if (heading) { const level = Math.max(2, heading[1].length); return `<h${level}>${escapeHtml(heading[2])}</h${level}>`; }
    return `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
  });
  if (snapshot.evidences.length) blocks.push(`<h2>证据与参考来源</h2><ul>${snapshot.evidences.map((e) => `<li><a href="${escapeHtml(e.url)}">${escapeHtml(e.title)}</a>${e.publisher ? ` — ${escapeHtml(e.publisher)}` : ""}</li>`).join("")}</ul>`);
  return blocks.join("\n");
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

export function articleJsonLd(article: PublishedKnowledge): string {
  return JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: article.title,
    author: { "@type": "Person", name: article.author }, datePublished: article.publishedAt,
    dateModified: article.publishedAt, mainEntityOfPage: article.url, url: article.url,
    citation: article.evidences.map((e) => e.url) }).replace(/</g, "\\u003c");
}

export async function checkPublicationDispatch(id: string): Promise<{ ok: boolean; note: string }> {
  const dispatch = getDispatch(id);
  if (dispatch.status !== "succeeded" || !dispatch.publication_id || !dispatch.published_url) throw new Error("只能复测已发布的内容");
  let ok = false, status: number | null = null, note: string;
  const hostname = new URL(dispatch.published_url).hostname;
  if (dispatch.channel === "own_site" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
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
  getDb().prepare("INSERT INTO publication_checks (id, publication_id, status_code, ok, note, checked_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId("pubcheck"), dispatch.publication_id, status, Number(ok), note, timestamp());
  getDb().prepare("UPDATE publication_tasks SET status = ?, updated_at = ? WHERE id = ?")
    .run(ok ? "verified" : "published", timestamp(), dispatch.task_id);
  audit("publication_checked", "publication", dispatch.publication_id, { ok, note }, "operator");
  return { ok, note };
}

export function listPublicationChecks(): Array<{ id: string; publication_id: string; ok: number; status_code: number | null; note: string; checked_at: string }> {
  return getDb().prepare(`SELECT c.* FROM publication_checks c JOIN publications p ON p.id = c.publication_id
    WHERE p.workspace_id = ? ORDER BY c.checked_at DESC LIMIT 100`).all(workspaceId()) as unknown as ReturnType<typeof listPublicationChecks>;
}
