"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { IconArrowRight, IconCopy, IconCheck, IconDownload, IconGlobe, IconCode } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function track(name: string, extra: Record<string, unknown> = {}) {
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, path: window.location.pathname, ...extra }),
    keepalive: true,
  }).catch(() => {});
}

/* ------------------------- 工具 A：AI 爬虫检查 ------------------------- */
export function CrawlCheckForm({ hint = true }: { hint?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/crawl-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { shareSlug?: string; error?: string };
      if (!res.ok || !data.shareSlug) {
        setError(data.error ?? "检查失败，请稍后重试。");
        setBusy(false);
        return;
      }
      track("tool_run");
      toast.success("检查完成，正在打开结果页…");
      router.push(`/r/${data.shareSlug}`);
    } catch {
      setError("网络异常，请稍后重试。");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="输入网站地址，例如 example.com"
          aria-label="要检查的网址"
          autoComplete="url"
          spellCheck={false}
          className="h-11 text-[15px]"
        />
        <Button type="submit" size="lg" disabled={busy} className="h-11 shrink-0 px-6">
          {busy ? "正在检查…" : "免费检查 AI 可发现性"}
          {!busy && <IconArrowRight className="size-4" />}
        </Button>
      </div>
      {hint && (
        <p className="mt-2.5 text-xs text-muted-foreground">
          无需注册。检查项：robots.txt 对 AI 爬虫的放行情况 · 页面可抓取性 · 正文是否依赖 JavaScript ·
          canonical / noindex · 结构化数据 · sitemap 收录。
        </p>
      )}
      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

/* --------------------- 工具 B：内容可引用性检查 --------------------- */
export function CitationCheckForm() {
  const router = useRouter();
  const [mode, setMode] = useState("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [heading, setHeading] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tools/content-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "url" ? { url, heading } : { text, heading }),
      });
      const data = (await res.json()) as { shareSlug?: string; error?: string };
      if (!res.ok || !data.shareSlug) {
        setError(data.error ?? "检查失败，请稍后重试。");
        setBusy(false);
        return;
      }
      track("tool_run");
      router.push(`/r/${data.shareSlug}`);
    } catch {
      setError("网络异常，请稍后重试。");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full">
      <Tabs value={mode} onValueChange={setMode} className="mb-4">
        <TabsList>
          <TabsTrigger value="url">
            <IconGlobe className="size-3.5" />
            用页面地址
          </TabsTrigger>
          <TabsTrigger value="text">
            <IconCode className="size-3.5" />
            粘贴正文
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-4">
        {mode === "url" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="cite-url">页面地址</Label>
            <Input
              id="cite-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="example.com/blog/post"
              spellCheck={false}
              className="h-11"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="cite-text">
              粘贴正文（支持 HTML 源码或纯文本，上限 20 万字符）
            </Label>
            <Textarea
              id="cite-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="把文章正文粘贴到这里…"
              className="min-h-40 font-mono text-xs leading-relaxed"
            />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="cite-heading">
            这一页回答的核心问题
            <span className="ml-2 font-normal text-muted-foreground">可选，用于判断「是否直接作答」</span>
          </Label>
          <Input
            id="cite-heading"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            placeholder="例如：铝合金型材的最小起订量是多少？"
          />
        </div>

        <Button type="submit" size="lg" disabled={busy} className="h-11 self-start px-6">
          {busy ? "正在评估…" : "评估内容可引用性"}
          {!busy && <IconArrowRight className="size-4" />}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

/* ---------------------------- 结果页操作 ---------------------------- */
export function ResultActions({ slug, isPublic }: { slug: string; isPublic: boolean }) {
  const [pub, setPub] = useState(isPublic);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function publish() {
    setBusy(true);
    const res = await fetch(`/api/tool-runs/${slug}/publish`, { method: "POST" });
    if (res.ok) {
      setPub(true);
      track("tool_share");
      toast.success("已允许搜索引擎索引此结果");
    } else {
      toast.error("操作失败，请稍后重试");
    }
    setBusy(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(window.location.href).catch(() => {});
    setCopied(true);
    track("tool_share");
    toast.success("结果链接已复制");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={copy} type="button">
        {copied ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
        {copied ? "已复制" : "复制结果链接"}
      </Button>
      {!pub ? (
        <Button variant="outline" size="sm" onClick={publish} disabled={busy} type="button">
          {busy ? "处理中…" : "允许搜索引擎索引此结果"}
        </Button>
      ) : (
        <Badge variant="outline" className="h-7">
          此结果已允许被索引
        </Badge>
      )}
      <Button variant="outline" size="sm" asChild>
        <a href={`/api/tool-runs/${slug}/export`} onClick={() => track("tool_export")}>
          <IconDownload className="size-3.5" />
          导出 JSON
        </a>
      </Button>
    </div>
  );
}

/* ------------------------------ 线索表单 ------------------------------ */
export function LeadForm({ source, toolRunId }: { source: string; toolRunId?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setState("busy");
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: fd.get("email"),
        company: fd.get("company"),
        website: fd.get("website"),
        message: fd.get("message"),
        selfReportedSource: fd.get("selfReportedSource"),
        honeypot: fd.get("company_url"),
        source,
        toolRunId,
        landingPath: window.location.pathname,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(data.error ?? "提交失败，请稍后重试。");
      setState("idle");
      return;
    }
    track("lead_submit");
    toast.success("已收到，我们会尽快回复");
    setState("done");
  }

  if (state === "done") {
    return (
      <Card className="border-ok/30 bg-ok-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconCheck className="size-4 text-ok" />
            已收到
          </CardTitle>
          <CardDescription>
            我们会在两个工作日内回复，并附上针对你网站的进一步说明。本页结果默认不会被搜索引擎索引。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">需要更具体的建议？</CardTitle>
        <CardDescription>
          留一个邮箱，我们按你上面的检查结果给一份针对性的说明。不做群发，不发营销邮件。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="lf-email">邮箱 *</Label>
              <Input id="lf-email" name="email" type="email" required placeholder="you@company.com" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lf-company">公司</Label>
              <Input id="lf-company" name="company" placeholder="公司名称" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lf-site">网站</Label>
              <Input id="lf-site" name="website" placeholder="example.com" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="lf-src">你是从哪里了解到我们的？</Label>
              <Select name="selfReportedSource">
                <SelectTrigger id="lf-src" className="w-full">
                  <SelectValue placeholder="不填" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ai_answer">AI 回答里看到的</SelectItem>
                  <SelectItem value="search">搜索引擎</SelectItem>
                  <SelectItem value="social">公众号 / 小红书 / 视频</SelectItem>
                  <SelectItem value="friend">朋友或同行推荐</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="lf-msg">想解决的问题（可选）</Label>
            <Textarea
              id="lf-msg"
              name="message"
              className="min-h-20 font-sans text-sm"
              placeholder="例如：海外客户问 ChatGPT 推荐供应商时，我们从来没被提到过。"
            />
          </div>

          {/* 蜜罐字段：正常用户看不到，也不会填。
              仍使用 shadcn Input 以保持全站表单控件统一（它会原样透传 name / tabIndex 等原生属性）。 */}
          <Input
            type="text"
            name="company_url"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute left-[-9999px] size-px"
          />

          <div>
            <Button type="submit" disabled={state === "busy"}>
              {state === "busy" ? "提交中…" : "提交"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            提交即表示同意我们为回复本次咨询而保存这些信息。可随时邮件要求删除。
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
