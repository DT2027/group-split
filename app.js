/* ============================================================
   分组派对 · GROUP//SPLIT
   纯前端分组工具 · 零依赖
   ============================================================ */
(function () {
  'use strict';

  var LS = {
    current: 'groupSplit.current.v1',
    history: 'groupSplit.history.v1'
  };
  var HISTORY_LIMIT = 20;
  var COLORS = ['#ff2e93', '#00e5ff', '#b6ff00', '#ff7a00', '#7c4dff', '#ffe600',
                '#00ffa3', '#ff3b6b', '#00b3ff', '#d946ef', '#ff9f1c', '#4dff88'];

  var SAMPLE = ['林一', '陈静', '黄伟', '张涛', '李雪', '王磊', '赵敏', '钱浩',
                '孙怡', '周鹏', '吴芳', '郑凯', '冯琳', '蒋勇', '韩冰', '何欣'];

  var el = {
    names:      document.getElementById('namesInput'),
    countHint:  document.getElementById('countHint'),
    sample:     document.getElementById('sampleBtn'),
    clear:      document.getElementById('clearBtn'),
    size:       document.getElementById('groupSize'),
    sizeMinus:  document.getElementById('sizeMinus'),
    sizePlus:   document.getElementById('sizePlus'),
    setupHint:  document.getElementById('setupHint'),
    split:      document.getElementById('splitBtn'),
    reshuffle:  document.getElementById('reshuffleBtn'),
    groups:     document.getElementById('groups'),
    resultEmpty:document.getElementById('resultEmpty'),
    resultFlag: document.getElementById('resultFlag'),
    addGroup:   document.getElementById('addGroupBtn'),
    copy:       document.getElementById('copyBtn'),
    history:    document.getElementById('history'),
    historyEmpty: document.getElementById('historyEmpty'),
    clearHistory: document.getElementById('clearHistoryBtn'),
    toast:      document.getElementById('toast'),
    pop:        document.getElementById('movePop')
  };

  var state = {
    names: [],
    size: 5,
    groups: [],
    pool: [],
    edited: false,
    hasResult: false,
    dup: 0
  };

  var uid = 0;
  var dragPayload = null;
  var toastTimer = null;

  /* ---------------- 工具 ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function randInt(max) {
    if (max <= 1) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      var arr = new Uint32Array(1);
      var limit = Math.floor(4294967296 / max) * max;
      var v;
      do { window.crypto.getRandomValues(arr); v = arr[0]; } while (v >= limit);
      return v % max;
    }
    return Math.floor(Math.random() * max);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function parseNames(raw) {
    return String(raw).split(/[\r\n,，、;；|]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function dedupe(list) {
    var seen = Object.create(null);
    var out = [];
    var dup = 0;
    list.forEach(function (n) {
      var key = n.replace(/\s+/g, '').toLowerCase();
      if (seen[key]) { dup++; return; }
      seen[key] = 1;
      out.push(n);
    });
    return { list: out, dup: dup };
  }

  function load(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略配额错误 */ }
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 名单与分组 ---------------- */

  function readRoster() {
    var parsed = dedupe(parseNames(el.names.value));
    state.names = parsed.list;
    state.dup = parsed.dup;
    updateHint();
  }

  function syncTextarea() {
    el.names.value = state.names.join('\n');
    updateHint();
  }

  function groupCountBySize(total, size) {
    return Math.max(1, Math.ceil(total / size));
  }

  function buildGroups(names, size) {
    // 先整体洗牌，再按「每组人数」依次成块切分：
    // 每组满 size 人，最后一组拿剩余的人，因此各组人数最多差 1。
    var shuffled = shuffle(names);
    var groups = [];
    for (var i = 0; i < shuffled.length; i += size) {
      groups.push({
        id: ++uid,
        name: '第 ' + (groups.length + 1) + ' 组',
        members: shuffled.slice(i, i + size)
      });
    }
    return groups;
  }

  function doSplit() {
    readRoster();
    if (!state.names.length) {
      showToast('请先输入名单');
      el.names.focus();
      return;
    }
    state.size = clampSize(parseInt(el.size.value, 10) || state.size);
    el.size.value = state.size;
    state.groups = buildGroups(state.names, state.size);
    state.pool = [];
    state.edited = false;
    state.hasResult = true;
    render();
    pushHistory();
    persistCurrent();
    showToast('已分成 ' + state.groups.length + ' 组');
  }

  function clampSize(v) {
    if (!isFinite(v) || v < 1) return 1;
    if (v > 999) return 999;
    return Math.floor(v);
  }

  /* ---------------- 渲染 ---------------- */

  function colorOf(i) { return COLORS[i % COLORS.length]; }

  function groupCardHtml(g, gi) {
    var c = colorOf(gi);
    var chips = g.members.length
      ? g.members.map(function (m, mi) {
          return '<span class="chip" draggable="true" data-gi="' + gi + '" data-mi="' + mi + '">' +
                 '<span class="chip-text">' + esc(m) + '</span>' +
                 '<button type="button" class="chip-act move" data-act="move" data-gi="' + gi + '" data-mi="' + mi + '" title="移动到其他组" aria-label="移动 ' + esc(m) + '">⇄</button>' +
                 '<button type="button" class="chip-act del" data-act="del" data-gi="' + gi + '" data-mi="' + mi + '" title="移出本组" aria-label="移出 ' + esc(m) + '">✕</button>' +
                 '</span>';
        }).join('')
      : '<span class="group-empty">拖动 / 点击 ⇄ 把成员放到这里</span>';

    return '<article class="group" style="--c:' + c + '" data-gi="' + gi + '">' +
      '<div class="group-head">' +
        '<span class="group-dot"></span>' +
        '<input class="group-name" type="text" value="' + esc(g.name) + '" data-gi="' + gi + '" aria-label="组名" maxlength="20" />' +
        '<span class="group-count">' + g.members.length + ' 人</span>' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="group-ops">' +
        '<button type="button" class="icon-btn" data-act="shuffle" data-gi="' + gi + '" title="打乱本组顺序" aria-label="打乱本组顺序">⤮</button>' +
        '<button type="button" class="icon-btn" data-act="delGroup" data-gi="' + gi + '" title="删除该组（成员移入未分组）" aria-label="删除该组">🗑</button>' +
      '</div>' +
    '</article>';
  }

  function poolCardHtml() {
    if (!state.pool.length) return '';
    var chips = state.pool.map(function (m, mi) {
      return '<span class="chip" draggable="true" data-gi="-1" data-mi="' + mi + '">' +
             '<span class="chip-text">' + esc(m) + '</span>' +
             '<button type="button" class="chip-act move" data-act="move" data-gi="-1" data-mi="' + mi + '" title="移动到其他组" aria-label="移动 ' + esc(m) + '">⇄</button>' +
             '<button type="button" class="chip-act del" data-act="del" data-gi="-1" data-mi="' + mi + '" title="从名单中删除" aria-label="删除 ' + esc(m) + '">✕</button>' +
             '</span>';
    }).join('');

    return '<article class="group pool" data-gi="-1">' +
      '<div class="group-head">' +
        '<span class="group-dot"></span>' +
        '<span class="group-name">未分组</span>' +
        '<span class="group-count">' + state.pool.length + ' 人</span>' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
    '</article>';
  }

  function render() {
    var has = state.groups.length > 0;
    el.resultEmpty.hidden = has;
    el.resultFlag.hidden = !(has && state.edited);
    el.groups.innerHTML = has
      ? state.groups.map(groupCardHtml).join('') + poolCardHtml()
      : '';
    el.reshuffle.disabled = !has;
    el.copy.disabled = !has;
    el.addGroup.disabled = !has;
    renderHistory();
  }

  function renderHistory() {
    var list = load(LS.history, []);
    el.historyEmpty.hidden = list.length > 0;
    el.history.innerHTML = list.map(function (h) {
      var n = h.total || 0;
      var g = (h.groups || []).length;
      return '<li class="history-item" data-hid="' + esc(h.id) + '">' +
        '<div class="history-meta">' +
          '<div class="history-time">' + fmtTime(h.ts) + '</div>' +
          '<div class="history-desc">共 <b>' + n + '</b> 人 · 每组 ' + esc(h.size) + ' 人 · <b>' + g + '</b> 组</div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="restore" data-hid="' + esc(h.id) + '">恢复</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="delHistory" data-hid="' + esc(h.id) + '">删除</button>' +
      '</li>';
    }).join('');
  }

  function updateHint() {
    var n = state.names.length;
    var size = state.size;
    el.countHint.innerHTML = '共 <b>' + n + '</b> 人' +
      (state.dup ? ' <span class="warn">（已去重 ' + state.dup + '）</span>' : '');

    if (!n) {
      el.setupHint.textContent = '输入名单后即可开始分组';
      return;
    }
    var count = groupCountBySize(n, size);
    var sizes = [];
    for (var i = 0; i < count; i++) sizes.push(Math.min(size, n - i * size));
    el.setupHint.innerHTML = '共 <b>' + n + '</b> 人 · 每组 <span class="hl">' + size + '</span> 人 · 将分成 <b>' + count +
      '</b> 组（' + sizes.join(' / ') + ' 人）';
  }

  /* ---------------- 手动微调 ---------------- */

  function moveMember(fromGi, toGi, mi) {
    var src = fromGi === -1 ? state.pool : (state.groups[fromGi] && state.groups[fromGi].members);
    if (!src) return;
    var name = src.splice(mi, 1)[0];
    if (name === undefined) return;

    if (toGi === -1) {
      state.pool.push(name);
    } else if (state.groups[toGi]) {
      state.groups[toGi].members.push(name);
    } else {
      src.splice(mi, 0, name);
      return;
    }
    state.edited = true;
    closePop();
    render();
    persistCurrent();
  }

  function deleteGroup(gi) {
    var g = state.groups[gi];
    if (!g) return;
    if (!g.members.length) {
      state.groups.splice(gi, 1);
    } else {
      state.pool = state.pool.concat(g.members);
      state.groups.splice(gi, 1);
    }
    state.edited = true;
    render();
    persistCurrent();
  }

  function openPop(gi, mi, anchor) {
    var fromLabel = gi === -1 ? '未分组' : state.groups[gi].name;
    var html = '<div class="move-pop-title">移动到 · 来自 ' + esc(fromLabel) + '</div>';
    state.groups.forEach(function (g, i) {
      if (i === gi) return;
      html += '<button type="button" class="move-opt" data-to="' + i + '">' +
              '<span class="dot" style="background:' + colorOf(i) + ';color:' + colorOf(i) + '"></span>' + esc(g.name) +
              '</button>';
    });
    html += '<button type="button" class="move-opt" data-to="-1">' +
            '<span class="dot" style="background:#ffe600;color:#ffe600"></span>未分组</button>';

    el.pop.innerHTML = html;
    el.pop.hidden = false;

    var r = anchor.getBoundingClientRect();
    var w = el.pop.offsetWidth;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if (top + el.pop.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - el.pop.offsetHeight - 6);
    }
    el.pop.style.left = left + 'px';
    el.pop.style.top = top + 'px';
    el.pop.dataset.gi = gi;
    el.pop.dataset.mi = mi;
  }

  function closePop() { el.pop.hidden = true; el.pop.innerHTML = ''; }

  /* ---------------- 历史 ---------------- */

  function pushHistory() {
    var list = load(LS.history, []);
    var entry = {
      id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      size: state.size,
      total: state.names.length,
      groups: state.groups.map(function (g) { return { name: g.name, members: g.members.slice() }; }),
      pool: state.pool.slice()
    };
    list.unshift(entry);
    save(LS.history, list.slice(0, HISTORY_LIMIT));
    renderHistory();
  }

  function restoreHistory(id) {
    var list = load(LS.history, []);
    var h = null;
    list.forEach(function (x) { if (x.id === id) h = x; });
    if (!h) return;

    state.groups = (h.groups || []).map(function (g) {
      return { id: ++uid, name: g.name, members: (g.members || []).slice() };
    });
    state.pool = (h.pool || []).slice();
    state.size = h.size || state.size;
    el.size.value = state.size;

    var all = [];
    state.groups.forEach(function (g) { all = all.concat(g.members); });
    all = all.concat(state.pool);
    var deduped = dedupe(all);
    state.names = deduped.list;
    state.dup = deduped.dup;
    syncTextarea();

    state.edited = true;
    state.hasResult = true;
    render();
    persistCurrent();
    showToast('已恢复该次分组');
  }

  function persistCurrent() {
    save(LS.current, {
      names: state.names,
      size: state.size,
      groups: state.groups.map(function (g) { return { name: g.name, members: g.members.slice() }; }),
      pool: state.pool.slice(),
      edited: state.edited
    });
  }

  function restoreCurrent() {
    var c = load(LS.current, null);
    if (!c) return;
    state.names = c.names || [];
    state.size = c.size || 5;
    state.groups = (c.groups || []).map(function (g) {
      return { id: ++uid, name: g.name, members: (g.members || []).slice() };
    });
    state.pool = c.pool || [];
    state.edited = !!c.edited;
    state.hasResult = state.groups.length > 0;
    el.names.value = state.names.join('\n');
    el.size.value = state.size;
    updateHint();
    render();
  }

  /* ---------------- 复制 ---------------- */

  function buildText() {
    var lines = ['分组派对 · 分组结果',
                 '每组 ' + state.size + ' 人 · ' + state.groups.length + ' 组 · 共 ' + state.names.length + ' 人',
                 ''];
    state.groups.forEach(function (g, i) {
      lines.push('【' + g.name + '】（' + g.members.length + ' 人）');
      lines.push(g.members.length ? g.members.join('、') : '（空）');
      lines.push('');
    });
    if (state.pool.length) {
      lines.push('【未分组】（' + state.pool.length + ' 人）');
      lines.push(state.pool.join('、'));
      lines.push('');
    }
    return lines.join('\n');
  }

  function copyResult() {
    var text = buildText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('结果已复制到剪贴板');
      }).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('结果已复制到剪贴板');
    } catch (e) {
      showToast('复制失败，请手动选择文本');
    }
    document.body.removeChild(ta);
  }

  /* ---------------- 事件绑定 ---------------- */

  el.names.addEventListener('input', function () { readRoster(); });
  el.names.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSplit(); }
  });

  el.sample.addEventListener('click', function () {
    el.names.value = SAMPLE.join('\n');
    readRoster();
    showToast('已填入 ' + SAMPLE.length + ' 个示例名字');
  });

  el.clear.addEventListener('click', function () {
    el.names.value = '';
    readRoster();
    state.groups = [];
    state.pool = [];
    state.edited = false;
    state.hasResult = false;
    render();
    persistCurrent();
    showToast('已清空');
  });

  el.size.addEventListener('input', function () {
    state.size = clampSize(parseInt(el.size.value, 10) || 1);
    updateHint();
  });
  el.size.addEventListener('change', function () {
    state.size = clampSize(parseInt(el.size.value, 10) || 1);
    el.size.value = state.size;
    updateHint();
    persistCurrent();
  });
  el.sizeMinus.addEventListener('click', function () {
    el.size.value = clampSize(state.size - 1);
    state.size = parseInt(el.size.value, 10);
    updateHint();
  });
  el.sizePlus.addEventListener('click', function () {
    el.size.value = clampSize(state.size + 1);
    state.size = parseInt(el.size.value, 10);
    updateHint();
  });

  el.split.addEventListener('click', doSplit);
  el.reshuffle.addEventListener('click', doSplit);
  el.copy.addEventListener('click', copyResult);

  el.addGroup.addEventListener('click', function () {
    var n = state.groups.length + 1;
    state.groups.push({ id: ++uid, name: '第 ' + n + ' 组', members: [] });
    state.edited = true;
    render();
    persistCurrent();
  });

  el.clearHistory.addEventListener('click', function () {
    if (!load(LS.history, []).length) { showToast('暂无历史记录'); return; }
    save(LS.history, []);
    renderHistory();
    showToast('历史记录已清空');
  });

  /* 结果区交互（事件委托） */
  el.groups.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var gi = parseInt(btn.getAttribute('data-gi'), 10);
    var mi = parseInt(btn.getAttribute('data-mi'), 10);

    if (act === 'move') {
      e.stopPropagation();
      openPop(gi, mi, btn);
    } else if (act === 'del') {
      if (gi === -1) {
        var name = state.pool.splice(mi, 1)[0];
        state.names = state.names.filter(function (n) { return n !== name; });
        syncTextarea();
        showToast('已从名单中删除「' + name + '」');
      } else {
        moveMember(gi, -1, mi);
        showToast('已移入未分组');
      }
      state.edited = true;
      render();
      persistCurrent();
    } else if (act === 'shuffle') {
      state.groups[gi].members = shuffle(state.groups[gi].members);
      state.edited = true;
      render();
      persistCurrent();
    } else if (act === 'delGroup') {
      deleteGroup(gi);
    }
  });

  /* 组名编辑 */
  el.groups.addEventListener('change', function (e) {
    var input = e.target.closest('.group-name');
    if (!input || !input.dataset.gi) return;
    var gi = parseInt(input.getAttribute('data-gi'), 10);
    var v = input.value.trim();
    if (!v) { input.value = state.groups[gi].name; return; }
    state.groups[gi].name = v;
    state.edited = true;
    persistCurrent();
  });

  el.groups.addEventListener('keydown', function (e) {
    var input = e.target.closest('.group-name');
    if (input && e.key === 'Enter') { e.preventDefault(); input.blur(); }
  });

  /* 拖拽调整 */
  el.groups.addEventListener('dragstart', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    dragPayload = { gi: parseInt(chip.getAttribute('data-gi'), 10), mi: parseInt(chip.getAttribute('data-mi'), 10) };
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
    } catch (err) { /* 某些浏览器限制 */ }
    chip.classList.add('dragging');
  });

  el.groups.addEventListener('dragover', function (e) {
    var card = e.target.closest('.group');
    if (!card || !dragPayload) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    card.classList.add('drop-active');
  });

  el.groups.addEventListener('dragleave', function (e) {
    var card = e.target.closest('.group');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('drop-active');
  });

  el.groups.addEventListener('drop', function (e) {
    var card = e.target.closest('.group');
    if (!card || !dragPayload) return;
    e.preventDefault();
    card.classList.remove('drop-active');
    moveMember(dragPayload.gi, parseInt(card.getAttribute('data-gi'), 10), dragPayload.mi);
    dragPayload = null;
  });

  el.groups.addEventListener('dragend', function () {
    dragPayload = null;
    Array.prototype.forEach.call(el.groups.querySelectorAll('.drop-active'), function (n) {
      n.classList.remove('drop-active');
    });
    Array.prototype.forEach.call(el.groups.querySelectorAll('.dragging'), function (n) {
      n.classList.remove('dragging');
    });
  });

  /* 避免点击 chip 按钮时触发拖拽 */
  el.groups.addEventListener('mousedown', function (e) {
    if (e.target.closest('.chip-act')) e.preventDefault();
  });

  /* 移动弹层 */
  el.pop.addEventListener('click', function (e) {
    var opt = e.target.closest('.move-opt');
    if (!opt) return;
    var gi = parseInt(el.pop.dataset.gi, 10);
    var mi = parseInt(el.pop.dataset.mi, 10);
    var to = parseInt(opt.getAttribute('data-to'), 10);
    moveMember(gi, to, mi);
    showToast('已移动');
  });

  document.addEventListener('click', function (e) {
    if (!el.pop.hidden && !el.pop.contains(e.target) && !e.target.closest('.chip-act')) closePop();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePop();
  });

  window.addEventListener('resize', closePop);

  /* 历史区交互 */
  el.history.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.getAttribute('data-hid');
    if (btn.getAttribute('data-act') === 'restore') {
      restoreHistory(id);
    } else if (btn.getAttribute('data-act') === 'delHistory') {
      var list = load(LS.history, []).filter(function (x) { return x.id !== id; });
      save(LS.history, list);
      renderHistory();
    }
  });

  /* ---------------- 启动 ---------------- */

  restoreCurrent();
  readRoster();
  render();
})();
