"use server";

import { revalidatePath } from "next/cache";
import * as R from "@/lib/db/repo-domains";
import { assignLeadOwner } from "@/lib/db/repo";
import { evaluateScope } from "@/lib/evaluate-run";

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
const s = (fd: FormData, key: string): string => String(fd.get(key) ?? "").trim();
const opt = (fd: FormData, key: string): string | undefined => s(fd, key) || undefined;

function refresh(paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

/* =====================================================================
 * 模块 1：品牌 / 别名 / 竞品
 * ===================================================================== */
export async function brandCreate(fd: FormData) {
  const name = s(fd, "name");
  if (!name) return;
  R.createBrand({ name, domain: opt(fd, "domain"), description: opt(fd, "description") });
  refresh(["/console/brands"]);
}

export async function brandUpdate(fd: FormData) {
  const id = s(fd, "id");
  if (!id) return;
  R.updateBrand(id, { name: opt(fd, "name"), domain: opt(fd, "domain"), description: opt(fd, "description") });
  refresh(["/console/brands"]);
}

export async function brandDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) R.deleteBrand(id);
  refresh(["/console/brands"]);
}

export async function aliasAdd(fd: FormData) {
  const brandId = s(fd, "brandId");
  const alias = s(fd, "alias");
  if (brandId && alias) R.addAlias(brandId, alias, opt(fd, "kind") ?? "alias");
  refresh(["/console/brands"]);
}

export async function aliasRemove(fd: FormData) {
  const id = s(fd, "id");
  if (id) R.removeAlias(id);
  refresh(["/console/brands"]);
}

export async function competitorAdd(fd: FormData) {
  const brandId = s(fd, "brandId");
  const name = s(fd, "name");
  if (brandId && name) R.addCompetitor(brandId, name, opt(fd, "domain"));
  refresh(["/console/brands"]);
}

export async function competitorRemove(fd: FormData) {
  const id = s(fd, "id");
  if (id) R.removeCompetitor(id);
  refresh(["/console/brands"]);
}

/* =====================================================================
 * 模块 2：问题库
 * ===================================================================== */
export async function qsCreate(fd: FormData) {
  const name = s(fd, "name");
  if (!name) return;
  R.createQuerySet(name);
  refresh(["/console/questions", "/console/sampling"]);
}

export async function qsFreeze(fd: FormData) {
  const id = s(fd, "id");
  if (id) R.freezeQuerySet(id);
  refresh(["/console/questions", "/console/sampling"]);
}

export async function questionAdd(fd: FormData) {
  const querySetId = s(fd, "querySetId");
  const raw = s(fd, "texts");
  if (!querySetId || !raw) return;
  R.addQuestions(querySetId, raw.split("\n"), {
    persona: opt(fd, "persona"),
    intent: opt(fd, "intent"),
    funnelStage: opt(fd, "funnelStage"),
    locale: opt(fd, "locale"),
  });
  refresh(["/console/questions"]);
}

export async function questionDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) R.deleteQuestion(id);
  refresh(["/console/questions"]);
}

export async function personaCreate(fd: FormData) {
  const name = s(fd, "name");
  if (name) R.createPersona(name, opt(fd, "description"));
  refresh(["/console/questions"]);
}

/* =====================================================================
 * 模块 3：事实与证据
 * ===================================================================== */
export async function claimCreate(fd: FormData) {
  const statement = s(fd, "statement");
  const claimKey = s(fd, "claimKey");
  if (!statement || !claimKey) return;
  R.createClaim({
    claimKey,
    statement,
    category: opt(fd, "category"),
    validUntil: opt(fd, "validUntil"),
    brandId: opt(fd, "brandId"),
  });
  refresh(["/console/claims"]);
}

export async function claimReview(fd: FormData) {
  const id = s(fd, "id");
  const decision = s(fd, "decision") === "approved" ? "approved" : "rejected";
  if (id) R.reviewClaim(id, decision, opt(fd, "note"));
  refresh(["/console/claims", "/console/evaluation"]);
}

export async function evidenceAdd(fd: FormData) {
  const claimId = s(fd, "claimId");
  const title = s(fd, "title");
  if (!claimId || !title) return;
  R.addEvidence({
    claimId,
    title,
    kind: opt(fd, "kind"),
    url: opt(fd, "url"),
    publisher: opt(fd, "publisher"),
    evidenceLevel: opt(fd, "evidenceLevel"),
  });
  refresh(["/console/claims"]);
}

export async function phraseAdd(fd: FormData) {
  const phrase = s(fd, "phrase");
  if (phrase) R.addProhibitedPhrase(phrase, opt(fd, "severity") ?? "warn", opt(fd, "reason"));
  refresh(["/console/claims"]);
}

/* =====================================================================
 * 模块 4：采样
 * ===================================================================== */
