/**
 * 内容模板与结构校验。
 *
 * 目的：让"直答问题、说明适用场景、绑定来源"变成**机器能查的规则**。
 * 只写在写作规范里没人执行 —— 一审稿全凭印象，发布出去的还是那种
 * 开头讲三段行业背景、翻到一半才提到答案的文章，AI 抓取方拿不到可引用的句子。
 *
 * 这里只做结构判断，不判断事实真假（那是 claims/evidences 的职责）。
 */
import { parseMarkdown, summarizeBlocks, inlineToPlainText, type Block } from "./markdown.ts";

export interface ContentTemplate {
  id: ContentTemplateId;
  name: string;
  /** 这个模板适合回答哪类问题 */
  useWhen: string;
  /** 必须出现的小节标题（按顺序） */
  requiredSections: string[];
  /** 至少需要几个小节标题 */
  minHeadings: number;
  /** 是否要求正文含表格（对比类内容没有表格基本等于没写清维度） */
  requiresTable: boolean;
  /** 至少需要几条来源 */
  minSources: number;
  /** 骨架里替换的占位符说明 */
  placeholders: string[];
}

export type ContentTemplateId = "what_is" | "faq" | "comparison" | "howto";

export const CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    id: "what_is",
    name: "是什么（概念/服务说明）",
    useWhen: "用户会问「X 是什么」「X 是做什么的」这类认知问题。",
    requiredSections: ["一句话结论", "适用场景", "不适用的情况", "常见误解"],
    minHeadings: 4,
    requiresTable: false,
    minSources: 1,
    placeholders: ["主题", "一句话结论", "品牌名"],
  },
  {
    id: "faq",
    name: "FAQ（问答）",
    useWhen: "同一主题下有一批具体问句，需要逐条直答。",
    requiredSections: ["常见问题"],
    minHeadings: 2,
    requiresTable: false,
    minSources: 1,
    placeholders: ["主题", "问题1", "答案1"],
  },
  {
    id: "comparison",
    name: "对比（含对比表）",
    useWhen: "用户在做选择，会问「A 和 B 哪个好」「有什么区别」。",
    requiredSections: ["结论", "对比维度", "选哪个", "数据来源"],
    minHeadings: 4,
    requiresTable: true,
    minSources: 2,
    placeholders: ["对象A", "对象B", "维度1"],
  },
  {
    id: "howto",
    name: "教程（步骤）",
    useWhen: "用户问「怎么做」「流程是什么」。",
    requiredSections: ["结果预告", "步骤", "常见失败原因"],
    minHeadings: 3,
    requiresTable: false,
    minSources: 1,
    placeholders: ["目标", "步骤1"],
  },
];

export function getTemplate(id: string): ContentTemplate | undefined {
  return CONTENT_TEMPLATES.find((t) => t.id === id);
}

