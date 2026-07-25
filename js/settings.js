// 設定頁：語系、API Key、模型、快取管理、版本
import { t, setLang, getLang } from './i18n.js';
import { el, toast, confirmDialog } from './ui.js';
import { sfx } from './sfx.js';
import {
  settings, saveSettings, clearAll, idbClear,
  addWords, DEMO_WORDS, VERSION,
} from './store.js';

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
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field-label', text: `🔑 ${t('set_api')}` }),
    keyInput,
    el('p', { class: 'settings-note', text: t('set_api_note') }),
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

  // ---- 版本 ----
  root.append(el('div', { class: 'card' },
    el('div', { class: 'settings-line' },
      el('span', { text: `📦 ${t('set_version')}` }),
      el('span', { style: 'color:var(--ink-soft);', text: `v${VERSION}` }),
    ),
  ));
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
