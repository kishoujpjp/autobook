// 字表頁：新增/多選刪除/入庫、統計、排序、熟悉度（紅綠）、一鍵補齊讀音
// 顯示字形跟隨語系（資料仍存輸入時的原字形）；熟悉度依帳號×語系分開
import { t, getLang } from './i18n.js';
import { el, toast, confirmDialog } from './ui.js';
import { icon } from './icons.js';
import { showPage } from './nav.js';
import { sfx } from './sfx.js';
import {
  settings, saveSettings, words, addWords, removeWords, setArchived,
  getCard, cycleMark,
  accounts, currentAccount,
} from './store.js';
import { speakChar } from './voice.js';
import { convertTo, t2s, s2t } from './zhconv.js';
import { avatarEl } from './avatars.js';

let root = null;
let editMode = false;
let selected = new Set();
let sortMode = 'new'; // new | least | most | weak
let viewAccId = null; // 家長檢視的小孩帳號 id（null＝自己）

export function initWords(rootEl) {
  root = rootEl;
  render();
}

export function refreshWordsPage() {
  editMode = false;
  selected.clear();
  viewAccId = null;
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
  root.append(el('div', { class: 'row', style: 'margin-bottom:18px;' },
    el('button', { class: 'icon-btn', 'aria-label': t('parent_back_hub'), onclick: () => { sfx.tap(); showPage('parent'); } }, icon('back')),
    el('div', { class: 'h1', style: 'margin:0;' }, icon('cards'), t('words_title')),
  ));

  // 小孩模式：可以看字表，但固定鎖定——沒有新增/整理/補齊發音，點字只發音
  const kidMode = currentAccount().role === 'kid';
  if (kidMode) viewAccId = null;
  if (viewAccId && !accounts.some((a) => a.id === viewAccId)) viewAccId = null;
  const acc = viewAccId; // getCard/cycleMark 的帳號參數（null＝目前帳號）
  // 家長檢視小孩時不受鎖定影響（切過來就是要幫小孩改紅綠；鎖定是防小孩亂按自己的）
  const locked = kidMode || (!viewAccId && settings.wordsLocked);

  // ---- 新增區（小孩模式不顯示） ----
  if (!kidMode) {
    const input = el('textarea', { class: 'text-area', placeholder: t('words_add_ph') });
    const addBtn = el('button', { class: 'btn mint' }, icon('plus'), t('words_add'));
    addBtn.addEventListener('click', () => {
      sfx.tap();
      const { added, dup, collide } = addWords(input.value);
      if (added) {
        sfx.sparkle();
        let msg = t('words_added', { n: added });
        if (dup) msg += ' ' + t('words_dup', { n: dup });
        toast(msg);
        if (collide && collide.length) {
          toast(t('words_collide', { list: collide.join('、') }), true);
        }
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
  }

  // ---- 家長檢視小孩紀錄（有小孩帳號才顯示） ----
  const kids = accounts.filter((a) => a.role === 'kid');
  if (!kidMode && kids.length) {
    const row = el('div', { class: 'view-acct-row' });
    const mkView = (id, account, label) => {
      const b = el('button', { class: `view-acct${viewAccId === id ? ' on' : ''}` },
        avatarEl(account, 'avatar view-avatar'),
        el('span', { text: label }),
      );
      b.addEventListener('click', () => {
        sfx.tap();
        if (viewAccId === id) return;
        viewAccId = id;
        selected.clear();
        render();
      });
      return b;
    };
    row.append(mkView(null, currentAccount(), t('words_view_mine')));
    for (const k of kids) row.append(mkView(k.id, k, k.name));
    root.append(el('div', { class: 'card', style: 'padding:14px 16px;margin-bottom:14px;' },
      row,
      viewAccId
        ? el('p', { class: 'settings-note', style: 'margin-top:8px;',
            text: t('words_view_hint', { n: accounts.find((a) => a.id === viewAccId).name }) })
        : null,
    ));
  }

  // ---- 統計（熟悉度依檢視帳號×語系） ----
  const total = words.length;
  const unused = words.filter((w) => w.usedCount === 0).length;
  const learned = words.filter((w) => getCard(w, acc).mark === 'green').length;
  const weak = words.filter((w) => getCard(w, acc).mark === 'red').length;

  root.append(el('div', { class: 'stats-row' },
    statChip(total, `${t('words_total')}${t('words_total_u')}`),
    statChip(learned, t('words_learned')),
    statChip(weak, t('words_weak')),
    statChip(unused, t('words_unused')),
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
  const seg = el('div', { class: 'seg' },
    segBtn('new', t('words_sort_new')),
    segBtn('weak', t('words_sort_weak')),
    segBtn('least', t('words_sort_least')),
    segBtn('most', t('words_sort_most')),
  );

  if (kidMode) {
    editMode = false;
    root.append(el('div', { class: 'spread', style: 'margin-bottom:10px;' }, seg));
    root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;',
      text: t('words_kid_hint') }));
  } else {
    // 鎖定：點字只發音，不改紅綠（防小孩亂按）
    const lockBtn = el('button', {
      class: `btn small ${settings.wordsLocked ? 'berry' : 'ghost'}`,
      onclick: () => { sfx.tap(); settings.wordsLocked = !settings.wordsLocked; saveSettings(); render(); },
    }, settings.wordsLocked ? [icon('lock'), t('words_unlock')] : [icon('unlock'), t('words_lock')]);

    const editBtn = el('button', {
      class: `btn small ${editMode ? 'mint' : 'ghost'}`,
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

    root.append(el('div', { class: 'spread', style: 'margin-bottom:10px;' },
      seg,
      el('div', { class: 'row' },
        editMode ? archBtn : lockBtn,
        editMode ? delBtn : null,
        editBtn,
      ),
    ));
    root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;',
      text: editMode ? t('words_edit_hint')
        : settings.wordsLocked ? t('words_lock_hint') : t('words_mark_hint') }));
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
    if (toolRefresher) toolRefresher();
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
          chip.classList.remove('mk-g', 'mk-r', 'pop');
          if (mark === 'green') { chip.classList.add('mk-g'); sfx.correct(); }
          else if (mark === 'red') { chip.classList.add('mk-r'); sfx.unpop(); }
          else sfx.tap();
        }
        void chip.offsetWidth;
        chip.classList.add('pop');
        // AI 快取 → 音節庫 → 內建語音（手勢內同步決策）
        const alt = getLang() === 'zh-Hans' ? t2s(w.ch) : s2t(w.ch);
        speakChar(w.ch, [alt]);
      });
    } else {
      // 編輯模式：點按或滑過複選（在字卡上起手的拖曳不會捲動頁面）
      chip.style.touchAction = 'none';
    }
    grid.append(chip);
  }

  if (editMode) {
    let dragging = false;
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
