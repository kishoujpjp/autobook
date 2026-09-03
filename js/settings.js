// 設定頁：語系、API Key、模型、快取管理、版本
import { t, setLang, getLang } from './i18n.js';
import { el, toast, confirmDialog, infoDialog, openModal, switchEl } from './ui.js';
import { icon } from './icons.js';
import { showPage } from './nav.js';
import { waitScene } from './wait.js';
import { sfx, b64ToBytes, speakNative } from './sfx.js';
import { testModels, errHintKey, readErrLog, clearErrLog } from './gemini.js';
import {
  settings, saveSettings, clearAll, idbClear,
  addWords, DEMO_WORDS, VERSION,
  accounts, currentAccount,
  BACKUP_KEYS, idbKeys, idbGet, idbSet,
  flushSaves, cancelPendingSaves,
} from './store.js';
import { openAccountEditor, openPinSetup, clearPin } from './account.js';
import { avatarEl } from './avatars.js';
import { allSyllables } from './readings.js';

const SYL_CACHE = 'autobook-syl-1'; // 與 sw.js 一致：音節音檔的持久快取
/** Capacitor 原生殼：沒有 Service Worker，音節庫直接讀 app 內的檔案，「下載全部發音」沒有意義 */
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

let root = null;
let onLangChange = null;

export function initSettings(rootEl, langChangeCb) {
  root = rootEl;
  onLangChange = langChangeCb;
  render();
}

export function refreshSettingsPage() { render(); }

