import Link from "next/link";
import { IconMapSearch, IconPlus, IconAlertTriangle, IconShieldLock } from "@tabler/icons-react";
import * as L from "@/lib/db/repo-local";
import { MAP_PLATFORMS, CLAIM_STATUS } from "@/lib/db/schema-local";
import { PageHead, SectionCard, Field, InlineForm, DangerForm, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { diffResolve, listingSnapshot, listingUpsert } from "../local-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "地图资料核对", robots: { index: false, follow: false } };

const SEL = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none";

const FIELD_LABEL: Record<string, string> = {
  name: "店名",
  address: "地址",
  phone: "电话",
  hours: "营业时间",
  category: "经营类别",
};

/**
 * 模块 B：地图资料核对。
 *
 * ⚠️ 首版**只做授权查询与人工修正**，代码中不存在任何写回第三方平台的路径。
 *    本页做三件事：
 *      1. 登记各地图平台的 POI ID 与认领状态（确认"对的是同一家店"）
 *      2. 保存一次授权查询的观测快照
 *      3. 把"我们核验过的事实"与"平台上看到的"做差异比对，生成待办
 *    修正动作由人工在平台侧完成后，回到这里记录处理结果。
 */
export default async function MapListingsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeParam } = await searchParams;
  const stores = L.listStores();
  const selected = storeParam ? stores.find((s) => s.id === storeParam) : stores[0];

  if (!selected) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHead icon={IconMapSearch} title="地图资料核对" description="先建立门店档案。" />
        <EmptyState>
          还没有门店。
          <br />
          <span className="text-xs">
            先到{" "}
            <Link href="/console/stores" className="text-primary underline-offset-4 hover:underline">
              门店档案
            </Link>{" "}
            建立 1 家门店。
          </span>
        </EmptyState>
      </div>
    );
  }

  const listings = L.listMapListings(selected.id);
  const diffs = L.listMapDiffs({ storeId: selected.id });
  const openDiffs = diffs.filter((d) => d.status === "open" || d.status === "in_progress");
  const facts = L.latestFactByKey(selected.id);
  const blockDiffs = openDiffs.filter((d) => d.severity === "block");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconMapSearch}
        title="地图资料核对"
        description="让公开资料保持一致：登记 POI 与认领状态，定期把平台上看到的信息与门店核验过的事实比对，生成差异待办。"
        badge={
          stores.length > 1 ? (
            <Badge variant="outline" className="font-normal">
              {selected.name}
            </Badge>
          ) : undefined
        }
      />

      <Alert>
        <IconShieldLock className="size-4" />
        <AlertTitle>首版边界：只读查询 + 人工修正</AlertTitle>
        <AlertDescription>
          本模块<strong>不会自动修改任何第三方平台资料</strong>。它只保存授权查询拿到的快照、
          计算差异、记录你怎么处理的。修正动作请在平台侧人工完成后回到这里回填结果。
        </AlertDescription>
      </Alert>

      {blockDiffs.length > 0 && (
        <Alert className="border-fail/30 bg-fail-soft">
          <IconAlertTriangle className="size-4 text-fail" />
          <AlertTitle>存在 {blockDiffs.length} 条阻断级差异（店名 / 地址不一致）</AlertTitle>
          <AlertDescription>
            这类不一致会导致平台把门店当成另一家店，推荐时可能指向错误门店。发布任何内容前应先处理。
          </AlertDescription>
        </Alert>
      )}

      {/* —— 平台资料 —— */}
      <SectionCard
        title={`平台资料（${listings.length}）`}
        description="POI ID 用来确认「对的是同一家店」——没有 POI ID 就无法保证比对的是自己的那条记录。"
      >
        {listings.length === 0 ? (
          <EmptyState>还没有登记任何平台资料。</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {listings.map((l) => (
              <div key={l.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-primary">{l.platform}</span>
                  <Badge variant="outline" className="font-normal">
                    {CLAIM_STATUS.find((c) => c.value === l.claim_status)?.label ?? l.claim_status}
                  </Badge>
                  {l.poi_id ? (
                    <span className="font-mono text-xs text-muted-foreground">POI {l.poi_id}</span>
                  ) : (
                    <Badge variant="outline" className="border-warn/25 bg-warn-soft font-normal text-warn">
                      缺 POI ID
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    快照于 {l.snapshot_at ? l.snapshot_at.slice(0, 16).replace("T", " ") : "（尚未采集）"}
                  </span>
                </div>

                {l.snapshot_at && (
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>店名：{l.seen_name ?? "—"}</span>
                    <span>地址：{l.seen_address ?? "—"}</span>
                    <span>电话：{l.seen_phone ?? "—"}</span>
                    <span>营业时间：{l.seen_hours ?? "—"}</span>
                  </div>
                )}

                {/* 保存新快照 → 触发差异比对 */}
                <form action={listingSnapshot} className="mt-3 flex flex-col gap-2 border-t pt-3">
                  <input type="hidden" name="listingId" value={l.id} />
                  <div className="text-xs font-medium">记录一次授权查询的观测结果</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input name="name" placeholder={`店名（核验值：${facts.name?.value ?? selected.name}）`} className="h-8" />
                    <Input name="address" placeholder={`地址（核验值：${facts.address?.value ?? selected.address ?? "—"}）`} className="h-8" />
                    <Input name="phone" placeholder={`电话（核验值：${facts.phone?.value ?? "—"}）`} className="h-8" />
                    <Input name="hours" placeholder="营业时间（如 09:00-21:00）" className="h-8" />
                    <Input name="category" placeholder="经营类别" className="h-8" />
                    <Input name="snapshotAt" type="date" className="h-8" />
                  </div>
                  <div>
                    <Button type="submit" size="sm" variant="outline">
                      保存快照并比对差异
                    </Button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={listingUpsert} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
          <input type="hidden" name="storeId" value={selected.id} />
          <Field label="平台" htmlFor="ml-p">
            <select id="ml-p" name="platform" className={SEL} required defaultValue="google_business_profile">
              {MAP_PLATFORMS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="POI ID" htmlFor="ml-poi" hint="平台侧唯一标识">
            <Input id="ml-poi" name="poiId" placeholder="ChIJ…" />
          </Field>
          <Field label="认领状态" htmlFor="ml-c">
            <select id="ml-c" name="claimStatus" className={SEL} defaultValue="unknown">
              {CLAIM_STATUS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="商家页面链接" htmlFor="ml-url">
            <Input id="ml-url" name="listingUrl" placeholder="https://…" />
          </Field>
          <Field label="查询方式" htmlFor="ml-q">
            <select id="ml-q" name="queryMethod" className={SEL} defaultValue="authorized_lookup">
              <option value="authorized_lookup">授权查询（API/后台）</option>
              <option value="manual_view">人工查看</option>
            </select>
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              登记 / 更新平台资料
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 差异待办 —— */}
      <SectionCard
        title={`差异待办（未处理 ${openDiffs.length}）`}
        description="已处理的差异保留在列表里，形成「资料变更历史」——这也是面对平台申诉时的凭据。"
      >
        {diffs.length === 0 ? (
          <EmptyState>还没有差异记录。先在上方保存一次快照。</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">级别</TableHead>
                  <TableHead className="w-20">字段</TableHead>
                  <TableHead>核验值（应为）</TableHead>
                  <TableHead>平台值（实际）</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-72">处理</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          d.severity === "block"
                            ? "border-fail/25 bg-fail-soft font-normal text-fail"
                            : d.severity === "warn"
                              ? "border-warn/25 bg-warn-soft font-normal text-warn"
                              : "font-normal text-muted-foreground"
                        }
                      >
                        {d.severity === "block" ? "阻断" : d.severity === "warn" ? "警告" : "提示"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{FIELD_LABEL[d.field] ?? d.field}</TableCell>
                    <TableCell className="text-sm">{d.expected_value ?? "—"}</TableCell>
                    <TableCell className="text-sm text-fail">{d.seen_value ?? "—"}</TableCell>
                    <TableCell>
                      <StatusPill status={d.status === "resolved" || d.status === "accepted" ? "done" : d.status === "in_progress" ? "active" : "draft"} />
                    </TableCell>
                    <TableCell>
                      {d.status === "open" || d.status === "in_progress" ? (
                        <InlineForm action={diffResolve} submitLabel="记录处理">
                          <input type="hidden" name="id" value={d.id} />
                          <select name="status" className={SEL} style={{ width: "7rem", height: "2rem" }} defaultValue="resolved">
                            <option value="in_progress">处理中</option>
                            <option value="resolved">已修正</option>
                            <option value="accepted">接受差异</option>
                          </select>
                          <Input name="note" placeholder="怎么处理的" className="h-8 w-44" />
                        </InlineForm>
                      ) : (
                        <span className="text-xs text-muted-foreground">{d.resolution_note ?? "—"}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {diffs.some((d) => d.status === "open") && (
          <div className="mt-3 text-xs text-muted-foreground">
            提示：差异说明见字段本身 —— <strong>店名/地址</strong>不一致属于阻断级（会推荐错店），
            <strong>营业时间</strong>不一致会导致用户在打烊时段被引导到店。
          </div>
        )}
      </SectionCard>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-sm">下一步</CardTitle>
          <CardDescription>
            资料一致后，到{" "}
            <Link href={`/console/geo-sampling?store=${selected.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              位置采样
            </Link>{" "}
            设置测试锚点与场景，然后采集发布前的基线。
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
