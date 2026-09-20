/**
 * AI 相关爬虫名册。
 *
 * ⚠️ 这份名册的核心设计原则：**证据分级**。
 *
 * 网上流传的"AI 爬虫清单"大多互相抄，很多 token 只是站长为求安心写进 robots.txt 的，
 * 未必真有爬虫在用它。把这类 token 当成事实展示，正是本产品最该避免的错误
 * （我们卖的就是"结论可复核"）。因此每个条目都必须标注证据等级：
 *
 *   vendor   —— 厂商官方文档或官方公布的 UA 字符串
 *   observed —— 有独立第三方实测流量数据（跨站点监测）或服务器日志普遍观测到
 *   reported —— 仅见于社区屏蔽清单/公开模板，未找到官方或实测证据
 *
 * 判定规则（见 crawler.ts）：只有 evidence 不是 reported 的条目，
 * 被屏蔽时才可能被判为「严重问题」。reported 条目一律只作背景信息展示。
 *
 * 另一处关键区分（市面工具普遍做错的地方）：
 *   ┌ 检索/索引型（search）  —— 构建搜索索引并支撑 AI 答案引用。屏蔽 = 真的不会被引用。
 *   ├ 训练型（training）      —— 抓内容进模型参数。屏蔽不影响 AI 答案可见性。
 *   └ 用户触发型（user）      —— 用户让 AI 实时访问某页时才抓取。
 *
 * 以及一个国内平台特有的机制：**多数国产 AI 助手没有独立的检索爬虫**，
 * 而是复用母公司的搜索索引（文心一言→百度、元宝→搜狗、夸克/千问→神马）。
 * 所以对国内平台，真正的杠杆点往往是那个搜索索引的爬虫，而不是一个
 * 以 AI 产品命名的爬虫。详见 `alsoPowers` 字段与 CHINA_AI_MECHANISM。
 */

export type BotPurpose = "search" | "training" | "user";

/** 证据等级：决定我们敢对这条数据下多重的结论 */
export type BotEvidence = "vendor" | "observed" | "reported";

export type BotRegion = "global" | "cn";

export interface AiBot {
  /** robots.txt 中的 user-agent token */
  token: string;
  operator: string;
  purpose: BotPurpose;
  /** 屏蔽它是否可能导致品牌无法出现在 AI 答案中 */
  impactsAiAnswers: boolean;
  /** 判定依据的可信程度 */
  evidence: BotEvidence;
  /** 主要服务地区 */
  region: BotRegion;
  note: string;
  /** 该爬虫构建的索引/语料还被哪些 AI 产品使用 */
  alsoPowers?: string[];
  /** 已知会忽略 robots.txt 或行为激进 */
  aggressive?: boolean;
}

/** 名册最后核对时间（呈现规范：数据必须能判断新鲜度） */
export const ROSTER_UPDATED_AT = "2026-09-20";

/** 名册以季度为生命周期 —— 三个月不核对就可能漏掉新平台 */
export const ROSTER_REVIEW_CYCLE = "每季度核对一次";

