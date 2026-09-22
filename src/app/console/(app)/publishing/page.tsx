import Link from "next/link";
import { IconSend } from "@tabler/icons-react";
import { PageHead, SectionCard, Field } from "@/components/console-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listAssets } from "@/lib/db/repo-domains";
import { listPublicationDispatches, listPublicationChecks, publishingChannelStatus, type PublishSnapshot } from "@/lib/publishing";
import { queuePublication, executePublication, reconcilePublication, resetPublication, recheckPublication } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "发布执行与复测", robots: { index: false, follow: false } };

interface PublishGateView { id: string; label: string; ok: boolean; detail: string }

/** gates_json 结构由本仓库写入；解析失败按「无门槛结果」处理，不伪造通过。 */
function parsedGates(raw: string | null | undefined): PublishGateView[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PublishGateView[];
    return Array.isArray(parsed) ? parsed.filter((g) => g && typeof g.label === "string") : [];
  } catch {
    return [];
  }
}

const statuses: Record<string, string> = { pending: "待执行", sending: "执行中 / 待核对", succeeded: "已发布", failed: "失败，可修正后重试", uncertain: "远端状态未知，需核对" };
const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm";

export default async function PublishingPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const params = await searchParams;
  const assets = listAssets().filter((a) => ["approved", "published"].includes(a.status) && a.body_md?.trim());
  const channels = publishingChannelStatus();
  const jobs = listPublicationDispatches();
  const checks = listPublicationChecks();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead icon={IconSend} title="发布执行与复测" description="审核通过的内容可发布到本站知识页、WordPress 或已配置的发布服务。执行成功后自动记录 URL，再检查公开可访问性。" />
      {(params.error || params.message) && <div role="status" className={`rounded-lg border p-3 text-sm ${params.error ? "border-fail/30 bg-fail-soft text-fail" : "border-ok/30 bg-ok-soft text-ok"}`}>{params.error || params.message}</div>}
      <SectionCard title="准备发布" description="只列出审核通过且正文非空的内容。本站发布后访客可以打开知识页；第三方发布需要先配置对应账号。">
        <div className="mb-4 flex flex-wrap gap-2">{channels.map((c) => <Badge key={c.id} variant="outline">{c.name} · {c.configured ? "已就绪" : "未配置"}</Badge>)}</div>
        <form action={queuePublication} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Field label="已审核内容" htmlFor="publish-asset"><select id="publish-asset" name="assetId" required className={selectClass}><option value="">请选择内容</option>{assets.map((a) => <option value={a.id} key={a.id}>{a.title}</option>)}</select></Field>
          <Field label="发布目标" htmlFor="publish-channel"><select id="publish-channel" name="channel" className={selectClass}>{channels.map((c) => <option value={c.id} key={c.id} disabled={!c.configured}>{c.name}{!c.configured && "（未配置）"}</option>)}</select></Field>
          <Button type="submit" disabled={!assets.length}>创建发布任务</Button>
        </form>
        {!assets.length && <p className="mt-3 text-sm text-muted-foreground">先到 <Link href="/console/content" className="underline">内容与推广</Link> 填写正文并审核通过。</p>}
        <p className="mt-4 text-xs text-muted-foreground">服务器配置：WordPress 使用 WORDPRESS_BASE_URL、WORDPRESS_USERNAME、WORDPRESS_APP_PASSWORD；Webhook 使用 PUBLISH_WEBHOOK_URL、PUBLISH_WEBHOOK_TOKEN。凭据不在页面或数据库保存。Webhook 必须实现幂等处理并返回已发布 URL，不能只返回“已接收”。</p>
      </SectionCard>
      <SectionCard title="发布任务" description="相同内容与渠道复用任务；超时或结果未知时暂停重发，避免重复文章。正文与证据在创建任务时保存快照。">
        {!jobs.length && <p className="text-sm text-muted-foreground">还没有发布任务。</p>}
        <div className="flex flex-col gap-4">{jobs.map((job) => {
          const snapshot = JSON.parse(job.snapshot_json) as PublishSnapshot;
          const check = checks.find((c) => c.publication_id === job.publication_id);
          const channel = channels.find((c) => c.id === job.channel)!;
          const unknown = ["sending", "uncertain"].includes(job.status);
          return <div className="rounded-lg border p-4" key={job.id}>
            <div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{snapshot.title}</h2><Badge variant="outline">{channel.name}</Badge><Badge variant="outline">{statuses[job.status]}</Badge></div>
            <p className="mt-2 text-xs text-muted-foreground">创建于 {job.created_at.slice(0, 16).replace("T", " ")} UTC · 已尝试 {job.attempts} 次 · 证据 {snapshot.evidences.length} 条</p>
            <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">核对发布正文</summary><div className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3">{snapshot.body}</div></details>
            {job.error && <p className="mt-3 text-sm text-fail">{job.error}</p>}
            {job.published_url && <a className="mt-3 block break-all text-sm text-primary underline" href={job.published_url} target="_blank" rel="noopener noreferrer">{job.published_url}</a>}
            <div className="mt-3 flex flex-wrap gap-2">
              {["pending", "failed"].includes(job.status) && <form action={executePublication}><input type="hidden" name="id" value={job.id} /><Button type="submit" size="sm" disabled={!channel.configured}>{job.status === "failed" ? "修正后重试" : `执行发布到${channel.name}`}</Button></form>}
              {job.status === "succeeded" && <form action={recheckPublication}><input type="hidden" name="id" value={job.id} /><Button size="sm" variant="outline" type="submit">复测已发布 URL</Button></form>}
            </div>
            {check && <div className="mt-3">
              <p className={`text-xs ${check.ok ? "text-ok" : "text-fail"}`}>最近复测：{check.note}（{check.checked_at.slice(0, 16).replace("T", " ")} UTC）</p>
              {parsedGates(check.gates_json).length > 0 && <ul className="mt-2 space-y-1">
                {parsedGates(check.gates_json).map((g) => <li key={g.id} className="flex items-start gap-2 text-xs">
                  <span className={g.ok ? "text-ok" : "text-fail"}>{g.ok ? "通过" : "未通过"}</span>
                  <span className="font-medium">{g.label}</span>
                  <span className="text-muted-foreground">{g.detail}</span>
                </li>)}
              </ul>}
            </div>}
            {unknown && <div className="mt-4 space-y-4 border-t pt-4">
              <p className="text-sm text-muted-foreground">请到目标平台查找标题“{snapshot.title}”。若已发布，核对正文后补回链接；若确认没有发布，可恢复待执行状态。请求仍执行时请等待至少一分钟。</p>
              {job.channel !== "own_site" && <form action={reconcilePublication} className="space-y-2"><input type="hidden" name="id" value={job.id} /><Input name="url" type="url" required placeholder="https://目标平台/已发布文章" aria-label="人工核对的发布 URL" /><label className="flex items-center gap-2 text-xs"><input name="confirmed" type="checkbox" required />我已打开目标平台，核对这篇内容确实发布成功</label><Button type="submit" size="sm" variant="outline">补回成功 URL</Button></form>}
              <form action={resetPublication} className="space-y-2"><input type="hidden" name="id" value={job.id} /><label className="flex items-center gap-2 text-xs"><input name="confirmedAbsent" type="checkbox" required />我已检查目标平台，确认此任务没有发布成功</label><Button type="submit" size="sm" variant="outline">恢复待执行</Button></form>
            </div>}
          </div>;
        })}</div>
      </SectionCard>
      <p className="text-sm text-muted-foreground">发布与 URL 检查不等于 AI 收录或推荐提升。发布后请在 <Link className="underline" href="/console/experiments">基线与复测</Link> 使用相同问题集、平台与条件持续验证。</p>
    </div>
  );
}
