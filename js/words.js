// 字表頁：新增/多選刪除/入庫、統計、排序、熟悉度（紅綠）、一鍵補齊讀音
// 顯示字形跟隨語系（資料仍存輸入時的原字形）；熟悉度依帳號×語系分開
import { t, getLang } from './i18n.js';
import { el, toast, confirmDialog, openModal } from './ui.js';
import { icon } from './icons.js';
import { createWordSearch } from './word-search-ui.js';
import { sfx } from './sfx.js';
import {
  settings, saveSettings, words, addWords, removeWords, setArchived,
  getCard, cycleMark,
  currentAccount, isHan,
} from './store.js';
import { manageKidRow } from './account.js';
import { speakChar } from './voice.js';
import { showPage } from './nav.js';
import { convertTo, audioKeysFor } from './zhconv.js';

let root = null;
let editMode = false;
let selected = new Set();
let searchQuery = '';
let sortMode = 'new'; // new | least | most | weak

export function initWords(rootEl) {
  root = rootEl;
  render();
}

export function refreshWordsPage() {
  searchQuery = '';
  editMode = false;
  selected.clear();
  render();
}

function sortedWords(acc) {
  const list = [...words];
  if (sortMode === 'new') list.sort((a, b) => b.addedAt - a.addedAt);
  else if (sortMode === 'least') list.sort((a, b) => a.usedCount - b.usedCount || b.addedAt - a.addedAt);
  else if (sortMode === 'most') list.sort((a, b) => b.usedCount - a.usedCount);
  else if (sortMode === 'weak') {
    // 最不熟：標紅在前（錯多優先），再來白字（錯多優先），學會的最後
    const rank = (w) => {
      const c = getCard(w, acc);
      return c.mark === 'red' ? 0 : c.mark === null ? 1 : 2;
    };
    list.sort((a, b) => rank(a) - rank(b) || getCard(b, acc).ng - getCard(a, acc).ng || b.addedAt - a.addedAt);
  }
  // 入庫的一律排最後
  list.sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
  return list;
}

