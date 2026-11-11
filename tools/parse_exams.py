#!/usr/bin/env python3
"""考研政治真题 PDF → 结构化题库

输入：exam_2010_2025.txt（dump_pdf.py 产物）、exam_2026.txt
输出：questions.js（window.YYZ_Q = {...}）

每道客观题：{ id, y, n, kind: 'single'|'multi', stem, options[A-D], answer, part, topic }
分析题：{ id, y, n, kind: 'essay', stem(材料节选), ask[], answer }

难点：
- 题干跨行、跨页（<<<PAGE n>>> 夹在中间）
- 选项 A/B 一行、C/D 另一行，或用全角空格分隔同一行
- 答案区答案字母紧跟在「1．A        2．C」这种行里，行内换行后仍续
"""
import re
import json
import sys

# ---------- 文本清洗 ----------

PAGE_RE = re.compile(r'\n<<<PAGE \d+>>>\n')
PAGE_NO_RE = re.compile(r'^\s*\d{1,3}\s*$', re.M)   # 页眉页码单独一行

# 页眉：可能独占一行，也可能粘在正文/选项末尾
HEADER_INLINE = re.compile(
    r'\s*思想政治理论试题\s*第\s*\d+\s*页\s*(?:[（(]\s*共\s*\d+\s*页\s*[）)])?'
    r'|\s*第\s*\d+\s*页\s*[（(]\s*共\s*\d+\s*页\s*[）)]'
    r'|\s*共\s*\d+\s*页\s*[）)]?'
)

# 页脚 / 卷首残留
JUNK_INLINE = [
    re.compile(r'绝密★启用前'),
    re.compile(r'考生编号|考生姓名|报考单位'),
    re.compile(r'请用黑色字迹签字笔|2B\s*铅笔'),
    re.compile(r'超出答题区域|草稿纸|试题册上答题无效'),
]

# 数字后紧跟中文、且前面是中文的空格，多半是页码被拆出来夹在句中
STRAY_NUM = re.compile(r'(?<=[\u4e00-\u9fff])\s(\d{1,3})\s(?=[\u4e00-\u9fff])')


def clean(t):
    t = PAGE_RE.sub('\n', t)
    t = t.replace('\u3000', ' ')            # 全角空格
    t = t.replace('\xa0', ' ')
    # 页码行必须在折叠空白之前删：否则它会被折进正文句子中间
    t = re.sub(r'(?m)^\s*\d{1,3}\s*$', '', t)
    # 行内页眉——常常粘在选项尾巴上
    t = HEADER_INLINE.sub(' ', t)
    for rx in JUNK_INLINE:
        t = rx.sub(' ', t)
    t = re.sub(r'[ \t]+', ' ', t)
    return t


def strip_inline_noise(s):
    """题干/选项最后一道清洗：页眉、页脚、折行"""
    s = HEADER_INLINE.sub(' ', s)
    for rx in JUNK_INLINE:
        s = rx.sub(' ', s)
    # 中文排版里折行不产生空格：「这次」+「会议」= 「这次会议」
    s = re.sub(r'\s*\n\s*', '', s)
    s = re.sub(r'[ \t]+', ' ', s).strip()
    return s


def is_noise(line):
    s = line.strip()
    if not s:
        return True
    if re.fullmatch(r'\d{1,3}', s):            # 页码
        return True
    if '思想政治理论试题 第' in s or '选择题答案' in s:
        return True
    if s.startswith('<<<PAGE'):
        return True
    return False


# ---------- 切年 ----------

YEAR_EXAM = re.compile(r'^\s*(20\d{2})\s*年全国硕士[^\n]*?(试题)\s*$', re.M)
YEAR_ANS = re.compile(r'^\s*(20\d{2})\s*年全国硕士[^\n]*?(答案[^\n]*)\s*$', re.M)


def _body_marks(rx, t):
    """只要真正的正文标题行，不要目录（目录行带点线或页码）"""
    out = []
    for m in rx.finditer(t):
        line = t[m.start():m.end()]
        if '....' in line or '．…' in line or re.search(r'\.{4,}', line):
            continue
        if re.search(r'\.{3,}\s*\d+\s*$', line):
            continue
        out.append((int(m.group(1)), m.start()))
    return out


def split_years(t):
    """返回 {year: {'exam': text, 'ans': text}}"""
    exam_marks = _body_marks(YEAR_EXAM, t)
    ans_marks = _body_marks(YEAR_ANS, t)

    years = {}
    for y, pos in exam_marks:
        if y not in years:
            years[y] = {'exam': pos, 'ans': None}

    for y, pos in ans_marks:
        if y in years and years[y]['ans'] is None:
            years[y]['ans'] = pos

    ordered = sorted(years.items(), key=lambda kv: kv[1]['exam'])
    out = {}
    for i, (y, info) in enumerate(ordered):
        nxt = ordered[i + 1][1]['exam'] if i + 1 < len(ordered) else len(t)
        exam_end = info['ans'] if info['ans'] else nxt
        out[y] = {
            'exam': t[info['exam']:exam_end],
            'ans': t[info['ans']:nxt] if info['ans'] else '',
        }
    return out


