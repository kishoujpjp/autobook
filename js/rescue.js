// 救援層。這是「非 module」的傳統 script，在 main.js 之前載入：
// 就算某個 module 語法錯、或 store.js 在求值階段就被壞資料炸掉，這一層還是會跑。
//
// - 啟動完成前（window.__autobookReady 還不是 true）發生的錯誤 → 顯示最小救援畫面：
//   重新載入／匯出資料／重設全部資料。以前這種情況是整片白畫面，PWA 使用者只能刪圖示連資料一起刪。
// - 啟動完成後的錯誤 → 只寫進錯誤紀錄（設定頁「錯誤紀錄」看得到），不打擾正在用的小孩。
(function () {
  var ERRLOG = 'autobook.errlog';
  var KEYS = [
    'autobook.settings', 'autobook.words', 'autobook.stories', 'autobook.accounts',
    'autobook.currentAccount', 'autobook.phrases', 'autobook.repGroups',
  ];
  var shown = false;

  function lang() {
    try {
      var s = JSON.parse(localStorage.getItem('autobook.settings') || '{}');
      return s && s.lang === 'zh-Hans' ? 'hans' : 'hant';
    } catch (e) { return 'hant'; }
  }
  var T = {
    hant: {
      title: '載入出了問題',
      body: '資料或程式檔可能壞掉了。你的字表、故事都還在裝置裡，先匯出一份備份再處理最安全。',
      reload: '重新載入',
      export: '匯出資料',
      reset: '重設全部資料',
      close: '先繼續使用',
      resetQ: '要清掉這台裝置上的全部資料嗎？（字表、故事、帳號、圖片、語音全部會不見）',
      resetQ2: '真的要清掉嗎？這個動作不能復原。',
      exported: '已匯出（不含圖片與語音檔）',
      detail: '詳細錯誤',
    },
    hans: {
      title: '加载出了问题',
      body: '数据或程序文件可能坏掉了。你的字表、故事都还在设备里，先导出一份备份再处理最安全。',
      reload: '重新加载',
      export: '导出数据',
      reset: '重置全部数据',
      close: '先继续使用',
      resetQ: '要清掉这台设备上的全部数据吗？（字表、故事、账号、图片、语音全部会不见）',
      resetQ2: '真的要清掉吗？这个动作不能恢复。',
      exported: '已导出（不含图片与语音文件）',
      detail: '详细错误',
    },
  };

  function describe(e) {
    if (!e) return 'unknown';
    if (typeof e === 'string') return e;
    var s = (e.name ? e.name + ': ' : '') + (e.message || String(e));
    if (e.stack) s += '\n' + String(e.stack).split('\n').slice(0, 4).join('\n');
    return s;
  }

  function log(stage, msg) {
    try {
      var list = JSON.parse(localStorage.getItem(ERRLOG) || '[]');
      if (!Array.isArray(list)) list = [];
      list.unshift({ t: Date.now(), stage: stage, model: '-', msg: String(msg).slice(0, 500) });
      localStorage.setItem(ERRLOG, JSON.stringify(list.slice(0, 30)));
    } catch (e) { /* 空間滿也不能再炸 */ }
  }

  function exportData() {
    var data = { app: 'autobook', exportedAt: new Date().toISOString(), rescue: true, local: {}, idb: {} };
    // 正常 key 之外，store.js 判定為壞資料而退回預設的原始內容（<key>.bad）也一起帶出來
    var all = KEYS.concat(KEYS.map(function (k) { return k + '.bad'; }));
    for (var i = 0; i < all.length; i++) {
      var raw = localStorage.getItem(all[i]);
      if (raw == null) continue;
      if (all[i] === 'autobook.settings') {
        try { var s = JSON.parse(raw); delete s.apiKey; delete s.ttsApiKey; raw = JSON.stringify(s); } catch (e) { /* 原樣輸出 */ }
      }
      data.local[all[i]] = raw;
    }
    var name = 'autobook-rescue-' + new Date().toISOString().slice(0, 10) + '.json';
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var done = function () { alert(T[lang()].exported); };
    try {
      var file = new File([blob], name, { type: 'application/json' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: name }).then(done).catch(function () { /* 使用者取消 */ });
        return;
      }
    } catch (e) { /* 走下載 */ }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    done();
  }

  function resetAll() {
    var t = T[lang()];
    if (!confirm(t.resetQ)) return;
    if (!confirm(t.resetQ2)) return;
    try {
      for (var i = 0; i < KEYS.length; i++) { localStorage.removeItem(KEYS[i]); localStorage.removeItem(KEYS[i] + '.bad'); }
      localStorage.removeItem(ERRLOG);
    } catch (e) { /* ignore */ }
    var tasks = [];
    try { tasks.push(new Promise(function (res) { var r = indexedDB.deleteDatabase('autobook'); r.onsuccess = r.onerror = r.onblocked = res; })); } catch (e) { /* ignore */ }
    if (window.caches && caches.keys) {
      tasks.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }).catch(function () {}));
    }
    Promise.all(tasks).then(function () { location.reload(); }, function () { location.reload(); });
  }

  function btn(label, onclick, primary) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:700 18px/1.2 -apple-system,"PingFang TC",system-ui,sans-serif;padding:14px 18px;border:0;border-radius:16px;cursor:pointer;'
      + (primary ? 'background:#E9631A;color:#fff;box-shadow:0 5px 0 #B84A0E;' : 'background:#fff;color:#4A3B2A;box-shadow:0 5px 0 #E2CDA6;');
    b.onclick = onclick;
    return b;
  }

  function panel(e, stage) {
    if (shown) return;
    shown = true;
    var t = T[lang()];
    var mask = document.createElement('div');
    mask.id = 'rescue-panel';
    mask.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(74,59,42,.45);display:flex;align-items:center;justify-content:center;padding:24px;';
    var card = document.createElement('div');
    card.style.cssText = 'background:#FFF7EA;color:#4A3B2A;border-radius:28px;padding:28px;max-width:560px;width:100%;box-shadow:0 10px 0 rgba(74,59,42,.15);font-family:-apple-system,"PingFang TC",system-ui,sans-serif;';
    var h = document.createElement('div');
    h.textContent = t.title;
    h.style.cssText = 'font-size:26px;font-weight:800;margin-bottom:10px;';
    var p = document.createElement('p');
    p.textContent = t.body;
    p.style.cssText = 'font-size:17px;line-height:1.6;margin:0 0 18px;';
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;';
    row.appendChild(btn(t.reload, function () { location.reload(); }, true));
    row.appendChild(btn(t.export, exportData));
    row.appendChild(btn(t.reset, resetAll));
    row.appendChild(btn(t.close, function () { mask.remove(); }));
    var det = document.createElement('details');
    det.style.cssText = 'margin-top:16px;font-size:13px;color:#6F5F4A;';
    var sum = document.createElement('summary');
    sum.textContent = t.detail;
    var pre = document.createElement('pre');
    pre.textContent = (stage ? '[' + stage + '] ' : '') + describe(e);
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;margin:8px 0 0;';
    det.appendChild(sum);
    det.appendChild(pre);
    card.appendChild(h); card.appendChild(p); card.appendChild(row); card.appendChild(det);
    mask.appendChild(card);
    (document.body || document.documentElement).appendChild(mask);
  }

  function handle(e, stage) {
    var msg = describe(e);
    log(stage || 'runtime', msg);
    if (!window.__autobookReady) panel(e, stage);
  }

  window.__autobookError = handle;
  window.addEventListener('error', function (ev) {
    // 資源載入失敗不會冒泡到這裡；會進來的是腳本錯誤（含 module 載入／語法錯誤）
    if (!ev || (!ev.error && !ev.message)) return;
    handle(ev.error || ev.message, 'error');
  });
  window.addEventListener('unhandledrejection', function (ev) {
    handle(ev && ev.reason, 'promise');
  });
})();
