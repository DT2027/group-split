/* ============================================================
   卧底 · UNDER//COVER
   组织者：给每个组配置「词语 + 人数」若干档 → 生成发牌链接
   参与者：打开链接 → 输入姓名 → 领取自己那一张牌
   —— 空格（留空）= 空白牌，拿到的人不显示卧底身份
   ============================================================ */
(function () {
  'use strict';

  var LS_CURRENT = 'groupSplit.current.v1';
  var LS_TABLES = 'groupSplit.undercover.v1';

  var el = {
    backLink:    document.getElementById('backLink'),
    organizer:   document.getElementById('organizerView'),
    participant: document.getElementById('participantView'),

    groupSource: document.getElementById('groupSource'),
    groupTables: document.getElementById('groupTables'),

    publishHint: document.getElementById('publishHint'),
    publishBtn:  document.getElementById('publishBtn'),
    linkBox:     document.getElementById('linkBox'),
    publishLink: document.getElementById('publishLink'),
    copyLinkBtn: document.getElementById('copyLinkBtn'),
    linkSize:    document.getElementById('linkSize'),
    assignPreview: document.getElementById('assignPreview'),

    pName:   document.getElementById('pName'),
    pSubmit: document.getElementById('pSubmit'),
    pHint:   document.getElementById('pHint'),
    pResult: document.getElementById('pResult'),
    pWord:   document.getElementById('pWord'),
    pGroup:  document.getElementById('pGroup'),
    pBackBtn: document.getElementById('pBackBtn'),

    toast: document.getElementById('toast')
  };

  var state = {
    groups: [],        // [{ name, members: [] }]
    tables: [],        // 与 groups 对齐：每组若干档 [{ word, count }]
    payload: null,
    roomEnc: null,
    inParticipant: false
  };

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

  function colorOf(i) {
    var COLORS = ['#f0187f', '#0092c7', '#7ea800', '#f06400', '#7c3aed', '#c99a00',
                  '#00a870', '#e11d48', '#2563eb', '#c026d3', '#d97706', '#16a34a'];
    return COLORS[i % COLORS.length];
  }

  function toCount(v) {
    var n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return 0;
    return n;
  }

  /* ---------------- 分组来源 ---------------- */

  function loadGroups() {
    var c = load(LS_CURRENT, null);
    if (!c) return [];
    var gs = (c.groups || []).map(function (g) {
      return { name: g.name, members: (g.members || []).slice() };
    }).filter(function (g) { return g.members.length > 0; });
    if (c.pool && c.pool.length) gs.push({ name: '未分组', members: c.pool.slice() });
    return gs;
  }

  function sameGroups(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].name !== b[i].name) return false;
      if (a[i].members.length !== b[i].members.length) return false;
    }
    return true;
  }

  /* 默认词表：N-1 人拿同一个词 + 1 人拿空白牌（经典卧底玩法） */
  function defaultRows(size) {
    if (size >= 2) return [{ word: '', count: size - 1 }, { word: '', count: 1 }];
    return [{ word: '', count: size }];
  }

  /* 分组签名：组名 + 组人数，用来判断已保存的词表是否还对得上当前分组 */
  function groupSignature(gs) {
    return gs.map(function (g) { return g.name + ':' + g.members.length; }).join('|');
  }

  /* 词表落盘：误刷新或切走再回来都不会白填 */
  function saveTables() {
    save(LS_TABLES, { sig: groupSignature(state.groups), tables: state.tables });
  }

  function restoreTables(gs) {
    var c = load(LS_TABLES, null);
    if (c && c.sig === groupSignature(gs) && Array.isArray(c.tables) && c.tables.length === gs.length) {
      state.tables = c.tables.map(function (rows) {
        return (rows || []).map(function (r) {
          return { word: String(r.word || ''), count: r.count };
        });
      });
      return;
    }
    state.tables = gs.map(function (g) { return defaultRows(g.members.length); });
  }

  /* 重新读取分组结果；分组结构变了才重建词表，避免覆盖已填内容 */
  function syncGroups() {
    var gs = loadGroups();
    if (!sameGroups(gs, state.groups)) {
      state.groups = gs;
      restoreTables(gs);
    } else {
      state.groups = gs;
    }
  }

  function renderGroupSource() {
    var gs = state.groups;
    if (!gs.length) {
      el.groupSource.innerHTML = '<p class="setup-hint warn-text">还没有可用的分组结果。请先到 <a href="index.html">分组页</a> 完成一次分组，再回来发牌。</p>';
      el.groupTables.innerHTML = '';
      updatePublishState();
      return;
    }
    var total = gs.reduce(function (a, g) { return a + g.members.length; }, 0);
    var html = '<p class="src-line">共 <b>' + total + '</b> 人 · <b>' + gs.length + '</b> 组（' +
      gs.map(function (g) { return g.members.length; }).join(' / ') + ' 人）</p>';
    html += '<ul class="src-groups">';
    gs.forEach(function (g, i) {
      html += '<li><span class="src-dot" style="background:' + colorOf(i) + '"></span>' +
        '<span class="src-name">' + esc(g.name) + '</span>' +
        '<span class="src-count">' + g.members.length + ' 人</span></li>';
    });
    html += '</ul>';
    el.groupSource.innerHTML = html;
    renderTables();
    updatePublishState();
  }

  /* ---------------- 词表 ---------------- */

  /* 校验某一组：人数必须与组人数相等，且至少有一个非空词语 */
  function groupCheck(gi) {
    var g = state.groups[gi];
    var rows = state.tables[gi] || [];
    var sum = 0, active = 0, hasWord = false;
    rows.forEach(function (r) {
      var c = toCount(r.count);
      sum += c;
      if (c > 0) active++;
      if (String(r.word || '').trim()) hasWord = true;
    });
    if (!active) return { ok: false, msg: '还没有词表，点「添加一档」开始填写' };
    if (!hasWord) return { ok: false, msg: '至少要填一个词语（留空的档 = 空白牌）' };
    if (sum !== g.members.length) {
      var diff = g.members.length - sum;
      return { ok: false, msg: diff > 0 ? ('还差 ' + diff + ' 人') : ('超出 ' + (-diff) + ' 人') };
    }
    return { ok: true, msg: '合计 ' + sum + ' / ' + g.members.length + ' 人 ✓' };
  }

  function firstBad() {
    for (var gi = 0; gi < state.groups.length; gi++) {
      var chk = groupCheck(gi);
      if (!chk.ok) return { gi: gi, name: state.groups[gi].name, msg: chk.msg };
    }
    return null;
  }

  function renderTables() {
    if (!state.groups.length) { el.groupTables.innerHTML = ''; return; }
    var html = '';
    state.groups.forEach(function (g, gi) {
      var rows = state.tables[gi] || [];
      var chk = groupCheck(gi);
      html += '<div class="slot-card' + (chk.ok ? '' : ' is-bad') + '" data-gi="' + gi + '">';
      html += '<div class="slot-head">' +
        '<span class="src-dot" style="background:' + colorOf(gi) + '"></span>' +
        '<span class="src-name">' + esc(g.name) + '</span>' +
        '<span class="slot-total ' + (chk.ok ? 'is-ok' : 'is-bad') + '">' + esc(chk.msg) + '</span>' +
        '</div>';
      html += '<div class="slot-cols"><span>词语</span><span>人数</span><span></span></div>';
      html += '<div class="slot-rows">';
      rows.forEach(function (r, ri) {
        html += '<div class="slot-row" data-gi="' + gi + '" data-ri="' + ri + '">' +
          '<input type="text" class="slot-word" data-gi="' + gi + '" data-ri="' + ri + '" ' +
            'value="' + esc(r.word) + '" placeholder="留空 = 空白牌" autocomplete="off" spellcheck="false" />' +
          '<input type="number" class="slot-count" data-gi="' + gi + '" data-ri="' + ri + '" ' +
            'value="' + esc(r.count) + '" min="0" step="1" aria-label="这一档的人数" />' +
          '<button type="button" class="slot-del" data-act="del" data-gi="' + gi + '" data-ri="' + ri + '" ' +
            'title="删除这一档" aria-label="删除这一档">✕</button>' +
          '</div>';
      });
      html += '</div>';
      html += '<div class="slot-foot">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="add" data-gi="' + gi + '">＋ 添加一档</button>' +
        '<span class="slot-tip">留空的档 = 空白牌</span>' +
        '</div>';
      html += '</div>';
    });
    el.groupTables.innerHTML = html;
  }

  function refreshGroupCheck(gi) {
    var card = el.groupTables.querySelector('.slot-card[data-gi="' + gi + '"]');
    if (!card) return;
    var chk = groupCheck(gi);
    var total = card.querySelector('.slot-total');
    if (total) {
      total.textContent = chk.msg;
      total.className = 'slot-total ' + (chk.ok ? 'is-ok' : 'is-bad');
    }
    if (chk.ok) card.classList.remove('is-bad');
    else card.classList.add('is-bad');
  }

  /* ---------------- 发布 ---------------- */

  function updatePublishState() {
    if (!state.groups.length) {
      el.publishBtn.disabled = true;
      el.publishHint.innerHTML = '请先到 <a href="index.html">分组页</a> 完成一次分组';
      return;
    }
    var bad = firstBad();
    if (bad) {
      el.publishBtn.disabled = true;
      el.publishHint.innerHTML = '<span class="warn-text">' + esc(bad.name) + '：' + esc(bad.msg) + '</span>';
      return;
    }
    el.publishBtn.disabled = false;
    el.publishHint.innerHTML = '共 <b>' + state.groups.length + '</b> 组 · 各组人数已对齐 · 留空的档会发空白牌';
  }

  function buildPayload() {
    var rows = [];
    state.groups.forEach(function (g, gi) {
      var bag = [];
      (state.tables[gi] || []).forEach(function (r) {
        var c = toCount(r.count);
        var w = String(r.word || '').trim();
        for (var i = 0; i < c; i++) bag.push(w);
      });
      bag = shuffle(bag);
      shuffle(g.members.slice()).forEach(function (m, i) {
        rows.push([m, bag[i] !== undefined ? bag[i] : '', gi]);
      });
    });
    return {
      v: 1,
      m: 'undercover',
      g: state.groups.map(function (g) { return g.name; }),
      p: rows
    };
  }

  function publish() {
    syncGroups();          // 发布前重新读取最新分组结果
    renderGroupSource();
    var bad = firstBad();
    if (bad) {
      showToast(bad.name + '：' + bad.msg);
      return;
    }
    var payload = buildPayload();
    saveTables();
    window.GSPayload.encode(payload).then(function (enc) {
      var link = location.href.split('#')[0] + '#room=' + enc;
      state.payload = payload;
      el.publishLink.value = link;
      el.linkBox.hidden = false;
      el.linkSize.className = 'sizes-total ok';
      el.linkSize.textContent = '链接长度 ' + link.length + ' 字符 · 数据在链接里，不经过服务器';
      renderPreview(payload);
      showToast('链接已生成');
    });
  }

  function renderPreview(payload) {
    var byGroup = {};
    payload.p.forEach(function (r) {
      (byGroup[r[2]] = byGroup[r[2]] || []).push(r);
    });
    var html = '<h3 class="preview-title">发牌结果预览</h3><div class="preview-grid">';
    Object.keys(byGroup).forEach(function (key) {
      var gi = parseInt(key, 10);
      var c = colorOf(gi);
      var slots = {};
      byGroup[gi].forEach(function (r) {
        var w = r[1] === '' ? '（空白）' : r[1];
        slots[w] = (slots[w] || 0) + 1;
      });
      var slotTxt = Object.keys(slots).map(function (w) {
        return w + ' × ' + slots[w];
      }).join(' · ');
      html += '<div class="preview-group" style="--c:' + c + '">' +
        '<div class="preview-head"><span class="group-dot"></span>' + esc(payload.g[gi]) + '</div>' +
        '<div class="preview-slots">' + esc(slotTxt) + '</div>' +
        '<ul class="preview-list">';
      byGroup[gi].forEach(function (r) {
        var blank = r[1] === '';
        html += '<li><span class="pv-name">' + esc(r[0]) + '</span><span class="pv-arrow">→</span>' +
          '<span class="pv-word' + (blank ? ' is-blank' : '') + '">' +
          esc(blank ? '（空白）' : r[1]) + '</span></li>';
      });
      html += '</ul></div>';
    });
    html += '</div>';
    el.assignPreview.innerHTML = html;
    el.assignPreview.hidden = false;
  }

  /* ---------------- 参与者模式 ---------------- */

  function initParticipant(enc) {
    el.organizer.hidden = true;
    el.participant.hidden = false;
    el.backLink.hidden = true;
    document.title = '卧底 · 领取你的牌';
    el.pResult.hidden = true;
    el.pName.disabled = false;
    el.pSubmit.hidden = false;
    el.pSubmit.disabled = false;
    el.pName.value = '';
    el.pHint.textContent = '';

    window.GSPayload.decode(enc).then(function (payload) {
      if (!payload || !payload.p || !payload.p.length) throw new Error('链接数据为空');
      state.payload = payload;
      el.pHint.textContent = '本链接专属分配给 ' + payload.p.length + ' 个人，输入姓名即可查看';
      el.pName.focus();
    }).catch(function (e) {
      el.pHint.innerHTML = '<span class="warn-text">' + esc(e.message || '链接无效或已损坏') + '</span>';
      el.pSubmit.disabled = true;
    });
  }

  function claim() {
    var name = el.pName.value.trim();
    if (!name) { el.pHint.innerHTML = '<span class="warn-text">请输入你的姓名</span>'; return; }
    if (!state.payload) return;

    var hit = null;
    for (var i = 0; i < state.payload.p.length; i++) {
      if (state.payload.p[i][0] === name) { hit = state.payload.p[i]; break; }
    }
    if (!hit) {
      el.pHint.innerHTML = '<span class="warn-text">名单里没有「' + esc(name) + '」，请确认姓名是否与名单一致</span>';
      return;
    }

    var blank = !hit[1];
    el.pWord.textContent = blank ? '（空白）' : hit[1];
    el.pWord.className = 'word-text' + (blank ? ' is-blank' : '');
    el.pGroup.textContent = state.payload.g[hit[2]] || '';
    el.pResult.hidden = false;
    el.pName.disabled = true;
    el.pSubmit.hidden = true;
    el.pHint.textContent = '已发放，请记住你的词语';
  }

  function resetClaim() {
    el.pResult.hidden = true;
    el.pName.disabled = false;
    el.pSubmit.hidden = false;
    el.pName.value = '';
    el.pHint.textContent = '';
    el.pName.focus();
  }

  /* ---------------- 事件绑定 ---------------- */

  el.groupTables.addEventListener('input', function (e) {
    var t = e.target;
    var isWord = t.classList.contains('slot-word');
    var isCount = t.classList.contains('slot-count');
    if (!isWord && !isCount) return;
    var gi = parseInt(t.getAttribute('data-gi'), 10);
    var ri = parseInt(t.getAttribute('data-ri'), 10);
    var row = state.tables[gi] && state.tables[gi][ri];
    if (!row) return;
    if (isWord) row.word = t.value;
    else row.count = t.value;
    saveTables();
    refreshGroupCheck(gi);
    updatePublishState();
  });

  el.groupTables.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var gi = parseInt(btn.getAttribute('data-gi'), 10);
    var ri = parseInt(btn.getAttribute('data-ri'), 10);
    if (act === 'add') {
      if (!state.tables[gi]) return;
      state.tables[gi].push({ word: '', count: 1 });
    } else if (act === 'del') {
      if (!state.tables[gi]) return;
      state.tables[gi].splice(ri, 1);
    } else {
      return;
    }
    renderTables();
    saveTables();
    updatePublishState();
  });

  el.publishBtn.addEventListener('click', publish);

  el.copyLinkBtn.addEventListener('click', function () {
    var text = el.publishLink.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast('链接已复制，发给参与者即可');
      }).catch(function () {
        el.publishLink.select();
        showToast('请手动复制链接');
      });
    } else {
      el.publishLink.select();
      showToast('请手动复制链接');
    }
  });

  el.pSubmit.addEventListener('click', claim);
  el.pName.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); claim(); }
  });
  el.pBackBtn.addEventListener('click', resetClaim);

  /* ---------------- 启动 ---------------- */

  function showOrganizer() {
    el.organizer.hidden = false;
    el.participant.hidden = true;
    el.backLink.hidden = false;
    document.title = '卧底 · 谁是卧底发牌';
    syncGroups();
    renderGroupSource();
  }

  /* URL 带 #room= 时进入参与者视图。
     仅 fragment 变化属于同文档导航、脚本不会重跑，所以必须监听 hashchange。 */
  function boot() {
    var hash = location.hash || '';
    if (hash.indexOf('#room=') === 0) {
      var enc = hash.slice('#room='.length);
      if (enc === state.roomEnc) return;
      state.roomEnc = enc;
      state.inParticipant = true;
      initParticipant(enc);
    } else if (state.inParticipant) {
      state.inParticipant = false;
      state.roomEnc = null;
      showOrganizer();
    } else {
      syncGroups();
      renderGroupSource();
    }
  }

  window.addEventListener('hashchange', boot);
  boot();
})();
