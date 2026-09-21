import type { Metadata } from "next";
import { IconLock, IconAlertTriangle } from "@tabler/icons-react";
import { isAuthConfigured } from "@/lib/auth";
import { site } from "@/lib/site";
import { Field } from "@/components/console-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { login } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "运营台登录",
  robots: { index: false, follow: false },
};

const ERROR_TEXT: Record<string, string> = {
  bad: "口令不正确。",
  locked: "尝试次数过多，请 10 分钟后再试。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; unconfigured?: string }>;
}) {
  const sp = await searchParams;
  const configured = isAuthConfigured();
  const err = sp.error ? ERROR_TEXT[sp.error] ?? "登录失败。" : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-5 py-20">
      <div className="mb-6 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          G
        </span>
        <span className="font-semibold">{site.name}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <IconLock className="size-4 text-muted-foreground" />
            运营台登录
          </CardTitle>
          <CardDescription>
            运营台包含线索联系方式与品牌数据，需要口令访问。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!configured && (
            <Alert className="mb-4 border-warn/30 bg-warn-soft">
              <IconAlertTriangle className="size-4 text-warn" />
              <AlertTitle>鉴权未配置，访问已被拒绝</AlertTitle>
              <AlertDescription className="text-xs">
                这是**失败关闭**设计：缺少 <code className="font-mono">CONSOLE_PASSWORD</code> 或{" "}
                <code className="font-mono">AUTH_SECRET</code> 时不会放行任何人。
                请在 <code className="font-mono">.env</code> 中配置后重启，参考{" "}
                <code className="font-mono">.env.example</code>。
              </AlertDescription>
            </Alert>
          )}

          {err && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{err}</AlertDescription>
            </Alert>
          )}

          <form action={login} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={sp.next ?? "/console"} />
            <Field label="运营台口令" htmlFor="pw">
              <Input id="pw" name="password" type="password" required autoFocus autoComplete="current-password" />
            </Field>
            <Button type="submit" disabled={!configured}>
              登录
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        会话为 HMAC 签名的 HttpOnly Cookie，有效期 12 小时，服务端不存 session。
        节流按客户端 IP 计（8 次 / 10 分钟），另有全局上限 30 次 / 10 分钟兜住分布式尝试。
      </p>
    </div>
  );
}
