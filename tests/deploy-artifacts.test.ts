import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 部署产物的回归检查。
 *
 * 这些断言都很"笨"（读文件、匹配字符串），但它们守住的是几条一旦破坏
 * 就难以察觉的边界 —— 尤其是"密钥会进入镜像层"这类问题：
 * 发生的时候看不出来，等发现时镜像可能已经在别处了。
 *
 * 不引入 YAML 解析依赖：只针对少量明确不变量做定向匹配。
 */

const root = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

/* ---------------- .dockerignore ---------------- */

test(".dockerignore 必须排除环境文件与数据库（否则密钥进镜像层）", () => {
  const text = read(".dockerignore");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  assert.ok(lines.includes(".env"), "必须排除 .env");
  assert.ok(lines.includes(".env.*"), "必须排除 .env.*（覆盖 .env.production）");
  assert.ok(lines.includes("!.env.example"), "应保留 .env.example 作为模板");
  assert.ok(lines.some((l) => l === "data/" || l === "data"), "必须排除 data/");
  assert.ok(lines.some((l) => l === "*.db"), "必须排除 *.db");
  assert.ok(lines.some((l) => l === ".git" || l === ".git/"), "必须排除 .git");
  assert.ok(lines.some((l) => l.startsWith("node_modules")), "应排除 node_modules");
});

test(".dockerignore 的排除顺序不会把环境文件重新包含进来", () => {
  const lines = read(".dockerignore")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  // 任何 `!.env` 之后若紧跟 `.env*` 之类的再排除，语义容易出错 —— 只允许 !.env.example
  const negations = lines.filter((l) => l.startsWith("!"));
  assert.deepEqual(negations, ["!.env.example", "!README.md"]);
});

/* ---------------- Dockerfile ---------------- */

test("Dockerfile 不得把密钥作为构建参数或环境变量", () => {
  const text = read("deploy/Dockerfile");
  for (const secret of ["CONSOLE_PASSWORD", "AUTH_SECRET", "LEAD_NOTIFY_WEBHOOK", "PERPLEXITY_API_KEY", "WORDPRESS_APP_PASSWORD"]) {
    // 允许出现在注释里，但不允许出现在 ARG / ENV 指令中
    const argOrEnv = new RegExp(`^\\s*(ARG|ENV)\\s+${secret}`, "m");
    assert.ok(!argOrEnv.test(text), `${secret} 不得作为 ARG/ENV 出现在 Dockerfile 中`);
  }
});

test("Dockerfile 的构建参数里没有任何密钥", () => {
  const text = read("deploy/Dockerfile");
  // 同一个 ARG 可能在多个阶段重复声明，去重后比较
  const args = [...new Set([...text.matchAll(/^\s*ARG\s+(\w+)/gm)].map((m) => m[1]))].sort();
  // 允许的构建参数只有公开配置与 npm 源；密钥一律不得成为 ARG
  assert.deepEqual(args, ["APP_BASE_URL", "CONTACT_EMAIL", "NPM_REGISTRY", "SITE_NAME"]);
  for (const arg of args) {
    assert.ok(!/PASSWORD|SECRET|TOKEN|KEY/i.test(arg), `${arg} 看起来是密钥，不得作为构建参数`);
  }
});

