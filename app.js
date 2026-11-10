/* 一页纸 · 每天过一遍
   顺序过 / 遮色自测 / 目录 三模式 + 配速 + 本地进度 */

(function () {
  'use strict';

  const DATA = window.YYZ_DATA;
  const CARDS = DATA.cards.slice().sort((a, b) => a.n - b.n);

  const LS = {
    prog: 'yyz.progress.v1',
    pref: 'yyz.pref.v1',
    day:  'yyz.day.v1',
  };

  /* ---------------- state ---------------- */

  const state = {
    mode: 'read',
    mod: '',
    q: '',
    weakOnly: false,
    curN: 1,          // 当前卡片的知识点编号（真正的锚点）
    idx: 0,           // 在当前筛选/配速列表中的位置
    revealed: new Set(),   // revealed spans in current card (recall)
    elapsed: 0,            // seconds
    running: false,
    started: false,
  };

  const pref = Object.assign({
    budget: 60,
    size: 17,
    blur: 5,
    hard: false,
  }, readJSON(LS.pref) || {});

  const progress = Object.assign({}, readJSON(LS.prog) || {});
  const dayLog = readJSON(LS.day) || { last: '', streak: 0 };

  /* ---------------- storage ---------------- */

  function readJSON(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  function rec(n) {
    return progress[n] || { seen: 0, yes: 0, no: 0, star: 0 };
  }
  function saveRec(n, patch) {
    progress[n] = Object.assign({ seen: 0, yes: 0, no: 0, star: 0 }, rec(n), patch);
    writeJSON(LS.prog, progress);
  }

  /* ---------- 打卡 / 连击 ---------- */

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function touchDay() {
    const t = todayKey();
    if (dayLog.last === t) return;
    const y = new Date(Date.now() - 864e5);
    const yk = y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0');
    dayLog.streak = (dayLog.last === yk) ? (dayLog.streak || 0) + 1 : 1;
    dayLog.last = t;
    writeJSON(LS.day, dayLog);
    paintStreak();
  }

  function paintStreak() {
    $('#streakNum').textContent = dayLog.streak || 0;
  }

  /* ---------------- dom helpers ---------------- */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------- filtering ---------------- */

  function visible() {
    const q = state.q.trim().toLowerCase();
    return CARDS.filter((c) => {
      if (state.mod && c.m !== state.mod) return false;
      if (state.weakOnly) {
        const r = rec(c.n);
        if (!(r.no > 0 && r.yes === 0) && !r.star) return false;
      }
      if (q) {
        const hay = (c.t + ' ' + c.sec + ' ' + c.L.map((l) => l.s.map((s) => s.t).join('')).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  /* ---------------- pacing ---------------- */

  // 每屏成本：固定切换开销 + 需要回忆的彩色字 + 少量扫读灰字
  function cardio(seg) {
    let g = 0, k = 0;
    for (const l of seg.lines) {
      for (const s of l.s) {
        if (s.r === 'g') g += s.t.length;
        else k += s.t.length;
      }
    }
    return 6 + k * 0.25 + g * 0.06;
  }

  function plan(list) {
    const ws = list.map(cardio);
    const tot = ws.reduce((a, b) => a + b, 0) || 1;
    const budget = pref.budget * 60;
    let acc = 0;
    const cum = ws.map((w) => { acc += w; return acc / tot * budget; });
    return cum;
  }

  let planCum = [];
  let planList = [];     // 段列表（一段=一屏）
  let planCards = [];    // 段对应的原始卡片

  // 一屏装得下多少：按字号/视口实测容量切段
  function segWeight(lines) {
    let g = 0, k = 0;
    for (const l of lines) {
      for (const s of l.s) {
        if (s.r === 'g') g += s.t.length;
        else k += s.t.length;
      }
    }
    return 10 + g * 0.55 + k * 2.2;
  }

  /* 分段：真正塞进 DOM 里量，不靠估算。
     用一个离屏测量容器复刻 .card-body 的宽度/字号/行高，逐行累加直到撑满。 */
  const PROBE_ROWS = {};

  function probeEl() {
    let p = document.getElementById('__probe');
    if (!p) {
      p = document.createElement('div');
      p.id = '__probe';
      p.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(p);
    }
    return p;
  }

  function measureSet(lines, card) {
    const body = document.querySelector('.card-body');
    const cs = body ? getComputedStyle(body) : null;
    const p = probeEl();
    const w = body ? body.clientWidth : 700;
    p.style.width = w + 'px';
    p.style.fontSize = (cs ? cs.fontSize : pref.size + 'px');
    p.style.lineHeight = (cs ? cs.lineHeight : pref.size * 1.85 + 'px');
    p.style.fontFamily = cs ? cs.fontFamily : 'serif';
    p.style.whiteSpace = 'normal';
    p.innerHTML = '';
    const wrap = document.createElement('div');
    p.appendChild(wrap);

    for (const line of lines) {
      const ln = document.createElement('div');
      ln.className = 'ln' + (line.x > 52 ? ' indent' : '') + (line.w ? ' tight' : '');
      if (line.i && line.i.length) {
        const ic = document.createElement('span');
        ic.className = 'ic';
        ic.style.cssText = 'display:inline-block;width:1.05em;height:1.05em;margin-right:5px;';
        ln.appendChild(ic);
      }
      const t = document.createElement('span');
      t.className = 'txt';
      t.textContent = line.s.map((s) => s.t).join('');
      ln.appendChild(t);
      wrap.appendChild(ln);
    }
    const h = wrap.getBoundingClientRect().height;
    // 每一行自己的高度
    const heights = Array.from(wrap.children).map((n) => n.getBoundingClientRect().height);
    return { total: h, heights };
  }

  /* 卡片最大可用高度：直接量一张「空卡片」在 -99999 位置，不受当前内容影响 */
  function cardMaxBody() {
    const body = document.querySelector('.card-body');
    const cs = body ? getComputedStyle(body) : null;
    const topbar = $('.topbar').offsetHeight;
    const tabs = $('.tabs').offsetHeight;
    const foot = $('.footer').offsetHeight;
    const padV = cs ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 46;
    // .stage 的 padding 上下各 18 / 6
    const stagePad = 18 + 6;
    // 卡片边框 2px
    const hd = document.querySelector('.card-head');
    // 测量头时用「最长标题」保险：标题折行会让头变高
    const headH = hd ? Math.max(hd.offsetHeight, pref.size >= 20 ? 140 : 74) : 80;
    // 实测：卡片在 stage 内会额外占用约 1.28 倍（flex 收缩 + 行高取整），按此校准
    // 再扣掉 .more 提示行（约 46px）与滚动条/边框余量
    const raw = window.innerHeight - topbar - tabs - foot - stagePad - 2 - headH - padV - 30 - 46;
    return Math.max(90, raw * 0.97);
  }

  function splitCard(card) {
    const lines = card.L;
    if (!lines.length) return [{ card, part: 1, parts: 1, lines }];

    const body = document.querySelector('.card-body');
    const cs = body ? getComputedStyle(body) : null;
    const p = probeEl();
    p.style.width = (body ? body.clientWidth : 700) + 'px';
    p.style.fontSize = cs ? cs.fontSize : pref.size + 'px';
    p.style.lineHeight = cs ? cs.lineHeight : pref.size * 1.85 + 'px';
    p.style.fontFamily = cs ? cs.fontFamily : 'serif';
    p.innerHTML = '';

    const wrap = document.createElement('div');
    p.appendChild(wrap);

    // 每行真实高度（塞进测量容器后立刻量）
    const hOf = [];
    const nodes = [];
    for (const line of lines) {
      const ln = document.createElement('div');
      ln.className = 'ln' + (line.x > 52 ? ' indent' : '') + (line.w ? ' tight' : '');
      if (line.i && line.i.length) {
        for (let k = 0; k < line.i.length; k++) {
          const ic = document.createElement('span');
          ic.className = 'ic';
          ic.style.cssText = 'display:inline-block;width:1.05em;height:1.05em;margin-right:5px;';
          ln.appendChild(ic);
        }
      }
      const t = document.createElement('span');
      t.className = 'txt';
      t.textContent = line.s.map((x) => x.t).join('');
      ln.appendChild(t);
      wrap.appendChild(ln);
      nodes.push(ln);
    }
    for (const n of nodes) hOf.push(n.getBoundingClientRect().height);

    const avail = cardMaxBody();
    let figH = 0;
    if (card.fig) {
      const w = body ? body.clientWidth - 48 : 640;
      figH = w * (237.59 / 497.28) + 20;
    }
    const budget = Math.max(80, avail - figH);

    // 每行高度里加上 margin（.ln 的 2px 下边距会被 getBoundingClientRect 忽略）
    const gap = 2;
    const groups = [];
    let cur = [], h = 0;
    for (let i = 0; i < lines.length; i++) {
      const lh = (hOf[i] || 32) + gap;
      if (cur.length && h + lh > budget) { groups.push(cur); cur = []; h = 0; }
      cur.push(lines[i]); h += lh;
    }
    if (cur.length) groups.push(cur);
    return groups.map((g, i) => ({ card, part: i + 1, parts: groups.length, lines: g }));
  }

  function refreshPlan() {
    const cards = visible();
    planCards = cards;
    planList = [];
    const ready = !!document.querySelector('.card-body');
    for (const c of cards) {
      try {
        planList.push(...(ready ? splitCard(c) : [{ card: c, part: 1, parts: 1, lines: c.L }]));
      } catch (e) {
        planList.push({ card: c, part: 1, parts: 1, lines: c.L });
      }
    }
    planCum = plan(planList);
  }

  function secForIndex(i) {
    return planCum[Math.min(i, planCum.length - 1)] || 0;
  }

  // 当前卡片在「应该」的时间点结束
  function targetNow() {
    const i = indexInPlan(state.curN);
    return i < 0 ? 0 : secForIndex(i);
  }

  /* ---------------- timer ---------------- */

  let tick = null;

  function startClock() {
    if (state.running) return;
    state.running = true;
    tick = setInterval(() => {
      if (document.hidden) return;   // 切走就不算时间
      state.elapsed += 1;
      paintClock();
    }, 1000);
  }

  function paintClock() {
    const total = pref.budget * 60;
    const e = state.elapsed;
    const m = Math.floor(e / 60), s = e % 60;
    $('#clockMain').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    $('#clockMain').classList.toggle('over', e > total * 1.05);
    $('#clockLabel').textContent = '已用 / ' + pref.budget + ' 分钟';

    const pct = Math.min(100, e / total * 100);
    $('#barFill').style.width = pct.toFixed(2) + '%';

    // 进度刻度：当前应该到哪
    const tgt = targetNow();
    const tp = Math.min(100, tgt / total * 100);
    $('#barTip').style.left = tp.toFixed(2) + '%';

    const d = e - tgt;
    const label = $('#pace');
    if (!state.started) {
      label.textContent = '空格 / → 开始';
      label.className = 'pace';
    } else if (d > 45) {
      label.textContent = '慢 ' + Math.round(d / 60) + ' 分 · 这块可以快一点';
      label.className = 'pace behind';
    } else if (d < -60) {
      label.textContent = '快 ' + Math.round(-d / 60) + ' 分 · 余量';
      label.className = 'pace';
    } else {
      label.textContent = '跟着节奏 · 正好';
      label.className = 'pace';
    }
  }

  /* ---------------- card render ---------------- */

  function segNo(seg) { return seg.card.n; }

  function indexInPlan(n, part) {
    for (let i = 0; i < planList.length; i++) {
      const s = planList[i];
      if (s.card.n === n && (!part || s.part === part)) return i;
    }
    return -1;
  }

  // 把 curN 对回列表位置；找不到就取最近的
  function syncIdx() {
    // 如果当前段本来就属于 curN，就保持在原地（不要被拉回这张卡的第一屏）
    const cur = planList[state.idx];
    if (cur && cur.card.n === state.curN) return;

    let i = indexInPlan(state.curN);
    if (i < 0) {
      i = 0;
      for (let k = 0; k < planList.length; k++) {
        if (planList[k].card.n <= state.curN) i = k;
      }
    }
    state.idx = Math.max(0, Math.min(i, Math.max(0, planList.length - 1)));
    if (planList[state.idx]) state.curN = planList[state.idx].card.n;
  }

  function renderCard() {
    const list = planList;
    const view = $('#view');
    view.textContent = '';

    if (!list.length) {
      const s = el('div', 'stage');
      s.appendChild(el('div', 'counter', '这个筛选下没有内容'));
      view.appendChild(s);
      view.appendChild(renderFooter(0));
      return;
    }

    syncIdx();
    const seg = list[state.idx];
    const card = seg.card;
    const r = rec(card.n);

    const stage = el('div', 'stage');
    const box = el('article', 'card' + (state.mode === 'recall' ? ' recall' : '') + (pref.hard ? ' hard' : ''));
    box.dataset.n = card.n;

    /* head */
    const head = el('div', 'card-head');
    const headL = el('div');
    const no = el('div', 'card-no');
    no.appendChild(el('span', null, '知识点 ' + String(card.n).padStart(3, '0')));
    const crumb = el('span', 'crumb');
    crumb.appendChild(el('span', null, card.m));
    crumb.appendChild(el('i', null, '/'));
    crumb.appendChild(el('span', null, card.sec));
    no.appendChild(crumb);
    headL.appendChild(no);
    const h1 = el('h1', 'card-title', card.t);
    if (seg.parts > 1) {
      const pt = el('span', 'part', seg.part + '/' + seg.parts);
      h1.appendChild(pt);
    }
    headL.appendChild(h1);
    head.appendChild(headL);

    const headR = el('div', 'card-head-r');
    if (state.mode !== 'index') {
      const bEye = el('button', 'dot-btn' + (state.mode === 'recall' ? ' on' : ''), '◑');
      bEye.title = '遮色自测 (2)';
      bEye.onclick = () => setMode(state.mode === 'recall' ? 'read' : 'recall');
      headR.appendChild(bEye);
    }
    const bYes = el('button', 'dot-btn ok' + (r.yes ? ' on' : ''), '✓');
    bYes.title = '记住了';
    const bNo = el('button', 'dot-btn no' + (r.no ? ' on' : ''), '✕');
    bNo.title = '没记住（进 ⚑）';
    const bStar = el('button', 'dot-btn' + (r.star ? ' on' : ''), '⚑');
    bStar.title = '标记';
    bYes.onclick = () => { saveRec(card.n, { yes: (r.yes || 0) + 1, seen: (r.seen || 0) + 1 }); toast('记牢了 · 下一张'); next(); };
    bNo.onclick  = () => { saveRec(card.n, { no: (r.no || 0) + 1, seen: (r.seen || 0) + 1 }); toast('已进 ⚑ 复看'); };
    bStar.onclick = () => {
      const now = !rec(card.n).star;
      saveRec(card.n, { star: now ? 1 : 0 });
      bStar.classList.toggle('on', now);
    };
    headR.appendChild(bStar);
    headR.appendChild(bNo);
    headR.appendChild(bYes);
    head.appendChild(headR);

    /* body */
    const body = el('div', 'card-body');

    if (card.fig) {
      const im = new Image();
      im.src = card.fig;
      im.className = 'fig';
      im.alt = '史纲整体脉络';
      body.appendChild(im);
    }

    for (const line of seg.lines) {
      const ln = el('div', 'ln');
      // 原书里正文缩进 10pt，续排与顶格行不缩进
      const base = line.c === 'L' ? 49 : 316;
      if (line.x - base > 4) ln.classList.add('indent');
      if (line.w) ln.classList.add('tight');

      if (line.i && line.i.length) {
        for (const h of line.i) {
          const ic = new Image();
          ic.src = 'icons/' + h + '.png';
          ic.className = 'ic';
          ic.alt = '';
          ic.loading = 'lazy';
          ln.appendChild(ic);
        }
      }

      const txt = el('span', 'txt');
      for (const seg of line.s) {
        if (seg.r === 'img') {
          const im = new Image();
          im.src = 'icons/' + seg.i + '.png';
          im.className = 'ic inline';
          im.alt = '';
          txt.appendChild(im);
          continue;
        }
        const sp = el('span', seg.r, seg.t);
        txt.appendChild(sp);
      }
      ln.appendChild(txt);
      body.appendChild(ln);
    }

    if (!seg.lines.length && !card.fig) {
      body.appendChild(el('div', null, ''));
      box.classList.add('empty');
    }

    if (seg.parts > 1) {
      const more = el('div', 'more');
      if (seg.part < seg.parts) more.textContent = '↓ 还有 ' + (seg.parts - seg.part) + ' 屏 · 按 → 继续这张';
      else more.textContent = '· 这张读完了 ·';
      body.appendChild(more);
    }

    /* 这张卡挂着的真题：只在最后一段显示，不打断阅读 */
    if (seg.part === seg.parts) {
      const links = (window.YYZ_LINK && window.YYZ_LINK.byCard[String(card.n)]) || [];
      if (links.length) {
        const qs = window.YYZ_Q ? window.YYZ_Q.q : [];
        const map = {};
        for (const q of qs) map[q.id] = q;
        const ref = el('div', 'card-q-list');
        ref.appendChild(el('span', 'cql-h', '做过这些真题 →'));
        for (const id of links.slice(0, 6)) {
          const q = map[id];
          if (!q) continue;
          const b = el('button', 'cql', id + ' ' + (q.k === 'single' ? '单' : q.k === 'multi' ? '多' : '析'));
          b.title = q.s.slice(0, 60);
          b.onclick = (ev) => {
            ev.stopPropagation();
            if (window.YYZ_EXAM && window.YYZ_EXAM.openQuestion) {
              window.YYZ_EXAM.openQuestion(id);
            }
          };
          ref.appendChild(b);
        }
        if (links.length > 6) ref.appendChild(el('span', 'cql-more', '等 ' + links.length + ' 题'));
        body.appendChild(ref);
      }
    }

    /* recall interactions */
    if (state.mode === 'recall') {
      body.addEventListener('click', (e) => {
        const t = e.target.closest('.k,.r,.o,.b,.m,.n,.p,.s,.h');
        if (!t) return;
        t.classList.toggle('peek');
      });
    }

    box.appendChild(head);
    box.appendChild(body);
    stage.appendChild(box);
    view.appendChild(stage);

    /* footer */
    view.appendChild(renderFooter(list.length));

    // 自校正：万一这一屏还是超了，砍掉最后一行再渲染
    if (body.scrollHeight > body.clientHeight + 1 && seg.lines.length > 1 && !seg._trimmed) {
      const trimmed = seg.lines.slice(0, -1);
      const rest = seg.lines.slice(-1);
      // 把被砍的行塞进下一段（或新开一段）
      const ni = state.idx + 1;
      const next = planList[ni];
      if (next && next.card === seg.card) {
        next.lines = rest.concat(next.lines);
        next.parts = Math.max(next.parts, seg.parts);
      }
      seg.lines = trimmed;
      seg._trimmed = true;
      renderCard();
      return;
    }

    // reset scroll, restart clock
    body.scrollTop = 0;
    state.revealed.clear();
    if (!state.started) {
      state.started = true;
      startClock();
      touchDay();
    }
    paintClock();
  }

  function renderFooter(total) {
    const f = el('div', 'footer');

    const left = el('div', 'foot-side');
    const prev = el('button', 'nav-btn');
    prev.innerHTML = '← 上一张';
    prev.disabled = state.idx <= 0;
    prev.onclick = () => go(-1);
    left.appendChild(prev);

    const mid = el('div', 'counter');
    // 包含当前这屏所在的卡（看到最后一段就算这点过完）
    const upto = planList.slice(0, state.idx + 1);
    const doneCards = new Set(upto
      .filter((s, i) => i < state.idx || s.part === s.parts)
      .map((s) => s.card.n)).size;
    const allCards = new Set(planList.map((s) => s.card.n)).size;
    mid.innerHTML = '<b>' + (state.idx + 1) + '</b> / ' + total
      + '<span class="sep">·</span>' + doneCards + '/' + allCards + ' 点';

    const right = el('div', 'foot-side right');
    const nextB = el('button', 'nav-btn primary');
    nextB.innerHTML = state.idx >= total - 1 ? '收尾 ✓' : '下一张 →';
    nextB.onclick = () => {
      if (state.idx >= total - 1) { finish(); return; }
      go(1);
    };
    right.appendChild(nextB);

    f.appendChild(left);
    f.appendChild(mid);
    f.appendChild(right);
    return f;
  }

  function finish() {
    const view = $('#view');
    view.textContent = '';
    const stage = el('div', 'stage');
    const box = el('div', 'done-box');

    const total = pref.budget * 60;
    const m = Math.floor(state.elapsed / 60), ss = state.elapsed % 60;
    const all = new Set(planList.map((s) => s.card.n));
    let yes = 0, no = 0;
    for (const n of all) { const r = rec(n); if (r.yes) yes++; if (r.no) no++; }

    box.appendChild(el('div', 'done-k', '今天过完了'));
    box.appendChild(el('div', 'done-t', m + ' 分 ' + String(ss).padStart(2, '0') + ' 秒 · 预算 ' + pref.budget + ' 分钟'));
    const d = state.elapsed - total;
    box.appendChild(el('div', 'done-s',
      d <= 0 ? '比预算快 ' + Math.round(-d / 60) + ' 分钟' : '超了 ' + Math.round(d / 60) + ' 分钟 · 明天可以把预算调大'));

    const stats = el('div', 'done-stats');
    stats.appendChild(stat(all.size, '点过完'));
    stats.appendChild(stat(yes, '记住'));
    stats.appendChild(stat(no, '待复看'));
    box.appendChild(stats);

    const acts = el('div', 'done-acts');
    const b1 = el('button', 'nav-btn', '只看没记牢的');
    b1.onclick = () => {
      state.weakOnly = true;
      $('#btnWeak').classList.add('on');
      state.curN = 1;
      applyFilter();
      if (planList.length) { setMode('read'); toast('只过 ⚑ 和没记住的'); }
      else toast('没有待复看的，全都记牢了');
    };
    const b2 = el('button', 'nav-btn primary', '再看一遍');
    b2.onclick = () => { state.curN = 1; setMode('read'); render(); };
    const b3 = el('button', 'nav-btn', '回目录');
    b3.onclick = () => setMode('index');
    acts.appendChild(b1); acts.appendChild(b2); acts.appendChild(b3);
    box.appendChild(acts);

    stage.appendChild(box);
    view.appendChild(stage);
    window.scrollTo(0, 0);
  }

  function stat(v, label) {
    const d = el('div', 'done-stat');
    d.appendChild(el('b', null, String(v)));
    d.appendChild(el('span', null, label));
    return d;
  }

  /* ---------------- index ---------------- */

  function renderIndex() {
    const view = $('#view');
    view.textContent = '';
    const wrap = el('div', 'index-wrap');

    const list = visible();
    const groups = new Map();
    for (const c of list) {
      const key = c.m + ' / ' + c.sec;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }

    // 按书里出现顺序排：模块顺序 + 章节首次出现位置
    const modOrder = ['马原', '史纲', '其他'];
    const secRank = new Map();
    for (const c of CARDS) {
      const k = c.m + ' / ' + c.sec;
      if (!secRank.has(k)) secRank.set(k, secRank.size);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => {
      const am = modOrder.indexOf(a.split(' / ')[0]);
      const bm = modOrder.indexOf(b.split(' / ')[0]);
      if (am !== bm) return am - bm;
      return (secRank.get(a) ?? 99) - (secRank.get(b) ?? 99);
    });

    for (const k of keys) {
      const g = el('section', 'idx-group');
      const h = el('div', 'idx-head');
      h.appendChild(el('h2', null, k));
      h.appendChild(el('span', null, groups.get(k).length + ' 点'));
      g.appendChild(h);

      const grid = el('div', 'idx-grid');
      for (const c of groups.get(k)) {
        const r = rec(c.n);
        const b = el('button', 'idx-item');
        if (c.n === state.curN) b.classList.add('cur');
        if (r.yes > 0 && r.no === 0) b.classList.add('done');
        if (r.no > 0 && r.yes === 0) b.classList.add('weak');

        b.appendChild(el('span', 'n', String(c.n).padStart(3, '0')));
        b.appendChild(el('span', 't', c.t));

        const mk = el('span', 'mk');
        if (r.star) mk.appendChild(el('span', 'star', '⚑'));
        if (r.yes) mk.appendChild(el('span', 'yes', '✓'));
        if (r.no) mk.appendChild(el('span', 'no', '✕'));
        b.appendChild(mk);

        b.onclick = () => {
          state.curN = c.n;
          writeJSON('yyz.last', c.n);
          setMode(state.mode === 'index' ? 'read' : state.mode);
        };
        grid.appendChild(b);
      }
      g.appendChild(grid);
      wrap.appendChild(g);
    }

    if (!list.length) wrap.appendChild(el('div', 'counter', '没有匹配的内容'));
    view.appendChild(wrap);
  }

  /* ---------------- mode ---------------- */

  function setMode(m) {
    state.mode = m;
    document.body.classList.toggle('exam-mode', m === 'exam');
    $$('#modeTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (m === 'exam') {
      renderExam();
      return;
    }
    refreshPlan();
    syncIdx();
    render();
  }

  function renderExam() {
    if (window.YYZ_EXAM && window.YYZ_EXAM.render) window.YYZ_EXAM.render();
  }

  /* 从题库跳回某张知识卡 */
  function gotoCard(n) {
    state.curN = n;
    writeJSON('yyz.last', n);
    setMode('read');
  }

  let replanned = false;
  let resetMode = false;

  function render() {
    if (state.mode === 'exam') { renderExam(); return; }
    if (state.mode === 'index') { renderIndex(); return; }
    renderCard();

    // 首屏渲染后才有真实尺寸：按实测重量重新切段，再渲染一次
    if (!replanned) {
      replanned = true;
      const keepN = state.curN;
      const keepPart = state.idx > 0 && planList[state.idx] ? planList[state.idx].part : 0;
      const before = planList.length;
      refreshPlan();
      if (planList.length !== before) {
        state.curN = keepN;
        if (keepPart) {
          const i = indexInPlan(keepN, keepPart);
          state.idx = i >= 0 ? i : 0;
        } else syncIdx();
        renderCard();
      }
    }
  }

  function go(d) {
    const n = state.idx + d;
    if (n < 0 || n >= planList.length) return;
    const cur = planList[state.idx];
    // 走到这张卡的最后一段才算「看过一遍」
    if (cur && cur.part === cur.parts) {
      const r = rec(cur.card.n);
      saveRec(cur.card.n, { seen: (r.seen || 0) + 1 });
    }
    state.idx = n;
    state.curN = planList[n].card.n;
    if (!resetMode) writeJSON('yyz.last', state.curN);
    paintClock();
    renderCard();  // syncIdx 会看到 idx 已对，保持原地
  }

  function next() { go(1); }

  /* ---------------- filters ---------------- */

  function applyFilter() {
    refreshPlan();
    syncIdx();
    render();
  }

  /* ---------------- toast ---------------- */

  let toastT = null;
  function toast(msg) {
    const h = $('#hint');
    h.textContent = msg;
    h.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => h.classList.remove('show'), 1400);
  }

  /* ---------------- settings ---------------- */

  function openSheet(open) {
    $('#sheet').hidden = !open;
  }

  function syncPrefUI() {
    document.documentElement.style.setProperty('--fs', pref.size + 'px');
    document.documentElement.style.setProperty('--blur', pref.blur + 'px');
    $('#sizeRange').value = pref.size;
    $('#sizeVal').textContent = pref.size;
    $('#blurRange').value = pref.blur;
    $('#blurVal').textContent = pref.blur;
    $('#hardBlur').checked = !!pref.hard;
    $$('#budgetChips button').forEach((b) => b.classList.toggle('on', +b.dataset.min === pref.budget));
  }

  function savePref() {
    writeJSON(LS.pref, pref);
  }

  /* ---------------- boot ---------------- */

  function preloadIcons() {
    const set = new Set();
    for (const c of CARDS) {
      for (const l of c.L) {
        for (const h of (l.i || [])) set.add(h);
        for (const sg of l.s) if (sg.r === 'img') set.add(sg.i);
      }
    }
    for (const h of set) { const im = new Image(); im.src = 'icons/' + h + '.png'; }
    return set.size;
  }

  function boot() {
    preloadIcons();
    paintStreak();
    syncPrefUI();
    refreshPlan();

    // resume where left（没有记录就从第一个知识点开始）
    const raw = readJSON('yyz.last');
    const last = parseInt(raw, 10);
    state.curN = Number.isFinite(last) && last > 0 ? last : 1;
    syncIdx();

    render();

    /* tabs */
    $('#modeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setMode(b.dataset.mode);
    });

    /* module chips */
    $('#modChips').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.mod = b.dataset.mod;
      $$('#modChips button').forEach((x) => x.classList.toggle('on', x === b));
      applyFilter();
    });

    /* search */
    let qT = null;
    $('#q').addEventListener('input', (e) => {
      state.q = e.target.value;
      clearTimeout(qT);
      qT = setTimeout(applyFilter, 160);
    });

    /* weak filter */
    $('#btnWeak').addEventListener('click', () => {
      state.weakOnly = !state.weakOnly;
      $('#btnWeak').classList.toggle('on', state.weakOnly);
      toast(state.weakOnly ? '只看 ⚑ 和没记住的' : '看全部');
      applyFilter();
    });

    /* settings */
    $('#btnSettings').addEventListener('click', () => openSheet(true));
    $('#btnCloseSheet').addEventListener('click', () => openSheet(false));
    $('#sheet').addEventListener('click', (e) => {
      if (e.target.id === 'sheet') openSheet(false);
    });

    $('#budgetChips').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      pref.budget = +b.dataset.min;
      savePref(); syncPrefUI(); refreshPlan(); paintClock();
    });

    let sizeT = null;
    $('#sizeRange').addEventListener('input', (e) => {
      pref.size = +e.target.value;
      savePref(); syncPrefUI();
      clearTimeout(sizeT);
      sizeT = setTimeout(() => {
        document.documentElement.style.setProperty('--fs', pref.size + 'px');
        refreshPlan();
        state.idx = 0; syncIdx(); render();
      }, 140);
    });
    $('#blurRange').addEventListener('input', (e) => {
      pref.blur = +e.target.value;
      savePref(); syncPrefUI();
    });
    $('#hardBlur').addEventListener('change', (e) => {
      pref.hard = e.target.checked;
      savePref();
      if (state.mode === 'recall') render();
    });

    $('#btnReset').addEventListener('click', () => {
      if (!confirm('清空所有进度和标记？')) return;
      resetMode = true;
      state.curN = 1;
      state.idx = 0;
      localStorage.removeItem(LS.prog);
      localStorage.removeItem(LS.day);
      localStorage.removeItem('yyz.last');
      location.reload();
    });

    /* keyboard */
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (!$('#sheet').hidden) {
        if (e.key === 'Escape') openSheet(false);
        return;
      }
      // 题库模式自己处理方向键 / 回车
      if (state.mode === 'exam') {
        if (e.key === '4' || e.key === '3' || e.key === '1' || e.key === '2') {
          // 交给下面的 switch，允许切回阅读
        } else {
          return;
        }
      }

      switch (e.key) {
        case 'ArrowRight':
        case 'j':
          e.preventDefault();
          if (state.mode === 'index') setMode('read');
          else if (state.mode !== 'exam') go(1);
          break;
        case 'ArrowLeft':
        case 'k':
          e.preventDefault();
          if (state.mode !== 'index' && state.mode !== 'exam') go(-1);
          break;
        case ' ':
          e.preventDefault();
          if (state.mode !== 'index' && state.mode !== 'exam') go(1);
          break;
        case '1':
          if (state.mode !== 'index') setMode('read');
          break;
        case '2':
          if (state.mode !== 'index') setMode('recall');
          break;
        case '3':
          setMode('index');
          break;
        case '4':
          setMode('exam');
          break;
        case 'r':
        case 'R':
          if (state.mode === 'recall') {
            $$('.peek').forEach((n) => n.classList.remove('peek'));
          }
          break;
        case 'a':
        case 'A':
          if (state.mode === 'recall') {
            $$('.k,.r,.o,.b,.m,.n,.p,.s').forEach((n) => n.classList.add('peek'));
          }
          break;
        case '?':
          toast('→/空格 下一张 · ← 上一张 · 1 顺序 · 2 遮色 · 3 目录 · 4 题库 · A 全揭 · R 收起');
          break;
      }
    });

    /* remember position */
    let rzT = null;
    window.addEventListener('resize', () => {
      clearTimeout(rzT);
      rzT = setTimeout(() => {
        const keepN = state.curN;
        refreshPlan();
        state.curN = keepN;
        syncIdx();
        render();
      }, 220);
    });

    const remember = () => { if (!resetMode) writeJSON('yyz.last', state.curN); };
    window.addEventListener('beforeunload', remember);
    window.addEventListener('pagehide', remember);
    setInterval(remember, 5000);

    /* 给题库模块留的接口 */
    window.YYZ_APP = {
      setMode,
      gotoCard,
      mode: () => state.mode,
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