export const AI_BOTS: AiBot[] = [
  /* ==================== OpenAI ==================== */
  {
    token: "OAI-SearchBot",
    operator: "OpenAI",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "ChatGPT 搜索的索引爬虫。屏蔽它，ChatGPT 搜索与答案中就引用不到你的页面。",
  },
  {
    token: "ChatGPT-User",
    operator: "OpenAI",
    purpose: "user",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note:
      "用户触发型：当用户在对话里要求 ChatGPT 打开或实时读取某个页面时才会发起抓取。" +
      "它不构建索引，但屏蔽后这些即时读取场景会拿不到你的内容。",
  },
  {
    token: "GPTBot",
    operator: "OpenAI",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "仅用于模型训练。屏蔽它常被误以为会掉出 AI 答案，实际上不影响检索与引用。",
  },

  /* ==================== Perplexity ==================== */
  {
    token: "PerplexityBot",
    operator: "Perplexity",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "Perplexity 的索引爬虫。Perplexity 的回答高度依赖实时检索，屏蔽它影响最直接。",
  },
  {
    token: "Perplexity-User",
    operator: "Perplexity",
    purpose: "user",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note:
      "用户触发型：用户让 Perplexity 读取某个具体链接时发起。Perplexity 的回答大量依赖即时抓取，" +
      "屏蔽它会让这类「直接问某个页面」的场景失效。",
  },

  /* ==================== Anthropic ==================== */
  {
    token: "Claude-SearchBot",
    operator: "Anthropic",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "Claude 的搜索索引爬虫，影响 Claude 联网回答中的引用。",
  },
  {
    token: "Claude-User",
    operator: "Anthropic",
    purpose: "user",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note:
      "用户触发型：用户在 Claude 中请求读取某个页面时发起。与 Claude-SearchBot 是两条独立链路，" +
      "屏蔽其一不会自动影响另一条。",
  },
  {
    token: "ClaudeBot",
    operator: "Anthropic",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "模型训练用。屏蔽不影响 Claude 检索到你。",
  },

  /* ==================== Google ==================== */
  {
    token: "Googlebot",
    operator: "Google",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "Google 搜索的基础索引，也是 AI Overviews / AI Mode 的来源。屏蔽它等于从 Google 生态消失。",
    alsoPowers: ["Google AI Overviews", "Google AI Mode", "Gemini（检索部分）"],
  },
  {
    token: "Google-Extended",
    operator: "Google",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "控制 Gemini 训练与 grounding 的数据使用，不影响 Google 搜索排名与收录。可用于「只拒绝训练、保留检索」。",
  },

  /* ==================== Microsoft ==================== */
  {
    token: "Bingbot",
    operator: "Microsoft",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "Bing 索引，也是 Copilot 的来源之一。",
    alsoPowers: ["Microsoft Copilot"],
  },

  /* ==================== Apple ==================== */
  {
    token: "Applebot",
    operator: "Apple",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "Siri / Spotlight 等场景的基础索引。",
  },
  {
    token: "Applebot-Extended",
    operator: "Apple",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "Apple 基础模型训练用，可单独屏蔽。",
  },

  /* ==================== 中国平台：搜索索引 ====================
     这一组是「国内 AI 可见性」的真正杠杆点。多数国产 AI 助手不自己抓网页，
     而是复用母公司的搜索索引，所以这些搜索爬虫才是决定因素。 */
  {
    token: "Baiduspider",
    operator: "百度",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "cn",
    note: "百度搜索的基础索引。文心一言与百度 AI 搜索的回答大量依赖这份索引，屏蔽它等于从百度 AI 生态消失。",
    alsoPowers: ["文心一言", "百度 AI 搜索"],
  },
  {
    token: "Baiduspider-render",
    operator: "百度",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "cn",
    note: "百度的渲染抓取，用于执行 JavaScript 后再取内容。若站点正文依赖 JS 渲染，这一支决定百度能否取到正文。",
    alsoPowers: ["文心一言", "百度 AI 搜索"],
  },
  {
    token: "Sogou web spider",
    operator: "腾讯 / 搜狗",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "cn",
    note: "搜狗搜索索引。腾讯元宝等产品的检索来源之一。",
    alsoPowers: ["腾讯元宝", "搜狗 AI 搜索"],
  },
  {
    token: "Sogou inst spider",
    operator: "腾讯 / 搜狗",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "cn",
    note: "搜狗的即时抓取，对新页面收录速度影响较大。",
    alsoPowers: ["腾讯元宝"],
  },
  {
    token: "YisouSpider",
    operator: "阿里 / UC（神马搜索）",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "observed",
    region: "cn",
    note: "神马搜索索引，是阿里系（夸克、通义）部分检索场景的来源。",
    alsoPowers: ["夸克 AI 搜索", "通义千问（部分检索场景）"],
  },
  {
    token: "360Spider",
    operator: "360",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "cn",
    note: "360 搜索索引，对应 360AI 搜索。",
    alsoPowers: ["360AI 搜索"],
  },

  /* ==================== 中国平台：厂商自有爬虫 ==================== */
  {
    token: "QwenBot",
    operator: "阿里（通义千问）",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "observed",
    region: "cn",
    note:
      "QwenBot 官方 UA 为 Mozilla/5.0 (compatible; Qwenbot/1.0; +https://qwen.alibaba.com/)，" +
      "声明用途同时覆盖「Qwen 模型训练」与「阿里系产品的生成式回答」。第三方跨站点实测显示其抓取量大、时段不规律，" +
      "头部站点中约 7% 已在 robots.txt 中屏蔽它。它遵循 robots.txt。",
    alsoPowers: ["通义千问", "阿里系生成式回答"],
  },
  {
    token: "ChatGLM-Spider",
    operator: "智谱 AI",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "observed",
    region: "cn",
    note: "智谱 AI 的抓取爬虫，对应 ChatGLM / 智谱清言。",
    alsoPowers: ["ChatGLM", "智谱清言"],
  },
  {
    token: "Bytespider",
    operator: "字节跳动",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "cn",
    note:
      "字节跳动的抓取爬虫，公开资料称其为其 LLM（含驱动豆包的模型）收集训练数据 —— " +
      "即影响的是「训练」，不是「检索引用」。注意：**并不存在名为 Doubao 的独立爬虫**，" +
      "所以你在服务器日志里搜不到「豆包爬虫」是正常的。该爬虫抓取激进，且常被报告忽略 robots.txt。",
    alsoPowers: ["豆包（训练语料层面）"],
    aggressive: true,
  },
  {
    token: "DeepSeekBot",
    operator: "深度求索",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "cn",
    note:
      "多见于社区屏蔽清单，但未找到官方文档或第三方实测流量证据。在拿到实测数据之前，" +
      "不应据此判断「屏蔽它会失去 DeepSeek 的曝光」—— 也不应认为放行它就能获得曝光。",
  },

  /* ==================== 全球：公共语料与其他 ==================== */
  {
    token: "CCBot",
    operator: "Common Crawl",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "公共爬虫语料库，是大量模型训练数据的上游来源。屏蔽它是合规姿态，不影响 AI 答案引用。",
  },
  {
    token: "meta-externalagent",
    operator: "Meta",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "Meta AI 训练用爬虫。",
  },
  {
    token: "DuckAssistBot",
    operator: "DuckDuckGo",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "DuckDuckGo AI 助手（DuckAssist）的索引来源。",
  },
  {
    token: "Amazonbot",
    operator: "Amazon",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "Amazon 用于产品问答与相关场景的抓取。",
  },
  {
    token: "cohere-ai",
    operator: "Cohere",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note: "多见于社区清单，未找到官方文档或实测证据。",
  },
  {
    token: "YouBot",
    operator: "You.com",
    purpose: "search",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note:
      "多见于社区快捷清单。未找到官方文档或第三方实测证据，因此**不声明它影响 AI 答案可见性** —— " +
      "在拿到实测数据之前，既不建议据此屏蔽，也不建议据此判断自己是否获得了 You.com 的曝光。",
  },
  {
    token: "Diffbot",
    operator: "Diffbot",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note: "第三方知识图谱与数据服务。社区清单常见收录。",
  },
  {
    token: "ImagesiftBot",
    operator: "Imagesift",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note: "图像与内容数据集构建。社区清单常见收录。",
  },
  {
    token: "Timpibot",
    operator: "Timpi",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note: "独立搜索索引构建。社区清单常见收录。",
  },
  {
    token: "Omgilibot",
    operator: "Webz.io",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note: "数据服务商抓取。社区清单常见收录。",
  },
];

