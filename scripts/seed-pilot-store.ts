/**
 * 试点门店建档：潍坊市 · 餐饮炒菜 · 海鹏菜馆。
 *
 * ⚠️ 这是**真实试点数据**，写入 data/geo.db（不是测试夹具）。
 *
 * 录入原则：只写有来源的信息。
 *  - 运营者口述（店名/城市/品类）→ source_kind=self，且**不自动核验**，
 *    状态留在 draft，等营业执照或门店照核对后才算「有依据」。
 *  - 公开渠道只确认了「存在同名主体」这件事，地址/电话/营业时间一律不猜。
 *
 * 运行：node --experimental-strip-types scripts/seed-pilot-store.ts
 */
import { getDb } from "../src/lib/db/index.ts";
import * as L from "../src/lib/db/repo-local.ts";
import * as R from "../src/lib/db/repo-domains.ts";

const NAME = "海鹏菜馆";
const CITY = "潍坊市";
const CATEGORY = "餐饮/炒菜";

// 公开渠道查到的主体检索结果（仅用于记录「主体待确认」这一事实）
const TIANYANCHA_FANGZI = "https://www.tianyancha.com/company/2339836868";
const TRIP_WEIFANG = "https://hk.trip.com/restaurant/china/weifang/detail/hai-peng-cai-guan-26013987/";

const db = getDb();
const existing = db.prepare("SELECT id FROM stores WHERE name = ? AND city = ?").get(NAME, CITY) as
  | { id: string }
  | undefined;
if (existing) {
  console.log(`已存在同名门店，跳过建档：${existing.id}`);
  process.exit(0);
}

const storeId = L.createStore({
  name: NAME,
  city: CITY,
  category: CATEGORY,
  status: "unverified",
});
L.updateStore(storeId, {
  note:
    "主体待确认：公开渠道存在同名主体（潍坊市坊子区海鹏菜馆 / 临朐县海鹏食府 / 潍城区军埠口海鹏渔馆）。" +
    "需营业执照确认唯一主体后再填地址与电话。",
});
console.log(`✓ 门店建档 ${storeId}`);

/* —— 事实：全部留在「待核验」，来源写清楚 —— */
const selfNote = "运营者口述，待用营业执照/门店照核验";
for (const [key, value, src, note] of [
  ["name", NAME, "self", selfNote],
  ["category", CATEGORY, "self", selfNote],
] as const) {
  L.addStoreFact({ storeId, factKey: key, value, sourceKind: src, sourceTitle: "运营者口述", note });
}
L.addStoreFact({
  storeId,
  factKey: "status_note",
  value: "主体待确认（存在同名主体），地址与电话尚未取得可引用来源",
  sourceKind: "third_party",
  sourceUrl: TIANYANCHA_FANGZI,
  sourceTitle: "天眼查：潍坊市坊子区海鹏菜馆",
  note: `另一来源：${TRIP_WEIFANG}`,
});
console.log(`✓ 事实 ${L.listStoreFacts(storeId).length} 条（均为待核验）`);

/* —— 地图资料：登记待核对，不猜 POI ID —— */
for (const [platform, note] of [
  ["amap", "潍坊本地主要地图入口，待核对是否存在 POI 及认领状态"],
  ["baidu_map", "待核对是否存在 POI 及认领状态"],
  ["google_business_profile", "境外入口，国内餐饮通常无 POI；待核对"],
] as const) {
  L.upsertMapListing({ storeId, platform, claimStatus: "unknown", note });
}
console.log(`✓ 地图资料 ${L.listMapListings(storeId).length} 条（均未认领/未知）`);

/* —— 位置化问题集：这是我们的测试设计，不是关于这家店的事实 —— */
const brandId = (db.prepare("SELECT id FROM brands WHERE name = ?").get("Pailian Aluminium") as
  | { id: string }
  | undefined)?.id;
const qsId = R.createQuerySet(`潍坊炒菜 · 位置化问题集`, brandId ?? null);
R.addQuestions(qsId, [
  "潍坊市奎文区附近有什么好吃的炒菜馆？",
  "潍坊市潍城区哪家炒菜馆适合家庭聚餐？",
  "潍坊火车站附近有推荐的炒菜馆吗？",
  "潍坊有什么地道的鲁菜炒菜馆？",
  "潍坊市坊子区附近炒菜馆推荐哪家？",
  "潍坊两个人吃炒菜，人均 60 左右去哪家？",
  "潍坊适合请客吃饭的炒菜馆有哪些？",
  "潍坊哪家炒菜馆营业到晚上九点以后？",
  "潍坊本地人常去的炒菜馆是哪几家？",
  "潍坊市寒亭区附近有什么口碑好的炒菜馆？",
]);
R.freezeQuerySet(qsId);
console.log(`✓ 位置化问题集 ${qsId}（10 条，已冻结）`);

const readiness = L.storeReadiness(storeId);
console.log("\n门店就绪度：");
console.log(`  事实 ${readiness.factsVerified}/${readiness.factsTotal} 已核验 | 地图资料 ${readiness.claimed}/${readiness.listings} 已认领 | 锚点 ${readiness.anchors} | 场景 ${readiness.scenarios}`);
console.log("  待办：" + (readiness.blockers.length ? readiness.blockers.join("；") : "无"));
console.log(`\n门店 ID：${storeId}`);
console.log(`问题集 ID：${qsId}`);
