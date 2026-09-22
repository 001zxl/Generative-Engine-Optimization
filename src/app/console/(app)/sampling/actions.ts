"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireConsoleSession } from "@/lib/console-auth";
import { collectPerplexity, saveManualObservation } from "@/lib/sampling";

const value = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败";

export async function observationSave(fd: FormData): Promise<void> {
  await requireConsoleSession();
  const runId = value(fd, "runId");
  let message = "回答原文、模型与来源已保存";
  let failed = false;
  try {
    saveManualObservation({ taskId: value(fd, "taskId"), answer: value(fd, "rawAnswer"),
      modelVersion: value(fd, "modelVersion"), collectedAt: value(fd, "collectedAt"),
      sourceUrl: value(fd, "sourceUrl"), citationUrls: value(fd, "citationUrls") });
  } catch (error) { failed = true; message = errorText(error); }
  revalidatePath("/console/sampling");
  redirect(`/console/sampling?run=${encodeURIComponent(runId)}&${failed ? "error" : "message"}=${encodeURIComponent(message)}`);
}

export async function perplexityCollect(fd: FormData): Promise<void> {
  await requireConsoleSession();
  const runId = value(fd, "runId");
  let message = "官方 API 回答和引用已保存";
  let failed = false;
  try { await collectPerplexity(value(fd, "taskId")); }
  catch (error) { failed = true; message = errorText(error); }
  revalidatePath("/console/sampling");
  redirect(`/console/sampling?run=${encodeURIComponent(runId)}&${failed ? "error" : "message"}=${encodeURIComponent(message)}`);
}
