/**
 * AI 相关爬虫名册。
 *
 * ⚠️ 这份名册的核心设计原则：**每条结论都必须能点回一手来源**。
 *
 * 网上流传的"AI 爬虫清单"大多互相抄，很多 token 只是站长为求安心写进 robots.txt 的，
 * 未必真有爬虫在用它。把这类 token 当成事实展示，正是本产品最该避免的错误
 * （我们卖的就是"结论可复核"）。因此每个条目都必须同时具备：
 *
 *   1. evidence   —— 证据等级（下面三选一）
 *   2. sourceUrl  —— 可点击的一手来源，客户能自己复核
 *   3. verifiedAt —— 该来源最后一次核对可访问的日期
 *
 * 证据等级：
 *   vendor   —— 厂商官方文档或官方公布的 UA 字符串
 *   observed —— 有独立第三方实测流量数据（跨站点监测）或服务器日志普遍观测到
 *   reported —— 仅见于社区屏蔽清单/公开模板，未找到官方或实测证据
 *
 * **一致性约束**（见 tests/bots.test.ts）：证据等级必须与来源匹配 ——
 * vendor 条目的来源不能是第三方监测站，observed 条目的来源不能是社区模板。
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
 * 详见 `alsoPowers` 字段与 CHINA_AI_MECHANISM。
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
  /** 一手来源链接（客户可点击复核） */
  sourceUrl: string;
  /** 来源的说明性标题 */
  sourceTitle: string;
  /** 该来源最后一次核对可访问的日期 */
  verifiedAt: string;
}

/** 名册最后核对时间（呈现规范：数据必须能判断新鲜度） */
export const ROSTER_UPDATED_AT = "2026-09-20";

/** 名册以季度为生命周期 —— 三个月不核对就可能漏掉新平台 */
export const ROSTER_REVIEW_CYCLE = "每季度核对一次";

const VERIFIED_AT = ROSTER_UPDATED_AT;

/* =======================================================================
 * 一手来源。所有链接在 2026-09-20 逐条核验过 HTTP 可访问性。
 * 核验方式：curl -I（HEAD）取状态码；不可访问的候选来源一律不采用。
 * ======================================================================= */