# ---------- 客观题：题干 ----------

Q_START = re.compile(r'(?<![0-9])(\d{1,2})\s*[．.、]\s*')


def parse_exam_section(sec):
    """把一份试卷正文切成 34-38 题

    题号可能出现在行首，也可能跟在上一条选项末尾（同一行）。
    按「期望题号 1→38」顺序扫描，只有编号恰好等于期望值才认。
    """
    sec = clean(sec)
    body_start = sec.find('一、单项选择题')
    if body_start < 0:
        body_start = sec.find('一、单项选择')
    if body_start > 0:
        sec = sec[body_start:]

    starts = []
    pos = 0
    expect = 1
    while expect <= 38:
        nxt = None
        for m in Q_START.finditer(sec, pos):
            if int(m.group(1)) == expect:
                nxt = m
                break
        if nxt is None:
            break
        starts.append((expect, nxt.start(), nxt.end()))
        pos = nxt.end()
        expect += 1

    blocks = {}
    for i, (n, s, e) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(sec)
        blocks[n] = sec[s:end]
    return blocks


def parse_objective(block, n):
    """单选/多选：题号后到最后一个选项"""
    raw = block
    # 去掉题号
    raw = re.sub(r'^\s*\d{1,2}\s*[．.、]\s*', '', raw)

    # 去掉答案区残尾（分析题说明等）
    raw = re.split(r'\n\s*(?:二|三)、', raw)[0]

    # 找选项起点：第一处「A．」或「A.」
    am = re.search(r'(?<![A-Za-z])([A-D])\s*[．.、]', raw)
    if not am:
        return None
    stem = raw[:am.start()].strip()
    opttext = raw[am.start():]

    # 收选项：逐行扫，行内可能有多个「X.」；选项文字可能紧贴下一个标记
    opts = {}
    order = []
    cur = None
    MARK = re.compile(r'([A-D])\s*[．.、]\s*')

    for line in opttext.split('\n'):
        line = line.strip()
        if not line or re.fullmatch(r'\d{1,3}', line):
            continue

        # 一行里可能从任意字母开始；只保留字母严格递增的标记串
        candidates = list(MARK.finditer(line))
        marks = []
        last = -1
        for m in candidates:
            v = 'ABCD'.index(m.group(1))
            if v > last:
                marks.append(m)
                last = v

        if not marks:
            if cur:
                opts[cur] = (opts[cur] + ' ' + line).strip()
            continue

        head = line[:marks[0].start()].strip()
        if head and cur:
            opts[cur] = (opts[cur] + ' ' + head).strip()
        for i, m in enumerate(marks):
            letter = m.group(1)
            end = marks[i + 1].start() if i + 1 < len(marks) else len(line)
            text = line[m.end():end].strip()
            if letter in opts:
                opts[letter] = (opts[letter] + ' ' + text).strip()
            else:
                opts[letter] = text
                order.append(letter)
            cur = letter

    seen = []
    for l in order:
        if l not in seen:
            seen.append(l)
    final = [{'letter': l, 'text': strip_inline_noise(opts[l])}
             for l in seen if strip_inline_noise(opts.get(l, '')).strip()]

    if len(final) < 4:
        return None

    stem = strip_inline_noise(stem)
    stem = re.sub(r'（\s*）\s*$', '', stem).strip()
    return {'kind': 'objective', 'stem': stem, 'options': final[:4]}


# ---------- 答案区 ----------

ANS_LETTER = re.compile(r'(\d{1,2})\s*[．.、]\s*([ABCD]{1,4})(?![A-Za-z])')


def parse_answers(ans_sec):
    """从答案要点里抽 1-33 的客观题答案，以及 34-38 的分析题要点"""
    a = clean(ans_sec)
    out = {}

    # 只取到「三、分析题」之前作为客观题答案区
    split = re.search(r'\n\s*(三|Ⅱ)、?\s*(材料)?分析题', a)
    obj = a[:split.start()] if split else a

    for m in ANS_LETTER.finditer(obj):
        n = int(m.group(1))
        letters = m.group(2)
        if 1 <= n <= 33 and n not in out:
            out[n] = letters

    # 分析题要点：34-38
    essay = {}
    if split:
        tail = a[split.end():]
        emarks = [(int(m.group(1)), m.start(), m.end())
                  for m in re.finditer(r'^\s*(\d{2})\s*[．.、]\s*【答案要点】', tail, re.M)]
        if not emarks:
            emarks = [(int(m.group(1)), m.start(), m.end())
                      for m in re.finditer(r'^\s*(\d{2})\s*[．.、]', tail, re.M)
                      if 34 <= int(m.group(1)) <= 38]
        for i, (n, s, e) in enumerate(emarks):
            end = emarks[i + 1][1] if i + 1 < len(emarks) else len(tail)
            txt = tail[e:end]
            txt = re.sub(r'\n<\<\<PAGE \d+>>>\n?', '\n', txt)
            txt = re.sub(r'\n\s*\d{1,3}\s*\n', '\n', txt)
            essay[n] = re.sub(r'[ \t]+', ' ', txt).strip()
    return out, essay


