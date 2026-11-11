#!/usr/bin/env python3
"""把真题挂到 100 张知识卡上 —— v2

v1 只做 n-gram 余弦，问题：
  - 没有专名概念，「遵义会议」被拆成「遵义」「义会」「会议」，和「会议大观」里的「会议」撞
  - 会议大观上/中/下三张卡内容高度重叠，光靠相似度分不开
  - 结果：一题挂到 3 张卡，其中 2 张是错的

v2 改成分档打分：

  1. 专名精确命中（权重最高）
     书名号《…》、会议名（中共一大/遵义会议/十一届三中全会…）、
     带「战争/运动/思想/路线/纲领」的术语。命中一个就加很多分。
  2. 标题命中：题干里出现知识卡标题本身，直接强加分。
  3. 4-gram（IDF 加权）关键短语
  4. 2-gram 软匹配，权重压低

并且只输出最高分那一张卡，除非第二张分数极度接近（≥0.93）才算并列。
宁缺勿滥：不到阈值就留空。
"""
import json
import math
import re
from collections import Counter, defaultdict

SRC = '/tmp/yyz_pdf/data/questions_raw.json'
DATA = '/Users/huli/Desktop/zcode/yiyizhi/data.js'
OUT = '/Users/huli/Desktop/zcode/yiyizhi/knowledge_links.js'

with open(SRC, encoding='utf-8') as f:
    QUESTIONS = json.load(f)

raw = open(DATA, encoding='utf-8').read()
CARDS = json.loads(raw.split('=', 1)[1].rstrip().rstrip(';'))['cards']

PUNCT = re.compile(r'[^\u4e00-\u9fffA-Za-z0-9]+')


def card_text(c):
    return c['t'] + ' ' + ' '.join(''.join(s['t'] for s in l['s']) for l in c['L'])


def qtext(q):
    if q['kind'] == 'essay':
        parts = [q['stem']] + list(q.get('asks') or []) + [q.get('answer') or '']
        return ' '.join(parts)
    opts = ' '.join(o['text'] for o in (q.get('options') or []))
    return q['stem'] + ' ' + opts


def grams(text, n):
    ch = re.sub(r'\s+', '', PUNCT.sub(' ', text))
    out = []
    for seg in re.findall(r'[\u4e00-\u9fff]+', ch):
        for i in range(len(seg) - n + 1):
            out.append(seg[i:i + n])
    return out


def feats(text):
    return Counter(grams(text, 4)), Counter(grams(text, 2))


MEETING = re.compile(
    r'(?:中共|党的)?[一二三四五六七八九十百]+届[一二三四五六七八九十]+中(?:全会)?'
    r'|中共[一二三四五六七八九十]+大'
    r'|国民党[一二三四五六七八九十]+大'
    r'|(?:八七会议|古田会议|遵义会议|瓦窑堡会议|洛川会议|人民政协|延安整风|真理标准问题讨论)'
)

# 会议 → 相关主题词：让「遵义会议」也能命中讲长征的卡
MEETING_THEMES = {
    '遵义会议': ['长征', '转危为安'],
    '八七会议': ['枪杆子', '武装斗争'],
    '古田会议': ['军队', '思想建党'],
    '瓦窑堡会议': ['抗日民族统一战线'],
    '洛川会议': ['全面抗战'],
}
BOOK = re.compile(r'《[^》]{2,30}》')

# 泛化术语：不算专名（它们满书都是，用来做专名只会互相骗分）

# 标题里这些词，如果只是被别的更长词包着出现，就不算命中
STOP_TAIL = '战争运动命革争斗'


def title_variants(title):
    """把标题拆成可判定的候选：整串 + 用「与/和/及」、破折号、括号切开的部分

    「战时共产主义与新经济政策」→ ['战时共产主义与新经济政策', '战时共产主义', '新经济政策']
    「资本主义的新变化-二战后」→ ['资本主义的新变化-二战后', '资本主义的新变化', '二战后']
    """
    out = [title]
    body = re.sub(r'[（(][^）)]*[）)]', '', title).strip()
    if body and body != title:
        out.append(body)
    for part in re.split(r'[与和及、,，/—\-]+', body):
        part = part.strip()
        if len(part) >= 3 and part not in out:
            out.append(part)
    return [x for x in out if len(x) >= 2]


