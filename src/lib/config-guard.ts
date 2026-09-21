/**
 * 生产环境配置校验（纯函数，可单测）。
 *
 * 与 scripts/preflight.ts 的关系：脚本负责读 .env 与打印，这里只做判定。
 * 把判定抽出来的理由很实际 —— "拒绝启动"的逻辑如果自己有 bug，
 * 就会出现"以为有守护、其实没生效"的最坏情况。所以它必须有测试覆盖。
 */

export interface ConfigEnv {
  NODE_ENV?: string;
  CONSOLE_PASSWORD?: string;
  AUTH_SECRET?: string;
  APP_BASE_URL?: string;
  CONTACT_EMAIL?: string;
  SITE_NAME?: string;
  DATABASE_PATH?: string;
  ALLOW_INSECURE_DEFAULTS?: string;
  LEAD_NOTIFY_WEBHOOK?: string;
  CI?: string;
}

export interface ConfigVerdict {
  /** 会阻止启动的问题 */
  errors: string[];
  /** 不阻止启动、但需要提醒的问题 */
  warnings: string[];
  /** 是否因显式逃生口而跳过 */
  bypassed: boolean;
}

const PLACEHOLDER_EMAILS = [
  "hello@example.com",
  "you@company.com",
  "test@example.com",
  "admin@example.com",
];

/**
 * 判定是否指向本机 / 内网。
 *
 * ⚠️ 这里必须按「标签边界」匹配，不能用裸 endsWith：
 * "notlocalhost".endsWith("localhost") 为真 —— 会把一个合法域名误判为本机而拒绝启动。
 * 这是被单测抓出来的真实缺陷。
 */
const LOCAL_HOSTS_EXACT = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"];
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal"];

export function isLocalUrl(value: string): boolean {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOCAL_HOSTS_EXACT.includes(host)) return true;
  if (/^127\./.test(host)) return true; // 127.0.0.0/8
  if (LOCAL_HOST_SUFFIXES.some((s) => host.endsWith(s))) return true;
  return false;
}

export function validateConfig(env: ConfigEnv): ConfigVerdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bypassed = env.ALLOW_INSECURE_DEFAULTS === "1";

  const baseUrl = (env.APP_BASE_URL ?? "").trim();
  const contactEmail = (env.CONTACT_EMAIL ?? "").trim();
  const siteName = (env.SITE_NAME ?? "").trim();

  /* —— 1. APP_BASE_URL：canonical / OpenGraph / sitemap 全部由它派生 —— */
  if (!baseUrl) {
    errors.push(
      "APP_BASE_URL 未设置。canonical / OpenGraph / sitemap 都由它派生，" +
        "留空会让它们退回 http://localhost:3100。",
    );
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      errors.push(`APP_BASE_URL 不是合法 URL：${baseUrl}`);
    }
    if (parsed) {
      if (parsed.protocol !== "https:") {
        warnings.push(
          `APP_BASE_URL 使用 ${parsed.protocol}。生产环境建议使用 https —— ` +
            "明文站点在 AI 抓取与可信度上都处于劣势。",
        );
      }
      if (isLocalUrl(baseUrl)) {
        errors.push(
          `APP_BASE_URL 指向本机地址（${baseUrl}）。这会让所有 canonical / sitemap 指向 localhost，` +
            "搜索引擎与 AI 爬虫会据此建立错误的规范地址。请替换为真实域名。",
        );
      }
    }
  }

  /* —— 2. CONTACT_EMAIL：占位邮箱会让线索直接丢失 —— */
  if (!contactEmail) {
    errors.push("CONTACT_EMAIL 未设置 —— 页面上会没有可用的联系方式，客户咨询会丢失。");
  } else if (PLACEHOLDER_EMAILS.includes(contactEmail.toLowerCase())) {
    errors.push(
      `CONTACT_EMAIL 仍是占位邮箱（${contactEmail}）。上线前必须替换为真实可收信的地址，` +
        "否则线索表单提交后无人接收。",
    );
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail)) {
    errors.push(`CONTACT_EMAIL 不是合法邮箱：${contactEmail}`);
  }

  /* —— 3. 线索提醒通道：不阻断，但必须显式警告 —— */
  if (bypassed) {
    // 本地自测允许没有通知通道
  } else if (!(env.LEAD_NOTIFY_WEBHOOK ?? "").trim()) {
    warnings.push(
      "LEAD_NOTIFY_WEBHOOK 未配置：新线索会入库但不会提醒任何人。" +
        "正式获客前请配置（钉钉/企微/飞书 机器人 Webhook）。",
    );
  }

  /* —— 4. SITE_NAME —— */
  if (!siteName) warnings.push("SITE_NAME 未设置，将使用默认名称。");

  /* —— 4. 运营台鉴权：缺失等于没有门，必须阻止启动 —— */
  const consolePassword = (env.CONSOLE_PASSWORD ?? "").trim();
  const authSecret = (env.AUTH_SECRET ?? "").trim();
  if (!consolePassword) {
    errors.push(
      "CONSOLE_PASSWORD 未设置。/console 含线索联系方式与品牌数据，缺失鉴权时系统会拒绝访问（fail closed）。",
    );
  } else if (consolePassword.length < 6) {
    errors.push(`CONSOLE_PASSWORD 过短（${consolePassword.length} 位），至少 6 位。`);
  } else if (/^(change-me|password|123456|admin)/i.test(consolePassword)) {
    warnings.push("CONSOLE_PASSWORD 看起来是示例值，生产环境请换成强口令。");
  }
  if (!authSecret) {
    errors.push("AUTH_SECRET 未设置。会话 Cookie 的签名密钥，缺失会导致无法登录。");
  } else if (authSecret.length < 16) {
    errors.push(`AUTH_SECRET 过短（${authSecret.length} 位），至少 16 位。建议 openssl rand -base64 32。`);
  }

  /* —— 5. 数据库路径 —— */
  const dbPath = env.DATABASE_PATH ?? "./data/geo.db";
  if (dbPath.trim() === "") errors.push("DATABASE_PATH 为空字符串。");

  return { errors, warnings, bypassed };
}
