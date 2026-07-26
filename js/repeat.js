// 跟讀：英語單字/短句跟讀練習（以「練習組」為單位）
// 發音判定走裝置內建語音辨識（Web Speech API）＋逐詞模糊比對，寬鬆計分。
// 允許重複錄音刷分；左右邊緣箭頭或滑動換題（本輪沒分數不可往前）。
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import {
  settings, saveSettings, phrases, addPhrases, removePhrase, savePhrases,
  phraseStat, setPhraseStat,
  repGroups, saveRepGroups, addRepGroup, removeRepGroup, groupPhrases,
  idbGet, idbSet,
} from './store.js';
import { ttsText, generatePhrases, generatePhraseImage } from './gemini.js';
import { phonemesOf } from './phonemes.js';

let root = null;

// ---------- 自繪圖示（統一粗圓角線條風格） ----------
const SVG_MIC =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect x="18" y="6" width="12" height="22" rx="6" fill="currentColor"/><path d="M12 24 a12 12 0 0 0 24 0" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><line x1="24" y1="36" x2="24" y2="42" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
const WAVE_HTML =
  '<span class="mic-wave"><i></i><i></i><i></i><i></i><i></i></span>';
const SVG_BACK =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M28 10 L14 24 L28 38" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_SPEAKER =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M10 18 h8 l10 -8 v28 l-10 -8 h-8 Z" fill="currentColor"/><path d="M34 16 a10 10 0 0 1 0 16 M38 11 a16 16 0 0 1 0 26" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>';
const SVG_CHEV_L =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M30 8 L14 24 L30 40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_CHEV_R =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M18 8 L34 24 L18 40" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_TROPHY_SM =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M14 8 h20 v10 a10 10 0 0 1 -20 0 Z" fill="currentColor"/><path d="M14 11 h-5 a5 5 0 0 0 5 9 M34 11 h5 a5 5 0 0 1 -5 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M22 27 h4 v6 h-4 Z M16 35 h16 v5 h-16 Z" fill="currentColor"/></svg>';
const SVG_REFRESH =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M38 20 a15 15 0 1 0 2 12" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M40 8 v12 h-12 Z" fill="currentColor"/></svg>';
const SVG_HOME =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M8 24 L24 8 L40 24" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 24 v16 h8 v-10 h4 v10 h8 v-16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_STAR =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4 L30 17 L44 19 L34 29 L36 43 L24 36 L12 43 L14 29 L4 19 L18 17 Z" fill="#FFD23E" stroke="#E9A912" stroke-width="3" stroke-linejoin="round"/></svg>';
const SVG_STAR_O =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4 L30 17 L44 19 L34 29 L36 43 L24 36 L12 43 L14 29 L4 19 L18 17 Z" fill="#F3E7CE" stroke="#E0CFA8" stroke-width="3" stroke-linejoin="round"/></svg>';
// 可愛獎盃（帶臉）
const SVG_TROPHY_BIG =
  '<svg viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M40 18 h60 v28 a30 30 0 0 1 -60 0 Z" fill="#FFD23E" stroke="#E9A912" stroke-width="5" stroke-linejoin="round"/>' +
  '<path d="M40 24 h-12 a9 9 0 0 0 9 16 M100 24 h12 a9 9 0 0 1 -9 16" fill="none" stroke="#E9A912" stroke-width="5" stroke-linecap="round"/>' +
  '<rect x="63" y="74" width="14" height="14" fill="#FFD23E" stroke="#E9A912" stroke-width="4"/>' +
  '<rect x="46" y="88" width="48" height="14" rx="6" fill="#F0A24C" stroke="#D0812B" stroke-width="4"/>' +
  '<circle cx="58" cy="38" r="4" fill="#4A3B2A"/><circle cx="82" cy="38" r="4" fill="#4A3B2A"/>' +
  '<circle cx="59.5" cy="36.5" r="1.3" fill="#fff"/><circle cx="83.5" cy="36.5" r="1.3" fill="#fff"/>' +
  '<path d="M62 47 Q70 54 78 47" fill="none" stroke="#4A3B2A" stroke-width="3.5" stroke-linecap="round"/>' +
  '<circle cx="49" cy="45" r="4.5" fill="#FF9DB5" opacity="0.7"/><circle cx="91" cy="45" r="4.5" fill="#FF9DB5" opacity="0.7"/>' +
  '<path d="M70 4 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="#FF6B9D"/>' +
  '</svg>';
