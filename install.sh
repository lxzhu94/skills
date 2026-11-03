#!/usr/bin/env bash
# 安装本仓库里的所有 skill 到 ~/.claude/skills
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.claude/skills"

for dir in "$ROOT"/*/; do
  name="$(basename "$dir")"
  [ -f "$dir/SKILL.md" ] || continue
  rm -rf "$HOME/.claude/skills/$name"
  rsync -a --exclude='.git' "$dir/" "$HOME/.claude/skills/$name/"
  echo "已安装 $name"
done

echo "完成。在 Claude Code 里输入 /<skill 名> 使用。"
