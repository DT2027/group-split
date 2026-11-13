/* ============================================================
   共享模块 · GSPayload
   链接载荷编解码：gzip + base64url
   —— 分词页与卧底页共用，数据只存在 URL 的 # 片段里，不经过服务器
   ============================================================ */
(function (global) {
  'use strict';

  function b64urlEncode(bytes) {
    var bin = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /* 编码：优先 gzip，浏览器不支持时退回明文（加 'p' 前缀） */
  function encode(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') {
      try {
        var cs = new CompressionStream('gzip');
        var stream = new Blob([bytes]).stream().pipeThrough(cs);
        return new Response(stream).arrayBuffer().then(function (ab) {
          return 'g' + b64urlEncode(new Uint8Array(ab));
        }).catch(function () { return 'p' + b64urlEncode(bytes); });
      } catch (e) { /* 落到明文分支 */ }
    }
    return Promise.resolve('p' + b64urlEncode(bytes));
  }

  /* 解码：自动识别 gzip / 明文 */
  function decode(str) {
    var tag = str.charAt(0);
    var body = str.slice(1);
    var bytes = b64urlDecode(body);
    if (tag === 'g') {
      if (typeof DecompressionStream !== 'function') {
        return Promise.reject(new Error('当前浏览器不支持解压该链接，请换用最新版 Chrome / Edge / Safari'));
      }
      var ds = new DecompressionStream('gzip');
      var stream = new Blob([bytes]).stream().pipeThrough(ds);
      return new Response(stream).arrayBuffer().then(function (ab) {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(ab)));
      });
    }
    return Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)));
  }

  global.GSPayload = { encode: encode, decode: decode };
})(window);