const SRC = {
  openai: {
    sourceUrl: "https://platform.openai.com/docs/bots",
    sourceTitle: "OpenAI 官方爬虫文档",
  },
  anthropic: {
    sourceUrl:
      "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
    sourceTitle: "Anthropic 官方：爬虫说明与屏蔽方式",
  },
  google: {
    sourceUrl: "https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers",
    sourceTitle: "Google 搜索中心：爬虫一览",
  },
  perplexity: {
    sourceUrl: "https://docs.perplexity.ai/guides/bots",
    sourceTitle: "Perplexity 官方爬虫文档",
  },
  apple: {
    sourceUrl: "https://support.apple.com/en-us/119829",
    sourceTitle: "Apple 官方：Applebot 说明",
  },
  bing: {
    sourceUrl: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
    sourceTitle: "Bing 网站管理员文档：使用的爬虫",
  },
  commoncrawl: {
    sourceUrl: "https://commoncrawl.org/ccbot",
    sourceTitle: "Common Crawl 官方：CCBot",
  },
  amazon: {
    sourceUrl: "https://developer.amazon.com/support/amazonbot",
    sourceTitle: "Amazon 官方：Amazonbot",
  },
  duckduckgo: {
    sourceUrl: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassist/",
    sourceTitle: "DuckDuckGo 官方：DuckAssist",
  },
  baidu: {
    sourceUrl: "https://ziyuan.baidu.com/college/documentinfo?id=267",
    sourceTitle: "百度搜索资源平台：Baiduspider 说明",
  },
  sogou: {
    sourceUrl: "https://www.sogou.com/docs/help/webmasters.htm",
    sourceTitle: "搜狗站长平台：爬虫说明",
  },
  so360: {
    sourceUrl: "https://zhanzhang.so.com/",
    sourceTitle: "360 站长平台",
  },
  /** 第三方跨站点实测 agent 库（实测流量，非模板） */
  known: (token: string) => ({
    sourceUrl: `https://knownagents.com/agents/${token}`,
    sourceTitle: `Known Agents 实测：${token}（跨站点流量监测）`,
  }),
  /** 社区屏蔽清单：仅用于「查无实证」一类的条目 */
  cnCommunity: {
    sourceUrl:
      "https://github.com/tinaponting/ai-robots-scrapers/blob/main/Chinese-AI-Blocking-Guide-2026.md",
    sourceTitle: "社区屏蔽清单（Chinese AI Blocking Guide 2026，未经厂商确认）",
  },
} as const;

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
    ...SRC.openai,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.openai,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "GPTBot",
    operator: "OpenAI",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "仅用于模型训练。屏蔽它常被误以为会掉出 AI 答案，实际上不影响检索与引用。",
    ...SRC.openai,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.perplexity,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.perplexity,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.anthropic,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.anthropic,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "ClaudeBot",
    operator: "Anthropic",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "模型训练用。屏蔽不影响 Claude 检索到你。",
    ...SRC.anthropic,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.google,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Google-Extended",
    operator: "Google",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "控制 Gemini 训练与 grounding 的数据使用，不影响 Google 搜索排名与收录。可用于「只拒绝训练、保留检索」。",
    ...SRC.google,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.bing,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.apple,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Applebot-Extended",
    operator: "Apple",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "Apple 基础模型训练用，可单独屏蔽。",
    ...SRC.apple,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.baidu,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.baidu,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.sogou,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.sogou,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.known("yisouspider"),
    verifiedAt: VERIFIED_AT,
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
    ...SRC.so360,
    verifiedAt: VERIFIED_AT,
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
    ...SRC.known("qwenbot"),
    verifiedAt: VERIFIED_AT,
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
    ...SRC.known("chatglm-spider"),
    verifiedAt: VERIFIED_AT,
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
    ...SRC.known("bytespider"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "DeepSeekBot",
    operator: "深度求索",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "cn",
    note:
      "第三方跨站点实测收录该 agent，用途为「为 AI 模型训练下载内容」。据此判定为训练型 —— " +
      "不影响检索引用，因此屏蔽它不会让你从 DeepSeek 的答案里消失。",
    alsoPowers: ["DeepSeek（训练语料层面）"],
    ...SRC.known("deepseekbot"),
    verifiedAt: VERIFIED_AT,
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
    ...SRC.commoncrawl,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "meta-externalagent",
    operator: "Meta",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "Meta AI 训练用爬虫。Meta 官方文档在本机网络下无法直接核验，故来源采用第三方实测库。",
    ...SRC.known("meta-externalagent"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "DuckAssistBot",
    operator: "DuckDuckGo",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "vendor",
    region: "global",
    note: "DuckDuckGo AI 助手（DuckAssist）的索引来源。",
    ...SRC.duckduckgo,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Amazonbot",
    operator: "Amazon",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "vendor",
    region: "global",
    note: "Amazon 用于产品问答与相关场景的抓取。",
    ...SRC.amazon,
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "cohere-ai",
    operator: "Cohere",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "第三方跨站点实测收录，用途为模型训练语料。不影响 AI 答案引用。",
    ...SRC.known("cohere-ai"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "YouBot",
    operator: "You.com",
    purpose: "search",
    impactsAiAnswers: true,
    evidence: "observed",
    region: "global",
    note:
      "第三方实测来源说明：YouBot 抓取并索引网页内容，用于驱动 You.com 的实时搜索与研究 API，" +
      "向 AI agent / LLM 提供可溯源的网页数据。属于检索/索引型，屏蔽会影响 You.com 侧的引用。",
    alsoPowers: ["You.com 实时搜索", "You.com Research API"],
    ...SRC.known("youbot"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Diffbot",
    operator: "Diffbot",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "第三方知识图谱与数据服务，已由实测库收录。不影响 AI 答案引用。",
    ...SRC.known("diffbot"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "ImagesiftBot",
    operator: "Imagesift",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "图像与内容数据集构建，已由实测库收录。不影响 AI 答案引用。",
    ...SRC.known("imagesiftbot"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Timpibot",
    operator: "Timpi",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "observed",
    region: "global",
    note: "独立搜索索引构建，已由实测库收录。不影响 AI 答案引用。",
    ...SRC.known("timpibot"),
    verifiedAt: VERIFIED_AT,
  },
  {
    token: "Omgilibot",
    operator: "Webz.io",
    purpose: "training",
    impactsAiAnswers: false,
    evidence: "reported",
    region: "global",
    note:
      "仅见于社区清单。第三方实测库中未找到对应条目（对应 slug 返回 404），" +
      "因此不声明它影响 AI 答案可见性。",
    ...SRC.cnCommunity,
    verifiedAt: VERIFIED_AT,
  },
];

/* =======================================================================
 * 常见的「假 token」：被大量写进 robots.txt，但没有实测证据表明存在
 *
 * 这一份清单本身就是有价值的检查结论 —— 它告诉客户「你屏蔽了一个不存在的东西」。
 * 每条都给出可点击的核验入口（实测库中该条目不存在）。
 * ======================================================================= */
export interface PhantomBot {
  token: string;
  wouldBe: string;
  reality: string;
  /** 可点击的核验入口：打开后应为 404 / 无此条目 */
  verifyUrl: string;
}

export const PHANTOM_BOTS: PhantomBot[] = [
  {
    token: "Doubao",
    wouldBe: "字节跳动 / 豆包",
    reality:
      "第三方跨站点实测的 agent 库中没有该条目。豆包的内容来源是字节既有体系，" +
      "公开可辨识的爬虫是 Bytespider。屏蔽一个不存在的 token 没有任何效果。",
    verifyUrl: "https://knownagents.com/agents/doubao",
  },
  {
    token: "Kimi / MoonshotBot",
    wouldBe: "月之暗面 / Kimi",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
    verifyUrl: "https://github.com/tinaponting/ai-robots-scrapers/blob/main/Chinese-AI-Blocking-Guide-2026.md",
  },
  {
    token: "Hunyuan / Yuanbao",
    wouldBe: "腾讯 / 混元、元宝",
    reality:
      "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。腾讯侧公开可辨识的检索来源是搜狗系爬虫（Sogou web spider）。",
    verifyUrl: "https://knownagents.com/agents/hunyuan",
  },
  {
    token: "YiBot",
    wouldBe: "零一万物",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
    verifyUrl: "https://knownagents.com/agents/yibot",
  },
  {
    token: "PanguBot",
    wouldBe: "华为 / 盘古",
    reality: "仅见于社区屏蔽模板，未找到官方文档或实测流量证据。",
    verifyUrl: "https://knownagents.com/agents/pangubot",
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
