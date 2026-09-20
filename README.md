# GEO 获客推广系统 · 批次 1

面向 GEO（生成式引擎优化）获客推广的 Web 系统。本仓库当前交付**批次 1**：
工程底座 + 两个免费公开工具 + 可分享结果页 + 最小运营台。

实现依据：《GEO系统技术架构与代码搭建方案》§6.7 / §6.11 / §7 / §12.1 / §13，
以及三层呈现规范（公开获客站 → 免费工具页 → 内部运营台）。

---

## 1. 一句话说明它现在能做什么

一个潜在客户输入网址 → 拿到一份**带证据、可复核、可分享**的检查结果 →
结果页上有线索入口 → 运营台里能看到"谁在什么时候检查了什么、留没留线索"。

这条链路**已经完整跑通并通过 34 项端到端验收**。

---

## 2. 快速开始

```bash
pnpm install
pnpm dev                 # 开发模式，http://localhost:3100
```

生产模式：

```bash
pnpm build && pnpm start  # http://localhost:3100
```

验证：

```bash
pnpm verify                    # 类型检查 + 单元测试 + 构建（一条命令）
pnpm test                      # 单元测试 63 项（robots 12 + SSRF 7 + 名册 12 + 配置守卫 11 + 评估引擎 21）
python3 scripts/e2e-check.py   # 公开端 + 运营台验收（34 项，需服务已在 3100 运行）
node scripts/e2e-chain.ts      # 核心业务链集成测试（42 项，用临时库，不碰 data/geo.db）

# 视觉验收：对关键页面截图（复用本机已缓存的 Playwright Chromium）
RESULT_SLUG=xxxx pnpm screenshot
```

重置数据（会删除所有检查记录与线索）：

```bash
pnpm db:reset
```

---

## 2.1 UI 技术栈（按指定组合落地）

