// 認字卡／認詞彙：親子面對面教具卡
// 排程：優先出現 flashCount 少的字；標綠（學會）3 天冷卻不出題；
// 標紅（還不會）在 1~2 張後重新出現。詞彙由內建離線詞庫拼出（不用 AI）。
import { t, getLang } from './i18n.js';
import { el, toast } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import { settings, words, isCooling, cycleMark, bumpFlash, idbGet } from './store.js';
import { WORDS } from './wordbank.js';
import { convertTo } from './zhconv.js';

const RECENT_AVOID = 5; // 避免短期內重複出同一張

export function startFlash(root, mode, onExit) {
  // session 狀態
  const seq = [];          // 已出過的卡（可用上一張/下一張來回）
  let idx = -1;
  const retryQueue = [];   // 標紅的字：{ch, due}（due = seq.length 門檻）

  // ---------- 出題 ----------
  function eligibleWords(relax = false) {
    const now = Date.now();
    return words.filter((w) => relax || !isCooling(w, now));
  }

  function pickChar() {
    let pool = eligibleWords();
    if (!pool.length) pool = eligibleWords(true);
    const recent = new Set(seq.slice(-RECENT_AVOID).flatMap((c) => c.chars));
    const fresh = pool.filter((w) => !recent.has(w.ch));
    if (fresh.length) pool = fresh;
    // 優先出現次數少的：取次數最低的一批隨機挑
    pool.sort((a, b) => a.flashCount - b.flashCount);
    const tier = pool.slice(0, Math.max(5, Math.ceil(pool.length * 0.2)));
    return tier[(Math.random() * tier.length) | 0].ch;
  }

  function bankMap() {
    const m = new Map();
    for (const w of words) m.set(w.ch, w);
    return m;
  }

  /** 詞庫裡所有「每個字都在字表」的詞（優先繁形，再試簡形） */
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
      if (!relax && chars.some((ch) => isCooling(bank.get(ch), now))) continue;
      out.push({ form, chars, t: wd.t, s: wd.s });
    }
    return out;
  }

  function pickWord(mustContain = null) {
    let cands = candidateWords();
    if (cands.length < 8) cands = candidateWords(true);
    if (!cands.length) return null;
    if (mustContain) {
      const withCh = cands.filter((c) => c.chars.includes(mustContain));
      if (withCh.length) cands = withCh;
    }
    const recent = new Set(seq.slice(-RECENT_AVOID).map((c) => c.text));
    const fresh = cands.filter((c) => !recent.has(c.form));
    if (fresh.length) cands = fresh;
    // 依組成字的出現次數總和排序，取最低的一批隨機挑
    const bank = bankMap();
    cands.sort((a, b) =>
      a.chars.reduce((s, ch) => s + bank.get(ch).flashCount, 0) -
      b.chars.reduce((s, ch) => s + bank.get(ch).flashCount, 0));
    const tier = cands.slice(0, Math.max(8, Math.ceil(cands.length * 0.15)));
    const c = tier[(Math.random() * tier.length) | 0];
    return c;
  }

  function makeCard() {
    // 先看有沒有到期的「還不會」重出
    let retryCh = null;
    for (let i = 0; i < retryQueue.length; i++) {
      if (retryQueue[i].due <= seq.length) {
        retryCh = retryQueue.splice(i, 1)[0].ch;
        break;
      }
    }
    if (mode === 'char') {
      const ch = retryCh || pickChar();
      return { text: ch, chars: [ch] };
    }
    const c = retryCh ? pickWord(retryCh) : pickWord();
    if (!c) return null;
    return { text: c.form, chars: c.chars, t: c.t, s: c.s };
  }

  function scheduleRetry(ch) {
    // 間隔 1~2 張後再出現
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
  const prevBtn = el('button', { class: 'fc-nav', text: '◀' });
  const nextBtn = el('button', { class: 'fc-nav next', text: '▶' });

  root.innerHTML = '';
  root.append(
    el('div', { class: 'fc-stage' },
      el('div', { class: 'spread' },
        el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); onExit(); } }, '↩ ', t('flash_back')),
        el('div', { class: 'h1', style: 'margin:0;' }, mode === 'char' ? '🃏 ' : '🧩 ', title),
        counter,
      ),
      cardArea,
      el('div', { class: 'fc-controls' },
        prevBtn,
        el('span', { class: 'settings-note', text: t('flash_hint') }),
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
    const size = mode === 'char'
      ? 'min(52vh, 56vw)'
      : `min(38vh, ${Math.floor(84 / n)}vw)`;
    const wrap = el('div', { class: 'fc-card' });
    const bank = bankMap();
    // 顯示字形跟隨語系：詞卡直接用詞庫的繁/簡形（避免逐字轉換的一簡對多繁誤差），
    // 字卡逐字轉換；資料（標記/計數/語音）仍用字表原字
    const dispChars = card.t
      ? [...(getLang() === 'zh-Hans' ? card.s : card.t)]
      : card.chars.map((c) => convertTo(c, getLang()));
    card.chars.forEach((ch, ci) => {
      const w = bank.get(ch);
      const dispCh = dispChars[ci] || ch;
      const btn = el('button', {
        class: `fc-zi${markClass(w ? w.mark : null)}`,
        style: `font-size:${size};`,
        text: dispCh,
      });
      btn.addEventListener('click', async () => {
        const mark = cycleMark(ch);
        btn.className = `fc-zi${markClass(mark)}`;
        btn.classList.remove('pop');
        void btn.offsetWidth;
        btn.classList.add('pop');
        if (mark === 'green') { sfx.correct(); cancelRetry(ch); }
        else if (mark === 'red') { sfx.unpop(); scheduleRetry(ch); }
        else sfx.tap();
        if (settings.tapSpeak) {
          let blob = await idbGet('audio', ch).catch(() => null);
          if (!blob && dispCh !== ch) blob = await idbGet('audio', dispCh).catch(() => null);
          if (blob) playBlob(blob);
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

  next(); // 第一張
}
