// 遊戲頁：聽音認字。開始前先把 10 題語音緩存好，之後重複利用。
import { t, getLang } from './i18n.js';
import { convertTo, t2s, s2t } from './zhconv.js';
import { el, toast, confetti, infoDialog, openModal } from './ui.js';
import { sfx, playBlob, speakNative } from './sfx.js';
import { settings, saveSettings, words, bumpGame, getCard, idbGet, idbSet, hasAudioCached, isKid } from './store.js';
import { ttsChar } from './gemini.js';
import { playSyllable } from './voice.js';
import { startFlash } from './flash.js';
import { confirmDialog } from './ui.js';

const Q_COUNT = 10;
let root = null;
let state = null; // { questions:[{ch, wrong}], idx, score, answers:[] }

export function initGame(rootEl) {
  root = rootEl;
  renderIntro();
}

export function refreshGamePage() {
  state = null;
  renderIntro();
}

// 畫面世代：重繪首頁就 +1。準備語音的迴圈跑完回來若世代不同（使用者已切走），就不再 beginGame 把畫面蓋掉
let viewSeq = 0;

// ---------- 首頁（三個遊戲入口） ----------
function renderIntro() {
  viewSeq++;
  root.innerHTML = '';

  function entry(emoji, label, desc, cls, onclick) {
    const card = el('button', { class: `game-entry ${cls}`, onclick },
      el('span', { class: 'ge-emoji', text: emoji }),
      el('span', { class: 'ge-label', text: label }),
      el('span', { class: 'ge-desc', text: desc }),
    );
    return card;
  }

  // 不熟模式開關
  const weakSwitch = el('button', { class: `switch${settings.weakMode ? ' on' : ''}` });
  weakSwitch.addEventListener('click', () => {
    sfx.tap();
    settings.weakMode = !settings.weakMode;
    saveSettings();
    weakSwitch.classList.toggle('on', settings.weakMode);
  });

  root.append(
    el('div', { class: 'h1' }, '🎈 ', t('game_title')),
    el('div', { class: 'game-menu' },
      entry('🦊', t('game_menu_listen'), t('game_intro'), 'listen', async () => {
        sfx.tap();
        if (!(await weakModeGate())) return;
        startPrep();
      }),
      entry('🃏', t('game_menu_flash'), t('game_menu_flash_desc'), 'flash', () => {
        sfx.tap();
        if (words.length < 4) { toast(t('game_need_words'), true); return; }
        openFlashMenu();
      }),
      entry('🧩', t('game_menu_word'), t('game_menu_word_desc'), 'word', async () => {
        sfx.tap();
        if (words.length < 4) { toast(t('game_need_words'), true); return; }
        if (!(await weakModeGate())) return;
        startFlash(root, 'word', renderIntro);
      }),
    ),
    // 不熟模式是家長調的出題範圍，小孩帳號不顯示
    isKid() ? null : el('div', { class: 'card', style: 'max-width:1100px;margin:20px auto 0;' },
      el('div', { class: 'settings-line' },
        el('span', { text: `🔥 ${t('weak_mode')}` }), weakSwitch,
      ),
    ),
  );
}

// ---------- 認字卡：出題範圍選單與選字頁 ----------
let pickSort = 'weak';     // 選字清單排序：weak | new | least | most
const pickSel = new Set(); // 已選的字（切換排序時保留）

function openFlashMenu() {
  const m = openModal(`🃏 ${t('game_menu_flash')}`);
  const mk = (cls, emoji, label, onclick) =>
    el('button', { class: `btn big ${cls}`, style: 'width:100%;justify-content:center;', onclick }, `${emoji} `, label);
  m.body.append(
    el('div', { style: 'display:flex;flex-direction:column;gap:12px;padding:6px 0;min-width:min(340px,72vw);' },
      mk('mint', '🚀', t('flash_start_all'), async () => {
        sfx.tap();
        m.close();
        if (!(await weakModeGate())) return;
        startFlash(root, 'char', renderIntro);
      }),
      mk('sky', '🎯', t('flash_pick'), () => {
        sfx.tap();
        m.close();
        pickSel.clear();
        renderFlashPicker();
      }),
    ),
  );
}

/** 選字頁的字池：入庫的不出（跟出題規則一致） */
function pickerPool() {
  return words.filter((w) => !w.archived);
}

function sortedPicker() {
  const list = pickerPool();
  if (pickSort === 'new') list.sort((a, b) => b.addedAt - a.addedAt);
  else if (pickSort === 'least') list.sort((a, b) => a.usedCount - b.usedCount || b.addedAt - a.addedAt);
  else if (pickSort === 'most') list.sort((a, b) => b.usedCount - a.usedCount);
  else {
    // 熟悉度（顏色）：標紅在前（錯多優先），再來白字，學會的最後
    const rank = (w) => {
      const c = getCard(w);
      return c.mark === 'red' ? 0 : c.mark === null ? 1 : 2;
    };
    list.sort((a, b) => rank(a) - rank(b) || getCard(b).ng - getCard(a).ng || b.addedAt - a.addedAt);
  }
  return list;
}

