# 部署与恢复手册

单实例部署：一个应用容器 + 一个 Caddy 反向代理 + 一个持久化数据卷。
适用范围与限制见本文末。

## 0. 前置条件

- 一台有持久磁盘的服务器，Docker 与 Docker Compose v2
- 一个域名的 DNS 控制权（可用现有域名的子域名，不必新注册）
- 异地备份存储（对象存储、另一台机器都行）—— **同机备份不算备份**

## 1. 首次部署

### 1.1 准备 `.env.production`

放在仓库根目录（**已被 .gitignore 忽略，不要提交**）：

```bash
# ---- 公开配置：构建期需要，会被固化进静态预渲染页面 ----
APP_BASE_URL=https://geo.example.com
SITE_NAME=你的站点名
CONTACT_EMAIL=ops@example.com
SITE_DOMAIN=geo.example.com

# ---- 运行期密钥：绝不进入构建环境 ----
# 生成方式：openssl rand -base64 32
CONSOLE_PASSWORD=<强口令>
AUTH_SECRET=<32 字节随机串>
LEAD_NOTIFY_WEBHOOK=<钉钉/企微/飞书机器人 Webhook>

# ---- 数据 ----
DATABASE_PATH=/data/geo.db
```

**公网环境不要设置** `ALLOW_INSECURE_DEFAULTS` 与 `EXTRA_TRUSTED_CIDRS`。
前者会跳过占位配置校验，后者会放宽 SSRF 防护 —— 两个都只用于本地自测。

### 1.2 校验公开配置

```bash
docker compose -f deploy/compose.yaml run --rm migrate \
  node scripts/preflight.ts build
```

构建期只校验公开配置。占位邮箱、本机域名会在这里被拦住。

### 1.3 构建镜像

```bash
APP_BASE_URL=https://geo.example.com \
SITE_NAME=你的站点名 \
CONTACT_EMAIL=ops@example.com \
docker compose -f deploy/compose.yaml build
```

密钥**不参与构建**。这样镜像层里不含任何口令 —— 任何拿到镜像的人翻不出运营台密码。

### 1.4 首次启动（空库）

```bash
# 1) 迁移（在持久卷上建表）
docker compose -f deploy/compose.yaml run --rm migrate

# 2) 启动
docker compose -f deploy/compose.yaml up -d
```

`app` 容器启动时会先跑 `scripts/preflight.ts runtime`，密钥缺失或过短会直接退出，
不会带着占位配置上线。

### 1.5 上线检查

```bash
# 健康接口；pilot 字段表示是否连的是试点库（生产必须为 false）
curl -fsS https://geo.example.com/api/health

# 外网未授权用户必须打不开运营台
curl -s -o /dev/null -w '%{http_code}\n' https://geo.example.com/console   # 期望 307 → /console/login

# 公网页面可访问
curl -s -o /dev/null -w '%{http_code}\n' https://geo.example.com/
```

逐项确认：页面 HTML、canonical、robots.txt、sitemap.xml、内部链接、咨询表单通知。
记录实际 URL 与检查时间。

## 2. 发布流程（固定步骤）

```
构建镜像 → 公告短暂停机 → 停止旧应用写入 → 一致性备份
  → 运行迁移并检查退出码 → 启动新应用 → 检查健康接口与公网页面 → 恢复流量
```

```bash
# 1) 备份（应用仍在运行时也可执行，VACUUM INTO 会给出一致快照）
docker compose -f deploy/compose.yaml exec app \
  sh -c 'DATABASE_PATH=/data/geo.db deploy/backup.sh /backups'

# 2) 迁移。失败立即停止发布，不要继续启动新应用
docker compose -f deploy/compose.yaml run --rm migrate

# 3) 启动新版本
docker compose -f deploy/compose.yaml up -d app

# 4) 健康检查
curl -fsS https://geo.example.com/api/health
```

**迁移失败时**：保持停写，恢复部署前的数据库快照与旧镜像，再开放流量。

## 3. 回滚

```bash
# 1) 停应用（先停写）
docker compose -f deploy/compose.yaml stop app

# 2) 用旧镜像启动（把 image 标签换成上一版，或用 git 切回上一个提交后重新 build）
docker compose -f deploy/compose.yaml up -d app

# 3) 只有在迁移已经改过结构、且新结构对旧代码不兼容时，才回滚数据库：
docker compose -f deploy/compose.yaml stop app
mv /data/geo.db /data/geo.db.broken
# 从备份恢复（不覆盖已存在文件，所以要先把坏的移走）
docker compose -f deploy/compose.yaml run --rm \
  -v ./backups:/backups \
  app sh -c 'deploy/restore.sh /backups/<快照文件> /data/geo.db'
docker compose -f deploy/compose.yaml up -d app
```

现有迁移**只支持加列**，不做改类型/搬迁/拆表。因此绝大多数情况下回滚镜像即可，
不必回滚数据。需要改结构时先补版本化迁移系统，不要在发布窗口里临时处理。

## 4. 备份与恢复演练

```bash
# 备份（含完整性、外键、关键表行数校验，输出 .sha256）
deploy/backup.sh /backups

# 恢复演练：恢复到临时目录、校验、清理
deploy/restore.sh --drill /backups/geo-<时间戳>.db

# 真正恢复
deploy/restore.sh /backups/geo-<时间戳>.db /data/geo.db
```

**上线前必须做一次恢复演练。** 备份脚本"跑成功了"不等于"备份能用"。

建议同时配置每日定时备份与异地同步（cron + rclone/rsync 到异地存储）。

## 5. 运营台访问控制

首版要求运营台只能从内网或 VPN 访问：

- 应用自身已有口令 + HMAC 签名会话（HttpOnly / SameSite=Lax）与登录失败节流
- 公网只开放 80/443，应用端口不直接暴露
- **额外一层由 VPN 或上游反向代理的策略完成**，不要靠 Caddy 的基础认证 ——
  那会造成两套口令要维护，且轮换时容易漏掉一套

推荐做法：`/console` 走 VPN 内网入口，公网入口直接拒绝该路径。

## 6. 本方案的明确限制

| 限制 | 说明 |
|---|---|
| 单实例 | `node:sqlite` + 进程内限流。多副本需要 PostgreSQL + 版本化迁移 + 外部限流 |
| 迁移只支持加列 | 改类型/搬迁/拆表需先补迁移系统 |
| 无多用户 | 单口令单工作区。多租户与角色权限属于第二阶段 |
| 不接搜索引擎后台 | 「已收录」无法自行断言，只能人工回填 |
| 不承诺排名 | 对外只描述可观测的变化，不承诺任何排名或推荐结果 |