export async function samplingRunCreate(fd: FormData) {
  const label = s(fd, "label");
  const querySetId = s(fd, "querySetId");
  const engines = fd.getAll("engines").map((e) => String(e)).filter(Boolean);
  if (!label || !querySetId || engines.length === 0) return;
  R.createSamplingRun({
    label,
    querySetId,
    samplingMode: s(fd, "samplingMode") || "manual_ui",
    engines,
    region: opt(fd, "region"),
    repetition: Number(s(fd, "repetition") || "1"),
    storeId: opt(fd, "storeId") ?? null,
    locationMode: s(fd, "locationMode") || "unspecified",
    anchorId: opt(fd, "anchorId") ?? null,
    daypart: opt(fd, "daypart") ?? null,
    protocolId: opt(fd, "protocolId") ?? null,
    webSearch: s(fd, "webSearch") === "on" || s(fd, "webSearch") === "1",
  });
  refresh(["/console/sampling"]);
}

export async function sampleSave(fd: FormData) {
  const taskId = s(fd, "taskId");
  const rawAnswer = s(fd, "rawAnswer");
  if (!taskId || !rawAnswer) return;
  R.saveSample({ taskId, rawAnswer, modelVersion: opt(fd, "modelVersion"), region: opt(fd, "region") });
  refresh(["/console/sampling", "/console/evaluation"]);
}

export async function sampleImportCsv(fd: FormData) {
  const runId = s(fd, "runId");
  const csv = s(fd, "csv");
  if (!runId || !csv) return;
  R.importSamplesCsv(runId, csv);
  refresh(["/console/sampling", "/console/evaluation"]);
}

/* =====================================================================
 * 模块 5：评估
 * ===================================================================== */
export async function evaluateRun(fd: FormData) {
  const runIdRaw = s(fd, "runId");
  // 空字符串 = 跨批次的「全部样本」范围 → 传 null，绝不编造外键
  const runId = runIdRaw || null;
  const brandId = s(fd, "brandId") || R.getDefaultBrandId() || "";

  evaluateScope({ runId, brandId });
  refresh(["/console/evaluation", "/console"]);
}

/* =====================================================================
 * 模块 6：内容与推广
 * ===================================================================== */
export async function briefCreate(fd: FormData) {
  const title = s(fd, "title");
  if (!title) return;
  R.createBrief({
    title,
    gapReason: opt(fd, "gapReason"),
    outline: opt(fd, "outline"),
  });
  refresh(["/console/content"]);
}

export async function assetCreate(fd: FormData) {
  const title = s(fd, "title");
  if (!title) return;
  R.createAsset({
    title,
    briefId: opt(fd, "briefId"),
    kind: opt(fd, "kind"),
    bodyMd: opt(fd, "bodyMd"),
    author: opt(fd, "author"),
    templateId: opt(fd, "templateId"),
    questionIds: fd.getAll("questionIds").map(String).filter(Boolean),
    claimIds: fd.getAll("claimIds").map(String).filter(Boolean),
  });
  refresh(["/console/content"]);
}

export async function assetReview(fd: FormData) {
  const id = s(fd, "id");
  const decision = s(fd, "decision") === "approved" ? "approved" : "rejected";
  if (id) R.reviewAsset(id, decision, opt(fd, "note"));
  refresh(["/console/content"]);
}

export async function assetPublish(fd: FormData) {
  const id = s(fd, "id");
  const url = s(fd, "url");
  if (!id || !url) return;
  const feeRaw = s(fd, "fee");
  R.publishAsset(id, url, opt(fd, "channelId"), opt(fd, "publishedAt"), feeRaw ? Number(feeRaw) : undefined);
  refresh(["/console/content"]);
}

export async function channelCreate(fd: FormData) {
  const name = s(fd, "name");
  if (!name) return;
  R.createChannel(s(fd, "kind") || "owned", name, opt(fd, "note"));
  refresh(["/console/content"]);
}

/* =====================================================================
 * 模块 7：获客归因
 * ===================================================================== */
export async function leadStatusUpdate(fd: FormData) {
  const leadId = s(fd, "leadId");
  const to = s(fd, "status");
  if (!leadId || !to) return;
  R.updateLeadStatus(leadId, to, opt(fd, "note"));
  refresh(["/console/attribution", "/console/leads"]);
}

/** 指派线索跟进责任人 —— 没有责任人的线索等于没人跟进 */
export async function leadAssign(fd: FormData) {
  const leadId = s(fd, "leadId");
  const owner = s(fd, "owner");
  if (!leadId || !owner) return;
  assignLeadOwner(leadId, owner, opt(fd, "nextFollowUpAt"));
  refresh(["/console/attribution", "/console/leads"]);
}

export async function touchpointAdd(fd: FormData) {
  const leadId = s(fd, "leadId");
  const kind = s(fd, "kind");
  if (!leadId || !kind) return;
  R.addTouchpoint({
    leadId,
    kind: kind as "first_touch" | "last_non_direct" | "self_reported" | "assist",
    path: opt(fd, "path"),
    referrer: opt(fd, "referrer"),
    note: opt(fd, "note"),
  });
  refresh(["/console/attribution"]);
}
