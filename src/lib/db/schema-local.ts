/**
 * 本地门店 GEO 的数据表（门店 / 地图资料 / 地理测试）。
 *
 * ── 四条设计约束（对应业务方的验收要求，写进代码而不是只写在文档里）──
 *
 * 1. **两种"定位"必须分开标记。**
 *    把地点写进问题文字（`question_text_only`）与在真实设备定位下提问
 *    （`device_location`）是**两种不同的采样方式**，结果不可合并统计。
 *    用前者冒充后者，等于把"AI 知道这个城市"谎报成"AI 在地铁口推荐了我们"。
 *    因此 `sampling_runs` 与 `response_samples` 都带 `location_mode`，
 *    指标按它分组，界面上也分开展示。
 *
 * 2. **不擅自修改第三方地图资料。**
 *    `map_listings` 只保存通过授权查询拿到的快照与认领状态；
 *    `map_listing_diffs` 记录差异与**人工处理结果**。
 *    代码里不存在任何写回第三方平台的路径。
 *
 * 3. **每条公开商家信息都要有依据。**
 *    `store_facts` 的每一条都强制绑定 `source_url` 与 `verified_at`；
 *    未核验的事实不允许进入对外内容（由发布环节校验）。
 *
 * 4. **门店状态与营业时间是一等信息。**
 *    错店、错位置、已打烊是本地推荐最常见的三类错误，
 *    所以营业时间单独成表、门店状态单独成字段，都要能被核验与过期提醒。
 */

export const STORE_STATUS = [
  { value: "active", label: "正常营业" },
  { value: "temporarily_closed", label: "暂停营业" },
  { value: "permanently_closed", label: "已关闭" },
  { value: "moved", label: "已迁址" },
  { value: "unverified", label: "待核实" },
] as const;

/**
 * 定位方式：**这是本模块最不能含糊的字段**。
 * 两者不可合并统计，报告中必须分开呈现。
 */
export const LOCATION_MODES = [
  {
    value: "device_location",
    label: "真实设备定位",
    hint: "在锚点实际位置用设备定位提问 —— 唯一能反映「附近推荐」的方式",
  },
  {
    value: "question_text_only",
    label: "仅问题文字含地点",
    hint: "地点写在问题里（如「上海人民广场附近的火锅」），未使用真实定位 —— 结果不等价，不能当作附近推荐",
  },
  {
    value: "unspecified",
    label: "未标注",
    hint: "历史数据或无法确认；不参与「附近推荐」相关结论",
  },
] as const;

export type LocationMode = (typeof LOCATION_MODES)[number]["value"];

export const MAP_PLATFORMS = [
  "google_business_profile",
  "apple_business_connect",
  "bing_places",
  "amap",
  "baidu_map",
  "tencent_map",
  "other",
] as const;

export const CLAIM_STATUS = [
  { value: "claimed_by_us", label: "已认领（我方）" },
  { value: "claimed_by_other", label: "已被他人认领" },
  { value: "unclaimed", label: "未认领" },
  { value: "unknown", label: "未知" },
] as const;

export const FACT_STATUS = [
  { value: "draft", label: "待核验" },
  { value: "verified", label: "已核验" },
  { value: "expired", label: "已过期" },
  { value: "disputed", label: "有争议" },
] as const;

/** 门店事实的键（白名单，避免键名漂移导致比对失效） */
export const STORE_FACT_KEYS = [
  { key: "name", label: "店名" },
  { key: "address", label: "地址" },
  { key: "phone", label: "电话" },
  { key: "category", label: "经营类别" },
  { key: "hours_regular", label: "常规营业时间" },
  { key: "hours_holiday", label: "节假日营业时间" },
  { key: "service_radius", label: "服务范围" },
  { key: "menu_summary", label: "菜单摘要" },
  { key: "price_range", label: "人均价格" },
  { key: "parking", label: "停车" },
  { key: "accessibility", label: "无障碍" },
  { key: "status_note", label: "状态说明" },
] as const;

