import Link from "next/link";
import type { Metadata } from "next";
import { listPublishedKnowledge } from "@/lib/publishing";
import { abs } from "@/lib/site";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageView } from "@/components/page-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata { return { title: "知识与实践", description: "经过审核的知识文章、操作指南与参考来源。", alternates: { canonical: abs("/knowledge") }, openGraph: { url: abs("/knowledge"), title: "知识与实践" } }; }

export default function KnowledgeIndex() {
  const articles = listPublishedKnowledge();
  return <div className="mx-auto max-w-5xl px-5 py-12">
    <PageView path="/knowledge" />
    <h1 className="text-3xl font-semibold tracking-tight">知识与实践</h1>
    <p className="mt-3 text-muted-foreground">可引用的回答、公开证据与具体实践。每篇文章保留作者、发布时间和参考来源。</p>
    {!articles.length && <p className="mt-10 rounded-xl border p-6 text-muted-foreground">文章正在准备中，审核并发布后会在这里展示。</p>}
    <div className="mt-8 grid gap-4 md:grid-cols-2">{articles.map((article) => <Card key={article.id}><CardHeader><CardTitle className="text-xl"><Link href={`/knowledge/${encodeURIComponent(article.slug)}`} className="hover:underline">{article.title}</Link></CardTitle><CardDescription className="line-clamp-3 leading-relaxed">{article.body.slice(0, 180)}</CardDescription><p className="text-xs text-muted-foreground">{article.author} · {article.publishedAt.slice(0, 10)} · {article.evidences.length} 条参考来源</p></CardHeader></Card>)}</div>
  </div>;
}
