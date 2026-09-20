/**
 * 评估页 P0 缺陷的浏览器级回归测试。
 *
 * 复现用户报的原始场景：**不动下拉框，直接点「运行评估」**。
 * 修复前这会提交空 runId → 服务端写入不存在的 run_id "manual" → SQLite
 * FOREIGN KEY constraint failed → HTTP 500。
 *
 * 这个测试刻意走真实浏览器点击，而不是直接调函数 ——
 * 因为缺陷本身就出在「前端默认值 与 页面展示 不一致」这个层面上。
 *
 * 用法：node scripts/e2e-eval-click.mjs <baseUrl>
 */
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3101";
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

/* —— 运营台现在需要登录，先建立会话 —— */
const PASSWORD = process.env.CONSOLE_PASSWORD ?? "geo-console-local-dev";
await page.goto(`${BASE}/console/login`, { waitUntil: "load", timeout: 45000 });
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);
if (page.url().includes("/console/login")) {
  console.error("登录失败，无法继续评估测试。请确认 CONSOLE_PASSWORD。");
  await browser.close();
  process.exit(1);
}
console.log("已登录运营台");

const responses = [];
const pageErrors = [];
page.on("response", (r) => {
  if (r.url().includes("/console/evaluation")) responses.push(r.status());
});
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(m.text());
});

console.log(`\n打开 ${BASE}/console/evaluation`);
await page.goto(`${BASE}/console/evaluation`, { waitUntil: "load", timeout: 45000 });
await page.waitForTimeout(800);

/* —— 1. 下拉框默认选中项 应与表单可用状态一致 —— */
const selectValue = await page.$eval('select[name="runId"]', (el) => el.value).catch(() => null);
const selectLabel = await page.$eval('select[name="runId"]', (el) =>
  el.options[el.selectedIndex]?.textContent?.trim(),
).catch(() => null);
console.log(`  下拉框当前选中: value=${JSON.stringify(selectValue)}  label=${JSON.stringify(selectLabel)}`);

// 页面必须显示「运行评估」按钮
const btn = page.locator('form:has(select[name="runId"]) button[type="submit"]');
check("找到「运行评估」按钮", (await btn.count()) > 0);

/* —— 2. 核心：不动下拉框，直接点 —— */
console.log("\n不动下拉框，直接点击「运行评估」…");
responses.length = 0;
await btn.first().click();
await page.waitForTimeout(4000);

const has500 = responses.includes(500);
const hasAnyError = responses.some((s) => s >= 500);
check("未返回 HTTP 500", !has500, `收到的状态码: ${JSON.stringify(responses)}`);
check("未返回任何 5xx", !hasAnyError);
check("页面无未捕获异常", pageErrors.length === 0, pageErrors.slice(0, 2).join(" / ") || "无");

const body = await page.textContent("body");
check("页面未出现外键/500 报错文案", !/FOREIGN KEY|constraint failed|Internal Server Error/i.test(body ?? ""));

/* —— 3. 指标应真的产生（夹具库里有 2 个样本）—— */
check("页面出现核心指标区", /品牌提及率|核心指标/.test(body ?? ""));
const hasPercent = /\d+\.\d%/.test(body ?? "");
check("渲染出百分比数值", hasPercent, (body ?? "").match(/\d+\.\d%/g)?.slice(0, 4).join(", "));
check("指标标注了计算范围", /范围：/.test(body ?? ""));

/* —— 4. 关键路径：显式选「全部样本」（跨批次）—— 这正是写入假外键的那条 —— */
console.log("\n显式选择「全部样本（跨批次）」，再次点击…");
await page.selectOption('select[name="runId"]', "");
const chosen = await page.$eval('select[name="runId"]', (el) => el.value);
check("已切到跨批次范围（value 为空字符串）", chosen === "", JSON.stringify(chosen));

responses.length = 0;
pageErrors.length = 0;
await btn.first().click();
await page.waitForTimeout(4000);

check("跨批次评估未返回 5xx", !responses.some((s) => s >= 500), `状态码: ${JSON.stringify(responses)}`);
check("跨批次评估页面无异常", pageErrors.length === 0, pageErrors.slice(0, 2).join(" / ") || "无");
const body2 = await page.textContent("body");
check("跨批次评估后仍渲染指标", /\d+\.\d%/.test(body2 ?? ""));
check(
  "指标范围显示为「全部样本（跨批次）」",
  /全部样本（跨批次）/.test(body2 ?? ""),
  (body2 ?? "").match(/范围：[^\n]{0,30}/)?.[0],
);

await browser.close();

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f);
  process.exit(1);
}
