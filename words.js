/* ============================================================
   分词 · WORD//SPLIT
   组织者：导入词库 → 按组分配 → 生成分发链接
   参与者：打开链接 → 输入姓名 → 领取自己的那个词
   ============================================================ */
(function () {
  'use strict';

  var LS_CURRENT = 'groupSplit.current.v1';

  var el = {
    backLink:   document.getElementById('backLink'),
    organizer:  document.getElementById('organizerView'),
    participant:document.getElementById('participantView'),

    groupSource:document.getElementById('groupSource'),
    fileDrop:   document.getElementById('fileDrop'),
    wordFile:   document.getElementById('wordFile'),
    wordText:   document.getElementById('wordText'),
    loadTextBtn:document.getElementById('loadTextBtn'),
    clearWordsBtn: document.getElementById('clearWordsBtn'),
    wordCount:  document.getElementById('wordCount'),

    publishHint:document.getElementById('publishHint'),
    publishBtn: document.getElementById('publishBtn'),
    linkBox:    document.getElementById('linkBox'),
    publishLink:document.getElementById('publishLink'),
    copyLinkBtn:document.getElementById('copyLinkBtn'),
    linkSize:   document.getElementById('linkSize'),
    assignPreview: document.getElementById('assignPreview'),

    pName:      document.getElementById('pName'),
    pSubmit:    document.getElementById('pSubmit'),
    pHint:      document.getElementById('pHint'),
    pResult:    document.getElementById('pResult'),
    pWord:      document.getElementById('pWord'),
    pGroup:     document.getElementById('pGroup'),
    pBackBtn:   document.getElementById('pBackBtn'),

    toast:      document.getElementById('toast')
  };

  var state = { words: [], groups: [], payload: null, roomEnc: null, inParticipant: false };
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

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function dedupe(list) {
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (n) {
      var key = n.replace(/\s+/g, '').toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(n);
    });
    return out;
  }

  function parseTextWords(raw) {
    return dedupe(String(raw).split(/[\r\n,，、;；|]+/).map(function (s) { return s.trim(); }).filter(Boolean));
  }

  /* ---------------- 编码（gzip + base64url，见 payload.js） ---------------- */

  function encodePayload(obj) {
    return window.GSPayload.encode(obj);
  }

  function decodePayload(str) {
    return window.GSPayload.decode(str);
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

  function renderGroupSource() {
    var gs = state.groups = loadGroups();
    if (!gs.length) {
      el.groupSource.innerHTML = '<p class="setup-hint warn-text">还没有可用的分组结果。请先到 <a href="index.html">分组页</a> 完成一次分组，再回来发布词语。</p>';
      el.publishBtn.disabled = true;
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
    updatePublishState();
  }

  function colorOf(i) {
    var COLORS = ['#f0187f', '#0092c7', '#7ea800', '#f06400', '#7c3aed', '#c99a00',
                  '#00a870', '#e11d48', '#2563eb', '#c026d3', '#d97706', '#16a34a'];
    return COLORS[i % COLORS.length];
  }

  /* ---------------- 词库导入 ---------------- */

  function setWords(list) {
    state.words = dedupe(list);
    el.wordCount.innerHTML = '词库 <b>' + state.words.length + '</b> 个';
    el.wordText.value = state.words.join('\n');
    updatePublishState();
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('脚本加载失败')); };
      document.head.appendChild(s);
    });
  }

  function ensureSheetJS() {
    if (window.XLSX) return Promise.resolve();
    return loadScript('vendor/xlsx.full.min.js').then(function () {
      if (!window.XLSX) throw new Error('Excel 解析库加载失败');
    });
  }

  function readFile(file) {
    var name = (file.name || '').toLowerCase();
    if (/\.xlsx?$/.test(name)) {
      el.wordCount.innerHTML = '正在解析 Excel…';
      return ensureSheetJS().then(function () {
        return new Promise(function (resolve, reject) {
          var fr = new FileReader();
          fr.onload = function () {
            try {
              var wb = window.XLSX.read(new Uint8Array(fr.result), { type: 'array' });
              var words = [];
              wb.SheetNames.forEach(function (sn) {
                var rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false, defval: '' });
                rows.forEach(function (row) {
                  row.forEach(function (cell) {
                    var t = String(cell == null ? '' : cell).trim();
                    if (t) words.push(t);
                  });
                });
              });
              resolve(words);
            } catch (e) { reject(new Error('Excel 解析失败：' + e.message)); }
          };
          fr.onerror = function () { reject(new Error('文件读取失败')); };
          fr.readAsArrayBuffer(file);
        });
      });
    }
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(parseTextWords(fr.result)); };
      fr.onerror = function () { reject(new Error('文件读取失败')); };
      fr.readAsText(file, 'UTF-8');
    });
  }

  /* ---------------- 发布 ---------------- */

  function updatePublishState() {
    var ok = state.groups.length > 0 && state.words.length > 0;
    el.publishBtn.disabled = !ok;
    if (!state.groups.length) {
      el.publishHint.innerHTML = '请先到 <a href="index.html">分组页</a> 完成一次分组';
    } else if (!state.words.length) {
      el.publishHint.innerHTML = '请先导入词库（Excel 或直接粘贴）';
    } else {
      el.publishHint.innerHTML = '共 <b>' + state.groups.length + '</b> 组 · 词库 <b>' + state.words.length +
        '</b> 个词 · 组内互不相同、组间可重复';
    }
  }

  function buildPayload(gs, words) {
    var rows = [];
    gs.forEach(function (g, gi) {
      var picks = shuffle(words).slice(0, g.members.length);  // 组内不重复
      shuffle(g.members.slice()).forEach(function (m, i) {
        rows.push([m, picks[i], gi]);
      });
    });
    return { v: 1, g: gs.map(function (g) { return g.name; }), p: rows };
  }

  function publish() {
    // 每次发布都重新读取最新的分组结果（可能刚在分组页改过）
    state.groups = loadGroups();
    renderGroupSource();
    if (!state.groups.length) { showToast('请先完成分组'); return; }
    if (!state.words.length) { showToast('请先导入词库'); return; }

    var bad = state.groups.filter(function (g) { return g.members.length > state.words.length; });
    if (bad.length) {
      el.publishHint.innerHTML = '<span class="warn-text">词库只有 <b>' + state.words.length + '</b> 个词，' +
        '<b>' + esc(bad[0].name) + '</b> 有 ' + bad[0].members.length + ' 人 —— 无法保证组内不重复，请补充词库</span>';
      showToast('词库不够，无法保证组内不重复');
      return;
    }

    var payload = buildPayload(state.groups, state.words);
    encodePayload(payload).then(function (enc) {
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
    var html = '<h3 class="preview-title">分配结果预览</h3><div class="preview-grid">';
    Object.keys(byGroup).forEach(function (gi) {
      var c = colorOf(parseInt(gi, 10));
      html += '<div class="preview-group" style="--c:' + c + '">' +
        '<div class="preview-head"><span class="group-dot"></span>' + esc(payload.g[gi]) + '</div>' +
        '<ul class="preview-list">';
      byGroup[gi].forEach(function (r) {
        html += '<li><span class="pv-name">' + esc(r[0]) + '</span><span class="pv-arrow">→</span><span class="pv-word">' + esc(r[1]) + '</span></li>';
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
    document.title = '领取你的词语';
    // 重置上一次查询状态（同一页内换链接时复用）
    el.pResult.hidden = true;
    el.pName.disabled = false;
    el.pSubmit.hidden = false;
    el.pName.value = '';
    el.pHint.textContent = '';

    decodePayload(enc).then(function (payload) {
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

    el.pWord.textContent = hit[1];
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

  el.fileDrop.addEventListener('click', function () { el.wordFile.click(); });
  el.wordFile.addEventListener('change', function () {
    var f = el.wordFile.files && el.wordFile.files[0];
    if (!f) return;
    el.wordCount.innerHTML = '正在读取…';
    readFile(f).then(function (words) {
      setWords(words);
      showToast('已导入 ' + state.words.length + ' 个词');
    }).catch(function (e) {
      el.wordCount.innerHTML = '词库 <b>' + state.words.length + '</b> 个';
      showToast(e.message || '导入失败');
    });
    el.wordFile.value = '';
  });

  el.loadTextBtn.addEventListener('click', function () {
    var words = parseTextWords(el.wordText.value);
    if (!words.length) { showToast('没有读到词语'); return; }
    setWords(words);
    showToast('已导入 ' + state.words.length + ' 个词');
  });

  el.clearWordsBtn.addEventListener('click', function () {
    setWords([]);
    el.wordText.value = '';
    showToast('词库已清空');
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
    document.title = '分词 · 每人只看到自己的词';
    renderGroupSource();
  }

  /* URL 带 #room= 时进入参与者视图。
     注意：同一页面内仅 fragment 变化属于同文档导航，不会重新执行脚本，
     因此必须监听 hashchange，否则「已经打开过组织者页面再粘贴分发链接」会毫无反应。 */
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
      renderGroupSource();
    }
  }

  window.addEventListener('hashchange', boot);
  boot();
})();
