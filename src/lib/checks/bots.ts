/**
 * AI 相关爬虫名册。
 *
 * 这是免费工具 A 里最有价值的一块知识，也是市面上大多数检查工具做错的地方：
 *
 *   ┌ 训练型（training）     ── 抓取内容用于训练模型。屏蔽它，不会让你从 AI 答案里消失。
 *   ├ 检索/索引型（search）  ── 构建搜索索引并支撑 AI 答案引用。屏蔽它 = 你真的不会被引用。
 *   └ 用户触发型（user）     ── 用户让 AI 实时访问某个页面时才抓取。
 *
 * 绝大多数企业把这三类混为一谈：明明只想"不贡献训练语料"，却顺手把
 * OAI-SearchBot / PerplexityBot 一起屏蔽了，结果从 AI 答案里彻底消失。
 * 反过来，也有人以为放行 GPTBot 就能被 ChatGPT 推荐 —— 也不会。
 *
 * 结论口径：impactsAiAnswers 为 true 的爬虫被屏蔽，才是"严重"级别问题。
 */

export type BotPurpose = "search" | "training" | "user";

export interface AiBot {
  /** robots.txt 中的 user-agent token */
  token: string;
  operator: string;
  purpose: BotPurpose;
  /** 屏蔽它是否可能导致品牌无法出现在 AI 答案中 */
  impactsAiAnswers: boolean;
  note: string;
}

