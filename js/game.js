// 遊戲頁：聽音認字。開始前先把 10 題語音緩存好，之後重複利用。
import { t } from './i18n.js';
import { el, toast, confetti, infoDialog } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import { settings, words, bumpGame, idbGet, idbSet } from './store.js';
import { ttsChar } from './gemini.js';

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

// ---------- 首頁 ----------
function renderIntro() {
  root.innerHTML = '';
  root.append(
    el('div', { class: 'h1' }, '🎈 ', t('game_title')),
    el('div', { class: 'card game-stage', style: 'padding:48px 24px;' },
      el('div', { style: 'font-size:110px;margin-bottom:10px;', text: '🦊' }),
      el('p', { style: 'font-size:28px;font-weight:800;margin-bottom:30px;', text: t('game_intro') }),
      el('button', { class: 'btn big berry', onclick: startPrep }, '🎮 ', t('game_start')),
    ),
  );
}

// ---------- 出題 ----------
function pickQuestions() {
  // 加權隨機：答錯多、練習少的字更容易被選中
  const pool = [...words];
  const weight = (w) => 1 + w.ng * 2 + Math.max(0, 3 - w.usedCount) * 0.5;
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
  // 干擾項：從其他字裡隨機挑
  const all = words.map((w) => w.ch);
  return picked.map((ch) => {
    let wrong = ch;
    while (wrong === ch) wrong = all[(Math.random() * all.length) | 0];
    return { ch, wrong };
  });
}

// ---------- 語音準備 ----------
async function startPrep() {
  sfx.tap();
  if (words.length < 4) { toast(t('game_need_words'), true); return; }

  const questions = pickQuestions();
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
    for (const w of words) {
      const hit = await idbGet('audio', w.ch).catch(() => null);
      if (hit) cached.push(w.ch);
    }
    if (cached.length < 4) { toast(t('game_need_key'), true); return; }
    const qs = [];
    const shuffled = cached.sort(() => Math.random() - 0.5);
    for (const ch of shuffled.slice(0, Q_COUNT)) {
      let wrong = ch;
      const all = words.map((w) => w.ch);
      while (wrong === ch) wrong = all[(Math.random() * all.length) | 0];
      qs.push({ ch, wrong });
    }
    beginGame(qs);
    return;
  }

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
    try {
      const blob = await ttsChar(ch);
      await idbSet('audio', ch, blob);
    } catch (e) { fail.push(ch); lastErr = e; console.warn('tts failed', ch, e); }
    done++;
    msg.textContent = `${t('game_prep')} ${done}/${missing.length}`;
    fill.style.width = `${Math.round((done / missing.length) * 100)}%`;
  }

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
    const blob = await idbGet('audio', q.ch).catch(() => null);
    if (blob) await playBlob(blob);
    speaker.classList.remove('playing');
  }
  speaker.addEventListener('click', () => { sfx.tap(); play(); });

  let answered = false;
  const cards = options.map((ch) => {
    const card = el('button', { class: 'choice-card', text: ch });
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
        cards.forEach((c) => { if (c.textContent === q.ch) c.classList.add('right'); });
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