// AI 生成動畫（旋轉光環＋跳動星星）
const SVG_AI_ANIM =
  '<svg viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">' +
  '<circle class="ai-ring" cx="80" cy="80" r="62" fill="none" stroke="#FFD23E" stroke-width="5" stroke-dasharray="10 16" stroke-linecap="round"/>' +
  '<path class="ai-s1" d="M80 36 L89 71 L124 80 L89 89 L80 124 L71 89 L36 80 L71 71 Z" fill="#FFB53E"/>' +
  '<path class="ai-s2" d="M126 30 l4 11 11 4 -11 4 -4 11 -4 -11 -11 -4 11 -4 Z" fill="#5AA9F9"/>' +
  '<path class="ai-s3" d="M34 112 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3 Z" fill="#FF6B9D"/>' +
  '</svg>';

export function initRepeat(rootEl) {
  root = rootEl;
  renderHome();
}

export function refreshRepeatPage() { renderHome(); }

function srCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function scoreCls(s) {
  return s >= 75 ? 'g' : s >= 45 ? 'y' : 'r';
}

// ---------- AI 阻斷式生成動畫 ----------
function aiOverlay(text) {
  const m = openModal('', { closable: false });
  const anim = el('div', { class: 'ai-anim' });
  anim.innerHTML = SVG_AI_ANIM;
  const msg = el('p', { text });
  m.body.append(el('div', { class: 'loading-scene' }, anim, msg));
  return {
    close: m.close,
    setText: (s) => { msg.textContent = s; },
  };
}

// ============ 首頁（練習組） ============
function renderHome() {
  root.classList.remove('story-fixed');
  root.innerHTML = '';
  root.append(
    el('div', { class: 'spread', style: 'margin-bottom:16px;' },
      el('div', { class: 'h1', style: 'margin-bottom:0;' }, '🎤 ', t('rep_title')),
      el('div', { class: 'row' },
        el('button', { class: 'btn sky', onclick: () => { sfx.tap(); fillContent(); } }, '✨ ', t('rep_fill_ai')),
        el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openBankModal(); } }, '📚 ', t('rep_bank')),
      ),
    ),
  );

  if (!srCtor()) {
    root.append(el('p', { class: 'settings-note', style: 'margin-bottom:12px;', text: `⚠️ ${t('rep_sr_unavail')}` }));
  }

  // 評分嚴格度
  const strictSeg = el('div', { class: 'seg small' });
  const mkStrict = (val, label) => {
    const b = el('button', { class: settings.repStrict === val ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap();
      settings.repStrict = val;
      saveSettings();
      [...strictSeg.children].forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
    });
    return b;
  };
  strictSeg.append(
    mkStrict('easy', t('rep_strict_easy')),
    mkStrict('std', t('rep_strict_std')),
    mkStrict('hard', t('rep_strict_hard')),
  );
  root.append(el('div', { class: 'card', style: 'margin-bottom:18px;' },
    el('div', { class: 'settings-line' },
      el('span', { text: `🎯 ${t('rep_strict')}` }), strictSeg,
    ),
  ));

  if (!repGroups.length) {
    root.append(el('div', { class: 'card story-empty' },
      el('span', { class: 'emoji', text: '🗣️' }),
      el('p', { text: t('rep_no_groups') }),
      el('button', { class: 'btn big', onclick: () => { sfx.tap(); openBankModal(); } }, '📚 ', t('rep_bank')),
    ));
    return;
  }

  const grid = el('div', { class: 'rep-grid' });
  repGroups.forEach((g, i) => {
    const items = groupPhrases(g);
    const done = items.filter((p) => phraseStat(p)).length;
    const card = el('button', { class: `rep-card p${i % 5}` },
      el('span', { class: 'rep-text-sm', text: g.name }),
      el('span', { class: 'rep-group-meta', text: `${items.length} ${t('rep_items_unit')}｜${t('rep_done_of', { a: done, b: items.length })}` }),
    );
    card.addEventListener('click', () => {
      sfx.tap();
      if (!items.length) { toast(t('rep_group_empty'), true); return; }
      startPractice(items);
    });
    grid.append(card);
  });
  root.append(grid);
}

