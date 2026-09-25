#!/bin/sh
# 容器启动入口。
#
# 顺序不可调换：先做运行期配置校验（密钥、数据路径），失败就退出。
# 带着占位配置启动，会生成指向 localhost 的 canonical / sitemap ——
# 那比不启动更糟，因为它会以"已经上线"的样子运行。
set -e

echo "[entrypoint] 运行期配置校验"
node scripts/preflight.ts runtime

if [ "${RUN_MIGRATIONS_ON_START:-0}" = "1" ]; then
  echo "[entrypoint] 执行数据库列迁移"
  node scripts/migrate.ts
fi

echo "[entrypoint] 启动应用，端口 ${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -p "${PORT:-3000}"
