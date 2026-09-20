/**
 * 免费工具 B：内容可引用性检查
 *
 * 判断一个页面（或一段正文）是否具备「被 AI 摘录、引用」的结构条件。
 *
 * 三条设计原则（对应呈现规范里的要求）：
 *  1. 只给可拆解的分项，不给不透明的总分；总分必须能展开看「计算方式」。
 *  2. 每条结论都要带原文证据，客户可以自己复核，不做黑盒。
 *  3. 纯规则实现，不调用 AI —— 这是免费工具能零成本承接匿名流量的前提。
 */
import * as cheerio from "cheerio";
import { fetchPage, normalizeUrl } from "../net/fetch-page";
import { DISCLAIMER, summarize, type CheckResult, type Finding, type FindingStatus } from "./types";

export const CITABILITY_VERSION = "0.1.0";

/** 绝对化 / 夸大表述词表。命中不一定错，但会被抽出来让作者自查。 */
const HYPE_WORDS = [
  "最好", "最佳", "最强", "最大", "第一", "唯一", "绝对", "保证", "100%", "百分百",
  "顶级", "领先", "无敌", "完美", "永久", "史上最", "全球最", "最便宜", "最专业", "最低价",
  "行业第一", "国内首家", "独家", "零风险", "包治", "稳赚",
  "best-in-class", "world's leading", "world leading", "guaranteed", "number one", "#1", "unbeatable", "perfect",
];

const UNIT_PATTERN =
  /(\d+(?:[.,]\d+)?)\s*(%|％|个百分点|倍|件|台|套|吨|公斤|千克|克|毫米|厘米|米|毫米|mm|cm|kw|w|v|a|℃|度|天|小时|分钟|秒|年|个月|月|周|日|人|家|个|次|起|例|万元|亿元|元|美元|美金|usd|rmb|cny|eur)/gi;

const DATE_PATTERN = /(19|20)\d{2}\s*(?:[-/年.]\s*\d{1,2})?/g;
const CITATION_MARKER =
  /(根据|数据显示|据统计|报告显示|研究发现|来源[:：]|参考资料|白皮书|调研|抽样|according to|source[:：]|study|report|survey|whitepaper)/gi;

