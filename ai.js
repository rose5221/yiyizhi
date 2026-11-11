/* 一页纸 · AI 答疑
   做题时遇到不懂的直接问。DeepSeek API，Key 自己填，只存在本机浏览器。

   请求从浏览器直连 https://api.deepseek.com，不经过任何中转。
   Key 存在 localStorage，不上传、不写进仓库。
*/
(function () {
  'use strict';

  const LS = {
    key: 'yyz.ai.key',
    model: 'yyz.ai.model',
    hist: 'yyz.ai.hist',   // {qid: [{role, content}]}
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const cfg = {
    key: localStorage.getItem(LS.key) || '',
    model: localStorage.getItem(LS.model) || 'deepseek-chat',
  };

  let hist = {};
  try { hist = JSON.parse(localStorage.getItem(LS.hist)) || {}; } catch (e) { hist = {}; }

  function saveHist() {
    try { localStorage.setItem(LS.hist, JSON.stringify(hist)); } catch (e) {}
  }

  /* ---------------- 系统提示词 ---------------- */

  function sysFor(q, opts) {
    opts = opts || {};
    const kind = q.k === 'single' ? '单选' : q.k === 'multi' ? '多选' : '分析题';
    let s = '你是一位考研政治（全国硕士研究生招生考试 101 思想政治理论）的辅导老师。'
      + (opts.hideAnswer
        ? '学生正在重练一道真题，你只能看到题干和选项，也没有答案。\n\n'
        : '学生正在做一道真题，你可以看到题干、选项和标准答案。\n\n')
      + '回答要求：\n'
      + '1. 直接讲清楚这个知识点，不要复述题干。\n'
      + '2. 学生问「为什么错」时，要指出他那个选项具体错在哪一处表述。\n'
      + '3. 涉及史纲要给出准确年份和会议，不要含糊。\n'
      + '4. 不编造。不确定就说不确定。\n'
      + '5. 简洁，控制在 200 字以内，除非学生要求展开。\n'
      + '6. 学生如果提到别的题号（比如「第 27 题」），而那不是当前这道题，'
      + '就直接说你看不到那道题，让他把题干发过来或切到那道题再问。不要瞎编。\n\n'
      + '【当前题目】\n'
      + q.id + '（' + kind + '，' + (q.p || '') + '）\n'
      + '题干：' + q.s + '\n';
    const optText = (q.o || []).map((o) => o.l + '. ' + o.t).join('\n');
    if (optText) s += '选项：\n' + optText + '\n';
    if (q.q && q.q.length) s += '设问：\n' + q.q.join('\n') + '\n';

    if (opts.hideAnswer) {
      s = s.replace('5. 简洁，控制在 200 字以内，除非学生要求展开。\n',
        '5. 简洁，控制在 200 字以内，除非学生要求展开。\n'
        + '6. **学生正在重练这道题，还没作答。绝对不要说出正确答案是哪个字母，'
        + '也不要说「选 X」。只讲知识点、讲每个选项的判别依据，让他自己想。**\n');
      return s;
    }
    if (q.a) s += '标准答案：' + q.a + '\n';
    return s;
  }

  /* ---------------- 面板 ---------------- */

  function makePanel(q, panelOpts) {
    panelOpts = panelOpts || {};
    const box = el('div', 'ai-panel');

    const head = el('div', 'ai-head');
    head.appendChild(el('b', null, '问 AI'));
    head.appendChild(el('span', 'ai-sub', cfg.key ? 'DeepSeek · ' + cfg.model : '还没填 Key'));

    const cfgBtn = el('button', 'ai-mini', '⚙');
    cfgBtn.title = '设置 API Key';
    cfgBtn.onclick = () => openCfg(() => renderBody());
    head.appendChild(cfgBtn);
    box.appendChild(head);

    const body = el('div', 'ai-body');
    box.appendChild(body);

    function renderBody() {
      body.textContent = '';

      const msgs = hist[q.id] || [];
      if (!cfg.key) {
        const setup = el('div', 'ai-setup');
        setup.appendChild(el('div', 'ai-setup-h', '填一个 DeepSeek API Key 就能用'));
        setup.appendChild(el('div', 'ai-setup-t',
          '去 platform.deepseek.com 申请，充几块钱就够用很久。'
          + 'Key 只存在你这台设备的浏览器里，不会上传到任何地方。'));
        const b = el('button', 'nav-btn primary', '填 Key');
        b.onclick = () => openCfg(() => renderBody());
        setup.appendChild(b);
        body.appendChild(setup);
        return;
      }

      if (!msgs.length) {
        const quick = el('div', 'ai-quick');
        const presets = panelOpts.hideAnswer
          ? ['这题考什么知识点', '帮我辨析这几个选项', '相关考点怎么记']
          : q.k === 'essay'
            ? ['这题考的是什么原理', '答题框架怎么搭', '帮我拆一下设问']
            : ['这道题考什么知识点', '帮我辨析这几个选项', '为什么是这个答案', '帮我记这个考点'];
        // 重练时不要「为什么是这个答案」——那会直接泄底
        for (const p of presets) {
          const b = el('button', 'ai-chip', p);
          b.onclick = () => ask(p);
          quick.appendChild(b);
        }
        body.appendChild(el('div', 'ai-hint', '不懂就问，比如「B 选项错在哪」'));
        body.appendChild(quick);
        return;
      }

      for (const m of msgs) {
        if (m.role === 'user') {
          body.appendChild(el('div', 'ai-msg user', m.content));
        } else {
          const d = el('div', 'ai-msg ai');
          d.appendChild(el('div', 'ai-text', m.content));
          body.appendChild(d);
        }
      }
      body.scrollTop = body.scrollHeight;
    }

    // 输入
    const foot = el('div', 'ai-foot');
    const ta = el('textarea', 'ai-input');
    ta.rows = 1;
    ta.placeholder = cfg.key ? '问点什么…（回车发送，Shift+回车换行）' : '先填 Key';
    ta.oninput = () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
    };
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
      e.stopPropagation();
    };
    foot.appendChild(ta);

    const sendBtn = el('button', 'ai-send', '↑');
    sendBtn.title = '发送';
    sendBtn.onclick = () => send();
    foot.appendChild(sendBtn);
    box.appendChild(foot);

    function send() {
      const t = ta.value.trim();
      if (!t) return;
      ta.value = '';
      ta.style.height = 'auto';
      ask(t);
    }

    async function ask(text) {
      if (!cfg.key) { openCfg(() => renderBody()); return; }

      hist[q.id] = hist[q.id] || [];
      hist[q.id].push({ role: 'user', content: text });
      saveHist();
      renderBody();

      // 占位
      const thinking = el('div', 'ai-msg ai thinking', '想一想…');
      body.appendChild(thinking);
      body.scrollTop = body.scrollHeight;

      try {
        const reply = await call(text, q, panelOpts);
        hist[q.id].push({ role: 'assistant', content: reply });
        saveHist();
        renderBody();
      } catch (err) {
        if (thinking.parentNode) thinking.remove();
        // 失败就把这条用户消息撤回去，免得历史里堆一堆没回答的提问
        hist[q.id].pop();
        saveHist();
        renderBody();

        const e = el('div', 'ai-msg ai err', '出错：' + (err.message || err));
        const again = el('button', 'ai-mini', '重试');
        again.onclick = () => { e.remove(); ask(text); };
        e.appendChild(again);
        body.appendChild(e);
        body.scrollTop = body.scrollHeight;
      }
    }

    renderBody();
    return box;
  }

  /* ---------------- 调 API ---------------- */

  async function call(text, q, opts) {
    const msgs = [{ role: 'system', content: sysFor(q, opts) }];
    for (const m of (hist[q.id] || [])) msgs.push(m);

    const url = 'https://api.deepseek.com/chat/completions';
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.key,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: msgs,
          temperature: 0.3,
          max_tokens: 800,
          stream: false,
        }),
      });
    } catch (e) {
      throw new Error('连不上 api.deepseek.com（可能是网络或 CORS）。' + (e.message || ''));
    }

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = (j.error && (j.error.message || j.error.type)) || '';
      } catch (e) {}
      if (res.status === 401) throw new Error('Key 不对或已失效（401）');
      if (res.status === 402) throw new Error('余额不足（402），去平台充值');
      if (res.status === 429) throw new Error('请求太频繁（429），缓一下');
      throw new Error('HTTP ' + res.status + ' ' + detail);
    }

    const j = await res.json();
    const out = j.choices && j.choices[0] && j.choices[0].message
      && j.choices[0].message.content;
    if (!out) throw new Error('返回是空的');
    return out.trim();
  }

  /* ---------------- 设置 ---------------- */

  function openCfg(onDone) {
    let dlg = $('#aiCfg');
    if (dlg) dlg.remove();

    dlg = el('div', 'sheet on');
    dlg.id = 'aiCfg';
    const card = el('div', 'sheet-card');
    card.appendChild(el('h3', null, 'AI 答疑设置'));

    const f1 = el('div', 'field');
    f1.appendChild(el('label', null, 'DeepSeek API Key'));
    const inp = el('input', 'ai-key');
    inp.type = 'password';
    inp.placeholder = 'sk-...';
    inp.value = cfg.key;
    inp.autocomplete = 'off';
    f1.appendChild(inp);
    f1.appendChild(el('div', 'ai-tip',
      '在 platform.deepseek.com → API keys 生成。只存在本机浏览器。'));
    card.appendChild(f1);

    const f2 = el('div', 'field');
    f2.appendChild(el('label', null, '模型'));
    const chips = el('div', 'chips');
    for (const [v, label] of [['deepseek-chat', 'deepseek-chat（快，便宜）'],
                              ['deepseek-reasoner', 'deepseek-reasoner（会推理，慢）']]) {
      const b = el('button', cfg.model === v ? 'on' : null, label);
      b.onclick = () => {
        cfg.model = v;
        $$('button', chips).forEach((x) => x.classList.toggle('on', x === b));
      };
      chips.appendChild(b);
    }
    f2.appendChild(chips);
    card.appendChild(f2);

    const foot = el('div', 'sheet-foot');
    const clear = el('button', 'ghost', '清空所有对话');
    clear.onclick = () => {
      if (!confirm('清空和 AI 的全部对话记录？')) return;
      hist = {};
      saveHist();
      dlg.remove();
      onDone && onDone();
    };
    const cancel = el('button', 'ghost', '取消');
    cancel.onclick = () => dlg.remove();
    const ok = el('button', 'primary', '保存');
    ok.onclick = () => {
      cfg.key = inp.value.trim();
      localStorage.setItem(LS.key, cfg.key);
      localStorage.setItem(LS.model, cfg.model);
      dlg.remove();
      onDone && onDone();
    };
    foot.appendChild(clear);
    foot.appendChild(cancel);
    foot.appendChild(ok);
    card.appendChild(foot);

    dlg.appendChild(card);
    dlg.onclick = (e) => { if (e.target === dlg) dlg.remove(); };
    document.body.appendChild(dlg);
    setTimeout(() => inp.focus(), 60);
  }

  window.YYZ_AI = {
    panel: makePanel,
    hasKey: () => !!cfg.key,
    openCfg,
  };
})();
