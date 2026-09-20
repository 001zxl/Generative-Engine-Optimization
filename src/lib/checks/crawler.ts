/**
 * 免费工具 A：AI 爬虫可访问检查
 *
 * 输入一个网址，输出一组可解释的分项结论：页面能否被抓取、robots.txt 是否
 * 屏蔽了决定"AI 能否引用你"的爬虫、canonical / noindex / sitemap / 结构化数据
 * 是否就位、正文是否依赖 JavaScript。
 *
 * 纯规则实现，不调用任何 AI API —— 单次检查边际成本为 0。
 */
import * as cheerio from "cheerio";
import { fetchPage, fetchText, normalizeUrl, originOf } from "../net/fetch-page";
import { parseRobots, isAllowed, declaredSitemaps, type ParsedRobots } from "../net/robots";
import { AI_BOTS, CRITICAL_BOTS, PURPOSE_LABEL, EVIDENCE_LABEL, PHANTOM_BOTS, CHINA_AI_MECHANISM, ROSTER_UPDATED_AT, type AiBot, type BotEvidence, type BotRegion } from "./bots";
import { DISCLAIMER, summarize, type CheckResult, type Finding } from "./types";

export const CRAWLER_VERSION = "0.2.0";

interface BotVerdict {
  token: string;
  operator: string;
  purpose: string;
  impactsAiAnswers: boolean;
  evidence: BotEvidence;
  evidenceLabel: string;
  region: BotRegion;
  allowed: boolean;
  reason: string;
  note: string;
  alsoPowers: string[];
  aggressive: boolean;
  sourceUrl: string;
  sourceTitle: string;
  verifiedAt: string;
}