function render() {
  root.innerHTML = '';
  root.append(el('div', { class: 'row', style: 'margin-bottom:18px;' },
    el('button', { class: 'icon-btn', 'aria-label': t('parent_back_hub'), onclick: () => { sfx.tap(); showPage('parent'); } }, icon('back')),
    el('div', { class: 'h1', style: 'margin:0;' }, icon('gear'), t('settings_title')),
  ));

  // ---- 帳號 ----
  const accList = el('div', {});
  for (const a of accounts) {
    const row = el('div', { class: 'acct-row' },
      avatarEl(a, 'avatar acct-avatar'),
      el('span', { style: 'font-size:22px;font-weight:800;flex:1;', text: a.name }),
      a.id === currentAccount().id
        ? el('span', { class: 'role-chip now', text: t('acc_current') })
        : null,
      el('span', { class: `role-chip${a.role === 'kid' ? ' kid' : ''}`, text: t(a.role === 'kid' ? 'acc_kid' : 'acc_parent') }),
      el('button', {
        class: 'btn ghost small', 'aria-label': t('acc_edit'),
        onclick: () => { sfx.tap(); openAccountEditor(a, render); },
      }, icon('edit')),
    );
    accList.append(row);
  }
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', style: 'margin-top:0;' }, icon('users'), t('acc_title')),
    accList,
    el('div', { class: 'row', style: 'margin-top:14px;' },
      el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); openAccountEditor(null, render); } },
        icon('plus'), t('acc_add')),
    ),
    parentGateLine(),
    pinLine(),
    el('p', { class: 'settings-note', text: t('pin_note') }),
    el('p', { class: 'settings-note', text: t('acc_note') }),
  ));

  // ---- 語系 ----
  const langSeg = el('div', { class: 'seg' },
    langBtn('zh-Hant', t('set_trad')),
    langBtn('zh-Hans', t('set_simp')),
  );
  root.append(el('div', { class: 'card' },
    el('div', { class: 'settings-line' },
      el('span', {}, icon('globe'), t('set_lang')), langSeg,
    ),
    tapSpeakLine(),
    themeLine(),
  ));

  // ---- API Key ----
  const keyInput = el('input', {
    class: 'text-input', type: 'password',
    placeholder: t('set_api_ph'), value: settings.apiKey,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  // 第一次填 Key：先看過隱私說明（字表、故事、語音會送到 Google）才存
  async function commitKey() {
    const v = keyInput.value.trim();
    if (v && !settings.privacyAck) {
      const ok = await privacyConsent();
      if (!ok) { keyInput.value = settings.apiKey || ''; return false; }
    }
    settings.apiKey = v;
    saveSettings();
    return true;
  }
  keyInput.addEventListener('change', async () => {
    if (await commitKey()) toast(t('saved'));
  });
  const testBtn = el('button', { class: 'btn sky small' }, icon('radio'), t('set_test'));
  testBtn.addEventListener('click', async () => {
    sfx.tap();
    if (!(await commitKey())) return;
    if (!settings.apiKey) { toast(t('api_missing'), true); return; }
    runDiagnostics();
  });

  const errlogBtn = el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); openErrLog(); } },
    icon('clipboard'), t('errlog_title'));

  const ttsKeyInput = el('input', {
    class: 'text-input', type: 'password',
    placeholder: t('set_api_ph'), value: settings.ttsApiKey || '',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  ttsKeyInput.addEventListener('change', () => {
    settings.ttsApiKey = ttsKeyInput.value.trim();
    saveSettings();
    toast(t('saved'));
  });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label' }, icon('key'), t('set_api')),
    keyInput,
    el('p', { class: 'settings-note', text: t('set_api_note') }),
    el('div', { class: 'row', style: 'margin-top:12px;' }, testBtn, errlogBtn),
    el('div', { class: 'field-label' }, icon('speaker'), t('set_tts_key')),
    ttsKeyInput,
    advancedModels(),
  ));

  // ---- 快取與資料 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost small', onclick: async () => {
        sfx.tap();
        if (!(await confirmDialog(t('set_clear_audio_confirm')))) return;
        await idbClear('audio').catch(() => {});
        toast(t('set_cleared'));
      } }, icon('mute'), t('set_clear_audio')),
      el('button', { class: 'btn ghost small', onclick: () => {
        // 同步呼叫（不先 await）：這正是要驗證的 iOS 手勢限制
        const ok = speakNative(t('native_test_text'));
        const n = ('speechSynthesis' in window) ? speechSynthesis.getVoices().length : -1;
        toast(ok ? t('native_test_sent', { n }) : t('native_test_unavail'), !ok);
      } }, icon('chat'), t('native_test')),
      isNativeApp() ? null : el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); downloadAllSyllables(); } },
        icon('download'), t('set_dl_syl')),
      el('button', { class: 'btn ghost small', onclick: async () => {
        sfx.tap();
        if (!(await confirmDialog(t('set_demo_confirm', { n: DEMO_WORDS.length })))) return;
        const { added } = addWords(DEMO_WORDS);
        toast(added ? t('set_demo_loaded') : t('words_dup', { n: 0 }));
      } }, icon('leaf'), t('set_demo_words')),
    ),
    el('div', { class: 'danger-row' },
      el('button', { class: 'btn danger small', onclick: async () => {
        sfx.tap();
        const yes = await confirmDialog(t('set_clear_all_confirm'));
        if (yes) {
          await clearAll();
          location.reload();
        }
      } }, icon('trash'), t('set_clear_all')),
    ),
  ));

  // ---- 完整備份 ----
  const fileInput = el('input', {
    type: 'file', accept: '.json,application/json',
    id: 'backup-file-input', style: 'display:none;',
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) importBackupFile(fileInput.files[0]);
    fileInput.value = '';
  });
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', style: 'margin-top:0;' }, icon('package'), t('set_backup')),
    el('div', { class: 'row' },
      el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); exportBackup(); } }, icon('upload'), t('set_backup_export')),
      el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); fileInput.click(); } }, icon('download'), t('set_backup_import')),
    ),
    el('p', { class: 'settings-note', text: t('backup_note') }),
    fileInput,
  ));

  // ---- 隱私說明 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', style: 'margin-top:0;' }, icon('lock'), t('privacy_title')),
    ...privacyParagraphs(),
    el('p', { class: 'settings-note', style: 'font-size:15px;margin-top:12px;', text: t('kai_credit') }),
  ));

  // ---- 版本 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'settings-line' },
      el('span', {}, icon('info'), t('set_version')),
      el('span', { style: 'color:var(--ink-2);', text: `v${VERSION}` }),
    ),
  ));
}

