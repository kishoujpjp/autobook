// 設定頁：語系、API Key、模型、快取管理、版本
import { t, setLang, getLang } from './i18n.js';
import { el, toast, confirmDialog, infoDialog, openModal } from './ui.js';
import { sfx, b64ToBytes } from './sfx.js';
import { testConnection } from './gemini.js';
import {
  settings, saveSettings, clearAll, idbClear,
  addWords, DEMO_WORDS, VERSION,
  accounts, currentAccount,
  BACKUP_KEYS, idbKeys, idbGet, idbSet,
} from './store.js';
import { openAccountEditor } from './account.js';
import { avatarEl } from './avatars.js';

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
  root.append(el('div', { class: 'h1' }, '⚙️ ', t('settings_title')));

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
        class: 'btn ghost small',
        onclick: () => { sfx.tap(); openAccountEditor(a, render); },
      }, '✏️'),
    );
    accList.append(row);
  }
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', style: 'margin-top:0;', text: `👨‍👩‍👧 ${t('acc_title')}` }),
    accList,
    el('div', { class: 'row', style: 'margin-top:14px;' },
      el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); openAccountEditor(null, render); } },
        '➕ ', t('acc_add')),
    ),
    el('p', { class: 'settings-note', text: t('acc_note') }),
  ));

  // ---- 語系 ----
  const langSeg = el('div', { class: 'seg' },
    langBtn('zh-Hant', t('set_trad')),
    langBtn('zh-Hans', t('set_simp')),
  );
  root.append(el('div', { class: 'card' },
    el('div', { class: 'settings-line' },
      el('span', { text: `🌏 ${t('set_lang')}` }), langSeg,
    ),
    tapSpeakLine(),
  ));

  // ---- API Key ----
  const keyInput = el('input', {
    class: 'text-input', type: 'password',
    placeholder: t('set_api_ph'), value: settings.apiKey,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  keyInput.addEventListener('change', () => {
    settings.apiKey = keyInput.value.trim();
    saveSettings();
    toast('OK!');
  });
  const testBtn = el('button', { class: 'btn sky small' }, '📡 ', t('set_test'));
  testBtn.addEventListener('click', async () => {
    sfx.tap();
    settings.apiKey = keyInput.value.trim();
    saveSettings();
    if (!settings.apiKey) { toast(t('api_missing'), true); return; }
    testBtn.disabled = true;
    testBtn.textContent = t('test_running');
    try {
      await testConnection();
      sfx.sparkle();
      await infoDialog(t('test_ok_title'), t('test_ok'));
    } catch (e) {
      console.error('test connection failed', e);
      await infoDialog(t('err_title'), `${e.message}${t('err_hint')}`, true);
    }
    testBtn.disabled = false;
    testBtn.textContent = '';
    testBtn.append('📡 ', t('set_test'));
  });

  const ttsKeyInput = el('input', {
    class: 'text-input', type: 'password',
    placeholder: t('set_api_ph'), value: settings.ttsApiKey || '',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  ttsKeyInput.addEventListener('change', () => {
    settings.ttsApiKey = ttsKeyInput.value.trim();
    saveSettings();
    toast('OK!');
  });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', text: `🔑 ${t('set_api')}` }),
    keyInput,
    el('p', { class: 'settings-note', text: t('set_api_note') }),
    el('div', { class: 'row', style: 'margin-top:12px;' }, testBtn),
    el('div', { class: 'field-label', text: `🔊 ${t('set_tts_key')}` }),
    ttsKeyInput,
    advancedModels(),
  ));

  // ---- 快取與資料 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost small', onclick: async () => {
        sfx.tap();
        await idbClear('audio').catch(() => {});
        toast(t('set_cleared'));
      } }, '🔇 ', t('set_clear_audio')),
      el('button', { class: 'btn ghost small', onclick: () => {
        sfx.tap();
        const { added } = addWords(DEMO_WORDS);
        toast(added ? t('set_demo_loaded') : t('words_dup', { n: 0 }));
      } }, '🌱 ', t('set_demo_words')),
      el('button', { class: 'btn berry small', onclick: async () => {
        sfx.tap();
        const yes = await confirmDialog(t('set_clear_all_confirm'));
        if (yes) {
          await clearAll();
          location.reload();
        }
      } }, '🗑️ ', t('set_clear_all')),
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
    el('div', { class: 'field-label', style: 'margin-top:0;', text: `🗂 ${t('set_backup')}` }),
    el('div', { class: 'row' },
      el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); exportBackup(); } }, '📤 ', t('set_backup_export')),
      el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); fileInput.click(); } }, '📥 ', t('set_backup_import')),
    ),
    el('p', { class: 'settings-note', text: t('backup_note') }),
    fileInput,
  ));

  // ---- 版本 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'settings-line' },
      el('span', { text: `📦 ${t('set_version')}` }),
      el('span', { style: 'color:var(--ink-soft);', text: `v${VERSION}` }),
    ),
  ));
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

