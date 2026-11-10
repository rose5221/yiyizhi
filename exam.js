/* 一页纸 · 题库
   646 道真题（2010–2026）+ 100 张知识卡双向回查 + 做题记录 / 错题本

   数据：
     window.YYZ_Q    questions.js   题目
     window.YYZ_LINK knowledge_links.js  题目 ↔ 知识点

   用法：打开页面后点顶部「题库」，或按 4。
*/
(function () {
  'use strict';

  if (!window.YYZ_Q) return;

  const Q = window.YYZ_Q.q;
  const LINK = window.YYZ_LINK || { byCard: {}, byQuestion: {} };
  const BY_ID = {};
  for (const q of Q) BY_ID[q.id] = q;

  const LS = {
    ans: 'yyz.ans.v1',      // {qid: ['A','C']} 用户作答
    wrong: 'yyz.wrong.v1',  // {qid: 1} 错题标记
    quiz: 'yyz.quiz.v1',    // {year, i} 上次做到哪
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function readJSON(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  const answers = readJSON(LS.ans) || {};
  const wrong = readJSON(LS.wrong) || {};
  const quizPos = readJSON(LS.quiz) || {};

  function saveAnswers() { writeJSON(LS.ans, answers); }
  function saveWrong() { writeJSON(LS.wrong, wrong); }

  const PART_NAME = {
    '马原': '马原',
    '毛中特': '毛中特',
    '史纲': '史纲',
    '思修法基': '思修法基',
    '时政': '时政',
  };

  const view = {
    tab: 'papers',     // papers | bank | wrong | cards
    year: null,        // 套卷模式下的年份
    i: 0,              // 套卷模式下的题序（0-37）
    revealed: false,   // 当前题是否已显示答案
    pick: [],          // 当前题已选项
    q: '',             // 题库检索词
    part: '',          // 题库学科筛选
    kind: '',          // 题库题型筛选
  };

  /* ---------------- 顶部：题库入口 tab ---------------- */

  function mountTab() {
    const tabs = $('#modeTabs');
    if (!tabs || tabs.querySelector('[data-mode="exam"]')) return;
    const b = el('button', null, '题库');
    b.dataset.mode = 'exam';
    b.onclick = () => {
      if (window.YYZ_APP && window.YYZ_APP.setMode) {
        window.YYZ_APP.setMode('exam');
      }
    };
    tabs.appendChild(b);
  }

  /* ---------------- 面板 ---------------- */

  function render() {
    const host = $('#view');
    if (!host) return;
    document.body.classList.add('exam-mode');
    host.textContent = '';
    const wrap = el('div', 'exam-wrap');

    wrap.appendChild(renderHead());

    if (view.tab === 'papers') wrap.appendChild(renderPapers());
    else if (view.tab === 'bank') wrap.appendChild(renderBank());
    else if (view.tab === 'wrong') wrap.appendChild(renderWrong());
    else if (view.tab === 'cards') wrap.appendChild(renderCards());

    host.appendChild(wrap);
    window.scrollTo(0, 0);
  }

  function renderHead() {
    const bar = el('div', 'exam-head');

    const tabs = el('div', 'chips exam-tabs');
    const defs = [
      ['papers', '套卷'],
      ['bank', '题库检索'],
      ['wrong', '错题本'],
      ['cards', '知识点回查'],
    ];
    for (const [k, label] of defs) {
      const b = el('button', view.tab === k ? 'on' : null, label);
      b.onclick = () => { view.tab = k; render(); };
      tabs.appendChild(b);
    }
    bar.appendChild(tabs);

    const meta = el('div', 'exam-meta');
    const total = Q.length;
    const done = Object.keys(answers).length;
    const wrongN = Object.keys(wrong).length;
    meta.innerHTML = total + ' 题 <i>·</i> 做过 ' + done + ' <i>·</i> 错题 ' + wrongN;
    bar.appendChild(meta);

    return bar;
  }

  /* ---------------- 套卷 ---------------- */

  function renderPapers() {
    const box = el('div', 'papers');

    if (view.year == null) {
      const grid = el('div', 'paper-grid');
      for (const y of window.YYZ_Q.years) {
        const qs = Q.filter((q) => q.y === y);
        const doneN = qs.filter((q) => answers[q.id]).length;
        const okN = qs.filter((q) => answers[q.id] && isRight(q, answers[q.id])).length;

        const b = el('button', 'paper-card');
        b.appendChild(el('b', null, String(y)));
        b.appendChild(el('span', 'org', '全国硕士研究生招生考试 · 思想政治理论'));
        const st = el('span', 'st');
        st.innerHTML = '<i>' + qs.length + ' 题</i>'
          + (doneN ? ' · 已做 ' + doneN + ' · 对 ' + okN : '');
        b.appendChild(st);

        const bar = el('span', 'pbar');
        const fill = el('i');
        fill.style.width = (doneN / qs.length * 100).toFixed(0) + '%';
        bar.appendChild(fill);
        b.appendChild(bar);

        if (y === 2026) b.appendChild(el('span', 'tag', '原卷无答案'));

        b.onclick = () => { view.year = y; view.i = 0; view.revealed = false; view.pick = []; render(); };
        grid.appendChild(b);
      }
      box.appendChild(grid);
      return box;
    }

    // 单套
    const list = Q.filter((q) => q.y === view.year).sort((a, b) => a.n - b.n);
    const q = list[view.i];
    if (!q) { view.i = 0; }

    const head = el('div', 'paper-top');
    const back = el('button', 'nav-btn', '← 换一套');
    back.onclick = () => { view.year = null; render(); };
    head.appendChild(back);
    head.appendChild(el('h2', null, view.year + ' 年真题'));

    const nums = el('div', 'qnums');
    for (let i = 0; i < list.length; i++) {
      const b = el('button', 'qn' + (i === view.i ? ' cur' : ''), String(list[i].n));
      if (answers[list[i].id]) b.classList.add(isRight(list[i], answers[list[i].id]) ? 'ok' : 'no');
      b.onclick = () => { view.i = i; view.revealed = false; view.pickFor = null; render(); };
      nums.appendChild(b);
    }
    head.appendChild(nums);
    box.appendChild(head);

    // 切到新题时才重置选择；同一题重绘要保住用户已点的选项
    if (view.pickFor !== q.id) {
      view.pick = answers[q.id] ? answers[q.id].slice() : [];
      view.pickFor = q.id;
    }
    box.appendChild(renderQuestion(q, {
      showAnswer: view.revealed || !!answers[q.id],
      onSubmit: (picked) => {
        answers[q.id] = picked;
        saveAnswers();
        const ok = isRight(q, picked);
        if (!ok) { wrong[q.id] = 1; } else { delete wrong[q.id]; }
        saveWrong();
        view.revealed = true;
        quizPos[view.year] = view.i;
        writeJSON(LS.quiz, quizPos);
        render();
      },
      onNext: () => {
        if (view.i >= list.length - 1) { view.year = null; render(); return; }
        view.i++;
        view.revealed = false;
        view.pick = [];
        render();
      },
      onPrev: () => {
        if (view.i <= 0) return;
        view.i--;
        view.revealed = false;
        view.pick = [];
        render();
      },
      onJumpCard: (n) => jumpToCard(n),
    }));
    return box;
  }

  /* ---------------- 单题渲染 ---------------- */

  function isRight(q, picked) {
    if (!q.a) return false;
    const p = (picked || []).slice().sort().join('');
    const a = q.a.split('').sort().join('');
    return p === a && p.length > 0;
  }

  function renderQuestion(q, opts) {
    opts = opts || {};
    const art = el('article', 'qcard');
    if (q.k === 'essay') art.classList.add('essay');

    const top = el('div', 'q-top');
    const label = el('span', 'q-label', q.id);
    top.appendChild(label);
    top.appendChild(el('span', 'q-part', PART_NAME[q.p] || q.p));
    top.appendChild(el('span', 'q-kind',
      q.k === 'single' ? '单选' : q.k === 'multi' ? '多选' : '分析题'));
    if (q.k === 'multi') top.appendChild(el('span', 'q-hint', '选不全不给分'));
    art.appendChild(top);

    art.appendChild(el('div', 'q-stem', q.s));

    if (q.k !== 'essay') {
      const list = el('div', 'q-opts');
      const picked = opts.showAnswer ? (answers[q.id] || view.pick) : view.pick;
      const locked = !!opts.showAnswer;

      for (const o of q.o) {
        const b = el('button', 'q-opt' + (picked.indexOf(o.l) >= 0 ? ' picked' : ''));
        b.appendChild(el('i', null, o.l));
        b.appendChild(el('span', null, o.t));
        if (locked && q.a) {
          if (q.a.indexOf(o.l) >= 0) b.classList.add('right');
          else if (picked.indexOf(o.l) >= 0) b.classList.add('bad');
        }
        b.onclick = () => {
          if (locked) return;
          if (q.k === 'single') view.pick = [o.l];
          else {
            const i = view.pick.indexOf(o.l);
            if (i >= 0) view.pick.splice(i, 1);
            else view.pick.push(o.l);
          }
          // 就地更新样式，不整页重绘（整页重绘会丢滚动位置）
          $$('.q-opt', art).forEach((x) => {
            const L = x.querySelector('i').textContent;
            x.classList.toggle('picked', view.pick.indexOf(L) >= 0);
          });
          const sub = $('.q-acts .nav-btn', art);
          if (sub) sub.disabled = view.pick.length === 0;
        };
        list.appendChild(b);
      }
      art.appendChild(list);

      if (!locked) {
        const acts = el('div', 'q-acts');
        const sub = el('button', 'nav-btn primary', q.k === 'multi' ? '提交答案' : '确定');
        sub.disabled = view.pick.length === 0;
        sub.onclick = () => opts.onSubmit(view.pick.slice());
        acts.appendChild(sub);
        art.appendChild(acts);
      }
    } else {
      if (q.q && q.q.length) {
        const asks = el('div', 'q-asks');
        for (const a of q.q) asks.appendChild(el('div', 'q-ask', a));
        art.appendChild(asks);
      }
      // 分析题没有可提交的选项，给一个「对答案要点」的出口
      if (!opts.showAnswer && q.a) {
        const acts = el('div', 'q-acts');
        const b = el('button', 'nav-btn primary', '看答案要点');
        b.onclick = () => { view.revealed = true; render(); };
        acts.appendChild(b);
        art.appendChild(acts);
      }
      if (!q.a) {
        art.appendChild(el('div', 'q-result unknown', '原卷未给出答案要点'));
      }
    }

    const showAns = opts.showAnswer;
    if (showAns) {
      if (q.k !== 'essay') {
        const ok = isRight(q, answers[q.id]);
        const res = el('div', 'q-result ' + (ok ? 'ok' : 'no'));
        if (!q.a) {
          res.textContent = q.note || '原卷未给出答案';
          res.className = 'q-result unknown';
        } else {
          res.innerHTML = (ok ? '✓ 正确' : '✕ 错误')
            + ' <i>答案 ' + (q.a || '—') + '</i>';
        }
        art.appendChild(res);
      }

      if (q.a && q.k === 'essay') {
        const ans = el('div', 'q-answer');
        ans.appendChild(el('div', 'ans-h', '答案要点'));
        ans.appendChild(el('div', 'ans-b', q.a));
        art.appendChild(ans);
      }
      if (q.a && q.k !== 'essay') {
        const ans = el('div', 'q-answer');
        ans.appendChild(el('div', 'ans-h', '正确答案'));
        const body = el('div', 'ans-b');
        for (const o of q.o) {
          if (q.a.indexOf(o.l) < 0) continue;
          const row = el('div', 'ans-row');
          row.appendChild(el('b', null, o.l));
          row.appendChild(el('span', null, o.t));
          body.appendChild(row);
        }
        ans.appendChild(body);
        art.appendChild(ans);
      }

    }

    // 挂到的知识点：不管有没有作答都显示，随时能跳回卡
    const links = LINK.byQuestion[q.id] || [];
    if (links.length) {
      const ref = el('div', 'q-ref');
      ref.appendChild(el('span', 'ref-h', '回到知识点'));
      for (const it of links) {
        const b = el('button', 'ref-card', '知识点 ' + String(it.card).padStart(3, '0'));
        b.title = '跳到这张卡';
        b.onclick = () => opts.onJumpCard && opts.onJumpCard(it.card);
        ref.appendChild(b);
      }
      art.appendChild(ref);
    } else {
      // 没挂上的题：按学科给个翻卡出口，别让人卡在这儿
      const ref = el('div', 'q-ref');
      ref.appendChild(el('span', 'ref-h', '这题还没挂到卡'));
      const mod = q.p === '马原' ? '马原' : q.p === '史纲' ? '史纲' : null;
      if (mod) {
        const b = el('button', 'ref-card', '翻 ' + mod + ' 的卡 →');
        b.onclick = () => {
          const chip = document.querySelector('#modChips button[data-mod="' + mod + '"]');
          if (chip) chip.click();
          if (window.YYZ_APP) window.YYZ_APP.setMode('index');
        };
        ref.appendChild(b);
      }
      art.appendChild(ref);
    }

    if (opts.onNext) {
      const nav = el('div', 'q-nav');
      const p = el('button', 'nav-btn', '← 上一题');
      p.onclick = opts.onPrev;
      p.disabled = view.i <= 0;
      const n = el('button', 'nav-btn primary', view.i >= 37 ? '这套结束' : '下一题 →');
      n.onclick = opts.onNext;
      nav.appendChild(p);
      nav.appendChild(n);
      art.appendChild(nav);
    }

    return art;
  }

  /* ---------------- 题库检索 ---------------- */

  function matchQ(q, kw) {
    if (!kw) return true;
    const k = kw.toLowerCase();
    if (q.id.indexOf(k) >= 0) return true;
    if (q.s.toLowerCase().indexOf(k) >= 0) return true;
    if ((q.o || []).some((o) => o.t.toLowerCase().indexOf(k) >= 0)) return true;
    return false;
  }

  function renderBank() {
    const box = el('div', 'bank');

    const bar = el('div', 'bank-bar');
    const inp = el('input');
    inp.type = 'search';
    inp.placeholder = '搜题干 / 选项 / 题号，比如 2024-1、实践、法治…';
    inp.value = view.q;
    inp.oninput = (e) => {
      view.q = e.target.value;
      clearTimeout(inp._t);
      inp._t = setTimeout(() => {
        const keep = document.activeElement === inp ? inp.selectionStart : null;
        render();
        const n = $('.bank-bar input');
        if (n) { n.focus(); if (keep != null) n.setSelectionRange(keep, keep); }
      }, 180);
    };
    bar.appendChild(inp);

    const parts = el('div', 'chips');
    const pdefs = [['', '全部'], ['马原', '马原'], ['毛中特', '毛中特'], ['史纲', '史纲'], ['思修法基', '思修法基'], ['时政', '时政']];
    for (const [v, label] of pdefs) {
      const b = el('button', view.part === v ? 'on' : null, label);
      b.onclick = () => { view.part = v; render(); };
      parts.appendChild(b);
    }
    bar.appendChild(parts);

    const kinds = el('div', 'chips');
    const kdefs = [['', '全部'], ['single', '单选'], ['multi', '多选'], ['essay', '分析']];
    for (const [v, label] of kdefs) {
      const b = el('button', view.kind === v ? 'on' : null, label);
      b.onclick = () => { view.kind = v; render(); };
      kinds.appendChild(b);
    }
    bar.appendChild(kinds);
    box.appendChild(bar);

    let rows = Q.filter((q) => (!view.part || q.p === view.part)
      && (!view.kind || q.k === view.kind)
      && matchQ(q, view.q.trim()));

    const cnt = el('div', 'bank-count', '命中 ' + rows.length + ' 题' + (rows.length > 200 ? ' · 只列前 200' : ''));
    box.appendChild(cnt);

    const list = el('div', 'qlist');
    for (const q of rows.slice(0, 200)) {
      const b = el('button', 'qrow');
      b.appendChild(el('span', 'rid', q.id));
      b.appendChild(el('span', 'rk', q.k === 'single' ? '单' : q.k === 'multi' ? '多' : '析'));
      b.appendChild(el('span', 'rs', q.s.slice(0, 90)));
      if (answers[q.id]) b.appendChild(el('span', 'rbadge ' + (isRight(q, answers[q.id]) ? 'ok' : 'no'),
        isRight(q, answers[q.id]) ? '✓' : '✕'));
      b.onclick = () => {
        view.year = q.y;
        const list2 = Q.filter((x) => x.y === q.y).sort((a, c) => a.n - c.n);
        view.i = list2.findIndex((x) => x.id === q.id);
        view.revealed = !!answers[q.id];
        view.tab = 'papers';
        render();
      };
      list.appendChild(b);
    }
    if (!rows.length) list.appendChild(el('div', 'empty', '没有匹配的题，换个词试试'));
    box.appendChild(list);
    return box;
  }

  /* ---------------- 错题本 ---------------- */

  function renderWrong() {
    const box = el('div', 'wrongbox');
    const ids = Object.keys(wrong).filter((id) => BY_ID[id]);
    ids.sort((a, b) => {
      const A = BY_ID[a], B = BY_ID[b];
      return B.y - A.y || A.n - B.n;
    });

    const head = el('div', 'wrong-head');
    head.appendChild(el('h2', null, '错题本'));
    head.appendChild(el('span', null, ids.length + ' 题'));

    if (ids.length) {
      const exp = el('button', 'nav-btn', '导出为文本');
      exp.onclick = () => exportWrong(ids);
      head.appendChild(exp);
      const clr = el('button', 'nav-btn', '清空错题');
      clr.onclick = () => {
        if (!confirm('清空错题本？做题记录会一并清掉。')) return;
        for (const id of Object.keys(wrong)) { delete wrong[id]; delete answers[id]; }
        saveWrong(); saveAnswers();
        render();
      };
      head.appendChild(clr);
    }
    box.appendChild(head);

    if (!ids.length) {
      box.appendChild(el('div', 'empty', '还没有错题。做几套卷子，错的会自动进来。'));
      return box;
    }

    const list = el('div', 'qlist');
    for (const id of ids) {
      const q = BY_ID[id];
      const b = el('button', 'qrow');
      b.appendChild(el('span', 'rid', q.id));
      b.appendChild(el('span', 'rk', q.k === 'single' ? '单' : q.k === 'multi' ? '多' : '析'));
      b.appendChild(el('span', 'rs', q.s.slice(0, 90)));
      b.appendChild(el('span', 'rbadge no', '✕'));
      b.onclick = () => {
        view.year = q.y;
        const l = Q.filter((x) => x.y === q.y).sort((a, c) => a.n - c.n);
        view.i = l.findIndex((x) => x.id === q.id);
        view.revealed = true;
        view.tab = 'papers';
        render();
      };
      list.appendChild(b);
    }
    box.appendChild(list);
    return box;
  }

  function exportWrong(ids) {
    const lines = [];
    lines.push('# 错题本 · ' + new Date().toLocaleDateString('zh-CN'));
    lines.push('');
    for (const id of ids) {
      const q = BY_ID[id];
      lines.push('## ' + q.id + '  [' + (PART_NAME[q.p] || q.p) + ' · '
        + (q.k === 'single' ? '单选' : q.k === 'multi' ? '多选' : '分析题') + ']');
      lines.push(q.s);
      if (q.o) for (const o of q.o) lines.push(o.l + '. ' + o.t);
      if (q.q) for (const a of q.q) lines.push(a);
      if (q.a) lines.push('答案：' + q.a);
      const mine = answers[id];
      if (mine) lines.push('我选：' + mine.join(''));
      const links = LINK.byQuestion[id] || [];
      if (links.length) lines.push('知识点：' + links.map((x) => '知识点' + String(x.card).padStart(3, '0')).join(' / '));
      lines.push('');
    }
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(
      () => toast('已复制 ' + ids.length + ' 道错题到剪贴板'),
      () => {
        const ta = el('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        toast('已复制到剪贴板');
      }
    );
  }

  /* ---------------- 知识点回查 ---------------- */

  function renderCards() {
    const box = el('div', 'cardlinks');
    box.appendChild(el('div', 'cl-h', '每张知识卡下面挂着做过的真题'));

    const cards = (window.YYZ_DATA && window.YYZ_DATA.cards) || [];
    const list = el('div', 'cl-list');

    for (const c of cards) {
      const ids = LINK.byCard[String(c.n)] || [];
      const b = el('button', 'cl-row' + (ids.length ? '' : ' dim'));

      const l = el('span', 'cl-l');
      l.appendChild(el('b', null, String(c.n).padStart(3, '0')));
      l.appendChild(el('span', 'cl-t', c.t));
      l.appendChild(el('span', 'cl-m', c.m + ' / ' + c.sec));
      b.appendChild(l);

      const r = el('span', 'cl-r');
      if (ids.length) {
        r.appendChild(el('span', 'cl-n', ids.length + ' 题'));
        // 显示最近 3 题的编号
        r.appendChild(el('span', 'cl-ids', ids.slice(0, 3).join(' ')));
      } else {
        r.appendChild(el('span', 'cl-n none', '暂无'));
      }
      b.appendChild(r);

      b.onclick = () => {
        if (!ids.length) { jumpToCard(c.n); return; }
        // 展开：显示这卡挂的所有题
        const old = box.querySelector('.cl-open');
        if (old) old.remove();
        const panel = el('div', 'cl-open');
        const hd = el('div', 'cl-open-h');
        hd.appendChild(el('b', null, '知识点 ' + String(c.n).padStart(3, '0') + ' · ' + c.t));
        const goCard = el('button', 'nav-btn', '看这张卡 →');
        goCard.onclick = () => jumpToCard(c.n);
        hd.appendChild(goCard);
        panel.appendChild(hd);

        for (const id of ids) {
          const q = BY_ID[id];
          if (!q) continue;
          const row = el('button', 'qrow');
          row.appendChild(el('span', 'rid', q.id));
          row.appendChild(el('span', 'rk', q.k === 'single' ? '单' : q.k === 'multi' ? '多' : '析'));
          row.appendChild(el('span', 'rs', q.s.slice(0, 80)));
          const a = answers[id];
          if (a) {
            row.appendChild(el('span', 'rbadge ' + (isRight(q, a) ? 'ok' : 'no'), isRight(q, a) ? '✓' : '✕'));
          }
          row.onclick = () => {
            view.year = q.y;
            const l2 = Q.filter((x) => x.y === q.y).sort((x, y2) => x.n - y2.n);
            view.i = l2.findIndex((x) => x.id === q.id);
            view.revealed = !!answers[q.id];
            view.tab = 'papers';
            render();
          };
          panel.appendChild(row);
        }
        b.after(panel);
      };
      list.appendChild(b);
    }
    box.appendChild(list);
    return box;
  }

  /* ---------------- 与主程序交互 ---------------- */

  function jumpToCard(n) {
    const app = window.YYZ_APP;
    if (!app) return;
    app.gotoCard(n);
  }

  let toastT = null;
  function toast(msg) {
    const h = $('#hint');
    if (!h) return;
    h.textContent = msg;
    h.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => h.classList.remove('show'), 1600);
  }

  /* ---------------- 键盘：套卷内翻页 ---------------- */

  document.addEventListener('keydown', (e) => {
    if (window.YYZ_APP && window.YYZ_APP.mode() !== 'exam') return;
    if (e.target.matches('input, textarea')) return;
    if (view.tab !== 'papers' || view.year == null) return;

    if (e.key === 'ArrowRight' || e.key === 'j') {
      e.preventDefault();
      if (view.i < 37) { view.i++; view.revealed = !!answers[Q.filter((q) => q.y === view.year).sort((a, b) => a.n - b.n)[view.i].id]; render(); }
    } else if (e.key === 'ArrowLeft' || e.key === 'k') {
      e.preventDefault();
      if (view.i > 0) { view.i--; view.revealed = !!answers[Q.filter((q) => q.y === view.year).sort((a, b) => a.n - b.n)[view.i].id]; render(); }
    } else if (e.key === 'Enter' && !view.revealed) {
      const q = Q.filter((x) => x.y === view.year).sort((a, b) => a.n - b.n)[view.i];
      if (view.pick.length) {
        answers[q.id] = view.pick.slice();
        saveAnswers();
        if (isRight(q, view.pick)) delete wrong[q.id]; else wrong[q.id] = 1;
        saveWrong();
        view.revealed = true;
        render();
      }
    }
  });

  window.YYZ_EXAM = {
    render,
    mountTab,
    get tab() { return view.tab; },
    setTab(t) { view.tab = t; },
    /* 从知识卡点进来：直接定位到那道题 */
    openQuestion(id) {
      const q = BY_ID[id];
      if (!q || !window.YYZ_APP) return;
      const list = Q.filter((x) => x.y === q.y).sort((a, b) => a.n - b.n);
      view.year = q.y;
      view.i = list.findIndex((x) => x.id === id);
      view.tab = 'papers';
      view.revealed = !!answers[id];
      view.pick = answers[id] ? answers[id].slice() : [];
      window.YYZ_APP.setMode('exam');
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTab);
  } else {
    mountTab();
  }
})();
