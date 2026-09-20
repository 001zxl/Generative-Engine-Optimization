import Link from "next/link";
import { IconBuildingStore, IconPlus, IconArrowRight } from "@tabler/icons-react";
import * as R from "@/lib/db/repo-domains";
import { PageHead, SectionCard, Field, InlineForm, DangerForm, Chip, StatusPill } from "@/components/console-form";
import { EmptyState } from "@/components/check-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  aliasAdd,
  aliasRemove,
  brandCreate,
  brandDelete,
  brandUpdate,
  competitorAdd,
  competitorRemove,
} from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "品牌与竞品", robots: { index: false, follow: false } };

/**
 * 模块 1：品牌实体、别名、业务线、竞品。
 *
 * 它是后面所有环节的判定基准：
 *  - 提及抽取要知道「什么算提到了我们」→ 别名
 *  - 引用判定要知道「哪些域名是我们自己的」→ 品牌域名
 *  - 竞品对比要知道「和谁比」→ 竞品清单
 */
export default function BrandsPage() {
  const brands = R.listBrands();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHead
        icon={IconBuildingStore}
        title="品牌与竞品"
        description="品牌实体是后续所有环节的判定基准：别名决定「什么算提到了我们」，品牌域名决定「哪些引用算自有域」，竞品清单决定「和谁比」。"
        badge={<StatusPill status={brands.length > 0 ? "active" : "draft"} />}
      />

      {brands.length === 0 && (
        <EmptyState>
          还没有品牌实体。
          <br />
          <span className="text-xs">先在下面创建目标品牌，之后才能建立问题库与采样。</span>
        </EmptyState>
      )}

      {brands.map((b) => {
        const aliases = R.listAliases(b.id);
        const comps = R.listCompetitors(b.id);
        return (
          <Card key={b.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{b.name}</CardTitle>
                <StatusPill status={b.status} />
                <span className="ml-auto text-xs text-muted-foreground">
                  {b.alias_count} 个别名 · {b.competitor_count} 个竞品
                </span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <form action={brandUpdate} className="grid gap-3 sm:grid-cols-3">
                <input type="hidden" name="id" value={b.id} />
                <Field label="品牌名">
                  <Input name="name" defaultValue={b.name} />
                </Field>
                <Field label="品牌域名" hint="用于判定「自有域引用」">
                  <Input name="domain" defaultValue={b.domain ?? ""} placeholder="example.com" />
                </Field>
                <Field label="一句话描述">
                  <Input
                    name="description"
                    defaultValue={b.description ?? ""}
                    placeholder="面向欧洲中小品牌的铝型材加工"
                  />
                </Field>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm" variant="outline">
                    保存基本信息
                  </Button>
                </div>
              </form>

              <div>
                <div className="text-sm font-medium">别名 / 错误拼写 / 曾用名</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  提及抽取会把这些一并识别为目标品牌。少了别名，指标会系统性偏低。
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {aliases.length === 0 && <span className="text-xs text-muted-foreground">（暂无）</span>}
                  {aliases.map((a) => (
                    <Chip
                      key={a.id}
                      onRemove={<DangerForm action={aliasRemove} hidden={{ id: a.id }} label="×" confirm={false} />}
                    >
                      <span className="font-mono">{a.alias}</span>
                      <span className="text-muted-foreground">·{a.kind}</span>
                    </Chip>
                  ))}
                </div>
                <InlineForm action={aliasAdd} submitLabel="添加别名" className="mt-2">
                  <input type="hidden" name="brandId" value={b.id} />
                  <Input name="alias" placeholder="别名或错误拼写" className="h-8 w-48" required />
                </InlineForm>
              </div>

              <div>
                <div className="text-sm font-medium">竞品</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  用于计算 Share of Voice：目标品牌提及次数 ÷ 全部被跟踪实体提及次数。
                </p>
                {comps.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">（暂无）</p>
                ) : (
                  <div className="mt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>竞品名</TableHead>
                          <TableHead>域名</TableHead>
                          <TableHead className="w-16" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {comps.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">{c.name}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {c.domain ?? "—"}
                            </TableCell>
                            <TableCell>
                              <DangerForm action={competitorRemove} hidden={{ id: c.id }} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <InlineForm action={competitorAdd} submitLabel="添加竞品" className="mt-2">
                  <input type="hidden" name="brandId" value={b.id} />
                  <Input name="name" placeholder="竞品名称" className="h-8 w-44" required />
                  <Input name="domain" placeholder="域名（可选）" className="h-8 w-44" />
                </InlineForm>
              </div>

              <div className="flex justify-end border-t pt-3">
                <DangerForm action={brandDelete} hidden={{ id: b.id }} label="删除该品牌及其别名与竞品" />
              </div>
            </CardContent>
          </Card>
        );
      })}

      <SectionCard title="新增品牌" description="通常只需要一个目标品牌（你自己），竞品挂在它下面。">
        <form action={brandCreate} className="grid gap-3 sm:grid-cols-3">
          <Field label="品牌名" htmlFor="nb-name">
            <Input id="nb-name" name="name" placeholder="Nordic Profiles" required />
          </Field>
          <Field label="品牌域名" htmlFor="nb-domain" hint="用于判定自有域引用">
            <Input id="nb-domain" name="domain" placeholder="nordic-profiles.se" />
          </Field>
          <Field label="一句话描述" htmlFor="nb-desc">
            <Input id="nb-desc" name="description" placeholder="面向欧洲中小品牌的铝型材加工" />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm">
              <IconPlus className="size-3.5" />
              创建品牌
            </Button>
          </div>
        </form>
      </SectionCard>

      <Card className="bg-muted/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <IconArrowRight className="size-4 text-muted-foreground" />
            下一步
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          品牌建好后，去{" "}
          <Link href="/console/questions" className="font-medium text-primary underline-offset-4 hover:underline">
            问题库
          </Link>{" "}
          建立一份固定问题集并冻结，再到{" "}
          <Link href="/console/sampling" className="font-medium text-primary underline-offset-4 hover:underline">
            多平台采样
          </Link>{" "}
          录入真实回答。
        </CardContent>
      </Card>
    </div>
  );
}
