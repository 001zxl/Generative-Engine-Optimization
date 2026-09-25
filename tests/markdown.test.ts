import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkdown,
  markdownToHtml,
  markdownToPlainText,
  safeHref,
  summarizeBlocks,
} from "../src/lib/markdown.ts";

/**
 * 安全 Markdown 子集。
 *
 * 重点不在"能渲染什么"，而在"渲染不出什么" —— 正文来自运营台录入，
 * 最终会输出到公开页面和第三方平台。任何一条绕过路径都是可注入的 XSS。
 */

/* ---------------- 结构 ---------------- */

test("段落与标题分层", () => {
  const blocks = parseMarkdown("第一段。\n\n## 小节\n\n第二段。");
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "heading", "paragraph"]);
  assert.equal(blocks[1].type === "heading" && blocks[1].level, 2);
});

test("正文中的 # 与 ## 都降为 h2（h1 由页面标题独占）", () => {
  const blocks = parseMarkdown("# 一级\n\n## 二级\n\n### 三级\n\n#### 四级");
  const levels = blocks.map((b) => (b.type === "heading" ? b.level : null));
  assert.deepEqual(levels, [2, 2, 3, 4]);
});

test("无序列表：-, *, + 都识别", () => {
  for (const marker of ["-", "*", "+"]) {
    const blocks = parseMarkdown(`${marker} 甲\n${marker} 乙`);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, "list");
    assert.equal(blocks[0].type === "list" && blocks[0].ordered, false);
    assert.equal(blocks[0].type === "list" && blocks[0].items.length, 2);
  }
});

test("有序列表：1. 与 1) 都识别", () => {
  for (const text of ["1. 甲\n2. 乙", "1) 甲\n2) 乙"]) {
    const blocks = parseMarkdown(text);
    assert.equal(blocks[0].type === "list" && blocks[0].ordered, true, text);
  }
});

test("表格渲染成真正的 table，含表头与对齐", () => {
  const md = ["| 维度 | A | B |", "| --- | :---: | ---: |", "| 价格 | 低 | 高 |", "| 速度 | 快 | 慢 |"].join("\n");
  const html = markdownToHtml(md);
  assert.match(html, /<table>/);
  assert.match(html, /<thead><tr><th>维度<\/th><th style="text-align:center">A<\/th>/);
  assert.match(html, /<td style="text-align:right">高<\/td>/);
  assert.match(html, /<tbody>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3);
});

test("表格识别不误伤普通含竖线的段落", () => {
  const blocks = parseMarkdown("这里是 a | b 的说明文字");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
});

test("链接：外站与站内都可渲染", () => {
  const html = markdownToHtml("见 [外站](https://example.com) 与 [站内](/knowledge/faq)");
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">外站<\/a>/);
  assert.match(html, /<a href="\/knowledge\/faq">站内<\/a>/);
});

test("粗体与行内代码", () => {
  const html = markdownToHtml("**重点** 与 `code`");
  assert.match(html, /<strong>重点<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
});

/* ---------------- 安全 ---------------- */

test("危险 scheme 一律不产生 href（文字保留）", () => {
  for (const bad of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/uuid",
  ]) {
    assert.equal(safeHref(bad), null, bad);
    const html = markdownToHtml(`[点我](${bad})`);
    assert.ok(!html.includes("href="), `不应产生 href: ${bad} → ${html}`);
    assert.ok(html.includes("点我"), `文字应保留: ${bad}`);
  }
});

test("协议相对地址 //evil.com 被拒（在 https 页面会变成外站）", () => {
  assert.equal(safeHref("//evil.com/x"), null);
  const html = markdownToHtml("[x](//evil.com)");
  assert.ok(!html.includes("href="));
});

test("含空白或控制字符的 URL 被拒", () => {
  assert.equal(safeHref("https://example.com/a b"), null);
  assert.equal(safeHref("https://example.com/\u0000"), null);
  assert.equal(safeHref("java\nscript:alert(1)"), null);
});

test("合法地址被放行", () => {
  for (const good of ["https://example.com", "http://example.com/a?b=1#c", "/knowledge/x", "#anchor", "mailto:x@y.com"]) {
    const got = safeHref(good);
    if (good.startsWith("mailto:")) assert.equal(got, null, "mailto 不在白名单");
    else assert.equal(got, good);
  }
});

test("原始 HTML 被转义成文字，不产生元素", () => {
  const html = markdownToHtml("正常文字\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
  assert.ok(!html.includes("<script"), html);
  assert.ok(!html.includes("<img"), html);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("表格单元格里的 HTML 也被转义", () => {
  const md = ["| a | b |", "| --- | --- |", "| <script>x</script> | ok |"].join("\n");
  const html = markdownToHtml(md);
  assert.ok(!html.includes("<script"), html);
  assert.match(html, /&lt;script&gt;/);
});

test("链接文字里的 HTML 被转义", () => {
  const html = markdownToHtml("[<img src=x onerror=alert(1)>](https://example.com)");
  assert.ok(!html.includes("<img"), html);
});

test("标题里的 HTML 被转义", () => {
  const html = markdownToHtml("## <script>alert(1)</script>");
  assert.ok(!html.includes("<script"), html);
});

test("嵌套：链接文字里的粗体不破坏转义", () => {
  const html = markdownToHtml("[**粗**](https://example.com)");
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*><strong>粗<\/strong><\/a>/);
});

/* ---------------- 摘要与统计 ---------------- */

test("纯文本摘要去掉标记且截断", () => {
  const text = markdownToPlainText("# 标题\n\n正文 **加粗** 与 [链接](https://example.com)。", 200);
  assert.ok(!text.includes("#"));
  assert.ok(!text.includes("**"));
  assert.ok(!text.includes("https://"));
  assert.ok(text.includes("加粗"));
  assert.ok(text.includes("链接"));
  const short = markdownToPlainText("一二三四五六七八九十", 5);
  assert.equal(short.length, 5);
  assert.ok(short.endsWith("…"));
});

test("结构统计能看出有没有真正的表格与列表", () => {
  const md = ["## 结论", "", "直答一句。", "", "| a | b |", "| --- | --- |", "| 1 | 2 |", "", "- 甲", "- 乙"].join("\n");
  const s = summarizeBlocks(parseMarkdown(md));
  assert.equal(s.headings, 1);
  assert.equal(s.tables, 1);
  assert.equal(s.lists, 1);
  assert.equal(s.paragraphs, 1);
  assert.ok(s.words > 0);
});

test("空输入不抛错", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.equal(markdownToHtml(""), "");
  assert.equal(markdownToPlainText(""), "");
});

test("CRLF 换行与多余空行不影响解析", () => {
  const blocks = parseMarkdown("甲\r\n\r\n\r\n## 乙\r\n");
  assert.deepEqual(blocks.map((b) => b.type), ["paragraph", "heading"]);
});