// ============ AI 補足內容 ============
async function fillContent() {
  if (!settings.apiKey) { toast(t('rep_need_key_ai'), true); return; }
  const needAudio = [];
  const needImage = [];
  for (const p of phrases) {
    const hit = await idbGet('audio', `en|${p.text.toLowerCase()}`).catch(() => null);
    if (!hit) needAudio.push(p);
    if (!p.hasImage) needImage.push(p);
  }
  const total = needAudio.length + needImage.length;
  if (!total) { toast(t('rep_fill_done')); return; }

  const ov = aiOverlay(`${t('rep_generating')} 0/${total}`);
  let done = 0, fail = 0;
  for (const p of needAudio) {
    try {
      const blob = await ttsText(p.text);
      await idbSet('audio', `en|${p.text.toLowerCase()}`, blob);
    } catch (e) { fail++; console.warn('tts failed', p.text, e); }
    done++;
    ov.setText(`${t('rep_generating')} ${done}/${total}`);
  }
  for (const p of needImage) {
    try {
      const blob = await generatePhraseImage(p.text);
      await idbSet('images', `ph|${p.id}`, blob);
      p.hasImage = true;
      savePhrases();
    } catch (e) { fail++; console.warn('image failed', p.text, e); }
    done++;
    ov.setText(`${t('rep_generating')} ${done}/${total}`);
  }
  ov.close();
  sfx.sparkle();
  toast(fail ? t('game_prep_fail') : t('rep_fill_done'), !!fail);
}

