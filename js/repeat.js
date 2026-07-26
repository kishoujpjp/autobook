// 跟讀：英語單字/短句跟讀練習
// 發音判定走裝置內建語音辨識（Web Speech API，零延遲、不經雲端）；
// 轉出文字後與目標句逐詞模糊比對，寬鬆計分（鼓勵導向）。
// 示範發音用 TTS 快取；配圖懶生成後永久快取。
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import {
  settings, phrases, addPhrases, removePhrase, savePhrases,
  phraseStat, setPhraseStat, idbGet, idbSet,
} from './store.js';
import { ttsText, generatePhrases, generatePhraseImage } from './gemini.js';

let root = null;

const SVG_MIC =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="6" width="12" height="22" rx="6" fill="currentColor"/><path d="M12 24 a12 12 0 0 0 24 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="24" y1="36" x2="24" y2="42" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
const SVG_BACK =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M28 10 L14 24 L28 38" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_SPEAKER =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M10 18 h8 l10 -8 v28 l-10 -8 h-8 Z" fill="currentColor"/><path d="M34 16 a10 10 0 0 1 0 16 M38 11 a16 16 0 0 1 0 26" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';

export function initRepeat(rootEl) {
  root = rootEl;
  renderHome();
}

export function refreshRepeatPage() { renderHome(); }

function srCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

// ============ 首頁 ============
function renderHome() {
  root.classList.remove('story-fixed');
  root.innerHTML = '';
  root.append(
    el('div', { class: 'spread', style: 'margin-bottom:16px;' },
      el('div', { class: 'h1', style: 'margin-bottom:0;' }, '🎤 ', t('rep_title')),
      el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openBankModal(); } }, '📚 ', t('rep_bank')),
    ),
  );

  if (!srCtor()) {
    root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;', text: `⚠️ ${t('rep_sr_unavail')}` }));
  }

  if (!phrases.length) {
    root.append(el('div', { class: 'card story-empty' },
      el('span', { class: 'emoji', text: '🗣️' }),
      el('p', { text: t('rep_empty') }),
      el('button', { class: 'btn big', onclick: () => { sfx.tap(); openBankModal(); } }, '📚 ', t('rep_bank')),
    ));
    return;
  }

  const grid = el('div', { class: 'rep-grid' });
  phrases.forEach((p, i) => {
    const st = phraseStat(p);
    const card = el('button', { class: `rep-card p${i % 5}` },
      el('span', { class: 'rep-text-sm', text: p.text }),
      st
        ? el('span', { class: `rep-score-badge ${scoreCls(st.last)}`, text: `${st.last}` })
        : null,
    );
    card.addEventListener('click', () => { sfx.tap(); startPractice([p]); });
    grid.append(card);
  });
  root.append(grid);

  root.append(el('div', { class: 'row', style: 'justify-content:center;margin-top:24px;' },
    el('button', { class: 'btn big berry', onclick: () => { sfx.tap(); startPractice([...phrases]); } },
      '🎬 ', t('rep_start')),
  ));
}

function scoreCls(s) {
  return s >= 75 ? 'g' : s >= 45 ? 'y' : 'r';
}