function renderFlashPicker() {
  root.innerHTML = '';

  const backBtn = el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); renderIntro(); } },
    '↩️ ', t('flash_back'));

  const seg = el('div', { class: 'seg' });
  const mkSort = (val, label) => {
    const b = el('button', { class: pickSort === val ? 'on' : '', text: label });
    b.addEventListener('click', () => { sfx.tap(); pickSort = val; renderFlashPicker(); });
    return b;
  };
  seg.append(
    mkSort('weak', t('words_sort_weak')),
    mkSort('new', t('words_sort_new')),
    mkSort('least', t('words_sort_least')),
    mkSort('most', t('words_sort_most')),
  );

  const startBtn = el('button', { class: 'btn mint' });
  const allBtn = el('button', { class: 'btn ghost small', text: t('flash_pick_all') });
  const clearBtn = el('button', { class: 'btn ghost small', text: t('flash_pick_clear') });

  function refreshStart() {
    startBtn.textContent = '';
    startBtn.append('🃏 ', t('flash_pick_start', { n: pickSel.size }));
    startBtn.disabled = pickSel.size === 0;
  }
  startBtn.addEventListener('click', () => {
    if (!pickSel.size) return;
    sfx.sparkle();
    startFlash(root, 'char', renderIntro, { onlyChs: new Set(pickSel) });
  });

  const grid = el('div', { class: 'word-grid' });
  const chipByCh = new Map();

  function setSel(ch, on) {
    if (on) pickSel.add(ch); else pickSel.delete(ch);
    const chip = chipByCh.get(ch);
    if (chip) chip.classList.toggle('sel', on);
    refreshStart();
  }
  function syncChips() {
    for (const [ch, chip] of chipByCh) chip.classList.toggle('sel', pickSel.has(ch));
    refreshStart();
  }
  allBtn.addEventListener('click', () => { sfx.tap(); for (const w of pickerPool()) pickSel.add(w.ch); syncChips(); });
  clearBtn.addEventListener('click', () => { sfx.tap(); pickSel.clear(); syncChips(); });

  const markCls = (w) => {
    const m = getCard(w).mark;
    return m === 'green' ? ' mk-g' : m === 'red' ? ' mk-r' : '';
  };

  for (const w of sortedPicker()) {
    const chip = el('button', {
      class: `word-chip${pickSel.has(w.ch) ? ' sel' : ''}${markCls(w)}`,
      'data-ch': w.ch,
      style: 'touch-action:none;', // 在字卡上起手的拖曳不會捲動頁面
    },
      el('span', { class: 'w', text: convertTo(w.ch, getLang()) }),
      el('span', { class: 'u', text: t('used_times', { n: w.usedCount }) }),
    );
    chipByCh.set(w.ch, chip);
    grid.append(chip);
  }
  refreshStart();

  // 拖選（與字表整理模式同款）：起手那格決定是選取還是取消
  let dragging = false;
  let dragOn = true;
  grid.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.word-chip');
    if (!chip) return;
    e.preventDefault();
    dragging = true;
    const ch = chip.dataset.ch;
    dragOn = !pickSel.has(ch);
    sfx.tap();
    setSel(ch, dragOn);
    try { chip.releasePointerCapture(e.pointerId); } catch { /* 合成事件沒有有效 pointerId */ }
  });
  grid.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const chip = under && under.closest('.word-chip');
    if (chip && chip.dataset.ch) {
      const ch = chip.dataset.ch;
      if (pickSel.has(ch) !== dragOn) { sfx.tap(); setSel(ch, dragOn); }
    }
  });
  const stopDrag = () => { dragging = false; };
  grid.addEventListener('pointerup', stopDrag);
  grid.addEventListener('pointercancel', stopDrag);
  grid.addEventListener('pointerleave', stopDrag);

  root.append(
    el('div', { class: 'spread' },
      el('div', { class: 'row' }, backBtn, el('div', { class: 'h1', style: 'margin:0;' }, '🎯 ', t('flash_pick'))),
      el('div', { class: 'row' }, allBtn, clearBtn, startBtn),
    ),
    el('div', { class: 'spread', style: 'margin:10px 0;' }, seg),
    el('p', { class: 'settings-note', style: 'margin-bottom:12px;', text: `👉 ${t('flash_pick_hint')}` }),
    grid,
  );
}

/** 出題池（入庫的不算；不熟模式只留紅/白字） */
function gamePool() {
  return words.filter((w) => !w.archived &&
    (!settings.weakMode || getCard(w).mark !== 'green'));
}

