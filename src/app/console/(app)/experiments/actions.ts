"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireConsoleSession } from "@/lib/console-auth";
import { createExperiment, createExperimentRetest, updateExperimentNotes } from "@/lib/experiments";

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const notes = (fd: FormData) => ({ intervention: text(fd, "intervention"), publishedUrls: text(fd, "publishedUrls").split(/\r?\n/), retestDueAt: text(fd, "retestDueAt") });
const reason = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";

export async function experimentCreate(fd: FormData): Promise<void> {
  await requireConsoleSession();
  let target: string;
  try {
    const id = createExperiment({ name: text(fd, "name"), baselineRunId: text(fd, "baselineRunId"), brandId: text(fd, "brandId"), ...notes(fd) });
    target = `/console/experiments?id=${encodeURIComponent(id)}`;
  } catch (error) { target = `/console/experiments?error=${encodeURIComponent(reason(error))}`; }
  revalidatePath("/console/experiments");
  redirect(target);
}

export async function experimentRetest(fd: FormData): Promise<void> {
  await requireConsoleSession();
  const id = text(fd, "id");
  let target: string;
  try {
    const runId = createExperimentRetest(id);
    target = `/console/sampling?run=${encodeURIComponent(runId)}`;
  } catch (error) { target = `/console/experiments?id=${encodeURIComponent(id)}&error=${encodeURIComponent(reason(error))}`; }
  revalidatePath("/console/experiments");
  revalidatePath("/console/sampling");
  redirect(target);
}

export async function experimentNotesSave(fd: FormData): Promise<void> {
  await requireConsoleSession();
  const id = text(fd, "id");
  let target = `/console/experiments?id=${encodeURIComponent(id)}`;
  try { updateExperimentNotes(id, notes(fd)); } catch (error) { target += `&error=${encodeURIComponent(reason(error))}`; }
  revalidatePath("/console/experiments");
  redirect(target);
}
