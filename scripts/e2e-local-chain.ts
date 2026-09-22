/**
 * 本地门店链路端到端回归。
 *
 * 只跑在临时库上，**绝不碰试点库** —— 门店链路的测试数据一旦混进
 * 真实库，报告里的数字就不再可信。
 *
 * 用法：CONSOLE_PASSWORD=... AUTH_SECRET=... node --experimental-strip-types \
 *        scripts/e2e-local-chain.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>
 *
 * AUTH_SECRET 必须与服务端一致；没有它签不出会话令牌。
 */
import path from "node:path";

const [DB, BASE, PASSWORD] = process.argv.slice(2);
if (!DB || !BASE || !PASSWORD) {
  console.error("用法：node scripts/e2e-local-chain.ts <DB_PATH> <BASE_URL> <CONSOLE_PASSWORD>");
  process.exit(1);
}
const resolved = path.resolve(DB);
const pilot = path.join(process.cwd(), "data", "geo.db");
if (resolved === pilot) {
  console.error(`拒绝在试点库上运行：${resolved}`);
  process.exit(1);
}
process.env.DATABASE_PATH = resolved;

const R = await import("../src/lib/db/repo-domains.ts");
const L = await import("../src/lib/db/repo-local.ts");

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

console.log("== 1. 门店建档 ==");
const brandId = R.createBrand({ name: "试点餐饮", domain: "pilot-food.example", description: "门店链路夹具" });
const store = L.createStore({
  name: "试点餐饮（人民广场店）",
  brandId,
  city: "上海",
  district: "黄浦区",
  address: "南京西路 100 号 1 层",
  lat: 31.2304,
  lng: 121.4737,
  category: "川菜",
  serviceRadiusKm: 3,
});
check("门店创建成功", !!store, store);

L.setStoreHours(store, [
  { weekday: 1, closed: false, opens: "11:00", closes: "22:00" },
  { weekday: 2, closed: false, opens: "11:00", closes: "22:00" },
]);
check("营业时间写入", L.listStoreHours(store).length === 2);

console.log("== 2. 地图资料核对（只读，不写回第三方） ==");
L.addStoreFact({ storeId: store, factKey: "name", value: "试点餐饮（人民广场店）", sourceUrl: "https://example.com/营业执照", sourceKind: "document" });
L.addStoreFact({ storeId: store, factKey: "phone", value: "021-12345678", sourceUrl: "https://example.com/门店照", sourceKind: "document" });
const facts = L.listStoreFacts(store);
for (const f of facts) L.verifyStoreFact(f.id, f.source_url ?? undefined);
check("事实已核验", L.listStoreFacts(store).every((f) => f.status === "verified"), `${facts.length} 条`);

const listing = L.upsertMapListing({
  storeId: store,
  platform: "google_business",
  poiId: "pilot-poi-1",
  claimStatus: "claimed_by_us",
  // 平台侧店名与已核验事实故意不一致，用于触发阻断级差异
});
L.saveListingSnapshot({
  listingId: listing,
  snapshot: { name: "试点餐饮（人民广场）", address: "南京西路 100 号 1 层", phone: "021-12345678" },
});
const openDiffs = L.listMapDiffs({ storeId: store, onlyOpen: true });
check("店名不一致产生差异", openDiffs.length > 0, `${openDiffs.length} 条`);
check("店名差异为阻断级", openDiffs.some((d) => d.field === "name" && d.severity === "block"));
L.resolveMapDiff(openDiffs[0].id, "wont_fix", "平台侧限制，人工确认可接受");
check("差异可人工处理并留痕", L.listMapDiffs({ storeId: store, onlyOpen: true }).length === openDiffs.length - 1);

console.log("== 3. 位置化问题库 ==");
const anchor = L.createAnchor({ storeId: store, name: "地铁站 2 号口", kind: "landmark", lat: 31.2310, lng: 121.4740 });
const scenario = L.createScenario({
  storeId: store,
  anchorId: anchor,
  radiusM: 1000,
  daypart: "dinner",
  need: "两人晚餐",
  expectedNote: "距锚点 400m，主营川菜，晚餐营业",
});
check("锚点与场景创建", !!anchor && !!scenario);

console.log("== 4. 采样批次：两种定位方式必须分开 ==");
const qsId = R.createQuerySet("门店问题集", brandId);
R.addQuestions(qsId, [
  "人民广场附近有什么好吃的川菜？",
  "南京西路两人晚餐推荐哪家？",
  "上海黄浦区适合商务宴请的餐厅？",
  "附近川菜馆哪家营业到晚上十点？",
  "人民广场地铁站附近人均 100 的餐厅？",
  "静安区有哪些地道的川菜馆？",
]);
R.freezeQuerySet(qsId);