export const ANCHOR_KINDS = [
  { value: "subway_exit", label: "地铁口" },
  { value: "business_district", label: "商圈" },
  { value: "residential", label: "住宅区" },
  { value: "office", label: "办公区" },
  { value: "landmark", label: "地标" },
  { value: "competitor_area", label: "竞品门店周边" },
] as const;

export const DAYPARTS = [
  { value: "breakfast", label: "早餐" },
  { value: "lunch", label: "午餐" },
  { value: "afternoon", label: "下午" },
  { value: "dinner", label: "晚餐" },
  { value: "late_night", label: "夜宵" },
  { value: "any", label: "不限时段" },
] as const;

export const LOCAL_SQL = /* sql */ `
-- ========== 门店 ==========
CREATE TABLE IF NOT EXISTS stores (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id      TEXT REFERENCES brands(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,                      -- 内部编号，便于多门店管理
  address       TEXT,
  city          TEXT,
  district      TEXT,
  lat           REAL,
  lng           REAL,
  category      TEXT,
  status        TEXT NOT NULL DEFAULT 'unverified', -- 见 STORE_STATUS
  service_radius_km REAL,
  timezone      TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stores_brand ON stores(brand_id);
CREATE INDEX IF NOT EXISTS idx_stores_city ON stores(city);

-- ========== 营业时间（周表）—— 打烊时间是本地推荐最常见的错误之一 ==========
CREATE TABLE IF NOT EXISTS store_hours (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  weekday    INTEGER NOT NULL,             -- 0=周日 … 6=周六
  closed     INTEGER NOT NULL DEFAULT 0,
  opens      TEXT,                         -- HH:MM
  closes     TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_hours_store ON store_hours(store_id);

-- ========== 门店事实：每条强制绑定来源与核验日期 ==========
CREATE TABLE IF NOT EXISTS store_facts (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_id     TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  fact_key     TEXT NOT NULL,              -- 见 STORE_FACT_KEYS
  value        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'draft', -- 见 FACT_STATUS
  source_kind  TEXT NOT NULL DEFAULT 'self',  -- third_party|official|audited|self
  source_url   TEXT,                       -- 必须可点击复核
  source_title TEXT,
  verified_at  TEXT,                       -- 核验日期；未核验不得进对外内容
  valid_until  TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_store_facts_store ON store_facts(store_id);
CREATE INDEX IF NOT EXISTS idx_store_facts_key ON store_facts(store_id, fact_key);

-- ========== 地图资料（只读快照 + 认领状态；代码中无写回第三方路径）==========
CREATE TABLE IF NOT EXISTS map_listings (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,             -- 见 MAP_PLATFORMS
  poi_id        TEXT,                      -- 平台侧 POI 标识，用于确认"对的是同一家店"
  listing_url   TEXT,
  claim_status  TEXT NOT NULL DEFAULT 'unknown', -- 见 CLAIM_STATUS
  -- 授权查询拿到的快照
  seen_name     TEXT,
  seen_address  TEXT,
  seen_phone    TEXT,
  seen_hours    TEXT,
  seen_category TEXT,
  snapshot_at   TEXT,
  query_method  TEXT NOT NULL DEFAULT 'authorized_lookup', -- authorized_lookup|manual_view
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_listings_store ON map_listings(store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_map_listings_uniq ON map_listings(store_id, platform);

-- ========== 资料差异待办（人工处理的记录载体）==========
CREATE TABLE IF NOT EXISTS map_listing_diffs (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  listing_id    TEXT NOT NULL REFERENCES map_listings(id) ON DELETE CASCADE,
  field         TEXT NOT NULL,             -- name|address|phone|hours|category
  expected_value TEXT,                     -- 以门店事实为准
  seen_value    TEXT,                      -- 平台上实际看到的
  severity      TEXT NOT NULL DEFAULT 'warn', -- block|warn|info
  status        TEXT NOT NULL DEFAULT 'open', -- open|in_progress|resolved|accepted
  resolution_note TEXT,                    -- 怎么处理的（人工修正/已申诉/接受差异）
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_diffs_listing ON map_listing_diffs(listing_id);
CREATE INDEX IF NOT EXISTS idx_map_diffs_status ON map_listing_diffs(status);

-- ========== 测试锚点（地铁口/商圈等公开位置）==========
CREATE TABLE IF NOT EXISTS geo_anchors (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_id     TEXT REFERENCES stores(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'landmark', -- 见 ANCHOR_KINDS
  lat          REAL,
  lng          REAL,
  address      TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_anchors_store ON geo_anchors(store_id);

-- ========== 地理测试场景（锚点 + 半径 + 时段 + 需求 + 竞品）==========
CREATE TABLE IF NOT EXISTS geo_scenarios (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  store_id          TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  anchor_id         TEXT REFERENCES geo_anchors(id) ON DELETE SET NULL,
  radius_m          INTEGER NOT NULL DEFAULT 1000,
  daypart           TEXT NOT NULL DEFAULT 'any',  -- 见 DAYPARTS
  need              TEXT,                          -- 需求描述，如"商务宴请"
  competitor_store_ids TEXT NOT NULL DEFAULT '[]', -- JSON 数组：附近的竞品门店
  expected_note     TEXT,                          -- 为什么预期 A 应该在这里被推荐
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_geo_scenarios_store ON geo_scenarios(store_id);
`;

