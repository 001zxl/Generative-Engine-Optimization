"use server";

import { revalidatePath } from "next/cache";
import * as L from "@/lib/db/repo-local";

const s = (fd: FormData, k: string): string => String(fd.get(k) ?? "").trim();
const opt = (fd: FormData, k: string): string | undefined => s(fd, k) || undefined;
const num = (fd: FormData, k: string): number | undefined => {
  const v = s(fd, k);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const PATHS = [
  "/console/stores",
  "/console/map-listings",
  "/console/geo-sampling",
  "/console/geo-report",
  "/console",
];
function refresh() {
  for (const p of PATHS) revalidatePath(p);
}

/* ---------------- 门店档案 ---------------- */

export async function storeCreate(fd: FormData) {
  const name = s(fd, "name");
  if (!name) return;
  L.createStore({
    name,
    code: opt(fd, "code"),
    address: opt(fd, "address"),
    city: opt(fd, "city"),
    district: opt(fd, "district"),
    lat: num(fd, "lat"),
    lng: num(fd, "lng"),
    category: opt(fd, "category"),
    status: opt(fd, "status"),
    serviceRadiusKm: num(fd, "serviceRadiusKm"),
  });
  refresh();
}

export async function storeUpdate(fd: FormData) {
  const id = s(fd, "id");
  if (!id) return;
  L.updateStore(id, {
    name: s(fd, "name") || undefined,
    code: opt(fd, "code"),
    address: opt(fd, "address"),
    city: opt(fd, "city"),
    district: opt(fd, "district"),
    lat: num(fd, "lat"),
    lng: num(fd, "lng"),
    category: opt(fd, "category"),
    status: s(fd, "status") || undefined,
    service_radius_km: num(fd, "serviceRadiusKm"),
  } as never);
  refresh();
}

export async function storeDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) L.deleteStore(id);
  refresh();
}

export async function hoursSave(fd: FormData) {
  const storeId = s(fd, "storeId");
  if (!storeId) return;
  const rows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    closed: s(fd, `closed_${weekday}`) === "on",
    opens: s(fd, `opens_${weekday}`),
    closes: s(fd, `closes_${weekday}`),
  }));
  L.setStoreHours(storeId, rows);
  refresh();
}

/* ---------------- 门店事实 ---------------- */

export async function factAdd(fd: FormData) {
  const storeId = s(fd, "storeId");
  const factKey = s(fd, "factKey");
  const value = s(fd, "value");
  if (!storeId || !factKey || !value) return;
  L.addStoreFact({
    storeId,
    factKey,
    value,
    sourceKind: opt(fd, "sourceKind"),
    sourceUrl: opt(fd, "sourceUrl"),
    sourceTitle: opt(fd, "sourceTitle"),
    verifiedAt: opt(fd, "verifiedAt"),
    validUntil: opt(fd, "validUntil"),
    note: opt(fd, "note"),
  });
  refresh();
}

export async function factVerify(fd: FormData) {
  const id = s(fd, "id");
  if (!id) return;
  L.verifyStoreFact(id, opt(fd, "sourceUrl"), opt(fd, "verifiedAt"));
  refresh();
}

export async function factStatus(fd: FormData) {
  const id = s(fd, "id");
  const status = s(fd, "status");
  if (id && status) L.setStoreFactStatus(id, status);
  refresh();
}

export async function factDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) L.deleteStoreFact(id);
  refresh();
}

/* ---------------- 地图资料 ---------------- */

export async function listingUpsert(fd: FormData) {
  const storeId = s(fd, "storeId");
  const platform = s(fd, "platform");
  if (!storeId || !platform) return;
  L.upsertMapListing({
    storeId,
    platform,
    poiId: opt(fd, "poiId"),
    listingUrl: opt(fd, "listingUrl"),
    claimStatus: opt(fd, "claimStatus"),
    queryMethod: opt(fd, "queryMethod"),
    note: opt(fd, "note"),
  });
  refresh();
}

/** 保存一次授权查询的观测快照 —— 只读记录，不写回第三方平台 */
export async function listingSnapshot(fd: FormData) {
  const listingId = s(fd, "listingId");
  if (!listingId) return;
  L.saveListingSnapshot({
    listingId,
    snapshot: {
      name: s(fd, "name"),
      address: s(fd, "address"),
      phone: s(fd, "phone"),
      hours: s(fd, "hours"),
      category: s(fd, "category"),
    },
    snapshotAt: opt(fd, "snapshotAt"),
  });
  refresh();
}

export async function diffResolve(fd: FormData) {
  const id = s(fd, "id");
  const status = s(fd, "status");
  if (!id || !status) return;
  L.resolveMapDiff(id, status, s(fd, "note"));
  refresh();
}

/* ---------------- 锚点与场景 ---------------- */

export async function anchorCreate(fd: FormData) {
  const storeId = s(fd, "storeId");
  const name = s(fd, "name");
  if (!storeId || !name) return;
  L.createAnchor({
    storeId,
    name,
    kind: opt(fd, "kind"),
    lat: num(fd, "lat"),
    lng: num(fd, "lng"),
    address: opt(fd, "address"),
    note: opt(fd, "note"),
  });
  refresh();
}

export async function anchorDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) L.deleteAnchor(id);
  refresh();
}

export async function scenarioCreate(fd: FormData) {
  const storeId = s(fd, "storeId");
  if (!storeId) return;
  L.createScenario({
    storeId,
    anchorId: opt(fd, "anchorId") ?? null,
    radiusM: num(fd, "radiusM"),
    daypart: opt(fd, "daypart"),
    need: opt(fd, "need"),
    expectedNote: opt(fd, "expectedNote"),
  });
  refresh();
}

export async function scenarioDelete(fd: FormData) {
  const id = s(fd, "id");
  if (id) L.deleteScenario(id);
  refresh();
}
