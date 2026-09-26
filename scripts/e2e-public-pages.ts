/**
 * A2 验收：公开实体页的发布状态、内容、canonical 与 sitemap 一致性。
 *
 * 只跑在**全新**临时库上（脚本会重建同名对象，脏库上重跑会因对象重复而失败）。
 *
 * 用法：
 *   AUTH_SECRET=... node --experimental-strip-types scripts/e2e-public-pages.ts <DB_PATH> <BASE_URL>
 */
import path from "node:path";

const [DB, BASE] = process.argv.slice(2);
if (!DB || !BASE) {
  console.error("用法：node scripts/e2e-public-pages.ts <DB_PATH> <BASE_URL>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;

// 脏库上重跑会产生重复品牌，claim 归属随之错位 —— 直接拒绝，避免误判为产品缺陷
const existing = await (async () => {
  const { getDb } = await import("../src/lib/db/index.ts");
  return (getDb().prepare("SELECT COUNT(*) AS n FROM public_pages").get() as { n: number }).n;
})();
if (existing > 0) {
  console.error(`该库已有 ${existing} 条公开页记录，请在全新库上运行（rm -f <DB_PATH>* 后重启夹具服务）。`);
  process.exit(1);
}

const R = await import("../src/lib/db/repo-domains.ts");
const L = await import("../src/lib/db/repo-local.ts");
const PP = await import("../src/lib/db/repo-public.ts");
const { publicPath } = await import("../src/lib/public-pages.ts");

let pass = 0;
const failed: string[] = [];
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? "  -> " + detail : ""}`);
  } else {
    failed.push(name);
    console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`);
  }
};

/* ---------- 准备数据 ---------- */
const storeId = L.createStore({
  name: "公开页测试门店",
  city: "示例市",
  district: "示例区",
  address: "示例路 1 号",
  category: "餐饮/炒菜",
  lat: 36.6,
  lng: 119.1,
});
// createStore 默认状态是 unverified（待核实），必须显式置为 active 才能公开 ——
// 这正是发布检查的第一道闸
L.updateStore(storeId, { status: "active" });
L.addStoreFact({ storeId, factKey: "name", value: "公开页测试门店", sourceKind: "official", sourceTitle: "营业执照" });
L.addStoreFact({ storeId, factKey: "address", value: "示例路 1 号", sourceKind: "official", sourceTitle: "营业执照" });
L.addStoreFact({ storeId, factKey: "phone", value: "0000-0000000", sourceKind: "official", sourceTitle: "营业执照" });
for (const f of L.listStoreFacts(storeId)) L.verifyStoreFact(f.id, "https://example.com/license");
// 内部备注类事实，不应公开
L.addStoreFact({ storeId, factKey: "status_note", value: "内部备注：出餐慢", sourceKind: "self", sourceTitle: "内部" });
L.setStoreHours(storeId, [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, closed: false, opens: "09:00", closes: "21:30" })));
L.upsertMapListing({ storeId, platform: "amap", claimStatus: "claimed_by_us", listingUrl: "https://amap.com/poi/x" });

const brandId = R.createBrand({ name: "公开页测试品牌", domain: "pubtest.example", description: "用于验收的品牌" });
const claimId = R.createClaim({ claimKey: "capacity", statement: "月产能 200 吨", category: "产能", brandId });
R.addEvidence({ claimId, kind: "website", title: "官方产能说明", url: "https://pubtest.example/capacity", publisher: "公开页测试品牌", evidenceLevel: "official" });
R.reviewClaim(claimId, "approved");

console.log("== 1. 未建立页面时匿名访问必须 404 ==");
const storePage = PP.previewStorePage(storeId);
check("门店发布检查通过", storePage.ok, JSON.stringify(storePage.blockers));
const storePageId = PP.upsertStorePage(storeId);
let row = PP.getPublicPageByEntity("store", storeId)!;
check("草稿页已建立", row.status === "draft", row.status);
const slug = row.slug;