/** 生成可直接编辑的骨架：先给结构和占位，避免一上来就写散文 */
export function buildSkeleton(id: ContentTemplateId, vars: Record<string, string> = {}): string {
  const t = getTemplate(id);
  if (!t) throw new Error(`未知模板：${id}`);
  const v = (key: string, fallback: string) => vars[key] ?? fallback;

  if (id === "what_is") {
    return [
      `## 一句话结论`,
      `${v("一句话结论", "（一句话直接回答，不要铺垫背景。这句话应当可以被单独摘出来引用。）")}`,
      ``,
      `## 适用场景`,
      `- ${v("场景1", "（什么情况下适用）")}`,
      `- ${v("场景2", "（什么情况下适用）")}`,
      ``,
      `## 不适用的情况`,
      `- ${v("不适用1", "（什么情况下不适用 —— 写清边界比多列优点更能建立可信度）")}`,
      ``,
      `## 常见误解`,
      `- ${v("误解1", "（常见误解与实际情况）")}`,
      ``,
      `## 来源`,
      `- [${v("来源标题", "来源标题")}](${v("来源链接", "https://example.com")})`,
    ].join("\n");
  }
  if (id === "faq") {
    return [
      `## 常见问题`,
      ``,
      `### ${v("问题1", "（用户真实问句，尽量保留口语说法）")}`,
      `${v("答案1", "（第一句直接回答，后面再展开。）")}`,
      ``,
      `### ${v("问题2", "（第二个问题）")}`,
      `${v("答案2", "（第一句直接回答。）")}`,
      ``,
      `## 来源`,
      `- [${v("来源标题", "来源标题")}](${v("来源链接", "https://example.com")})`,
    ].join("\n");
  }
  if (id === "comparison") {
    return [
      `## 结论`,
      `${v("结论", "（先说结论：各自适合谁。不要用「各有优劣」收尾。）")}`,
      ``,
      `## 对比维度`,
      ``,
      `| 维度 | ${v("对象A", "对象A")} | ${v("对象B", "对象B")} |`,
      `| --- | --- | --- |`,
      `| ${v("维度1", "维度1")} |  |  |`,
      `| ${v("维度2", "维度2")} |  |  |`,
      `| ${v("维度3", "维度3")} |  |  |`,
      ``,
      `## 选哪个`,
      `- 选 ${v("对象A", "对象A")}：${v("选A的理由", "（具体条件，不要写「预算充足」这种无法验证的话）")}`,
      `- 选 ${v("对象B", "对象B")}：${v("选B的理由", "（具体条件）")}`,
      ``,
      `## 数据来源`,
      `- [${v("来源标题1", "来源标题1")}](${v("来源链接1", "https://example.com/1")})`,
      `- [${v("来源标题2", "来源标题2")}](${v("来源链接2", "https://example.com/2")})`,
    ].join("\n");
  }
  return [
    `## 结果预告`,
    `${v("目标", "（做完能得到什么，一句话）")}`,
    ``,
    `## 步骤`,
    `1. ${v("步骤1", "（第一步，写清前置条件）")}`,
    `2. ${v("步骤2", "（第二步）")}`,
    `3. ${v("步骤3", "（第三步）")}`,
    ``,
    `## 常见失败原因`,
    `- ${v("失败1", "（最常见的失败原因与判断方法）")}`,
    ``,
    `## 来源`,
    `- [${v("来源标题", "来源标题")}](${v("来源链接", "https://example.com")})`,
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * 结构校验
 * ------------------------------------------------------------------ */

export interface ContentIssue {
  level: "block" | "warn";
  code: string;
  message: string;
}

export interface ContentLintInput {
  templateId: ContentTemplateId;
  body: string;
  /** 已批准并绑定到本文的事实条数 */
  approvedFactCount?: number;
  /** 绑定的来源条数 */
  sourceCount?: number;
}

const HEADING_TEXT_RE = /^[\s#]*(.+?)\s*$/;

function headingLabels(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { type: "heading" }> => b.type === "heading")
    .map((b) => inlineToPlainText(b.children).replace(HEADING_TEXT_RE, "$1").trim());
}

/**
 * 检查正文是否符合模板要求。
 *
 * 逐条给可执行的修改动作，而不是笼统说「内容质量不够」——
 * 运营人员看到「首段 200 字内没有直答」才知道该删哪一段。
 */
export function lintContent(input: ContentLintInput): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const template = getTemplate(input.templateId);
  if (!template) {
    return [{ level: "block", code: "unknown_template", message: `未知模板：${input.templateId}` }];
  }

  const blocks = parseMarkdown(input.body ?? "");
  const stats = summarizeBlocks(blocks);
  const labels = headingLabels(blocks);

  if (stats.paragraphs === 0 && blocks.length === 0) {
    return [{ level: "block", code: "empty", message: "正文为空。" }];
  }

  // 直答：模板若以「一句话结论/结论/结果预告」开篇，该段必须在 200 字内说清结论
  const firstHeading = labels[0];
  const firstParaText = (() => {
    const idx = blocks.findIndex((b) => b.type === "paragraph");
    if (idx < 0) return "";
    const b = blocks[idx];
    return b.type === "paragraph" ? inlineToPlainText(b.children) : "";
  })();
  if (!firstHeading || !template.requiredSections.includes(firstHeading)) {
    issues.push({
      level: "block",
      code: "missing_lead_section",
      message: `开头缺少「${template.requiredSections[0]}」小节。第一段就要直答，不要先铺垫行业背景。`,
    });
  }
  if (firstParaText.length > 200) {
    issues.push({
      level: "warn",
      code: "lead_too_long",
      message: `首个段落 ${firstParaText.length} 字，超过 200 字。直答句太长会让抓取方难以摘出可引用的结论。`,
    });
  }
  if (firstParaText.length === 0) {
    issues.push({ level: "block", code: "no_direct_answer", message: "正文没有可用作直答的段落。" });
  }

  // 必须小节
  for (const section of template.requiredSections) {
    const hit = labels.some((l) => l === section || l.startsWith(section));
    if (!hit) {
      issues.push({
        level: "block",
        code: `missing_section:${section}`,
        message: `缺少「${section}」小节。`,
      });
    }
  }

  if (labels.length < template.minHeadings) {
    issues.push({
      level: "warn",
      code: "too_few_sections",
      message: `小节数 ${labels.length}，少于模板要求的 ${template.minHeadings}。结构太粗会让内容难以被分段引用。`,
    });
  }

  if (template.requiresTable && stats.tables === 0) {
    issues.push({
      level: "block",
      code: "missing_table",
      message: "对比类内容必须有真正的表格（Markdown 表格），否则对比维度说不清。",
    });
  }

  // 来源
  const sources = input.sourceCount ?? stats.links;
  if (sources < template.minSources) {
    issues.push({
      level: "block",
      code: "too_few_sources",
      message: `绑定来源 ${sources} 条，少于模板要求的 ${template.minSources} 条。没有来源的公开内容不能发布。`,
    });
  }

  // 未绑定已批准事实
  if (input.approvedFactCount !== undefined && input.approvedFactCount === 0) {
    issues.push({
      level: "warn",
      code: "no_approved_facts",
      message: "本文没有绑定任何已批准事实 —— 文中出现的具体数字与承诺将无据可查。",
    });
  }

  // 原始 HTML：不会被执行，但会原样显示成文字，通常不是作者的本意
  const raw = input.body ?? "";
  const rawTags = raw.match(/<\/?[a-zA-Z][a-zA-Z0-9]*(\s[^<>]*)?>/g) ?? [];
  if (rawTags.length > 0) {
    const sample = [...new Set(rawTags)].slice(0, 3).join(" ");
    issues.push({
      level: "warn",
      code: "raw_html_present",
      message:
        `正文含 ${rawTags.length} 处原始 HTML 标签（如 ${sample}）。` +
        `本平台只渲染 Markdown，这些标签会原样显示成文字。如果只是想换行，用空行分段即可。`,
    });
  }

  // 占位符没替换
  const leftover = ["（一句话直接回答", "（先说结论", "（用户真实问句", "（第一步"].filter((p) => raw.includes(p));
  if (leftover.length > 0) {
    issues.push({
      level: "block",
      code: "placeholder_left",
      message: `还有 ${leftover.length} 处模板占位符没有替换成真实内容。`,
    });
  }

  return issues;
}

export function lintVerdict(issues: ContentIssue[]): { ok: boolean; blockers: number; warnings: number } {
  const blockers = issues.filter((i) => i.level === "block").length;
  return { ok: blockers === 0, blockers, warnings: issues.length - blockers };
}
