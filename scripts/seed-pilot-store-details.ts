/**
 * 试点门店资料补全：潍坊市坊子区海鹏菜馆。
 *
 * ⚠️ 真实试点数据，写入 data/geo.db。
 *
 * 来源标注规则（这一版刻意区分两种「依据」）：
 *  - 商家授权提供（运营者本人确认）→ source_kind=self，标为已核验，
 *    因为店主就是自家门店信息的权威来源。
 *  - 建议后续用营业执照升级为 source_kind=official：
 *    注册名称、注册地址与招牌名可能不一致，工商口径才是平台认领时用的口径。
 *
 * 运行：node --experimental-strip-types scripts/seed-pilot-store-details.ts
 */
import { getDb } from "../src/lib/db/index.ts";
import * as L from "../src/lib/db/repo-local.ts";

const VERIFIED_AT = "2026-09-22";
const SRC_TITLE = "商家授权提供（店主确认）";

const db = getDb();
const store = db.prepare("SELECT id FROM stores WHERE name = ? AND city = ?").get("海鹏菜馆", "潍坊市") as
  | { id: string }
  | undefined;
if (!store) {
  console.error("未找到海鹏菜馆，请先运行 scripts/seed-pilot-store.ts");
  process.exit(1);
}
const storeId = store.id;

/* —— 门店主档 —— */
L.updateStore(storeId, {
  district: "坊子区",
  address: "潍坊市坊子区六马路美的亚大厦对面",
  status: "active",
  note:
    "工商主体：潍坊市坊子区海鹏菜馆。店铺招牌名「海鹏菜馆」用于与地图平台比对。" +
    "建议用营业执照把来源升级为 official —— 注册名称/地址与招牌名不一致时，平台认领以工商口径为准。",
});
console.log("✓ 门店主档已更新（坊子区 / 六马路美的亚大厦对面 / 正常营业）");

/* —— 事实：商家授权提供，标为已核验 —— */
const facts: Array<[string, string, string]> = [
  ["name", "海鹏菜馆", "店铺招牌名，用于与地图平台显示名比对"],
  ["address", "潍坊市坊子区六马路美的亚大厦对面", "店内地址；注册地址可能不同，待营业执照核对"],
  ["category", "餐饮/炒菜", "经营类别"],
  ["hours_regular", "每日 09:00-21:30", "店主口述，未说明是否有固定休息日"],
  [
    "status_note",
    "工商主体：潍坊市坊子区海鹏菜馆；招牌名「海鹏菜馆」。电话、菜单、人均价格尚未提供",
    "主体已确认，替代此前「主体待确认」的记录",
  ],
];
for (const [key, value, note] of facts) {
  L.addStoreFact({
    storeId,
    factKey: key,
    value,
    sourceKind: "self",
    sourceTitle: SRC_TITLE,
    verifiedAt: VERIFIED_AT,
    note,
  });
}
console.log(`✓ 事实共 ${L.listStoreFacts(storeId).length} 条，其中已核验 ${L.listStoreFacts(storeId).filter((f) => f.status === "verified").length} 条`);

/* —— 营业时间：每日 09:00-21:30（0=周日 … 6=周六）—— */
L.setStoreHours(
  storeId,
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, closed: false, opens: "09:00", closes: "21:30" })),
);
console.log("✓ 营业时间：每日 09:00-21:30（共 7 天）");

/* —— 测试锚点 —— */
// 店门口：这是唯一一个「在服务半径内」的锚点。
// 没有它，整条链路只能得出「没被推荐」这一个结论，无法区分是 GEO 没做
// 还是位置本身就超出范围。
const anchors: Array<{ name: string; kind: string; note: string }> = [
  {
    name: "店门口（六马路美的亚大厦对面）",
    kind: "landmark",
    note: "距离 0 的正向基准锚点：在此处搜「附近炒菜」预期应出现本店",
  },
  {
    name: "潍坊泰华城",
    kind: "business_district",
    note: "跨区锚点（奎文区），未实测距离；需现场记录设备坐标",
  },
  {
    name: "潍坊万达广场",
    kind: "business_district",
    note: "跨区锚点（奎文区），未实测距离；需现场记录设备坐标",
  },
];

const existingAnchors = new Set(L.listAnchors(storeId).map((a) => a.name));
const anchorIds: Record<string, string> = {};
for (const a of L.listAnchors(storeId)) anchorIds[a.name] = a.id;
for (const a of anchors) {
  if (existingAnchors.has(a.name)) {
    console.log(`  锚点已存在，跳过：${a.name}`);
    continue;
  }
  anchorIds[a.name] = L.createAnchor({ storeId, name: a.name, kind: a.kind, note: a.note });
  console.log(`  锚点已建：${a.name}`);
}

/* —— 地理场景 —— */
const scenarios = [
  {
    anchor: "店门口（六马路美的亚大厦对面）",
    radiusM: 1000,
    daypart: "dinner",
    need: "两人晚餐 / 家庭聚餐",
    expectedNote: "距离 0、主营炒菜、晚餐时段营业（至 21:30）。预期应被推荐 —— 这是正向基准用例。",
  },
  {
    anchor: "潍坊泰华城",
    radiusM: 1000,
    daypart: "dinner",
    need: "附近炒菜馆",
    expectedNote:
      "店在坊子区，本锚点在奎文区，跨区且量级约十公里（未实测），超出一般炒菜馆服务半径。" +
      "按位置逻辑预期不会出现。若出现，说明模型用了非位置依据（品牌词、口碑、菜单内容），需单独判断。",
  },
  {
    anchor: "潍坊万达广场",
    radiusM: 1000,
    daypart: "dinner",
    need: "附近炒菜馆",
    expectedNote:
      "同泰华城：跨区、量级约十公里（未实测），预期不出现。这个用例的价值是验证" +
      "「模型会不会把远处的高分店推给附近的人」——推了就是位置相关性不足。",
  },
];

const existingScenarios = L.listScenarios(storeId).length;
if (existingScenarios > 0) {
  console.log(`  已有 ${existingScenarios} 个场景，跳过创建`);
} else {
  for (const sc of scenarios) {
    L.createScenario({
      storeId,
      anchorId: anchorIds[sc.anchor] ?? null,
      radiusM: sc.radiusM,
      daypart: sc.daypart,
      need: sc.need,
      expectedNote: sc.expectedNote,
    });
    console.log(`  场景已建：${sc.anchor} · ${sc.radiusM}m · ${sc.daypart}`);
  }
}

const r = L.storeReadiness(storeId);
console.log("\n门店就绪度：");
console.log(
  `  事实 ${r.factsVerified}/${r.factsTotal} 已核验 | 地图资料 ${r.claimed}/${r.listings} 已认领 | 锚点 ${r.anchors} | 场景 ${r.scenarios}`,
);
console.log("  待办：" + (r.blockers.length ? r.blockers.join("；") : "无"));
console.log(`\n门店 ID：${storeId}`);
console.log(`营业时间文本（用于和平台比对）：${L.hoursToText(L.listStoreHours(storeId))}`);
