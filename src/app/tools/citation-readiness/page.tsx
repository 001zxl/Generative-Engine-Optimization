import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";
import { CitationCheckForm } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { abs } from "@/lib/site";

export const metadata: Metadata = {
  title: "内容可引用性检查（免费）",
  description:
    "评估一个页面是否具备被 AI 摘录引用的条件：是否直接回答问题、事实与数字密度、来源与作者、结构可切分、FAQ、夸大表述。分项给分并展示计算方式。",
  alternates: { canonical: abs("/tools/citation-readiness") },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "内容可引用性检查",
  applicationCategory: "SEO Tool",
  operatingSystem: "Web",
  offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  description: "按 8 个维度分项评估内容是否具备被 AI 摘录引用的结构条件，每项给出原文证据与修改示例。",
};

const DIMENSIONS = [
  { label: "直接回答问题", weight: "18%", basis: "疑问式小标题 + 紧跟其后的、≥40 字符的答案段" },
  { label: "具体事实与数字", weight: "15%", basis: "每千字含单位量值与年份的密度" },
  { label: "来源与证据", weight: "14%", basis: "站外链接数、引用性表述数、是否有参考资料区" },
  { label: "结构可切分", weight: "14%", basis: "H2/H3 数量、列表项、表格数、段落平均长度" },
  { label: "作者与时效", weight: "12%", basis: "作者、发布时间、更新时间（含 JSON-LD）与内容新旧" },
  { label: "FAQ 覆盖", weight: "10%", basis: "FAQPage 结构化数据、FAQ 标题、问答对数量" },
  { label: "可整段摘录的摘要", weight: "10%", basis: "是否存在 60–300 字符、可独立成立的段落" },
  { label: "表述克制", weight: "7%", basis: "绝对化 / 夸大表述词表命中数" },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
        免费工具 · 内容与引用层
      </Badge>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">内容可引用性检查</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        被抓取只是第一步。这个工具评估的是第二步：
        <strong className="text-foreground">内容能不能被直接摘出来用</strong>。
      </p>

      <div className="mt-7">
        <CitationCheckForm />
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">评估的 8 个维度</h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        不给不透明的总分。总分由下列分项加权得出，每一项都能展开看依据 —— 结果页会逐项列出。
      </p>

      <Card className="mt-4 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">维度</TableHead>
              <TableHead className="w-20">权重</TableHead>
              <TableHead>判定依据</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DIMENSIONS.map((d) => (
              <TableRow key={d.label}>
                <TableCell className="align-top font-medium">{d.label}</TableCell>
                <TableCell className="align-top tabular-nums text-muted-foreground">{d.weight}</TableCell>
                <TableCell className="align-top text-muted-foreground">{d.basis}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">这些规则从哪里来</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          它们不是平台公开的排名因子，而是「生成式检索需要什么才能安全地引用一段话」的工程推论：
          答案要能被切分、要能独立成立、要能用事实核验、要能追溯到作者与时间。
          因此本站把它表述为<strong className="text-foreground">可引用性条件</strong>，而不是「AI 排名算法」。
          <Link href="/methods" className="ml-1 font-medium text-primary underline-offset-4 hover:underline">
            完整方法与边界 →
          </Link>
        </CardContent>
      </Card>

      <Separator className="my-10" />

      <Link
        href="/tools/ai-crawler-check"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        <IconArrowLeft className="size-4" />
        先检查 AI 爬虫能不能抓到你
      </Link>
    </div>
  );
}