const deviceRun = R.createSamplingRun({
  label: "定位基线",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["FixtureAI"],
  storeId: store,
  locationMode: "device_location",
  anchorId: anchor,
  daypart: "dinner",
});
const textRun = R.createSamplingRun({
  label: "文字基线",
  querySetId: qsId,
  samplingMode: "manual_ui",
  engines: ["FixtureAI"],
  storeId: store,
  locationMode: "question_text_only",
});
check("两种定位方式各建一个批次", deviceRun.runId !== textRun.runId);

const deviceTasks = R.listSamplingTasks(deviceRun.runId);
const textTasks = R.listSamplingTasks(textRun.runId);
for (const t of deviceTasks) {
  R.saveSample({ taskId: t.id, rawAnswer: "推荐 试点餐饮（人民广场店），川菜，人均 90 元。来源：https://pilot-food.example" });
}
for (const t of textTasks) {
  R.saveSample({ taskId: t.id, rawAnswer: "附近有若干川菜馆，未给出具体店名。" });
}
const deviceSamples = R.listSamples(deviceRun.runId);
const textSamples = R.listSamples(textRun.runId);
check("定位批次样本写入", deviceSamples.length === deviceTasks.length, `${deviceSamples.length} 条`);
check("文字批次样本写入", textSamples.length === textTasks.length, `${textSamples.length} 条`);
check(
  "样本级定位方式随批次冻结",
  deviceSamples.every((s) => (s as unknown as { location_mode: string }).location_mode === "device_location") &&
    textSamples.every((s) => (s as unknown as { location_mode: string }).location_mode === "question_text_only"),
);

console.log("== 5. 分组永不合并 ==");
const groups = L.listRunsByLocationMode(store);
check("按定位方式分成两组", groups.length === 2, groups.map((g) => `${g.locationMode}:${g.runs.length}`).join(" "));

console.log("== 6. 评估与事实错误率 ==");
const { evaluateScope } = await import("../src/lib/evaluate-run.ts");
const ev = evaluateScope({ brandId, runId: deviceRun.runId });
check("定位批次评估成功", ev.ok, JSON.stringify(ev.notComputable ?? []));
const factRows = L.listFactEvalsForRun(deviceRun.runId);
const { computeFactErrorRate, compareBaseline } = await import("../src/lib/local-geo.ts");
const rate = computeFactErrorRate(factRows);
check("事实错误率有可判定口径", rate === null || rate.denominator > 0, JSON.stringify(rate));

console.log("== 7. 前后对比如实呈现 ==");
const snaps = R.listMetricSnapshots(deviceRun.runId);
check("指标快照已落库", snaps.length > 0, `${snaps.length} 个指标`);
const cmp = compareBaseline("mention_rate", { value: 0.5, numerator: 5, denominator: 10 }, { value: 0.2, numerator: 2, denominator: 10 });
check("下降判为 declined，不粉饰", cmp.verdict === "declined", cmp.note);

console.log("== 8. 报告页渲染（有数据、非空态） ==");
// 登录走 Server Action，直接 POST 表单拿不到 Cookie；
// 这里用同一套 auth 模块签发会话令牌，等价于真实登录后的 Cookie。
const { createSessionToken, COOKIE_NAME } = await import("../src/lib/auth.ts");
process.env.CONSOLE_PASSWORD = PASSWORD;
if (!process.env.AUTH_SECRET) {
  console.error("缺少 AUTH_SECRET 环境变量（需与服务端一致）");
  process.exit(1);
}
const token = await createSessionToken();
check("能签发会话令牌（口令与密钥均已配置）", !!token);
const cookie = `${COOKIE_NAME}=${token}`;
check("会话 Cookie 已构造", cookie.length > 20);

const pages = [
  { url: `/console/stores?store=${store}`, must: ["门店档案", "营业时间", "事实"] },
  { url: `/console/map-listings?store=${store}`, must: ["地图", "差异"] },
  { url: `/console/geo-sampling?store=${store}`, must: ["定位方式"] },
  { url: `/console/geo-report?store=${store}`, must: ["定位方式", "本报告的边界"] },
];
for (const p of pages) {
  const res = await fetch(`${BASE}${p.url}`, { headers: { cookie } });
  const html = await res.text();
  check(`GET ${p.url.split("?")[0]} 返回 200`, res.status === 200, `HTTP ${res.status}`);
  for (const needle of p.must) {
    check(`  页面含「${needle}」`, html.includes(needle));
  }
}

const reportRes = await fetch(`${BASE}/console/geo-report?store=${store}`, { headers: { cookie } });
const reportHtml = await reportRes.text();
check("报告显示两种定位方式而非合并", reportHtml.includes("真实设备定位") && reportHtml.includes("问题文字"));
check("报告含无排名承诺声明", reportHtml.includes("没有付费捷径"));
check("报告对下降结果也如实显示", reportHtml.includes("如实呈现"));


console.log("\n" + "=".repeat(56));
console.log(`通过 ${pass} 项，失败 ${failed.length} 项`);
if (failed.length > 0) {
  console.log("失败项：" + failed.join("；"));
  process.exit(1);
}