// ============ 題庫（題目池＋練習組管理） ============
function openBankModal() {
  const m = openModal(`📚 ${t('rep_bank')}`, { onClose: renderHome });

  // ---- 練習組 ----
  const groupList = el('div', {});
  function renderGroups() {
    groupList.innerHTML = '';
    for (const g of repGroups) {
      const edit = el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); openGroupEditor(g, renderGroups); } }, '✏️');
      const del = el('button', { class: 'book-del', text: '🗑' });
      del.addEventListener('click', async () => {
        sfx.tap();
        const yes = await confirmDialog(t('rep_group_del_confirm', { n: g.name }));
        if (yes) { removeRepGroup(g.id); renderGroups(); }
      });
      groupList.append(el('div', { class: 'book-row' },
        el('span', { class: 'book-open', text: `📦 ${g.name}（${g.ids.length}）` }),
        edit, del,
      ));
    }
  }
  renderGroups();

  // ---- 手動加題 ----
  const input = el('textarea', { class: 'text-area', placeholder: t('rep_bank_add_ph'), autocapitalize: 'off' });
  const addBtn = el('button', { class: 'btn mint small' }, '➕ ', t('rep_bank_add'));

  // ---- AI 出題 ----
  const topicInput = el('input', { class: 'text-input', placeholder: t('rep_ai_topic_ph'), autocapitalize: 'off', style: 'flex:1;min-width:180px;' });
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
    const ov = aiOverlay(t('rep_generating'));
    try {
      const items = await generatePhrases({ topic: topicInput.value.trim(), count: 10, mode: aiMode });
      ov.close();
      const defName = topicInput.value.trim() ||
        `AI ${new Date().getMonth() + 1}/${new Date().getDate()}`;
      openAiPreview(items, defName, renderGroups);
    } catch (e) {
      ov.close();
      console.error(e);
      infoDialog(t('err_title'), `${e.message}${t('err_hint')}`, true);
    }
  });

  // ---- 題目池 ----
  const list = el('div', {});
  function renderList() {
    list.innerHTML = '';
    for (const p of [...phrases].sort((a, b) => b.addedAt - a.addedAt)) {
      const del = el('button', { class: 'book-del', text: '🗑' });
      del.addEventListener('click', async () => {
        sfx.tap();
        const yes = await confirmDialog(t('rep_del_confirm'));
        if (yes) { await removePhrase(p.id); renderList(); renderGroups(); }
      });
      list.append(el('div', { class: 'book-row' },
        el('span', { class: 'book-open', text: p.text }),
        del,
      ));
    }
  }
  renderList();

  addBtn.addEventListener('click', () => {
    sfx.tap();
    const { added } = addPhrases(input.value.split('\n'));
    if (added) { sfx.sparkle(); toast(t('rep_added', { n: added })); input.value = ''; renderList(); }
  });

  m.body.append(
    el('div', { class: 'field-label', style: 'margin-top:0;', text: `📦 ${t('rep_groups')}` }),
    groupList,
    el('div', { class: 'row', style: 'margin:6px 0 4px;' },
      el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); openGroupEditor(null, renderGroups); } }, '➕ ', t('rep_group_new')),
    ),
    el('div', { class: 'field-label', text: `🪄 ${t('rep_ai_go')}（${t('rep_ai_note')}）` }),
    el('div', { class: 'row' }, topicInput, modeSeg, aiBtn),
    el('div', { class: 'field-label', text: `✏️ ${t('rep_pool')}` }),
    input,
    el('div', { class: 'row', style: 'margin:10px 0 8px;justify-content:flex-end;' }, addBtn),
    list,
  );
}

// ---- 練習組編輯（命名＋勾選題目） ----
function openGroupEditor(existing, onDone) {
  const m = openModal(existing ? `✏️ ${existing.name}` : `➕ ${t('rep_group_new')}`);
  const nameInput = el('input', {
    class: 'text-input', placeholder: t('rep_group_name_ph'),
    value: existing ? existing.name : '',
  });
  const chosen = new Set(existing ? existing.ids : []);

  const list = el('div', {});
  for (const p of [...phrases].sort((a, b) => b.addedAt - a.addedAt)) {
    const row = el('button', { class: `rep-pick${chosen.has(p.id) ? ' on' : ''}`, text: p.text });
    row.addEventListener('click', () => {
      sfx.tap();
      if (chosen.has(p.id)) { chosen.delete(p.id); row.classList.remove('on'); }
      else { chosen.add(p.id); row.classList.add('on'); }
    });
    list.append(row);
  }

  m.body.append(
    el('div', { class: 'field-label', style: 'margin-top:0;', text: t('rep_group_name') }),
    nameInput,
    el('div', { class: 'field-label', text: t('rep_group_items') }),
    phrases.length ? list : el('p', { class: 'settings-note', text: t('rep_empty') }),
  );

  const saveBtn = el('button', { class: 'btn mint' }, '💾 ', t('acc_save'));
  saveBtn.addEventListener('click', () => {
    sfx.tap();
    const name = nameInput.value.trim();
    if (!name) { toast(t('rep_group_need_name'), true); return; }
    if (!chosen.size) { toast(t('rep_group_need_items'), true); return; }
    if (existing) {
      existing.name = name;
      existing.ids = [...chosen];
      saveRepGroups();
    } else {
      addRepGroup(name, [...chosen]);
    }
    sfx.sparkle();
    m.close();
    if (onDone) onDone();
  });
  m.foot.append(saveBtn);
}