export async function runCrawlerCheck(rawUrl: string): Promise<CheckResult> {
  const norm = normalizeUrl(rawUrl);
  if (!norm.ok) throw new Error(norm.error);

  const target = norm.url;
  const origin = originOf(target);
  const targetPath = target.pathname + target.search;
  const findings: Finding[] = [];
  const meta: Record<string, unknown> = {
    target: target.toString(),
    origin,
    checkedWith: "确定性规则检查（无 AI 调用）",
  };

  /* ---------- 1. 抓取目标页面 ---------- */
  const page = await fetchPage(target.toString());
  meta.page = {
    status: page.status ?? null,
    finalUrl: page.finalUrl ?? null,
    contentType: page.contentType ?? null,
    bytes: page.bytes ?? null,
    elapsedMs: page.elapsedMs,
    redirects: page.redirects,
  };

  if (target.protocol !== "https:") {
    findings.push({
      id: "https",
      title: "未使用 HTTPS",
      status: "warn",
      severity: 2,
      what: `当前地址使用 ${target.protocol.replace(":", "")} 明文协议。`,
      why: "主流 AI 抓取与检索链路普遍优先甚至只接受 HTTPS 来源，明文站点在可发现性和可信度上都处于劣势。",
      evidence: `请求地址协议：${target.protocol}`,
      fix: "为域名启用 HTTPS 并将 HTTP 全量 301 跳转到 HTTPS。",
    });
  } else {
    findings.push({
      id: "https",
      title: "使用 HTTPS",
      status: "pass",
      severity: 3,
      what: "站点通过 HTTPS 提供内容。",
      why: "满足主流 AI 抓取链路对传输安全的基本要求。",
      evidence: `请求地址协议：https:`,
    });
  }

  const pageOk = page.ok && !!page.body;
  if (!pageOk) {
    findings.push({
      id: "page-reachable",
      title: "页面无法正常抓取",
      status: "fail",
      severity: 1,
      what: page.error ?? `服务器返回状态码 ${page.status ?? "未知"}。`,
      why: "AI 检索系统的第一步就是抓取页面。页面抓不到，后面所有优化都不会生效。",
      evidence: `状态码：${page.status ?? "无响应"}；最终地址：${page.finalUrl ?? target.toString()}`,
      fix: "先确认页面对外可公开访问、返回 200，且没有对普通爬虫做拦截或人机校验。",
    });
  } else {
    findings.push({
      id: "page-reachable",
      title: "页面可以正常抓取",
      status: "pass",
      severity: 3,
      what: `服务器返回 ${page.status}，抓到 ${(page.bytes ?? 0).toLocaleString("en-US")} 字节 HTML。`,
      why: "这是 AI 能否发现你的前提条件。",
      evidence: `状态码：${page.status}；耗时：${page.elapsedMs}ms${page.redirects.length ? `；重定向 ${page.redirects.length} 次` : ""}`,
    });
    if (page.redirects.length > 0) {
      findings.push({
        id: "redirect-chain",
        title: `存在 ${page.redirects.length} 次重定向`,
        status: page.redirects.length > 2 ? "warn" : "info",
        severity: 3,
        what: `请求经过 ${page.redirects.length} 次跳转后到达最终地址。`,
        why: "过多跳转会消耗抓取预算，部分抓取器在跳转链过长时会直接放弃。",
        evidence: page.redirects.map((r, i) => `${i + 1}. ${r}`).join(" \n "),
        fix: "把入口地址直接指向最终地址，避免链式跳转。",
      });
    }
  }

  const $ = pageOk ? cheerio.load(page.body!) : null;

  /* ---------- 2. 正文可提取性 ---------- */
  if ($) {
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const htmlLen = page.body!.length || 1;
    const ratio = bodyText.length / htmlLen;
    const spaMarkers: string[] = [];
    for (const sel of ["#__next", "#root", "#app", "[data-reactroot]"]) {
      const el = $(sel);
      if (el.length > 0 && el.text().trim().length < 80) spaMarkers.push(sel);
    }
    meta.rendering = {
      visibleTextChars: bodyText.length,
      htmlChars: htmlLen,
      textToHtmlRatio: Number(ratio.toFixed(3)),
      emptyAppContainers: spaMarkers,
    };

    if (bodyText.length < 200) {
      findings.push({
        id: "text-extractable",
        title: "HTML 中几乎取不到正文",
        status: "fail",
        severity: 1,
        what: `直接从 HTML 提取到的可见文本只有 ${bodyText.length} 个字符。`,
        why: "多数 AI 抓取与检索链路并不执行页面脚本。正文如果靠 JavaScript 在浏览器里渲染，抓取端看到的就是一个空壳。",
        evidence: `可见文本 ${bodyText.length} 字符 / HTML ${htmlLen} 字符；疑似空容器：${spaMarkers.join("、") || "无"}`,
        fix: "对关键内容做服务端渲染或预渲染（SSR/SSG），至少保证标题、正文、FAQ 出现在初始 HTML 中。",
      });
    } else if (ratio < 0.03 || spaMarkers.length > 0) {
      findings.push({
        id: "text-extractable",
        title: "正文可提取，但页面偏重脚本渲染",
        status: "warn",
        severity: 2,
        what: `可见文本 ${bodyText.length} 字符，占 HTML 总长的 ${(ratio * 100).toFixed(1)}%。`,
        why: "文本占比过低意味着大量内容由脚本生成，抓取端可能只拿到框架与占位符，影响内容被完整理解。",
        evidence: `文本/HTML 比 = ${ratio.toFixed(3)}；疑似空容器：${spaMarkers.join("、") || "无"}`,
        fix: "把核心内容改为服务端输出，脚本仅用于交互增强。",
      });
    } else {
      findings.push({
        id: "text-extractable",
        title: "正文可以直接从 HTML 提取",
        status: "pass",
        severity: 3,
        what: `无需执行脚本即可取到 ${bodyText.length} 字符正文。`,
        why: "不依赖脚本的正文是 AI 抓取与引用最稳的形态。",
        evidence: `文本/HTML 比 = ${ratio.toFixed(3)}`,
      });
    }
  }

  if ($) {
    /* ---------- 3. 标题 / 描述 / canonical / noindex ---------- */
    const title = $("head title").first().text().trim();
    const desc = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const canonical = $('link[rel="canonical"]').attr("href")?.trim() ?? "";
    const metaRobots = $('meta[name="robots"]').attr("content")?.trim() ?? "";
    const h1s = $("h1");
    const jsonLdCount = $('script[type="application/ld+json"]').length;
    const sitemapLink = $('link[rel="sitemap"]').attr("href") ?? "";

    meta.head = {
      title,
      titleLength: title.length,
      description: desc,
      canonical,
      metaRobots,
      h1Count: h1s.length,
      h1Text: h1s.first().text().trim().slice(0, 160),
      jsonLdBlocks: jsonLdCount,
    };

    findings.push(
      title
        ? {
            id: "title",
            title: "存在页面标题",
            status: title.length >= 10 && title.length <= 65 ? "pass" : "warn",
            severity: 3,
            what: `标题为「${title}」（${title.length} 字符）。`,
            why: "标题是抓取端判断页面主题的第一信号，过长会被截断、过短则信息不足。",
            evidence: `<title> 内容，长度 ${title.length}（建议 10–65 字符）`,
          }
        : {
            id: "title",
            title: "缺少页面标题",
            status: "fail",
            severity: 1,
            what: "页面没有 <title>，或内容为空。",
            why: "标题是判断页面主题与相关性的首要信号，缺失会显著降低被正确理解与引用的概率。",
            evidence: "<title> 标签内容为空",
            fix: "为每个页面写一个描述「实体 + 主题 + 场景」的唯一标题。",
            fixCode: `<title>铝合金型材定制｜小批量开模与出口供货 - 某某制造</title>`,
          },
    );

    if (!desc) {
      findings.push({
        id: "meta-description",
        title: "缺少 meta description",
        status: "warn",
        severity: 2,
        what: "页面没有设置描述标签。",
        why: "描述常被检索系统用作摘要素材；缺失时系统只能自行截断正文，摘要质量不稳定。",
        evidence: '未找到 <meta name="description">',
        fix: "补一段 80–155 字符的客观描述，直接说明你提供什么、给谁、覆盖什么范围。",
      });
    }

    if (!canonical) {
      findings.push({
        id: "canonical",
        title: "缺少 canonical",
        status: "warn",
        severity: 2,
        what: "页面没有声明规范地址。",
        why: "当同一内容存在多个入口（带参、带尾斜杠、http/https、多域名）时，抓取端会把权重分散到多个地址，降低任一地址被引用的概率。",
        evidence: '未找到 <link rel="canonical">',
        fix: "在每个页面声明指向自身的规范地址。",
        fixCode: `<link rel="canonical" href="${page.finalUrl ?? target.toString()}" />`,
      });
    } else {
      findings.push({
        id: "canonical",
        title: "已声明 canonical",
        status: "pass",
        severity: 3,
        what: `规范地址为 ${canonical}。`,
        why: "有助于把分散的入口收敛到同一地址。",
        evidence: `<link rel="canonical" href="${canonical}">`,
      });
    }

    if (/\bnoindex\b/i.test(metaRobots)) {
      findings.push({
        id: "meta-robots",
        title: "页面被标记为 noindex",
        status: "fail",
        severity: 1,
        what: `meta robots 为「${metaRobots}」，明确要求不要索引本页。`,
        why: "被 noindex 的页面不会进入索引，也就基本不可能出现在 AI 答案的引用来源里。",
        evidence: `<meta name="robots" content="${metaRobots}">`,
        fix: "如果这是希望被 AI 引用的公开页面，移除 noindex。",
      });
    }

    if (h1s.length === 0) {
      findings.push({
        id: "h1",
        title: "缺少 H1 主标题",
        status: "warn",
        severity: 2,
        what: "页面没有 H1 标签。",
        why: "结构化标题帮助抓取端切分内容块，缺失会让系统难以判断页面主旨与段落边界。",
        evidence: "H1 数量：0",
        fix: "为页面加一个唯一的 H1，用一句话说清这一页回答什么问题。",
      });
    }

    if (jsonLdCount === 0) {
      findings.push({
        id: "structured-data",
        title: "没有结构化数据（JSON-LD）",
        status: "warn",
        severity: 2,
        what: "页面没有 application/ld+json 结构化数据。",
        why: "结构化数据把「实体—属性—关系」以机器可直接读取的形式给出，是减少歧义、提高被准确理解概率的有效手段。",
        evidence: "JSON-LD 块数量：0",
        fix: "至少补上 Organization、WebSite 与页面类型对应的 schema（如 FAQPage、Product、Article）。",
        fixCode: `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"最小起订量是多少？",
   "acceptedAnswer":{"@type":"Answer","text":"标准件 500 件起订，定制开模 3000 件起订。"}}]}
</script>`,
      });
    } else {
      findings.push({
        id: "structured-data",
        title: `已提供 ${jsonLdCount} 块结构化数据`,
        status: "pass",
        severity: 3,
        what: `页面包含 ${jsonLdCount} 块 JSON-LD。`,
        why: "结构化数据有助于抓取端无歧义地理解实体与属性。",
        evidence: `JSON-LD 块数量：${jsonLdCount}`,
      });
    }

    /* ---------- 4. robots.txt 与 AI 爬虫 ---------- */
    const robotsUrl = `${origin}/robots.txt`;
    const robotsRes = await fetchText(robotsUrl, ["text/plain", "text/html", ""]);
    const robotsText = robotsRes.ok && robotsRes.body ? robotsRes.body : null;
    const robots: ParsedRobots = parseRobots(
      robotsText,
      robotsText === null ? (robotsRes.status === 404 ? "站点没有 robots.txt（返回 404）" : robotsRes.error ?? "无法获取 robots.txt") : undefined,
    );

    const verdicts: BotVerdict[] = AI_BOTS.map((bot: AiBot) => {
      const v = isAllowed(robots, bot.token, targetPath === "" ? "/" : targetPath);
      return {
        token: bot.token,
        operator: bot.operator,
        purpose: PURPOSE_LABEL[bot.purpose],
        impactsAiAnswers: bot.impactsAiAnswers,
        evidence: bot.evidence,
        evidenceLabel: EVIDENCE_LABEL[bot.evidence],
        region: bot.region,
        allowed: v.allowed,
        reason: v.reason,
        note: bot.note,
        alsoPowers: bot.alsoPowers ?? [],
        aggressive: bot.aggressive ?? false,
        sourceUrl: bot.sourceUrl,
        sourceTitle: bot.sourceTitle,
        verifiedAt: bot.verifiedAt,
      };
    });

    meta.robots = {
      url: robotsUrl,
      exists: robotsText !== null,
      status: robotsRes.status ?? null,
      groups: robots.groups.length,
      declaredSitemaps: declaredSitemaps(robots),
      verdicts,
    };
    meta.allowedUaLines = robots.groups.flatMap((g) => g.agents);

    if (robotsText === null) {
      findings.push({
        id: "robots-txt",
        title: "没有可用的 robots.txt",
        status: "info",
        severity: 3,
        what: `访问 ${robotsUrl} 未取得有效内容（${robotsRes.status ?? robotsRes.error ?? "未知原因"}）。`,
        why: "没有 robots.txt 时默认允许抓取，因此不会阻断 AI；但也失去了显式声明 sitemap 与抓取边界的机会。",
        evidence: `${robotsUrl} → ${robotsRes.status ?? robotsRes.error}`,
        fix: "建议提供一个最小可用的 robots.txt，至少声明 sitemap 地址。",
        fixCode: `User-agent: *\nAllow: /\n\n# 允许检索型 AI 爬虫\nUser-agent: OAI-SearchBot\nAllow: /\n\nSitemap: ${origin}/sitemap.xml`,
      });
    } else {
      findings.push({
        id: "robots-txt",
        title: "存在 robots.txt",
        status: "pass",
        severity: 3,
        what: `已解析 ${robots.groups.length} 个规则组，共 ${robots.groups.reduce((n, g) => n + g.rules.length, 0)} 条规则。`,
        why: "这是唯一由你显式控制「谁能抓、抓哪里」的机制，也是判定 AI 可发现性的关键依据。",
        evidence: `${robotsUrl}（HTTP ${robotsRes.status}）`,
      });
    }

    // 4a. 决定 AI 答案可见性的爬虫 —— 这是"严重"级别。
    //     注意：证据等级为 reported 的条目一律不参与严重判定（我们不确定它是否真实存在）。
    const blockedCritical = verdicts.filter(
      (v) => v.impactsAiAnswers && v.evidence !== "reported" && !v.allowed,
    );
    if (blockedCritical.length > 0) {
      findings.push({
        id: "ai-search-bots",
        title: `${blockedCritical.length} 个"决定 AI 能否引用你"的爬虫被屏蔽`,
        status: "fail",
        severity: 1,
        what: `被 robots.txt 阻止的检索/索引型爬虫：${blockedCritical
          .map((v) => `${v.token}（${v.operator}）`)
          .join("、")}。`,
        why:
          "AI 答案里的引用来自检索索引。屏蔽检索型爬虫，等于主动把自己从 AI 的可引用来源中摘除 —— " +
          "这与屏蔽训练型爬虫是完全不同的后果，但常被混为一谈。",
        evidence: blockedCritical
          .map((v) => `${v.token}［证据：${v.evidenceLabel}］：${v.reason}`)
          .join("\n"),
        fix: `为这些 token 显式放行。注意区分：只拒绝训练、保留检索是合法且常见的做法。`,
        fixCode: `# 放行检索型爬虫（决定 AI 能否引用你）
${blockedCritical.map((v) => `User-agent: ${v.token}\nAllow: /`).join("\n\n")}

# 如只想拒绝训练用途，单独屏蔽这些即可：
User-agent: GPTBot
Disallow: /
User-agent: Google-Extended
Disallow: /`,
      });
    } else {
      findings.push({
        id: "ai-search-bots",
        title: "检索型 AI 爬虫未被屏蔽",
        status: "pass",
        severity: 3,
        what: `${CRITICAL_BOTS.length} 个影响 AI 答案可见性的爬虫（证据等级为官方文档或实测观测的条目）在当前路径上均被允许抓取。`,
        why: "这是品牌有机会出现在 AI 答案与引用来源里的必要条件。",
        evidence: verdicts
          .filter((v) => v.impactsAiAnswers && v.evidence !== "reported")
          .map((v) => `${v.token}［${v.evidenceLabel}］：${v.allowed ? "允许" : "阻止"}`)
          .join("\n"),
      });
    }

    /* ---------- 4a-2. 国内 AI 的检索机制（回答"为什么找不到豆包爬虫"） ---------- */
    const cnVerdicts = verdicts.filter((v) => v.region === "cn" && v.evidence !== "reported");
    meta.chinaMechanism = CHINA_AI_MECHANISM;
    findings.push({
      id: "cn-ai-mechanism",
      title: "国内 AI 平台：多数没有自己的检索爬虫，用的是搜索索引",
      status: "info",
      severity: 3,
      what:
        "国产 AI 助手大多不自己抓网页，而是复用母公司的搜索索引。" +
        "因此「豆包」「Kimi」这类以 AI 产品命名的爬虫在服务器日志里搜不到，是正常的 —— " +
        "真正决定你在这些平台问答里能否被引用的，是它们背后那个搜索索引的爬虫。",
      why:
        "很多团队花钱屏蔽了「豆包爬虫」「千问爬虫」，却不知道自己真正该维护的是 " +
        "Baiduspider / Sogou / 神马 这些搜索索引的抓取条件。方向错了，投入就浪费了。",
      evidence:
        CHINA_AI_MECHANISM.map((m) => `${m.product} → 杠杆点：${m.lever}（${m.detail}）`).join("\n") +
        "\n\n本次实际检测到的国内相关爬虫：\n" +
        cnVerdicts
          .map((v) => `${v.token}［${v.operator}｜${v.evidenceLabel}］：${v.allowed ? "允许" : "阻止"}`)
          .join("\n"),
      fix:
        "如果目标是国内 AI 可见性，优先确认 Baiduspider（含 render）、Sogou 系、神马（YisouSpider）能正常抓取，" +
        "而不是去屏蔽一个可能并不存在的 AI 产品爬虫。",
    });

    // 4b. 训练型爬虫 —— 信息项，附带最常见的误解澄清
    const blockedTraining = verdicts.filter((v) => v.purpose === PURPOSE_LABEL.training && !v.allowed);
    findings.push({
      id: "ai-training-bots",
      title:
        blockedTraining.length > 0
          ? `已屏蔽 ${blockedTraining.length} 个训练型爬虫（不影响 AI 答案可见性）`
          : "训练型爬虫当前被允许抓取",
      status: "info",
      severity: 3,
      what:
        blockedTraining.length > 0
          ? `被阻止：${blockedTraining.map((v) => v.token).join("、")}。`
          : "GPTBot、ClaudeBot、CCBot、Google-Extended 等训练用途爬虫未被阻止。",
      why:
        "训练型爬虫负责的是「把内容写进模型参数」，与「在回答时实时检索并引用你」是两条独立链路。" +
        "常见误解是「屏蔽 GPTBot 就不会被 AI 提到」——实际相反：屏蔽训练爬虫不影响检索引用，而屏蔽检索爬虫才会让你消失。",
      evidence: verdicts
        .filter((v) => v.purpose === PURPOSE_LABEL.training)
        .map((v) => `${v.token}（${v.operator}）：${v.allowed ? "允许" : "阻止"}`)
        .join("\n"),
      fix:
        blockedTraining.length > 0
          ? "如果目的是减少内容被用于训练，这样设置是合理的；只需确认没有连带屏蔽检索型爬虫。"
          : "如果出于内容授权考虑不想贡献训练语料，可以只屏蔽训练型爬虫并保留检索型爬虫。",
    });

    /* ---------- 4c. 假 token 检测：你屏蔽了一个不存在的东西吗 ---------- */
    const declaredAgents = new Set(robots.groups.flatMap((g) => g.agents));
    const phantomFound = PHANTOM_BOTS.filter((p) =>
      p.token
        .split("/")
        .map((t) => t.trim().toLowerCase())
        .some((t) => t && declaredAgents.has(t)),
    );
    meta.roster = { updatedAt: ROSTER_UPDATED_AT, total: AI_BOTS.length, phantomChecked: PHANTOM_BOTS.length };
    meta.phantomBots = PHANTOM_BOTS;
    meta.evidenceLevels = {
      vendor: AI_BOTS.filter((b) => b.evidence === "vendor").length,
      observed: AI_BOTS.filter((b) => b.evidence === "observed").length,
      reported: AI_BOTS.filter((b) => b.evidence === "reported").length,
    };

    if (phantomFound.length > 0) {
      findings.push({
        id: "phantom-bots",
        title: `robots.txt 中声明了 ${phantomFound.length} 个"查无实证"的爬虫 token`,
        status: "warn",
        severity: 2,
        what: `这些 token 出现在你的 robots.txt 里，但未找到官方文档或第三方实测证据表明它们真实存在：${phantomFound
          .map((p) => p.token)
          .join("、")}。`,
        why:
          "屏蔽一个不存在的爬虫不会有任何效果，但会让人误以为「已经处理过 AI 抓取问题了」——" +
          "这种虚假的安心感，往往比不做更糟：真正决定你能否被 AI 引用的爬虫可能仍然处于封闭状态。",
        evidence: phantomFound
          .map((p) => `${p.token}（本该是 ${p.wouldBe}）：${p.reality}\n核验入口：${p.verifyUrl}`)
          .join("\n\n"),
        fix:
          "删掉这些无效规则，把精力放在真正影响 AI 引用的检索型爬虫上（见上一条结论），" +
          "尤其是国内平台背后的搜索索引爬虫。",
      });
    } else {
      findings.push({
        id: "phantom-bots",
        title: "未发现「查无实证」的爬虫 token",
        status: "pass",
        severity: 3,
        what: `已核对 ${PHANTOM_BOTS.length} 个常见的虚构 token（${PHANTOM_BOTS.map((p) => p.token).join("、")}），robots.txt 中均未出现。`,
        why: "说明规则集没有为不存在的东西浪费精力，也没有产生「已经处理过 AI 抓取」的虚假安心感。",
        evidence: `已核对：${PHANTOM_BOTS.map((p) => p.token).join("、")}\nrobots.txt 中声明的 user-agent：${[...declaredAgents].join("、") || "（无）"}`,
      });
    }

    /* ---------- 5. sitemap ---------- */
    const sitemapCandidates = declaredSitemaps(robots).length
      ? declaredSitemaps(robots)
      : [sitemapLink || `${origin}/sitemap.xml`];
    const sitemapResults: Array<{ url: string; status: number | null; ok: boolean; containsTarget: boolean | null; error?: string }> = [];
    for (const sm of sitemapCandidates.slice(0, 2)) {
      const res = await fetchText(sm, ["application/xml", "text/xml", "text/plain", "text/html", ""]);
      const body = res.body ?? "";
      const containsTarget =
        res.ok && body.length > 0
          ? body.includes(target.pathname) || body.includes(target.toString())
          : null;
      sitemapResults.push({
        url: sm,
        status: res.status ?? null,
        ok: res.ok && body.length > 0,
        containsTarget,
        error: res.error,
      });
    }
    meta.sitemap = sitemapResults;

    const foundSitemap = sitemapResults.find((s) => s.ok);
    if (!foundSitemap) {
      findings.push({
        id: "sitemap",
        title: "未找到可读取的 sitemap",
        status: "warn",
        severity: 2,
        what: `尝试读取 ${sitemapResults.map((s) => s.url).join("、")}，均未取得有效内容。`,
        why: "sitemap 是主动告知抓取端「我有哪些页面」的标准方式，缺失会拖慢新页面被发现的速度。",
        evidence: sitemapResults.map((s) => `${s.url} → ${s.status ?? s.error}`).join("\n"),
        fix: "生成 sitemap.xml，并在 robots.txt 中用 Sitemap 行声明。",
        fixCode: `Sitemap: ${origin}/sitemap.xml`,
      });
    } else if (foundSitemap.containsTarget === false) {
      findings.push({
        id: "sitemap",
        title: "sitemap 中没有包含当前页面",
        status: "warn",
        severity: 2,
        what: `sitemap ${foundSitemap.url} 可读取，但未发现当前页面地址。`,
        why: "页面不在 sitemap 中，抓取端只能靠内链发现它，收录与被引用都会更慢。",
        evidence: `${foundSitemap.url}（HTTP ${foundSitemap.status}）未匹配 ${target.pathname}`,
        fix: "把该页面加入 sitemap，并确保 sitemap 中的地址与页面 canonical 完全一致。",
      });
    } else {
      findings.push({
        id: "sitemap",
        title: "sitemap 可读取且包含当前页面",
        status: "pass",
        severity: 3,
        what: `${foundSitemap.url} 中包含该页面地址。`,
        why: "主动声明有助于页面被发现与稳定收录。",
        evidence: `${foundSitemap.url}（HTTP ${foundSitemap.status}）`,
      });
    }
  }

  /* ---------- 汇总 ---------- */
  const order: Record<Finding["status"], number> = { fail: 0, warn: 1, info: 2, pass: 3 };
  findings.sort((a, b) => order[a.status] - order[b.status] || a.severity - b.severity);

  const failCount = findings.filter((f) => f.status === "fail").length;
  const criticalCount = findings.filter((f) => f.status === "fail" && f.severity === 1).length;
  const headline = !pageOk
    ? "页面无法抓取，这是最优先要修的问题。"
    : criticalCount > 0
      ? `发现 ${criticalCount} 个会直接阻断 AI 发现与引用的严重问题。`
      : failCount > 0
        ? `发现 ${failCount} 个问题，暂未发现阻断级缺陷。`
        : "未发现阻断 AI 发现与引用的问题。";

  return {
    tool: "crawler",
    version: CRAWLER_VERSION,
    url: target.toString(),
    checkedAt: new Date().toISOString(),
    summary: summarize(findings, headline),
    findings,
    meta,
    disclaimer: DISCLAIMER,
  };
}
