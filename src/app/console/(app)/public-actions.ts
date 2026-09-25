"use server";

import { revalidatePath } from "next/cache";
import { requireConsoleSession } from "@/lib/console-auth";
import * as PP from "@/lib/db/repo-public";

function s(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function refresh() {
  for (const p of ["/console/public-pages", "/console/stores", "/console/brands"]) revalidatePath(p);
}

function wrap(fn: (fd: FormData) => void | Promise<void>) {
  return async (fd: FormData) => {
    await requireConsoleSession();
    await fn(fd);
  };
}

export const storePageBuild = wrap(async (fd) => {
  const storeId = s(fd, "storeId");
  if (storeId) PP.upsertStorePage(storeId);
  refresh();
});

export const brandPageBuild = wrap(async (fd) => {
  const brandId = s(fd, "brandId");
  if (brandId) PP.upsertBrandPage(brandId);
  refresh();
});

export const pageSubmitReview = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) PP.submitForReview(id);
  refresh();
});

export const pagePublish = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) PP.publishPage(id);
  refresh();
});

export const pageArchive = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) PP.archivePage(id, s(fd, "reason") || "运营台手动下线");
  refresh();
});

export const pageDelete = wrap(async (fd) => {
  const id = s(fd, "id");
  if (id) PP.deletePage(id);
  refresh();
});
