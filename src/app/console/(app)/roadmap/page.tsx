import Link from "next/link";
import {
  IconRoute,
  IconCircleCheck,
  IconArrowRight,
  IconShieldLock,
  IconDatabase,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export const metadata = {
  title: "产品路线图",
  robots: { index: false, follow: false },
};

/** 已上线的核心链路七步 */
const CHAIN = [
  {
    n: 1,
    name: "品牌与竞品",
    href: "/console/brands",
    what: "品牌名 / 别名 / 错误拼写、品牌域名、竞品清单",
    enables: "决定「什么算提到了我们」「哪些域名算自有域」「和谁比」",
  },
  {
    n: 2,
    name: "问题库",
    href: "/console/questions",
    what: "批量录入问题、Persona、意图、漏斗阶段、地区；Query Set 版本化与冻结",
    enables: "冻结后的固定问题集，是「可见度变化」可被证明的前提",
  },
  {
    n: 3,
    name: "事实与证据",
    href: "/console/claims",
    what: "Claim 的创建与审核、证据绑定、证据等级、有效期、禁用表述、冲突检测",
    enables: "事实一致性评估的比对基准；也是内容生产不能乱写的约束",
  },
  {
    n: 4,
    name: "多平台采样",
    href: "/console/sampling",
    what: "按「问题 × 引擎 × 重复次数」生成任务；人工粘贴 + CSV 导入；保存原始回答",
    enables: "把爬虫规则检查升级为真实可见度测量",
  },
  {
    n: 5,
    name: "评估与指标",
    href: "/console/evaluation",
    what: "提及 / 列表排名 / 引用 / 事实一致性抽取；提及率、首推率、Share of Voice、自有域引用率",
    enables: "每个数字都带分子分母与计算口径，可回溯到原始回答",
  },
  {
    n: 6,
    name: "内容与推广",
    href: "/console/content",
    what: "Brief → 内容资产 → 绑定问题与已批准事实 → 审核 → 发布 → 回填 URL",
    enables: "从「指出问题」升级为「交付改进」",
  },
  {
    n: 7,
    name: "获客归因",
    href: "/console/attribution",
    what: "线索状态流转与历史、人工补记触点、First Touch / Last Non-direct / 自述来源",
    enables: "把推广投入与真实商机连起来",
  },
];

const SHIPPED = [
  { name: "AI 爬虫可访问检查", href: "/tools/ai-crawler-check" },
  { name: "内容可引用性检查", href: "/tools/citation-readiness" },
  { name: "可分享结果页", href: "/" },
  { name: "线索闭环", href: "/console/leads" },
  { name: "工具使用记录与来路归因", href: "/console/tool-runs" },
];

const GATES = [
  {
    name: "运营台登录鉴权",
    detail: "目前 /console 无任何鉴权，任何能访问部署地址的人都能看到全部线索与品牌数据。",
  },
  {
    name: "多实例部署能力",
    detail: "当前用 Node 内置 node:sqlite 与进程内内存限流，只适用于单机 + 持久磁盘。多副本必须换 PostgreSQL + 迁移系统 + Redis 限流。",
  },
  {
    name: "域名与生产配置",
    detail: "生产环境需替换默认站点名与联系邮箱，否则启动会被配置守卫拒绝（刻意设计）。",
  },
];

const LIMITS = [
  {
    name: "官方 API 自动采样",
    detail: "当前只做人工粘贴与 CSV 导入。接官方 API 前必须先解决「API 回答与消费端回答不一致」的口径问题，否则指标会失真。",
  },
  {
    name: "内容检查与禁用词扫描",
    detail: "事实绑定已实现，但「自动扫描内容里是否引用了未批准事实 / 禁用表述」尚未实现。",
  },
  {
    name: "基线 vs 复测对比视图",
    detail: "指标快照已按批次存储，但还缺一个「把两次批次并排比较」的界面。",
  },
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <IconRoute className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">产品路线图</h1>
        </div>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          核心业务链的七个模块已全部上线：
          <span className="font-mono text-xs"> 品牌 → 问题库 → 事实库 → 采样 → 评估 → 内容 → 归因</span>。
          下面的「待办」是上线门槛与已知缺口，不再是功能缺失。
        </p>
      </div>

      {/* ---------- 第一阶段 ---------- */}
      <Card className="border-ok/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconCircleCheck className="size-4 text-ok" />
            第一阶段 · 获客与传播（已上线）
          </CardTitle>
          <CardDescription>
            这是目前最有价值的部分：两个免费工具 + 可分享结果页 + 线索闭环。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SHIPPED.map((s) => (
              <Button key={s.name} asChild variant="outline" size="sm">
                <Link href={s.href}>
                  {s.name}
                  <IconArrowRight className="size-3.5" />
                </Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ---------- 核心链路 ---------- */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">第二阶段 · 核心业务链</h2>
          <Badge variant="outline" className="border-ok/25 bg-ok-soft font-normal text-ok">
            已全部上线
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          七个模块按依赖顺序串联。侧边栏的编号与下表一致，按编号顺序操作即可。
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {CHAIN.map((m) => (
          <Card key={m.n}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {m.n}
                </Badge>
                <CardTitle className="text-base">{m.name}</CardTitle>
                <Badge variant="outline" className="ml-auto border-ok/25 bg-ok-soft font-normal text-ok">
                  已上线
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <div className="font-medium">做什么</div>
                <p className="mt-0.5 text-muted-foreground">{m.what}</p>
              </div>
              <div>
                <div className="font-medium">它的产出支撑了什么</div>
                <p className="mt-0.5 text-muted-foreground">{m.enables}</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
                <Link href={m.href}>
                  打开模块
                  <IconArrowRight className="size-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---------- 数据表 ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconDatabase className="size-4 text-muted-foreground" />
            数据表
          </CardTitle>
          <CardDescription>
            38 张表已在 schema 中一次性定义。**之前路线图曾错误地声称这些表「已建好」——
            实际情况是当时 36 张里缺 25 张**，本次已全部补齐。
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 pl-6">模块</TableHead>
                <TableHead className="pr-6">主要数据表</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["1 品牌", "brands / brand_aliases / competitors"],
                ["2 问题库", "query_sets / questions / personas / question_tags / prompt_variants"],
                ["3 事实库", "claims / claim_versions / evidences / prohibited_phrases / review_decisions"],
                ["4 采样", "engines / sampling_runs / sampling_tasks / response_samples / response_citations"],
                ["5 评估", "response_mentions / evaluation_results / human_reviews / metric_snapshots"],
                ["6 内容", "content_briefs / content_assets / content_versions / content_question_links / content_claim_links / distribution_channels / publication_tasks / publications / publication_checks"],
                ["7 归因", "leads / lead_touchpoints / lead_status_history / events"],
              ].map(([m, t]) => (
                <TableRow key={m}>
                  <TableCell className="pl-6 align-top font-medium">{m}</TableCell>
                  <TableCell className="pr-6 align-top font-mono text-xs text-muted-foreground">{t}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ---------- 上线门槛 ---------- */}
      <Card className="border-warn/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldLock className="size-4 text-warn" />
            上线到公网前必须解决
          </CardTitle>
          <CardDescription>这些不是功能，是门槛。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {GATES.map((g) => (
            <div key={g.name}>
              <div className="font-medium">{g.name}</div>
              <p className="mt-0.5 text-muted-foreground">{g.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ---------- 已知缺口 ---------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconAlertTriangle className="size-4 text-muted-foreground" />
            已实现的边界（如实列出）
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {LIMITS.map((g) => (
            <div key={g.name}>
              <div className="font-medium">{g.name}</div>
              <p className="mt-0.5 text-muted-foreground">{g.detail}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="text-sm">验证方式</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            整条业务链有独立的集成测试覆盖（品牌 → 冻结 → 采样 → 评估 → 指标 → 内容 → 归因）：
            <code className="mx-1 font-mono text-xs">node scripts/e2e-chain.ts</code>
            （使用临时数据库，不触碰 data/geo.db）。
          </p>
          <Separator className="my-3" />
          <p className="text-xs">
            方法细节见{" "}
            <Link href="/methods" className="font-medium text-primary underline-offset-4 hover:underline">
              方法与数据边界
            </Link>
            ，部署约束见仓库 README §12。
          </p>
        </CardContent>
      </Card>

      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/console">
            <IconArrowRight className="size-3.5 rotate-180" />
            返回可见度总览
          </Link>
        </Button>
      </div>
    </div>
  );
}