# ---------- 分析题题干 ----------

def parse_essay(block, n):
    raw = re.sub(r'^\s*\d{1,2}\s*[．.、]\s*', '', block)
    raw = re.sub(r'\n<\<\<PAGE \d+>>>\n?', '\n', raw)
    raw = re.sub(r'\n\s*\d{1,3}\s*\n', '\n', raw)
    lines = [l.strip() for l in raw.split('\n')]
    lines = [l for l in lines if l]

    # 提问句：(1)...（5分）(2)...（5分）
    asks = []
    keep = []
    for l in lines:
        if re.match(r'^[（(]\s*[12]\s*[）)]', l) or (asks and re.match(r'^.{0,4}[（(]\s*[12]\s*[）)]', l)):
            asks.append(l)
        elif re.search(r'[（(]\s*\d+\s*分\s*[）)]\s*$', l) and asks:
            asks[-1] += ' ' + l
        else:
            keep.append(l)

    # 题干：去掉「结合材料回答问题：」「材料1/2/3」标记，保留核心
    stem = ' '.join(keep)
    stem = re.sub(r'结合材料回答问题[:：]', '', stem)
    stem = re.sub(r'\s+', ' ', stem).strip()
    stem = stem[:600]

    return {
        'kind': 'essay',
        'stem': stem,
        'asks': [re.sub(r'\s+', ' ', x).strip() for x in asks],
    }


# ---------- 学科归属 ----------

# 考研政治题号惯例：1-4 马原、5-8 毛中特、9-12 史纲、13-14 思修、15-16 时政
# 多选:17-21 马原、22-26 毛中特、27-29 史纲、30 思修、31-33 时政
SLOT_PART = {
    'single': [(1, 4, '马原'), (5, 8, '毛中特'), (9, 12, '史纲'), (13, 14, '思修法基'), (15, 16, '时政')],
    'multi': [(17, 21, '马原'), (22, 26, '毛中特'), (27, 29, '史纲'), (30, 30, '思修法基'), (31, 33, '时政')],
    'essay': [(34, 34, '马原'), (35, 35, '毛中特'), (36, 36, '史纲'), (37, 37, '思修法基'), (38, 38, '时政')],
}


def part_of(kind, n):
    for lo, hi, name in SLOT_PART[kind]:
        if lo <= n <= hi:
            return name
    return '其他'


def main():
    exams = {}
    for path, tag in [('/tmp/yyz_pdf/data/exam_2010_2025.txt', 'old'),
                      ('/tmp/yyz_pdf/data/exam_2026.txt', 'new')]:
        with open(path, encoding='utf-8') as f:
            exams[path] = f.read()

    years = split_years(exams['/tmp/yyz_pdf/data/exam_2010_2025.txt'])

    # 2026：单独，无答案
    t26 = clean(exams['/tmp/yyz_pdf/data/exam_2026.txt'])
    years[2026] = {'exam': t26, 'ans': ''}

    all_q = []
    stats = []

    for y in sorted(years, reverse=True):
        info = years[y]
        blocks = parse_exam_section(info['exam'])
        answers, essays = parse_answers(info['ans']) if info['ans'] else ({}, {})

        got = {'single': 0, 'multi': 0, 'essay': 0}

        for n in range(1, 39):
            if n not in blocks:
                continue
            if n <= 33:
                kind = 'single' if n <= 16 else 'multi'
                obj = parse_objective(blocks[n], n)
                if not obj:
                    continue
                ans = answers.get(n, '')
                all_q.append({
                    'id': '%d-%d' % (y, n),
                    'y': y,
                    'n': n,
                    'kind': kind,
                    'part': part_of(kind, n),
                    'stem': obj['stem'],
                    'options': obj['options'],
                    'answer': ans,
                })
                got[kind] += 1
            else:
                es = parse_essay(blocks[n], n)
                if not es['stem']:
                    continue
                es.update({
                    'id': '%d-%d' % (y, n),
                    'y': y,
                    'n': n,
                    'part': part_of('essay', n),
                    'answer': essays.get(n, ''),
                })
                all_q.append(es)
                got['essay'] += 1

        stats.append((y, got))

    print('%-6s %6s %6s %6s %s' % ('年', '单选', '多选', '分析', '有答案的分析题'))
    for y, g in stats:
        na = sum(1 for q in all_q if q['y'] == y and q['kind'] == 'essay' and q['answer'])
        print('%-6d %6d %6d %6d %d' % (y, g['single'], g['multi'], g['essay'], na))
    print('总计', len(all_q))

    with open('/tmp/yyz_pdf/data/questions_raw.json', 'w', encoding='utf-8') as f:
        json.dump(all_q, f, ensure_ascii=False, indent=1)
    print('written /tmp/yyz_pdf/data/questions_raw.json')


if __name__ == '__main__':
    main()