function progressModal(emoji, label) {
  const m = openModal('', { closable: false });
  const msg = el('p', { text: label });
  const fill = el('div', { class: 'prep-fill' });
  m.body.append(el('div', { class: 'loading-scene' },
    el('span', { class: 'big-emoji', text: emoji }), msg,
    el('div', { class: 'prep-bar' }, fill),
  ));
  return {
    close: m.close,
    step: (done, total) => {
      msg.textContent = `${label} ${done}/${total}`;
      fill.style.width = total ? `${Math.round((done / total) * 100)}%` : '100%';
    },
  };
}

async function exportBackup() {
  const pm = progressModal('📤', t('backup_preparing'));
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
    const m = openModal(`🗂 ${t('set_backup')}`);
    m.body.append(el('p', {
      style: 'font-size:22px;font-weight:700;padding:6px 2px;',
      text: t('backup_ready', { size: fmtSize(blob.size) }),
    }));
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
    } }, '💾 ', t('backup_share')));
  } catch (e) {
    pm.close();
    console.error(e);
    infoDialog(t('err_title'), String((e && e.message) || e), true);
  }
}

async function importBackupFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!data || data.app !== 'autobook' || !data.local) throw new Error('bad');
  } catch {
    toast(t('backup_bad'), true);
    return;
  }
  const yes = await confirmDialog(t('backup_import_confirm'));
  if (!yes) return;

  const pm = progressModal('📥', t('backup_importing'));
  try {
    // localStorage（保留這台裝置已填的金鑰）
    for (const [key, raw] of Object.entries(data.local)) {
      if (key === 'autobook.settings') {
        const incoming = JSON.parse(raw);
        incoming.apiKey = settings.apiKey || '';
        incoming.ttsApiKey = settings.ttsApiKey || '';
        localStorage.setItem(key, JSON.stringify(incoming));
      } else {
        localStorage.setItem(key, raw);
      }
    }
    // IndexedDB blob（整庫覆蓋）
    let total = 0, done = 0;
    for (const st of IDB_STORES) total += Object.keys((data.idb || {})[st] || {}).length;
    for (const st of IDB_STORES) {
      await idbClear(st).catch(() => {});
      for (const [k, v] of Object.entries((data.idb || {})[st] || {})) {
        const bytes = b64ToBytes(v.b64 || '');
        await idbSet(st, k, new Blob([bytes], { type: v.mime || '' }));
        done++;
        pm.step(done, total);
      }
    }
    location.reload();
  } catch (e) {
    pm.close();
    console.error(e);
    infoDialog(t('err_title'), String((e && e.message) || e), true);
  }
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
  const sw = el('button', { class: `switch${settings.tapSpeak ? ' on' : ''}` });
  sw.addEventListener('click', () => {
    sfx.tap();
    settings.tapSpeak = !settings.tapSpeak;
    saveSettings();
    sw.classList.toggle('on', settings.tapSpeak);
  });
  return el('div', { class: 'settings-line' },
    el('span', { text: `🗣️ ${t('set_tap_speak')}` }), sw,
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