export const AI_BOTS: AiBot[] = [
  // —— OpenAI ——
  {
    token: "OAI-SearchBot",
    operator: "OpenAI",
    purpose: "search",
    impactsAiAnswers: true,
    note: "ChatGPT 搜索的索引爬虫。屏蔽它，ChatGPT 搜索与答案中就引用不到你的页面。",
  },
  {
    token: "ChatGPT-User",
    operator: "OpenAI",
    purpose: "user",
    impactsAiAnswers: true,
    note: "用户在 ChatGPT 中点开或要求实时访问某页面时使用。屏蔽会导致该场景下取不到你的内容。",
  },
  {
    token: "GPTBot",
    operator: "OpenAI",
    purpose: "training",
    impactsAiAnswers: false,
    note: "仅用于模型训练。屏蔽它常被误以为会掉出 AI 答案，实际上不影响检索与引用。",
  },

  // —— Perplexity ——
  {
    token: "PerplexityBot",
    operator: "Perplexity",
    purpose: "search",
    impactsAiAnswers: true,
    note: "Perplexity 的索引爬虫。Perplexity 的回答高度依赖实时检索，屏蔽它影响最直接。",
  },
  {
    token: "Perplexity-User",
    operator: "Perplexity",
    purpose: "user",
    impactsAiAnswers: true,
    note: "用户触发式抓取。",
  },

  // —— Anthropic ——
  {
    token: "Claude-SearchBot",
    operator: "Anthropic",
    purpose: "search",
    impactsAiAnswers: true,
    note: "Claude 的搜索索引爬虫，影响 Claude 联网回答中的引用。",
  },
  {
    token: "Claude-User",
    operator: "Anthropic",
    purpose: "user",
    impactsAiAnswers: true,
    note: "用户触发式抓取。",
  },
  {
    token: "ClaudeBot",
    operator: "Anthropic",
    purpose: "training",
    impactsAiAnswers: false,
    note: "模型训练用。屏蔽不影响 Claude 检索到你。",
  },

  // —— Google ——
  {
    token: "Googlebot",
    operator: "Google",
    purpose: "search",
    impactsAiAnswers: true,
    note: "Google 搜索的基础索引，也是 AI Overviews / AI Mode 的来源。屏蔽它等于从 Google 生态消失。",
  },
  {
    token: "Google-Extended",
    operator: "Google",
    purpose: "training",
    impactsAiAnswers: false,
    note: "控制 Gemini 训练与 grounding 的数据使用，不影响 Google 搜索排名与收录。可用于「只拒绝训练、保留检索」。",
  },

  // —— Microsoft ——
  {
    token: "Bingbot",
    operator: "Microsoft",
    purpose: "search",
    impactsAiAnswers: true,
    note: "Bing 索引，也是 Copilot 的来源之一。",
  },

  // —— Apple ——
  {
    token: "Applebot",
    operator: "Apple",
    purpose: "search",
    impactsAiAnswers: true,
    note: "Siri / Spotlight 等场景的基础索引。",
  },
  {
    token: "Applebot-Extended",
    operator: "Apple",
    purpose: "training",
    impactsAiAnswers: false,
    note: "Apple 基础模型训练用，可单独屏蔽。",
  },

  // —— 公共语料与其他 ——
  {
    token: "CCBot",
    operator: "Common Crawl",
    purpose: "training",
    impactsAiAnswers: false,
    note: "公共爬虫语料库，是大量模型训练数据的上游来源。屏蔽它是合规姿态，不影响 AI 答案引用。",
  },
  {
    token: "meta-externalagent",
    operator: "Meta",
    purpose: "training",
    impactsAiAnswers: false,
    note: "Meta AI 训练用爬虫。",
  },
  {
    token: "Bytespider",
    operator: "ByteDance",
    purpose: "training",
    impactsAiAnswers: false,
    note: "字节跳动爬虫，抓取频次较高，常见于服务器的自动封禁名单。",
  },
  {
    token: "DuckAssistBot",
    operator: "DuckDuckGo",
    purpose: "search",
    impactsAiAnswers: true,
    note: "DuckDuckGo AI 助手（DuckAssist）的索引来源。",
  },
  {
    token: "Amazonbot",
    operator: "Amazon",
    purpose: "training",
    impactsAiAnswers: false,
    note: "Amazon 用于产品问答与相关场景的抓取。",
  },
  {
    token: "cohere-ai",
    operator: "Cohere",
    purpose: "training",
    impactsAiAnswers: false,
    note: "Cohere 训练用爬虫。",
  },
  {
    token: "YouBot",
    operator: "You.com",
    purpose: "search",
    impactsAiAnswers: true,
    note: "You.com 搜索索引。",
  },
  {
    token: "Diffbot",
    operator: "Diffbot",
    purpose: "training",
    impactsAiAnswers: false,
    note: "第三方知识图谱与数据服务。",
  },
  {
    token: "ImagesiftBot",
    operator: "Imagesift",
    purpose: "training",
    impactsAiAnswers: false,
    note: "图像与内容数据集构建。",
  },
  {
    token: "Timpibot",
    operator: "Timpi",
    purpose: "training",
    impactsAiAnswers: false,
    note: "独立搜索索引构建。",
  },
  {
    token: "Omgilibot",
    operator: "Webz.io",
    purpose: "training",
    impactsAiAnswers: false,
    note: "数据服务商抓取。",
  },
];

export const PURPOSE_LABEL: Record<BotPurpose, string> = {
  search: "检索 / 索引型",
  training: "训练型",
  user: "用户触发型",
};

/** 只影响 AI 答案可见性的爬虫（判定为"严重"的范围） */
export const CRITICAL_BOTS = AI_BOTS.filter((b) => b.impactsAiAnswers);

/** 常见但非 AI 的抓取与工具 */
export const CONVENTIONAL_BOTS = [
  { token: "Googlebot-Image", operator: "Google" },
  { token: "BingPreview", operator: "Microsoft" },
  { token: "Slurp", operator: "Yahoo" },
  { token: "Baiduspider", operator: "Baidu" },
  { token: "Sogou web spider", operator: "Sogou" },
  { token: "360Spider", operator: "360" },
  { token: "YandexBot", operator: "Yandex" },
  { token: "AhrefsBot", operator: "Ahrefs" },
  { token: "SemrushBot", operator: "Semrush" },
  { token: "MJ12bot", operator: "Majestic" },
  { token: "DotBot", operator: "Moz" },
];
