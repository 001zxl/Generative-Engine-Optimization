# 单实例部署镜像。
#
# 设计要点：
#  1. **构建期不注入任何密钥**。CONSOLE_PASSWORD / AUTH_SECRET 只通过运行环境提供，
#     否则会被写进镜像层，任何拿到镜像的人都能翻出来。
#  2. **非 root 运行**。容器以 uid 10001 运行，数据库目录挂持久卷。
#  3. **迁移与应用分开**。迁移作为独立步骤执行（见 compose 的 migrate 服务），
#     失败就停止发布，不会带着半迁移的库启动应用。
#  4. node:sqlite 是 Node 内置模块，无需编译原生扩展 —— 因此运行层不需要构建工具链。

# ---------- 依赖层 ----------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
# npm 源可配置：默认官方源（墙外部署无需改动），
# 在网络受限的环境用 --build-arg NPM_REGISTRY=https://registry.npmmirror.com 指定镜像源。
# corepack 拉取 pnpm 走的是自己的变量，所以要单独设 COREPACK_NPM_REGISTRY。
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
RUN npm config set registry "$NPM_REGISTRY" && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- 构建层 ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
RUN npm config set registry "$NPM_REGISTRY" && corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 只注入公开配置：这些值会被固化进静态预渲染页面（/methods、/tools/*）
ARG APP_BASE_URL
ARG SITE_NAME
ARG CONTACT_EMAIL
# pnpm build 内部先跑构建期配置校验（只查公开配置，不读也不要求任何密钥），
# 再执行 next build。密钥绝不注入这一层 —— 否则会被写进镜像层。
RUN APP_BASE_URL="$APP_BASE_URL" SITE_NAME="$SITE_NAME" CONTACT_EMAIL="$CONTACT_EMAIL" pnpm build

# ---------- 运行层 ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# 数据卷挂载点。DATABASE_PATH 指向这里，容器重建不丢数据。
ENV DATABASE_PATH=/data/geo.db
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home /app app \
 && mkdir -p /data \
 && chown -R app:app /data /app

COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/scripts ./scripts
COPY --from=builder --chown=app:app /app/src ./src
COPY --from=builder --chown=app:app /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=app:app /app/postcss.config.mjs ./postcss.config.mjs
# 整个 deploy/ 一起复制：备份/恢复/核对脚本是运维流程的一部分。
# 曾经只复制 entrypoint.sh，导致文档里写的 `deploy/backup.sh` 在容器里根本不存在。
COPY --from=builder --chown=app:app /app/deploy ./deploy
RUN chmod +x /app/deploy/*.sh

USER app
EXPOSE 3000

# 健康检查打到 /api/health；该接口会自报是否连的是试点库（pilot 字段）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 用脚本而不是 JSON 数组：需要在启动前先跑运行期校验，任何一步失败都不启动
ENTRYPOINT ["sh", "/app/deploy/entrypoint.sh"]
