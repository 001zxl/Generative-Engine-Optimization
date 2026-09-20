import Link from "next/link";
import {
  IconCircleCheck,
  IconAlertTriangle,
  IconCircleX,
  IconInfoCircle,
  IconShieldCheck,
  IconTable,
  IconBook2,
  IconTargetArrow,
  IconClockEdit,
  IconAlignBoxLeftMiddle,
  IconQuote,
} from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { CheckResult, Finding, FindingStatus } from "@/lib/checks/types";
import { STATUS, VERDICT_BANNER, VERDICT_LABEL, scoreTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const ICONS = {
  pass: IconCircleCheck,
  warn: IconAlertTriangle,
  fail: IconCircleX,
  info: IconInfoCircle,
} as const;

export function StatusIcon({ status, className }: { status: FindingStatus; className?: string }) {
  const Icon = ICONS[STATUS[status].icon];
  return <Icon className={cn("size-4 shrink-0", STATUS[status].text, className)} />;
}

export function StatusBadge({ status, short = false }: { status: FindingStatus; short?: boolean }) {
  const meta = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", meta.soft, meta.text)}>
      <StatusIcon status={status} className="size-3.5" />
      {short ? meta.short : meta.label}
    </Badge>
  );
}

/** 结论横幅：一句话结论 + 三类计数 */
export function Verdict({ result }: { result: CheckResult }) {
  const { summary } = result;
  return (
    <Card className={cn("border", VERDICT_BANNER[summary.verdict] ?? "")}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-background/70">
            {VERDICT_LABEL[summary.verdict] ?? summary.verdict}
          </Badge>
          <CardTitle className="text-base leading-snug font-semibold">{summary.headline}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <IconCircleX className="size-4 text-fail" />严重问题 <b className="font-semibold">{summary.fail}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconAlertTriangle className="size-4 text-warn" />需要改进 <b className="font-semibold">{summary.warn}</b>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <IconCircleCheck className="size-4 text-ok" />已通过 <b className="font-semibold">{summary.pass}</b>
        </span>
      </CardContent>
    </Card>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof IconShieldCheck;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

/** 逐条结论：问题是什么 / 为什么影响 / 检查证据 / 怎么修改 —— 四段必须齐 */
export function FindingList({ findings }: { findings: Finding[] }) {
  const openByDefault = findings.filter((f) => f.status === "fail" || f.status === "warn").map((f) => f.id);

  return (
    <Accordion type="multiple" defaultValue={openByDefault} className="gap-3">
      {findings.map((f) => (
        <AccordionItem
          key={f.id}
          value={f.id}
          className={cn(
            "rounded-lg border bg-card px-4",
            f.status === "fail" && "border-fail/30",
            f.status === "warn" && "border-warn/25",
          )}
        >
          <AccordionTrigger className="hover:no-underline">
            <span className="flex items-center gap-2.5 pr-2 text-left">
              <StatusBadge status={f.status} short />
              <span className="text-sm font-semibold">{f.title}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-col gap-4 pb-1">
              <Field icon={IconTargetArrow} label="问题是什么">
                {f.what}
              </Field>
              <Field icon={IconBook2} label="为什么影响 AI 发现与引用">
                {f.why}
              </Field>
              <Field icon={IconTable} label="检查证据（可复核）">
                <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
                  {f.evidence}
                </pre>
              </Field>
              {f.fix && (
                <Field icon={IconClockEdit} label="怎么修改">
                  <p>{f.fix}</p>
                  {f.fixCode && (
                    <pre className="mt-2 overflow-auto rounded-md bg-foreground p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-background">
                      {f.fixCode}
                    </pre>
                  )}
                </Field>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: typeof IconShieldCheck;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </div>
        <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function DimensionTable({
  dimensions,
}: {
  dimensions: Array<{ key: string; label: string; score: number; weight: number; basis: string }>;
}) {
  const ICONS_BY_KEY: Record<string, typeof IconShieldCheck> = {
    direct_answer: IconQuote,
    fact_density: IconTargetArrow,
    sources: IconBook2,
    authorship: IconClockEdit,
    structure: IconAlignBoxLeftMiddle,
    faq: IconBook2,
    restraint: IconShieldCheck,
    extractable: IconAlignBoxLeftMiddle,
  };

  return (
    <div className="flex flex-col gap-3">
      {dimensions.map((d) => {
        const tone = scoreTone(d.score);
        const Icon = ICONS_BY_KEY[d.key] ?? IconShieldCheck;
        return (
          <div key={d.key} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{d.label}</span>
              <span className={cn("ml-auto text-lg font-semibold tabular-nums", STATUS[tone].text)}>
                {d.score}
              </span>
              <Badge variant="outline" className="font-normal">
                权重 {(d.weight * 100).toFixed(0)}%
              </Badge>
            </div>
            <Progress value={d.score} className="mt-2.5 h-1.5" />
            <p className="mt-2.5 text-xs text-muted-foreground">
              <span className="font-medium">计算方式：</span>
              {d.basis}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** 数据边界声明：每个结果页都必须出现 */
export function Disclaimer({ text }: { text: string }) {
  return (
    <Card className="bg-muted/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <IconInfoCircle className="size-4 text-muted-foreground" />
          方法与数据边界（请先读这段）
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>{text}</p>
        <Separator />
        <p>
          完整说明见{" "}
          <Link href="/methods" className="font-medium text-primary underline-offset-4 hover:underline">
            方法与数据边界
          </Link>
          。
        </p>
      </CardContent>
    </Card>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
