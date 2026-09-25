/**
 * 生产环境配置守卫的单测。
 *
 * 这是安全/合规关键逻辑：一个"看起来有守护、其实不生效"的配置校验，
 * 比没有校验更危险（会让人放心地把占位配置带上线）。所以必须有测试。
 *
 * 运行：pnpm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig, isLocalUrl } from "../src/lib/config-guard.ts";

const PROD_OK = {
  APP_BASE_URL: "https://geo.example.cn",
  CONTACT_EMAIL: "hi@geo.example.cn",
  SITE_NAME: "某某 GEO 实验室",
  DATABASE_PATH: "./data/geo.db",
  CONSOLE_PASSWORD: "a-strong-operator-passphrase",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

test("合法生产配置：无错误", () => {
  const v = validateConfig(PROD_OK);
  assert.deepEqual(v.errors, []);
  assert.equal(v.bypassed, false);
});

test("缺少 APP_BASE_URL：拒绝", () => {
  const v = validateConfig({ ...PROD_OK, APP_BASE_URL: undefined });
  assert.equal(v.errors.length, 1);
  assert.match(v.errors[0], /APP_BASE_URL 未设置/);
});

test("APP_BASE_URL 指向本机：拒绝（这是最容易带上线的错误）", () => {
  for (const url of [
    "http://localhost:3100",
    "https://localhost",
    "http://127.0.0.1:8080",
    "http://0.0.0.0:3000",
    "http://myapp.local",
    "http://db.internal",
  ]) {
    const v = validateConfig({ ...PROD_OK, APP_BASE_URL: url });
    assert.ok(
      v.errors.some((e) => /指向本机地址/.test(e)),
      `${url} 应被判定为本机地址并被拒绝`,
    );
  }
});

test("APP_BASE_URL 非法：拒绝", () => {
  const v = validateConfig({ ...PROD_OK, APP_BASE_URL: "不是一个网址" });
  assert.ok(v.errors.some((e) => /不是合法 URL/.test(e)));
});

test("http（非 https）：只警告，不阻断", () => {
  const v = validateConfig({ ...PROD_OK, APP_BASE_URL: "http://geo.example.cn" });
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => /建议使用 https/.test(w)));
});

test("占位邮箱：拒绝（否则线索无人接收）", () => {
  for (const email of ["hello@example.com", "you@company.com", "test@example.com", "Admin@Example.com"]) {
    const v = validateConfig({ ...PROD_OK, CONTACT_EMAIL: email });
    assert.ok(
      v.errors.some((e) => /占位邮箱/.test(e)),
      `${email} 应被判定为占位邮箱并被拒绝`,
    );
  }
});

test("邮箱缺失或格式错误：拒绝", () => {
  assert.ok(validateConfig({ ...PROD_OK, CONTACT_EMAIL: undefined }).errors.length > 0);
  assert.ok(validateConfig({ ...PROD_OK, CONTACT_EMAIL: "not-an-email" }).errors.length > 0);
});

test("DATABASE_PATH 为空字符串：拒绝", () => {
  const v = validateConfig({ ...PROD_OK, DATABASE_PATH: "   " });
  assert.ok(v.errors.some((e) => /DATABASE_PATH/.test(e)));
});

test("显式逃生口：标记为 bypassed（不改变 errors 内容，由调用方决定是否阻断）", () => {
  const v = validateConfig({ ...PROD_OK, APP_BASE_URL: "http://localhost:3100", ALLOW_INSECURE_DEFAULTS: "1" });
  assert.equal(v.bypassed, true);
  // 关键：errors 仍然被计算出来，逃生口只是让调用方跳过阻断
  assert.ok(v.errors.length > 0, "即使开启逃生口，也应如实报告问题");
});

test("逃生口只认精确值 1，其它值不生效", () => {
  for (const v of ["true", "yes", "0", ""]) {
    assert.equal(
      validateConfig({ ...PROD_OK, ALLOW_INSECURE_DEFAULTS: v }).bypassed,
      false,
      `ALLOW_INSECURE_DEFAULTS=${JSON.stringify(v)} 不应生效`,
    );
  }
});

test("isLocalUrl 边界：真实域名与相似字符串不应误判", () => {
  assert.equal(isLocalUrl("https://geo.example.cn"), false);
  assert.equal(isLocalUrl("https://localhost.example.com"), false, "域名里含 localhost 但并非本机");
  assert.equal(isLocalUrl("https://notlocalhost"), false, "裸 endsWith 的经典陷阱：notlocalhost");
  assert.equal(isLocalUrl("https://mylocalhost"), false);
  assert.equal(isLocalUrl("https://mylocal"), false);
  assert.equal(isLocalUrl("https://localhost.evil.com"), false, "localhost 只出现在子域前缀也不算本机");
  assert.equal(isLocalUrl("http://app.localhost"), true, ".localhost 后缀应命中");
  assert.equal(isLocalUrl("http://127.5.5.5:3000"), true, "127.0.0.0/8 整段应命中");
  assert.equal(isLocalUrl("http://localhost"), true);
  assert.equal(isLocalUrl("垃圾"), false, "非法输入不误判为本机");
});

/* =========================================================================
 * 运营台鉴权是硬门槛：缺失等于没有门。
 * 添加这组断言的原因：加鉴权之前 /console/leads 未授权就能读到线索邮箱。
 * ========================================================================= */

