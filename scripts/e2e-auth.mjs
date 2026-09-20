/**
 * 运营台鉴权 + 模块可达性的浏览器级测试。
 *
 * 为什么用浏览器而不是 curl：登录是 Next 的 Server Action，
 * 它的跳转走 RSC 载荷而不是 HTTP 302，用 curl 判断"登录成功/失败"会误判。
 *
 * 用法：node scripts/e2e-auth.mjs <baseUrl> <password>
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
// 口令必须显式传入，不设默认值 —— 测试脚本会进公开仓库，
// 硬编码默认口令等于把凭据写进版本库（AGENTS.md 明令禁止）。
const PASSWORD = process.argv[3] ?? process.env.CONSOLE_PASSWORD;
if (!PASSWORD) {
  console.error("用法：node scripts/e2e-auth.mjs <baseUrl> <password>");
  console.error("  或设置环境变量 CONSOLE_PASSWORD");
  process.exit(2);
}
const EXE = path.join(
  os.homedir(),
  "Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

let pass = 0;
const failed = [];
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  -> " + detail : ""}`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
};

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
const page = await ctx.newPage();

/* ============ 1. 未登录必须被挡 ============ */
console.log("\n[1] 未登录访问");
for (const p of ["/console", "/console/leads", "/console/attribution"]) {
  await page.goto(BASE + p, { waitUntil: "load", timeout: 45000 });
  const url = page.url();
  const body = (await page.textContent("body")) ?? "";
  check(`${p} 被重定向到登录页`, url.includes("/console/login"), url.replace(BASE, ""));
  check(`${p} 未泄漏线索邮箱`, !/buyer@|@example-eu/i.test(body));
}

/* ============ 2. 错误口令应被拒 ============ */
console.log("\n[2] 错误口令");
await page.goto(`${BASE}/console/login`, { waitUntil: "load" });
await page.fill('input[name="password"]', "definitely-wrong-password");
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
const afterBad = page.url();
const badBody = (await page.textContent("body")) ?? "";
check("错误口令未进入运营台", afterBad.includes("/console/login"), afterBad.replace(BASE, ""));
check("错误口令给出了提示", /口令不正确|尝试次数过多/.test(badBody));

/* ============ 3. 正确口令 ============ */
console.log("\n[3] 正确口令");
await page.goto(`${BASE}/console/login?next=%2Fconsole`, { waitUntil: "load" });
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(3000);
check("登录后进入运营台", page.url().endsWith("/console"), page.url().replace(BASE, ""));

const cookies = await ctx.cookies();
const session = cookies.find((c) => c.name === "geo_console_session");
check("签发了会话 Cookie", !!session);
check("Cookie 为 HttpOnly", session?.httpOnly === true);
check("Cookie SameSite=Lax", (session?.sameSite ?? "").toLowerCase() === "lax");

/* ============ 4. 登录后七个模块可达且内容正确 ============ */
console.log("\n[4] 登录后的模块可达性");
const MODULES = [
  ["/console", "核心业务链"],
  ["/console/brands", "品牌与竞品"],
  ["/console/questions", "问题集"],
  ["/console/claims", "事实清单"],
  ["/console/sampling", "多平台采样"],
  ["/console/evaluation", "核心指标"],
  ["/console/content", "内容资产"],
  ["/console/attribution", "获客归因"],
  ["/console/leads", "线索"],
  ["/console/tool-runs", "工具使用记录"],
  ["/console/roadmap", "产品路线图"],
];
for (const [p, key] of MODULES) {
  const res = await page.goto(BASE + p, { waitUntil: "load", timeout: 45000 });
  const body = (await page.textContent("body")) ?? "";
  check(`${p}`, res?.status() === 200 && body.includes(key), `HTTP ${res?.status()}`);
}

/* ============ 5. 登出 ============ */
console.log("\n[5] 登出");
await page.goto(`${BASE}/console`, { waitUntil: "load" });
const logoutBtn = page.locator('form button:has-text("退出登录")');
if (await logoutBtn.count()) {
  await logoutBtn.first().click();
  await page.waitForTimeout(2500);
  check("登出后回到登录页", page.url().includes("/console/login"), page.url().replace(BASE, ""));
  const cookiesAfter = await ctx.cookies();
  check("会话 Cookie 已清除", !cookiesAfter.some((c) => c.name === "geo_console_session" && c.value));
  await page.goto(`${BASE}/console`, { waitUntil: "load" });
  check("登出后无法再访问运营台", page.url().includes("/console/login"));
} else {
  check("找到退出登录按钮", false);
}

await browser.close();

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f);
  process.exit(1);
}
