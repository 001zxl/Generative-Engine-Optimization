import Link from "next/link";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-2 font-semibold">
              <span className="grid size-5 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                G
              </span>
              {site.name}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              检查结果基于公开可抓取的页面与 robots 规则做确定性判断，不承诺任何 AI 平台的实际推荐结果。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-2">
            <Link href="/tools/ai-crawler-check" className="text-muted-foreground hover:text-foreground">
              AI 爬虫检查
            </Link>
            <Link href="/tools/citation-readiness" className="text-muted-foreground hover:text-foreground">
              内容可引用性
            </Link>
            <Link href="/methods" className="text-muted-foreground hover:text-foreground">
              方法与数据边界
            </Link>
            <Link href="/knowledge" className="text-muted-foreground hover:text-foreground">
              知识与实践
            </Link>
            <Link href="/methods#privacy" className="text-muted-foreground hover:text-foreground">
              隐私说明
            </Link>
            <Link href="/console" className="text-muted-foreground hover:text-foreground">
              运营台
            </Link>
            <a href={`mailto:${site.contactEmail}`} className="text-muted-foreground hover:text-foreground">
              联系我们
            </a>
          </div>
        </div>

        <div className="mt-8 border-t pt-5 text-xs text-muted-foreground">
          本站自身遵守同一套标准：公开页面允许检索型 AI 爬虫抓取，每页声明 canonical 与结构化数据；
          用户的检查结果默认不被搜索引擎索引，但持有链接即可访问。
        </div>
      </div>
    </footer>
  );
}
