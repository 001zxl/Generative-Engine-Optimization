import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedSnapshot } from "@/lib/db/repo-public";
import { LeadForm } from "@/components/forms";
import { PageView } from "@/components/page-view";
import { Badge } from "@/components/ui/badge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVIDENCE_LABEL: Record<string, string> = {
  self: "品牌自述",
  official: "官方来源",
  third_party: "第三方材料",
  audited: "审计材料",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const found = getPublishedSnapshot((await params).slug);
  if (!found || found.snapshot.kind !== "brand") {
    return { title: "页面不存在", robots: { index: false, follow: false } };
  }
  const b = found.snapshot;
  const canonical = `/brands/${encodeURIComponent(found.page.slug)}`;
  const description = (b.description?.trim() || `${b.name} 的可核验信息`).slice(0, 160);
  return {
    title: b.name,
    description,
    alternates: { canonical },
    openGraph: { type: "website", title: b.name, description, url: canonical },
  };
}

/**
 * 公开品牌/服务页。
 *
 * 页面上每一条对外声明都来自已批准的事实，并逐条列出证据。
 * 没有证据的说法不会出现在这里 —— 这是本页与普通宣传页的区别。
 */
export default async function PublicBrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const found = getPublishedSnapshot((await params).slug);
  if (!found || found.snapshot.kind !== "brand") notFound();
  const { page, snapshot: brand } = found;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <PageView path={`/brands/${page.slug}`} />
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← 返回首页
      </Link>

      <header className="mt-7">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{brand.name}</h1>
        {brand.description && <p className="mt-4 text-lg leading-8 text-muted-foreground">{brand.description}</p>}
        <p className="mt-3 text-xs text-muted-foreground">
          本页内容最后更新于 <time dateTime={brand.updatedAt}>{brand.updatedAt.slice(0, 10)}</time>
          {page.reviewed_at ? ` · 审核于 ${page.reviewed_at.slice(0, 10)}` : ""}
        </p>
        {brand.domain && (
          <p className="mt-1 text-sm">
            官网：
            <a
              href={`https://${brand.domain.replace(/^https?:\/\//, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {brand.domain}
            </a>
          </p>
        )}
      </header>

      <section className="mt-8">
        <h2 className="font-semibold">可核验的信息</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          以下每一条都绑定了来源，可自行核对。未提供来源的说法不会出现在本页。
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {brand.claims.map((c) => (
            <div key={c.key} className="rounded-lg border p-4">
              <p>{c.statement}</p>
              <ul className="mt-2 space-y-1.5">
                {c.sources.map((s, i) => (
                  <li key={`${c.key}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                    {s.url ? (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        {s.title}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">{s.title}（材料留存，无可访问链接）</span>
                    )}
                    {s.publisher && <span className="text-muted-foreground">· {s.publisher}</span>}
                    <Badge variant="outline" className="font-normal">
                      {EVIDENCE_LABEL[s.evidenceLevel] ?? s.evidenceLevel}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-xl border bg-muted/30 p-5">
        <h2 className="font-semibold">咨询与联系</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          想了解更具体的情况，留言即可。我们不会把本页信息用于承诺无法保证的结果。
        </p>
        <LeadForm source={`brand:${page.slug}`} />
      </section>

      <p className="mt-8 text-xs text-muted-foreground">
        <Link href="/knowledge" className="underline underline-offset-2">
          知识与实践
        </Link>{" "}
        ·{" "}
        <Link href="/methods" className="underline underline-offset-2">
          方法与数据边界
        </Link>
      </p>
    </div>
  );
}
