import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedSnapshot } from "@/lib/db/repo-public";
import { LeadForm } from "@/components/forms";
import { PageView } from "@/components/page-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { serializeJsonLd, storeJsonLd } from "@/lib/jsonld";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_KIND_LABEL: Record<string, string> = {
  self: "商家自述",
  official: "官方材料",
  third_party: "第三方来源",
  audited: "审计/年检",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = getPublishedSnapshot((await params).slug);
  if (!found || found.snapshot.kind !== "store") {
    return { title: "门店不存在", robots: { index: false, follow: false } };
  }
  const s = found.snapshot;
  const where = [s.city, s.district].filter(Boolean).join("");
  const description = [s.name, where ? `${where}` : "", s.category ? `主营${s.category}` : "", s.address ? `地址：${s.address}` : ""]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 160);
  return {
    title: `${s.name}${where ? `（${where}）` : ""}`,
    description,
    alternates: { canonical: `/stores/${encodeURIComponent(found.page.slug)}` },
    openGraph: { type: "website", title: s.name, description, url: `/stores/${encodeURIComponent(found.page.slug)}` },
  };
}

/**
 * 公开门店页。
 *
 * 只读 public_pages 里 status='published' 的快照 —— 不直接读 stores 表。
 * 这样"运营台改了资料但没重新审核"不会静默改变已公开页面。
 */
export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const found = getPublishedSnapshot((await params).slug);
  if (!found || found.snapshot.kind !== "store") notFound();
  const { page, snapshot: store } = found;

  const mapPlatformLabel: Record<string, string> = {
    amap: "高德地图",
    baidu_map: "百度地图",
    google_business_profile: "Google 商家资料",
    apple_business_connect: "Apple 地图",
    bing_places: "Bing 地点",
    tencent_map: "腾讯地图",
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            storeJsonLd(store, { baseUrl: site.baseUrl, path: `/stores/${encodeURIComponent(page.slug)}` }),
          ),
        }}
      />
      <PageView path={`/stores/${page.slug}`} />
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← 返回首页
      </Link>

      <header className="mt-7">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{store.name}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {[store.city, store.district].filter(Boolean).join(" ")}
          {store.category ? ` · ${store.category}` : ""}
          {store.serviceRadiusKm ? ` · 服务范围约 ${store.serviceRadiusKm} 公里` : ""}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          本页内容最后更新于 <time dateTime={store.updatedAt}>{store.updatedAt.slice(0, 10)}</time>
          {page.reviewed_at ? ` · 审核于 ${page.reviewed_at.slice(0, 10)}` : ""}
        </p>
      </header>

      {store.statusNote && (
        <p className="mt-5 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
          {store.statusNote}
        </p>
      )}
      <div className="mt-6 rounded-xl border p-5">
        <h2 className="font-semibold">到店信息</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {store.address && (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">地址</dt>
              <dd className="mt-0.5">{store.address}</dd>
            </div>
          )}
          {store.phone && (
            <div>
              <dt className="text-xs text-muted-foreground">电话</dt>
              <dd className="mt-0.5">
                <a href={`tel:${store.phone.replace(/[^\d+]/g, "")}`} className="text-primary underline underline-offset-2">
                  {store.phone}
                </a>
              </dd>
            </div>
          )}
          {store.hoursText && (
            <div>
              <dt className="text-xs text-muted-foreground">营业时间</dt>
              <dd className="mt-0.5">{store.hoursText}</dd>
            </div>
          )}
          {store.priceRange && (
            <div>
              <dt className="text-xs text-muted-foreground">人均价格</dt>
              <dd className="mt-0.5">{store.priceRange}</dd>
            </div>
          )}
          {store.parking && (
            <div>
              <dt className="text-xs text-muted-foreground">停车</dt>
              <dd className="mt-0.5">{store.parking}</dd>
            </div>
          )}
          {store.accessibility && (
            <div>
              <dt className="text-xs text-muted-foreground">无障碍</dt>
              <dd className="mt-0.5">{store.accessibility}</dd>
            </div>
          )}
        </dl>
        {store.menuSummary && (
          <div className="mt-4 border-t pt-3">
            <h3 className="text-sm font-medium">菜单摘要</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{store.menuSummary}</p>
          </div>
        )}
      </div>

      {store.mapLinks.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold">地图与平台资料</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {store.mapLinks.map((l) => (
              <li key={l.url}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-md border px-3 py-1.5 text-sm text-primary underline-offset-2 hover:underline"
                >
                  {mapPlatformLabel[l.platform] ?? l.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-semibold">信息来源</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          下列信息均经过核验，并标注来源。若与实际不符，请联系我们更正。
        </p>
        <ul className="mt-3 space-y-3">
          {store.facts.map((f) => (
            <li key={`${f.key}-${f.value}`} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                <Badge variant="outline" className="font-normal">
                  {SOURCE_KIND_LABEL[f.sourceKind] ?? f.sourceKind}
                </Badge>
                {f.verifiedAt && <span className="text-xs text-muted-foreground">核验于 {f.verifiedAt.slice(0, 10)}</span>}
              </div>
              <div className="mt-1">{f.value}</div>
              {f.sourceUrl && (
                <a
                  href={f.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-primary underline underline-offset-2"
                >
                  {f.sourceTitle ?? "查看来源"}
                </a>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">信息有误或想咨询？</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            如果本页信息与实际不符，或想了解其他情况，留言即可 —— 我们会核对后更正本页。
          </p>
          <LeadForm source={`store:${page.slug}`} />
        </CardContent>
      </Card>
    </div>
  );
}