def title_in(title, text):
    """标题是否出现在 text 里，且不是被更长的同类词包住

    「解放战争」出现在「抗日战争…」里 → 不算（前面那个字是「日」，构成另一个战争名）
    「战时共产主义与新经济政策」题干只提「新经济政策」→ 算（子标题命中）
    太短或太泛的标题 → 不算
    """
    if not title or title in GENERIC or len(title) < 2:
        return False
    for v in title_variants(title):
        if v in WEAK_TITLE:
            # 泛标题只有一种情况算：这道题就是在专讲它
            #   题干里出现 3 次以上，或标题式开头（「实践：…」「实践是…」）
            if not _title_exact(v, text):
                continue
            if text.count(v) >= 3:
                return True
            if re.match(r'^\s*' + re.escape(v) + r'\s*[：:是，,]', text):
                return True
            continue
        if _title_exact(v, text):
            return True
    return False


def _title_exact(title, text):
    if title in GENERIC or len(title) < 2:
        return False

    start = 0
    while True:
        i = text.find(title, start)
        if i < 0:
            return False
        start = i + 1

        prev = text[i - 1] if i > 0 else ''
        is_cjk_prev = '\u4e00' <= prev <= '\u9fff'

        if not is_cjk_prev:
            return True

        # 标题以「战争/运动/革命」等收尾，而前面还贴着汉字：
        # 说明命中的是「抗日战争」里的「战争」这种碎片，继续找下一处
        if title[-1] in STOP_TAIL:
            continue

        # 其它情况：前面虽然贴汉字（「实践证明」），但标题本身是完整词组，算命中
        return True


# 这些当卡标题时太泛：任何题都可能出现，不能当「这题讲的就是这张卡」的证据
WEAK_TITLE = {
    '实践', '自由', '斗争', '觉醒', '论战', '萌芽', '成熟',
    '社会生产', '马克思主义', '会议大观', '会议大观上', '会议大观中', '会议大观下',
}

GENERIC = {
    '政治路线', '思想路线', '组织路线', '教条主义', '主观主义', '宗派主义',
    # 太笼统、任何题都可能沾上的词（不含「实践」「自由」这类本身是正经考点的）
    '转折点', '斗争', '觉醒', '论战', '萌芽', '成熟',
    '马克思主义', '社会主义', '共产主义', '资本主义', '帝国主义', '封建主义',
    '民主革命', '社会革命', '政治革命', '文化革命', '社会主义改造',
    '人民战争', '民族战争', '解放战争', '革命战争',
    '大会', '决议', '报告', '会议',
}


def named_entities(text):
    """只抽高辨识度的专名：书名号、会议名。泛化术语一律不算。"""
    out = set()
    for m in BOOK.finditer(text):
        s = m.group(0).replace(' ', '')
        if len(s) >= 5:
            out.add(s)
    for m in MEETING.finditer(text):
        s = m.group(0).replace(' ', '')
        if len(s) >= 3 and s not in GENERIC:
            out.add(s)
    # 会议名带出相关主题词（遵义会议 → 长征）
    for name, themes in MEETING_THEMES.items():
        if name in text:
            for t in themes:
                if len(t) >= 2:
                    out.add(t)
    return out


PART_TO_CARD = {
    '马原': {'马原'},
    '史纲': {'史纲'},
    '毛中特': {'其他'},
    '思修法基': {'其他'},
    '时政': {'其他'},
}

# 抽检结论：
#   0.36+   基本都对
#   0.26-0.36  10 道里 8 道对（社会主义改造→个体工商户改造、金融资本→金融资本形成）
#   <0.26   明显变差（金融资本→自由、建党→马克思主义）
MIN_SCORE = {
    '马原': 0.26,
    '史纲': 0.26,
    '毛中特': 0.26,
    '思修法基': 0.26,
    '时政': 0.26,
}


TERM_SUFFIX = ('战争', '运动', '思想', '纲领', '改造', '体系', '矛盾')


def phrases(text):
    """中辨识度短语：以术语后缀结尾的 4/5-gram，且不在泛化黑名单里"""
    out = set()
    for n in (4, 5):
        for g in grams(text, n):
            if g.endswith(TERM_SUFFIX) and g not in GENERIC:
                out.add(g)
    return out


