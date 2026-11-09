#!/bin/bash
# 双击打开「一页纸 · 每天过一遍」
#
# 纯静态页面，不用起服务器；直接丢给浏览器。
# 进度存在浏览器 localStorage 里，所以固定用同一个浏览器打开才能续上。

cd "$(dirname "$0")" || exit 1

if [ ! -f "index.html" ]; then
  echo "找不到 index.html，确认脚本和网页在同一个文件夹里。"
  read -r -p "按回车退出…" _
  exit 1
fi

open "index.html"

echo "已经在浏览器里打开了。"
echo "如果页面空白：本机默认浏览器可能拦了本地文件，"
echo "试试用 Chrome / Safari 手动打开： $(pwd)/index.html"
sleep 1
