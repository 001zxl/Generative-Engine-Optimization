import type { Metadata } from "next";
import { IconShieldCheck, IconTrash, IconEyeOff } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/check-parts";
import { AI_BOTS } from "@/lib/checks/bots";
import { site, abs } from "@/lib/site";

export const metadata: Metadata = {
  title: "方法与数据边界",
  description:
    "本站的检查方法、判定规则、数据来源、不做什么，以及隐私与索引政策。包括为什么我们不承诺「被 AI 推荐」。",
  alternates: { canonical: abs("/methods") },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "TechArticle",
  headline: "检查方法与数据边界",
  author: { "@type": "Organization", name: site.name },
  publisher: { "@type": "Organization", name: site.name },
  description: "AI 可发现性与内容可引用性检查的完整方法说明、判定依据与数据边界。",
};

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
        可信度基础
      </Badge>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">方法与数据边界</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        在一个还没有行业标准、且充满夸大的领域里，把方法公开是最基本的诚意。
        这一页说明我们测什么、怎么测、不测什么。
      </p>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>一、我们测什么</CardTitle>
          <CardDescription>只测客观可观测的条件，分成两段链路。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className="rounded-lg border p-4">
            <div className="font-medium">可抓取与可索引</div>
            <p className="mt-1 text-muted-foreground">
              页面能否被抓取、robots.txt 是否放行 AI 爬虫、canonical 与 noindex 的状态、sitemap 是否包含该页面、
              结构化数据是否存在。
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">可引用性</div>
            <p className="mt-1 text-muted-foreground">
              内容是否以「可被摘出来用」的形态组织 —— 是否直接回答问题、是否包含可核验的具体事实、
              是否有来源与作者、结构能否被切分、是否有 FAQ、表述是否克制。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>二、怎么测</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <ol className="flex list-decimal flex-col gap-2.5 pl-5">
            <li>
              以固定的 User-Agent 抓取目标页面与 <code className="font-mono text-xs">/robots.txt</code>
              ，记录状态码、内容类型、重定向链、耗时与响应体大小。
            </li>
            <li>
              按 <strong className="text-foreground">RFC 9309</strong> 解析 robots 规则：支持{" "}
              <code className="font-mono text-xs">*</code> 通配符与 <code className="font-mono text-xs">$</code>{" "}
              结尾锚定，采用最长匹配优先、同长度 Allow 优先的判定；对 {AI_BOTS.length} 个已知 AI 爬虫逐个给出
              「允许 / 阻止」及命中的具体规则。
            </li>
            <li>
              对 HTML 做确定性结构分析：正文文本占比、标题层级、列表与表格、JSON-LD、作者与日期、
              数字与单位密度、绝对化表述词表。
            </li>
          </ol>
          <p className="rounded-lg border border-ok/25 bg-ok-soft p-3 text-foreground/90">
            <strong>全过程不调用任何大模型。</strong>同样的输入永远得到同样的输出，每一项结论都可以由你复算。
            这既是可信度的来源，也是这些工具可以免费的原因 —— 单次检查的边际成本为零。
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>三、我们不测什么（同样重要）</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2.5 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">
                当前这套工具只检查「爬虫规则」，不监测各平台的实际回答内容。
              </strong>
              具体来说：它读的是 robots.txt 与页面 HTML，判断的是「检索型爬虫能不能取到你、内容是否容易被摘录」。
              它<strong className="text-foreground">不会</strong>去问 ChatGPT / 豆包 / 千问「你推荐哪家供应商」，
              因此也无法告诉你品牌在某个平台的答案里有没有被提到。那属于「多平台采样与评估」模块，
              是本产品的下一步（见运营台的产品路线图），目前尚未实现。
            </li>
            <li>
              <strong className="text-foreground">不测「AI 会不会推荐你」。</strong>
              生成式系统的回答会随模型版本、时间、地区、上下文变化，任何声称能给出稳定排名分数的做法都不可复现。
            </li>
            <li>
              <strong className="text-foreground">不测关键词排名。</strong>生成式答案是合成的，不存在位置意义上的排名。
            </li>
            <li>
              <strong className="text-foreground">不模拟具体平台的消费端结果。</strong>
              官方 API 的回答与消费者产品界面的回答存在差异，把两者混为一谈会系统性高估或低估真实可见度。
              真正的可见度监测需要按平台单独采样、并标注采样方式，那是另一套系统的工作。
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>四、判定规则的口径</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">等级</TableHead>
                <TableHead>含义</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="align-top">
                  <StatusBadge status="fail" />
                </TableCell>
                <TableCell className="align-top text-muted-foreground">
                  会直接阻断 AI 发现或引用的条件，例如检索型爬虫被屏蔽、页面取不到正文、页面被 noindex。
                  这类问题优先修。
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="align-top">
                  <StatusBadge status="warn" />
                </TableCell>
                <TableCell className="align-top text-muted-foreground">
                  不会一票否决，但会明显降低被理解与引用的概率，例如缺少 canonical、没有结构化数据、段落过长。
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="align-top">
                  <StatusBadge status="info" />
                </TableCell>
                <TableCell className="align-top text-muted-foreground">
                  需要你知道、但不构成缺陷的事实，例如训练型爬虫被屏蔽（这不影响 AI 答案可见性）。
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="align-top">
                  <StatusBadge status="pass" />
                </TableCell>
                <TableCell className="align-top text-muted-foreground">该检查项已满足条件。</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            分项得分是启发式评分，用于排序改进优先级，不代表平台真实算法的任何权重。总分由分项加权得出，
            权重与计算依据在结果页逐项展示。
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4 scroll-mt-20" id="privacy">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconEyeOff className="size-4 text-muted-foreground" />
            五、隐私与索引政策
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2.5 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">检查结果默认不被索引。</strong>生成的结果页带有{" "}
              <code className="font-mono text-xs">noindex</code> 标记，不会被搜索引擎收录；
              但请注意：<strong className="text-foreground">未索引不等于有访问权限</strong>——
              任何拿到该链接的人都能查看，链接为 12 位随机串，不可枚举。请勿提交含敏感信息的网址。
            </li>
            <li>
              <strong className="text-foreground">只有你主动选择公开</strong>
              （结果页上的「允许搜索引擎索引此结果」）之后，该页面才会被索引。
            </li>
            <li>
              <strong className="text-foreground">我们不保存完整 IP。</strong>限流与去重使用 IP 的哈希值。
              抓取你提交的网址时，对方服务器会看到我们的固定 User-Agent。
            </li>
            <li>提交表单时提供的信息，仅用于回复本次咨询，可随时邮件要求删除。</li>
            <li>公开检查接口有速率限制；请勿用其替代批量站点审计。</li>
          </ul>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>六、已知边界</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2.5 pl-5 text-sm text-muted-foreground">
            <li>只分析初始 HTML。若正文需要执行脚本才出现，我们只能报告「取不到正文」，无法替你渲染。</li>
            <li>只检查你提交的单个 URL 与同源的 robots.txt / sitemap，不遍历全站。</li>
            <li>robots 规则分析基于文本规则匹配；服务器端的 IP 级或 WAF 级拦截不在检查范围内。</li>
            <li>
              绝对化表述词表是启发式，会有误报（例如「第一时间」）；结果页会把命中的原文片段列出来供你判断。
            </li>
          </ul>
        </CardContent>
      </Card>

      <Accordion type="single" collapsible className="mt-4">
        <AccordionItem value="stance" className="rounded-lg border bg-card px-4">
          <AccordionTrigger>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <IconShieldCheck className="size-4 text-primary" />
              我们的立场
            </span>
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground">
            提高被 AI 理解和引用的可能性，是一件可以通过工程手段改善的事；保证被 AI 推荐，则不是。
            我们把前者做成可复算的检查，把后者明确排除在承诺之外。
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <p className="mt-8 flex items-center gap-1.5 text-sm text-muted-foreground">
        <IconTrash className="size-3.5" />
        数据删除请求：
        <a
          href={`mailto:${site.contactEmail}`}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {site.contactEmail}
        </a>
      </p>
    </div>
  );
}