| 层 | 选用 | 说明 |
|---|---|---|
| 框架 | Next.js 15 + TypeScript | App Router |
| 样式 | **Tailwind CSS v4** | 无 `tailwind.config`，配置走 CSS |
| 组件体系 | **shadcn/ui**（21 个组件） | 代码已复制进 `src/components/ui/`，可直接改 |
| 底层原语 | **Radix Primitives** | 经 `radix-ui` 统一包引入，无样式、无障碍 |
| 图表 | **Recharts**（经 shadcn `chart`） | 已确认选定，不再讨论。`@tremor/react` 面向 Tailwind v3，官方仓库现有未解决的 v4 兼容 issue（[#127](https://github.com/tremorlabs/tremor/issues/127)）并已转向 copy-paste 路线 |
| 首页动效 | **Magic UI（3 个）** | `number-ticker` / `marquee` / `blur-fade` |
| 图标 | **Lucide**（主）+ **Tabler Icons** | Lucide 是 shadcn 原生；Tabler 用于导航与功能卡片 |

**动效的使用纪律**（对应"不要全站堆动效"）：`BlurFade` **只包在首屏**五个元素上，
其余区块一律静态渲染。这不是风格偏好 —— 早期版本把 `BlurFade` 铺到每个 section，
结果首屏以下内容保持 `opacity: 0` 直到滚入视口，首页在截图与慢网络下呈现为一片空白。
跑马灯是全站唯一的持续动效。

**主题**：覆盖了 shadcn 的中性主题 —— 主色改为深蓝/靛青 `oklch(0.44 0.16 264)`，
并新增 `ok / warn / fail / brand` 语义色；严重程度同时用颜色**和**文字标签表达，
不允许只靠颜色传达状态。

**字体**：不使用 `next/font/google`。shadcn 的 Nova 预设默认引入 Geist，
那会让**构建依赖外网**；本项目改用系统字体栈（含 PingFang / 微软雅黑），构建完全确定。

**为什么要 vendored CSS**：`shadcn/tailwind.css`（629 行 `@custom-variant` 与 keyframes）
是组件运行所必需的，但它是 `@import` 到全局样式里的**构建期依赖**。
若部署时执行 `pnpm install --prod`，`shadcn`（CLI 包）不会被安装，构建就会失败。
因此该文件已复制到 `src/styles/shadcn-base.css`，`shadcn` 只保留为开发依赖（CLI）。

### 2.2 UI 硬约束（后续批次必须遵守）

写在这里是为了防止批次 2/3 开发时风格漂移。每条都可用命令核查：

| # | 约束 | 核查方式 |
|---|---|---|
| 1 | 公开站与运营台**统一使用 shadcn/ui**；不新增绕过它的原生交互元素 | `grep -rn "<button\|<input\|<select\|<textarea" src/app src/components --include="*.tsx" \| grep -v "src/components/ui/"` 应为空 |
| 2 | 图表使用 **Recharts**（经 shadcn `chart`）—— **已确认选定，不引入 Tremor**，避免两套图表主题与交互并存 | 新增图表必须走 `@/components/ui/chart` 的 `ChartContainer` |
| 3 | **Magic UI 只用于首页**，且数量保持少量 | `grep -rln "magicui\|number-ticker\|marquee\|blur-fade" src/app src/components` 只应命中 `src/app/page.tsx` |
| 4 | 图标使用 **Tabler Icons 或 Lucide**，不引入第三套图标库 | `package.json` 中图标依赖只应有 `@tabler/icons-react` 与 `lucide-react` |
| 5 | 颜色一律走主题 token（`primary` / `ok` / `warn` / `fail` / `chart-*`），不写字面色值 | 组件里不出现 `#` 开头的颜色或 `rgb(` |
| 6 | 严重程度**必须同时有文字标签**，不允许只靠颜色传达 | 状态一律经 `src/lib/status.ts` 映射 |
| 7 | 构建不得依赖外网（字体、CDN） | 不使用 `next/font/google`；`@import` 不指向远程 URL |

---

## 3. 环境变量

复制 `.env.example` 为 `.env`。**全部有默认值，本地开箱即跑**：

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3100` | canonical / OpenGraph / sitemap 全部由它派生。**换域名只改这一处** |
| `DATABASE_PATH` | `./data/geo.db` | SQLite 数据文件 |
| `DEFAULT_WORKSPACE_SLUG` | `default` | 默认工作区 |
| `SITE_NAME` / `CONTACT_EMAIL` | — | 站点展示信息 |
| `EXTRA_TRUSTED_CIDRS` | **空** | SSRF 逃生口，见下。生产环境请留空 |

### SSRF 逃生口 `EXTRA_TRUSTED_CIDRS`

部分环境（企业网络 / 沙箱 / 评测平台）使用**透明代理**，把外网域名解析到固定保留网段
（例如 `198.18.0.0/15`，RFC 2544 基准测试段）。此时 SSRF 防护会把正常的外网请求一并拒绝，
表现为**所有站点都报「该域名解析到内网地址」**。

本机就是这种情况，因此 `.env` 里已配置：

```
EXTRA_TRUSTED_CIDRS=198.18.0.0/15
```

- 默认**为空**，即保持最严格策略，行为与不配置时完全一致；
- 配置后仅放行指定网段，**真正的内网地址（127/8、10/8、172.16/12、192.168/16、169.254/16）仍然被拒**
  —— 这一点有专门的单测覆盖（`tests/ssrf.test.ts`）；
- 启动时会打印一条 `⚠️ SSRF 防护已放宽` 警告；
- **部署到正式环境前请删除这一行。**

**默认拦截的网段**：0/8、10/8、100.64/10（CGNAT）、127/8、169.254/16（含云元数据）、172.16/12、
192.0.0/24、192.0.2/24（TEST-NET-1）、192.88.99/24、192.168/16、198.18/15、198.51.100/24（TEST-NET-2）、
203.0.113/24（TEST-NET-3）、224/4、240/4，以及 IPv6 的 `::1`、`fc00::/7`、`fe80::/10` 与 IPv4 映射地址。

**批次 1 不需要任何 API Key** —— 两个工具是纯规则实现，不调用大模型（见 §6）。

---

## 4. 已实现范围（批次 1）

### 公开端

| 路由 | 内容 |
|---|---|
| `/` | 工具型首页：输入网址即用，不要求注册；首屏就是操作区，没有公司介绍段 |
| `/tools/ai-crawler-check` | 工具 A：AI 爬虫可访问检查 |
| `/tools/citation-readiness` | 工具 B：内容可引用性检查 |
| `/r/[slug]` | 可分享结果页（默认 `noindex`，用户主动公开后才允许索引） |
| `/methods` | 方法与数据边界、隐私与索引政策、已知限制 |
| `/robots.txt` / `/sitemap.xml` | 检索型 AI 爬虫显式放行；`/r/` 与 `/console` 禁止索引 |

### 内部运营台

| 路由 | 内容 |
|---|---|
| `/console` | 总览：回答"这些内容有没有带来访问和咨询"；未实现的 4 问**显式标注为待建，不放占位图表** |
| `/console/leads` | 线索列表（来源、自述来源、状态、留言） |
| `/console/tool-runs` | 工具使用记录（检查目标、结论、严重项数、来路、是否已公开） |

### API

```
POST /api/tools/crawl-check          { url }
POST /api/tools/content-check        { url | text, heading? }
POST /api/tool-runs/[slug]/publish   主动公开结果页
GET  /api/tool-runs/[slug]/export    导出原始 JSON
POST /api/leads                      线索提交（含蜜罐字段）
POST /api/events                     行为事件（白名单）
```

---

## 5. 两个工具具体在做什么

### 工具 A：AI 爬虫可访问检查

抓取目标页面与同源 `robots.txt`，输出分项结论：

- **检索型 AI 爬虫是否被屏蔽**（唯一会一票否决的项）
- **训练型爬虫状态**（单独列出，并澄清"屏蔽 GPTBot ≠ 放弃 AI 曝光"）
- **国内 AI 平台的检索通道**（见下节）
- **「查无实证」的爬虫 token 检测**
- 页面可抓取性、重定向链、响应体大小、耗时
- 正文是否直接出现在 HTML 里（还是靠 JS 渲染）
- canonical / meta robots(noindex) / 标题 / 描述 / JSON-LD / sitemap 收录

robots 解析按 **RFC 9309** 自行实现：支持 `*` 通配、`$` 结尾锚定、最长匹配优先、
同长度 Allow 优先、同名 token 组合并。

### 爬虫名册：33 条，带**证据分级**

名册最重要的设计不是"收录了多少"，而是**每条都标注了它的可信程度**。
网上流传的 AI 爬虫清单大多互相抄，很多 token 只是站长为求安心写进 robots.txt 的，
未必真有爬虫在用。把这类 token 当事实展示，正是本产品最该避免的错误 —— 我们卖的就是"结论可复核"。

| 证据等级 | 含义 | 数量 |
|---|---|---|
| 官方文档 | 厂商官方文档或官方公布的 UA 字符串 | 21 |
| 实测观测 | 第三方跨站点实测流量数据（跨站点监测） | 11 |
| 社区清单 | 仅见于社区屏蔽清单/公开模板，**未找到官方或实测证据** | 1 |

每条条目还带 `sourceUrl` / `sourceTitle` / `verifiedAt` —— **客户可以点开自己复核**。
所有链接在 2026-09-20 逐条核验过可访问性，不可访问的候选来源一律不采用。
名册不变量测试会强制校验「证据等级必须与来源匹配」：官方条目不得引用第三方监测站，
实测条目不得引用社区模板。

**判定规则**：只有证据等级不是「社区清单」的条目，被屏蔽时才可能判为「严重问题」。
证据不足的条目一律只作背景信息 —— **我们不会因为一个未经证实的 token 说你的网站有严重问题。**

### 国内 AI 平台：多数没有自己的检索爬虫

这是国内 GEO 里最常见的误解，也是本工具区别于市面同类的地方。

多数国产 AI 助手**不自己抓网页**，而是复用母公司的搜索索引。所以「豆包爬虫」「Kimi 爬虫」
这类以 AI 产品命名的爬虫，在服务器日志和实测 agent 库里都不存在
（第三方实测的 agent 目录中，豆包条目返回 404）。

| AI 产品 | 真正的杠杆点 | 机制 |
|---|---|---|
| 文心一言 / 百度 AI 搜索 | `Baiduspider` | 复用百度搜索索引 |
| 腾讯元宝 | `Sogou web spider` | 依赖搜狗 / 腾讯搜索索引 |
| 夸克 AI / 通义（部分场景） | `YisouSpider`（神马） | 依赖神马搜索索引 |
| 通义千问 | `QwenBot` | 厂商自有爬虫，声明同时支撑训练与生成式回答 |
| 豆包 | `Bytespider` | **没有名为 Doubao 的爬虫**；公开可辨识的字节爬虫是 Bytespider |
| 智谱清言 / ChatGLM | `ChatGLM-Spider` | 厂商自有爬虫 |

**含义**：很多团队花钱屏蔽了「豆包爬虫」，却不知道自己真正该维护的是
`Baiduspider` / `Sogou` / 神马 这些搜索索引的抓取条件。方向错了，投入就浪费了。

名册最后核对时间与复核周期（每季度）在代码中固化（`ROSTER_UPDATED_AT`），并在页面上展示
—— 爬虫名单以季度为生命周期，三个月不核对就可能漏掉新平台。

### 工具 B：内容可引用性检查

8 个维度分项评分，**每一项都展示"计算方式"和原文证据**：

直接回答 · 具体事实与数字 · 来源与证据 · 作者与时效 ·
结构可切分 · FAQ 覆盖 · 表述克制 · 存在可整段摘录的摘要

总分 = 各分项加权和，权重在结果页展示。不隐藏权重、不给不透明总分。

---

## 6. 与架构文档的偏离（重要）

| 项 | 文档原方案 | 本实现 | 原因 |
|---|---|---|---|
| 数据库/ORM | PostgreSQL + Drizzle | **`node:sqlite` + 手写 SQL** | 零原生依赖、零编译风险、单文件可跑。所有 SQL 集中在 `src/lib/db/repo.ts`，切 Postgres 只需替换该文件与连接层 |
| 图表库 | Tremor | **Recharts**（经 shadcn `chart`） | 两者二选一；Tremor v3 与 Tailwind v4 存在配置摩擦 |
| 队列 | Redis + BullMQ | **暂无**（批次 1 不存在异步任务） | 批次 1 的检查是同步的、秒级完成；引入 Redis 只有运维成本没有收益 |
| 图标 | — | Lucide + Tabler | Lucide 为 shadcn 原生，Tabler 用于导航与功能卡片 |

**唯一没有偏离的是 schema 设计**：附件 §7.8 要求的 `workspace_id` 等通用字段全部保留，
采样/评估/内容/推广相关表已全部建好（批次 2 直接写入，避免中途迁移）。

---

## 7. 成本红线（设计约束，不是建议）

两个免费工具是**匿名可访问的获客入口**。如果它们调用大模型，每一次匿名点击都是净支出，
获客入口会变成成本黑洞。因此：

- **工具 A / B 100% 规则化、确定性、零 token** —— 同样的输入永远得到同样的输出
- 全过程无任何 AI API 调用，`package.json` 里也没有任何模型 SDK

这是"免费工具可以无限次使用"的前提，也是结果可复核、可被客户独立验证的前提。

---

## 8. 隐私与安全（已实现）

- 结果页**默认 `noindex`**、`nocache`；只有用户调用 publish 之后才允许索引
- 结果页链接是 12 位随机 slug（约 60 bit 熵），不可枚举
- **SSRF 防护**：拒绝内网/环回/链路本地地址（含 DNS 解析后的真实 IP）、
  限制重定向次数且逐跳重新校验、超时 12s、响应体上限 3MB、内容类型白名单
- **限流**：爬虫检查与内容检查各 12 次 / 10 分钟 / IP；线索 6 次 / 小时；公开 30 次 / 小时
- IP 只存哈希，不存明文
- 线索表单含蜜罐字段
- `robots.txt` 显式放行检索型 AI 爬虫（**自己遵守同一套标准**）
- 公开/写入操作写审计日志（`change_logs`）

---

## 9. 目录结构

```
geo-growth-engine/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 工具型首页（Magic UI 动效仅在首屏）
│   │   ├── tools/                      # 两个免费工具
│   │   ├── r/[id]/page.tsx             # 可分享结果页（最重要的传播页，分页式）
│   │   ├── methods/page.tsx            # 方法与数据边界
│   │   ├── console/                    # 内部运营台（shadcn Sidebar + Recharts）
│   │   │   ├── brands/ questions/ claims/     # 核心链路 1-3
│   │   │   ├── sampling/ evaluation/          # 核心链路 4-5
│   │   │   ├── content/ attribution/          # 核心链路 6-7
│   │   │   ├── leads/ tool-runs/              # 线索与工具记录
│   │   │   ├── actions.ts                     # 全部 Server Actions
│   │   │   └── roadmap/                       # 产品路线图
│   │   ├── api/                        # Route Handlers
│   │   ├── icon.svg                    # favicon（App Router 约定）
│   │   ├── robots.ts / sitemap.ts
│   │   └── globals.css                 # Tailwind 入口 + 品牌/状态色覆盖
│   ├── styles/shadcn-base.css          # vendored 的 shadcn 变量与 keyframes
│   ├── components/
│   │   ├── ui/                         # ★ shadcn/ui 组件（代码在你手里）
│   │   ├── check-parts.tsx             # 领域 UI：结论条目 / 分项表 / 状态徽标
│   │   ├── console-charts.tsx          # 领域 UI：图表（Recharts）
│   │   ├── forms.tsx                   # 工具表单 / 线索表单 / 结果页操作
│   │   ├── site-header.tsx / site-footer.tsx
│   │   └── console-nav.tsx             # Sidebar 导航
│   └── lib/
│       ├── checks/                     # ★ 工具 A / B 核心逻辑
│       │   ├── bots.ts                 #   24 个 AI 爬虫名册（含三类用途区分）
│       │   ├── crawler.ts              #   工具 A
│       │   ├── citability.ts           #   工具 B
│       │   └── types.ts                #   Finding / CheckResult 统一结构
│       ├── net/
│       │   ├── robots.ts               # ★ RFC 9309 解析与匹配（有单测）
│       │   └── fetch-page.ts           # ★ 受限抓取层（SSRF 防护）
│       ├── db/
│       │   ├── schema.ts               # 全部表结构（含批次 2 预留）
│       │   ├── index.ts                # node:sqlite 连接与审计日志
│       │   ├── repo.ts                 # 工具 / 线索 / 统计
│       │   └── repo-domains.ts         # 七个业务模块的数据访问
│       ├── evaluation.ts                # ★ 评估引擎（纯函数，可单测）
│       ├── status.ts                   # 状态 → 视觉映射（不散落到页面）
│       ├── rate-limit.ts
│       └── site.ts
├── tests/
│   ├── robots.test.ts                  # robots RFC 9309 解析（12 项）
│   ├── ssrf.test.ts                    # SSRF 防护（7 项）
│   ├── bots.test.ts                    # 爬虫名册不变量（12 项）
│   └── config-guard.test.ts            # 生产配置守卫（11 项）
└── scripts/
    ├── e2e-check.py                    # 34 项端到端验收
    ├── e2e-chain.ts                    # 核心业务链集成测试（42 项）
    ├── preflight.ts                    # 启动前配置守卫（build/start 前置）
    └── screenshot.mjs                  # 视觉验收（截图 + 溢出与控制台错误检查）
```

---

## 10. 核心业务链（七个模块，已全部上线）

```
品牌 → 问题库 → 事实库 → 采样 → 评估 → 内容 → 归因
```

| # | 模块 | 路由 | 关键点 |
|---|---|---|---|
| 1 | 品牌与竞品 | `/console/brands` | 品牌名 / 别名 / 错误拼写、品牌域名、竞品 |
| 2 | 问题库 | `/console/questions` | 批量录入、Persona / 意图 / 漏斗阶段；**Query Set 冻结**（冻结后只能新建版本） |
| 3 | 事实与证据 | `/console/claims` | Claim 审核、证据绑定与证据等级、有效期、禁用表述、**冲突检测** |
| 4 | 多平台采样 | `/console/sampling` | 「问题 × 引擎 × 重复次数」生成任务；**人工粘贴 + CSV 导入**；幂等键防重复 |
| 5 | 评估与指标 | `/console/evaluation` | 提及 / 列表排名 / 引用 / 事实一致性；四个核心指标 |
| 6 | 内容与推广 | `/console/content` | Brief → 内容 → 绑定问题与已批准事实 → 审核 → 发布 → 回填 URL |
| 7 | 获客归因 | `/console/attribution` | 状态流转与历史、人工补记触点、三种归因口径并列 |

**38 张数据表**在 schema 中一次性定义，全部 `CREATE TABLE IF NOT EXISTS`，可重复执行。

> ⚠️ 更正记录：更早版本的路线图曾声称"数据表已按架构文档建好"，但实际上当时
> 36 张里缺 25 张。这是一处未经验证的断言 —— 与本项目一贯要求的"结论可复核"相悖，
> 现已补齐并在路线图页面留痕。

### 评估引擎的设计约束（`src/lib/evaluation.ts`）

1. **一切结论可回到原文**：每条提及都带字符偏移与上下文片段，指标分子分母可追溯到样本。
2. **不确定就标不确定**：情感与事实判定是启发式，一律带 confidence；事实冲突一律进人工复核队列。
3. **分母为 0 显示「无法计算」而不是 0** —— 0 会被误读成"表现差"。
4. **不合并不可比样本**：不同采样方式（消费者界面 / 官方 API）、不同问题版本、不同地区不直接混算。
5. **不做多触点加权归因**：那个权重表没有行业数据支撑，只会产出"看似精确、实则不可验证"的数字。

---

## 11. 已知限制

- **只检查「爬虫规则」，不监测各平台的实际回答内容。** 它读 robots.txt 与页面 HTML，
  判断的是「检索型爬虫能不能取到你、内容是否容易被摘录」。它**不会**去问 ChatGPT / 豆包 / 千问
  「你推荐哪家供应商」，因此也无法告诉你品牌在某平台的答案里有没有被提到 —— 那属于第 4、5 号模块。
- **本机沙箱内的外部抓取受限**：本机网络走透明代理，大量外网域名被解析到 `198.18.0.0/15`，
  默认会被 SSRF 防护拒绝（这是正确行为）。本地测试需在 `.env` 中配置 `EXTRA_TRUSTED_CIDRS`，
  详见 §3 环境变量。**正式部署请勿设置该项。**
- 只分析初始 HTML，不执行页面脚本（这正是「正文可提取性」要测的东西）。
- 只检查提交的单个 URL 与同源 robots.txt / sitemap，不遍历全站。
- 绝对化表述词表是启发式，会有误报（如「第一时间」）；结果页会列出命中原文供人工判断。
- 爬虫名册的证据等级取决于公开可得来源，`reported` 级条目（当前 1 条）不参与严重判定。
- 运营台暂无登录鉴权；上线到公网前必须补上（见 §12.2）。

---

## 12. 部署约束（上线前必读）

### 12.1 启动前配置守卫

`pnpm build` 与 `pnpm start` 之前会先跑 `scripts/preflight.ts`。检测到以下情况会**拒绝启动**（不是警告）：

| 检查项 | 为什么是硬门槛 |
|---|---|
| `APP_BASE_URL` 指向本机（`localhost` / `127.0.0.1` / `*.local` / `*.internal`） | canonical / OpenGraph / sitemap 全部由它派生。带 localhost 上线 = 告诉搜索引擎与 AI 爬虫「本站规范地址是本机」，收录与引用全面错乱 |
| `APP_BASE_URL` 未设置或非法 | 同上，会静默退回默认值 |
| `CONTACT_EMAIL` 仍是占位邮箱（`hello@example.com` 等）或格式错误 | 线索表单提交后无人接收 |
| `DATABASE_PATH` 为空字符串 | 会导致数据库落到意外位置 |

`APP_BASE_URL` 使用 `http:` 只警告不阻断（内网与预发环境可能确实如此）。

本地以生产模式自测时，在 `.env` 中加入 `ALLOW_INSECURE_DEFAULTS=1` 跳过校验；
**正式部署环境不得设置该项**。校验逻辑是纯函数（`src/lib/config-guard.ts`），有 11 项单测覆盖
—— 一个"看起来有守护、其实不生效"的配置校验，比没有校验更危险。

### 12.2 当前架构的部署前提：单机 + 持久磁盘

| 组件 | 现状 | 限制 | 多实例前必须替换为 |
|---|---|---|---|
| 数据库 | Node 内置 `node:sqlite`（单文件） | **只适用于单机且磁盘持久**。容器无状态重建 / 多副本会各写各的库，或直接丢数据 | PostgreSQL + 迁移系统 |
| 限流 | 进程内内存计数（`src/lib/rate-limit.ts`） | 多实例下限流额度按实例数放大，等于限流失效 | Redis 限流 |
| 文件/导出 | 无对象存储，报告即时生成 | 目前不存大文件，暂无影响 | S3 兼容存储 |
| 鉴权 | **无** | `/console` 无任何鉴权，任何能访问部署地址的人都能看到全部线索 | 登录 + 角色权限 |

**结论**：当前版本适合「单台 VPS + 持久磁盘」或本地/内网部署。
若要用无状态容器或多副本横向扩展，必须先完成上表第 1、2 项。

### 12.3 上线前检查清单

- [ ] 替换 `APP_BASE_URL` 为真实域名（建议 https）
- [ ] 替换 `CONTACT_EMAIL` 为真实可收信邮箱
- [ ] 确认 `.env` 中**没有** `ALLOW_INSECURE_DEFAULTS`
- [ ] 删除 `.env` 中的 `EXTRA_TRUSTED_CIDRS`（除非你的网络确实走透明代理）
- [ ] 为 `/console` 补上登录鉴权
- [ ] 配置数据备份（`data/geo.db` 是唯一的数据文件）