test("Dockerfile 以非 root 运行并声明数据卷挂载点", () => {
  const text = read("deploy/Dockerfile");
  assert.match(text, /^USER\s+app$/m, "必须有非 root 的 USER");
  assert.match(text, /useradd|adduser/, "必须创建非 root 用户");
  assert.match(text, /ENV\s+DATABASE_PATH=\/data\//, "DATABASE_PATH 应指向持久卷挂载点");
  assert.match(text, /HEALTHCHECK/, "必须声明健康检查");
});

test("容器入口在启动前先跑运行期配置校验", () => {
  const entry = read("deploy/entrypoint.sh");
  const preflightIdx = entry.indexOf("preflight.ts runtime");
  const startIdx = entry.indexOf("next start");
  assert.ok(preflightIdx > 0, "入口必须执行运行期校验");
  assert.ok(startIdx > preflightIdx, "校验必须在启动之前");
  assert.match(entry, /set -e/, "必须 set -e，校验失败要中断");
});

/* ---------------- compose ---------------- */

test("compose 不把应用端口暴露到宿主机（只经 Caddy 反代）", () => {
  const text = read("deploy/compose.yaml");
  const appBlock = text.slice(text.indexOf("  app:"), text.indexOf("  caddy:"));
  assert.ok(!/^\s{4}ports:/m.test(appBlock), "app 服务不得直接发布端口");
  assert.match(appBlock, /expose:\s*\["3000"\]/, "app 只应内部 expose 3000");

  const caddyBlock = text.slice(text.indexOf("  caddy:"));
  assert.match(caddyBlock, /"80:80"/);
  assert.match(caddyBlock, /"443:443"/);
});

test("compose 在公网环境清空两个逃生口", () => {
  const text = read("deploy/compose.yaml");
  assert.match(text, /ALLOW_INSECURE_DEFAULTS:\s*""/, "公网不得启用 ALLOW_INSECURE_DEFAULTS");
  assert.match(text, /EXTRA_TRUSTED_CIDRS:\s*""/, "公网不得启用 EXTRA_TRUSTED_CIDRS");
});

test("compose 把数据库放在命名卷上，并要求公开域名与联系邮箱", () => {
  const text = read("deploy/compose.yaml");
  assert.match(text, /geo-data:\/data/, "数据库必须挂持久卷");
  assert.match(text, /APP_BASE_URL:\s*\$\{APP_BASE_URL:\?/, "APP_BASE_URL 必须显式提供");
  assert.match(text, /CONTACT_EMAIL:\s*\$\{CONTACT_EMAIL:\?/, "CONTACT_EMAIL 必须显式提供");
  assert.match(text, /SITE_DOMAIN:\s*\$\{SITE_DOMAIN:\?/, "SITE_DOMAIN 必须显式提供");
});

/* ---------------- 备份 / 恢复 ---------------- */

test("备份用 VACUUM INTO 而不是文件复制（避免撕裂快照）", () => {
  const text = read("deploy/backup.sh");
  assert.match(text, /db-tool\.mjs"?\s+vacuum|vacuum/);
  const tool = read("deploy/db-tool.mjs");
  assert.match(tool, /VACUUM INTO/, "必须用 VACUUM INTO 生成一致性副本");
  assert.ok(!/^\s*cp\s+.*\.db/m.test(text), "备份不得用 cp 直接复制数据库文件");
});

test("恢复脚本拒绝覆盖已存在的目标", () => {
  const text = read("deploy/restore.sh");
  assert.match(text, /目标已存在，拒绝覆盖/);
  assert.match(text, /--drill/, "必须支持恢复演练模式");
});

test("备份脚本会验证副本可用，而不只是写完就算", () => {
  const text = read("deploy/backup.sh");
  assert.match(text, /db-tool\.mjs"?\s+verify|verify/);
  const tool = read("deploy/db-tool.mjs");
  assert.match(tool, /foreign_key_check/, "必须检查外键孤儿");
  assert.match(tool, /integrity_check/, "必须检查完整性");
});

/* ---------------- CI ---------------- */

test("CI 覆盖类型检查、单测、构建、镜像与备份演练", () => {
  const ci = read(".github/workflows/ci.yml");
  for (const needle of ["pnpm typecheck", "pnpm test", "pnpm build", "docker build", "deploy/backup.sh", "deploy/restore.sh"]) {
    assert.ok(ci.includes(needle), `CI 缺少步骤：${needle}`);
  }
});

test("CI 的端到端作业断言夹具库不是试点库", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.ok(ci.includes('"pilot":false') || ci.includes("'pilot':false"), "必须断言 pilot:false");
  assert.ok(ci.includes("EXTRA_TRUSTED_CIDRS=127.0.0.1/32"), "门槛检查需要显式逃生口");
});

test("部署文档说明了回滚与恢复演练", () => {
  const doc = read("deploy/README.md");
  for (const needle of ["回滚", "恢复演练", "迁移失败", "VPN"]) {
    assert.ok(doc.includes(needle), `部署文档缺少：${needle}`);
  }
  // 文档要求把密钥放进 .env.production，该文件必须已被忽略
  const gitignore = read(".gitignore");
  assert.match(gitignore, /^\.env\.\*$/m, ".env.production 必须被 gitignore 覆盖");
});

/* ---------------- 采样证据的数据库约束 ---------------- */

test("数据库层拒绝把「本平台生成的模拟回答」写成证据", () => {
  const schema = read("src/lib/db/schema-sampling.ts");
  // 注意要抓 IN (...) 里的列表，而不是 CHECK (...) 的外层括号
  const m = /evidence_kind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*evidence_kind\s+IN\s*\(([^)]*)\)/i.exec(schema);
  assert.ok(m, "sample_provenance.evidence_kind 必须有 CHECK 约束");
  const allowed = m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
  assert.deepEqual(allowed.sort(), ["fixture", "manual_ui", "official_api"]);
  assert.ok(!allowed.includes("synthetic"), "不得允许 synthetic —— 自己编的回答不能当外部结果");
});

test("纯逻辑里的证据种类与数据库 CHECK 完全一致", async () => {
  const { EVIDENCE_KINDS } = await import("../src/lib/sample-evidence.ts");
  const schema = read("src/lib/db/schema-sampling.ts");
  const m = /evidence_kind\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*evidence_kind\s+IN\s*\(([^)]*)\)/i.exec(schema)!;
  const allowed = m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).sort();
  assert.deepEqual(EVIDENCE_KINDS.map((k) => k.value).sort(), allowed);
});

test("pnpm build 用构建期阶段（构建不该需要密钥）", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  // 这条曾经是错的：build 跑的是 all 阶段，会要求 CONSOLE_PASSWORD/AUTH_SECRET，
  // 而这两个必须不出现在构建环境。Docker 构建与 CI 首次运行都会因此失败。
  assert.match(pkg.scripts.build, /preflight\.ts build/, `build 应为：${pkg.scripts.build}`);
  assert.ok(!/preflight\.ts\s*&&/.test(pkg.scripts.build), "build 不得使用 all 阶段");
});

test("pnpm start 用 all 阶段（本地起服务时公开配置与密钥都要查）", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.start, /preflight\.ts(?!\s+build|\s+runtime)/, `start 应为：${pkg.scripts.start}`);
});