let res = await fetch(`${BASE}${publicPath("store", slug)}`);
check("草稿状态匿名访问 404", res.status === 404, `HTTP ${res.status}`);
res = await fetch(`${BASE}/api/health`);
check("夹具服务不是试点库", (await res.json()).pilot === false);

console.log("== 2. 提交审核后仍不可公开访问 ==");
PP.submitForReview(storePageId);
row = PP.getPublicPageByEntity("store", storeId)!;
check("状态为待审核", row.status === "in_review", row.status);
res = await fetch(`${BASE}${publicPath("store", slug)}`);
check("待审核状态匿名访问 404", res.status === 404, `HTTP ${res.status}`);

console.log("== 3. 公开后匿名可访问 ==");
PP.publishPage(storePageId);
row = PP.getPublicPageByEntity("store", storeId)!;
check("状态为已公开", row.status === "published", row.status);
res = await fetch(`${BASE}${publicPath("store", slug)}`);
const html = await res.text();
check("已公开页返回 200", res.status === 200, `HTTP ${res.status}`);
check("页面显示店名", html.includes("公开页测试门店"));
check("页面显示地址", html.includes("示例路 1 号"));
check("页面显示电话", html.includes("0000-0000000"));
check("页面显示营业时间", html.includes("09:00-21:30"));
check("页面显示地图资料链接", html.includes("https://amap.com/poi/x"));
check("页面标注信息来源", html.includes("营业执照") && html.includes("信息来源"));
// 日期外面包着 <time>，先剥标签再匹配，否则断言会因为标记而误判
const htmlText = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
check("页面显示更新时间", /最后更新于\s*\d{4}-\d{2}-\d{2}/.test(htmlText), htmlText.match(/最后更新于[^·]{0,20}/)?.[0] ?? "");
check("页面有咨询入口", html.includes("咨询") && /<form/.test(html));
check("页面有站内链接", html.includes('href="/"') || html.includes("返回首页"));

console.log("== 3b. A3 结构化数据 ==");
const ldMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
check("页面含 JSON-LD", !!ldMatch);
let ld: Record<string, unknown> = {};
if (ldMatch) {
  try {
    ld = JSON.parse(ldMatch[1].replace(/\\u003c/g, "<"));
  } catch (e) {
    check("JSON-LD 可解析", false, String(e));
  }
}
check("JSON-LD 可解析", Object.keys(ld).length > 0);
check("门店用 Restaurant（餐饮类）", ld["@type"] === "Restaurant", String(ld["@type"]));
check("JSON-LD 名称为页面店名", ld.name === "公开页测试门店", String(ld.name));
check("JSON-LD 电话与页面一致", ld.telephone === "0000-0000000", String(ld.telephone));
check(
  "JSON-LD 地址与页面一致",
  (ld.address as Record<string, unknown> | undefined)?.streetAddress === "示例路 1 号",
  JSON.stringify(ld.address),
);
check(
  "JSON-LD 不含评分/奖项（不得编造）",
  !JSON.stringify(ld).includes("aggregateRating") && !JSON.stringify(ld).includes("award"),
);
check("JSON-LD 不含页面上没有的国家代码", !JSON.stringify(ld).includes('"CN"'));

// 一致性自检：结构化数据里的关键字段必须能在页面可见文本里找到
const { checkJsonLdConsistency } = await import("../src/lib/jsonld.ts");
const visibleText = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const visibleLinks = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const inconsistencies = checkJsonLdConsistency(ld, { text: visibleText, links: visibleLinks });
check("结构化数据与页面可见内容一致", inconsistencies.length === 0, JSON.stringify(inconsistencies));

console.log("== 4. 内部字段不得外泄 ==");
check("不含 status_note 值", !html.includes("出餐慢"));

console.log("== 5. canonical 与 sitemap 一致 ==");
const canonicalMatch = /<link rel="canonical" href="([^"]+)"/.exec(html);
check("页面有 canonical", !!canonicalMatch, canonicalMatch?.[1] ?? "无");
const canonical = canonicalMatch?.[1] ?? "";
check("canonical 指向本页路径", canonical.includes(publicPath("store", slug)), canonical);