/* =======================================================================
 * 常见的「假 token」：被大量写进 robots.txt，但没有实测证据表明存在
 *
 * 这一份清单本身就是有价值的检查结论 —— 它告诉客户「你屏蔽了一个不存在的东西」，
 * 并说明真正该关注的是什么。这也是我们与「照着模板生成 robots.txt」的工具的区别。
 * ======================================================================= */
export interface PhantomBot {
  token: string;
  wouldBe: string;
  reality: string;
}

export const PHANTOM_BOTS: PhantomBot[] = [
  {
    token: "Doubao",
    wouldBe: "字节跳动 / 豆包",
    reality:
      "第三方跨站点实测的 agent 库中没有该条目（已知 agents 目录返回 404）。" +
      "豆包的内容来源是字节既有体系，公开可辨识的爬虫是 Bytespider。屏蔽一个不存在的 token 没有任何效果。",
  },
  {
    token: "Kimi / MoonshotBot",
    wouldBe: "月之暗面 / Kimi",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
  },
  {
    token: "Hunyuan / Yuanbao",
    wouldBe: "腾讯 / 混元、元宝",
    reality:
      "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。腾讯侧公开可辨识的检索来源是搜狗系爬虫（Sogou web spider）。",
  },
  {
    token: "YiBot",
    wouldBe: "零一万物",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
  },
  {
    token: "PanguBot",
    wouldBe: "华为 / 盘古",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
  },
];

