// 字表頁：新增/多選刪除/入庫、統計、排序、熟悉度（紅綠）、一鍵補齊讀音
// 顯示字形跟隨語系（資料仍存輸入時的原字形）；熟悉度依帳號×語系分開
import { t, getLang } from './i18n.js';
import { el, toast, confirmDialog, openModal, infoDialog } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import {
  settings, words, addWords, removeWords, setArchived,
  getCard, cycleMark, idbGet, idbSet,
} from './store.js';
import { ttsChar } from './gemini.js';
import { convertTo, t2s, s2t } from './zhconv.js';

let root = null;
let editMode = false;
let selected = new Set();
let sortMode = 'new'; // new | least | most | weak

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
  else if (sortMode === 'most') list.sort((a, b) => b.usedCount - a.usedCount);
  else if (sortMode === 'weak') {
    // 最不熟：標紅在前（錯多優先），再來白字（錯多優先），學會的最後
    const rank = (w) => {
      const c = getCard(w);
      return c.mark === 'red' ? 0 : c.mark === null ? 1 : 2;
    };
    list.sort((a, b) => rank(a) - rank(b) || getCard(b).ng - getCard(a).ng || b.addedAt - a.addedAt);
  }
  // 入庫的一律排最後
  list.sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0));
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

  // ---- 統計（熟悉度依目前帳號×語系） ----
  const total = words.length;
  const unused = words.filter((w) => w.usedCount === 0).length;
  const learned = words.filter((w) => getCard(w).mark === 'green').length;
  const weak = words.filter((w) => getCard(w).mark === 'red').length;

  root.append(el('div', { class: 'stats-row' },
    statChip(total, `${t('words_total')}${t('words_total_u')}`),
    statChip(learned, t('words_learned')),
    statChip(weak, t('words_weak')),
    statChip(unused, t('words_unused')),
  ));

  if (!total) {
    root.append(el('div', { class: 'card story-empty' },
      el('span', { class: 'emoji', text: '🌱' }),
      el('p', { text: t('words_empty') }),
    ));
    return;
  }

  // ---- 排序 + 工具列 ----
  const seg = el('div', { class: 'seg' },
    segBtn('new', t('words_sort_new')),
    segBtn('weak', t('words_sort_weak')),
    segBtn('least', t('words_sort_least')),
    segBtn('most', t('words_sort_most')),
  );

  const fillBtn = el('button', { class: 'btn sky small', onclick: () => { sfx.tap(); fillAudio(); } },
    '🔊 ', t('words_fill_audio'));

  const editBtn = el('button', {
    class: `btn small ${editMode ? 'mint' : 'ghost'}`,
    onclick: () => { sfx.tap(); editMode = !editMode; selected.clear(); render(); },
  }, editMode ? `✅ ${t('words_edit_done')}` : `🧹 ${t('words_edit')}`);

  // 編輯模式：刪除選取 + 入庫/出庫
  const delBtn = el('button', { class: 'btn berry small' });
  const archBtn = el('button', { class: 'btn ghost small' });
  function refreshToolBtns() {
    delBtn.textContent = '';
    delBtn.append('🗑 ', t('words_del_multi', { n: selected.size }));
    delBtn.disabled = selected.size === 0;
    const allArchived = selected.size > 0 &&
      [...selected].every((ch) => words.find((w) => w.ch === ch)?.archived);
    archBtn.textContent = '';
    archBtn.append('📦 ', t(allArchived ? 'words_unarchive' : 'words_archive', { n: selected.size }));
    archBtn.disabled = selected.size === 0;
    archBtn.dataset.mode = allArchived ? 'un' : 'in';
  }
  refreshToolBtns();
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
      editMode ? archBtn : fillBtn,
      editMode ? delBtn : null,
      editBtn,
    ),
  ));
  root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;',
    text: editMode ? `👉 ${t('words_edit_hint')}` : `👉 ${t('words_mark_hint')}` }));

  // ---- 字格 ----
  const now = Date.now();
  const grid = el('div', { class: 'word-grid' });
  const chipByCh = new Map();

  function setSel(ch, on) {
    const chip = chipByCh.get(ch);
    if (!chip) return;
    if (on) selected.add(ch); else selected.delete(ch);
    chip.classList.toggle('sel', on);
    refreshToolBtns();
  }

  function markCls(w) {
    const m = getCard(w).mark;
    return m === 'green' ? ' mk-g' : m === 'red' ? ' mk-r' : '';
  }

  for (const w of sortedWords()) {
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
      // 點一下：輪換熟悉度（白→綠→紅→白）＋唸字（已快取才唸）
      chip.addEventListener('click', async () => {
        const mark = cycleMark(w.ch);
        chip.classList.remove('mk-g', 'mk-r', 'pop');
        if (mark === 'green') { chip.classList.add('mk-g'); sfx.correct(); }
        else if (mark === 'red') { chip.classList.add('mk-r'); sfx.unpop(); }
        else sfx.tap();
        void chip.offsetWidth;
        chip.classList.add('pop');
        let blob = await idbGet('audio', w.ch).catch(() => null);
        if (!blob) {
          const alt = getLang() === 'zh-Hans' ? t2s(w.ch) : s2t(w.ch);
          if (alt !== w.ch) blob = await idbGet('audio', alt).catch(() => null);
        }
        if (blob) playBlob(blob);
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

// ---------- 一鍵補齊讀音 ----------
async function fillAudio() {
  if (!settings.apiKey && !settings.ttsApiKey) { toast(t('api_missing'), true); return; }
  const missing = [];
  for (const w of words) {
    const hit = await idbGet('audio', w.ch).catch(() => null);
    if (!hit) missing.push(w.ch);
  }
  if (!missing.length) { toast(t('words_fill_none')); return; }

  const m = openModal('', { closable: false });
  const msg = el('p', { text: `${t('game_prep')} 0/${missing.length}` });
  const fill = el('div', { class: 'prep-fill' });
  m.body.append(el('div', { class: 'loading-scene' },
    el('span', { class: 'big-emoji', text: '🔊' }), msg,
    el('div', { class: 'prep-bar' }, fill),
  ));

  let done = 0, fail = 0, lastErr = null;
  for (const ch of missing) {
    try {
      const blob = await ttsChar(ch);
      await idbSet('audio', ch, blob);
    } catch (e) { fail++; lastErr = e; console.warn('tts failed', ch, e); }
    done++;
    msg.textContent = `${t('game_prep')} ${done}/${missing.length}`;
    fill.style.width = `${Math.round((done / missing.length) * 100)}%`;
  }
  m.close();
  if (fail === missing.length && lastErr) {
    infoDialog(t('err_title'), `${lastErr.message}${t('err_hint')}`, true);
    return;
  }
  toast(fail ? t('game_prep_fail') : t('prep_voice_done'), !!fail);
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
