/**
 * 安全 Markdown 子集：段落 / 二三级标题 / 列表 / 表格 / 链接。
 *
 * 为什么自己写而不装 marked + sanitize：
 *  1. 之前两个渲染点（知识页 JSX、发布 HTML）各写了一份只认标题和段落的逻辑，
 *     结果列表和表格在页面上直接丢失。集中成一份解析器才不会再次分叉。
 *  2. 白名单实现天然拒绝原始 HTML —— 不执行、不解析、不保留标签，
 *     只当普通文字转义输出。装一个通用渲染器再靠 sanitizer 兜底，
 *     安全边界取决于 sanitizer 的配置是否一直正确。
 *
 * 明确不支持的语法（保持简单，避免"看起来支持其实出错"）：
 *  - 原始 HTML：一律按纯文本转义显示
 *  - 引用块、嵌套列表、脚注、HTML 实体解码
 *  - 行内 HTML 标签
 */
export type HeadingLevel = 2 | 3 | 4;

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "strong"; children: InlineNode[] }
  | { type: "code"; value: string }
  /**
   * 图片。
   *
   * `local` 表示这是站内相对路径 —— 导出静态站时这类资源必须真实存在，
   * 否则上传到 Pages 后就是一个裂图。外链 http(s) 图片不做存在性检查。
   */
  | { type: "image"; src: string; alt: string; local: boolean };

export type Block =
  | { type: "heading"; level: HeadingLevel; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][]; align: Array<"left" | "center" | "right"> };

/* ------------------------------------------------------------------ *
 * 链接安全
 * ------------------------------------------------------------------ */

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 只放行 http(s) 与站内相对路径。
 *
 * `javascript:` / `data:` / `vbscript:` / `file:` / `blob:` 一律拒绝；
 * 协议相对地址（`//evil.com`）也拒绝 —— 它在 https 页面上会变成 https://evil.com，
 * 看起来像站内链接，实际是外站。
 */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // 控制字符与空白：合法的 URL 里不该出现（空格应写成 %20）
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  if (value.startsWith("//")) return null;
  // 站内相对路径与纯锚点
  if (value.startsWith("/") || value.startsWith("#")) return value;
  const m = SCHEME_RE.exec(value);
  if (!m) return null; // 没有 scheme 又不是相对路径 —— 不猜，拒绝
  return ALLOWED_SCHEMES.has(m[0].toLowerCase()) ? value : null;
}

/**
 * 图片地址白名单。
 *
 * 比链接更严：额外拒绝 `data:`（把图片塞进 HTML 会让页面体积失控，
 * 也会让静态站的资源清单失去意义）。
 */
export function safeImageSrc(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^data:/i.test(value)) return null;
  if (value.startsWith("//")) return null;
  const scheme = SCHEME_RE.exec(value);
  if (scheme) {
    // 有协议：只放行 http(s)
    return ALLOWED_SCHEMES.has(scheme[0].toLowerCase()) ? value : null;
  }
  // 纯相对路径（如 `assets/store.jpg`）—— 链接那里因为"裸路径不猜"而拒绝，
  // 但图片的相对路径在静态站里只可能落在站内，放行；能否逃出根目录由
  // localAssetPath 判定，导出阶段会据此报错。
  return localAssetPath(value) !== null ? value : null;
}

/**
 * 判断图片是不是站内相对路径，并给出规范化后的相对路径。
 *
 * 拒绝逃出站点根目录的路径（`../` 归一化后仍带 `..`）——
 * 静态站上它只会 404，但在导出阶段就该被拦下并报错。
 */
