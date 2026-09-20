/**
 * 运营台访问控制。
 *
 * 在加这一层之前：/console/leads 未授权就能读到真实线索邮箱，
 * robots.txt 的 Disallow 只是"请求搜索引擎不要收录"，完全不构成访问控制。
 *
 * 策略：
 *  - 除 /console/login 外的所有 /console/* 都要求有效会话
 *  - **未配置鉴权时一律拒绝**（fail closed），而不是放行 ——
 *    配置缺失绝不能等于没有门
 *  - 未登录时 302 到登录页，并带上来源路径（经 safeNextPath 过滤，防开放重定向）
 */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, isAuthConfigured, verifySessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // 登录页本身放行
  if (pathname === "/console/login") return NextResponse.next();

  const configured = isAuthConfigured();
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = configured && (await verifySessionToken(token));
  if (ok) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/console/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  if (!configured) url.searchParams.set("unconfigured", "1");
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/console", "/console/:path*"],
};
