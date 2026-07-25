// 字表頁：新增/刪除字、統計、排序
import { t } from './i18n.js';
import { el, toast, confirmDialog } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import { words, addWords, removeWord, idbGet } from './store.js';

let root = null;
let editMode = false;
let sortMode = 'new'; // new | least | most

export function initWords(rootEl) {
  root = rootEl;
  render();
}

export function refreshWordsPage() {
  editMode = false;
  render();
}

function sortedWords() {
  const list = [...words];
  if (sortMode === 'new') list.sort((a, b) => b.addedAt - a.addedAt);
  else if (sortMode === 'least') list.sort((a, b) => a.usedCount - b.usedCount || b.addedAt - a.addedAt);
  else list.sort((a, b) => b.usedCount - a.usedCount);
  return list;
}

function render() {
  root.innerHTML = '';
  root.append(el('div', { class: 'h1' }, '🗂️ ', t('words_title')));

  // ---- 新增區 ----
  const input = el('textarea', { class: 'text-area', placeholder: t('words_add_ph') });
  const addBtn = el('button', { class: 'btn mint' }, '➕ ', t('words_add'));
  addBtn.addEventListener('click', () => {
    sfx.tap();
    const { added, dup } = addWords(input.value);
    if (added) {
      sfx.sparkle();
      let msg = t('words_added', { n: added });
      if (dup) msg += ' ' + t('words_dup', { n: dup });
      toast(msg);
      input.value = '';
      render();
    } else if (dup) {
      toast(t('words_dup', { n: dup }), true);
    }
  });
  root.append(el('div', { class: 'card' },
    input,
    el('div', { class: 'row', style: 'margin-top:14px;justify-content:flex-end;' }, addBtn),
  ));

  // ---- 統計 ----
  const total = words.length;
  const unused = words.filter((w) => w.usedCount === 0).length;
  const read = words.filter((w) => (w.readCount || 0) > 0).length;
  const hard = words.filter((w) => w.ng > w.ok && w.ng > 0).length;

  root.append(el('div', { class: 'stats-row' },
    statChip(total, `${t('words_total')}${t('words_total_u')}`),
    statChip(read, t('words_read')),
    statChip(unused, t('words_unused')),
    statChip(hard, t('words_hard')),
  ));

  if (!total) {
    root.append(el('div', { class: 'card story-empty' },
      el('span', { class: 'emoji', text: '🌱' }),
      el('p', { text: t('words_empty') }),
    ));
    return;
  }

  // ---- 排序 + 編輯 ----
  const seg = el('div', { class: 'seg' },
    segBtn('new', t('words_sort_new')),
    segBtn('least', t('words_sort_least')),
    segBtn('most', t('words_sort_most')),
  );
  const editBtn = el('button', {
    class: `btn small ${editMode ? 'berry' : 'ghost'}`,
    onclick: () => { sfx.tap(); editMode = !editMode; render(); },
  }, editMode ? `✅ ${t('words_edit_done')}` : `🧹 ${t('words_edit')}`);

  root.append(el('div', { class: 'spread', style: 'margin-bottom:16px;' }, seg, editBtn));

  // ---- 字格 ----
  const now = Date.now();
  const grid = el('div', { class: 'word-grid' });
  for (const w of sortedWords()) {
    const fresh = now - w.addedAt < 48 * 3600 * 1000;
    const chip = el('button', { class: `word-chip${fresh ? ' fresh' : ''}` },
      el('span', { class: 'w', text: w.ch }),
      el('span', { class: 'u', text: t('used_times', { n: w.usedCount }) }),
    );
    if (editMode) {
      chip.append(el('span', { class: 'del', text: '✕' }));
      chip.addEventListener('click', async () => {
        sfx.tap();
        const yes = await confirmDialog(t('words_del_confirm', { w: w.ch }));
        if (yes) { removeWord(w.ch); render(); }
      });
    } else {
      chip.addEventListener('click', async () => {
        chip.classList.remove('pop');
        void chip.offsetWidth;
        chip.style.animation = 'zipop 0.35s ease';
        setTimeout(() => { chip.style.animation = ''; }, 400);
        const blob = await idbGet('audio', w.ch).catch(() => null);
        if (blob) playBlob(blob);
        else sfx.pop();
      });
    }
    grid.append(chip);
  }
  root.append(grid);
}

function statChip(num, label) {
  return el('div', { class: 'stat-chip' },
    el('div', { class: 'num', text: String(num) }),
    el('div', { class: 'lab', text: label }),
  );
}

function segBtn(mode, label) {
  const b = el('button', { class: sortMode === mode ? 'on' : '', text: label });
  b.addEventListener('click', () => { sfx.tap(); sortMode = mode; render(); });
  return b;
}