// ---- AI 出題預覽：確認增刪後存成練習組 ----
function openAiPreview(items, defaultName, onDone) {
  const m = openModal(`🪄 ${t('rep_ai_preview')}`);
  const nameInput = el('input', { class: 'text-input', value: defaultName });
  const kept = [...items];

  const list = el('div', {});
  function renderRows() {
    list.innerHTML = '';
    kept.forEach((text, i) => {
      const del = el('button', { class: 'book-del', text: '✕' });
      del.addEventListener('click', () => { sfx.tap(); kept.splice(i, 1); renderRows(); });
      list.append(el('div', { class: 'book-row' },
        el('span', { class: 'book-open', text }),
        del,
      ));
    });
  }
  renderRows();

  m.body.append(
    el('div', { class: 'field-label', style: 'margin-top:0;', text: t('rep_group_name') }),
    nameInput,
    el('div', { class: 'field-label', text: `📋` }),
    list,
  );

  const saveBtn = el('button', { class: 'btn mint' }, '💾 ', t('acc_save'));
  saveBtn.addEventListener('click', () => {
    sfx.tap();
    const name = nameInput.value.trim();
    if (!name) { toast(t('rep_group_need_name'), true); return; }
    if (!kept.length) { toast(t('rep_group_need_items'), true); return; }
    const { ids } = addPhrases(kept);
    addRepGroup(name, ids);
    sfx.sparkle();
    toast(t('rep_added', { n: ids.length }));
    m.close();
    if (onDone) onDone();
  });
  m.foot.append(saveBtn);
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
  const answers = items.map(() => null); // {score, wordScores, heard}
  let i = 0;
  let currentRec = null;

  function exit() {
    if (currentRec) { try { currentRec.abort(); } catch { /* noop */ } currentRec = null; }
    renderHome();
  }

  // ---------- 成績頁（自繪獎盃/星星/按鈕） ----------
  function renderEnd() {
    const scored = answers.filter(Boolean);
    const avg = Math.round(scored.reduce((s, a) => s + a.score, 0) / (scored.length || 1));
    const grade = avg >= 75 ? t('rep_end_great') : avg >= 50 ? t('rep_end_good') : t('rep_end_ok');
    const starN = Math.min(5, Math.max(1, Math.round(avg / 20)));
    sfx.fanfare();
    confetti(2500, 150);

    const trophy = el('div', { class: 'rep-trophy' });
    trophy.innerHTML = SVG_TROPHY_BIG;
    const stars = el('div', { class: 'rep-stars' });
    for (let s = 0; s < 5; s++) {
      const st = el('span', { class: 'rep-star', style: `animation-delay:${s * 0.12}s;` });
      st.innerHTML = s < starN ? SVG_STAR : SVG_STAR_O;
      stars.append(st);
    }

    const againBtn = el('button', { class: 'btn big berry rep-endbtn', onclick: () => { sfx.tap(); startPractice(items); } });
    const againIcon = el('span', { class: 'btn-svg' });
    againIcon.innerHTML = SVG_REFRESH;
    againBtn.append(againIcon, ` ${t('rep_again')}`);

    const homeBtn = el('button', { class: 'btn big ghost rep-endbtn', onclick: () => { sfx.tap(); renderHome(); } });
    const homeIcon = el('span', { class: 'btn-svg' });
    homeIcon.innerHTML = SVG_HOME;
    homeBtn.append(homeIcon, ` ${t('rep_home')}`);

    root.innerHTML = '';
    root.append(
      el('div', { class: 'card game-stage rep-end' },
        trophy,
        el('h2', { text: grade }),
        stars,
        el('p', { class: 'rep-avg', text: t('rep_avg', { n: avg }) }),
        el('div', { class: 'rep-endlist' },
          items.map((p, qi) => answers[qi] ? el('div', { class: 'rep-endrow' },
            el('span', { text: p.text }),
            el('span', { class: `rep-score-badge ${scoreCls(answers[qi].score)}`, text: String(answers[qi].score) }),
          ) : null),
        ),
        el('div', { class: 'row', style: 'justify-content:center;margin-top:22px;' }, againBtn, homeBtn),
      ),
    );
  }

  // ---------- 題目 ----------
  async function renderQuestion() {
    const p = items[i];

    root.innerHTML = '';
    const backBtn = el('button', { class: 'icon-btn' });
    backBtn.innerHTML = SVG_BACK;
    backBtn.addEventListener('click', () => { sfx.tap(); exit(); });

    const img = el('img', { alt: '' });
    const figWrap = el('div', { class: 'fig-wrap rep-fig' }, img);

    const tokens = p.text.split(' ');
    const wordEls = tokens.map((tok) => el('span', { class: 'rw', text: tok }));
    const textRow = el('div', { class: 'rep-words' }, wordEls);

    const hint = el('p', { class: 'fc-hint', text: t('rep_listen') });

    const speakBtn = el('button', { class: 'rep-speak' });
    speakBtn.innerHTML = SVG_SPEAKER;
    const scorePill = el('div', { class: 'rep-score hidden' });
    const micBtn = el('button', { class: 'rep-mic' });
    micBtn.innerHTML = SVG_MIC;
    // 錄音中：橘色＋音波動畫；結束還原麥克風圖示
    function setMicRec(on) {
      micBtn.classList.toggle('rec', on);
      micBtn.innerHTML = on ? WAVE_HTML : SVG_MIC;
    }

    // 邊緣箭頭
    const prevEdge = el('button', { class: 'edge-nav left' });
    prevEdge.innerHTML = SVG_CHEV_L;
    const nextEdge = el('button', { class: 'edge-nav right' });

    function refreshEdges() {
      prevEdge.disabled = i === 0;
      const done = !!answers[i];
      nextEdge.disabled = !done;
      const last = i === items.length - 1;
      nextEdge.innerHTML = last ? SVG_TROPHY_SM : SVG_CHEV_R;
      nextEdge.classList.toggle('gold', last);
    }

    const main = el('div', { class: 'rep-main' }, figWrap, scorePill, textRow, hint);

    root.append(
      el('div', { class: 'rep-stage' },
        el('div', { class: 'spread' },
          el('div', { class: 'row' }, backBtn, el('div', { class: 'h1', style: 'margin:0;' }, '🎤 ', t('rep_title'))),
          el('span', { class: 'fc-counter', text: `${i + 1} / ${items.length}` }),
        ),
        main,
        el('div', { class: 'rep-controls' },
          speakBtn,
          el('span', { style: 'flex:1;' }),
          micBtn,
        ),
        prevEdge, nextEdge,
      ),
    );

    // ---- 換題 ----
    function goPrev() {
      if (i === 0) return;
      sfx.tap();
      if (currentRec) { try { currentRec.abort(); } catch { /* noop */ } currentRec = null; }
      i--;
      renderQuestion();
    }
    function goNext() {
      if (!answers[i]) { toast(t('rep_locked'), true); return; }
      sfx.tap();
      if (currentRec) { try { currentRec.abort(); } catch { /* noop */ } currentRec = null; }
      if (i === items.length - 1) { renderEnd(); return; }
      i++;
      renderQuestion();
    }
    prevEdge.addEventListener('click', goPrev);
    nextEdge.addEventListener('click', goNext);

    // 滑動換題
    let touchX = null;
    main.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    main.addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (dx < -60) goNext();
      else if (dx > 60) goPrev();
    }, { passive: true });

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

    // ---- 示範發音（喇叭鍵／點圖／點字都會唸） ----
    let audioBlob = null;
    async function speak() {
      speakBtn.classList.add('playing');
      if (!audioBlob) audioBlob = await getPhraseAudio(p.text);
      if (audioBlob) await playBlob(audioBlob);
      speakBtn.classList.remove('playing');
    }
    speakBtn.addEventListener('click', () => { sfx.tap(); speak(); });
    figWrap.addEventListener('click', () => { sfx.tap(); speak(); });
    textRow.addEventListener('click', () => { sfx.tap(); speak(); });
    setTimeout(speak, 400);

    // ---- 套用結果（可重複刷分） ----
    function showAnswer(a) {
      let wi = 0;
      tokens.forEach((tok, ti) => {
        if (!/[a-zA-Z]/.test(tok)) return;
        const s = a.wordScores[wi++] ?? 0;
        wordEls[ti].classList.remove('g', 'y', 'r', 'pop');
        void wordEls[ti].offsetWidth;
        wordEls[ti].classList.add(scoreCls(s), 'pop');
      });
      scorePill.innerHTML = `${a.score}<span class="unit">${t('rep_score_unit')}</span>`;
      scorePill.className = `rep-score ${scoreCls(a.score)}`;
      if (a.heard) hint.textContent = `👂 ${a.heard}`;
      refreshEdges();
    }
    if (answers[i]) showAnswer(answers[i]);
    refreshEdges();

    // ---- 錄音辨識（麥克風常駐，可重錄刷分） ----
    micBtn.addEventListener('click', () => {
      const SR = srCtor();
      if (!SR) { infoDialog(t('err_title'), t('rep_sr_unavail'), true); return; }
      if (currentRec) { try { currentRec.stop(); } catch { /* noop */ } return; }

      const rec = new SR();
      currentRec = rec;
      rec.lang = 'en-US';
      // iOS Safari 常常在 interimResults=false 時整場不給結果，所以開 interim 收集所有片段
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      const transcripts = new Map(); // text -> 最高信心值（可為 null）
      let safetyTimer = 0;
      let finished = false;

      const keep = (text, conf) => {
        if (!text || !text.trim()) return;
        const prev = transcripts.get(text);
        const c = typeof conf === 'number' && conf > 0 ? conf : null;
        if (prev == null || (c != null && c > prev)) transcripts.set(text, c);
        else if (!transcripts.has(text)) transcripts.set(text, c);
      };

      setMicRec(true);
      hint.textContent = t('rep_mic_stop');
      sfx.tap();

      rec.onresult = (e) => {
        const joined = [];
        let joinedConf = null;
        for (let ri = 0; ri < e.results.length; ri++) {
          for (let ai = 0; ai < e.results[ri].length; ai++) {
            keep(e.results[ri][ai].transcript, e.results[ri][ai].confidence);
          }
          joined.push(e.results[ri][0].transcript);
          const c0 = e.results[ri][0].confidence;
          if (typeof c0 === 'number' && c0 > 0) joinedConf = joinedConf == null ? c0 : Math.min(joinedConf, c0);
        }
        const full = joined.join(' ').trim();
        if (full) keep(full, joinedConf);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(safetyTimer);
        currentRec = null;
        setMicRec(false);
        if (!transcripts.size) {
          toast(t('rep_no_result'), true);
          hint.textContent = t('rep_listen');
          return;
        }
        const list = [...transcripts].map(([text, conf]) => ({ text, conf }));
        const { wordScores, overall } = scoreAttempt(p.text, list);
        const heard = list.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
        answers[i] = { score: overall, wordScores, heard };
        setPhraseStat(p, overall);
        if (overall >= 75) { sfx.correct(); confetti(1000, 50); }
        else if (overall >= 45) sfx.sparkle();
        else sfx.pop();
        showAnswer(answers[i]);
      };
      rec.onerror = (e) => {
        clearTimeout(safetyTimer);
        if (e.error === 'not-allowed') {
          finished = true;
          currentRec = null;
          setMicRec(false);
          infoDialog(t('err_title'), t('rep_sr_denied'), true);
          hint.textContent = t('rep_listen');
        } else if (e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          finished = true;
          currentRec = null;
          setMicRec(false);
          infoDialog(t('err_title'), t('rep_sr_unavail'), true);
          hint.textContent = t('rep_listen');
        } else {
          finish();
        }
      };
      rec.onnomatch = () => finish();
      rec.onend = () => finish();
      safetyTimer = setTimeout(() => { try { rec.stop(); } catch { /* noop */ } }, 15000);
      try { rec.start(); } catch { currentRec = null; setMicRec(false); }
    });
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
  for (let x = 1; x <= m; x++) {
    const cur = [x];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[x - 1] === b[j - 1] ? 0 : 1));
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

