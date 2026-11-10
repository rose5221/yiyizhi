#!/usr/bin/env python3
"""把真题挂到 100 张知识卡上：知识点 ↔ 历年真题

思路：
1. 学科粗筛：卡片 m ∈ {马原, 史纲, 其他}；题目 part ∈ {马原, 毛中特, 史纲, 思修法基, 时政}
   马原↔马原、史纲↔史纲，毛中特/思修/时政 优先落到「其他」，也可落任一张卡。
2. 文本打分：中文按 2-gram + 4-gram 混合，题干+选项 对 卡片全文（含标题）。
   4-gram 权重高（术语精确重合），2-gram 补软匹配。
3. IDF 压掉「社会主义」「中国共产党」这种到处都有的词。
4. 每题保留最高分 + 阈值以上的次高分，供前端「原题回查」。

输出 knowledge_links.js：{ byCard: {cardN: [qid...]}, byQuestion: {qid: {card, score}} }
"""
import json
import math
import re
from collections import Counter, defaultdict

sys_path = '/tmp/yyz_pdf/data'
with open(sys_path + '/questions_raw.json', encoding='utf-8') as f:
    QUESTIONS = json.load(f)

raw = open('/Users/huli/Desktop/zcode/yiyizhi/data.js', encoding='utf-8').read()
CARDS = json.loads(raw.split('=', 1)[1].rstrip().rstrip(';'))['cards']


def card_text(c):
    body = ' '.join(''.join(s['t'] for s in l['s']) for l in c['L'])
    return (c['t'] + ' ' + body)


PUNCT = re.compile(r'[^\u4e00-\u9fffA-Za-z0-9]+')


def norm(t):
    t = t.replace('“', '').replace('”', '').replace('，', '').replace('。', '')
    t = PUNCT.sub(' ', t)
    return t


def grams(text, n):
    t = norm(text)
    ch = re.sub(r'\s+', '', t)
    # 只取中文串
    out = []
    for seg in re.findall(r'[\u4e00-\u9fff]+', ch):
        for i in range(len(seg) - n + 1):
            out.append(seg[i:i + n])
    return out


def features(text):
    return Counter(grams(text, 2)) + Counter(grams(text, 4))


# ---- 学科相容 ----
# 这本手册只覆盖 马原(36) + 史纲(58) + 其他(6 张毛中特/思修口诀卡)。
# 硬约束：马原题只挂马原卡，史纲题只挂史纲卡；毛中特/思修只挂「其他」。
# 时政题跨学科，允许任意卡但阈值更高。
PART_TO_CARD = {
    '马原': {'马原'},
    '史纲': {'史纲'},
    '毛中特': {'其他'},
    '思修法基': {'其他'},
    '时政': {'其他', '马原', '史纲'},
}

MIN_SCORE = {
    '马原': 0.045,
    '史纲': 0.045,
    '毛中特': 0.055,
    '思修法基': 0.055,
    '时政': 0.10,
}


def qtext(q):
    if q['kind'] == 'essay':
        return q['stem'] + ' ' + ' '.join(q.get('asks', [])) + ' ' + q.get('answer', '')
    opts = ' '.join(o['text'] for o in q.get('options', []))
    return q['stem'] + ' ' + opts


def main():
    card_feat = []
    for c in CARDS:
        card_feat.append(features(card_text(c)))

    # IDF
    df = Counter()
    for f in card_feat:
        for k in f:
            df[k] += 1
    N = len(card_feat)

    def idf(k):
        return math.log((N + 1) / (df[k] + 1)) + 0.5

    # 预积分量
    norms = []
    for f in card_feat:
        s = 0.0
        for k, v in f.items():
            w = idf(k) * (1.0 if len(k) == 2 else 2.0)
            s += (v * w) ** 2
        norms.append(math.sqrt(s) or 1.0)

    by_card = defaultdict(list)
    by_q = {}
    log = []
    unmatched = {}

    for q in QUESTIONS:
        qf = features(qtext(q))
        if not qf:
            continue
        qn = 0.0
        for k, v in qf.items():
            w = idf(k) * (1.0 if len(k) == 2 else 2.0)
            qn += (v * w) ** 2
        qn = math.sqrt(qn) or 1.0

        allow = PART_TO_CARD.get(q['part'], {'其他'})
        thr = MIN_SCORE.get(q['part'], 0.08)

        best = []
        for i, c in enumerate(CARDS):
            if c['m'] not in allow:
                continue
            f = card_feat[i]
            dot = 0.0
            for k, v in qf.items():
                cv = f.get(k)
                if cv:
                    w = idf(k) * (1.0 if len(k) == 2 else 2.0)
                    dot += v * cv * w * w
            score = dot / (qn * norms[i])
            best.append((score, c['n']))

        best.sort(reverse=True)
        if not best:
            unmatched.setdefault(q['part'], []).append(q['id'])
            continue

        top = best[0]
        if top[0] < thr:
            unmatched.setdefault(q['part'], []).append(q['id'])
            continue

        picks = [top]
        for s, n in best[1:3]:
            if s >= top[0] * 0.9 and s >= thr:
                picks.append((s, n))
        picks = picks[:2]

        by_q[q['id']] = [{'card': n, 'score': round(s, 4)} for s, n in picks]
        for s, n in picks:
            by_card[n].append((q['id'], s))

        log.append((top[0], q['id'], top[1], q['stem'][:45]))

    out_card = {}
    for n, lst in by_card.items():
        lst.sort(key=lambda x: -x[1])
        out_card[n] = [qid for qid, s in lst][:60]

    log.sort(reverse=True)
    print('挂上的题', len(by_q), '/', len(QUESTIONS))
    print('有题卡数', len(out_card), '/ 100')
    print('未匹配分布', {k: len(v) for k, v in unmatched.items()})
    print('--- 强匹配 ---')
    for s, qid, n, stem in log[:5]:
        print('%.3f %s -> 卡%d %s' % (s, qid, n, stem))
    print('--- 弱匹配 ---')
    for s, qid, n, stem in log[-5:]:
        print('%.3f %s -> 卡%d %s' % (s, qid, n, stem))

    out = {
        'byCard': {str(k): v for k, v in out_card.items()},
        'byQuestion': by_q,
    }
    with open('/Users/huli/Desktop/zcode/yiyizhi/knowledge_links.js', 'w', encoding='utf-8') as f:
        f.write('window.YYZ_LINK=')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('written knowledge_links.js')


if __name__ == '__main__':
    main()
