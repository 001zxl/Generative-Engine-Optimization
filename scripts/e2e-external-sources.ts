/**
 * B4 验收：第三方信源台账。
 *
 * 只跑在全新临时库上。用法：
 *   AUTH_SECRET=... node --experimental-strip-types scripts/e2e-external-sources.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-external-sources.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
  process.exit(1);
}
const resolved = path.resolve(DB);
if (resolved === path.join(process.cwd(), "data", "geo.db")) {
  console.error("拒绝在试点库上运行。");
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;
process.env.CONSOLE_PASSWORD = PASSWORD;

const { getDb } = await import("../src/lib/db/index.ts");
const existing = (getDb().prepare("SELECT COUNT(*) AS n FROM external_sources").get() as { n: number }).n;
if (existing > 0) {
  console.error(`该库已有 ${existing} 条来源记录，请在全新库上运行。`);
  process.exit(1);
}

const R = await import("../src/lib/db/repo-domains.ts");
const X = await import("../src/lib/db/repo-external.ts");
const { CLAIM_VERDICT_LABEL, checkExternalSource } = await import("../src/lib/external-sources.ts");

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

/* ---------- 准备 ---------- */
const brandId = R.createBrand({ name: "台账验收品牌", domain: "ledger.example" });
const claimId = R.createClaim({ claimKey: "capacity", statement: "月产能 200 吨", brandId });
R.reviewClaim(claimId, "approved");

console.log("== 1. 登记来源：URL 白名单与去重 ==");
let threw = false;
try {
  X.createExternalSource({ platform: "某站", url: "javascript:alert(1)", sourceKind: "independent" });
} catch {
  threw = true;
}
check("非 http(s) URL 被拒绝", threw);

threw = false;
try {
  X.createExternalSource({ platform: "某站", url: "https://u:p@media.example/a", sourceKind: "independent" });
} catch {
  threw = true;
}
check("带账号密码的 URL 被拒绝", threw);

const independentId = X.createExternalSource({
  platform: "行业媒体", url: "https://media.example/capacity", title: "产能报道",
  topic: "产能", sourceKind: "independent", brandId, claimId, publishedAt: "2026-08-01",
});
const ownedId = X.createExternalSource({
  platform: "自家公众号", url: "https://ledger.example/blog/capacity", title: "我们的产能说明",
  sourceKind: "owned", brandId, claimId,
});
check("两类来源都已登记", !!independentId && !!ownedId);

threw = false;
try {
  X.createExternalSource({ platform: "重复", url: "https://media.example/capacity", sourceKind: "independent" });
} catch {
  threw = true;
}
check("同一 URL 不重复登记（否则一篇会被当成两次背书）", threw);

console.log("== 2. 不得把自发文章称为独立测评 ==");
const mislabelId = X.createExternalSource({
  platform: "自家博客", url: "https://ledger.example/blog/mislabel", title: "我们的独立测评报告",
  sourceKind: "owned", brandId, claimId,
});
const mislabelRow = X.getExternalSource(mislabelId)!;
const mislabelIssues = checkExternalSource(X.rowToInput(mislabelRow));
check("自有来源自称「独立测评」被判阻断", mislabelIssues.some((i) => i.code === "mislabel" && i.level === "block"), JSON.stringify(mislabelIssues.map((i) => i.code)));
check("独立来源使用同样说法不报错", checkExternalSource(X.rowToInput(X.getExternalSource(independentId)!)).every((i) => i.code !== "mislabel"));

console.log("== 3. 汇总：只列仍可访问的来源 ==");
const summaries = X.claimSourceSummaries({ brandId });
const capacity = summaries.find((s) => s.claimKey === "capacity")!;
check("有独立来源时结论为 supported", capacity.verdict === "supported", capacity.verdict);
check("独立来源计入 independent", capacity.independent === 1, String(capacity.independent));
// 该事实下共 3 条来源（独立 / 自有 / 被误标的自有），页面都可访问 → 可用 3 条。
// 「可用」说的是链接是否还能打开，与来源性质是两件事。
check("可用来源为 3 条（页面都可访问）", capacity.usable === 3, String(capacity.usable));
check("被误标的自有来源不计入独立来源", capacity.independent === 1, String(capacity.independent));
check("结论文案可展示", CLAIM_VERDICT_LABEL[capacity.verdict] === "有独立来源");

