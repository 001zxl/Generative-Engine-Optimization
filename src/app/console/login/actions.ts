"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  createSessionToken,
  isAuthConfigured,
  safeNextPath,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";

/**
 * 简单的失败计数，用于减缓口令爆破。
 * 单实例部署下内存计数够用；多实例需换成 Redis（与前期限流的限制一致）。
 */
const attempts = new Map<string, { n: number; until: number }>();
const MAX_ATTEMPTS = 8;
const LOCK_MS = 10 * 60 * 1000;

function keyOf(hint: string): string {
  return hint || "unknown";
}

function isLocked(k: string): number {
  const a = attempts.get(k);
  if (!a) return 0;
  if (Date.now() > a.until) {
    attempts.delete(k);
    return 0;
  }
  return a.n >= MAX_ATTEMPTS ? Math.ceil((a.until - Date.now()) / 1000) : 0;
}

function noteFailure(k: string): void {
  const a = attempts.get(k) ?? { n: 0, until: 0 };
  attempts.set(k, { n: a.n + 1, until: Date.now() + LOCK_MS });
}

export async function login(fd: FormData): Promise<void> {
  const password = String(fd.get("password") ?? "");
  const next = safeNextPath(String(fd.get("next") ?? "/console"));

  if (!isAuthConfigured()) redirect("/console/login?unconfigured=1");

  const k = keyOf(String(fd.get("hint") ?? ""));
  const locked = isLocked(k);
  if (locked > 0) redirect(`/console/login?error=locked&next=${encodeURIComponent(next)}`);

  if (!(await verifyPassword(password))) {
    noteFailure(k);
    redirect(`/console/login?error=bad&next=${encodeURIComponent(next)}`);
  }

  attempts.delete(k);
  const token = await createSessionToken();
  if (!token) redirect("/console/login?unconfigured=1");

  const jar = await cookies();
  jar.set({ ...sessionCookieOptions(), value: token });
  redirect(next);
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  redirect("/console/login");
}