test("缺少 CONSOLE_PASSWORD：拒绝启动", () => {
  const v = validateConfig({ ...PROD_OK, CONSOLE_PASSWORD: undefined });
  assert.ok(v.errors.some((e) => /CONSOLE_PASSWORD 未设置/.test(e)));
});

test("缺少 AUTH_SECRET：拒绝启动", () => {
  const v = validateConfig({ ...PROD_OK, AUTH_SECRET: undefined });
  assert.ok(v.errors.some((e) => /AUTH_SECRET 未设置/.test(e)));
});

test("口令或密钥过短：拒绝启动", () => {
  assert.ok(validateConfig({ ...PROD_OK, CONSOLE_PASSWORD: "abc" }).errors.some((e) => /过短/.test(e)));
  assert.ok(validateConfig({ ...PROD_OK, AUTH_SECRET: "short" }).errors.some((e) => /过短/.test(e)));
});

test("示例口令：警告但不阻断（避免本地开发被卡住）", () => {
  const v = validateConfig({ ...PROD_OK, CONSOLE_PASSWORD: "change-me-before-deploy" });
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => /示例值/.test(w)));
});

/* ------------------------------------------------------------------ *
 * C1：构建期 / 运行期分离
 *
 * 为什么要分开：密钥一旦出现在构建环境，就会被写进镜像层 ——
 * 任何拿到镜像的人都能从历史层里读出运营台口令。
 * 反过来，会被固化进静态 HTML 的公开配置（SITE_NAME、CONTACT_EMAIL）
 * 必须在构建期就拦住占位值，否则整批产物都得重做。
 * ------------------------------------------------------------------ */

const GOOD_PUBLIC = {
  APP_BASE_URL: "https://geo.example.com",
  SITE_NAME: "某站点",
  CONTACT_EMAIL: "ops@geo.example.com",
};
const GOOD_SECRETS = {
  CONSOLE_PASSWORD: "a-strong-passphrase",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  DATABASE_PATH: "/data/geo.db",
};

test("构建期：不要求任何密钥（密钥不该出现在构建环境）", () => {
  const v = validateConfig({ ...GOOD_PUBLIC }, "build");
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
});

test("构建期：即使完全没有密钥也不报错", () => {
  const v = validateConfig({ APP_BASE_URL: "https://geo.example.com", CONTACT_EMAIL: "o@e.com" }, "build");
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
});

test("构建期：占位公开配置必须被拦住", () => {
  const v = validateConfig({ ...GOOD_PUBLIC, CONTACT_EMAIL: "hello@example.com" }, "build");
  assert.ok(v.errors.some((e) => e.includes("占位邮箱")), JSON.stringify(v.errors));
});

test("构建期：本机 APP_BASE_URL 必须被拦住", () => {
  const v = validateConfig({ ...GOOD_PUBLIC, APP_BASE_URL: "http://localhost:3100" }, "build");
  assert.ok(v.errors.some((e) => e.includes("本机地址")), JSON.stringify(v.errors));
});

test("运行期：不重复校验公开配置", () => {
  // 公开配置已在构建期查过；运行期只关心密钥与数据
  const v = validateConfig({ ...GOOD_SECRETS, APP_BASE_URL: "http://localhost:3100", CONTACT_EMAIL: "hello@example.com" }, "runtime");
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
});

test("运行期：缺密钥必须拦住", () => {
  const v = validateConfig({ DATABASE_PATH: "/data/geo.db" }, "runtime");
  assert.ok(v.errors.some((e) => e.includes("CONSOLE_PASSWORD")));
  assert.ok(v.errors.some((e) => e.includes("AUTH_SECRET")));
});

test("all：两个阶段的问题都要报出来", () => {
  const v = validateConfig({ APP_BASE_URL: "http://localhost:1", CONTACT_EMAIL: "hello@example.com" }, "all");
  assert.ok(v.errors.some((e) => e.includes("本机地址")));
  assert.ok(v.errors.some((e) => e.includes("占位邮箱")));
  assert.ok(v.errors.some((e) => e.includes("CONSOLE_PASSWORD")));
});

test("省略阶段参数时等价于 all（向后兼容）", () => {
  const a = validateConfig({});
  const b = validateConfig({}, "all");
  assert.deepEqual(a.errors, b.errors);
  assert.deepEqual(a.warnings, b.warnings);
});

test("构建期不产生密钥相关警告（避免在 CI 日志里提示去配密钥）", () => {
  const v = validateConfig({ ...GOOD_PUBLIC }, "build");
  assert.ok(!v.warnings.some((w) => w.includes("LEAD_NOTIFY_WEBHOOK")), JSON.stringify(v.warnings));
});
