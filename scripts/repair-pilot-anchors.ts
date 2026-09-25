/**
 * 修复试点库缺失的锚点。
 *
 * 背景：2026-09-22 建档时创建了 3 个锚点（审计有 create 记录），
 * 但其中 2 个（潍坊泰华城、潍坊万达广场）后来从表里消失了，
 * **审计里没有任何删除记录**，原因无法从现有数据确定。
 * 因为 geo_scenarios.anchor_id 是 ON DELETE SET NULL，
 * 对应的 2 个场景的 anchor_id 被置空 —— 页面上显示成「（无锚点）」。
 *
 * 修复方式：用**原来的 id** 重建这两行，让审计里的 create 记录重新指向真实数据，
 * 再把两个场景的 anchor_id 接回去。整体幂等，可重复执行。
 *
 * 用法：node --experimental-strip-types scripts/repair-pilot-anchors.ts
 */
import { getDb, workspaceId } from "../src/lib/db/index.ts";

const STORE_ID = "store_358298a5174846a093e79216";

const ANCHORS = [
  {
    id: "anchor_50abc5acb1cf492490eeeb28",
    name: "潍坊泰华城",
    kind: "business_district",
    note: "跨区锚点（奎文区），未实测距离；需现场记录设备坐标",
  },
  {
    id: "anchor_a9a18a2aa26c4fd690a48db7",
    name: "潍坊万达广场",
    kind: "business_district",
    note: "跨区锚点（奎文区），未实测距离；需现场记录设备坐标",
  },
] as const;

/** 场景 → 应绑定的锚点（按场景的 expected_note 判断归属） */
const SCENARIO_LINKS = [
  { scenarioId: "gscen_461014221a5b41a4a428b39a", anchorId: "anchor_50abc5acb1cf492490eeeb28", why: "expected_note 描述坊子区↔奎文区跨区" },
  { scenarioId: "gscen_b4d30a225b7e47999804a74c", anchorId: "anchor_a9a18a2aa26c4fd690a48db7", why: "expected_note 写着「同泰华城」" },
] as const;

const db = getDb();
const t = new Date().toISOString();
let created = 0;
let linked = 0;

for (const a of ANCHORS) {
  const existing = db.prepare("SELECT id FROM geo_anchors WHERE id = ?").get(a.id);
  if (existing) {
    console.log(`  锚点已存在，跳过：${a.name}`);
    continue;
  }
  db.prepare(
    `INSERT INTO geo_anchors (id, workspace_id, store_id, name, kind, lat, lng, address, note, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(a.id, workspaceId(), STORE_ID, a.name, a.kind, a.note, t);
  db.prepare(
    "INSERT INTO change_logs (id, workspace_id, actor, action, entity, entity_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    `cl_repair_${a.id.slice(-8)}`,
    workspaceId(),
    "operator",
    "restore",
    "geo_anchor",
    a.id,
    JSON.stringify({ name: a.name, reason: "试点库缺失锚点修复：审计无删除记录，按原 id 重建" }),
    t,
  );
  console.log(`  已重建锚点：${a.name}（${a.id}）`);
  created++;
}

for (const link of SCENARIO_LINKS) {
  const row = db.prepare("SELECT id, anchor_id FROM geo_scenarios WHERE id = ?").get(link.scenarioId) as
    | { id: string; anchor_id: string | null }
    | undefined;
  if (!row) {
    console.log(`  ⚠️ 找不到场景 ${link.scenarioId}，跳过`);
    continue;
  }
  if (row.anchor_id === link.anchorId) {
    console.log(`  场景已绑定，跳过：${link.scenarioId}`);
    continue;
  }
  db.prepare("UPDATE geo_scenarios SET anchor_id = ? WHERE id = ?").run(link.anchorId, link.scenarioId);
  db.prepare(
    "INSERT INTO change_logs (id, workspace_id, actor, action, entity, entity_id, detail_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    `cl_relink_${link.scenarioId.slice(-8)}`,
    workspaceId(),
    "operator",
    "relink",
    "geo_scenario",
    link.scenarioId,
    JSON.stringify({ anchorId: link.anchorId, reason: link.why }),
    t,
  );
  console.log(`  已重新绑定场景 ${link.scenarioId} → ${link.anchorId}（${link.why}）`);
  linked++;
}

console.log(`\n修复完成：重建锚点 ${created} 个，重新绑定场景 ${linked} 个`);

const anchors = db.prepare("SELECT name FROM geo_anchors WHERE store_id = ? ORDER BY created_at").all(STORE_ID) as Array<{ name: string }>;
console.log(`当前锚点（${anchors.length} 个）：${anchors.map((a) => a.name).join("、")}`);
const orphan = db.prepare("SELECT COUNT(*) AS n FROM geo_scenarios WHERE store_id = ? AND anchor_id IS NULL").get(STORE_ID) as { n: number };
console.log(`未绑定锚点的场景：${orphan.n} 个`);
if (orphan.n > 0) {
  console.error("仍有场景没有锚点，请人工确认归属");
  process.exit(1);
}
