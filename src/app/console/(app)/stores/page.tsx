import Link from "next/link";
import { IconBuildingStore, IconPlus, IconAlertTriangle, IconCircleCheck, IconMapPin } from "@tabler/icons-react";
import * as L from "@/lib/db/repo-local";
import { summarizeFreshness, checkFactFreshness } from "@/lib/local-geo";
import { STORE_STATUS, STORE_FACT_KEYS, FACT_STATUS } from "@/lib/db/schema-local";
import { PageHead, SectionCard, Field, InlineForm, DangerForm, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { factAdd, factDelete, factStatus, factVerify, hoursSave, storeCreate, storeDelete, storeUpdate } from "../local-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "门店档案", robots: { index: false, follow: false } };

const SEL = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none";
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * 模块 A：门店档案。
 *
 * 一条硬规则贯穿本页：**每条事实都必须有来源和核验日期**，
 * 没有核验日期的事实状态是「待核验」，不允许进入对外内容。
 * 目的很实际 —— 防止 AI 或用户被导向错店、错位置、已打烊的门店。
 */
export default async function StoresPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeParam } = await searchParams;
  const stores = L.listStores();
  const selected = storeParam ? stores.find((s) => s.id === storeParam) : stores[0];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconBuildingStore}
        title="门店档案"
        description="一个商家可以有多家门店。每条事实（地址、电话、营业时间、菜单…）都必须绑定来源与核验日期 —— 没有核验日期的事实不得进入对外内容。"
        badge={<Badge variant="outline" className="font-normal">{stores.length} 家门店</Badge>}
      />

      {stores.length === 0 && (
        <EmptyState>
          还没有门店档案。
          <br />
          <span className="text-xs">先按试点要求录入 1 家门店（1 个城市、1 个行业）。</span>
        </EmptyState>
      )}

      {/* —— 门店列表 —— */}
      {stores.length > 0 && (
        <SectionCard title="门店列表" description="点门店名切换下方详情。「资料缺口」是该店当前必须补齐的项。">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>门店</TableHead>
                  <TableHead className="w-40">城市 / 类别</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-20 text-right">事实</TableHead>
                  <TableHead className="w-20 text-right">平台</TableHead>
                  <TableHead className="w-24 text-right">待办差异</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stores.map((s) => {
                  const ready = L.storeReadiness(s.id);
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/console/stores?store=${s.id}`} className="font-medium underline-offset-4 hover:underline">
                          {s.name}
                        </Link>
                        {s.code && <div className="font-mono text-xs text-muted-foreground">{s.code}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.city ?? "—"} / {s.category ?? "—"}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={s.status === "active" ? "active" : "draft"} />
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {STORE_STATUS.find((x) => x.value === s.status)?.label ?? s.status}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ready.factsVerified}/{ready.factsTotal}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{ready.listings}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ready.openDiffs > 0 ? <span className="text-warn">{ready.openDiffs}</span> : "0"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      )}

      {/* —— 门店详情 —— */}
      {selected && <StoreDetail storeId={selected.id} />}

      {/* —— 新建门店 —— */}
      <SectionCard title="新增门店" description="按试点要求先只建 1 家，跑通后再扩。">
        <form action={storeCreate} className="grid gap-3 sm:grid-cols-3">
          <Field label="门店名称" htmlFor="ns-name">
            <Input id="ns-name" name="name" placeholder="示例：某火锅 人民广场店" required />
          </Field>
          <Field label="内部编号" htmlFor="ns-code">
            <Input id="ns-code" name="code" placeholder="SH-001" />
          </Field>
          <Field label="城市" htmlFor="ns-city">
            <Input id="ns-city" name="city" placeholder="上海" />
          </Field>
          <Field label="区/县" htmlFor="ns-district">
            <Input id="ns-district" name="district" placeholder="黄浦区" />
          </Field>
          <Field label="详细地址" htmlFor="ns-addr">
            <Input id="ns-addr" name="address" placeholder="南京东路 100 号" />
          </Field>
          <Field label="经营类别" htmlFor="ns-cat">
            <Input id="ns-cat" name="category" placeholder="火锅 / 川菜" />
          </Field>
          <Field label="纬度" htmlFor="ns-lat">
            <Input id="ns-lat" name="lat" placeholder="31.2304" />
          </Field>
          <Field label="经度" htmlFor="ns-lng">
            <Input id="ns-lng" name="lng" placeholder="121.4737" />
          </Field>
          <Field label="服务范围（公里）" htmlFor="ns-radius">
            <Input id="ns-radius" name="serviceRadiusKm" placeholder="3" />
          </Field>
          <Field label="门店状态" htmlFor="ns-status">
            <select id="ns-status" name="status" className={SEL} defaultValue="unverified">
              {STORE_STATUS.map((x) => (
                <option key={x.value} value={x.value}>{x.label}</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              创建门店
            </Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}

/* ===================================================================== */

function StoreDetail({ storeId }: { storeId: string }) {
  const store = L.getStore(storeId);
  if (!store) return null;

  const facts = L.listStoreFacts(storeId);
  const hours = L.listStoreHours(storeId);
  const hoursByDay = new Map(hours.map((h) => [h.weekday, h]));
  const freshness = summarizeFreshness(facts);
  const readiness = L.storeReadiness(storeId);

  return (
    <>
      <SectionCard
        title={`门店详情 · ${store.name}`}
        description="地址与坐标是「位置化问题库」的基础；门店状态与营业时间决定 AI 是否应该推荐这家店。"
        action={<Link href={`/console/map-listings?store=${storeId}`} className="text-xs text-primary underline-offset-4 hover:underline">去核对地图资料 →</Link>}
      >
        <form action={storeUpdate} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="id" value={store.id} />
          <Field label="门店名称"><Input name="name" defaultValue={store.name} /></Field>
          <Field label="内部编号"><Input name="code" defaultValue={store.code ?? ""} /></Field>
          <Field label="城市"><Input name="city" defaultValue={store.city ?? ""} /></Field>
          <Field label="区/县"><Input name="district" defaultValue={store.district ?? ""} /></Field>
          <Field label="详细地址"><Input name="address" defaultValue={store.address ?? ""} /></Field>
          <Field label="经营类别"><Input name="category" defaultValue={store.category ?? ""} /></Field>
          <Field label="纬度"><Input name="lat" defaultValue={store.lat ?? ""} /></Field>
          <Field label="经度"><Input name="lng" defaultValue={store.lng ?? ""} /></Field>
          <Field label="服务范围（公里）"><Input name="serviceRadiusKm" defaultValue={store.service_radius_km ?? ""} /></Field>
          <Field label="门店状态">
            <select name="status" className={SEL} defaultValue={store.status}>
              {STORE_STATUS.map((x) => (
                <option key={x.value} value={x.value}>{x.label}</option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-3 flex items-center gap-3">
            <Button type="submit" size="sm" variant="outline">保存门店信息</Button>
            <DangerForm action={storeDelete} hidden={{ id: store.id }} label="删除该门店" />
          </div>
        </form>
      </SectionCard>

      {/* —— 就绪度 —— */}
      {readiness.blockers.length > 0 ? (
        <Alert className="border-warn/30 bg-warn-soft">
          <IconAlertTriangle className="size-4 text-warn" />
          <AlertTitle>还不能开始位置采样：还有 {readiness.blockers.length} 项未就绪</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-4">
              {readiness.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCircleCheck className="size-4 text-ok" />
          门店资料已就绪，可以进入地图核对与位置采样。
        </div>
      )}

      {/* —— 营业时间 —— */}
      <SectionCard
        title="营业时间"
        description="打烊时段被推荐到店是最常见的本地错误之一。这里的时间会与地图平台资料自动比对。"
      >
        <form action={hoursSave} className="flex flex-col gap-2">
          <input type="hidden" name="storeId" value={store.id} />
          {[0, 1, 2, 3, 4, 5, 6].map((d) => {
            const h = hoursByDay.get(d);
            return (
              <div key={d} className="flex flex-wrap items-center gap-3">
                <span className="w-10 text-sm">{WEEKDAYS[d]}</span>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" name={`closed_${d}`} defaultChecked={h?.closed === 1} />
                  休息
                </label>
                <Input name={`opens_${d}`} defaultValue={h?.opens ?? ""} placeholder="09:00" className="h-8 w-24" />
                <span className="text-muted-foreground">—</span>
                <Input name={`closes_${d}`} defaultValue={h?.closes ?? ""} placeholder="21:00" className="h-8 w-24" />
              </div>
            );
          })}
          <div>
            <Button type="submit" size="sm" variant="outline">保存营业时间</Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 事实清单 —— */}
      <SectionCard
        title={`门店事实（${facts.length}）`}
        description="每条都必须有来源与核验日期。未核验或过期的事实会阻止发布，并在下方标出。"
        action={
          <span className="text-xs text-muted-foreground">
            已核验 {freshness.ok} · 待复核 {freshness.stale} · 过期 {freshness.expired} · 未核验 {freshness.unverified}
          </span>
        }
      >
        {freshness.blocking.length > 0 && (
          <Alert className="mb-3 border-warn/30 bg-warn-soft">
            <IconAlertTriangle className="size-4 text-warn" />
            <AlertTitle>以下事实不可用于对外内容</AlertTitle>
            <AlertDescription className="font-mono text-xs">{freshness.blocking.join(", ")}</AlertDescription>
          </Alert>
        )}

        {facts.length === 0 ? (
          <EmptyState>还没有事实条目。</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {facts.map((f) => {
              const fr = checkFactFreshness(f);
              const label = STORE_FACT_KEYS.find((k) => k.key === f.fact_key)?.label ?? f.fact_key;
              return (
                <div key={f.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{f.fact_key}</span>
                    <Badge
                      variant="outline"
                      className={
                        fr.state === "ok"
                          ? "border-ok/25 bg-ok-soft font-normal text-ok"
                          : fr.state === "unverified" || fr.state === "expired"
                            ? "border-fail/25 bg-fail-soft font-normal text-fail"
                            : "border-warn/25 bg-warn-soft font-normal text-warn"
                      }
                    >
                      {FACT_STATUS.find((x) => x.value === f.status)?.label ?? f.status}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{fr.reason}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{f.value}</p>
                  {f.source_url && (
                    <a
                      href={f.source_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1 block text-xs text-primary underline-offset-4 hover:underline"
                    >
                      来源：{f.source_title ?? f.source_url}
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                    {!f.verified_at && (
                      <InlineForm action={factVerify} submitLabel="标记已核验">
                        <input type="hidden" name="id" value={f.id} />
                        <Input name="sourceUrl" placeholder="核验来源 URL" className="h-8 w-56" />
                        <Input name="verifiedAt" type="date" className="h-8 w-36" />
                      </InlineForm>
                    )}
                    <InlineForm action={factStatus} submitLabel="设为争议">
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="status" value="disputed" />
                    </InlineForm>
                    <DangerForm action={factDelete} hidden={{ id: f.id }} label="删除" />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <form action={factAdd} className="mt-4 flex flex-col gap-3 border-t pt-4">
          <input type="hidden" name="storeId" value={store.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="事实类型" htmlFor="fa-key">
              <select id="fa-key" name="factKey" className={SEL} required defaultValue="address">
                {STORE_FACT_KEYS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </Field>
            <Field label="内容" htmlFor="fa-val">
              <Input id="fa-val" name="value" placeholder="南京东路 100 号 2 楼" required />
            </Field>
            <Field label="来源类型" htmlFor="fa-kind">
              <select id="fa-kind" name="sourceKind" className={SEL} defaultValue="self">
                <option value="self">自述（仅自家资料）</option>
                <option value="official">官方（营业执照/许可证）</option>
                <option value="third_party">第三方（平台/媒体）</option>
                <option value="audited">审计/年检</option>
              </select>
            </Field>
            <Field label="来源链接" htmlFor="fa-url" hint="必须可点击复核">
              <Input id="fa-url" name="sourceUrl" placeholder="https://…" />
            </Field>
            <Field label="核验日期" htmlFor="fa-verified" hint="留空则为「待核验」，不可用于对外内容">
              <Input id="fa-verified" name="verifiedAt" type="date" />
            </Field>
            <Field label="有效期至" htmlFor="fa-until" hint="营业时间类建议填，到期自动提醒">
              <Input id="fa-until" name="validUntil" type="date" />
            </Field>
          </div>
          <div>
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              添加事实
            </Button>
          </div>
        </form>
      </SectionCard>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <IconMapPin className="size-4 text-muted-foreground" />
            下一步
          </CardTitle>
          <CardDescription>
            到{" "}
            <Link href={`/console/map-listings?store=${storeId}`} className="font-medium text-primary underline-offset-4 hover:underline">
              地图资料核对
            </Link>{" "}
            登记各地图平台的 POI 与认领状态，并做一次资料比对。
          </CardDescription>
        </CardHeader>
      </Card>
    </>
  );
}
