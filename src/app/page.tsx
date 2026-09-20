import Link from "next/link";
import {
  IconArrowRight,
  IconFileSearch,
  IconMicroscope,
  IconBook2,
  IconCircleCheck,
  IconDatabaseSearch,
  IconAlignBoxLeftMiddle,
  IconShieldCheck,
} from "@tabler/icons-react";
import { CrawlCheckForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { NumberTicker } from "@/components/ui/number-ticker";
import { Marquee } from "@/components/ui/marquee";
import { BlurFade } from "@/components/ui/blur-fade";
import { AI_BOTS } from "@/lib/checks/bots";
import { site } from "@/lib/site";

const CRAWLER_TARGETS = [
  "OAI-SearchBot（ChatGPT 搜索）",
  "PerplexityBot",
  "Googlebot（AI Overviews 来源）",
  "Claude-SearchBot",
  "Bingbot（Copilot 来源）",
  "Baiduspider（文心一言）",
  "Sogou web spider（腾讯元宝）",
  "YisouSpider（夸克 / 神马）",
  "QwenBot（通义千问）",
  "ChatGLM-Spider（智谱清言）",
];

const TOOLS = [
  {
    href: "/tools/ai-crawler-check",
    icon: IconFileSearch,
    title: "AI 爬虫可访问检查",
    desc: "robots.txt 是否屏蔽了决定「AI 能否引用你」的检索型爬虫，页面能否抓取，正文是否依赖 JavaScript 渲染。",
    tag: "抓取与索引层",
  },
  {
    href: "/tools/citation-readiness",
    icon: IconMicroscope,
    title: "内容可引用性检查",
    desc: "逐项评估内容是否具备被摘录的条件：是否直接回答问题、事实密度、来源与作者、结构可切分、FAQ、夸大表述。",
    tag: "内容与引用层",
  },
  {
    href: "/methods",
    icon: IconBook2,
    title: "方法与数据边界",
    desc: "每个判断依据什么规则、测什么、不测什么，以及为什么我们不承诺「被 AI 推荐」。",
    tag: "可信度基础",
  },
];

const STEPS = [
  {
    icon: IconDatabaseSearch,
    step: "第 1 步",
    body: "以固定 User-Agent 抓取目标页面与 robots.txt，记录状态码、内容类型、耗时、重定向链、字节数。",
  },
  {
    icon: IconShieldCheck,
    step: "第 2 步",
    body: `按 RFC 9309 解析 robots 规则（支持通配符与最长匹配优先），逐个判定 ${AI_BOTS.length} 个已知 AI 爬虫在当前路径上是放行还是阻止。`,
  },
  {
    icon: IconAlignBoxLeftMiddle,
    step: "第 3 步",
    body: "对 HTML 做确定性结构分析：正文占比、标题层级、表格与列表、JSON-LD、作者与时间、数字与单位密度、绝对化表述。",
  },
];

const LAYERS = [
  {
    layer: "抓取与索引",
    which: "工具 A 检查的对象",
    decides:
      "检索型爬虫能否取到你的页面。取不到，你在任何 AI 答案里都不可能被引用——这与内容写得好不好无关。",
    myth: "屏蔽 GPTBot 就等于放弃 ChatGPT 曝光。",
    fact: "GPTBot 只用于训练，不影响检索引用；真正决定曝光的是 OAI-SearchBot 这类检索爬虫。",
    tone: "fail" as const,
  },
  {
    layer: "内容可引用性",
    which: "工具 B 检查的对象",
    decides:
      "页面被取到之后，内容是否「能被直接摘出来用」——能否回答一个具体问题、有没有可核验的事实、段落是否自洽。",
    myth: "内容够长就会被引用。",
    fact: "检索系统按内容块召回。切不开的长文、通篇形容词的段落，被完整采用的概率更低。",
    tone: "warn" as const,
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5">
      {/* ================= 首屏 =================
          按呈现规范：动效只用于第一屏和功能介绍，不整站堆。
          因此 BlurFade 只包在首屏这几个元素上；其余区块为静态渲染 ——
          这同时也保证了首屏以下的内容在任何情况下都可见。 */}
      <section className="py-14 sm:py-20">
        <BlurFade inView delay={0.05}>
          <Badge variant="outline" className="border-primary/20 bg-brand-soft text-primary">
            免费 · 无需注册 · 基于可复核的确定性规则
          </Badge>
        </BlurFade>

        <BlurFade inView delay={0.12}>
          <h1 className="mt-5 max-w-3xl text-4xl leading-[1.15] font-semibold tracking-tight text-balance sm:text-5xl">
            让品牌更容易被 AI 搜索、理解和引用
          </h1>
        </BlurFade>

        <BlurFade inView delay={0.2}>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground sm:text-lg">
            输入一个网址，检查它是否具备被 AI 搜索系统抓取、理解并引用的条件。
            每条结论都给出检查依据和修改示例，你可以自己复核。
          </p>
        </BlurFade>

        <BlurFade inView delay={0.28} className="mt-8 max-w-2xl">
          <CrawlCheckForm />
        </BlurFade>

        <BlurFade inView delay={0.36}>
          <div className="mt-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            {[
              { value: AI_BOTS.length, suffix: " 个", label: "AI 爬虫逐个判定" },
              { value: 8, suffix: " 项", label: "内容可引用性维度" },
              { value: 100, suffix: " %", label: "规则可复算" },
              { value: 0, suffix: " 元", label: "单次检查成本" },
            ].map((s) => (
              <div key={s.label} className="bg-card px-5 py-4">
                <div className="text-2xl font-semibold tracking-tight tabular-nums">
                  <NumberTicker value={s.value} />
                  <span className="text-base font-normal text-muted-foreground">{s.suffix}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </BlurFade>
      </section>

      {/* ================= 爬虫规则跑马灯（全站唯一的持续动效） ================= */}
      <section className="border-y py-6">
        <p className="mb-4 text-center text-xs text-muted-foreground">
          我们检查的是这些爬虫在 robots.txt 中的放行规则 ——
          <strong className="text-foreground">不监测各平台的实际回答内容</strong>
          ，也不代表任何形式的合作或背书
        </p>
        <Marquee pauseOnHover className="[--duration:38s]">
          {CRAWLER_TARGETS.map((p) => (
            <span
              key={p}
              className="mx-1.5 rounded-full border bg-card px-3.5 py-1.5 font-mono text-xs text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </Marquee>
      </section>

      {/* ================= 两个工具入口 ================= */}
      <section className="py-14">
        <h2 className="text-xl font-semibold tracking-tight">两个免费工具</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          分别对应「被 AI 取到」和「被 AI 引用」两个彼此独立的环节。
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {TOOLS.map((t) => (
            <Card key={t.href} className="flex h-full flex-col transition-colors hover:border-primary/30">
              <CardHeader>
                <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft">
                  <t.icon className="size-5 text-primary" />
                </div>
                <CardTitle className="mt-2 text-base">{t.title}</CardTitle>
                <CardDescription className="leading-relaxed">{t.desc}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="font-normal">
                    {t.tag}
                  </Badge>
                  <Button asChild variant="ghost" size="sm" className="-mr-2">
                    <Link href={t.href}>
                      打开
                      <IconArrowRight className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ================= 为什么是这两件事 ================= */}
      <section className="py-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl tracking-tight">
              这两个工具在检查什么，以及为什么是这两件事
            </CardTitle>
            <CardDescription>
              生成式搜索与被引用的链路是两段彼此独立的环节，很多团队把它们混在一起，于是做出了错误的取舍。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {LAYERS.map((row, idx) => (
              <div key={row.layer}>
                {idx > 0 && <Separator className="mb-5" />}
                <div className="grid gap-4 md:grid-cols-[200px_1fr]">
                  <div>
                    <div className="text-sm font-semibold">{row.layer}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{row.which}</div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-foreground/90">{row.decides}</p>
                    <div
                      className={`rounded-lg border p-3 text-sm ${
                        row.tone === "fail" ? "border-fail/25 bg-fail-soft" : "border-warn/25 bg-warn-soft"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <IconCircleCheck
                          className={`mt-0.5 size-4 shrink-0 ${row.tone === "fail" ? "text-fail" : "text-warn"}`}
                        />
                        <div>
                          <span className="font-medium">常见误解：</span>
                          {row.myth}
                          <div className="mt-1 text-muted-foreground">
                            <span className="font-medium">实际：</span>
                            {row.fact}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              我们只报告这两段链路中<strong>客观可观测</strong>的条件，不对任何 AI 平台最终会不会推荐你作出承诺。
              <Link href="/methods" className="ml-1 font-medium text-primary underline-offset-4 hover:underline">
                完整方法与边界 →
              </Link>
            </p>
          </CardContent>
        </Card>
      </section>

      {/* ================= 结果怎么产生 ================= */}
      <section className="py-14">
        <h2 className="text-xl font-semibold tracking-tight">这套检查结果是怎么产生的</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.step} className="h-full bg-muted/40">
              <CardContent className="pt-1">
                <s.icon className="size-5 text-primary" />
                <Badge variant="outline" className="mt-3 bg-background">
                  {s.step}
                </Badge>
                <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          全过程<strong>不调用任何大模型</strong>：同样的输入永远得到同样的输出，每一项结论都可复算 ——
          这也是它能零成本提供的原因。公开接口设有速率限制（每个 IP 每 10 分钟 12 次检查），
          请在限额内使用；批量站点审计请另行联系。
        </p>
      </section>

      {/* ================= 我们自己的可见度 ================= */}
      <section className="pb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">关于我们自己的可见度</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              本站自己遵守同一套标准：公开页面允许检索型 AI 爬虫抓取、每页声明 canonical、提供结构化数据与
              sitemap；而用户的检查结果<strong>默认不被搜索引擎索引</strong>，但<strong>持有链接即可访问</strong>
              —— 也就是说，结果页是「未索引」而非「需要授权」，请不要把含敏感信息的网址提交给本工具。
            </p>
            <p>
              联系：{" "}
              <a
                href={`mailto:${site.contactEmail}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {site.contactEmail}
              </a>
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