/** 詞相似度：優先音素層（同音不冤枉、關鍵音錯了確實扣），查不到的詞退回字母層 */
function simWord(a, b) {
  const pa = phonemesOf(a);
  const pb = phonemesOf(b);
  if (pa && pb) {
    let best = 0;
    for (const x of pa) {
      for (const y of pb) {
        best = Math.max(best, 1 - lev(x, y) / Math.max(x.length, y.length));
      }
    }
    return best;
  }
  return sim(a, b);
}

// 嚴格度設定：門檻 / 各檔分數 / 鼓勵下限 / 多唸扣分 / 信心值權重
const STRICT_CFG = {
  easy: { th: [0.85, 0.55, 0.35, 0.20], pts: [100, 80, 60, 45, 25], floor: 55, extraPen: 0, confW: 0 },
  std:  { th: [0.90, 0.65, 0.45, 0.25], pts: [100, 80, 60, 40, 20], floor: 45, extraPen: 5, confW: 0.3 },
  hard: { th: [0.95, 0.75, 0.55, 0.35], pts: [100, 75, 55, 35, 15], floor: 0,  extraPen: 8, confW: 0.5 },
};

/**
 * 逐詞計分。transcripts: [{text, conf}]，conf 為辨識信心值（0~1，可為 null）。
 * 詞顏色用未加權的 wordScores；總分再乘信心值、扣多唸的字。
 */
