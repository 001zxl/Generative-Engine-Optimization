import Link from "next/link";
import { IconWorldPin, IconAlertTriangle, IconCircleCheck, IconEye } from "@tabler/icons-react";
import * as PP from "@/lib/db/repo-public";
import * as R from "@/lib/db/repo-domains";
import { listStores } from "@/lib/db/repo-local";
import { PageHead, SectionCard, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  brandPageBuild,
  pageArchive,
  pageDelete,
  pagePublish,
  pageSubmitReview,
  storePageBuild,
} from "../public-actions";
import { publicPath } from "@/lib/public-pages";
import { getStore } from "@/lib/db/repo-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "公开页面", robots: { index: false, follow: false } };

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  in_review: "待审核",
  published: "已公开",
  archived: "已下线",
};

/**
 * 模块 A2：公开实体页的审核与发布。
 *
 * 这个页面存在的意义就是"不自动公开"：运营台里出现过的品牌和门店
 * 不会自己变成公网页面，必须在这里显式提交审核并发布。
 */
export default function PublicPagesPage() {
  const pages = PP.listPublicPages();
  const stores = listStores();
  const brands = R.listBrands();

  const storeById = new Map(stores.map((s) => [s.id, s]));
  const brandById = new Map(brands.map((b) => [b.id, b]));

  // 发布前检查每次都重算 —— 门店资料可能已经变了
  const storePreviews = new Map(stores.map((s) => [s.id, PP.previewStorePage(s.id)]));
  const brandPreviews = new Map(brands.map((b) => [b.id, PP.previewBrandPage(b.id)]));

  const published = pages.filter((p) => p.status === "published");
  const drifted = pages.filter((p) => {
    const preview = p.entity_type === "store" ? storePreviews.get(p.entity_id) : brandPreviews.get(p.entity_id);
    return preview?.drift;
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconWorldPin}
        title="公开页面"
        description="品牌页与门店页只在这里发布。未经审核的对象不会被公开，也不会进入 sitemap。"
        badge={
          <Badge variant="outline" className="font-normal">
            {published.length} 个已公开 · {pages.length} 个页面记录
          </Badge>
        }
      />

      <Alert>
        <IconEye className="size-4" />
        <AlertTitle>发布后页面读的是快照，不是实时资料</AlertTitle>
        <AlertDescription>
          审核通过那一刻会固化内容快照。之后改门店资料<strong>不会</strong>自动改变已公开页面 ——
          需要重新提交审核。这样「已审核」才有意义，也避免误改直接被外部看到。
        </AlertDescription>
      </Alert>

      {drifted.length > 0 && (
        <Alert className="border-warn/25 bg-warn-soft">
          <IconAlertTriangle className="size-4 text-warn" />
          <AlertTitle>{drifted.length} 个已公开页面的资料已变动</AlertTitle>
          <AlertDescription>
            这些页面的当前资料与已发布快照不一致。如需更新，请重新提交审核并发布。
            <ul className="mt-2 space-y-1">
              {drifted.map((p) => (
                <li key={p.id} className="text-xs">
                  {p.entity_type === "store"
                    ? (storeById.get(p.entity_id)?.name ?? p.entity_id)
                    : (brandById.get(p.entity_id)?.name ?? p.entity_id)}{" "}
                  · {publicPath(p.entity_type, p.slug)}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* —— 门店页 —— */}
      <SectionCard
        title="门店页"
        description="页面展示地址、电话、营业时间、服务范围与地图资料链接，逐条标注来源。"
      >
        {stores.length === 0 ? (
          <EmptyState>
            还没有门店。先到{" "}
            <Link href="/console/stores" className="text-primary underline-offset-4 hover:underline">
              门店档案
            </Link>{" "}
            建档。
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>门店</TableHead>
                <TableHead className="w-24">页面状态</TableHead>
                <TableHead>发布前检查</TableHead>
                <TableHead className="w-64">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => {
                const page = PP.getPublicPageByEntity("store", store.id);
                const preview = storePreviews.get(store.id)!;
                return (
                  <TableRow key={store.id}>
                    <TableCell>
                      <div className="font-medium">{store.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[store.city, store.district].filter(Boolean).join(" ")}
                      </div>
                      {page && (
                        <Link
                          href={publicPath("store", page.slug)}
                          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {publicPath("store", page.slug)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>{page ? <StatusPill status={page.status} /> : <span className="text-xs text-muted-foreground">未建立</span>}</TableCell>
                    <TableCell>
                      {preview.ok ? (
                        <div className="flex items-start gap-1.5 text-xs text-ok">
                          <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" />
                          <span>检查通过{preview.warnings.length > 0 ? `（${preview.warnings.length} 条建议）` : ""}</span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5 text-xs text-fail">
                          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span>{preview.blockers.length} 项未通过</span>
                        </div>
                      )}
                      {[...preview.blockers, ...preview.warnings].slice(0, 3).map((t) => (
                        <div
                          key={t}
                          className={`mt-0.5 text-xs ${preview.blockers.includes(t) ? "text-fail" : "text-muted-foreground"}`}
                        >
                          · {t}
                        </div>
                      ))}
                      {preview.drift && <div className="mt-1 text-xs text-warn">资料已变动，快照需重新审核</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <form action={storePageBuild}>
                          <input type="hidden" name="storeId" value={store.id} />
                          <Button type="submit" size="sm" variant="outline" className="h-7">
                            {page ? "刷新快照" : "建立草稿"}
                          </Button>
                        </form>
                        {page && page.status !== "in_review" && page.status !== "published" && (
                          <form action={pageSubmitReview}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              提交审核
                            </Button>
                          </form>
                        )}
                        {page && page.status !== "published" && (
                          <form action={pagePublish}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" className="h-7" disabled={!preview.ok}>
                              公开
                            </Button>
                          </form>
                        )}
                        {page && page.status === "published" && (
                          <form action={pageArchive}>
                            <input type="hidden" name="id" value={page.id} />
                            <input type="hidden" name="reason" value="运营台手动下线" />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              下线
                            </Button>
                          </form>
                        )}
                        {page && page.status !== "published" && (
                          <form action={pageDelete}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              删除
                            </Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* —— 品牌页 —— */}
      <SectionCard
        title="品牌 / 服务页"
        description="只展示已批准的事实，并逐条列出证据。没有证据的说法不会出现在页面上。"
      >
        {brands.length === 0 ? (
          <EmptyState>
            还没有品牌。先到{" "}
            <Link href="/console/brands" className="text-primary underline-offset-4 hover:underline">
              品牌与竞品
            </Link>{" "}
            建档。
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>品牌</TableHead>
                <TableHead className="w-24">页面状态</TableHead>
                <TableHead>发布前检查</TableHead>
                <TableHead className="w-64">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.map((brand) => {
                const page = PP.getPublicPageByEntity("brand", brand.id);
                const preview = brandPreviews.get(brand.id)!;
                return (
                  <TableRow key={brand.id}>
                    <TableCell>
                      <div className="font-medium">{brand.name}</div>
                      {brand.domain && <div className="text-xs text-muted-foreground">{brand.domain}</div>}
                      {page && (
                        <Link
                          href={publicPath("brand", page.slug)}
                          className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                        >
                          {publicPath("brand", page.slug)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>{page ? <StatusPill status={page.status} /> : <span className="text-xs text-muted-foreground">未建立</span>}</TableCell>
                    <TableCell>
                      {preview.ok ? (
                        <div className="flex items-start gap-1.5 text-xs text-ok">
                          <IconCircleCheck className="mt-0.5 size-3.5 shrink-0" />
                          <span>
                            检查通过 · {preview.snapshot?.kind === "brand" ? preview.snapshot.claims.length : 0} 条已批准事实
                            {preview.warnings.length > 0 ? `（${preview.warnings.length} 条建议）` : ""}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5 text-xs text-fail">
                          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span>{preview.blockers.length} 项未通过</span>
                        </div>
                      )}
                      {[...preview.blockers, ...preview.warnings].slice(0, 3).map((t) => (
                        <div
                          key={t}
                          className={`mt-0.5 text-xs ${preview.blockers.includes(t) ? "text-fail" : "text-muted-foreground"}`}
                        >
                          · {t}
                        </div>
                      ))}
                      {preview.drift && <div className="mt-1 text-xs text-warn">资料已变动，快照需重新审核</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <form action={brandPageBuild}>
                          <input type="hidden" name="brandId" value={brand.id} />
                          <Button type="submit" size="sm" variant="outline" className="h-7">
                            {page ? "刷新快照" : "建立草稿"}
                          </Button>
                        </form>
                        {page && page.status !== "in_review" && page.status !== "published" && (
                          <form action={pageSubmitReview}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              提交审核
                            </Button>
                          </form>
                        )}
                        {page && page.status !== "published" && (
                          <form action={pagePublish}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" className="h-7" disabled={!preview.ok}>
                              公开
                            </Button>
                          </form>
                        )}
                        {page && page.status === "published" && (
                          <form action={pageArchive}>
                            <input type="hidden" name="id" value={page.id} />
                            <input type="hidden" name="reason" value="运营台手动下线" />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              下线
                            </Button>
                          </form>
                        )}
                        {page && page.status !== "published" && (
                          <form action={pageDelete}>
                            <input type="hidden" name="id" value={page.id} />
                            <Button type="submit" size="sm" variant="outline" className="h-7">
                              删除
                            </Button>
                          </form>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <p className="text-sm text-muted-foreground">
        公开页面只包含已核验事实。门店的阻断级地图差异（店名/地址不一致）未处理前无法公开 ——
        否则平台可能把你的门店当成另一家。
      </p>
    </div>
  );
}