/** 国内 AI 的检索机制说明：回答「为什么找不到豆包爬虫」 */
export const CHINA_AI_MECHANISM = [
  {
    product: "文心一言 / 百度 AI 搜索",
    lever: "Baiduspider",
    detail: "复用百度搜索索引，没有独立的检索爬虫。",
  },
  {
    product: "腾讯元宝",
    lever: "Sogou web spider",
    detail: "依赖搜狗 / 腾讯搜索索引。",
  },
  {
    product: "夸克 AI / 通义（部分场景）",
    lever: "YisouSpider（神马）",
    detail: "依赖神马搜索索引；通义另有 QwenBot 直接抓取。",
  },
  {
    product: "豆包",
    lever: "Bytespider",
    detail: "没有名为 Doubao 的爬虫。公开可辨识的字节爬虫是 Bytespider，主要用于训练语料。",
  },
  {
    product: "通义千问",
    lever: "QwenBot",
    detail: "厂商自有爬虫，声明同时支撑训练与生成式回答。",
  },
  {
    product: "智谱清言 / ChatGLM",
    lever: "ChatGLM-Spider",
    detail: "厂商自有爬虫。",
  },
];

export const PURPOSE_LABEL: Record<BotPurpose, string> = {
  search: "检索 / 索引型",
  training: "训练型",
  user: "用户触发型",
};

export const EVIDENCE_LABEL: Record<BotEvidence, string> = {
  vendor: "官方文档",
  observed: "实测观测",
  reported: "社区清单",
};

export const EVIDENCE_HINT: Record<BotEvidence, string> = {
  vendor: "厂商官方文档或官方公布的 UA 字符串",
  observed: "有第三方跨站点实测流量数据或服务器日志普遍观测到",
  reported: "仅见于社区屏蔽清单或公开模板，未找到官方或实测证据",
};

/** 只影响 AI 答案可见性、且证据足够的爬虫（判定为「严重」的范围） */
export const CRITICAL_BOTS = AI_BOTS.filter(
  (b) => b.impactsAiAnswers && b.evidence !== "reported",
);

/** 常见但非 AI 的抓取与工具 */
export const CONVENTIONAL_BOTS = [
  { token: "Googlebot-Image", operator: "Google" },
  { token: "BingPreview", operator: "Microsoft" },
  { token: "Slurp", operator: "Yahoo" },
  { token: "Baiduspider-image", operator: "百度" },
  { token: "AhrefsBot", operator: "Ahrefs" },
  { token: "SemrushBot", operator: "Semrush" },
  { token: "MJ12bot", operator: "Majestic" },
  { token: "DotBot", operator: "Moz" },
  { token: "YandexBot", operator: "Yandex" },
];