// ============ 題庫管理 ============
function openBankModal() {
  const m = openModal(`📚 ${t('rep_bank')}`, { onClose: renderHome });

  const input = el('textarea', { class: 'text-area', placeholder: t('rep_bank_add_ph'), autocapitalize: 'off' });
  const addBtn = el('button', { class: 'btn mint small' }, '➕ ', t('rep_bank_add'));
  addBtn.addEventListener('click', () => {
    sfx.tap();
    const n = addPhrases(input.value.split('\n'));
    if (n) { sfx.sparkle(); toast(t('rep_added', { n })); input.value = ''; renderList(); }
  });

  // AI 出題
  const topicInput = el('input', { class: 'text-input', placeholder: t('rep_ai_topic_ph'), autocapitalize: 'off' });
  let aiMode = 'word';
  const modeSeg = el('div', { class: 'seg small' });
  const mkMode = (val, label) => {
    const b = el('button', { class: aiMode === val ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap(); aiMode = val;
      [...modeSeg.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
    });
    return b;
  };
  modeSeg.append(mkMode('word', t('rep_ai_word')), mkMode('sentence', t('rep_ai_sentence')));
  const aiBtn = el('button', { class: 'btn sky small' }, '🪄 ', t('rep_ai_go'));
  aiBtn.addEventListener('click', async () => {
    sfx.tap();
    if (!settings.apiKey) { toast(t('rep_need_key_ai'), true); return; }
    aiBtn.disabled = true;
    try {
      const items = await generatePhrases({ topic: topicInput.value.trim(), count: 10, mode: aiMode });
      const n = addPhrases(items);
      sfx.sparkle();
      toast(t('rep_added', { n }));
      renderList();
    } catch (e) {
      console.error(e);
      infoDialog(t('err_title'), `${e.message}${t('err_hint')}`, true);
    }
    aiBtn.disabled = false;
  });

  const list = el('div', {});
  function renderList() {
    list.innerHTML = '';
    for (const p of [...phrases].sort((a, b) => b.addedAt - a.addedAt)) {
      const del = el('button', { class: 'book-del', text: '🗑' });
      del.addEventListener('click', async () => {
        sfx.tap();
        const yes = await confirmDialog(t('rep_del_confirm'));
        if (yes) { await removePhrase(p.id); renderList(); }
      });
      list.append(el('div', { class: 'book-row' },
        el('span', { class: 'book-open', style: 'font-family:inherit;', text: p.text }),
        del,
      ));
    }
  }
  renderList();

  m.body.append(
    input,
    el('div', { class: 'row', style: 'margin:10px 0 18px;justify-content:flex-end;' }, addBtn),
    el('div', { class: 'field-label', text: `🪄 ${t('rep_ai_go')}` }),
    el('div', { class: 'row' }, topicInput, modeSeg, aiBtn),
    el('div', { class: 'field-label', text: `📋` }),
    list,
  );
}

// ============ 練習 ============
async function getPhraseAudio(text) {
  const key = `en|${text.toLowerCase()}`;
  let blob = await idbGet('audio', key).catch(() => null);
  if (!blob && (settings.apiKey || settings.ttsApiKey)) {
    try {
      blob = await ttsText(text);
      await idbSet('audio', key, blob);
    } catch (e) { console.warn('tts failed', e); }
  }
  return blob;
}

function startPractice(items) {
  const results = []; // {p, score}
  let i = 0;
  let currentRec = null;

  function exit() {
    if (currentRec) { try { currentRec.abort(); } catch { /* noop */ } currentRec = null; }
    renderHome();
  }

  function renderEnd() {
    const avg = Math.round(results.reduce((s, r) => s + r.score, 0) / (results.length || 1));
    const grade = avg >= 75 ? t('rep_end_great') : avg >= 50 ? t('rep_end_good') : t('rep_end_ok');
    sfx.fanfare();
    confetti(2500, 150);
    root.innerHTML = '';
    root.append(
      el('div', { class: 'card game-stage game-end' },
        el('div', { style: 'font-size:100px;', text: avg >= 75 ? '🏆' : avg >= 50 ? '🎉' : '💪' }),
        el('h2', { text: grade }),
        el('div', { class: 'stars', text: '⭐'.repeat(Math.max(1, Math.round(avg / 20))) + '☆'.repeat(5 - Math.max(1, Math.round(avg / 20))) }),
        el('p', { text: t('rep_avg', { n: avg }) }),
        el('div', { class: 'rep-endlist' },
          results.map((r) => el('div', { class: 'rep-endrow' },
            el('span', { text: r.p.text }),
            el('span', { class: `rep-score-badge ${scoreCls(r.score)}`, text: String(r.score) }),
          )),
        ),
        el('div', { class: 'row', style: 'justify-content:center;margin-top:20px;' },
          el('button', { class: 'btn big berry', onclick: () => { sfx.tap(); startPractice(items); } }, '🔁 ', t('rep_again')),
          el('button', { class: 'btn big ghost', onclick: () => { sfx.tap(); renderHome(); } }, '🏠'),
        ),
      ),
    );
  }

  async function renderQuestion() {
    if (i >= items.length) { renderEnd(); return; }
    const p = items[i];
    let answered = false;

    root.innerHTML = '';
    const backBtn = el('button', { class: 'icon-btn' });
    backBtn.innerHTML = SVG_BACK;
    backBtn.addEventListener('click', () => { sfx.tap(); exit(); });

    const img = el('img', { alt: '' });
    const figWrap = el('div', { class: 'fig-wrap rep-fig' }, img);

    // 目標句逐詞 span
    const tokens = p.text.split(' ');
    const wordEls = tokens.map((tok) => el('span', { class: 'rw', text: tok }));
    const textRow = el('div', { class: 'rep-words' }, wordEls);

    const speakBtn = el('button', { class: 'icon-btn sky' });
    speakBtn.innerHTML = SVG_SPEAKER;
    const scoreBubble = el('div', { class: 'rep-bubble hidden' });
    const micBtn = el('button', { class: 'rep-mic' });
    micBtn.innerHTML = SVG_MIC;
    const nextBtn = el('button', { class: 'btn big berry hidden' }, '➡️ ',
      i === items.length - 1 ? t('rep_finish') : t('rep_next'));
    const hint = el('p', { class: 'fc-hint', text: t('rep_listen') });

    root.append(
      el('div', { class: 'rep-stage' },
        el('div', { class: 'spread' },
          el('div', { class: 'row' }, backBtn, el('div', { class: 'h1', style: 'margin:0;' }, '🎤 ', t('rep_title'))),
          el('span', { class: 'fc-counter', text: `${i + 1} / ${items.length}` }),
        ),
        el('div', { class: 'rep-main' },
          figWrap,
          textRow,
          hint,
        ),
        el('div', { class: 'rep-controls' },
          speakBtn,
          scoreBubble,
          el('div', { class: 'row' }, nextBtn, micBtn),
        ),
      ),
    );

    // ---- 圖片（懶生成＋快取） ----
    (async () => {
      const imgKey = `ph|${p.id}`;
      let blob = p.hasImage ? await idbGet('images', imgKey).catch(() => null) : null;
      if (!blob && settings.apiKey) {
        figWrap.classList.add('loading');
        try {
          blob = await generatePhraseImage(p.text);
          await idbSet('images', imgKey, blob);
          p.hasImage = true;
          savePhrases();
        } catch (e) { console.warn('image failed', e); }
        figWrap.classList.remove('loading');
      }
      if (blob) img.src = URL.createObjectURL(blob);
      else {
        img.remove();
        figWrap.style.background = 'linear-gradient(160deg,#BFE3FF 0%,#E8F6E4 55%,#FFF3C9 100%)';
        figWrap.append(el('div', { class: 'rep-fig-emoji', text: '🌈' }));
      }
    })();

    // ---- 示範發音 ----
    let audioBlob = null;
    async function speak() {
      speakBtn.classList.add('playing');
      if (!audioBlob) audioBlob = await getPhraseAudio(p.text);
      if (audioBlob) await playBlob(audioBlob);
      speakBtn.classList.remove('playing');
    }
    speakBtn.addEventListener('click', () => { sfx.tap(); speak(); });
    setTimeout(speak, 400);

    // ---- 錄音辨識 ----
    micBtn.addEventListener('click', () => {
      if (answered) return;
      const SR = srCtor();
      if (!SR) { infoDialog(t('err_title'), t('rep_sr_unavail'), true); return; }
      if (currentRec) { try { currentRec.stop(); } catch { /* noop */ } return; }

      const rec = new SR();
      currentRec = rec;
      rec.lang = 'en-US';
      // iOS Safari 常常在 interimResults=false 時整場不給結果，所以開 interim 收集所有片段
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      const transcripts = new Set();
      let safetyTimer = 0;

      micBtn.classList.add('rec');
      hint.textContent = t('rep_mic_stop');
      sfx.tap();

      rec.onresult = (e) => {
        // 全部片段（含 interim）都收：逐一 + 各候選 + 全串接
        const joined = [];
        for (let ri = 0; ri < e.results.length; ri++) {
          for (let ai = 0; ai < e.results[ri].length; ai++) {
            const tr = e.results[ri][ai].transcript;
            if (tr && tr.trim()) transcripts.add(tr);
          }
          joined.push(e.results[ri][0].transcript);
        }
        const full = joined.join(' ').trim();
        if (full) transcripts.add(full);
      };
      const finish = () => {
        clearTimeout(safetyTimer);
        currentRec = null;
        micBtn.classList.remove('rec');
        if (answered) return;
        if (!transcripts.size) {
          toast(t('rep_no_result'), true);
          hint.textContent = t('rep_listen');
          return;
        }
        answered = true;
        const list = [...transcripts];
        console.log('heard:', list);
        const { wordScores, overall } = scoreAttempt(p.text, list);
        // 顯示聽到的內容（取最長一句），家長可對照
        const heard = list.reduce((a, b) => (b.length > a.length ? b : a), '');
        hint.textContent = `👂 ${heard}`;
        applyResult(wordScores, overall);
      };
      rec.onerror = (e) => {
        clearTimeout(safetyTimer);
        currentRec = null;
        micBtn.classList.remove('rec');
        if (e.error === 'not-allowed') infoDialog(t('err_title'), t('rep_sr_denied'), true);
        else if (e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          infoDialog(t('err_title'), t('rep_sr_unavail'), true);
        } else if (transcripts.size) {
          finish();
          return;
        } else {
          toast(t('rep_no_result'), true);
        }
        hint.textContent = t('rep_listen');
      };
      rec.onnomatch = () => { finish(); };
      rec.onend = () => { finish(); };
      // 保險：15 秒後自動收音（iOS 偶爾不會自己結束）
      safetyTimer = setTimeout(() => { try { rec.stop(); } catch { /* noop */ } }, 15000);
      try { rec.start(); } catch { currentRec = null; micBtn.classList.remove('rec'); }
    });

    function applyResult(wordScores, overall) {
      // 上色（逐詞）
      let wi = 0;
      tokens.forEach((tok, ti) => {
        if (!/[a-zA-Z]/.test(tok)) return;
        const s = wordScores[wi++] ?? 0;
        wordEls[ti].classList.add(scoreCls(s));
        wordEls[ti].classList.add('pop');
      });
      scoreBubble.textContent = t('rep_score', { n: overall });
      scoreBubble.className = `rep-bubble ${scoreCls(overall)}`;
      if (overall >= 75) { sfx.correct(); confetti(1000, 50); }
      else if (overall >= 45) sfx.sparkle();
      else sfx.pop();
      setPhraseStat(p, overall);
      results.push({ p, score: overall });
      micBtn.classList.add('hidden');
      nextBtn.classList.remove('hidden');
    }

    nextBtn.addEventListener('click', () => { sfx.tap(); i++; renderQuestion(); });
  }

  renderQuestion();
}

// ============ 本機計分（寬鬆、鼓勵導向） ============
function normWords(s) {
  return s.toLowerCase().replace(/[^a-z']+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function sim(a, b) {
  if (a === b) return 1;
  const d = lev(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/** 逐詞計分：每個目標詞取所有候選轉寫中最相似的詞 */
export function scoreAttempt(targetText, transcripts) {
  const tw = normWords(targetText);
  const spoken = [...new Set(transcripts.flatMap((tr) => normWords(tr)))];
  const wordScores = tw.map((w) => {
    let best = 0;
    for (const s of spoken) best = Math.max(best, sim(w, s));
    return best >= 0.85 ? 100 : best >= 0.6 ? 80 : best >= 0.4 ? 60 : best >= 0.25 ? 45 : 25;
  });
  let overall = Math.round(wordScores.reduce((a, b) => a + b, 0) / (wordScores.length || 1));
  // 鼓勵下限：只要有一個詞唸得不錯，總分不低於 55
  if (wordScores.some((s) => s >= 80)) overall = Math.max(overall, 55);
  return { wordScores, overall };
}
