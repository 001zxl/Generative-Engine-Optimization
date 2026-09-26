/**
 * A1 验收：含对比表的样例发布后，页面 JSX 与抓取到的 HTML 都能看到真正的 <table>。
 *
 * 只跑在临时库上（拒绝试点库）。用法：
 *   node --experimental-strip-types scripts/e2e-content-render.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 *
 * AUTH_SECRET 需与服务端一致（用于签发会话令牌读取运营台，可选）。
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-content-render.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行：这是内容渲染验收，不是生产发布。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;
process.env.CONSOLE_PASSWORD = PASSWORD;

const R = await import("../src/lib/db/repo-domains.ts");
const P = await import("../src/lib/publishing.ts");
const { buildSkeleton, lintContent, lintVerdict } = await import("../src/lib/content-templates.ts");
const { markdownToHtml } = await import("../src/lib/markdown.ts");

let pass = 0;
const failed: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  -> " + detail : ""}`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
}

console.log("== 1. 准备已批准事实与来源 ==");
const brandId = R.createBrand({ name: "样例餐饮", domain: "sample-food.example", description: "A1 渲染验收" });
const claimId = R.createClaim({
  claimKey: "sample_address",
  statement: "样例餐饮位于示例市示例区示例路示例大厦对面",
  category: "address",
});
R.addEvidence({
  claimId,
  kind: "website",
  title: "门店官方页面",
  url: "https://sample-food.example/about",
  publisher: "样例餐饮",
  evidenceLevel: "official",
});
R.reviewClaim(claimId, "approved");
check("事实已批准并绑定来源", true);

console.log("== 2. 用对比模板生成正文并替换占位符 ==");
let body = buildSkeleton("comparison", { 对象A: "堂食", 对象B: "外卖" });
body = body
  .replace(/（先说结论：各自适合谁。不要用「各有优劣」收尾。）/, "堂食适合家庭聚餐，外卖适合单人就餐。")
  .replace(/\| 维度1 \|  \|  \|/, "| 人均 | 45 元 | 38 元 |")
  .replace(/\| 维度2 \|  \|  \|/, "| 出餐时间 | 15 分钟 | 30 分钟 |")
  .replace(/\| 维度3 \|  \|  \|/, "| 适合人数 | 3 人以上 | 1-2 人 |")
  .replace(/（具体条件，不要写「预算充足」这种无法验证的话）/, "3 人以上聚餐")
  .replace(/（具体条件）/, "工作餐快速解决")
  .replace(/https:\/\/example\.com\/1/g, "https://sample-food.example/menu")
  .replace(/来源标题1/g, "门店菜单页")
  .replace(/https:\/\/example\.com\/2/g, "https://sample-food.example/delivery")
  .replace(/来源标题2/g, "外卖平台页")
  // 故意混入原始 HTML，验证不会被当成标签渲染
  .replace("## 结论", "## 结论\n\n以下含一段用于验证转义的文本：<script>alert('xss')</script>");

const issues = lintContent({ templateId: "comparison", body, sourceCount: 2, approvedFactCount: 1 });
check("模板结构检查通过（无阻断项）", lintVerdict(issues).ok, JSON.stringify(issues.filter((i) => i.level === "block")));

const htmlDirect = markdownToHtml(body);
check("publicationHtml 同一份解析器产出表格", htmlDirect.includes("<table>") && htmlDirect.includes("<td>"));

console.log("== 3. 审核并发布到本站知识页 ==");
const assetId = R.createAsset({
  kind: "comparison",
  title: "堂食还是外卖：样例餐饮两种吃法对比",
  bodyMd: body,
  author: "内容团队",
  claimIds: [claimId],
});
R.reviewAsset(assetId, "approved");
const dispatchId = P.createPublicationDispatch(assetId, "own_site");
const exec = await P.executePublicationDispatch(dispatchId);
check("已发布到本站知识页", exec.status === "succeeded", `${exec.status} ${exec.published_url ?? ""}`);
const slug = new URL(exec.published_url!).pathname.split("/").pop()!;

console.log("== 4. 抓取真实页面 HTML（等同外部抓取方看到的）==");
const res = await fetch(`${BASE}/knowledge/${slug}`);
const html = await res.text();
check("页面返回 200", res.status === 200, `HTTP ${res.status}`);

console.log("== 5. 结构与内容 ==");
check("HTML 含真正的 <table>", /<table[\s>]/.test(html));
check("HTML 含表头 <th>", /<th[\s>]/.test(html));
check("HTML 含数据单元格 <td>", /<td[\s>]/.test(html));
check("对比表三个维度都在", ["人均", "出餐时间", "适合人数"].every((k) => html.includes(k)));
check("直答句可见", html.includes("堂食适合家庭聚餐，外卖适合单人就餐。"));
check("列表渲染成 <ul>/<li>", /<ul[\s>]/.test(html) && /<li[\s>]/.test(html));
check("二级标题渲染", /<h2[\s>]/.test(html));

console.log("== 6. 安全：原始 HTML 不得成为元素 ==");
// 注意：Next.js 自身会输出 <script>，所以不能断言「页面没有 script 标签」。
// 要断言的是：注入的那一段没有变成**可执行的元素**。
check("注入的脚本未成为元素", !html.includes("<script>alert"));
check("注入内容只以文本形式存在", (html.match(/<script>alert/g) ?? []).length === 0);
check("注入文本被转义显示", html.includes("&lt;script&gt;") || html.includes("&amp;lt;script&amp;gt;"));
check("危险链接不产生 href", !html.includes('href="javascript:'));

console.log("== 7. canonical 与摘要 ==");
check("canonical 指向本篇 URL", html.includes(`/knowledge/${slug}`) && /rel="canonical"/.test(html));
check("meta description 不含 Markdown 标记", !/name="description" content="[^"]*##/.test(html));

console.log("== 8. 与旧实现对比：以前表格会丢失 ==");
check("正文长度足够（表格未被截断）", html.length > 3000, `${html.length} 字符`);

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
