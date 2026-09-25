"use server";

import { revalidatePath } from "next/cache";
import { requireConsoleSession } from "@/lib/console-auth";
import * as P from "@/lib/db/repo-protocol";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function opt(fd: FormData, key: string): string | null {
  const v = s(fd, key);
  return v || null;
}
function refresh() {
  for (const p of ["/console/protocols", "/console/questions", "/console/sampling", "/console/geo-sampling"]) {
    revalidatePath(p);
  }
}

function wrap(fn: (fd: FormData) => void | Promise<void>) {
  return async (fd: FormData) => {
    await requireConsoleSession();
    await fn(fd);
  };
}

/** 从已冻结的问题集建立协议 —— 条件在此刻锁定 */
export const protocolCreate = wrap(async (fd) => {
  const querySetId = s(fd, "querySetId");
  const label = s(fd, "label");
  if (!querySetId || !label) return;
  const engines = fd.getAll("engines").map(String).filter(Boolean);
  P.createProtocol({
    label,
    querySetId,
    engines,
    repetition: Number(s(fd, "repetition") || "1"),
    region: opt(fd, "region"),
    webSearch: s(fd, "webSearch") === "on" || s(fd, "webSearch") === "1",
    surface: s(fd, "surface") === "official_api" ? "official_api" : "manual_ui",
    locationMode: s(fd, "locationMode") || "unspecified",
    anchorId: opt(fd, "anchorId"),
    daypart: opt(fd, "daypart"),
    modelVersion: opt(fd, "modelVersion"),
    note: opt(fd, "note"),
  });
  refresh();
});

/** 复制为复测协议。只允许覆盖环境类条件，平台/联网/界面不可改 */
export const protocolClone = wrap(async (fd) => {
  const sourceId = s(fd, "sourceId");
  if (!sourceId) return;
  P.cloneProtocol(sourceId, {
    label: opt(fd, "label") ?? undefined,
    region: s(fd, "region") ? s(fd, "region") : undefined,
    modelVersion: s(fd, "modelVersion") ? s(fd, "modelVersion") : undefined,
    daypart: s(fd, "daypart") ? s(fd, "daypart") : undefined,
    anchorId: s(fd, "anchorId") ? s(fd, "anchorId") : undefined,
  });
  refresh();
});

/** 批量给问题打分类 */
export const questionCategorySet = wrap(async (fd) => {
  const id = s(fd, "questionId");
  const category = opt(fd, "category");
  if (id) P.setQuestionCategory(id, category);
  revalidatePath("/console/questions");
});
