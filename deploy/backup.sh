#!/usr/bin/env bash
# 一致性备份。
#
# 为什么不用 cp：应用正在写入时直接复制 .db 文件会拿到撕裂的快照
# （页级别不一致），恢复时才发现坏掉。SQLite 的 VACUUM INTO 会生成
# 一致的副本，且不需要停服。
#
# 用法：deploy/backup.sh [输出目录]（默认 ./deploy/backups）
set -euo pipefail

OUT_DIR="${1:-$(dirname "$0")/backups}"
DB_PATH="${DATABASE_PATH:-./data/geo.db}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${OUT_DIR}/geo-${STAMP}.db"

mkdir -p "$OUT_DIR"

if [ ! -f "$DB_PATH" ]; then
  echo "[backup] 找不到数据库：$DB_PATH" >&2
  exit 1
fi

echo "[backup] 源库：$DB_PATH"
echo "[backup] 输出：$OUT_FILE"

node "$(dirname "$0")/db-tool.mjs" vacuum "$DB_PATH" "$OUT_FILE"
node "$(dirname "$0")/db-tool.mjs" verify "$OUT_FILE"

# 记录校验和，便于确认异地副本没有被改动
if command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$OUT_FILE" | tee "${OUT_FILE}.sha256"
fi

echo "[backup] 完成。请把 $OUT_FILE 复制到异地存储 —— 同机备份不算备份。"
