import { getDb, workspaceId, audit } from "./db/index.ts";
import { newId } from "./id.ts";

type Task = { id: string; run_id: string; question_id: string; question_text: string; engine: string; region: string | null; repetition: number; status: string; sampling_mode: string };
export interface SampleProvenance {
  sample_id: string; task_id: string; evidence_kind: "manual_ui" | "official_api" | "fixture";
  model_version: string; source_url: string | null; citations_json: string;
  provider_response_id: string | null; search_enabled: number | null;
  request_config_json: string; recorded_at: string; payload_json: string;
  citations: string[];
}

function taskById(id: string): Task {
  const task = getDb().prepare(`SELECT t.*, r.sampling_mode FROM sampling_tasks t
    JOIN sampling_runs r ON r.id = t.run_id WHERE t.id = ? AND t.workspace_id = ? AND r.workspace_id = ?`)
    .get(id, workspaceId(), workspaceId()) as unknown as Task | undefined;
  if (!task) throw new Error("采样任务不存在");
  return task;
}

function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw new Error("来源或引用网址必须是没有账号密码的 HTTP(S) 地址"); }
}

function parseCitationUrls(raw: string | string[]): string[] {
  const values = Array.isArray(raw) ? raw : raw.split(/\r?\n/);
  if (values.length > 50) throw new Error("最多记录 50 条引用网址");
  return [...new Set(values.map((v) => v.trim()).filter(Boolean).map(cleanUrl))];
}