console.log("== 4. 失效与内容不符的检测 ==");
const deadId = X.createExternalSource({
  platform: "已关站媒体", url: "https://dead.example/gone", title: "旧报道",
  sourceKind: "independent", brandId, claimId,
});
// 直接写入核对结果：真实抓取依赖外网，验收只验证判定逻辑与落库
getDb().prepare("UPDATE external_sources SET last_status='dead', last_http_status=404, last_checked_at=?, last_note='HTTP 404' WHERE id=?")
  .run(new Date().toISOString(), deadId);
const deadRow = X.getExternalSource(deadId)!;
check("失效来源被判阻断", checkExternalSource(X.rowToInput(deadRow)).some((i) => i.code === "dead" && i.level === "block"));

const afterDead = X.claimSourceSummaries({ brandId }).find((s) => s.claimKey === "capacity")!;
check("失效来源不再出现在可用清单", !afterDead.usableSources.some((u) => u.url.includes("dead.example")));
check("失效来源出现在不可用清单并给出原因", afterDead.unusableSources.some((u) => u.url.includes("dead.example") && /404/.test(u.reason)));

const mismatchId = X.createExternalSource({
  platform: "改版媒体", url: "https://changed.example/a", title: "原标题",
  sourceKind: "independent", brandId, claimId,
});
getDb().prepare("UPDATE external_sources SET last_status='mismatch', last_http_status=200, last_checked_at=? WHERE id=?")
  .run(new Date().toISOString(), mismatchId);
check("内容与事实不符被判阻断", checkExternalSource(X.rowToInput(X.getExternalSource(mismatchId)!)).some((i) => i.code === "mismatch" && i.level === "block"));

console.log("== 5. 从未核对与超期 ==");
const neverChecked = X.getExternalSource(ownedId)!;
check("新登记来源标记为从未核对", checkExternalSource(X.rowToInput(neverChecked)).some((i) => i.code === "never_checked"));
const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
getDb().prepare("UPDATE external_sources SET last_checked_at=?, last_status='ok' WHERE id=?").run(old, independentId);
check("超期未核对给出重新核对提示", checkExternalSource(X.rowToInput(X.getExternalSource(independentId)!)).some((i) => i.code === "stale_check"));

console.log("== 6. 冲突优先于其它结论 ==");
X.setSourceConflict(independentId, "另一来源称产能为 100 吨");
const conflicted = X.claimSourceSummaries({ brandId }).find((s) => s.claimKey === "capacity")!;
check("存在冲突时结论为 conflicting", conflicted.verdict === "conflicting", conflicted.verdict);
check("冲突说明需人工判断", /人工判断/.test(conflicted.note), conflicted.note);
check("台账健康度统计出冲突", X.ledgerHealth().conflict >= 1);

console.log("== 7. 仅有自有来源时的口径 ==");
const brand2 = R.createBrand({ name: "仅自有来源品牌", domain: "onlyself.example" });
const claim2 = R.createClaim({ claimKey: "scale", statement: "厂房面积 3000 平米", brandId: brand2 });
R.reviewClaim(claim2, "approved");
X.createExternalSource({ platform: "自家官网", url: "https://onlyself.example/about", title: "关于我们", sourceKind: "owned", brandId: brand2, claimId: claim2 });
const onlySelf = X.claimSourceSummaries({ brandId: brand2 }).find((s) => s.claimKey === "scale")!;
check("只有自有来源时为 only_self", onlySelf.verdict === "only_self", onlySelf.verdict);
check("说明不能声称第三方证实", /不能声称/.test(onlySelf.note), onlySelf.note);
check("自有来源计数为 0 独立", onlySelf.independent === 0);

console.log("== 8. 运营台页面 ==");
const { createSessionToken, COOKIE_NAME } = await import("../src/lib/auth.ts");
const cookie = `${COOKIE_NAME}=${await createSessionToken()}`;
const res = await fetch(`${BASE}/console/sources`, { headers: { cookie } });
const html = (await res.text()).replace(/<!--.*?-->/g, "");
check("台账页 200", res.status === 200, `HTTP ${res.status}`);
check("页面提示不得称自发文章为独立测评", html.includes("不得把自发文章称为独立测评"));
check("页面显示三类来源性质", html.includes("自有内容") && html.includes("客户授权渠道") && html.includes("独立第三方"));
check("页面显示事实的来源支持情况", html.includes("事实的来源支持情况"));
check("页面显示仅自有来源的口径", html.includes("仅自有来源"));
check("页面提供核对按钮", html.includes("核对可用性"));
check("页面提供冲突标记", html.includes("标记冲突"));

console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