/** 不熟模式但紅/白字已練完 → 問是否直接關閉；回傳是否繼續進遊戲 */
async function weakModeGate() {
  if (!settings.weakMode) return true;
  if (gamePool().length > 0) return true;
  const yes = await confirmDialog(t('weak_empty_q'));
  if (yes) {
    settings.weakMode = false;
    saveSettings();
    renderIntro();
    return true;
  }
  return false;
}

// ---------- 出題 ----------
function pickQuestions() {
  // 加權隨機：答錯多、練習少的字更容易被選中（依目前帳號×語系的紀錄）
  const pool = gamePool();
  const weight = (w) => {
    const c = getCard(w);
    return 1 + c.ng * 2 + (c.flashCount === 0 ? 1 : 0) + Math.max(0, 3 - w.usedCount) * 0.5;
  };
  const picked = [];
  while (picked.length < Q_COUNT && pool.length) {
    let total = pool.reduce((s, w) => s + weight(w), 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= weight(pool[i]);
      if (r <= 0) { idx = i; break; }
    }
    picked.push(pool.splice(idx, 1)[0].ch);
  }
  // 干擾項：從其他未入庫的字裡隨機挑（挑不到干擾項的題目直接不出）
  const all = words.filter((w) => !w.archived).map((w) => w.ch);
  return picked.map((ch) => ({ ch, wrong: pickWrong(ch, all) })).filter((q) => q.wrong);
}

/**
 * 從 all 挑一個不等於 ch 的字當干擾項；只剩 ch 一個字就回 null。
 * 以前是 while (wrong === ch) 隨機重抽——未入庫的字只剩 1 個時會在主執行緒無限迴圈，整台 iPad 凍住。
 */
export function pickWrong(ch, all) {
  const others = all.filter((x) => x !== ch);
  return others.length ? others[(Math.random() * others.length) | 0] : null;
}

/** 未入庫（能進遊戲）的字數 */
function playableCount() { return words.filter((w) => !w.archived).length; }

// ---------- 語音準備 ----------
async function startPrep() {
  sfx.tap();
  // 看「能進遊戲的字」而不是字表總數：入庫的字不出題也不當干擾項
  if (playableCount() < 4) { toast(t('game_need_words'), true); return; }

  const questions = pickQuestions();
  if (!questions.length) { toast(t('game_need_words'), true); return; }
  const mySeq = viewSeq;
  const gone = () => mySeq !== viewSeq;
  const uniq = [...new Set(questions.flatMap((q) => [q.ch, q.wrong]))];

  // 找出還沒緩存的
  const missing = [];
  for (const ch of uniq) {
    const hit = await idbGet('audio', ch).catch(() => null);
    if (!hit) missing.push(ch);
  }

  if (missing.length && !settings.apiKey) {
    // 沒 key：只用已緩存語音的字出題；一個都沒有就提示
    const cached = [];
    for (const w of gamePool()) {
      const hit = await idbGet('audio', w.ch).catch(() => null);
      if (hit) cached.push(w.ch);
    }
    if (cached.length < 4) { toast(t('game_need_key'), true); return; }
    const qs = [];
    const shuffled = cached.sort(() => Math.random() - 0.5);
    const all = words.filter((w) => !w.archived).map((w) => w.ch);
    for (const ch of shuffled.slice(0, Q_COUNT)) {
      const wrong = pickWrong(ch, all);
      if (wrong) qs.push({ ch, wrong });
    }
    if (!qs.length) { toast(t('game_need_words'), true); return; }
    if (gone()) return;
    beginGame(qs);
    return;
  }

  if (gone()) return;
  if (!missing.length) { beginGame(questions); return; }

  // 顯示準備畫面並下載
  root.innerHTML = '';
  const msg = el('p', { text: `${t('game_prep')} 0/${missing.length}` });
  const fill = el('div', { class: 'prep-fill' });
  root.append(
    el('div', { class: 'h1' }, '🎈 ', t('game_title')),
    el('div', { class: 'card game-stage loading-scene' },
      el('span', { class: 'big-emoji', text: '🔊' }), msg,
      el('div', { class: 'prep-bar' }, fill),
    ),
  );

  let done = 0, fail = [], lastErr = null;
  for (const ch of missing) {
    if (gone()) return; // 使用者切走了：不再下載、更不能回來蓋畫面
    try {
      const blob = await ttsChar(ch);
      await idbSet('audio', ch, blob);
    } catch (e) { fail.push(ch); lastErr = e; console.warn('tts failed', ch, e); }
    done++;
    msg.textContent = `${t('game_prep')} ${done}/${missing.length}`;
    fill.style.width = `${Math.round((done / missing.length) * 100)}%`;
  }
  if (gone()) return;

  let qs = questions;
  if (fail.length) {
    if (fail.length === missing.length && lastErr) {
      // 全部失敗：把真正的錯誤攤開給家長看
      await infoDialog(t('err_title'), `${lastErr.message}${t('err_hint')}`, true);
      renderIntro();
      return;
    }
    toast(t('game_prep_fail'), true);
    const bad = new Set(fail);
    qs = questions.filter((q) => !bad.has(q.ch) && !bad.has(q.wrong));
    if (qs.length < 3) { renderIntro(); return; }
  }
  beginGame(qs);
}

