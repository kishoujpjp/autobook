// 認字卡／認詞彙：親子面對面教具卡
// 挑選順序：最近加入的新字 → 標紅/沒練過的字 → 其他（出現次數少者優先）
// 標綠 3 天冷卻；標紅 1~2 張後重出；入庫的字不出題；不熟模式只出紅字與白字。
// 熟悉度紀錄依「帳號×語系」分開（store.cards）。
import { t, getLang } from './i18n.js';
import { el, toast } from './ui.js';
import { sfx, playBlob, speakNative } from './sfx.js';
import {
  settings, saveSettings, words, isCooling, getCard, cycleMark, bumpFlash, idbGet,
} from './store.js';
import { WORDS } from './wordbank.js';
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

export function startFlash(root, mode, onExit) {
  const seq = [];
  let idx = -1;
  let lastCycleAt = 0;                      // 防誤觸：上次輪換熟悉度的時間
  const retryQueue = [];                    // 標紅的字：{ch, due}

  // ---------- 出題池 ----------
  function eligibleChars(relax = false) {
    const now = Date.now();
    return words.filter((w) => {
      if (w.archived) return false;
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
    for (let i = 0; i < retryQueue.length; i++) {
      if (retryQueue[i].due <= seq.length) {
        retryCh = retryQueue.splice(i, 1)[0].ch;
        break;
      }
    }
    if (mode === 'char') {
      const ch = retryCh || pickChar();
      if (!ch) return null;
      return { text: ch, chars: [ch] };
    }
    const c = retryCh ? pickWord(retryCh) : pickWord();
    if (!c) return null;
    return { text: c.form, chars: c.chars, t: c.t, s: c.s };
  }

  function scheduleRetry(ch) {
    if (!retryQueue.some((r) => r.ch === ch)) {
      retryQueue.push({ ch, due: seq.length + 1 + ((Math.random() * 2) | 0) });
    }
  }
  function cancelRetry(ch) {
    const i = retryQueue.findIndex((r) => r.ch === ch);
    if (i !== -1) retryQueue.splice(i, 1);
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
        el('div', { class: 'row' }, backBtn, el('div', { class: 'h1', style: 'margin:0;' }, mode === 'char' ? '🃏 ' : '🧩 ', title)),
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
        if (nowT - lastCycleAt < 450) return;
        lastCycleAt = nowT;
        const mark = cycleMark(ch);
        // 同一張卡裡相同的字全部同步變色
        for (const b of btnsByCh.get(ch)) {
          b.className = `fc-zi${markClass(mark)}`;
          b.classList.remove('pop');
          void b.offsetWidth;
          b.classList.add('pop');
        }
        if (mark === 'green') { sfx.correct(); cancelRetry(ch); }
        else if (mark === 'red') { sfx.unpop(); scheduleRetry(ch); }
        else sfx.tap();
        if (settings.tapSpeak) {
          let blob = await idbGet('audio', ch).catch(() => null);
          if (!blob && dispCh !== ch) blob = await idbGet('audio', dispCh).catch(() => null);
          if (blob) playBlob(blob);
          else speakNative(ch); // 缺檔用內建語音頂上
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
