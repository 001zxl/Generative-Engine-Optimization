import Link from "next/link";
import { IconMapPin, IconPlus, IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import * as L from "@/lib/db/repo-local";
import { ANCHOR_KINDS, DAYPARTS, LOCATION_MODES } from "@/lib/db/schema-local";
import { LOCATION_MODE_LABEL, canClaimNearbyRecommendation } from "@/lib/local-geo";
import { PageHead, SectionCard, Field, InlineForm, DangerForm } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { anchorCreate, anchorDelete, scenarioCreate, scenarioDelete } from "../local-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "位置采样", robots: { index: false, follow: false } };

const SEL = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none";

/**
 * 模块 C：位置化问题库 + 地理采样。
 *
 * 本页最重要的东西不是表单，而是**两种定位方式的分野**：
 *   真实设备定位  → 才能回答"人在那儿时会不会被推荐"
 *   仅问题文字含地点 → 只能回答"模型知不知道这个城市"
 * 把后者当前者，就是把"AI 知道上海"谎报成"AI 在地铁口推荐了我们"。
 */
export default async function GeoSamplingPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store: storeParam } = await searchParams;
  const stores = L.listStores();
  const selected = storeParam ? stores.find((s) => s.id === storeParam) : stores[0];

  if (!selected) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHead icon={IconMapPin} title="位置采样" description="先建立门店档案。" />
        <EmptyState>
          还没有门店。先到{" "}
          <Link href="/console/stores" className="text-primary underline-offset-4 hover:underline">
            门店档案
          </Link>{" "}
          建立门店。
        </EmptyState>
      </div>
    );
  }

  const anchors = L.listAnchors(selected.id);
  const scenarios = L.listScenarios(selected.id);
  const readiness = L.storeReadiness(selected.id);
  const canStart = readiness.blockers.length === 0 && scenarios.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconMapPin}
        title="位置采样"
        description="设置公开测试锚点（地铁口、商圈）与测试场景（半径、时段、需求），冻结实际测试问题，再按锚点采集回答。"
        badge={<Badge variant="outline" className="font-normal">{selected.name}</Badge>}
      />

      {/* —— 定位方式：本页最重要的一段 —— */}
      <Card className="border-warn/30 bg-warn-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconAlertTriangle className="size-4 text-warn" />
            两种定位方式必须分开标记，不能混算
          </CardTitle>
          <CardDescription>
            这是本地 GEO 里最容易自欺的一步：把地点写进问题文字，与在真实位置用设备定位提问，
            是两个不同的命题。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {LOCATION_MODES.map((m) => (
            <div key={m.value} className="rounded-md border border-warn/25 bg-background p-2.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{LOCATION_MODE_LABEL[m.value]}</span>
                <code className="font-mono text-xs text-muted-foreground">{m.value}</code>
                {canClaimNearbyRecommendation(m.value) ? (
                  <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
                    可用于「附近推荐」结论
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal text-muted-foreground">
                    不可用于「附近推荐」结论
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            系统在生成指标时会按 <code className="font-mono">location_mode</code> 分组；
            混用会直接报错，而不是静默合并。
          </p>
        </CardContent>
      </Card>

      {/* —— 测试锚点 —— */}
      <SectionCard
        title={`测试锚点（${anchors.length}）`}
        description="锚点必须是公开可定位的位置（地铁口、商圈、写字楼）——这样别人才能复现你的测试。"
      >
        {anchors.length === 0 ? (
          <EmptyState>还没有锚点。</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className="w-28">类型</TableHead>
                <TableHead className="w-40">坐标</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {anchors.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.name}
                    {a.address && <div className="text-xs text-muted-foreground">{a.address}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ANCHOR_KINDS.find((k) => k.value === a.kind)?.label ?? a.kind}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.lat != null && a.lng != null ? `${a.lat}, ${a.lng}` : "（未填）"}
                  </TableCell>
                  <TableCell>
                    <DangerForm action={anchorDelete} hidden={{ id: a.id }} label="删除" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form action={anchorCreate} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4">
          <input type="hidden" name="storeId" value={selected.id} />
          <Field label="锚点名称" htmlFor="an-name">
            <Input id="an-name" name="name" placeholder="人民广场地铁站 1 号口" required />
          </Field>
          <Field label="类型" htmlFor="an-kind">
            <select id="an-kind" name="kind" className={SEL} defaultValue="subway_exit">
              {ANCHOR_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </Field>
          <Field label="纬度" htmlFor="an-lat"><Input id="an-lat" name="lat" placeholder="31.2330" /></Field>
          <Field label="经度" htmlFor="an-lng"><Input id="an-lng" name="lng" placeholder="121.4750" /></Field>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" variant="outline">
              <IconPlus className="size-3.5" />
              添加锚点
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 测试场景 —— */}
      <SectionCard
        title={`地理测试场景（${scenarios.length}）`}
        description="一个场景 = 锚点 + 半径 + 时段 + 需求。它回答的是「A 应该在哪些场景被推荐」。"
      >
        {scenarios.length === 0 ? (
          <EmptyState>还没有场景。建议按试点要求先设 3 个不同位置的场景。</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>锚点</TableHead>
                <TableHead className="w-24">半径</TableHead>
                <TableHead className="w-24">时段</TableHead>
                <TableHead>需求</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.anchor_name ?? "（无锚点）"}</TableCell>
                  <TableCell className="tabular-nums text-sm">{g.radius_m} m</TableCell>
                  <TableCell className="text-xs">{DAYPARTS.find((d) => d.value === g.daypart)?.label ?? g.daypart}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.need ?? "—"}
                    {g.expected_note && <div className="text-xs">预期：{g.expected_note}</div>}
                  </TableCell>
                  <TableCell>
                    <DangerForm action={scenarioDelete} hidden={{ id: g.id }} label="删除" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <form action={scenarioCreate} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-4">
          <input type="hidden" name="storeId" value={selected.id} />
          <Field label="测试锚点" htmlFor="gs-anchor">
            <select id="gs-anchor" name="anchorId" className={SEL} required>
              <option value="">选择锚点…</option>
              {anchors.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="半径（米）" htmlFor="gs-r" hint="模拟「附近」的范围">
            <Input id="gs-r" name="radiusM" placeholder="1000" />
          </Field>
          <Field label="时段" htmlFor="gs-d">
            <select id="gs-d" name="daypart" className={SEL} defaultValue="any">
              {DAYPARTS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </Field>
          <Field label="需求" htmlFor="gs-need">
            <Input id="gs-need" name="need" placeholder="商务宴请 / 两人晚餐" />
          </Field>
          <div className="sm:col-span-4">
            <Field label="为什么预期这家店应该被推荐" htmlFor="gs-exp" hint="写清预期，才能在报告里对照">
              <Input id="gs-exp" name="expectedNote" placeholder="该店距离锚点 400m，主营川菜，晚餐时段营业" />
            </Field>
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" size="sm" variant="outline">
              <IconPlus className="size-3.5" />
              添加场景
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* —— 开始采样 —— */}
      <Card className={canStart ? "border-ok/30 bg-ok-soft" : "border-warn/25 bg-warn-soft"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconInfoCircle className="size-4" />
            {canStart ? "可以开始基线采样" : "还不能开始采样"}
          </CardTitle>
          <CardDescription>
            {canStart
              ? "到「多平台采样」新建批次时，务必选择门店、锚点与定位方式。采集时请保留回答原文与分享链接/截图 —— 它们是指标可追溯的凭证。"
              : "还需要先在门店档案补齐资料、并在上方建立至少 1 个场景。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Button asChild size="sm">
            <Link href="/console/sampling">去新建采样批次</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/console/questions">去建立并冻结问题集</Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            同一批问题要复测 —— 冻结后的版本不可编辑，这是前后对比口径一致的前提。
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