function saveObservation(input: { task: Task; answer: string; kind: SampleProvenance["evidence_kind"]; model: string; collectedAt: string; sourceUrl?: string; citations: string[]; responseId?: string; searchEnabled: number | null; requestConfig: unknown; payload: unknown }): string {
  if (!input.answer.trim() || input.answer.length > 200_000) throw new Error("回答必须为 1–200000 字的原文");
  if (!input.model.trim() || input.model.length > 120) throw new Error("请填写有效模型版本");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(input.collectedAt) || !/[zZ]|[+-]\d\d:\d\d$/.test(input.collectedAt) || !Number.isFinite(Date.parse(input.collectedAt))) throw new Error("采集时间必须包含时区");
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT sample_id FROM sample_provenance WHERE task_id = ?").get(input.task.id) as { sample_id: string } | undefined;
    if (previous) { db.exec("COMMIT"); return previous.sample_id; }
    const status = db.prepare("SELECT status FROM sampling_tasks WHERE id = ?").get(input.task.id) as { status: string };
    if (status.status !== "pending") throw new Error("任务已被采集；旧数据请先核对，避免重复回答");
    const sampleId = newId("smp"), now = new Date().toISOString();
    db.prepare(`INSERT INTO response_samples (id,workspace_id,run_id,question_id,engine,sampling_mode,region,repetition,raw_answer,content_hash,collected_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?)`).run(sampleId, workspaceId(), input.task.run_id, input.task.question_id, input.task.engine, input.task.sampling_mode, input.task.region, input.task.repetition, input.answer, input.collectedAt, now);
    db.prepare(`INSERT INTO sample_provenance (sample_id,task_id,evidence_kind,model_version,source_url,citations_json,provider_response_id,search_enabled,request_config_json,recorded_at,payload_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sampleId, input.task.id, input.kind, input.model.trim(), input.sourceUrl || null, JSON.stringify(input.citations), input.responseId || null, input.searchEnabled, JSON.stringify(input.requestConfig), now, JSON.stringify(input.payload));
    db.prepare("UPDATE sampling_tasks SET status = 'collected' WHERE id = ? AND status = 'pending'").run(input.task.id);
    audit("sample_observed", "response_sample", sampleId, { taskId: input.task.id, kind: input.kind, engine: input.task.engine });
    db.exec("COMMIT");
    return sampleId;
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function saveManualObservation(input: { taskId: string; answer: string; modelVersion: string; collectedAt: string; sourceUrl?: string; citationUrls?: string }): string {
  const task = taskById(input.taskId);
  if (task.sampling_mode !== "manual_ui" && task.sampling_mode !== "approved_browser") throw new Error("此任务不属于消费者界面人工采样批次");
  const citations = parseCitationUrls(input.citationUrls ?? "");
  return saveObservation({ task, answer: input.answer, kind: "manual_ui", model: input.modelVersion, collectedAt: input.collectedAt,
    sourceUrl: input.sourceUrl?.trim() ? cleanUrl(input.sourceUrl) : undefined, citations, responseId: undefined,
    searchEnabled: null, requestConfig: { mode: task.sampling_mode, region: task.region, repetition: task.repetition }, payload: { enteredBy: "operator" } });
}

export function getSampleProvenance(sampleId: string): SampleProvenance | null {
  const row = getDb().prepare(`SELECT p.* FROM sample_provenance p JOIN response_samples s ON s.id = p.sample_id
    WHERE p.sample_id = ? AND s.workspace_id = ?`).get(sampleId, workspaceId()) as unknown as Omit<SampleProvenance, "citations"> | undefined;
  if (!row) return null;
  let citations: string[] = [];
  try { citations = JSON.parse(row.citations_json) as string[]; } catch { /* invalid legacy row */ }
  return { ...row, citations };
}

/** Citation URLs are extracted separately; the provider's answer text remains unchanged. */
export function answerForExtraction(sample: { id: string; raw_answer: string }): string {
  const provenance = getSampleProvenance(sample.id);
  return [sample.raw_answer, ...(provenance?.citations ?? [])].join("\n");
}

export function perplexityConfigured(): boolean { return Boolean(process.env.PERPLEXITY_API_KEY?.trim()); }

export async function collectPerplexity(taskId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const task = taskById(taskId);
  if (task.sampling_mode !== "official_api" || task.engine !== "Perplexity") throw new Error("当前连接器只支持 Perplexity 的官方 API 批次");
  if (task.region) throw new Error("此连接器尚未控制搜索地区，请创建地区为空的官方 API 批次");
  if (task.status !== "pending") throw new Error("任务已采集");
  const key = process.env.PERPLEXITY_API_KEY?.trim();
  if (!key) throw new Error("未配置 PERPLEXITY_API_KEY");
  const model = process.env.PERPLEXITY_MODEL === "sonar-pro" ? "sonar-pro" : "sonar";
  const db = getDb(), now = new Date().toISOString();
  const acquired = db.prepare(`INSERT INTO sampling_api_attempts (task_id,state,attempt_count,started_at,updated_at)
    VALUES (?,'sending',1,?,?) ON CONFLICT(task_id) DO UPDATE SET state='sending',attempt_count=attempt_count+1,started_at=excluded.started_at,updated_at=excluded.updated_at
    WHERE state='failed'`).run(task.id, now, now);
  if (!acquired.changes) throw new Error("采样请求已执行或远端状态未知，请先核对后处理");
  const config = { provider: "Perplexity Sonar API", model, searchEnabled: true, temperature: 0, region: null };
  try {
    const response = await fetcher("https://api.perplexity.ai/v1/sonar", {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: task.question_text }], temperature: 0 }),
      redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const definite = [400, 401, 403, 404, 422, 429].includes(response.status);
      db.prepare("UPDATE sampling_api_attempts SET state = ?, last_error = ?, updated_at = ? WHERE task_id = ?")
        .run(definite ? "failed" : "uncertain", `API HTTP ${response.status}；${definite ? "修正配置后可重试" : "请求状态未知，请勿立即重试"}`, new Date().toISOString(), task.id);
      throw new Error(`Perplexity API 返回 HTTP ${response.status}`);
    }
    const data = await response.json() as Record<string, unknown>;
    const choice = Array.isArray(data.choices) ? data.choices[0] as { message?: { content?: unknown } } | undefined : undefined;
    const answer = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const responseId = typeof data.id === "string" ? data.id : "";
    if (!answer || !responseId) throw new Error("API 响应缺少回答或 ID，需要人工核对远端状态");
    const citations = parseCitationUrls(Array.isArray(data.citations) ? data.citations.filter((c): c is string => typeof c === "string") : []);
    const sampleId = saveObservation({ task, answer, kind: "official_api", model: typeof data.model === "string" ? data.model : model,
      collectedAt: new Date().toISOString(), citations, responseId, searchEnabled: 1, requestConfig: config,
      payload: { responseId, model: data.model, citations, searchResults: data.search_results ?? null } });
    db.prepare("UPDATE sampling_api_attempts SET state='succeeded',last_error=NULL,updated_at=? WHERE task_id=?")
      .run(new Date().toISOString(), task.id);
    return sampleId;
  } catch (error) {
    const current = db.prepare("SELECT state FROM sampling_api_attempts WHERE task_id = ?").get(task.id) as { state: string };
    if (current.state === "sending") db.prepare("UPDATE sampling_api_attempts SET state='uncertain',last_error=?,updated_at=? WHERE task_id=?")
      .run("网络或响应异常，远端可能已计费，请先核对", new Date().toISOString(), task.id);
    throw error instanceof Error && error.message.startsWith("Perplexity API 返回 HTTP") ? error : new Error("采样未完成；远端状态可能未知，请查看任务状态，勿立即重试");
  }
}

export function getApiAttempt(taskId: string): { state: string; last_error: string | null; attempt_count: number } | null {
  return (getDb().prepare("SELECT state,last_error,attempt_count FROM sampling_api_attempts WHERE task_id=?").get(taskId) as { state: string; last_error: string | null; attempt_count: number } | undefined) ?? null;
}
