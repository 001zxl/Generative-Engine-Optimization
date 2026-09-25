import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedKnowledge, articleJsonLd } from "@/lib/publishing";
import { LeadForm } from "@/components/forms";
import { PageView } from "@/components/page-view";
import { Markdown } from "@/components/markdown";
import { markdownToPlainText } from "@/lib/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = getPublishedKnowledge((await params).slug);
  if (!article) return { title: "文章不存在", robots: { index: false, follow: false } };
  const description = markdownToPlainText(article.body, 160);
  return { title: article.title, description, alternates: { canonical: article.url },
    openGraph: { type: "article", title: article.title, description, url: article.url, publishedTime: article.publishedAt, authors: [article.author] } };
}

export default async function KnowledgeArticle({ params }: { params: Promise<{ slug: string }> }) {
  const article = getPublishedKnowledge((await params).slug);
  if (!article) notFound();
  return <div className="mx-auto max-w-3xl px-5 py-10">
    <PageView path={`/knowledge/${article.slug}`} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleJsonLd(article) }} />
    <Link href="/knowledge" className="text-sm text-muted-foreground hover:underline">← 知识与实践</Link>
    <article className="mt-7">
      <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{article.title}</h1>
      <p className="mt-4 border-b pb-5 text-sm text-muted-foreground">作者：{article.author} · 发布于 <time dateTime={article.publishedAt}>{article.publishedAt.slice(0, 10)}</time></p>
      <Markdown source={article.body} className="my-8" />
      {article.evidences.length > 0 && <section className="mb-10 rounded-xl border bg-muted/30 p-5"><h2 className="font-semibold">证据与参考来源</h2><ul className="mt-3 space-y-3">{article.evidences.map((e, i) => <li key={i} className="text-sm"><a href={e.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{e.title}</a>{e.publisher && <span className="text-muted-foreground"> · {e.publisher}</span>}<span className="ml-2 text-xs text-muted-foreground">{e.evidenceLevel === "self" ? "品牌自述" : e.evidenceLevel === "official" ? "官方来源" : e.evidenceLevel === "audited" ? "审计材料" : "第三方材料"}</span></li>)}</ul></section>}
    </article>
    <section aria-label="咨询与联系" className="mt-10"><LeadForm source={`knowledge:${article.slug}`} /></section>
  </div>;
}