function render() {
  root.innerHTML = '';
  root.classList.add('words-page');
  const kidMode = currentAccount().role === 'kid';
  if (kidMode) editMode = false;
  const acc = null;
  const locked = settings.wordsLocked;
  const backBtn = el('button', {
    class: 'icon-btn', 'aria-label': t(kidMode ? 'parent_back' : 'parent_back_hub'),
    onclick: () => { sfx.tap(); showPage(kidMode ? 'story' : 'parent'); },
  }, icon('back'));
  root.append(el('div', { class: 'words-heading' },
    el('div', { class: 'words-title-row' }, backBtn,
      el('span', { class: 'words-buddy', 'aria-hidden': 'true' }, icon('word-friend')),
      el('div', { class: 'words-title-copy' },
        el('div', { class: 'h1', text: t('words_title') }),
        el('p', { class: 'words-tagline', text: t('words_tagline') }),
      ),
    ),
    kidMode || editMode ? null : el('button', {
      class: 'btn berry words-add-btn', onclick: () => { sfx.tap(); openAddWords(); },
    }, icon('plus'), t('words_add_open')),
  ));

  // 帳號與統計是字表的背景資訊，保持精簡；主要操作集中在下面的字表區。
  const kidRow = manageKidRow(() => { selected.clear(); render(); });
  if (kidRow) root.append(el('div', { class: 'words-account' }, kidRow,
    el('p', { class: 'settings-note', text: t('words_account_note') }),
  ));

  // ---- 統計（熟悉度依檢視帳號×語系） ----
  // 統計數字點字改紅綠時要即時增減（以前只在整頁重畫時算一次，要換頁再回來才會更新）
  const total = words.length;
  const unused = words.filter((w) => w.usedCount === 0).length;
  const learnedChip = statChip(0, t('words_learned'), 'learned');
  const weakChip = statChip(0, t('words_weak'), 'weak');
  function refreshStats() {
    learnedChip.querySelector('.num').textContent = String(words.filter((w) => getCard(w, acc).mark === 'green').length);
    weakChip.querySelector('.num').textContent = String(words.filter((w) => getCard(w, acc).mark === 'red').length);
  }
  refreshStats();

  root.append(el('div', { class: 'stats-row' },
    statChip(total, t('words_all')),
    learnedChip,
    weakChip,
    statChip(unused, t('words_unused'), 'unused'),
  ));

  if (!total) {
    root.append(el('div', { class: 'card story-empty' },
      el('span', { class: 'emoji' }, icon('leaf')),
      el('p', { text: t('words_empty') }),
    ));
    return;
  }

  // ---- 排序 + 工具列（小孩模式只留排序） ----
  let toolRefresher = null; // 編輯模式工具鈕的刷新（選取數字），setSel 用
  const workspace = el('div', { class: 'words-workspace' });
  const toolbar = el('div', { class: 'words-toolbar' });
  const sort = el('select', { class: 'words-sort-select', 'aria-label': t('words_sort_label') });
  for (const [value, key] of [['new', 'words_sort_new'], ['weak', 'words_sort_weak'], ['least', 'words_sort_least'], ['most', 'words_sort_most']]) {
    sort.append(el('option', { value, text: t(key) }));
  }
  sort.value = sortMode;
  sort.addEventListener('change', () => { sfx.tap(); sortMode = sort.value; render(); });
  toolbar.append(el('label', { class: 'words-sort' }, t('words_sort_label'), sort));

  if (kidMode) {
    workspace.append(toolbar);
  } else {
    // 鎖定：點字只發音，不改紅綠（防小孩亂按）
    const lockBtn = el('button', {
      class: `btn small words-lock-btn ${settings.wordsLocked ? 'berry' : 'ghost'}`,
      'aria-pressed': String(settings.wordsLocked),
      onclick: () => { sfx.tap(); settings.wordsLocked = !settings.wordsLocked; saveSettings(); render(); },
    }, settings.wordsLocked ? [icon('lock'), t('words_unlock')] : [icon('unlock'), t('words_lock')]);

    const editBtn = el('button', {
      class: `btn small words-edit-btn ${editMode ? 'mint' : 'sky'}`,
      'aria-pressed': String(editMode),
      onclick: () => { sfx.tap(); editMode = !editMode; selected.clear(); render(); },
    }, editMode ? [icon('check'), t('words_edit_done')] : [icon('broom'), t('words_edit')]);

    // 編輯模式：刪除選取 + 入庫/出庫
    const delBtn = el('button', { class: 'btn danger small' });
    const archBtn = el('button', { class: 'btn ghost small' });
    function refreshToolBtns() {
      delBtn.textContent = '';
      delBtn.append(icon('trash'), t('words_del_multi', { n: selected.size }));
      delBtn.disabled = selected.size === 0;
      const allArchived = selected.size > 0 &&
        [...selected].every((ch) => words.find((w) => w.ch === ch)?.archived);
      archBtn.textContent = '';
      archBtn.append(icon('package'), t(allArchived ? 'words_unarchive' : 'words_archive', { n: selected.size }));
      archBtn.disabled = selected.size === 0;
      archBtn.dataset.mode = allArchived ? 'un' : 'in';
    }
    refreshToolBtns();
    toolRefresher = refreshToolBtns;
    delBtn.addEventListener('click', async () => {
      sfx.tap();
      const yes = await confirmDialog(t('words_del_multi_confirm', { n: selected.size }));
      if (yes) {
        removeWords([...selected]);
        selected.clear();
        render();
      }
    });
    archBtn.addEventListener('click', () => {
      sfx.tap();
      const un = archBtn.dataset.mode === 'un';
      setArchived([...selected], !un);
      toast(t(un ? 'words_unarchived_done' : 'words_archived_done', { n: selected.size }));
      selected.clear();
      render();
    });

    toolbar.append(el('div', { class: 'words-actions' },
      editMode ? archBtn : lockBtn,
      editMode ? delBtn : null,
      editBtn,
    ));
    workspace.append(toolbar);
  }
  workspace.append(el('p', { class: 'settings-note words-mode-hint',
    text: editMode ? t('words_edit_hint')
      : locked ? t('words_lock_hint') : t(kidMode ? 'words_kid_hint' : 'words_mark_help'),
  }));

  // ---- 字格 ----
  const now = Date.now();
  const grid = el('div', { class: 'word-grid' });
  const chipByCh = new Map();
  let search;
  let dragging = false;

  function setSel(ch, on) {
    const chip = chipByCh.get(ch);
    if (!chip) return;
    if (on) selected.add(ch); else selected.delete(ch);
    chip.classList.toggle('sel', on);
    if (toolRefresher) toolRefresher();
    search.refresh({ deferLayout: dragging });
  }

  function markCls(w) {
    const m = getCard(w, acc).mark;
    return m === 'green' ? ' mk-g' : m === 'red' ? ' mk-r' : '';
  }

  for (const w of sortedWords(acc)) {
    const fresh = !w.archived && now - w.addedAt < 48 * 3600 * 1000;
    const chip = el('button', {
      class: `word-chip${fresh ? ' fresh' : ''}${selected.has(w.ch) ? ' sel' : ''}${markCls(w)}${w.archived ? ' arch' : ''}`,
      'data-ch': w.ch,
    },
      el('span', { class: 'w', text: convertTo(w.ch, getLang()) }),
      el('span', { class: 'u', text: t('used_times', { n: w.usedCount }) }),
    );
    chipByCh.set(w.ch, chip);

    if (!editMode) {
      // 點一下：輪換熟悉度（白→綠→紅→白）＋唸字（AI 快取優先，缺檔用內建語音）
      // 鎖定或小孩模式：只發音，不改紅綠；檢視小孩時改的是該小孩的紀錄
      chip.addEventListener('click', () => {
        if (locked) {
          sfx.tap();
          chip.classList.remove('pop');
        } else {
          const mark = cycleMark(w.ch, acc);
          refreshStats();
          chip.classList.remove('mk-g', 'mk-r', 'pop');
          if (mark === 'green') { chip.classList.add('mk-g'); sfx.correct(); }
          else if (mark === 'red') { chip.classList.add('mk-r'); sfx.unpop(); }
          else sfx.tap();
        }
        void chip.offsetWidth;
        chip.classList.add('pop');
        // AI 快取 → 音節庫 → 內建語音（手勢內同步決策）
        speakChar(w.ch, audioKeysFor(w.ch).slice(1));
      });
    } else {
      // 編輯模式：點按或滑過複選（在字卡上起手的拖曳不會捲動頁面）
      chip.style.touchAction = 'none';
    }
    grid.append(chip);
  }

  search = createWordSearch({
    grid, entries: [...chipByCh].map(([ch, node]) => ({ ch, node })),
    getSelected: editMode ? () => selected : undefined, value: searchQuery,
    onQueryChange: (value) => { searchQuery = value; },
  });

  if (editMode) {
    let dragOn = true;

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
      if (chip && grid.contains(chip) && chip.dataset.ch) {
        const ch = chip.dataset.ch;
        if (selected.has(ch) !== dragOn) { sfx.tap(); setSel(ch, dragOn); }
      }
    });
    const stop = () => { dragging = false; search.refresh(); };
    grid.addEventListener('pointerup', stop);
    grid.addEventListener('pointercancel', stop);
    grid.addEventListener('pointerleave', stop);
  }

  workspace.prepend(search.root);
  workspace.append(grid);
  root.append(workspace);
}

