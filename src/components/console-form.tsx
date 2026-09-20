import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

/** 表单字段外壳：统一标签与提示的排版 */
export function Field({
  label,
  children,
  hint,
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** 内联小表单：用于卡片内的「添加」操作 */
export function InlineForm({
  action,
  children,
  submitLabel,
  className = "",
}: {
  action: (fd: FormData) => Promise<void>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
}) {
  return (
    <form action={action} className={`flex flex-wrap items-end gap-2 ${className}`}>
      {children}
      <Button type="submit" size="sm" variant="outline">
        {submitLabel}
      </Button>
    </form>
  );
}

/** 危险操作：删除等 */
export function DangerForm({
  action,
  hidden,
  label = "删除",
  confirm = true,
}: {
  action: (fd: FormData) => Promise<void>;
  hidden: Record<string, string>;
  label?: string;
  confirm?: boolean;
}) {
  return (
    <form action={action} className="inline">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        className="h-6 px-1.5 text-xs text-muted-foreground hover:text-fail"
        title={confirm ? "该操作不可撤销，请确认" : undefined}
      >
        {label}
      </Button>
    </form>
  );
}

/** 带标题的区块卡片 */
export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {action && <div className="ml-auto">{action}</div>}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** 页面标题 */
export function PageHead({
  title,
  description,
  icon: Icon,
  badge,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {Icon && <Icon className="size-5 text-muted-foreground" />}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {badge}
      </div>
      <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function Chip({ children, onRemove }: { children: React.ReactNode; onRemove?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 text-xs">
      {children}
      {onRemove}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "草稿", cls: "border-border text-muted-foreground" },
    pending_review: { label: "待审核", cls: "border-warn/25 bg-warn-soft text-warn" },
    approved: { label: "已批准", cls: "border-ok/25 bg-ok-soft text-ok" },
    rejected: { label: "已驳回", cls: "border-fail/25 bg-fail-soft text-fail" },
    expired: { label: "已过期", cls: "border-border text-muted-foreground" },
    frozen: { label: "已冻结", cls: "border-primary/25 bg-brand-soft text-primary" },
    active: { label: "进行中", cls: "border-primary/25 bg-brand-soft text-primary" },
    in_review: { label: "待审核", cls: "border-warn/25 bg-warn-soft text-warn" },
    published: { label: "已发布", cls: "border-ok/25 bg-ok-soft text-ok" },
    archived: { label: "已归档", cls: "border-border text-muted-foreground" },
    done: { label: "已完成", cls: "border-ok/25 bg-ok-soft text-ok" },
    dropped: { label: "已放弃", cls: "border-border text-muted-foreground" },
    open: { label: "进行中", cls: "border-primary/25 bg-brand-soft text-primary" },
    planned: { label: "计划中", cls: "border-border text-muted-foreground" },
    verified: { label: "已验证", cls: "border-ok/25 bg-ok-soft text-ok" },
  };
  const m = map[status] ?? { label: status, cls: "border-border text-muted-foreground" };
  return (
    <Badge variant="outline" className={`font-normal ${m.cls}`}>
      {m.label}
    </Badge>
  );
}