/**
 * 列迁移：把门店维度挂到既有的问题 / 事实 / 采样 / 指标 / 内容上。
 *
 * 加列而不是建新表，是为了让"同一个问题库/同一套采样/同一套评估"
 * 既能服务品牌级 GEO，也能服务门店级本地 GEO —— 避免两套并行实现。
 */
export const LOCAL_COLUMN_MIGRATIONS = [
  { table: "questions", column: "store_id", ddl: "store_id TEXT", note: "问题可归属到具体门店" },
  { table: "questions", column: "geo_scenario_id", ddl: "geo_scenario_id TEXT", note: "问题可归属到地理测试场景" },
  { table: "claims", column: "store_id", ddl: "store_id TEXT", note: "品牌事实可按门店细化" },
  { table: "sampling_runs", column: "store_id", ddl: "store_id TEXT", note: "采样批次归属到具体门店，门店级报告与对比都依赖它" },
  {
    table: "sampling_runs",
    column: "location_mode",
    ddl: "location_mode TEXT NOT NULL DEFAULT 'unspecified'",
    note: "定位方式：真实设备定位 vs 仅问题文字含地点 —— 两者不可合并统计",
  },
  { table: "sampling_runs", column: "anchor_id", ddl: "anchor_id TEXT", note: "真实设备定位时的测试锚点" },
  { table: "sampling_runs", column: "daypart", ddl: "daypart TEXT", note: "采样时段（早/午/晚），时段会影响推荐" },
  {
    table: "response_samples",
    column: "location_mode",
    ddl: "location_mode TEXT NOT NULL DEFAULT 'unspecified'",
    note: "样本级定位方式，随批次写入后不可变",
  },
  { table: "response_samples", column: "anchor_id", ddl: "anchor_id TEXT", note: "样本对应的测试锚点" },
  { table: "response_samples", column: "share_url", ddl: "share_url TEXT", note: "平台分享链接（可复核的原始凭证）" },
  { table: "response_samples", column: "screenshot_path", ddl: "screenshot_path TEXT", note: "截图路径（可复核的原始凭证）" },
  { table: "metric_snapshots", column: "store_id", ddl: "store_id TEXT", note: "指标快照按门店切分，避免多家门店之间混算" },
  { table: "content_assets", column: "store_id", ddl: "store_id TEXT", note: "门店页内容归属门店" },
  {
    table: "leads",
    column: "store_id",
    ddl: "store_id TEXT",
    note: "线索归属门店：门店级报告要能回答「这条线索是哪家店带来的」",
  },
] as const;
