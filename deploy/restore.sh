#!/usr/bin/env bash
# 从备份恢复，并做一次可验证的演练。
#
# 用法：
#   deploy/restore.sh <备份文件> <目标路径>        # 恢复到目标路径（不覆盖已存在的文件）
#   deploy/restore.sh --drill <备份文件>           # 恢复演练：恢复到临时目录、校验、清理
#
# 恢复演练的意义：备份脚本"跑成功了"不等于"备份能用"。
# 上线前必须真的恢复一次并校验完整性、外键与关键表行数。
set -euo pipefail

MODE="restore"
if [ "${1:-}" = "--drill" ]; then
  MODE="drill"
  shift
fi

SRC="${1:-}"
DEST="${2:-}"

if [ -z "$SRC" ]; then
  echo "用法：deploy/restore.sh [--drill] <备份文件> [目标路径]" >&2
  exit 2
fi
if [ ! -f "$SRC" ]; then
  echo "[restore] 找不到备份文件：$SRC" >&2
  exit 1
fi

DRILL_DIR=""
if [ "$MODE" = "drill" ]; then
  DRILL_DIR="$(mktemp -d)"
  DEST="${DRILL_DIR}/geo-restored.db"
  echo "[restore] 演练模式：恢复到临时路径 $DEST"
else
  if [ -z "$DEST" ]; then
    echo "恢复模式必须指定目标路径" >&2
    exit 2
  fi
  if [ -e "$DEST" ]; then
    echo "[restore] 目标已存在，拒绝覆盖：$DEST" >&2
    echo "         如确认要覆盖，请先自行移走原文件 —— 恢复流程不该悄悄覆盖数据。" >&2
    exit 1
  fi
fi

cleanup() {
  if [ -n "$DRILL_DIR" ] && [ -d "$DRILL_DIR" ]; then
    rm -rf "$DRILL_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$(dirname "$DEST")"

# 校验和（若备份时生成了）
if [ -f "${SRC}.sha256" ]; then
  echo "[restore] 校验和比对"
  ( cd "$(dirname "$SRC")" && shasum -a 256 -c "$(basename "${SRC}.sha256")" )
fi

cp "$SRC" "$DEST"

# 完整性 + 外键 + 关键表行数
node "$(dirname "$0")/db-tool.mjs" verify "$DEST" --full

if [ "$MODE" = "drill" ]; then
  echo "[restore] 演练完成。备份可用于恢复。"
else
  echo "[restore] 完成：$DEST"
  echo "         把 DATABASE_PATH 指向该文件即可用这份数据启动（先停掉正在写入的实例）。"
fi
