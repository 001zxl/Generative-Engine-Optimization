import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_TEMPLATES,
  buildSkeleton,
  getTemplate,
  lintContent,
  lintVerdict,
  type ContentTemplateId,
} from "../src/lib/content-templates.ts";
import { parseMarkdown, summarizeBlocks } from "../src/lib/markdown.ts";

/**
 * 内容模板与结构校验。
 *
 * 校验规则是要被运营人员执行的，所以每条规则都要能明确说出"该改哪里"，
 * 这里同时验证"该拦的拦住"和"不该拦的别误报"。
 */

const SOURCES = ["- [来源甲](https://example.com/a)", "- [来源乙](https://example.com/b)"].join("\n");

test("四个模板都存在且结构完整", () => {
  assert.deepEqual(
    CONTENT_TEMPLATES.map((t) => t.id),
    ["what_is", "faq", "comparison", "howto"],
  );
  for (const t of CONTENT_TEMPLATES) {
    assert.ok(t.name.length > 0, t.id);
    assert.ok(t.useWhen.length > 0, t.id);
    assert.ok(t.requiredSections.length > 0, t.id);
    assert.ok(t.minSources >= 1, t.id);
    assert.ok(t.placeholders.length > 0, t.id);
  }
});

test("对比模板强制要求表格（没有表格说不清对比维度）", () => {
  assert.equal(getTemplate("comparison")?.requiresTable, true);
  assert.equal(getTemplate("what_is")?.requiresTable, false);
});

test("生成的骨架是合法 Markdown 且含全部必需小节", () => {
  for (const t of CONTENT_TEMPLATES) {
    const md = buildSkeleton(t.id);
    const blocks = parseMarkdown(md);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.children.map((c) => ("value" in c ? c.value : "")).join("") : ""));
    for (const section of t.requiredSections) {
      assert.ok(
        headings.some((h) => h === section || h.startsWith(section)),
        `${t.id} 骨架缺少「${section}」，实际：${headings.join("/")}`,
      );
    }
    if (t.requiresTable) {
      assert.ok(summarizeBlocks(blocks).tables >= 1, `${t.id} 骨架应有表格`);
    }
  }
});

test("骨架未替换占位符时判为阻断（不能把模板原文发出去）", () => {
  const issues = lintContent({ templateId: "what_is", body: buildSkeleton("what_is"), sourceCount: 1 });
  assert.ok(issues.some((i) => i.code === "placeholder_left"));
  assert.equal(lintVerdict(issues).ok, false);
});

test("对比内容缺表格判为阻断", () => {
  const body = ["## 结论", "A 适合小店，B 适合连锁。", "", "## 对比维度", "两者在价格与稳定性上有差异。", "", "## 选哪个", "- 选 A：预算紧", "- 选 B：要稳定", "", "## 数据来源", SOURCES].join("\n");
  const issues = lintContent({ templateId: "comparison", body, sourceCount: 2 });
  assert.ok(issues.some((i) => i.code === "missing_table"), JSON.stringify(issues));
});

test("缺少必需小节判为阻断，并指明缺的是哪一节", () => {
  const body = ["## 一句话结论", "这就是结论。", "", "## 适用场景", "- 场景甲", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1 });
  const codes = issues.filter((i) => i.level === "block").map((i) => i.code);
  assert.ok(codes.includes("missing_section:不适用的情况"), codes.join(","));
  assert.ok(codes.includes("missing_section:常见误解"), codes.join(","));
});

test("开头小节不对判为阻断（第一段必须直答）", () => {
  const body = ["## 行业背景", "先讲三段历史。", "", "## 一句话结论", "结论在这。", "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1 });
  assert.ok(issues.some((i) => i.code === "missing_lead_section"), JSON.stringify(issues));
});

test("首段过长给出警告但不阻断（可读性建议而非合规问题）", () => {
  const long = "很长的一段话。".repeat(40);
  const body = ["## 一句话结论", long, "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1 });
  const warn = issues.find((i) => i.code === "lead_too_long");
  assert.ok(warn, JSON.stringify(issues));
  assert.equal(warn?.level, "warn");
});

test("来源不足判为阻断（没有来源的公开内容不能发布）", () => {
  const body = ["## 一句话结论", "结论。", "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙"].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 0 });
  assert.ok(issues.some((i) => i.code === "too_few_sources"), JSON.stringify(issues));
});

test("未绑定已批准事实给出警告", () => {
  const body = ["## 一句话结论", "结论。", "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1, approvedFactCount: 0 });
  const w = issues.find((i) => i.code === "no_approved_facts");
  assert.ok(w);
  assert.equal(w?.level, "warn");
});

test("结构合规的内容不误报为阻断", () => {
  const body = [
    "## 一句话结论",
    "示例市示例区示例菜馆是一家主营炒菜的家常餐馆，位于示例路示例大厦对面，每日 09:00 至 21:30 营业。",
    "",
    "## 适用场景",
    "- 附近居民日常用餐",
    "- 家庭聚餐",
    "",
    "## 不适用的情况",
    "- 需要包间的大型宴请",
    "",
    "## 常见误解",
    "- 误以为只做外卖：堂食正常营业",
    "",
    SOURCES,
  ].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 2, approvedFactCount: 3 });
  const verdict = lintVerdict(issues);
  assert.equal(verdict.ok, true, JSON.stringify(issues));
  assert.equal(verdict.blockers, 0);
});

test("空正文判为阻断且不抛错", () => {
  for (const body of ["", "   "]) {
    const issues = lintContent({ templateId: "faq", body });
    assert.ok(issues.some((i) => i.code === "empty" || i.code === "no_direct_answer"), JSON.stringify(issues));
  }
});

test("未知模板返回明确错误而不是静默通过", () => {
  const issues = lintContent({ templateId: "nope" as ContentTemplateId, body: "## 结论\n内容" });
  assert.deepEqual(issues.map((i) => i.code), ["unknown_template"]);
});

test("小节数过少给警告", () => {
  const body = ["## 结论", "结论。", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "comparison", body, sourceCount: 2 });
  assert.ok(issues.some((i) => i.code === "too_few_sections"), JSON.stringify(issues));
});

test("正文含原始 HTML 给出警告（会被当文字显示，通常不是本意）", () => {
  const body = ["## 一句话结论", "结论。<br>下一行。", "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1 });
  const w = issues.find((i) => i.code === "raw_html_present");
  assert.ok(w, JSON.stringify(issues));
  assert.equal(w?.level, "warn");
  assert.match(w?.message ?? "", /原样显示/);
});

test("正常 Markdown 不触发原始 HTML 警告", () => {
  const body = ["## 一句话结论", "结论。", "", "## 适用场景", "- 甲", "", "## 不适用的情况", "- 乙", "", "## 常见误解", "- 丙", "", SOURCES].join("\n");
  const issues = lintContent({ templateId: "what_is", body, sourceCount: 1 });
  assert.equal(issues.filter((i) => i.code === "raw_html_present").length, 0);
});