export interface CitabilityInput {
  url?: string;
  text?: string;
  /** 可选：页面标题（用于判断"是否直接回答了标题提出的问题"） */
  heading?: string;
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function cjkAndWordCount(text: string): number {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
  return cjk + latin;
}

function statusFor(score: number): FindingStatus {
  if (score >= 70) return "pass";
  if (score >= 40) return "warn";
  return "fail";
}

interface Dimension {
  key: string;
  label: string;
  score: number;
  weight: number;
  basis: string;
}

export async function runCitabilityCheck(input: CitabilityInput): Promise<CheckResult> {
  let html = "";
  let sourceUrl: string | undefined;
  let pageMeta: Record<string, unknown> = {};

  if (input.url && input.url.trim()) {
    const norm = normalizeUrl(input.url);
    if (!norm.ok) throw new Error(norm.error);
    sourceUrl = norm.url.toString();
    const page = await fetchPage(sourceUrl);
    if (!page.ok || !page.body) {
      throw new Error(page.error ?? `无法抓取该页面（状态码 ${page.status ?? "未知"}）。`);
    }
    html = page.body;
    pageMeta = {
      status: page.status,
      finalUrl: page.finalUrl,
      bytes: page.bytes,
      elapsedMs: page.elapsedMs,
      source: "url",
    };
  } else if (input.text && input.text.trim()) {
    html = input.text;
    pageMeta = { source: "pasted_text", chars: input.text.length };
  } else {
    throw new Error("请提供页面地址，或粘贴正文内容。");
  }

  const $ = cheerio.load(html);
  const findings: Finding[] = [];
  const dimensions: Dimension[] = [];

  // 必须先取出结构化数据原文：下一步会移除 script 标签
  const jsonLdTexts: string[] = $('script[type="application/ld+json"]')
    .toArray()
    .map((el) => $(el).text());

  // 移除脚本与样式，避免污染正文统计
  $("script, style, noscript, template").remove();
  const bodyText = ($("body").text() || $.root().text()).replace(/\s+/g, " ").trim();
  const chars = bodyText.length;
  const words = cjkAndWordCount(bodyText);

  const h1 = $("h1").first().text().trim();
  const heading = (input.heading ?? h1 ?? $("head title").first().text().trim()).trim();

  /* ---------- 0. 正文可取性 ---------- */
  if (pageMeta.source === "url") {
    const renderScore = chars < 200 ? 0 : chars < 600 ? 50 : 100;
    dimensions.push({
      key: "renderable",
      label: "正文可直接提取",
      score: renderScore,
      weight: 0.1,
      basis: `从 HTML 直接提取到 ${chars} 个字符正文（≥600 字符视为充分）`,
    });
    findings.push({
      id: "renderable",
      title: renderScore === 100 ? "正文可直接从 HTML 提取" : renderScore === 50 ? "正文较短" : "HTML 中取不到正文",
      status: statusFor(renderScore),
      severity: renderScore === 0 ? 1 : renderScore === 50 ? 2 : 3,
      what: `直接提取到的可见正文为 ${chars} 个字符。`,
      why: "多数 AI 抓取链路不执行页面脚本。正文若只在浏览器渲染后才出现，抓取端拿到的是空壳，后续所有可引用性判断都无从谈起。",
      evidence: `正文字符数：${chars}；${pageMeta.source === "url" ? `页面字节数：${String(pageMeta.bytes)}` : "来源：粘贴文本"}`,
      fix: renderScore === 100 ? undefined : "确认核心内容以服务端渲染方式输出（SSR/SSG），而不是靠前端脚本注入。",
    });
  }

  /* ---------- 1. 直接回答 ---------- */
  const qHeadings = $("h2, h3, h4")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter((t) => /[？?]$/.test(t) || /^(如何|怎么|怎样|什么|为什么|哪些|是否|能不能|多少钱|what|how|why|which|when|who|is |are |can |does )/i.test(t));
  let qaPairs = 0;
  const qaSamples: string[] = [];
  $("h2, h3, h4").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    const isQ = /[？?]$/.test(t) || /^(如何|怎么|怎样|什么|为什么|哪些|是否|what|how|why|which)/i.test(t);
    if (!isQ) return;
    let next = $(el).next();
    let answer = "";
    let guard = 0;
    while (next.length && guard < 4 && !/^h[1-4]$/i.test(next.get(0)?.tagName ?? "")) {
      const s = next.text().replace(/\s+/g, " ").trim();
      if (s) answer += (answer ? " " : "") + s;
      if (answer.length > 260) break;
      next = next.next();
      guard++;
    }
    if (answer.length >= 40) {
      qaPairs++;
      if (qaSamples.length < 3) qaSamples.push(`Q：${t}\nA：${answer.slice(0, 140)}…`);
    }
  });

  const headingIsQuestion = /[？?]$/.test(heading) || /^(如何|怎么|怎样|什么|为什么|哪些|what|how|why|which)/i.test(heading);
  let directScore = 0;
  if (qaPairs >= 3) directScore = 100;
  else if (qaPairs >= 1) directScore = 70;
  else if (headingIsQuestion) directScore = 50;

  dimensions.push({
    key: "direct_answer",
    label: "直接回答问题",
    score: directScore,
    weight: 0.18,
    basis: `检出 ${qaPairs} 组「疑问式小标题 + 紧跟其后的答案段」（每组答案 ≥40 字符）；页面主标题为疑问句：${headingIsQuestion ? "是" : "否"}`,
  });
  findings.push({
    id: "direct-answer",
    title: qaPairs > 0 ? `存在 ${qaPairs} 组问答式结构` : headingIsQuestion ? "标题是问题，但没有跟进答案段" : "缺少问答式结构",
    status: statusFor(directScore),
    severity: directScore >= 70 ? 3 : directScore >= 40 ? 2 : 1,
    what:
      qaPairs > 0
        ? `页面有 ${qaPairs} 处「疑问式小标题 + 紧跟其后的答案」，最长答案段落已截取为证据。`
        : headingIsQuestion
          ? "标题提出了一个问题，但标题下方没有一段 ≥40 字符的直接作答。"
          : "页面没有用小标题提出问题，也没有形成「问—答」配对。",
    why:
      "AI 回答用户提问时，最需要的是可以直接摘出来用的一段话。以问题为小标题、紧跟一段自洽的答案，" +
      "等于把「可以被摘录的句子」提前准备好了；反之，答案散落在长段落里，被完整引用的概率会明显下降。",
    evidence: qaSamples.length ? qaSamples.join("\n\n") : `疑问式小标题数量：${qHeadings.length}；合格问答对数量：${qaPairs}`,
    fix: "把客户真实会问的问题写成 H2/H3，每个问题下面第一段就用一到三句话把答案说完，再展开细节。",
    fixCode: `## 最小起订量（MOQ）是多少？\n\n标准规格 500 件起订，定制开模 3000 件起订，打样周期 7 个工作日。\n\n（以下再展开付款方式、交期与包装细节）`,
  });

  /* ---------- 2. 事实密度 ---------- */
  const unitMatches = countMatches(bodyText, UNIT_PATTERN);
  const dateMatches = countMatches(bodyText, DATE_PATTERN);
  const per1k = chars > 0 ? ((unitMatches + dateMatches) / chars) * 1000 : 0;
  const factScore = per1k >= 8 ? 100 : per1k >= 4 ? 70 : per1k >= 1.5 ? 45 : per1k > 0 ? 25 : 0;
  dimensions.push({
    key: "fact_density",
    label: "具体事实与数字",
    score: factScore,
    weight: 0.15,
    basis: `每 1000 字符含 ${per1k.toFixed(1)} 处数字/单位/年份（共 ${unitMatches} 处量值、${dateMatches} 处日期）`,
  });
  findings.push({
    id: "fact-density",
    title: factScore >= 70 ? "包含较多可核验的具体数字" : "缺少具体数字与量值",
    status: statusFor(factScore),
    severity: factScore >= 70 ? 3 : 2,
    what: `正文共 ${chars} 字符，检出 ${unitMatches} 处量值（含单位）与 ${dateMatches} 处年份，密度为每千字 ${per1k.toFixed(1)} 处。`,
    why:
      "带数字、单位、年份、规格的陈述是「可核验事实」，也是 AI 在生成答案时最愿意引用的素材类型。" +
      "通篇形容词的内容很难被摘录，因为摘出来也不构成一个有用的事实。",
    evidence: `量值 ${unitMatches} 处；日期 ${dateMatches} 处；正文 ${chars} 字符；密度 ${per1k.toFixed(1)}/千字（≥8 视为充分）`,
    fix: "把「产能充足」「交付快」这类说法替换成具体数字：产能、起订量、交期天数、合格率、覆盖国家数、成立年份。",
    fixCode: "把「交期短、产能充足」改为「常规规格 12 个工作日内出货，月产能 40 万件，2024 年准时交付率 98.6%」。",
  });

  /* ---------- 3. 来源与证据 ---------- */
  const ownHost = sourceUrl ? (() => { try { return new URL(sourceUrl).host; } catch { return ""; } })() : "";
  let externalLinks = 0;
  const externalSamples: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return;
    try {
      const h = new URL(href).host;
      if (ownHost && h === ownHost) return;
      externalLinks++;
      if (externalSamples.length < 3) externalSamples.push(href);
    } catch {
      /* 忽略非法链接 */
    }
  });
  const citationMarkers = countMatches(bodyText, CITATION_MARKER);
  const hasRefSection = /参考|引用|资料来源|references|sources/i.test(
    $("h2, h3").toArray().map((el) => $(el).text()).join(" "),
  );
  const sourceScore = Math.min(
    100,
    (externalLinks >= 3 ? 40 : externalLinks >= 1 ? 20 : 0) +
      (citationMarkers >= 3 ? 40 : citationMarkers >= 1 ? 20 : 0) +
      (hasRefSection ? 20 : 0),
  );
  dimensions.push({
    key: "sources",
    label: "来源与证据",
    score: sourceScore,
    weight: 0.14,
    basis: `站外链接 ${externalLinks} 个；引用性表述 ${citationMarkers} 处；参考资料区：${hasRefSection ? "有" : "无"}`,
  });
  findings.push({
    id: "evidence",
    title: sourceScore >= 70 ? "提供了可追溯的来源" : "缺少来源与证据支撑",
    status: statusFor(sourceScore),
    severity: sourceScore >= 70 ? 3 : 2,
    what: `检出站外链接 ${externalLinks} 个、引用性表述 ${citationMarkers} 处、参考资料区：${hasRefSection ? "有" : "无"}。`,
    why:
      "生成式系统在取舍引用来源时，会倾向于选择「自己就标注了出处」的内容：它降低了核查成本，也提高了答案的可信度。" +
      "孤立的断言即使正确，也更难被优先采用。",
    evidence: externalSamples.length ? `站外链接示例：\n${externalSamples.join("\n")}` : `站外链接：${externalLinks} 个；引用性表述：${citationMarkers} 处`,
    fix: "为关键结论补上出处（标准号、检测报告、行业报告、客户案例、公开数据），列出参考资料区。",
  });

  /* ---------- 4. 作者与时效 ---------- */
  const now = Date.now();
  let published: string | null = null;
  let modified: string | null = null;
  let author: string | null = null;
  for (const rawJsonLd of jsonLdTexts) {
    try {
      const parsed: unknown = JSON.parse(rawJsonLd);
      const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const obj = node as Record<string, unknown>;
        const graph = (obj["@graph"] as unknown[]) ?? [obj];
        for (const g of graph) {
          const o = g as Record<string, unknown>;
          if (typeof o.datePublished === "string" && !published) published = o.datePublished;
          if (typeof o.dateModified === "string" && !modified) modified = o.dateModified;
          const a = o.author;
          if (!author && typeof a === "string") author = a;
          if (!author && a && typeof a === "object") {
            const nm = (a as Record<string, unknown>).name;
            if (typeof nm === "string") author = nm;
          }
        }
      }
    } catch {
      /* 非法 JSON-LD 忽略 */
    }
  }
  if (!published) published = $('meta[property="article:published_time"]').attr("content") ?? null;
  if (!modified) modified = $('meta[property="article:modified_time"]').attr("content") ?? null;
  const timeEl = $("time[datetime]").first().attr("datetime") ?? null;
  if (!published && timeEl) published = timeEl;

  const anyDate = published ?? modified ?? (bodyText.match(/(19|20)\d{2}\s*[-/年.]\s*\d{1,2}/)?.[0] ?? null);
  let freshness: "fresh" | "stale" | "unknown" = "unknown";
  if (modified ?? published) {
    const t = Date.parse((modified ?? published)!);
    if (Number.isFinite(t)) {
      const days = (now - t) / 86_400_000;
      freshness = days <= 400 ? "fresh" : "stale";
    }
  }
  const authorshipScore =
    (author ? 40 : 0) + (published ? 25 : 0) + (modified ? 20 : 0) + (freshness === "fresh" ? 15 : 0);
  dimensions.push({
    key: "authorship",
    label: "作者与时效",
    score: authorshipScore,
    weight: 0.12,
    basis: `作者：${author ?? "未检出"}；发布时间：${published ?? "未检出"}；更新时间：${modified ?? "未检出"}；时效：${freshness === "fresh" ? "一年内" : freshness === "stale" ? "超过一年" : "无法判断"}`,
  });
  findings.push({
    id: "authorship",
    title: authorshipScore >= 70 ? "标注了作者与时间" : "缺少作者或时间信息",
    status: statusFor(authorshipScore),
    severity: authorshipScore >= 70 ? 3 : 2,
    what: `作者：${author ?? "未检出"}；发布时间：${published ?? "未检出"}；更新时间：${modified ?? "未检出"}。`,
    why:
      "作者与日期回答的是「谁说的、什么时候说的」，这是判断内容是否可采信的基本依据。" +
      "同一段内容，标注了作者与更新时间的版本，被当作可靠来源的概率更高；过时且无更新标注的内容则容易被降级。",
    evidence: `正文中可见的最早日期：${anyDate ?? "未检出"}；时效判定：${freshness}`,
    fix: "在页面显式展示作者（或机构）、发布日期与最近更新日期，并用 Article / dateModified 结构化标注。",
    fixCode: `<p>作者：<span>张工（材料工程师）</span> · 发布于 <time datetime="2025-03-12">2025-03-12</time> · 更新于 <time datetime="2026-01-08">2026-01-08</time></p>`,
  });

  /* ---------- 5. 结构可切分 ---------- */
  const h2 = $("h2").length;
  const h3 = $("h3").length;
  const lis = $("li").length;
  const tables = $("table").length;
  const paras = $("p").toArray().map((el) => $(el).text().replace(/\s+/g, " ").trim()).filter((t) => t.length > 0);
  const avgPara = paras.length ? Math.round(paras.reduce((n, t) => n + t.length, 0) / paras.length) : 0;
  const longParas = paras.filter((t) => t.length > 300).length;

  let structureScore = 0;
  if (h2 >= 3) structureScore += 35;
  else if (h2 >= 1) structureScore += 18;
  if (h3 >= 2) structureScore += 15;
  if (lis >= 5) structureScore += 15;
  if (tables >= 1) structureScore += 20;
  if (avgPara > 0 && avgPara <= 160) structureScore += 15;
  else if (avgPara > 0 && avgPara <= 240) structureScore += 8;
  structureScore = Math.min(100, structureScore);

  dimensions.push({
    key: "structure",
    label: "结构可切分",
    score: structureScore,
    weight: 0.14,
    basis: `H2 ${h2} 个、H3 ${h3} 个、列表项 ${lis} 个、表格 ${tables} 个、段落均长 ${avgPara} 字符（>300 字符的长段 ${longParas} 个）`,
  });
  findings.push({
    id: "structure",
    title: structureScore >= 70 ? "结构清晰，易于切分" : tables === 0 ? "缺少表格与清晰的层级结构" : "结构偏弱",
    status: statusFor(structureScore),
    severity: structureScore >= 70 ? 3 : 2,
    what: `页面有 ${h2} 个 H2、${h3} 个 H3、${lis} 个列表项、${tables} 个表格；段落平均 ${avgPara} 字符，其中超过 300 字符的长段有 ${longParas} 个。`,
    why:
      "检索系统是按「内容块」召回并拼装答案的。小标题、列表、表格是天然的切分点；" +
      "整页排成几段长文时，系统只能截取片段，容易断章取义，也更难命中提问。",
    evidence: `H2=${h2}，H3=${h3}，li=${lis}，table=${tables}，段落数=${paras.length}，段落均长=${avgPara}`,
    fix: "用 H2/H3 组织主题，规格参数用表格，步骤与清单用列表，单段控制在 2–4 行以内。",
  });

  /* ---------- 6. FAQ ---------- */
  const faqHeadings = $("h2, h3").toArray().filter((el) => /常见问题|FAQ|问答|Q&A/i.test($(el).text())).length;
  const faqSchema = jsonLdTexts.some((t) => /FAQPage/i.test(t));
  const faqScore = faqSchema ? 100 : faqHeadings > 0 ? 65 : qaPairs >= 3 ? 45 : 0;
  dimensions.push({
    key: "faq",
    label: "FAQ 覆盖",
    score: faqScore,
    weight: 0.1,
    basis: `FAQPage 结构化数据：${faqSchema ? "有" : "无"}；含 FAQ/常见问题的标题：${faqHeadings} 个；问答式结构：${qaPairs} 组`,
  });
  findings.push({
    id: "faq",
    title: faqScore >= 70 ? "具备 FAQ 结构" : "没有专门的 FAQ 区块",
    status: statusFor(faqScore),
    severity: faqScore >= 70 ? 3 : 2,
    what: `FAQPage 结构化数据：${faqSchema ? "有" : "无"}；FAQ 标题：${faqHeadings} 个；问答对：${qaPairs} 组。`,
    why:
      "FAQ 是最接近「用户提问—AI 作答」形态的内容结构：问题和答案都被显式分离，" +
      "系统几乎可以直接复用，不需要自己从长文中推断。这是性价比最高的一类可引用内容。",
    evidence: `FAQPage schema：${faqSchema}；FAQ 标题数：${faqHeadings}；问答对：${qaPairs}`,
    fix: "在页面底部加 FAQ 区块（8–15 条真实客户问题），并补 FAQPage 结构化数据。",
  });

  /* ---------- 7. 表述克制 ---------- */
  const hits: Array<{ word: string; snippet: string }> = [];
  for (const w of HYPE_WORDS) {
    const idx = bodyText.toLowerCase().indexOf(w.toLowerCase());
    if (idx >= 0) {
      hits.push({ word: w, snippet: bodyText.slice(Math.max(0, idx - 30), idx + w.length + 30) });
    }
  }
  const hypeScore = hits.length === 0 ? 100 : hits.length <= 2 ? 65 : hits.length <= 5 ? 35 : 0;
  dimensions.push({
    key: "restraint",
    label: "表述克制",
    score: hypeScore,
    weight: 0.07,
    basis: `命中绝对化/夸大表述 ${hits.length} 处（词表共 ${HYPE_WORDS.length} 条）`,
  });
  findings.push({
    id: "restraint",
    title: hits.length === 0 ? "未发现明显夸大表述" : `发现 ${hits.length} 处绝对化或夸大表述`,
    status: statusFor(hypeScore),
    severity: hits.length === 0 ? 3 : 2,
    what: hits.length ? `命中：${hits.map((h) => `「${h.word}」`).join("、")}。` : "未命中绝对化词表。",
    why:
      "无法证实的最高级表述不会提高可信度，反而降低了整页内容被当作事实来源的意愿；" +
      "在受监管行业，这类表述还可能带来合规风险。可核验的具体陈述比形容词更有效。",
    evidence: hits.length ? hits.slice(0, 5).map((h) => `「${h.word}」→ …${h.snippet}…`).join("\n") : `未命中词表（共 ${HYPE_WORDS.length} 条）`,
    fix: "把绝对化表述改成可核验表述：给出范围、条件、数据与出处。",
    fixCode: "把「行业最好的交期」改为「常规规格 12 个工作日，2025 年准时交付率 98.6%（来源：内部出货统计）」。",
  });

  /* ---------- 8. 可摘录摘要 ---------- */
  const entity = (h1 || heading).replace(/[｜|\-—–].*$/, "").trim();
  let extractable: string | null = null;
  for (const p of paras) {
    if (p.length < 40 || p.length > 420) continue;
    if (entity && entity.length >= 2 && p.includes(entity.slice(0, Math.min(6, entity.length)))) {
      extractable = p;
      break;
    }
  }
  if (!extractable) {
    for (const p of paras) {
      if (p.length >= 60 && p.length <= 300) {
        extractable = p;
        break;
      }
    }
  }
  const extractScore = extractable ? (extractable.length >= 60 ? 100 : 65) : 0;
  dimensions.push({
    key: "extractable",
    label: "存在可整段摘录的摘要",
    score: extractScore,
    weight: 0.1,
    basis: extractable
      ? `找到一段 ${extractable.length} 字符且语义自洽的段落，可被直接摘录`
      : "未找到 60–300 字符之间、语义自洽的独立段落",
  });
  findings.push({
    id: "extractable",
    title: extractable ? "存在可整段摘录的摘要段" : "缺少可整段摘录的摘要",
    status: statusFor(extractScore),
    severity: extractScore === 100 ? 3 : 2,
    what: extractable
      ? `找到一段 ${extractable.length} 字符、能独立成立的段落。`
      : "页面的段落要么过短（信息不足），要么过长（需要大幅压缩才能引用）。",
    why:
      "被引用最省力的形态，是「一句话就能回答一个问题」的独立段落。" +
      "长度落在 60–300 字符、且不依赖上下文就能读懂的内容块，最容易被直接摘出使用。",
    evidence: extractable ? `候选摘要段（${extractable.length} 字符）：\n「${extractable.slice(0, 220)}${extractable.length > 220 ? "…" : ""}」` : `合格段落数：0（共 ${paras.length} 段）`,
    fix: "在页面开头或每个小节开头，写一段 60–300 字符、可独立成立的定义式摘要。",
    fixCode: "「我们为欧洲中小品牌提供铝合金型材定制加工，标准件 500 件起订、开模件 3000 件起订，常规交期 12 个工作日，2025 年服务 63 家海外客户。」",
  });

  /* ---------- 汇总 ---------- */
  const totalWeight = dimensions.reduce((n, d) => n + d.weight, 0) || 1;
  const overall = Math.round(dimensions.reduce((n, d) => n + d.score * d.weight, 0) / totalWeight);

  const order: Record<FindingStatus, number> = { fail: 0, warn: 1, info: 2, pass: 3 };
  findings.sort((a, b) => order[a.status] - order[b.status] || a.severity - b.severity);

  const worst = [...dimensions].sort((a, b) => a.score - b.score)[0];
  const headline =
    overall >= 70
      ? "内容结构基本具备被 AI 引用的条件，可优先补齐得分最低的项。"
      : overall >= 40
        ? `内容具备部分条件，最弱的一项是「${worst.label}」（${worst.score} 分）。`
        : `内容目前较难被 AI 摘录引用，建议从「${worst.label}」开始改。`;

  return {
    tool: "citability",
    version: CITABILITY_VERSION,
    ...(sourceUrl ? { url: sourceUrl } : {}),
    checkedAt: new Date().toISOString(),
    summary: summarize(findings, headline),
    findings,
    meta: {
      ...pageMeta,
      chars,
      words,
      overall,
      weightsBasis: "总分 = 各分项得分 × 权重之和 ÷ 权重总和，逐项依据见下表",
      dimensions,
      observed: {
        qaPairs,
        unitMatches,
        dateMatches,
        per1kFacts: Number(per1k.toFixed(2)),
        externalLinks,
        citationMarkers,
        h2,
        h3,
        lis,
        tables,
        avgParaLength: avgPara,
        longParagraphs: longParas,
        hypeHits: hits.map((h) => h.word),
        author,
        published,
        modified,
        faqSchema,
      },
    },
    disclaimer: DISCLAIMER,
  };
}
