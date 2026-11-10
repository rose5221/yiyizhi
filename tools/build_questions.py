#!/usr/bin/env python3
"""questions_raw.json → questions.js（前端数据包）+ 统计自检"""
import json
import re
from collections import Counter

SRC = '/tmp/yyz_pdf/data/questions_raw.json'
OUT = '/Users/huli/Desktop/zcode/yiyizhi/questions.js'

with open(SRC, encoding='utf-8') as f:
    qs = json.load(f)

# ---- 清洗 ----
def fix(t):
    if not t:
        return ''
    t = t.replace('\xa0', ' ')
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\s*\n\s*', ' ', t)
    t = re.sub(r'\s+', ' ', t)
    return t.strip()

clean = []
for q in qs:
    c = {
        'id': q['id'],
        'y': q['y'],
        'n': q['n'],
        'k': q['kind'],
        'p': q['part'],
        's': fix(q['stem']),
        'a': q.get('answer', '') or '',
    }
    # 原 PDF 本身缺这一题的答案（2012 多选 17 原书漏排），标记出来而不是留白
    if c['id'] == '2012-17':
        c['a'] = ''
        c['note'] = '原卷未印答案'
    if q['kind'] != 'essay':
        c['o'] = [{'l': o['letter'], 't': fix(o['text'])} for o in q['options']]
    else:
        c['q'] = [fix(x) for x in q.get('asks', [])]
    clean.append(c)

# ---- 自检 ----
problems = []
for q in clean:
    if not q['s'] or len(q['s']) < 8:
        problems.append(('题干过短', q['id'], q['s'][:30]))
    if q['k'] != 'essay':
        if len(q['o']) != 4:
            problems.append(('选项数不对', q['id'], len(q['o'])))
        for o in q['o']:
            if not o['t']:
                problems.append(('空选项', q['id'], o['l']))
        if q['y'] <= 2025:
            if not q['a']:
                problems.append(('缺答案', q['id'], ''))
            elif q['k'] == 'single' and len(q['a']) != 1:
                problems.append(('单选多答案', q['id'], q['a']))
            elif q['k'] == 'multi' and len(q['a']) < 2:
                problems.append(('多选单答案', q['id'], q['a']))

print('题目总数', len(clean))
print('按年', sorted(Counter(q['y'] for q in clean).items()))
print('按类型', Counter(q['k'] for q in clean))
print('按学科', Counter(q['p'] for q in clean))
print('问题条数', len(problems))
for p in problems[:20]:
    print('  ', p)

payload = {
    'v': 1,
    'src': '2010-2026 全国硕士研究生招生考试思想政治理论真题',
    'years': sorted(set(q['y'] for q in clean), reverse=True),
    'q': clean,
}
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('window.YYZ_Q=')
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
import os
print('written', OUT, os.path.getsize(OUT), 'bytes')
