// 字表頁：新增/多選刪除字、統計、排序
// 顯示字形跟隨語系（資料仍存輸入時的原字形）
import { t, getLang } from './i18n.js';
import { el, toast, confirmDialog } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import { words, addWords, removeWords, idbGet } from './store.js';
import { convertTo, t2s, s2t } from './zhconv.js';

let root = null;
let editMode = false;
let selected = new Set();
let sortMode = 'new'; // new | least | most

export function initWords(rootEl) {
  root = rootEl;
  render();
}

export function refreshWordsPage() {
  editMode = false;
  selected.clear();
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

  // ---- 排序 + 編輯工具列 ----
  const seg = el('div', { class: 'seg' },
    segBtn('new', t('words_sort_new')),
    segBtn('least', t('words_sort_least')),
    segBtn('most', t('words_sort_most')),
  );

  const editBtn = el('button', {
    class: `btn small ${editMode ? 'mint' : 'ghost'}`,
    onclick: () => { sfx.tap(); editMode = !editMode; selected.clear(); render(); },
  }, editMode ? `✅ ${t('words_edit_done')}` : `🧹 ${t('words_edit')}`);

  const delBtn = el('button', { class: 'btn berry small' });
  function refreshDelBtn() {
    delBtn.textContent = '';
    delBtn.append('🗑 ', t('words_del_multi', { n: selected.size }));
    delBtn.disabled = selected.size === 0;
  }
  refreshDelBtn();
  delBtn.addEventListener('click', async () => {
    sfx.tap();
    const yes = await confirmDialog(t('words_del_multi_confirm', { n: selected.size }));
    if (yes) {
      removeWords([...selected]);
      selected.clear();
      render();
    }
  });

  root.append(el('div', { class: 'spread', style: 'margin-bottom:10px;' },
    seg,
    el('div', { class: 'row' }, editMode ? delBtn : null, editBtn),
  ));
  if (editMode) {
    root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;', text: `👉 ${t('words_edit_hint')}` }));
  }

  // ---- 字格 ----
  const now = Date.now();
  const grid = el('div', { class: 'word-grid' });
  const chipByCh = new Map();

  function setSel(ch, on) {
    const chip = chipByCh.get(ch);
    if (!chip) return;
    if (on) selected.add(ch); else selected.delete(ch);
    chip.classList.toggle('sel', on);
    refreshDelBtn();
  }

  for (const w of sortedWords()) {
    const fresh = now - w.addedAt < 48 * 3600 * 1000;
    const chip = el('button', {
      class: `word-chip${fresh ? ' fresh' : ''}${selected.has(w.ch) ? ' sel' : ''}`,
      'data-ch': w.ch,
    },
      el('span', { class: 'w', text: convertTo(w.ch, getLang()) }),
      el('span', { class: 'u', text: t('used_times', { n: w.usedCount }) }),
    );
    chipByCh.set(w.ch, chip);

    if (!editMode) {
      chip.addEventListener('click', async () => {
        chip.style.animation = 'none';
        void chip.offsetWidth;
        chip.style.animation = 'zipop 0.35s ease';
        // 語音快取可能存在任一字形底下
        let blob = await idbGet('audio', w.ch).catch(() => null);
        if (!blob) {
          const alt = getLang() === 'zh-Hans' ? t2s(w.ch) : s2t(w.ch);
          if (alt !== w.ch) blob = await idbGet('audio', alt).catch(() => null);
        }
        if (blob) playBlob(blob);
        else sfx.pop();
      });
    } else {
      // 編輯模式：點按或滑過複選（在字卡上起手的拖曳不會捲動頁面）
      chip.style.touchAction = 'none';
    }
    grid.append(chip);
  }

  if (editMode) {
    let dragging = false;
    let dragOn = true; // 這次拖曳是「選」還是「取消選」

    grid.addEventListener('pointerdown', (e) => {
      const chip = e.target.closest('.word-chip');
      if (!chip) return;
      e.preventDefault();
      dragging = true;
      const ch = chip.dataset.ch;
      dragOn = !selected.has(ch);
      sfx.tap();
      setSel(ch, dragOn);
      try { chip.releasePointerCapture(e.pointerId); } catch { /* 合成事件沒有有效 pointerId */ }
    });
    grid.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const elUnder = document.elementFromPoint(e.clientX, e.clientY);
      const chip = elUnder && elUnder.closest('.word-chip');
      if (chip && chip.dataset.ch) {
        const ch = chip.dataset.ch;
        if (selected.has(ch) !== dragOn) { sfx.tap(); setSel(ch, dragOn); }
      }
    });
    const stop = () => { dragging = false; };
    grid.addEventListener('pointerup', stop);
    grid.addEventListener('pointercancel', stop);
    grid.addEventListener('pointerleave', stop);
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
  b.addEventListener('click', () => { sfx.tap(); sortMode = mode; selected.clear(); render(); });
  return b;
}