function statChip(num, label, kind = 'total') {
  const symbol = { total: 'cards', learned: 'star', weak: 'heart', unused: 'leaf' }[kind];
  return el('div', { class: `stat-chip ${kind}` },
    el('span', { class: 'words-stat-icon', 'aria-hidden': 'true' }, icon(symbol)),
    el('div', { class: 'words-stat-copy' },
      el('div', { class: 'num', text: String(num) }),
      el('div', { class: 'lab', text: label }),
    ),
  );
}

/** 新增屬於偶爾的操作，按下時才展開，讓字表與搜尋常駐在畫面前方。 */
function openAddWords() {
  const m = openModal(t('words_add_open'), { icon: 'plus' });
  m.modal.classList.add('words-add-modal');
  const input = el('textarea', {
    class: 'text-area', placeholder: t('words_add_ph'), 'aria-label': t('words_add_open'),
  });
  const addBtn = el('button', { class: 'btn mint', disabled: '' }, icon('plus'), t('words_add'));
  input.addEventListener('input', () => { addBtn.disabled = ![...input.value].some(isHan); });
  addBtn.addEventListener('click', () => {
    sfx.tap();
    const { added, dup, collide } = addWords(input.value);
    if (added) {
      sfx.sparkle();
      let msg = t('words_added', { n: added });
      if (dup) msg += ' ' + t('words_dup', { n: dup });
      toast(msg);
      if (collide?.length) toast(t('words_collide', { list: collide.join('、') }), true);
      m.close();
      render();
    } else if (dup) toast(t('words_dup', { n: dup }), true);
  });
  m.body.append(input);
  m.foot.append(el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => { sfx.tap(); m.close(); } }), addBtn);
  input.focus();
}
