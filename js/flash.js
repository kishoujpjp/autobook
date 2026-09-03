// 認字卡／認詞彙：親子面對面教具卡
// 挑選順序：最近加入的新字 → 標紅/沒練過的字 → 其他（出現次數少者優先）
// 標綠 3 天冷卻；入庫的字不出題；不熟模式只出紅字與白字。
// 間隔複習（本回合內）：
//   白字第一次出現就標綠 → 熟悉群（不再重出，出題順位由綠字冷卻下降）
//   標紅 → 隔 2 張重出；重出時沒改仍是紅 → 再隔 2 張重出
//   紅轉綠 → 隔 3 張再確認一次；確認那張沒被標紅 → 學會，歸入熟悉群
// 熟悉度紀錄依「帳號×語系」分開（store.cards）。
import { t, getLang } from './i18n.js';
import { el, toast, TIMING } from './ui.js';
import { icon } from './icons.js';
import { sfx } from './sfx.js';
import {
  settings, saveSettings, words, isCooling, getCard, cycleMark, bumpFlash,
} from './store.js';
import { WORDS } from './wordbank.js';
import { speakChar } from './voice.js';
import { convertTo } from './zhconv.js';

const RECENT_AVOID = 5;                    // 避免短期內重複出同一張
const NEW_MS = 3 * 24 * 3600 * 1000;       // 「最近加入」窗口

// 自繪圖示（風格統一：粗圓角線條）
const SVG_BACK =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M28 10 L14 24 L28 38" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_PREV =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M33 8 L15 24 L33 40 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/></svg>';
const SVG_NEXT =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M15 8 L33 24 L15 40 Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/></svg>';

function isWeak(w) {
  return getCard(w).mark !== 'green';       // 紅或白
}