// ============ 連線診斷與錯誤紀錄 ============
/** 逐項測試：文字／JSON 結構輸出／插圖／語音，即時顯示 ✅❌ 與失敗原因＋對策 */
async function runDiagnostics() {
  const m = openModal(t('diag_title'), { icon: 'stethoscope' });
  const rows = new Map();
  for (const key of ['diag_text', 'diag_json', 'diag_image', 'diag_tts']) {
    const status = el('span', { class: 'diag-status', text: '…' });
    const note = el('div', { class: 'diag-note' });
    m.body.append(
      el('div', { class: 'diag-row' }, el('span', { class: 'diag-name', text: t(key) }), status),
      note,
    );
    rows.set(key, { status, note });
  }
  const summary = el('p', { class: 'settings-note', text: t('diag_running') });
  m.body.append(summary);

  const results = await testModels((key, state) => {
    const r = rows.get(key);
    if (!r) return;
    if (state === 'run') { r.status.replaceChildren(icon('clock')); r.status.classList.remove('ok', 'bad'); return; }
    r.status.replaceChildren(icon(state.ok ? 'check' : 'cross'));
    r.status.classList.toggle('ok', !!state.ok);
    r.status.classList.toggle('bad', !state.ok);
    if (!state.ok) {
      const hint = errHintKey(state.msg);
      r.note.textContent = state.msg + (hint ? `\n→ ${t(hint)}` : '');
    }
  });

  const bad = results.filter((r) => !r.ok);
  summary.textContent = bad.length ? t('diag_some_fail', { n: bad.length }) : t('diag_all_ok');
  if (!bad.length) sfx.sparkle();
}

/** 最近 30 筆 API 錯誤（時間｜階段｜模型｜訊息），可複製回報 */
function openErrLog() {
  const m = openModal(t('errlog_title'), { icon: 'clipboard' });
  const log = readErrLog();
  if (!log.length) {
    m.body.append(el('p', { class: 'settings-note', text: t('errlog_empty') }));
    return;
  }
  const stageNames = { story: t('errlog_st_story'), image: t('errlog_st_image'), tts: t('errlog_st_tts'), poly: t('errlog_st_poly'), test: t('errlog_st_test'), phrase: t('errlog_st_phrase'), api: 'API' };
  for (const e of log) {
    m.body.append(el('div', { class: 'errlog-row' },
      el('div', { class: 'errlog-meta', text: `${new Date(e.t).toLocaleString()}｜${stageNames[e.stage] || e.stage}｜${e.model}` }),
      el('div', { class: 'errlog-msg', text: e.msg }),
    ));
  }
  m.foot.append(
    el('button', { class: 'btn ghost small', onclick: async () => {
      sfx.tap();
      const text = log.map((e) => `${new Date(e.t).toISOString()} [${e.stage}] ${e.model}: ${e.msg}`).join('\n');
      try { await navigator.clipboard.writeText(text); toast(t('errlog_copied')); }
      catch { toast(t('copy_fail'), true); }
    } }, icon('copy'), t('errlog_copy')),
    el('button', { class: 'btn berry small', onclick: () => { sfx.tap(); clearErrLog(); m.close(); toast(t('set_cleared')); } },
      icon('trash'), t('errlog_clear')),
  );
}

// ============ 音節發音離線包 ============
/** 把全部音節 mp3 抓進持久快取（App 更新不會清掉）；已抓過的跳過，可中斷後續按 */
async function downloadAllSyllables() {
  if (!('caches' in window)) { toast(t('syl_dl_unavail'), true); return; }
  const syls = allSyllables();
  const cache = await caches.open(SYL_CACHE);
  const existing = new Set((await cache.keys()).map((r) => new URL(r.url).pathname.split('/').pop()));
  const missing = syls.filter((s) => !existing.has(`${s}.mp3`));
  if (!missing.length) { toast(t('syl_dl_done')); return; }

  let stopped = false;
  const pm = progressModal('download', t('syl_dl_ing'), () => { stopped = true; });
  let done = 0, fail = 0;
  const BATCH = 10;
  for (let i = 0; i < missing.length; i += BATCH) {
    if (stopped) break; // 已抓的留在快取，下次按繼續抓
    await Promise.all(missing.slice(i, i + BATCH).map((s) =>
      cache.add(`syl/${s}.mp3`).catch(() => { fail++; })));
    done = Math.min(missing.length, i + BATCH);
    pm.step(done, missing.length);
  }
  pm.close();
  if (stopped) { toast(t('gen_cancelled')); return; }
  toast(fail ? t('syl_dl_partial', { n: fail }) : t('syl_dl_done'), !!fail);
}

