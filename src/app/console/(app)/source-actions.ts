"use server";

import { revalidatePath } from "next/cache";
import { requireConsoleSession } from "@/lib/console-auth";
import * as X from "@/lib/db/repo-external";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
function opt(fd: FormData, key: string): string | null {
  const v = s(fd, key);
  return v || null;
}
function refresh() {
  for (const p of ["/console/sources", "/console/claims", "/console/geo-report"]) revalidatePath(p);
}

function wrap(fn: (fd: FormData) => void | Promise<void>) {
  return async (fd: FormData) => {
    await requireConsoleSession();
    await fn(fd);
  };
}

export const sourceCreate = wrap(async (fd) => {
  const platform = s(fd, "platform");
  const url = s(fd, "url");
  const sourceKind = s(fd, "sourceKind");
  if (!platform || !url || !sourceKind) return;
  X.createExternalSource({
    platform,
    url,
    sourceKind,
    brandId: opt(fd, "brandId"),
    claimId: opt(fd, "claimId"),
    title: opt(fd, "title"),
    topic: opt(fd, "topic"),
    publishedAt: opt(fd, "publishedAt"),
    note: opt(fd, "note"),
  });
  refresh();
});

export const sourceCheck = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) await X.checkExternalSourceLiveness(id);
  refresh();
});

export const sourceSetConflict = wrap(async (fd) => {
  const id = s(fd, "id");
  const note = s(fd, "conflictNote");
  if (id) X.setSourceConflict(id, note, opt(fd, "conflictWithId"));
  refresh();
});

export const sourceDelete = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) X.deleteExternalSource(id);
  refresh();
});