def main():
    card_feat, card_names, card_phr = [], [], []
    for c in CARDS:
        t = card_text(c)
        f4, f2 = feats(t)
        card_feat.append((f4, f2))
        card_names.append(named_entities(t))
        card_phr.append(phrases(t))

    df4, df2 = Counter(), Counter()
    for f4, f2 in card_feat:
        for k in f4:
            df4[k] += 1
        for k in f2:
            df2[k] += 1
    N = len(card_feat)

    def idf4(k):
        return math.log((N + 1) / (df4[k] + 1)) + 0.5

    def idf2(k):
        return math.log((N + 1) / (df2[k] + 1)) + 0.5

    n4, n2 = [], []
    for f4, f2 in card_feat:
        n4.append(math.sqrt(sum((v * idf4(k)) ** 2 for k, v in f4.items()) or 1))
        n2.append(math.sqrt(sum((v * idf2(k)) ** 2 for k, v in f2.items()) or 1))

    # 标题片段：标题按 3/4-gram 切（此时 df 已算好）
    title_grams = []
    for c in CARDS:
        gs = set(grams(c['t'], 3)) | set(grams(c['t'], 4))
        title_grams.append({g for g in gs if len(g) >= 3})

    by_card, by_q, log = defaultdict(list), {}, []
    unmatched = defaultdict(int)
    stats = Counter()

    for q in QUESTIONS:
        qt = qtext(q)
        qf4, qf2 = feats(qt)
        qn4 = math.sqrt(sum((v * idf4(k)) ** 2 for k, v in qf4.items()) or 1)
        qn2 = math.sqrt(sum((v * idf2(k)) ** 2 for k, v in qf2.items()) or 1)
        qnames = named_entities(qt)
        qphr = phrases(qt)

        allow = PART_TO_CARD.get(q['part'])
        if not allow:
            unmatched[q['part']] += 1
            continue
        thr = MIN_SCORE.get(q['part'], 0.14)

        scored = []
        for i, c in enumerate(CARDS):
            if c['m'] not in allow:
                continue

            cnames = card_names[i]
            hit = qnames & cnames
            strong = 0
            for a in qnames:
                if a in cnames:
                    continue
                for b in cnames:
                    # 会议名之间互相包含才算（「遵义会议」⊂「遵义会议的意义」）
                    if len(b) >= len(a) and a in b:
                        strong += 1
                        break
                    if len(a) >= len(b) and b in a and len(b) >= 4:
                        strong += 1
                        break
            name_score = min(1.0, (len(hit) + strong * 0.7) / 3.0)

            # 中辨识度短语命中（只算题干里、这张卡也有的）
            # 短语命中按 IDF 加权：只有「稀有短语」才算证据，
            # 否则「马克思主义」「社会主义」这种满书都是的词会把任意两段文字连起来
            phr_common = qphr & card_phr[i]
            phr_w = sum(idf4(g) for g in phr_common)
            phr_all = sum(idf4(g) for g in qphr) or 1.0
            rare_hits = sum(1 for g in phr_common if df4[g] <= 3)
            phr_score = (phr_w / phr_all) if phr_common else 0.0
            if rare_hits == 0:
                phr_score *= 0.3

            # 标题整串命中。判据要比单纯的 in 严：
            #   「解放战争」不能因为题干里有「抗日战争」就算命中（短标题是子串陷阱）
            title_hit = 1.0 if title_in(c['t'], qt) else 0.0

            # 标题片段命中。只认整标题命中的卡才算数：
            # 「民族解放战争」里有「解放战争」，但卡标题是「解放战争」而题干讲的是抗日战争，
            # 靠片段给分会把两场战争搞混。
            if title_hit:
                th_hits = 0.0
                th_total = 0.0
                for tg in title_grams[i]:
                    w = idf4(tg)
                    th_total += w
                    if tg in qt:
                        th_hits += w
                title_score = (th_hits / th_total) if th_total else 0.0
                # 片段全中才给高分；部分命中打折
                title_score *= (2.0 / 3.0) if len(title_grams[i]) > 1 else 1.0
            else:
                title_score = 0.0

            f4, f2 = card_feat[i]
            d4 = sum(v * f4.get(k, 0) * idf4(k) for k, v in qf4.items())
            c4 = (d4 / (qn4 * n4[i])) if n4[i] else 0
            d2 = sum(v * f2.get(k, 0) * idf2(k) for k, v in qf2.items())
            c2 = (d2 / (qn2 * n2[i])) if n2[i] else 0

            # 打分分档：前三档必须有「可解释信号」才给分。
            # 裸 c4（余弦）在长题干 vs 长卡片时噪声太大，
            # 会让「马克思进文庙」这种题挂到「会议大观中」上，所以直接不给分。
            if name_score or title_hit:
                score = 0.55 * name_score + 0.45 * title_hit + 0.22 * c4
            elif title_score >= 0.42:
                score = 0.50 * title_score + 0.30 * c4
            elif phr_score >= 0.45:
                score = 0.50 * phr_score + 0.38 * c4
            else:
                score = 0.0

            # 题干有专名、这张卡一个都没命中 → 大概率高辨识度词不在卡里
            if qnames and not (hit or strong or title_hit):
                score *= 0.40

            scored.append((score, c['n'], name_score, title_hit, c4, phr_score, title_score))

        if not scored:
            unmatched[q['part']] += 1
            continue

        scored.sort(reverse=True)
        # 只有「专名命中」或「标题整串命中」才准许以低分挂；
        # 纯片段/短语命中的，必须分数够高（否则「抗战→解放战争」这种会漏进来）
        scored = [x for x in scored
                  if (x[2] > 0 or x[3] > 0) or (x[5] >= 0.45 and x[0] >= thr * 1.8)]
        if not scored:
            unmatched[q['part']] += 1
            continue

        top = scored[0]
        if top[0] < thr:
            unmatched[q['part']] += 1
            continue

        picks = [top]
        if len(scored) > 1 and scored[1][0] >= top[0] * 0.97:
            picks.append(scored[1])

        by_q[q['id']] = [{'card': n, 'score': round(s, 4)} for s, n, *_ in picks]
        for s, n, *_rest in picks:
            by_card[n].append((q['id'], s))

        if top[2] > 0:
            stats['专名'] += 1
        elif top[3] > 0:
            stats['标题'] += 1
        elif top[6] >= 0.42:
            stats['标题片段'] += 1
        elif top[5] >= 0.45:
            stats['短语'] += 1
        else:
            stats['相似度'] += 1
        log.append((top[0], q['id'], top[1], top[2], top[3], top[4], top[5], top[6], q['stem'][:42]))

    out_card = {}
    for n, lst in by_card.items():
        lst.sort(key=lambda x: -x[1])
        out_card[n] = [qid for qid, s in lst][:60]

    log.sort(reverse=True)
    print('挂上的题', len(by_q), '/', len(QUESTIONS))
    print('有题卡数', len(out_card), '/ 100')
    print('命中方式', dict(stats))
    print('未匹配', dict(unmatched))
    print('平均每题卡数', round(sum(len(v) for v in by_q.values()) / max(1, len(by_q)), 2))

    print('\n--- 专名命中（可信） ---')
    for r in [x for x in log if x[3] > 0][:5]:
        print('%.3f %s -> 卡%-3d 专名%.2f | %s' % (r[0], r[1], r[2], r[3], r[8]))
    print('\n--- 标题片段 ---')
    for r in [x for x in log if x[3] == 0 and x[4] == 0 and x[7] >= 0.42][:6]:
        print('%.3f %s -> 卡%-3d 标题%.2f | %s' % (r[0], r[1], r[2], r[7], r[8]))
    print('\n--- 只看相似度（抽查用） ---')
    for r in [x for x in log if x[3] == 0 and x[4] == 0 and x[7] < 0.55 and x[6] < 0.45][:6]:
        print('%.3f %s -> 卡%-3d 4g%.2f | %s' % (r[0], r[1], r[2], r[4], r[8]))

    out = {'byCard': {str(k): v for k, v in out_card.items()}, 'byQuestion': by_q}
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('window.YYZ_LINK=')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print('\nwritten', OUT)


if __name__ == '__main__':
    main()
