/** Repeatable, loopback-only local deployment. Never modifies an existing .env.local or database. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

const root = process.cwd();
const envFile = path.join(root, ".env.local");
const runDir = path.join(root, ".local");
const pidFile = path.join(runDir, "server.pid");
const logFile = path.join(runDir, "server.log");
const port = 3100;
const url = `http://127.0.0.1:${port}`;
const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");

function random(size) { return crypto.randomBytes(size).toString("base64url"); }
function setup() {
  if (!fs.existsSync(envFile)) {
    const env = [
      `APP_BASE_URL=${url}`,
      "DATABASE_PATH=./data/geo-local.db",
      "SITE_NAME=GEO 可见度实验室",
      "CONTACT_EMAIL=geo-local@example.invalid",
      `CONSOLE_PASSWORD=${random(24)}`,
      `AUTH_SECRET=${random(48)}`,
      `IP_HASH_SALT=${random(24)}`,
      "ALLOW_INSECURE_DEFAULTS=1",
      "# 正式接收线索前配置 LEAD_NOTIFY_WEBHOOK 与真实 CONTACT_EMAIL",
      "# PERPLEXITY_API_KEY=",
      "# WORDPRESS_BASE_URL=",
      "# WORDPRESS_USERNAME=",
      "# WORDPRESS_APP_PASSWORD=",
      "# PUBLISH_WEBHOOK_URL=",
      "# PUBLISH_WEBHOOK_TOKEN=",
    ].join("\n") + "\n";
    fs.writeFileSync(envFile, env, { mode: 0o600, flag: "wx" });
    console.log(`已生成本机配置：${envFile}（权限仅当前用户可读）`);
  } else console.log(`保留现有本机配置：${envFile}`);
  fs.mkdirSync(runDir, { recursive: true });
  console.log("首次启动前运行 pnpm build。构建时必须已有 APP_BASE_URL，换域名后需重新构建。");
}
function pid() {
  try { const n = Number(fs.readFileSync(pidFile, "utf8")); if (Number.isInteger(n) && n > 0) { process.kill(n, 0); return n; } } catch { /* stale/missing */ }
  return null;
}
async function status() {
  const running = pid();
  let healthy = false;
  try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2500) }); healthy = r.ok && (await r.json()).ok === true; } catch { /* unavailable */ }
  console.log(JSON.stringify({ pid: running, healthy, url }, null, 2));
  return healthy;
}
async function start() {
  setup();
  if (pid()) { console.log("本机服务已经运行。"); await status(); return; }
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("尚未构建：请先运行 pnpm build");
  execFileSync(process.execPath, [path.join(root, "scripts", "preflight.ts")], { cwd: root, stdio: "inherit" });
  const log = fs.openSync(logFile, "a", 0o600);
  const child = spawn(process.execPath, [nextCli, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root, detached: true, stdio: ["ignore", log, log], env: { ...process.env, NODE_ENV: "production" },
  });
  fs.closeSync(log);
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try { const r = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) }); if (r.ok && (await r.json()).ok) { console.log(`本机服务已启动：${url}`); return; } } catch { /* still starting */ }
  }
  throw new Error(`服务未通过健康检查，请查看 ${logFile}`);
}
function stop() {
  const running = pid();
  if (!running) { console.log("本机服务未运行。"); return; }
  process.kill(running, "SIGTERM");
  console.log(`已停止本机服务 PID ${running}`);
}
const cmd = process.argv[2];
try {
  if (cmd === "setup") setup();
  else if (cmd === "start") await start();
  else if (cmd === "stop") stop();
  else if (cmd === "status") { if (!(await status())) process.exitCode = 1; }
  else { console.error("用法：node scripts/local-service.mjs setup|start|status|stop"); process.exitCode = 2; }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