export function startFlash(root, mode, onExit, opts = {}) {
  // 指定出題範圍（選字出題）：只出這些字，且不受綠字冷卻與不熟模式限制
  const only = opts.onlyChs || null;
  const seq = [];
  let idx = -1;
  let lastCycleAt = 0;                      // 防誤觸：上次輪換熟悉度的時間

  // ---------- 間隔複習狀態（本回合內） ----------
  const RED_GAP = 2;                        // 標紅：隔 2 張重出
  const CONFIRM_GAP = 3;                    // 紅轉綠：隔 3 張再確認
  const chState = new Map();                // ch -> 'red' | 'confirm' | 'learned'
  const dueQueue = [];                      // { ch, due }（due <= seq.length 時重出）

  function upsertDue(ch, gap) {
    cancelDue(ch);
    dueQueue.push({ ch, due: seq.length + gap });
  }
  function cancelDue(ch) {
    const i = dueQueue.findIndex((r) => r.ch === ch);
    if (i !== -1) dueQueue.splice(i, 1);
  }
  function inDue(ch) { return dueQueue.some((r) => r.ch === ch); }

  /** 點字改標記後的狀態機 */
  function onMarked(ch, mark) {
    if (mark === 'red') {
      chState.set(ch, 'red');
      upsertDue(ch, RED_GAP);
    } else if (mark === 'green') {
      if (chState.get(ch) === 'red') {
        // 紅轉綠：還要隔 3 張確認一次
        chState.set(ch, 'confirm');
        upsertDue(ch, CONFIRM_GAP);
      } else if (chState.get(ch) !== 'confirm') {
        // 第一次出現就標綠（本回合沒紅過）→ 直接歸入熟悉群
        chState.set(ch, 'learned');
        cancelDue(ch);
      }
    } else {
      // 清回白字：取消排程（紅過的紀錄保留，之後再標綠仍會走確認）
      cancelDue(ch);
    }
  }

  /** 換下一張前結算剛看完的卡：沒點但仍紅的要重排；確認卡沒被標紅＝學會 */
  function settleCard(card) {
    if (!card) return;
    const bank = bankMap();
    for (const ch of card.chars) {
      const w = bank.get(ch);
      if (!w) continue;
      const mark = getCard(w).mark;
      if (mark === 'red' && !inDue(ch)) {
        chState.set(ch, 'red');
        upsertDue(ch, RED_GAP);
      } else if (mark !== 'red' && chState.get(ch) === 'confirm' && (card.confirmChs || []).includes(ch)) {
        chState.set(ch, 'learned');
        cancelDue(ch);
      }
    }
  }

  // ---------- 出題池 ----------
  function eligibleChars(relax = false) {
    const now = Date.now();
    return words.filter((w) => {
      if (w.archived) return false;
      if (only) return only.has(w.ch);
      if (settings.weakMode) return isWeak(w);
      return relax || !isCooling(w, now);
    });
  }

  function pickChar() {
    let pool = eligibleChars();
    if (!pool.length) pool = eligibleChars(true);
    if (!pool.length) return null;
    const recent = new Set(seq.slice(-RECENT_AVOID).flatMap((c) => c.chars));
    const fresh = pool.filter((w) => !recent.has(w.ch));
    if (fresh.length) pool = fresh;
    const now = Date.now();
    // 三層優先：新字 → 標紅/沒練過 → 其他（次數少優先）
    const t0 = pool.filter((w) => now - w.addedAt < NEW_MS && getCard(w).flashCount < 3);
    const t1 = pool.filter((w) => !t0.includes(w) &&
      (getCard(w).mark === 'red' || getCard(w).flashCount === 0));
    let tier;
    if (t0.length) tier = t0;
    else if (t1.length) tier = t1;
    else {
      pool.sort((a, b) => getCard(a).flashCount - getCard(b).flashCount);
      tier = pool.slice(0, Math.max(5, Math.ceil(pool.length * 0.2)));
    }
    return tier[(Math.random() * tier.length) | 0].ch;
  }

  function bankMap() {
    const m = new Map();
    for (const w of words) if (!w.archived) m.set(w.ch, w);
    return m;
  }

  function lenOk(n) {
    if (settings.wordLen === '2') return n === 2;
    if (settings.wordLen === '3') return n === 3;
    return true;
  }

  /** 詞庫裡所有「每個字都在字表（未入庫）」的詞 */
  function candidateWords(relax = false) {
    const bank = bankMap();
    const now = Date.now();
    const out = [];
    for (const wd of WORDS) {
      let form = null;
      if ([...wd.t].every((ch) => bank.has(ch))) form = wd.t;
      else if (wd.s !== wd.t && [...wd.s].every((ch) => bank.has(ch))) form = wd.s;
      if (!form) continue;
      const chars = [...form];
      if (!lenOk(chars.length)) continue;
      if (settings.weakMode) {
        const weakCount = chars.filter((ch) => isWeak(bank.get(ch))).length;
        if (!relax && weakCount < chars.length) continue;  // 嚴格：全是紅/白
        if (relax && weakCount === 0) continue;            // 放寬：至少一個
      } else if (!relax && chars.some((ch) => isCooling(bank.get(ch), now))) {
        continue;
      }
      out.push({ form, chars, t: wd.t, s: wd.s });
    }
    return out;
  }

  function wordScore(c, bank, now) {
    // 詞的優先度：含新字最優先，其次含紅/沒練過的字，再依出現次數總和
    let tier = 2;
    for (const ch of c.chars) {
      const w = bank.get(ch);
      const card = getCard(w);
      if (now - w.addedAt < NEW_MS && card.flashCount < 3) { tier = 0; break; }
      if (card.mark === 'red' || card.flashCount === 0) tier = Math.min(tier, 1);
    }
    const sum = c.chars.reduce((s, ch) => s + getCard(bank.get(ch)).flashCount, 0);
    return tier * 1000 + sum;
  }

  function pickWord(mustContain = null) {
    let cands = candidateWords();
    if (cands.length < 8) cands = cands.concat(candidateWords(true));
    if (!cands.length) return null;
    if (mustContain) {
      const withCh = cands.filter((c) => c.chars.includes(mustContain));
      if (withCh.length) cands = withCh;
    }
    const recent = new Set(seq.slice(-RECENT_AVOID).map((c) => c.text));
    const fresh = cands.filter((c) => !recent.has(c.form));
    if (fresh.length) cands = fresh;
    const bank = bankMap();
    const now = Date.now();
    cands.sort((a, b) => wordScore(a, bank, now) - wordScore(b, bank, now));
    const tier = cands.slice(0, Math.max(8, Math.ceil(cands.length * 0.15)));
    return tier[(Math.random() * tier.length) | 0];
  }

  function makeCard() {
    let retryCh = null;
    for (let i = 0; i < dueQueue.length; i++) {
      if (dueQueue[i].due <= seq.length) {
        retryCh = dueQueue.splice(i, 1)[0].ch;
        break;
      }
    }
    let card;
    if (mode === 'char') {
      const ch = retryCh || pickChar();
      if (!ch) return null;
      card = { text: ch, chars: [ch] };
    } else {
      const c = retryCh ? pickWord(retryCh) : pickWord();
      if (!c) return null;
      card = { text: c.form, chars: c.chars, t: c.t, s: c.s };
    }
    if (retryCh) {
      if (!card.chars.includes(retryCh)) {
        // 詞卡剛好拼不進這個字：塞回排程，下一張再試
        upsertDue(retryCh, 1);
      } else if (chState.get(retryCh) === 'confirm') {
        card.confirmChs = [retryCh]; // 這張是「確認卡」：沒被標紅就算學會
      }
    }
    return card;
  }

  // ---------- UI ----------
  const title = mode === 'char' ? t('game_menu_flash') : t('game_menu_word');
  const counter = el('span', { class: 'fc-counter' });
  const cardArea = el('div', { class: 'fc-area' });
  const backBtn = el('button', { class: 'icon-btn', 'aria-label': t('flash_back') });
  backBtn.innerHTML = SVG_BACK;
  backBtn.addEventListener('click', () => { sfx.tap(); onExit(); });
  const prevBtn = el('button', { class: 'fc-nav' });
  prevBtn.innerHTML = SVG_PREV;
  const nextBtn = el('button', { class: 'fc-nav next' });
  nextBtn.innerHTML = SVG_NEXT;

  // 認詞彙：詞長選擇
  let lenSeg = null;
  if (mode === 'word') {
    lenSeg = el('div', { class: 'seg small' });
    const mkLen = (val, label) => {
      const b = el('button', { class: settings.wordLen === val ? 'on' : '', text: label });
      b.addEventListener('click', () => {
        sfx.tap();
        settings.wordLen = val;
        saveSettings();
        [...lenSeg.children].forEach((c) => c.classList.remove('on'));
        b.classList.add('on');
      });
      return b;
    };
    lenSeg.append(mkLen('2', t('wordlen_2')), mkLen('3', t('wordlen_3')), mkLen('all', t('wordlen_all')));
  }

  root.innerHTML = '';
  root.append(
    el('div', { class: 'fc-stage' },
      el('div', { class: 'spread' },
        el('div', { class: 'row' }, backBtn, el('div', { class: 'h1', style: 'margin:0;' }, icon(mode === 'char' ? 'cards' : 'puzzle'), title)),
        el('div', { class: 'row' }, lenSeg, counter),
      ),
      cardArea,
      el('div', { class: 'fc-controls' },
        prevBtn,
        el('span', { class: 'fc-hint', text: t('flash_hint') }),
        nextBtn,
      ),
    ),
  );

  function markClass(mark) {
    return mark === 'green' ? ' g' : mark === 'red' ? ' r' : '';
  }

  function renderCard() {
    const card = seq[idx];
    counter.textContent = t('flash_count', { n: idx + 1 });
    prevBtn.disabled = idx <= 0;
    cardArea.innerHTML = '';
    const n = card.chars.length;
    // 每格寬 ≈ 1.2em（含左右留白），加上格間 2vw，總寬壓在 94vw 內
    const vwCap = Math.floor((94 - 2 * (n - 1)) / (1.2 * n));
    const size = mode === 'char'
      ? 'min(58vh, 70vw)'
      : `min(50vh, ${vwCap}vw)`;
    const wrap = el('div', { class: 'fc-card' });
    const bank = new Map(words.map((w) => [w.ch, w]));

    // 顯示字形跟隨語系：詞卡用詞庫繁/簡形，字卡逐字轉換；資料用字表原字
    const dispChars = card.t
      ? [...(getLang() === 'zh-Hans' ? card.s : card.t)]
      : card.chars.map((c) => convertTo(c, getLang()));

    const btnsByCh = new Map(); // 同字同步用
    card.chars.forEach((ch, ci) => {
      const w = bank.get(ch);
      const dispCh = dispChars[ci] || ch;
      const btn = el('button', {
        class: `fc-zi${markClass(w ? getCard(w).mark : null)}`,
        style: `font-size:${size};`,
        text: dispCh,
      });
      if (!btnsByCh.has(ch)) btnsByCh.set(ch, []);
      btnsByCh.get(ch).push(btn);
      btn.addEventListener('click', async () => {
        // 防誤觸：短時間內連點不重複輪換
        const nowT = Date.now();
        if (nowT - lastCycleAt < TIMING.tapGuard) return;
        lastCycleAt = nowT;
        const mark = cycleMark(ch);
        // 同一張卡裡相同的字全部同步變色
        for (const b of btnsByCh.get(ch)) {
          b.className = `fc-zi${markClass(mark)}`;
          b.classList.remove('pop');
          void b.offsetWidth;
          b.classList.add('pop');
        }
        if (mark === 'green') sfx.correct();
        else if (mark === 'red') sfx.unpop();
        else sfx.tap();
        onMarked(ch, mark);
        if (settings.tapSpeak) {
          speakChar(ch, [dispCh]); // AI 快取 → 音節庫 → 內建語音（手勢內同步決策）
        }
      });
      wrap.append(btn);
    });
    cardArea.append(wrap);
  }

  function next() {
    if (idx + 1 < seq.length) {
      idx++;
      renderCard();
      return;
    }
    settleCard(seq[seq.length - 1]); // 結算剛看完的卡（仍紅要重排；確認卡過關＝學會）
    const card = makeCard();
    if (!card) {
      toast(t('word_none'), true);
      if (!seq.length) onExit();
      return;
    }
    seq.push(card);
    idx = seq.length - 1;
    bumpFlash(card.chars); // 只在新出題時計數，來回翻閱不重複計
    sfx.whoosh();
    renderCard();
  }

  prevBtn.addEventListener('click', () => { sfx.tap(); if (idx > 0) { idx--; renderCard(); } });
  nextBtn.addEventListener('click', () => { sfx.tap(); next(); });

  next();
}
