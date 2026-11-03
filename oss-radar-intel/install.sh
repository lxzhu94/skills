#!/usr/bin/env bash
# 一键安装到 Claude Code 用户级 skill 目录
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills/oss-radar-intel"

mkdir -p "$HOME/.claude/skills"
rm -rf "$DEST"
rsync -a --exclude='.git' --exclude='node_modules' "$SRC/" "$DEST/"

echo "已安装到 $DEST"
echo "在 Claude Code 里输入 /oss-radar-intel 开始"
echo "或者直接说：帮我看看今天有什么 AI 新闻、论文和开源项目"