// ============ 完整備份（含 AI 生成的圖片與語音快取） ============
const IDB_STORES = ['images', 'audio', 'avatars'];

function fmtSize(bytes) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

/** 進度視窗：走共用等待場景（角色＋進度條＋停止） */
function progressModal(iconName, label, onStop = null) {
  const w = waitScene({ steps: [label, t('wait_done')], iconName, progress: true, onStop });
  return {
    close: w.close,
    step: (done, total) => {
      w.setMsg(`${label} ${done}/${total}`);
      w.setProgress(total ? done / total : 1);
    },
  };
}

async function exportBackup() {
  flushSaves(); // 延遲中的寫入先落盤，備份才是最新資料
  const pm = progressModal('upload', t('backup_preparing'));
  try {
    const data = {
      app: 'autobook', appVersion: VERSION,
      exportedAt: new Date().toISOString(),
      local: {}, idb: {},
    };
    for (const key of BACKUP_KEYS) {
      let raw = localStorage.getItem(key);
      if (raw == null) continue;
      if (key === 'autobook.settings') {
        // 金鑰不進備份檔（可能經手雲端/AirDrop）
        const s = JSON.parse(raw);
        delete s.apiKey;
        delete s.ttsApiKey;
        raw = JSON.stringify(s);
      }
      data.local[key] = raw;
    }
    const keysByStore = {};
    let total = 0, done = 0;
    for (const st of IDB_STORES) {
      keysByStore[st] = await idbKeys(st).catch(() => []);
      total += keysByStore[st].length;
    }
    for (const st of IDB_STORES) {
      data.idb[st] = {};
      for (const k of keysByStore[st]) {
        const blob = await idbGet(st, k).catch(() => null);
        if (blob) data.idb[st][k] = { mime: blob.type || '', b64: await blobToB64(blob) };
        done++;
        pm.step(done, total);
      }
    }
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const filename = `autobook-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    pm.close();

    // 分享/下載必須在點按手勢中呼叫（iOS 限制），所以先出「準備好了」視窗
    const m = openModal(t('set_backup'), { icon: 'package' });
    m.body.append(
      el('p', {
        style: 'font-size:22px;font-weight:700;padding:6px 2px;',
        text: t('backup_ready', { size: fmtSize(blob.size) }),
      }),
      el('p', { class: 'settings-note', text: t('backup_ready_note') }), // 內含小孩照片與紀錄，提醒自己保管
    );
    m.foot.append(el('button', { class: 'btn mint', onclick: async () => {
      sfx.tap();
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); } catch { /* 使用者取消分享 */ }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      }
    } }, icon('save'), t('backup_share')));
  } catch (e) {
    pm.close();
    console.error(e);
    infoDialog(t('err_title'), String((e && e.message) || e), true);
  }
}

const BACKUP_MAX_MB = 400;      // 整個備份檔（要整包讀進記憶體＋解碼，再大 iPad 會被系統殺掉）
const BLOB_MAX_MB = 80;         // 單一圖片／影片
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 匯入備份。原則：先把整包「解析＋驗證＋解碼」完成、確認沒問題，才動到裝置上的資料；
 * 寫入階段若失敗，localStorage 回復到匯入前（IndexedDB 盡力回復）。
 * 以前是邊驗證邊覆蓋，壞檔會留下「localStorage 換了、IndexedDB 清一半、記憶體還是舊的」三方不一致。
 */
async function importBackupFile(file) {
  if (file.size > BACKUP_MAX_MB * 1048576) { toast(t('backup_too_big', { n: BACKUP_MAX_MB }), true); return; }
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!isObj(data) || data.app !== 'autobook' || !isObj(data.local)) throw new Error('bad');
  } catch {
    toast(t('backup_bad'), true);
    return;
  }

  // ---- 1. localStorage：只收白名單鍵，逐鍵驗證 JSON 與型別 ----
  const local = {};
  const keyOk = {
    'autobook.settings': isObj, 'autobook.accounts': Array.isArray, 'autobook.words': Array.isArray, 'autobook.wordsBy': isObj,
    'autobook.stories': Array.isArray, 'autobook.phrases': Array.isArray, 'autobook.repGroups': Array.isArray,
    'autobook.currentAccount': (v) => typeof v === 'string',
  };
  for (const key of BACKUP_KEYS) {
    const raw = data.local[key];
    if (raw == null) continue;
    if (typeof raw !== 'string') { toast(t('backup_bad'), true); return; }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { toast(t('backup_bad'), true); return; }
    const ok = keyOk[key] || (() => true);
    if (!ok(parsed)) { toast(t('backup_bad'), true); return; }
    if (key === 'autobook.settings') {
      // 保留這台裝置已填的金鑰（備份檔本來就不含）
      parsed.apiKey = settings.apiKey || '';
      parsed.ttsApiKey = settings.ttsApiKey || '';
      local[key] = JSON.stringify(parsed);
    } else {
      local[key] = raw;
    }
  }
  if (!local['autobook.words'] && !local['autobook.stories'] && !local['autobook.accounts']) {
    toast(t('backup_bad'), true);
    return;
  }

  // ---- 2. IndexedDB：全部先解碼成 Blob（壞 base64、超大檔在這裡就擋下，還沒動到資料）----
  const blobs = []; // { store, key, blob }
  const idb = isObj(data.idb) ? data.idb : {};
  for (const st of IDB_STORES) {
    if (!isObj(idb[st])) continue;
    for (const [k, v] of Object.entries(idb[st])) {
      if (!isObj(v) || typeof v.b64 !== 'string') continue;
      let bytes;
      try { bytes = b64ToBytes(v.b64); } catch { toast(t('backup_bad'), true); return; }
      if (bytes.length > BLOB_MAX_MB * 1048576) { toast(t('backup_blob_big', { n: BLOB_MAX_MB, k }), true); return; }
      blobs.push({ store: st, key: k, blob: new Blob([bytes], { type: typeof v.mime === 'string' ? v.mime : '' }) });
    }
  }

  const yes = await confirmDialog(t('backup_import_confirm'));
  if (!yes) return;

  // ---- 3. 寫入：先記下舊值以便回復 ----
  const pm = progressModal('download', t('backup_importing'));
  const prev = {};
  for (const key of BACKUP_KEYS) prev[key] = localStorage.getItem(key);
  const rollback = () => {
    for (const [key, raw] of Object.entries(prev)) {
      try { if (raw == null) localStorage.removeItem(key); else localStorage.setItem(key, raw); } catch { /* ignore */ }
    }
  };
  try {
    cancelPendingSaves(); // 不讓延遲寫入在 reload 前把舊資料蓋回匯入的內容
    for (const key of BACKUP_KEYS) {
      if (local[key] != null) localStorage.setItem(key, local[key]);
      else localStorage.removeItem(key);
      localStorage.removeItem(`${key}.bad`);
    }
    for (const st of IDB_STORES) await idbClear(st).catch(() => {});
    let done = 0;
    for (const b of blobs) {
      await idbSet(b.store, b.key, b.blob);
      done++;
      pm.step(done, blobs.length);
    }
    await new Promise((r) => setTimeout(r, 150)); // 讓最後一筆 IndexedDB 交易確實 commit 再 reload
    location.reload();
  } catch (e) {
    rollback();
    pm.close();
    console.error(e);
    infoDialog(t('err_title'), t('backup_import_fail', { msg: String((e && e.message) || e) }), true);
  }
}

// ============ 家長 PIN／隱私說明 ============
function pinLine() {
  const has = !!settings.parentPin;
  return el('div', { class: 'settings-line', style: 'margin-top:12px;' },
    el('span', {}, icon('keypad'), t(has ? 'pin_status_on' : 'pin_status_off')),
    el('div', { class: 'row' },
      el('button', { class: 'btn sky small', onclick: async () => { sfx.tap(); if (await openPinSetup()) render(); } },
        icon('keypad'), t(has ? 'pin_change' : 'pin_set')),
      has ? el('button', { class: 'btn ghost small', onclick: async () => {
        sfx.tap();
        if (!(await confirmDialog(t('pin_clear_confirm')))) return;
        clearPin();
        render();
      } }, icon('broom'), t('pin_clear')) : null,
    ),
  );
}

function privacyParagraphs() {
  return ['privacy_p1', 'privacy_p2', 'privacy_p3', 'privacy_p4'].map((k) =>
    el('p', { class: 'settings-note', style: 'font-size:17px;line-height:1.6;margin-top:8px;', text: t(k) }));
}

/** 第一次填 API Key 前的隱私確認；按「我知道了」才存 Key */
function privacyConsent() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal(t('privacy_consent_title'), { icon: 'lock', onClose: () => done(false) });
    m.body.append(...privacyParagraphs());
    m.foot.append(
      el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => { sfx.tap(); done(false); m.close(); } }),
      el('button', { class: 'btn mint', text: t('privacy_ack'), onclick: () => {
        sfx.tap();
        settings.privacyAck = true;
        saveSettings();
        done(true);
        m.close();
      } }),
    );
  });
}

function langBtn(lang, label) {
  const b = el('button', { class: getLang() === lang ? 'on' : '', text: label });
  b.addEventListener('click', () => {
    sfx.tap();
    settings.lang = lang;
    saveSettings();
    setLang(lang);
    if (onLangChange) onLangChange();
    render();
  });
  return b;
}

function tapSpeakLine() {
  const sw = switchEl(settings.tapSpeak, (on) => {
    sfx.tap();
    settings.tapSpeak = on;
    saveSettings();
  }, t('set_tap_speak'));
  return el('div', {},
    el('div', { class: 'settings-line', style: 'border-bottom:0;padding-bottom:4px;' },
      el('span', {}, icon('speaker'), t('set_tap_speak')), sw,
    ),
    el('p', { class: 'settings-note', style: 'margin:0 0 10px;', text: t('set_tap_speak_note') }),
  );
}

/** 夜間模式：寫 settings.theme，立刻套到 <html data-theme> 與狀態列色 */
export function applyTheme() {
  const dark = settings.theme === 'dark';
  if (dark) document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#2A2119' : '#FFF7EA');
}

function themeLine() {
  const sw = switchEl(settings.theme === 'dark', (on) => {
    sfx.tap();
    settings.theme = on ? 'dark' : 'light';
    saveSettings();
    applyTheme();
  }, t('set_theme_dark'));
  return el('div', { class: 'settings-line' },
    el('span', {}, icon('moon'), t('set_theme_dark')), sw,
  );
}

function parentGateLine() {
  const sw = switchEl(settings.parentGateOn, (on) => {
    sfx.tap();
    settings.parentGateOn = on;
    saveSettings();
  }, t('set_parent_gate'));
  return el('div', { class: 'settings-line', style: 'margin-top:12px;' },
    el('span', {}, icon('lock'), t('set_parent_gate')), sw,
  );
}

function advancedModels() {
  const mk = (labelKey, prop) => {
    const input = el('input', { class: 'text-input', value: settings[prop], autocapitalize: 'off', spellcheck: 'false' });
    input.addEventListener('change', () => { settings[prop] = input.value.trim(); saveSettings(); });
    return el('div', {},
      el('div', { class: 'field-label', text: t(labelKey) }),
      input,
    );
  };
  return el('details', { class: 'adv' },
    el('summary', { text: t('set_models') }),
    mk('set_model_text', 'textModel'),
    mk('set_model_image', 'imageModel'),
    mk('set_model_tts', 'ttsModel'),
    mk('set_voice', 'voice'),
  );
}