export function localAssetPath(src: string): string | null {
  const value = src.trim();
  if (!value) return null;
  if (/^https?:/i.test(value) || value.startsWith("//")) return null;
  if (value.startsWith("#")) return null;
  const cleaned = value.replace(/^\.\//, "").replace(/^\//, "");
  const parts: string[] = [];
  for (const seg of cleaned.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // 逃出根目录
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** 外站链接才加 target/rel；站内链接保持同页跳转，避免无意义的新开标签页 */
export function isExternalHref(href: string): boolean {
  return /^https?:/i.test(href);
}

/* ------------------------------------------------------------------ *
 * 行内解析
 * ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 注意：这里存的是**模式源码**，不是带 /g 的正则对象。
 *
 * parseInline 是递归的（链接文字里还要再解一次行内标记）。如果共用同一个
 * 带 /g 的正则对象，内层递归会把 lastIndex 重置为 0，外层恢复后又会从头匹配
 * 到同一个位置，last 不再前进 —— 直接死循环直到 OOM。
 * 每次调用构造独立的局部正则，状态就不会互相踩。
 */
// 图片分支必须排在链接之前：否则 `![alt](src)` 会先命中链接分支，
// 前面的 `!` 被当成普通文本，页面上会出现一个多余的感叹号。
const INLINE_PATTERN =
  "!\\[([^\\]\\n]*)\\]\\(([^()\\s]*)\\)|\\[([^\\]\\n]*)\\]\\(([^()\\s]*)\\)|`([^`\\n]+)`|\\*\\*([^*\\n]+)\\*\\*";

/**
 * 行内解析。
 *
 * 扫描而不是逐层 replace：`[a](javascript:alert(1))` 这类输入如果先做
 * 链接替换再做其它替换，很容易在中间态被绕过。这里一次性切分，
 * 未匹配的部分原样作为文本，最终统一转义。
 */
export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  const inlineRe = new RegExp(INLINE_PATTERN, "g");
  let m: RegExpExecArray | null;
  while ((m = inlineRe.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) {
      // 图片
      const src = safeImageSrc(m[2]);
      const local = src ? localAssetPath(src) : null;
      if (src) {
        nodes.push({ type: "image", src, alt: m[1], local: local !== null });
      } else {
        // 非法图片地址：保留说明文字，不输出 img
        nodes.push({ type: "text", value: m[1] ? `${m[1]}（图片地址不可用）` : "（图片地址不可用）" });
      }
    } else if (m[3] !== undefined && m[4] !== undefined) {
      const href = safeHref(m[4]);
      if (href) {
        nodes.push({ type: "link", href, children: parseInline(m[3]) });
      } else {
        // 非法链接：保留可见文字，丢掉链接，不静默吞掉内容
        nodes.push({ type: "text", value: m[3] });
        nodes.push({ type: "text", value: ` (${m[4]})` });
      }
    } else if (m[5] !== undefined) {
      nodes.push({ type: "code", value: m[5] });
    } else if (m[6] !== undefined) {
      nodes.push({ type: "strong", children: parseInline(m[6]) });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", value: text.slice(last) });
  return nodes.length > 0 ? nodes : [{ type: "text", value: text }];
}

/* ------------------------------------------------------------------ *
 * 块级解析
 * ------------------------------------------------------------------ */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
/** 表格分隔行：只允许 | - : 空格 */
const TABLE_SEP_RE = /^\|?[\s:|-]+\|?$/;

function isTableSeparator(line: string): boolean {
  return line.includes("-") && TABLE_SEP_RE.test(line);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseAlign(sep: string[]): Array<"left" | "center" | "right"> {
  return sep.map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });
}

/**
 * 把 Markdown 解析成块列表。
 *
 * 标题层级：正文里的 `#` 与 `##` 一律降为 h2 —— h1 由页面标题独占。
 * 一页多个 h1 会让抓取方难以判断页面主题，也会让结构化数据与可见标题对不上。
 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(4, Math.max(2, heading[1].length)) as HeadingLevel;
      blocks.push({ type: "heading", level, children: parseInline(heading[2].trim()) });
      i++;
      continue;
    }

    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line).map((c) => parseInline(c));
      const align = parseAlign(splitTableRow(lines[i + 1]));
      const rows: InlineNode[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        rows.push(splitTableRow(lines[j]).map((c) => parseInline(c)));
        j++;
      }
      blocks.push({ type: "table", header, rows, align });
      i = j;
      continue;
    }

    const ul = UL_RE.exec(line);
    const ol = UL_RE.test(line) ? null : OL_RE.exec(line);
    if (ul || ol) {
      const ordered = !!ol;
      const re = ordered ? OL_RE : UL_RE;
      const items: InlineNode[][] = [];
      let j = i;
      while (j < lines.length) {
        const m = re.exec(lines[j]);
        if (!m) break;
        items.push(parseInline(m[1].trim()));
        j++;
      }
      blocks.push({ type: "list", ordered, items });
      i = j;
      continue;
    }

    // 段落：吃到空行或下一个块级起点
    const para: string[] = [];
    let j = i;
    while (j < lines.length && lines[j].trim()) {
      const l = lines[j];
      if (para.length > 0 && (HEADING_RE.test(l) || UL_RE.test(l) || OL_RE.test(l))) break;
      if (para.length > 0 && l.includes("|") && j + 1 < lines.length && isTableSeparator(lines[j + 1])) break;
      para.push(l.trim());
      j++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    i = j;
  }

  return blocks;
}

/* ------------------------------------------------------------------ *
 * 渲染：HTML（发布到外部平台用）
 * ------------------------------------------------------------------ */

export function inlineToHtml(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return escapeHtml(n.value);
      if (n.type === "code") return `<code>${escapeHtml(n.value)}</code>`;
      if (n.type === "strong") return `<strong>${inlineToHtml(n.children)}</strong>`;
      if (n.type === "image") {
        // 静态站的图片一律懒加载；alt 必须转义，它也是可读内容
        return `<img src="${escapeHtml(n.src)}" alt="${escapeHtml(n.alt)}" loading="lazy" decoding="async">`;
      }
      const rel = isExternalHref(n.href) ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${escapeHtml(n.href)}"${rel}>${inlineToHtml(n.children)}</a>`;
    })
    .join("");
}

/** 块列表 → HTML 字符串。所有文本都经过转义，不存在原始 HTML 直通路径。 */
export function blocksToHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading") return `<h${b.level}>${inlineToHtml(b.children)}</h${b.level}>`;
      if (b.type === "paragraph") return `<p>${inlineToHtml(b.children)}</p>`;
      if (b.type === "list") {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${b.items.map((it) => `<li>${inlineToHtml(it)}</li>`).join("")}</${tag}>`;
      }
      const head = `<thead><tr>${b.header
        .map((c, idx) => `<th${b.align[idx] && b.align[idx] !== "left" ? ` style="text-align:${b.align[idx]}"` : ""}>${inlineToHtml(c)}</th>`)
        .join("")}</tr></thead>`;
      const body = `<tbody>${b.rows
        .map(
          (r) =>
            `<tr>${r
              .map((c, idx) => `<td${b.align[idx] && b.align[idx] !== "left" ? ` style="text-align:${b.align[idx]}"` : ""}>${inlineToHtml(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody>`;
      return `<table>${head}${body}</table>`;
    })
    .join("\n");
}

export function markdownToHtml(source: string): string {
  return blocksToHtml(parseMarkdown(source));
}

/** 纯文本摘要：去掉标记只留文字，用于 meta description 与卡片摘要 */
export function markdownToPlainText(source: string, max = 160): string {
  const text = parseMarkdown(source)
    .map((b) => {
      if (b.type === "heading" || b.type === "paragraph") return inlineToPlainText(b.children);
      if (b.type === "list") return b.items.map(inlineToPlainText).join("；");
      return [b.header, ...b.rows].map((row) => row.map(inlineToPlainText).join(" ")).join("；");
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.value;
      if (n.type === "code") return n.value;
      if (n.type === "image") return n.alt;
      return inlineToPlainText(n.children);
    })
    .join("");
}

/** 结构统计：供内容检查判断「有没有真正的对比表/列表」 */
export function summarizeBlocks(blocks: Block[]): {
  headings: number;
  paragraphs: number;
  lists: number;
  tables: number;
  links: number;
  words: number;
} {
  let links = 0;
  const countLinks = (nodes: InlineNode[]) => {
    for (const n of nodes) {
      if (n.type === "link") {
        links++;
        countLinks(n.children);
      } else if (n.type === "strong") countLinks(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === "heading" || b.type === "paragraph") countLinks(b.children);
    else if (b.type === "list") b.items.forEach(countLinks);
    else {
      b.header.forEach(countLinks);
      b.rows.forEach((r) => r.forEach(countLinks));
    }
  }
  // 直接算，不要把块还原成 Markdown 再重新解析一遍
  const words = blocks
    .map((b) => {
      if (b.type === "heading" || b.type === "paragraph") return inlineToPlainText(b.children);
      if (b.type === "list") return b.items.map(inlineToPlainText).join("");
      return [b.header, ...b.rows].map((row) => row.map(inlineToPlainText).join("")).join("");
    })
    .join("")
    .replace(/\s+/g, "").length;
  return {
    headings: blocks.filter((b) => b.type === "heading").length,
    paragraphs: blocks.filter((b) => b.type === "paragraph").length,
    lists: blocks.filter((b) => b.type === "list").length,
    tables: blocks.filter((b) => b.type === "table").length,
    links,
    words,
  };
}