test("Dockerfile 不在构建层重复执行 preflight（避免再次引入密钥依赖）", () => {
  const text = read("deploy/Dockerfile");
  const buildStage = text.slice(text.indexOf("AS builder"), text.indexOf("AS runner"));
  assert.ok(!/preflight\.ts\s*\\?\s*$|preflight\.ts build/m.test(buildStage.replace(/pnpm build/g, "")), "构建层不应单独再跑一次 preflight");
  assert.match(buildStage, /pnpm build/);
});

test("Dockerfile 的 npm 源可配置（受限网络可用镜像源）", () => {
  const text = read("deploy/Dockerfile");
  assert.match(text, /ARG NPM_REGISTRY=https:\/\/registry\.npmjs\.org/, "默认必须是官方源");
  assert.match(text, /COREPACK_NPM_REGISTRY/, "corepack 拉 pnpm 走自己的变量，必须单独设");
});

test("Dockerfile 里 COPY 的每个路径都真实存在（路径写错只有真构建才发现）", () => {
  const text = read("deploy/Dockerfile");
  const paths = [...text.matchAll(/^COPY --from=builder[^\n]*?\s(\/app\/([^\s]+))\s\.\/([^\s]+)/gm)];
  assert.ok(paths.length >= 6, `解析到 ${paths.length} 条 COPY`);
  for (const m of paths) {
    const source = m[2];
    assert.ok(fs.existsSync(path.join(root, source)), `Dockerfile 引用了不存在的路径：${source}`);
  }
});

test("Dockerfile 不引用不存在的构建参数与顶层配置文件", () => {
  const text = read("deploy/Dockerfile");
  // next 配置文件名写错过一次（next.config.ts 并不存在）
  assert.ok(!/next\.config\.ts/.test(text), "应为 next.config.mjs");
  assert.ok(/next\.config\.mjs/.test(text));
});

test("运维脚本都在镜像里（文档里写了的命令必须能跑）", () => {
  const text = read("deploy/Dockerfile");
  // 曾经只复制 entrypoint.sh，文档里的 deploy/backup.sh 在容器里不存在
  assert.match(text, /COPY --from=builder[^\n]*\/app\/deploy \.\/deploy/, "应整体复制 deploy/");
  for (const script of ["deploy/backup.sh", "deploy/restore.sh", "deploy/db-tool.mjs", "deploy/entrypoint.sh"]) {
    assert.ok(fs.existsSync(path.join(root, script)), `${script} 不存在`);
  }
});

test("部署文档里提到的容器内命令，其脚本都确实被复制进镜像", () => {
  const doc = read("deploy/README.md");
  const text = read("deploy/Dockerfile");
  const mentioned = [...doc.matchAll(/(deploy\/[a-z-]+\.(?:sh|mjs))/g)].map((m) => m[1]);
  assert.ok(mentioned.length >= 2, `文档提到 ${mentioned.length} 个脚本`);
  for (const script of new Set(mentioned)) {
    const file = script.split("/")[1];
    assert.ok(
      text.includes("./deploy") || text.includes(script),
      `文档提到 ${script}，但 Dockerfile 没有把它复制进镜像`,
    );
    assert.ok(fs.existsSync(path.join(root, script)), `${script} 文件不存在`);
  }
});
