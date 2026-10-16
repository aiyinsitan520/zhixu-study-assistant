#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 24：https://nodejs.org/"
  read -k 1 "?按任意键退出…"
  exit 1
fi
node scripts/start.mjs
read -k 1 "?按任意键关闭窗口…"
