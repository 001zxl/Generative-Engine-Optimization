/**
 * 视觉验收：对关键页面截图，用于人工核对 UI（不参与构建）。
 *
 * 复用本机已缓存的 Playwright Chromium，不额外下载浏览器。
 *   node scripts/screenshot.mjs            # 全部页面
 *   node scripts/screenshot.mjs home       # 指定页面
 *
 * 需要服务已在 http://localhost:3100 运行。
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CACHE = path.join(os.homedir(), "Library/Caches/ms-playwright");
const EXE = path.join(CACHE, "chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");

const BASE = process.env.SCREENSHOT_BASE ?? "http://localhost:3100";
const OUT = path.join(process.cwd(), "screenshots");

const only = process.argv[2];
const viewportOnly = process.env.VIEWPORT_ONLY === "1";

const PAGES = [
  { name: "home", url: "/", full: true },
  { name: "tool-crawler", url: "/tools/ai-crawler-check", full: true },
  { name: "tool-citability", url: "/tools/citation-readiness", full: true },
  { name: "methods", url: "/methods", full: true },
  { name: "console", url: "/console", full: true },
  { name: "console-roadmap", url: "/console/roadmap", full: true },
  { name: "m1-brands", url: "/console/brands", full: true },
  { name: "m2-questions", url: "/console/questions", full: true },
  { name: "m3-claims", url: "/console/claims", full: true },
  { name: "m4-sampling", url: "/console/sampling", full: true },
  { name: "m5-evaluation", url: "/console/evaluation", full: true },
  { name: "m6-content", url: "/console/content", full: true },
  { name: "m7-attribution", url: "/console/attribution", full: true },
  { name: "console-leads", url: "/console/leads", full: true },
  { name: "console-tool-runs", url: "/console/tool-runs", full: true },
  // 结果页需要真实 slug，由调用方通过 RESULT_SLUG 传入
  ...(process.env.RESULT_SLUG
    ? [{ name: "result", url: `/r/${process.env.RESULT_SLUG}`, full: true }]
    : []),
];

if (!fs.existsSync(EXE)) {
  console.error("找不到 Chromium：", EXE);
  console.error("请安装 playwright 浏览器，或修改脚本里的 EXE 路径。");
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
});

const targets = only ? PAGES.filter((p) => p.name === only) : PAGES;
let failed = 0;

for (const p of targets) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // 用 load 而不是 networkidle：Next 的 RSC prefetch 会长时间保持连接，
  // networkidle 会假超时（这个问题本身就是一次真实排查的产物）。
  const res = await page.goto(BASE + p.url, { waitUntil: "load", timeout: 45000 });
  // 等字体与 Magic UI 的入场动画跑完再截
  await page.waitForTimeout(1500);

  const file = path.join(OUT, `${p.name}.png`);
  await page.screenshot({ path: file, fullPage: p.full && !viewportOnly });

  // 横向溢出检查（响应式最常见的可见缺陷）
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  const status = res?.status() ?? 0;
  const realErrors = errors.filter((e) => !/favicon/i.test(e));
  const ok = status >= 200 && status < 400 && realErrors.length === 0 && overflow <= 1;
  if (!ok) failed++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${p.name.padEnd(18)} HTTP ${status}  溢出 ${overflow}px  ${
      realErrors.length ? "| 控制台错误: " + realErrors.slice(0, 3).join(" / ") : ""
    }`,
  );
  await page.close();
}

await browser.close();

console.log(failed === 0 ? "\n全部页面截图完成，无控制台错误、无横向溢出。" : `\n${failed} 个页面有问题。`);
process.exit(failed === 0 ? 0 : 1);