// ---------- 遊戲主流程 ----------
function beginGame(questions) {
  state = { questions, idx: 0, score: 0, answers: [] };
  sfx.sparkle();
  renderQuestion();
}

function renderQuestion() {
  const { questions, idx, score, answers } = state;
  if (idx >= questions.length) { renderEnd(); return; }
  const q = questions[idx];
  const showLeftFirst = Math.random() < 0.5;
  const options = showLeftFirst ? [q.ch, q.wrong] : [q.wrong, q.ch];

  root.innerHTML = '';

  const dots = el('div', { class: 'qdots' },
    questions.map((_, i) => {
      const d = el('span', { class: 'qdot' });
      if (i < answers.length) d.classList.add(answers[i] ? 'done-ok' : 'done-no');
      else if (i === idx) d.classList.add('now');
      return d;
    }),
  );

  const scoreEl = el('div', { class: 'game-score', text: `⭐ ${score} ${t('game_score')}` });
  const speaker = el('button', { class: 'speaker-btn', text: '🔊' });

  async function play() {
    speaker.classList.add('playing');
    // AI 快取 → 音節庫 → 內建語音（手勢內同步決策）
    const alt = getLang() === 'zh-Hans' ? t2s(q.ch) : s2t(q.ch);
    const key = [q.ch, alt].find(hasAudioCached);
    if (key) {
      const blob = await idbGet('audio', key).catch(() => null);
      if (blob) await playBlob(blob);
      else if (!playSyllable(q.ch)) speakNative(q.ch);
    } else if (!playSyllable(q.ch)) {
      speakNative(q.ch);
    }
    setTimeout(() => speaker.classList.remove('playing'), 500);
  }
  speaker.addEventListener('click', () => { sfx.tap(); play(); });

  let answered = false;
  const cards = options.map((ch) => {
    const card = el('button', { class: 'choice-card', text: convertTo(ch, getLang()), 'data-ch': ch });
    card.addEventListener('click', async () => {
      if (answered) return;
      answered = true;
      const correct = ch === q.ch;
      bumpGame(q.ch, correct);
      if (correct) {
        card.classList.add('right');
        sfx.correct();
        state.score++;
        confetti(900, 40);
      } else {
        card.classList.add('wrong');
        sfx.wrong();
        state.score = Math.max(0, state.score - 1);
        // 標出正確答案
        cards.forEach((c) => { if (c.dataset.ch === q.ch) c.classList.add('right'); });
      }
      state.answers.push(correct);
      scoreEl.textContent = `⭐ ${state.score} ${t('game_score')}`;
      await new Promise((r) => setTimeout(r, correct ? 900 : 1500));
      state.idx++;
      renderQuestion();
    });
    return card;
  });

  root.append(
    el('div', { class: 'game-stage' },
      el('div', { class: 'game-hud' }, scoreEl, dots),
      el('p', { style: 'font-size:24px;font-weight:800;color:var(--ink-soft);margin-top:8px;', text: t('game_listen') }),
      speaker,
      el('div', { class: 'choice-row' }, cards),
    ),
  );

  // 自動播一次
  setTimeout(play, 350);
}

function renderEnd() {
  const { score, questions } = state;
  const ratio = score / questions.length;
  const grade = ratio >= 0.8 ? t('game_end_great') : ratio >= 0.5 ? t('game_end_good') : t('game_end_ok');
  const starCount = Math.max(1, Math.round(ratio * 5));

  sfx.fanfare();
  confetti(3000, 180);

  root.innerHTML = '';
  root.append(
    el('div', { class: 'card game-stage game-end' },
      el('div', { style: 'font-size:100px;', text: ratio >= 0.8 ? '🏆' : ratio >= 0.5 ? '🎉' : '💪' }),
      el('h2', { text: grade }),
      el('div', { class: 'stars', text: '⭐'.repeat(starCount) + '☆'.repeat(5 - starCount) }),
      el('p', { text: `${score} / ${questions.length}` }),
      el('div', { class: 'row', style: 'justify-content:center;' },
        el('button', { class: 'btn big berry', onclick: () => { sfx.tap(); startPrep(); } }, '🔁 ', t('game_again')),
      ),
    ),
  );
}