const sitemapRes = await fetch(`${BASE}/sitemap.xml`);
const sitemap = await sitemapRes.text();
check("sitemap 200", sitemapRes.status === 200);
check("sitemap 含该门店页", sitemap.includes(publicPath("store", slug)));

console.log("== 6. robots 允许实体页、仍禁运营台 ==");
const robotsRes = await fetch(`${BASE}/robots.txt`);
const robots = await robotsRes.text();
check("robots 允许 /stores/", /Allow:\s*\/stores\//i.test(robots) || robots.includes("/stores/"));
check("robots 仍禁 /console", /Disallow:\s*\/console/i.test(robots));

console.log("== 7. 品牌页 ==");
const brandPreview = PP.previewBrandPage(brandId);
check("品牌发布检查通过", brandPreview.ok, JSON.stringify(brandPreview.blockers));
const brandPageId = PP.upsertBrandPage(brandId);
res = await fetch(`${BASE}${publicPath("brand", PP.getPublicPageByEntity("brand", brandId)!.slug)}`);
check("品牌页公开前 404", res.status === 404, `HTTP ${res.status}`);
PP.publishPage(brandPageId);
const brandSlug = PP.getPublicPageByEntity("brand", brandId)!.slug;
res = await fetch(`${BASE}${publicPath("brand", brandSlug)}`);
const brandHtml = await res.text();
check("品牌页公开后 200", res.status === 200, `HTTP ${res.status}`);
check("品牌页显示已批准事实", brandHtml.includes("月产能 200 吨"));
check("品牌页逐条列出证据", brandHtml.includes("官方产能说明") && brandHtml.includes("https://pubtest.example/capacity"));
const brandLdMatch = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(brandHtml);
check("品牌页含 JSON-LD", !!brandLdMatch);
if (brandLdMatch) {
  const bld = JSON.parse(brandLdMatch[1].replace(/\\u003c/g, "<")) as Record<string, unknown>;
  check("品牌用 Organization", bld["@type"] === "Organization", String(bld["@type"]));
  const subject = bld.subjectOf as Array<Record<string, unknown>> | undefined;
  check("品牌事实带 citation", !!subject && subject.length === 1 && (subject[0].citation as string[])[0] === "https://pubtest.example/capacity");
}

console.log("== 8. 下线后必须立刻不可访问 ==");
PP.archivePage(storePageId, "验收下线");
res = await fetch(`${BASE}${publicPath("store", slug)}`);
check("下线后匿名访问 404", res.status === 404, `HTTP ${res.status}`);
const sitemap2 = await (await fetch(`${BASE}/sitemap.xml`)).text();
check("下线后从 sitemap 移除", !sitemap2.includes(publicPath("store", slug)));
check("下线后品牌页仍在 sitemap（未被误伤）", sitemap2.includes(publicPath("brand", brandSlug)));

console.log("== 9. 快照不随资料漂移 ==");
const before = JSON.parse(PP.getPublicPageByEntity("brand", brandId)!.snapshot_json);
R.addEvidence({ claimId, kind: "website", title: "新增证据", url: "https://pubtest.example/new", evidenceLevel: "official" });
const after = JSON.parse(PP.getPublicPageByEntity("brand", brandId)!.snapshot_json);
check("改资料后已发布快照未变", JSON.stringify(before) === JSON.stringify(after));
check("预览能看出资料已变动（drift）", PP.previewBrandPage(brandId).drift === true);

console.log("== 10. 不合格内容不能被公开 ==");
const badStore = L.createStore({ name: "缺资料门店", city: "示例市", status: "unverified" });
const badId = PP.upsertStorePage(badStore);
let threw = false;
try {
  PP.publishPage(badId);
} catch {
  threw = true;
}
check("服务端拒绝发布不合格门店页（不依赖界面禁用）", threw);
check("状态仍为草稿", PP.getPublicPageByEntity("store", badStore)!.status === "draft");

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
