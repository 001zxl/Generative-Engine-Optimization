"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireConsoleSession } from "@/lib/console-auth";
import { createPublicationDispatch, executePublicationDispatch, reconcilePublicationDispatch, resetUnpublishedDispatch, checkPublicationDispatch } from "@/lib/publishing";

async function runAction(work: () => Promise<string>): Promise<void> {
  await requireConsoleSession();
  let message = "", error = false;
  try { message = await work(); }
  catch (e) { error = true; message = e instanceof Error ? e.message : "操作失败，请重试"; }
  revalidatePath("/console/publishing");
  revalidatePath("/console/content");
  revalidatePath("/knowledge");
  revalidatePath("/sitemap.xml");
  redirect(`/console/publishing?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

export async function queuePublication(fd: FormData): Promise<void> {
  await runAction(async () => {
    createPublicationDispatch(String(fd.get("assetId") ?? ""), String(fd.get("channel") ?? ""));
    return "发布任务已准备，核对目标后点击执行；重复创建相同内容会复用原任务。";
  });
}

export async function executePublication(fd: FormData): Promise<void> {
  await runAction(async () => {
    const result = await executePublicationDispatch(String(fd.get("id") ?? ""));
    if (result.status !== "succeeded") throw new Error(result.error || "发布仍在执行，请刷新查看");
    return "发布成功，URL 已自动写回。可继续点击复测。";
  });
}

export async function reconcilePublication(fd: FormData): Promise<void> {
  await runAction(async () => {
    reconcilePublicationDispatch(String(fd.get("id") ?? ""), String(fd.get("url") ?? ""), fd.get("confirmed") === "on");
    return "已记录人工核对结果和发布 URL。";
  });
}

export async function resetPublication(fd: FormData): Promise<void> {
  await runAction(async () => {
    resetUnpublishedDispatch(String(fd.get("id") ?? ""), fd.get("confirmedAbsent") === "on");
    return "已记录未发布确认，任务可再次执行。";
  });
}

export async function recheckPublication(fd: FormData): Promise<void> {
  await runAction(async () => {
    const result = await checkPublicationDispatch(String(fd.get("id") ?? ""));
    if (!result.ok) throw new Error(result.note);
    return result.note;
  });
}