export function scoreAttempt(targetText, transcripts) {
  const cfg = STRICT_CFG[settings.repStrict] || STRICT_CFG.std;
  const tw = normWords(targetText);
  const spoken = [...new Set(transcripts.flatMap((tr) => normWords(tr.text)))];
  const wordScores = tw.map((w) => {
    let best = 0;
    for (const s of spoken) best = Math.max(best, simWord(w, s));
    return best >= cfg.th[0] ? cfg.pts[0]
      : best >= cfg.th[1] ? cfg.pts[1]
      : best >= cfg.th[2] ? cfg.pts[2]
      : best >= cfg.th[3] ? cfg.pts[3]
      : cfg.pts[4];
  });
  let overall = Math.round(wordScores.reduce((a, b) => a + b, 0) / (wordScores.length || 1));

  // B：辨識信心值加權（發音含糊時就算轉寫對了信心值也會掉）
  if (cfg.confW > 0) {
    const confs = transcripts.map((x) => x.conf).filter((c) => typeof c === 'number' && c > 0);
    if (confs.length) {
      const c = Math.max(...confs);
      overall = Math.round(overall * (1 - cfg.confW + cfg.confW * c));
    }
  }
  // 多唸一堆無關字的輕度扣分
  if (cfg.extraPen) {
    const extras = spoken.filter((s) => tw.every((w) => simWord(w, s) < 0.5)).length;
    overall -= Math.min(cfg.extraPen * 3, extras * cfg.extraPen);
  }
  // 鼓勵下限
  if (cfg.floor && wordScores.some((s) => s >= 80)) overall = Math.max(overall, cfg.floor);
  overall = Math.max(0, Math.min(100, overall));
  return { wordScores, overall };
}
