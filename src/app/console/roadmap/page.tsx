import Link from "next/link";
import {
  IconRoute,
  IconCircleCheck,
  IconCircleDashed,
  IconArrowRight,
  IconShieldLock,
  IconDatabase,
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

/**
 * 产品路线图。
 *
 * 设计取舍：原来把「品牌 / 问题库 / 事实库 / 采样」做成四个独立入口，
 * 点进去都是空页面 —— 那只会让日常运营导航里塞满无处可去的链接。
 * 现在收敛成这一页，把"要做什么、为什么、依赖什么、数据表是否就位"一次说清。
 */

interface Module {
  n: number;
  name: string;
  what: string;
  why: string;
  tables: string[];
  status: "next" | "planned";
}

const MODULES: Module[] = [
  {
    n: 1,
    name: "品牌实体、别名、业务线与竞品",
    what: "维护品牌名 / 别名 / 错误拼写 / 曾用名、域名、业务线，以及竞品与其别名。",
    why: "后面所有环节都依赖它：提及抽取要知道「什么算提到了我们」，引用判定要知道「哪些域名是我们自己的」，竞品对比要知道「和谁比」。",
    tables: ["brands", "brand_aliases", "competitors"],
    status: "next",
  },
  {
    n: 2,
    name: "客户问题库",
    what: "问题的新增/导入/去重/打标，Persona、意图、漏斗阶段、地区、语言；Query Set 版本化与**冻结**。",
    why: "没有一份冻结的固定问题集，复测就没有可比性。冻结版本不可直接编辑、只能新建版本 —— 这是让「可见度变化」可被证明的前提。",
    tables: ["query_sets", "questions", "personas", "prompt_variants"],
    status: "next",
  },
  {
    n: 3,
    name: "品牌事实与证据库",
    what: "Claim 的创建与审核、绑定来源链接与证据等级、有效期与过期提醒、禁用表述、审核记录。",
    why: "它是「事实一致性」评估的比对基准：AI 说错了什么，要有权威版本可对照。也是内容生产不能乱写的约束来源。",
    tables: ["claims", "claim_versions", "evidences", "claim_evidence_links", "prohibited_phrases"],
    status: "planned",
  },
  {
    n: 4,
    name: "多平台采样",
    what: "先支持**人工粘贴**与 CSV 导入，保存原始答案、引用 URL、时间、地区、模型版本、采样方式；确认稳定后再评估官方 API。",
    why: "这是把「爬虫规则检查」升级为「真实可见度测量」的关键一步。必须先做人工采样：一是国内平台基本没有合规的公开 API，二是官方 API 与消费端回答存在差异，混在一起会得到错误结论。",
    tables: ["engines", "sampling_runs", "response_samples", "response_citations"],
    status: "planned",
  },
  {
    n: 5,
    name: "评估体系",
    what: "提及率、首推率、竞品 Share of Voice、自有域引用率、事实一致性；全部可回溯到原始回答。",
    why: "指标必须能点回原始样本，否则就是黑盒分数。不同采样方式、问题版本、地区的样本不直接合并比较。",
    tables: ["response_mentions", "evaluation_results", "human_reviews", "metric_snapshots"],
    status: "planned",
  },
  {
    n: 6,
    name: "内容任务",
    what: "从问题缺口生成 Content Brief，绑定已批准的事实与证据，记录发布 URL 与渠道，形成「缺口 → 内容 → 发布 → 复测」的闭环。",
    why: "没有这一步，诊断报告只能指出问题，无法交付改进，也就无法支撑持续收费。",
    tables: ["content_briefs", "content_assets", "content_versions", "publication_tasks", "publications"],
    status: "planned",
  },
  {
    n: 7,
    name: "获客归因",
    what: "打通「工具使用 → 结果分享 → 留资 → 跟进 → 成交」，支持 First Touch、Last Non-direct 与自述来源。",
    why: "第一阶段已有线索与事件表，缺的是状态流转与多触点归因，以及每一层漏斗的可追溯性。",
    tables: ["leads", "lead_touchpoints", "lead_status_history", "events"],
    status: "planned",
  },
];

const SHIPPED = [
  { name: "AI 爬虫可访问检查", href: "/tools/ai-crawler-check" },
  { name: "内容可引用性检查", href: "/tools/citation-readiness" },
  { name: "可分享结果页", href: "/" },
  { name: "线索闭环（结果页留资 → 运营台可见）", href: "/console/leads" },
  { name: "工具使用记录与来路归因", href: "/console/tool-runs" },
];

const P0_FIXES = [
  "四个「批次 2 待建」空页面已收敛为本页，运营导航不再指向空入口",
  "「私有结果」表述改为「未索引、持链接可访问」—— 未索引不等于有访问权限",
  "删除「可以免费、无限次使用」，改为说明真实限流额度",
  "平台覆盖类文案改为「检查相关爬虫规则」，明确不监测各平台回答内容",
  "爬虫名册每条结论均可点回一手来源（sourceUrl / sourceTitle / verifiedAt）",
  "生产环境默认配置校验：未替换默认域名与邮箱时拒绝启动",
];

export default function RoadmapPage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="flex items-center gap-2">
        <IconRoute className="size-5 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">产品路线图</h1>
      </div>
      <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
        目前真正在工作的只有两个检测工具。要形成完整的 GEO 获客推广系统，
        还需要补齐下面这条核心业务链：
        <span className="font-mono text-xs"> 问题库 → 证据库 → 采样 → 评估 → 内容任务 → 归因</span>。
      </p>

      {/* ---------- 已上线 ---------- */}
      <Card className="mt-6 border-ok/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconCircleCheck className="size-4 text-ok" />
            已上线（第一阶段）
          </CardTitle>
          <CardDescription>
            这一层是「先获客、先传播」，也是目前最有价值的部分，不会因为后续建设而删改。
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

      {/* ---------- 核心业务链 ---------- */}
      <h2 className="mt-10 text-lg font-semibold tracking-tight">待补的核心业务链</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        数据表已按架构文档建好（批次 1 一次性建齐，避免中途迁移），缺的是界面与流程。
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {MODULES.map((m) => (
          <Card key={m.n}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {m.n}
                </Badge>
                <CardTitle className="text-base">{m.name}</CardTitle>
                {m.status === "next" ? (
                  <Badge variant="outline" className="ml-auto border-primary/25 bg-brand-soft text-primary">
                    下一步
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-muted-foreground">
                    <IconCircleDashed className="size-3.5" />
                    待排期
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <div className="font-medium">做什么</div>
                <p className="mt-0.5 text-muted-foreground">{m.what}</p>
              </div>
              <div>
                <div className="font-medium">为什么必须先做它</div>
                <p className="mt-0.5 text-muted-foreground">{m.why}</p>
              </div>
              <div>
                <div className="flex items-center gap-2 font-medium">
                  <IconDatabase className="size-3.5 text-muted-foreground" />
                  已就位的数据表
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.tables.map((t) => (
                    <code key={t} className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-xs">
                      {t}
                    </code>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ---------- 更远 ---------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconShieldLock className="size-4 text-muted-foreground" />
            上线到公网前必须解决
          </CardTitle>
          <CardDescription>这些不是功能，是门槛。</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">运营台登录鉴权</strong> —— 目前
              <code className="mx-1 font-mono text-xs">/console</code>
              无任何鉴权，任何能访问部署地址的人都能看到全部线索。
            </li>
            <li>
              <strong className="text-foreground">多实例部署能力</strong> —— 当前用 Node 内置
              <code className="mx-1 font-mono text-xs">node:sqlite</code>
              与内存限流，只适用于<strong className="text-foreground">单机 + 持久磁盘</strong>。
              多实例前必须换成 PostgreSQL + 迁移系统 + Redis 限流。
            </li>
            <li>
              <strong className="text-foreground">域名与部署配置</strong> —— 生产环境需替换默认站点名与联系邮箱，
              否则启动会失败（这是刻意设计的守护）。
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* ---------- 本批已做的修正 ---------- */}
      <Card className="mt-6 bg-muted/40">
        <CardHeader>
          <CardTitle className="text-base">本轮已完成的收敛修正</CardTitle>
          <CardDescription>来自一次外部评审，均为表述准确性与导航结构问题。</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
            {P0_FIXES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <Separator className="my-4" />
          <p className="text-xs text-muted-foreground">
            方法细节见{" "}
            <Link href="/methods" className="font-medium text-primary underline-offset-4 hover:underline">
              方法与数据边界
            </Link>
            ，部署约束见仓库 README。
          </p>
        </CardContent>
      </Card>

      <div className="mt-6">
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
