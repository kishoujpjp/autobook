// 家長頁（v1.26.0）：頭像旁的 🔒 入口，過家長門後進來。
// 小孩層（故事／遊戲／跟讀）不放任何刪改與生成入口，這些全部收在這裡：
// 新故事、字表管理、閱讀設定（目前這本）、跟讀題庫、帳號與設定。
import { t } from './i18n.js';
import { el } from './ui.js';
import { icon } from './icons.js';
import { sfx } from './sfx.js';
import { showPage } from './nav.js';
import { stories, words, repGroups, phrases, settings, isKid } from './store.js';
import { openGenModal, openReadSettingsCurrent, currentStoryId } from './story.js';
import { openBankModal } from './repeat.js';

let root = null;

export function initParent(rootEl) {
  root = rootEl;
}

export function refreshParentPage() { render(); }

function tile(iconName, label, desc, cls, onclick) {
  return el('button', { class: `ptile ${cls}`, onclick },
    el('span', { class: 'ptile-icon' }, icon(iconName)),
    el('span', { class: 'ptile-label', text: label }),
    desc ? el('span', { class: 'ptile-desc', text: desc }) : null,
  );
}

function render() {
  root.innerHTML = '';
  if (isKid()) { showPage('story'); return; } // 程式面也擋：小孩帳號進不來

  const hasStory = !!currentStoryId();
  root.append(
    el('div', { class: 'spread', style: 'margin-bottom:16px;' },
      el('div', { class: 'row' },
        el('button', { class: 'icon-btn', 'aria-label': t('parent_back'), onclick: () => { sfx.tap(); showPage('story'); } }, icon('back')),
        el('div', { class: 'h1', style: 'margin:0;' }, icon('lock'), t('parent_title')),
      ),
    ),
    el('p', { class: 'settings-note', style: 'margin:-6px 0 16px;', text: t('parent_note') }),
    el('div', { class: 'ptiles' },
      tile('sparkle', t('new_story'), t('parent_new_desc'), 'p-berry', () => { sfx.tap(); openGenModal(); }),
      tile('cards', t('words_title'), t('parent_words_desc', { n: words.length }), 'p-mint', () => { sfx.tap(); showPage('words'); }),
      hasStory
        ? tile('sliders', t('read_settings'), t('parent_read_desc'), 'p-sky', () => { sfx.tap(); openReadSettingsCurrent(); })
        : tile('folder', t('shelf_title'), t('parent_shelf_desc', { n: stories.length }), 'p-sky', () => { sfx.tap(); showPage('shelf'); }),
      tile('mic', t('rep_bank'), t('parent_bank_desc', { g: repGroups.length, n: phrases.length }), 'p-orange', () => { sfx.tap(); openBankModal(); }),
      tile('gear', t('settings_title'), t('parent_settings_desc'), 'p-ink', () => { sfx.tap(); showPage('settings'); }),
    ),
    el('p', { class: 'settings-note', style: 'margin-top:18px;', text: settings.parentPin ? t('parent_pin_on') : t('parent_pin_off') }),
  );
}
