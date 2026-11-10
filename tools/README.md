# 题库生成链

三份 PDF 在这里变成网页用的数据包。改题库就按顺序跑一遍。

```
dump_pdf.py        PDF → 纯文本（按页分隔）
parse_exams.py     文本 → questions_raw.json（切题、抓答案、抓分析题要点）
link_cards.py      题目 × 100 张知识卡 → knowledge_links.js
build_questions.py questions_raw.json → questions.js（含自检）
cdp_check.py       用 CDP 驱动浏览器实测 + 截图
```

## 跑法

```bash
# 0. 需要 pypdf
python3 -m pip install --user pypdf websocket-client

# 1. PDF 拆文本（路径改成你本机的位置）
python3 dump_pdf.py "考研政治10-25真题完整版+答案.pdf" /tmp/yyz_pdf/data/exam_2010_2025.txt
python3 dump_pdf.py "2026考研政治真题.pdf"          /tmp/yyz_pdf/data/exam_2026.txt

# 2. 切题
python3 parse_exams.py

# 3. 挂卡（需要仓库根目录的 data.js）
python3 link_cards.py

# 4. 出前端数据包 + 自检
python3 build_questions.py
```

## 输出应该长什么样

`parse_exams.py` 每年都应该是 `16 单选 / 17 多选 / 5 分析`，总计 646。
自检里除了 `2012-17`（原书漏印答案）以外不该有任何一条。

## 切题踩过的坑

记下来免得下次重犯：

- **题号可能贴在上一行的结尾**（`…的 32. 2020 年 6 月…`），不能只认行首
- **选项可能紧贴**（`A.资本主义经济和政治发展不平衡规律B.资本主义国家的不断衰落`），
  必须允许无空格分隔，但只认 A→B→C→D 递的标记，否则会把正文里的字母当选项
- **题干跨页**，`<<<PAGE n>>>` 和页码会夹在中间，先清掉再切
- **答案区标题和正文标题长得一样**，靠「答案」字样区分，目录行带 `....` 要跳过
- **2014 等年份是「入学统一考试」而非「招生考试」**，标题正则要放宽
