"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  COOKIE_NAME,
  createSessionToken,
  isAuthConfigured,
  safeNextPath,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/auth";
import { defaultThrottle, evaluateAttempt, noteFailure, noteSuccess } from "@/lib/auth-throttle";
import { hashIp } from "@/lib/id";

/**
 * 失败计数的键必须来自**服务端可观测**的信息，不能用客户端提交的字段。
 *
 * 旧实现用表单里的隐藏字段 `hint` 作键 —— 攻击者改个值就有全新计数器，
 * 节流完全无效。现在按客户端 IP 分桶，另有全局兜底（见 auth-throttle.ts）。
 */
async function clientKey(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0].trim() : (h.get("x-real-ip") ?? "0.0.0.0");
  return hashIp(ip);
}

export async function login(fd: FormData): Promise<void> {
  const password = String(fd.get("password") ?? "");
  const next = safeNextPath(String(fd.get("next") ?? "/console"));

  if (!isAuthConfigured()) redirect("/console/login?unconfigured=1");

  const key = await clientKey();
  const state = defaultThrottle();

  const verdict = evaluateAttempt(state, key, Date.now());
  if (!verdict.allowed) {
    redirect(`/console/login?error=locked&next=${encodeURIComponent(next)}`);
  }

  if (!(await verifyPassword(password))) {
    noteFailure(state, key, Date.now());
    redirect(`/console/login?error=bad&next=${encodeURIComponent(next)}`);
  }

  noteSuccess(state, key);
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
