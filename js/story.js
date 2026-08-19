// 故事頁：固定插圖＋可翻頁的點讀文字、迷霧、生成新故事、書架
// 顯示時故事文字依語系做繁簡轉換（儲存保持生成當下的字形）
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob, speakNative } from './sfx.js';
import {
  settings, saveSettings, words, isHan, addWords, bumpUsed, bumpRead, setMark,
  stories, addStory, removeStory, getStory, saveStories, currentAccountId,
  idbGet, idbSet, hasAudioCached,
  DEMO_STORY_HANT, DEMO_STORY_HANS,
} from './store.js';
import { generateStory, generateImage, pickImageStyle, ttsChar, findNewChars, detectPolys, errHintKey, setLogListener } from './gemini.js';
import { convertTo, t2s, s2t } from './zhconv.js';
import { playSyllable } from './voice.js';
import { Fog } from './fog.js';

let root = null;
let currentId = null;
let fog = null;
let pageResize = null; // 目前這次 render 的 resize 監聽（重繪前要先移除，避免累積）
let pageRO = null;     // 文字卡尺寸觀察器（插圖載入、安全區、鍵盤等任何版面變動都重算頁高）

export function initStory(rootEl) {
  root = rootEl;
  if (!currentId && stories.length) currentId = stories[0].id;
  render();
  window.addEventListener('resize', () => { if (fog) fog.resize(); });
}

/** 顯示用文字：語系與生成時不同才轉換（避免同語系重複轉換的誤傷） */
function displayText(story, text) {
  const lang = getLang();
  if (story.lang === lang) return text;
  return convertTo(text, lang);
}

/** 顯示字 → 字表原字 的查表（一次建好，點擊時 O(1)；原字形優先於繁簡另一形） */
function buildBankMap() {
  const lang = getLang();
  const map = new Map();
  for (const w of words) map.set(w.ch, w.ch);
  for (const w of words) {
    const d = convertTo(w.ch, lang);
    if (!map.has(d)) map.set(d, w.ch);
  }
  return map;
}

export function render() {
  if (fog) { fog.destroy(); fog = null; }
  if (pageResize) { window.removeEventListener('resize', pageResize); pageResize = null; }
  if (pageRO) { pageRO.disconnect(); pageRO = null; }
  root.innerHTML = '';
  const story = currentId ? getStory(currentId) : null;
  root.classList.toggle('story-fixed', !!story);

  root.append(
    el('div', { class: 'spread', style: 'margin-bottom:16px;' },
      el('div', { class: 'h1', style: 'margin-bottom:0;' }, '📖 ', t('story_title')),
      el('div', { class: 'row' },
        story
          ? el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openReadSettings(story); } }, '⚙️ ', t('read_settings'))
          : null,
        stories.length
          ? el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openShelfModal(); } }, '📚 ', t('shelf_title'))
          : null,
        el('button', { class: 'btn berry', onclick: () => { sfx.tap(); openGenModal(); } }, '✨ ', t('new_story')),
      ),
    ),
  );

  if (!story) {
    root.append(
      el('div', { class: 'card story-empty' },
        el('span', { class: 'emoji', text: '🧚' }),
        ...t('story_empty').split('\n').map((line) => el('p', { text: line })),
        el('button', { class: 'btn big', onclick: () => { sfx.tap(); openGenModal(); } }, '✨ ', t('make_story')),
      ),
    );
    return;
  }

  // ---- 每帳號各自的標註紀錄（舊版全域 highlights → 歸給目前帳號） ----
  if (!story.hlBy) story.hlBy = {};
  if (story.highlights) {
    if (!story.hlBy[currentAccountId]) story.hlBy[currentAccountId] = story.highlights;
    delete story.highlights;
    saveStories();
  }
  if (!story.marksBy) story.marksBy = {};
  const highlights = new Set(story.hlBy[currentAccountId] || []);
  const marks = new Map(Object.entries(story.marksBy[currentAccountId] || {}).map(([k, v]) => [+k, v]));
  const mode = settings.storyMode === 'mark' ? 'mark' : 'hl';

  const dispTitle = displayText(story, story.title);
  const dispText = displayText(story, story.text);
  const dispNew = (story.newChars || []).map((ch) => displayText(story, ch));

  // ---- 左欄：插圖（固定，不隨文字捲動） ----
  const img = el('img', { alt: '' });
  const fogCanvas = el('canvas', { class: 'fogc' });
  const figWrap = el('div', { class: 'fig-wrap' }, img, fogCanvas);
  const fogHint = el('div', { class: 'fog-hint', text: t('fog_hint_locked') });
  const progressFill = el('div', { class: 'progress-fill' });
  const figCard = el('div', { class: 'fig-card' },
    figWrap, fogHint,
    el('div', { class: 'progress-track' }, progressFill),
    dispNew.length
      ? el('div', { class: 'fog-hint', style: 'margin-top:8px;', text: `${t('new_chars')}：${dispNew.join('、')}` })
      : null,
  );

  // ---- 文字區：固定頁高、只靠上一頁/下一頁翻頁（不可手滑、無捲軸、整行完整顯示） ----
  const textWrap = el('div', { class: `story-text${settings.storyFont === 'big' ? ' bigfont' : ''}` });
  const scroll = el('div', { class: 'story-scroll' }, textWrap);
  const textCard = el('div', { class: 'card text-card' }, scroll);
  const upBtn = el('button', { class: 'page-btn', text: '▲' });
  const downBtn = el('button', { class: 'page-btn', text: '▼' });
  const pageInd = el('span', { class: 'page-ind', text: '1 / 1' });

  // 頁高鎖成整行：先算放得下幾行（字塊高 + 10px 基本行距），
  // 再把卡片剩餘高度平均攤進行距（上限 +24px），不留一整行空白；
  // 原生 app 的視窗比 Safari PWA 高一截，取整後餘數曾接近一整行，看起來像多一行空白。
  function tileH() { return settings.storyFont === 'big' ? 108 : 72; }
  let pageRows = 1, rowGap = 10;
  function sizeText() {
    const TILE = tileH();
    const inner = textCard.clientHeight - 24 - 20; // text-card 內距 12×2、story-scroll 內距 10×2
    pageRows = Math.max(1, Math.floor((inner + 10) / (TILE + 10)));
    const spare = inner - (pageRows * TILE + (pageRows - 1) * 10);
    rowGap = pageRows > 1 ? 10 + Math.min(24, Math.max(0, Math.floor(spare / (pageRows - 1)))) : 10;
    textWrap.style.rowGap = `${rowGap}px`;
    scroll.style.height = `${pageRows * (TILE + rowGap) - rowGap + 20}px`;
  }
  function pageStep() { return pageRows * (tileH() + rowGap); }
  function updatePager() {
    const step = pageStep();
    const maxScroll = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    const total = Math.max(1, Math.ceil(maxScroll / step) + (maxScroll > 0 ? 1 : 0)) || 1;
    const cur = Math.min(total, Math.round(scroll.scrollTop / step) + 1);
    pageInd.textContent = `${cur} / ${total}`;
    upBtn.disabled = scroll.scrollTop <= 4;
    downBtn.disabled = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4;
  }
  function flip(dir) {
    const step = pageStep();
    const target = Math.max(0, (Math.round(scroll.scrollTop / step) + dir) * step);
    scroll.scrollTo({ top: target, behavior: 'smooth' });
  }
  upBtn.addEventListener('click', () => { sfx.tap(); flip(-1); });
  downBtn.addEventListener('click', () => { sfx.tap(); flip(1); });
  scroll.addEventListener('scroll', () => requestAnimationFrame(updatePager));
  pageResize = () => { sizeText(); updatePager(); };
  window.addEventListener('resize', pageResize);
  if (typeof ResizeObserver !== 'undefined') {
    let lastH = 0;
    pageRO = new ResizeObserver(() => {
      const h = textCard.clientHeight;
      if (h && h !== lastH) { lastH = h; pageResize(); }
    });
    pageRO.observe(textCard);
  }

  // 直向：圖上字下，最下排按鈕列；橫向：翻頁鈕移到圖片下方（下一頁在左、上一頁在右）
  root.append(el('div', { class: 'story-layout' },
    el('div', { class: 'story-title', text: dispTitle }),
    figCard,
    textCard,
    el('div', { class: 'story-pager' }, downBtn, pageInd, upBtn),
  ));

  // ---- 圖片載入 ----
  loadImage(story, img, figWrap);

  // ---- 文字按鈕 ----
  const hanIndices = [];
  const chars = [...dispText];
  const bankMap = buildBankMap();

  function markCls(mk) {
    return mk === 'green' ? ' mk-g' : mk === 'red' ? ' mk-r' : '';
  }

  chars.forEach((ch, i) => {
    if (ch === '\n') { textWrap.append(el('div', { class: 'linebreak' })); return; }
    if (!isHan(ch)) {
      textWrap.append(el('span', { class: 'punct', text: ch }));
      return;
    }
    hanIndices.push(i);
    const btn = el('button', {
      class: `zi${mode === 'hl' && highlights.has(i) ? ' hl' : ''}${mode === 'mark' ? markCls(marks.get(i)) : ''}`,
      text: ch,
    });

    // 長按：只發音，不改標記（多音字播所屬詞的音）
    let lpTimer = 0, lpFired = false;
    btn.addEventListener('pointerdown', () => {
      lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; speakAt(story, ch, i); }, 500);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
      btn.addEventListener(ev, () => clearTimeout(lpTimer));
    }

    btn.addEventListener('click', () => {
      if (lpFired) { lpFired = false; return; }
      btn.classList.remove('pop');
      void btn.offsetWidth; // 重新觸發動畫
      btn.classList.add('pop');
      const bankCh = bankMap.get(ch) || null;

      if (mode === 'hl') {
        const on = !btn.classList.contains('hl');
        btn.classList.toggle('hl', on);
        if (on) {
          highlights.add(i);
          sfx.tick(); // 極輕提示音：連續點讀時不蓋過唸讀聲
          if (bankCh) bumpRead(bankCh, 1);
          if (settings.storySpeak) speakAt(story, ch, i);
        } else {
          highlights.delete(i);
          sfx.tock();
          if (bankCh) bumpRead(bankCh, -1);
        }
        story.hlBy[currentAccountId] = [...highlights];
      } else {
        // 標註模式：白→綠→紅→白，紅綠都算「讀過」，同步進認字卡（最後標註為準）
        const cur = marks.get(i) || null;
        const next = cur === null ? 'green' : cur === 'green' ? 'red' : null;
        if (next) marks.set(i, next); else marks.delete(i);
        btn.classList.remove('mk-g', 'mk-r');
        if (next) btn.classList.add(next === 'green' ? 'mk-g' : 'mk-r');
        if (next === 'green') sfx.correct();
        else if (next === 'red') sfx.unpop();
        else sfx.tap();
        if (bankCh) setMark(bankCh, next);
        // 發音規則：標綠（已學會）不發音；標紅發音一次幫忙複習；清除不發音
        if (settings.storySpeak && next === 'red') speakAt(story, ch, i);
        story.marksBy[currentAccountId] = Object.fromEntries(marks);
      }
      saveStories();
      updateProgress();
    });
    textWrap.append(btn);
  });

  // ---- 迷霧與進度（高亮模式數高亮；標註模式紅綠都算） ----
  // 閱讀中只推進度條、迷霧不打開；全部讀完才一次揭曉：
  // 迷霧分批散開（配階梯音）→ 圖片放大回彈＋魔法星星＋彩帶＋完成音
  let celebrated = false; // 這次 render 是否已放過揭曉動畫（重開已完成的書不重播）
  function doneCount() {
    return mode === 'hl' ? highlights.size : marks.size;
  }
  function bigCelebrate() {
    figWrap.classList.remove('reveal-bounce');
    void figWrap.offsetWidth;
    figWrap.classList.add('reveal-bounce');
    spawnMagicStars(figWrap);
    sfx.fanfare();
    confetti();
  }
  function celebrate() {
    if (!fog) return;
    fog.revealAll({
      onStep: (i) => sfx.star(i),
      onDone: bigCelebrate,
    });
  }
  // 迷霧解開後點圖可以再放一次特效（1.5 秒冷卻，連點不疊放）
  let lastReplay = 0;
  figWrap.addEventListener('click', () => {
    if (!celebrated) return;
    const now = Date.now();
    if (now - lastReplay < 1500) return;
    lastReplay = now;
    bigCelebrate();
  });
  function updateProgress() {
    const total = hanIndices.length || 1;
    const ratio = doneCount() / total;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (ratio >= 0.999) {
      fogHint.textContent = t('fog_hint_done');
      if (!celebrated) {
        celebrated = true;
        celebrate();
      }
    } else {
      fogHint.textContent = `${t('fog_hint_locked')}（${t('read_progress')} ${doneCount()}/${total}）`;
    }
  }

  requestAnimationFrame(() => {
    fog = new Fog(fogCanvas, story.id);
    // 進場：已完成的書直接亮圖（不重播動畫）；未完成一律全罩迷霧
    const total = hanIndices.length || 1;
    const done = doneCount() >= total;
    fog.revealed = done ? fog.total : 0;
    fog.draw(1);
    fog.canvas.style.opacity = done ? '0' : '1';
    if (done) celebrated = true;
    updateProgress();
    sizeText();
    updatePager();
  });
}

/** 揭曉時灑在插圖上的魔法星星 */
function spawnMagicStars(host) {
  const glyphs = ['✨', '⭐', '🌟'];
  for (let i = 0; i < 12; i++) {
    const s = el('span', { class: 'magic-star', text: glyphs[i % glyphs.length] });
    s.style.left = `${6 + Math.random() * 84}%`;
    s.style.top = `${6 + Math.random() * 84}%`;
    s.style.fontSize = `${22 + Math.random() * 26}px`;
    s.style.animationDelay = `${(Math.random() * 0.45).toFixed(2)}s`;
    host.append(s);
    setTimeout(() => s.remove(), 2200);
  }
}

// ---------- 閱讀設定（集中故事頁的工具鈕） ----------
function openReadSettings(story) {
  const m = openModal(`⚙️ ${t('read_settings')}`);
  const mode = settings.storyMode === 'mark' ? 'mark' : 'hl';

  // 點讀模式
  const modeSeg = el('div', { class: 'seg' });
  const mkMode = (val, label) => {
    const b = el('button', { class: mode === val ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap();
      if (settings.storyMode !== val) {
        settings.storyMode = val;
        saveSettings();
      }
      m.close();
      render();
    });
    return b;
  };
  modeSeg.append(mkMode('hl', `✨ ${t('story_mode_hl')}`), mkMode('mark', `🖍 ${t('story_mode_mark')}`));

  // 字體大小
  const fontSeg = el('div', { class: 'seg' });
  const mkFont = (val, label) => {
    const b = el('button', { class: settings.storyFont === val ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap();
      if (settings.storyFont !== val) {
        settings.storyFont = val;
        saveSettings();
      }
      m.close();
      render();
    });
    return b;
  };
  fontSeg.append(mkFont('small', `🔡 ${t('font_small')}`), mkFont('big', `🔠 ${t('font_big')}`));

  // 點字發音開關（標註模式下：標綠不發音、標紅發音一次）
  const speakSw = el('button', { class: `switch${settings.storySpeak ? ' on' : ''}` });
  speakSw.addEventListener('click', () => {
    sfx.tap();
    settings.storySpeak = !settings.storySpeak;
    saveSettings();
    speakSw.classList.toggle('on', settings.storySpeak);
  });

  m.body.append(
    el('div', { class: 'field-label', text: t('rs_mode') }), modeSeg,
    el('div', { class: 'field-label', text: t('rs_font') }), fontSeg,
    el('div', { class: 'settings-line', style: 'margin-top:14px;' },
      el('span', { text: `🗣️ ${t('rs_speak')}` }), speakSw,
    ),
    el('p', { class: 'settings-note', text: t('rs_speak_note') }),
  );

  // 追加新字：把本篇還沒在字表裡的字（繁體）挑選後加入字表
  m.body.append(
    el('div', { class: 'field-label', text: t('rs_add_new_label') }),
    el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); m.close(); openAddNewChars(story); } },
      '➕ ', t('rs_add_new')),
  );

  m.foot.append(
    el('button', { class: 'btn sky', onclick: () => {
      sfx.tap();
      m.close();
      prepStoryVoice(story);
    } }, '🔊 ', t('prep_voice')),
    el('button', { class: 'btn ghost', onclick: async () => {
      sfx.tap();
      m.close();
      const yes = await confirmDialog(t('story_clear_confirm'));
      if (!yes) return;
      const mode2 = settings.storyMode === 'mark' ? 'mark' : 'hl';
      if (mode2 === 'hl') { if (story.hlBy) delete story.hlBy[currentAccountId]; }
      else if (story.marksBy) delete story.marksBy[currentAccountId];
      saveStories();
      render();
    } }, '🧽 ', t('story_clear')),
  );
}

// ---------- 圖片 ----------
async function loadImage(story, img, figWrap) {
  if (story.hasImage) {
    const blob = await idbGet('images', story.id).catch(() => null);
    if (blob) {
      img.src = URL.createObjectURL(blob);
      return;
    }
  }
  // 沒有圖：畫一張本地漸層插畫底
  img.remove();
  figWrap.style.background = 'linear-gradient(160deg,#BFE3FF 0%,#E8F6E4 55%,#FFF3C9 100%)';
  const deco = el('div', {
    style: 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:110px;',
    text: '🌈',
  });
  figWrap.insertBefore(deco, figWrap.firstChild);
}

// ---------- 書架（modal） ----------
function openShelfModal() {
  const m = openModal(`📚 ${t('shelf_title')}`);
  for (const s of stories) {
    const openBtn = el('button', { class: `book-open${s.id === currentId ? ' current' : ''}` },
      el('span', { text: `📕 ${displayText(s, s.title)}` }),
      el('small', { text: new Date(s.createdAt).toLocaleDateString() }),
    );
    openBtn.addEventListener('click', () => {
      sfx.tap();
      currentId = s.id;
      m.close();
      render();
    });
    const editBtn = el('button', { class: 'book-del book-edit', text: '✏️' });
    editBtn.addEventListener('click', () => {
      sfx.tap();
      openEditStoryModal(s, () => {
        m.close();
        if (currentId === s.id) render();
        openShelfModal();
      });
    });
    const delBtn = el('button', { class: 'book-del', text: '🗑' });
    delBtn.addEventListener('click', async () => {
      sfx.tap();
      const yes = await confirmDialog(t('story_del_confirm'));
      if (yes) {
        await removeStory(s.id);
        if (currentId === s.id) currentId = stories.length ? stories[0].id : null;
        m.close();
        render();
      }
    });
    m.body.append(el('div', { class: 'book-row' }, openBtn, editBtn, delBtn));
  }
}

// ---------- 編輯故事（書架的 ✏️） ----------
// 編輯框固定顯示/輸入繁體（資料核心是繁體，簡體介面顯示時自動轉換）。
// 內文變動後，索引式的點讀/標註紀錄與多音字資料都會失效，一律重設。
function openEditStoryModal(story, onSaved) {
  let imgUrl = null;
  const m = openModal(`✏️ ${t('story_edit')}`, {
    onClose: () => { if (imgUrl) URL.revokeObjectURL(imgUrl); },
  });
  const titleInput = el('input', { class: 'text-input', value: s2t(story.title) });
  const textArea = el('textarea', { class: 'text-area', style: 'min-height:220px;margin-top:4px;' });
  textArea.value = s2t(story.text);

  const saveBtn = el('button', { class: 'btn mint' }, '💾 ', t('acc_save'));
  saveBtn.addEventListener('click', () => {
    sfx.tap();
    const text = textArea.value.trim();
    if (!text || ![...text].some(isHan)) { toast(t('manual_need_text'), true); return; }
    story.title = titleInput.value.trim() || [...text].slice(0, 8).join('');
    story.text = text;
    story.lang = 'zh-Hant';
    story.hlBy = {};
    story.marksBy = {};
    delete story.polys; // 下次開啟重新偵測多音字
    const bankHant = new Set(words.map((w) => convertTo(w.ch, 'zh-Hant')));
    story.newChars = findNewChars(text, bankHant);
    saveStories();
    m.close();
    toast(t('story_edit_done'));
    if (onSaved) onSaved();
  });

  m.body.append(
    el('div', { class: 'field-label', style: 'margin-top:0;', text: t('manual_title_label') }),
    titleInput,
    el('div', { class: 'field-label', text: t('story_edit_text') }),
    textArea,
    el('p', { class: 'settings-note', text: t('story_edit_note') }),
  );
  // 這本的插圖放在最下面，改文字時捲下去就能對照
  if (story.hasImage) {
    const img = el('img', { class: 'edit-story-img', alt: '' });
    m.body.append(img);
    idbGet('images', story.id).then((blob) => {
      if (blob) { imgUrl = URL.createObjectURL(blob); img.src = imgUrl; }
      else img.remove();
    }).catch(() => img.remove());
  }
  m.foot.append(saveBtn);
}

// ---------- 故事元素比例雷達圖（生成面板用） ----------
// 五軸 0~10，頂點可拖；數值存 settings.storyMix（記住上次設定）
function mixRadar() {
  const AXES = [
    { key: 'warm', label: t('mix_warm') },
    { key: 'fun', label: t('mix_fun') },
    { key: 'conflict', label: t('mix_conflict') },
    { key: 'sad', label: t('mix_sad') },
    { key: 'mistake', label: t('mix_mistake') },
  ];
  const mix = Object.assign({ warm: 8, fun: 8, conflict: 2, sad: 0, mistake: 2 }, settings.storyMix);
  settings.storyMix = mix;

  const S = 300, C = S / 2, R = 96;
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const ang = (i) => -Math.PI / 2 + i * (2 * Math.PI / AXES.length);
  const pt = (i, v) => [C + Math.cos(ang(i)) * R * (v / 10), C + Math.sin(ang(i)) * R * (v / 10)];
  const ringPts = (v) => AXES.map((_, i) => pt(i, v).join(',')).join(' ');

  const svg = mk('svg', { viewBox: `0 0 ${S} ${S}`, class: 'mix-radar' });
  svg.append(mk('polygon', { points: ringPts(10), class: 'mr-grid' }));
  svg.append(mk('polygon', { points: ringPts(5), class: 'mr-grid' }));
  AXES.forEach((_, i) => {
    const [x, y] = pt(i, 10);
    svg.append(mk('line', { x1: C, y1: C, x2: x, y2: y, class: 'mr-grid' }));
  });
  const poly = mk('polygon', { class: 'mr-value' });
  svg.append(poly);
  const handles = AXES.map(() => { const c = mk('circle', { r: 11, class: 'mr-handle' }); svg.append(c); return c; });
  const labels = AXES.map((_, i) => {
    const [x, y] = pt(i, 10);
    const l = mk('text', {
      x: C + (x - C) * 1.28, y: C + (y - C) * 1.28,
      class: 'mr-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle',
    });
    svg.append(l);
    return l;
  });

  function update() {
    // 值 0 也留一點半徑，手把不會擠在圓心疊住
    const vis = (a) => Math.max(mix[a.key], 0.5);
    poly.setAttribute('points', AXES.map((a, i) => pt(i, vis(a)).join(',')).join(' '));
    AXES.forEach((a, i) => {
      const [x, y] = pt(i, vis(a));
      handles[i].setAttribute('cx', x);
      handles[i].setAttribute('cy', y);
      labels[i].textContent = `${a.label} ${mix[a.key]}`;
    });
  }
  update();

  // 拖動：以角度找最近的軸，把指標位置投影到該軸算數值
  const toLocal = (e) => {
    const r = svg.getBoundingClientRect();
    const s = S / r.width;
    return [(e.clientX - r.left) * s - C, (e.clientY - r.top) * s - C];
  };
  const angDiff = (a, b) => {
    let d = Math.abs(a - b) % (2 * Math.PI);
    return d > Math.PI ? 2 * Math.PI - d : d;
  };
  let dragI = -1;
  const setFromPointer = (e) => {
    const [x, y] = toLocal(e);
    const v = (x * Math.cos(ang(dragI)) + y * Math.sin(ang(dragI))) / R * 10;
    const nv = Math.max(0, Math.min(10, Math.round(v)));
    if (nv !== mix[AXES[dragI].key]) {
      mix[AXES[dragI].key] = nv;
      update();
    }
  };
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const [x, y] = toLocal(e);
    const pa = Math.atan2(y, x);
    let best = 0, bestD = Infinity;
    AXES.forEach((_, i) => {
      const d = angDiff(pa, ang(i));
      if (d < bestD) { bestD = d; best = i; }
    });
    dragI = best;
    setFromPointer(e);
    try { svg.setPointerCapture(e.pointerId); } catch { /* 合成事件沒有有效 pointerId */ }
  });
  svg.addEventListener('pointermove', (e) => { if (dragI !== -1) setFromPointer(e); });
  const stopDrag = () => { if (dragI !== -1) { dragI = -1; saveSettings(); } };
  svg.addEventListener('pointerup', stopDrag);
  svg.addEventListener('pointercancel', stopDrag);

  const randBtn = el('button', { class: 'btn ghost small', text: `🎲 ${t('mix_random')}` });
  randBtn.addEventListener('click', () => {
    sfx.tap();
    for (const a of AXES) mix[a.key] = (Math.random() * 11) | 0;
    update();
    saveSettings();
  });

  return el('div', { class: 'mix-wrap' }, svg, randBtn);
}

// ---------- 追加新字到字表 ----------
// 候選＝本篇內文的漢字轉繁體後、不在字表（以繁體比對）的字；加入一律用繁體（資料核心）。
// 不沿用 story.newChars（字表變動後會過期），每次重新計算。
function storyNewHant(story) {
  const bankHant = new Set(words.map((w) => convertTo(w.ch, 'zh-Hant')));
  return findNewChars(s2t(story.text || ''), bankHant);
}
function openAddNewChars(story) {
  const cands = storyNewHant(story);
  if (!cands.length) { toast(t('no_new_chars')); return; }
  const m = openModal(`➕ ${t('add_new_title')}`);
  const selected = new Set(cands); // 預設全選，點掉不要的
  const grid = el('div', { class: 'pick-grid' });
  const btns = new Map();
  const okBtn = el('button', { class: 'btn mint' });
  const refresh = () => {
    okBtn.textContent = `✅ ${t('add_new_confirm', { n: selected.size })}`;
    okBtn.disabled = selected.size === 0;
  };
  for (const ch of cands) {
    const btn = el('button', { class: 'pick-zi on', text: convertTo(ch, getLang()) });
    btn.addEventListener('click', () => {
      sfx.tap();
      if (selected.has(ch)) { selected.delete(ch); btn.classList.remove('on'); }
      else { selected.add(ch); btn.classList.add('on'); }
      refresh();
    });
    btns.set(ch, btn);
    grid.append(btn);
  }
  const allBtn = el('button', { class: 'btn ghost small', onclick: () => {
    sfx.tap();
    const all = selected.size < cands.length;
    for (const ch of cands) { if (all) selected.add(ch); else selected.delete(ch); btns.get(ch).classList.toggle('on', all); }
    refresh();
  } }, t('flash_pick_all'));
  refresh();

  m.body.append(
    el('p', { class: 'settings-note', style: 'margin-top:0;', text: t('add_new_hint') }),
    el('div', { class: 'row', style: 'margin-bottom:10px;' }, allBtn),
    grid,
  );
  okBtn.addEventListener('click', () => {
    sfx.tap();
    // 依本篇出現順序加入；只加繁體（cands 本身已是繁體）
    const picked = cands.filter((ch) => selected.has(ch));
    const { added, dup, collide } = addWords(picked.join(''));
    m.close();
    let msg = t('words_added', { n: added });
    if (dup) msg += t('words_dup', { n: dup });
    toast(msg);
    if (collide.length) infoDialog('💡', t('words_collide', { list: collide.join('、') }));
    // 本篇新字清單重算（這些字現在在字表裡了）
    story.newChars = storyNewHant(story);
    saveStories();
    render();
  });
  m.foot.append(
    el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => { sfx.tap(); m.close(); } }),
    okBtn,
  );
}

// ---------- 生成面板 ----------
function openGenModal() {
  const m = openModal(`✨ ${t('gen_title')}`);
  const selected = new Set();

  // 必用字選擇（最近新加的優先）
  const sorted = [...words].sort((a, b) => b.addedAt - a.addedAt);
  const grid = el('div', { class: 'pick-grid' });
  for (const w of sorted) {
    const btn = el('button', { class: 'pick-zi' },
      convertTo(w.ch, getLang()),
      el('span', { class: 'cnt', text: String(w.usedCount) }),
    );
    btn.addEventListener('click', () => {
      sfx.tap();
      if (selected.has(w.ch)) { selected.delete(w.ch); btn.classList.remove('on'); }
      else if (selected.size < 8) { selected.add(w.ch); btn.classList.add('on'); }
    });
    grid.append(btn);
  }

  const todayInput = el('input', {
    class: 'text-input', placeholder: t('gen_today_ph'),
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });

  const promptInput = el('textarea', { class: 'text-area', placeholder: t('gen_extra_ph') });
  const micBtn = el('button', { class: 'mic-btn', text: '🎤' });
  setupMic(micBtn, promptInput);

  // 生成插圖 toggle（記住上次設定）
  const imgSw = el('button', { class: `switch${settings.genImage ? ' on' : ''}` });
  imgSw.addEventListener('click', () => {
    sfx.tap();
    settings.genImage = !settings.genImage;
    saveSettings();
    imgSw.classList.toggle('on', settings.genImage);
  });

  m.body.append(
    el('div', { class: 'field-label', text: `🌱 ${t('gen_today')}` }),
    todayInput,
    el('div', { class: 'field-label', text: t('gen_must') }),
    grid,
    el('div', { class: 'field-label', text: `🎛️ ${t('gen_mix')}` }),
    mixRadar(),
    el('div', { class: 'field-label', text: t('gen_extra') }),
    el('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start;' }, promptInput, micBtn),
    el('div', { class: 'settings-line', style: 'margin-top:12px;' },
      el('span', { text: `🖼️ ${t('gen_image')}` }), imgSw,
    ),
    settings.apiKey ? null : el('p', { class: 'settings-note', text: `⚠️ ${t('demo_mode')}` }),
  );

  m.foot.append(
    el('button', { class: 'btn ghost', onclick: () => {
      sfx.tap();
      m.close();
      openManualModal();
    } }, '📝 ', t('manual_add')),
    el('button', { class: 'btn big berry', onclick: () => {
      if (words.length < 10 && settings.apiKey) {
        toast(t('gen_need_words'), true);
        return;
      }
      sfx.whoosh();
      // 今日新字：直接加入字表，並列為本次必用字
      const todayChars = [...new Set([...todayInput.value].filter(isHan))];
      if (todayChars.length) addWords(todayChars.join(''));
      const must = [...new Set([...todayChars, ...selected])];
      m.close();
      runGeneration(must, promptInput.value.trim());
    } }, '🪄 ', t('gen_go')),
  );
}

// ---------- 手動加入繪本（自己輸入文字＋上傳插圖） ----------
function openManualModal() {
  const m = openModal(`📝 ${t('manual_add')}`);

  const titleInput = el('input', {
    class: 'text-input', placeholder: t('manual_title_ph'),
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  const textInput = el('textarea', {
    class: 'text-area', placeholder: t('manual_text_ph'), style: 'min-height:180px;',
  });

  let imgBlob = null;
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const preview = el('img', {
    alt: '', style: 'display:none;max-width:100%;border-radius:16px;margin-top:10px;',
  });
  const pickBtn = el('button', { class: 'btn ghost small' }, '🖼 ', t('manual_pick_img'));
  pickBtn.addEventListener('click', () => { sfx.tap(); fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      imgBlob = await downscaleImage(file, 1280);
      preview.src = URL.createObjectURL(imgBlob);
      preview.style.display = 'block';
    } catch (e) {
      console.warn(e);
      toast(t('acc_img_fail'), true);
    }
  });

  m.body.append(
    el('div', { class: 'field-label', text: t('manual_title_label') }), titleInput,
    el('div', { class: 'field-label', text: t('manual_text_label') }), textInput,
    el('div', { class: 'field-label', text: t('manual_img_label') }),
    el('div', {}, pickBtn, preview, fileInput),
  );

  m.foot.append(el('button', { class: 'btn big mint', onclick: async () => {
    const text = textInput.value.trim();
    if (!text || ![...text].some(isHan)) { toast(t('manual_need_text'), true); return; }
    sfx.tap();
    const lang = getLang();
    const title = titleInput.value.trim() || [...text].slice(0, 8).join('');
    const bankSet = new Set(words.map((w) => convertTo(w.ch, lang)));
    const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const story = {
      id, title, text, lang,
      createdAt: Date.now(),
      newChars: findNewChars(text, bankSet),
      hasImage: false,
      manual: true,
    };
    if (imgBlob) {
      await idbSet('images', id, imgBlob).catch(() => {});
      story.hasImage = true;
    }
    // 與 AI 生成一致：記錄字表用字次數
    const storySet = new Set([...text]);
    bumpUsed(words.filter((w) => storySet.has(convertTo(w.ch, lang))).map((w) => w.ch));
    await addStory(story);
    currentId = id;
    m.close();
    sfx.sparkle();
    render();
  } }, '💾 ', t('manual_save')));
}

/** 上傳圖縮到最長邊 max（維持比例）回傳 JPEG blob */
function downscaleImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * k));
      canvas.height = Math.max(1, Math.round(img.height * k));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load failed')); };
    img.src = url;
  });
}

// ---------- 語音輸入 ----------
function setupMic(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.addEventListener('click', () => toast(t('voice_unsupported'), true));
    return;
  }
  let rec = null;
  btn.addEventListener('click', () => {
    sfx.tap();
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = getLang() === 'zh-Hans' ? 'zh-CN' : 'zh-TW';
    rec.continuous = true;
    rec.interimResults = false;
    btn.classList.add('rec');
    toast(t('voice_stop'));
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) input.value += e.results[i][0].transcript;
      }
    };
    rec.onend = () => { btn.classList.remove('rec'); rec = null; };
    rec.onerror = () => { btn.classList.remove('rec'); rec = null; };
    rec.start();
  });
}

// ---------- 生成流程 ----------
async function runGeneration(mustInclude, extraPrompt) {
  const m = openModal('', { closable: false });
  const emoji = el('span', { class: 'big-emoji', text: '🧚' });
  const msg = el('p', { text: t('gen_writing') });
  // 進度 log：顯示目前生成到哪個階段；出錯時原因直接留在視窗裡好除錯
  const logBox = el('div', { class: 'gen-log' });
  const addLog = (line) => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    logBox.append(el('div', { class: 'gen-log-line', text: `${hh}:${mm}:${ss} ${line}` }));
    logBox.scrollTop = logBox.scrollHeight;
  };
  setLogListener(addLog);
  m.body.append(el('div', { class: 'loading-scene' }, emoji, msg), logBox);

  // AI 生成一律用繁體（簡體顯示交給 app 轉換，避免混淆）；示範模式沿用語系版本
  const lang = settings.apiKey ? 'zh-Hant' : getLang();
  // 字表換成生成語系的字形給模型（與驗證一致）
  const bankConv = [...new Set(words.map((w) => convertTo(w.ch, lang)))];

  try {
    let title, text, imagePrompt, newChars;

    addLog(t('gen_log_start'));
    if (!settings.apiKey) {
      // 示範模式
      await new Promise((r) => setTimeout(r, 1200));
      const demo = lang === 'zh-Hans' ? DEMO_STORY_HANS : DEMO_STORY_HANT;
      title = demo.title;
      text = demo.text;
      imagePrompt = '';
      newChars = findNewChars(text, new Set(bankConv));
    } else {
      const result = await generateStory({
        knownChars: bankConv,
        mustInclude: mustInclude.map((ch) => convertTo(ch, lang)),
        extraPrompt,
        mix: settings.storyMix,
        wantImage: settings.genImage,
        onStatus: () => { msg.textContent = t('gen_writing'); },
      });
      ({ title, text, newChars } = result);
      imagePrompt = result.imagePrompt;
    }
    addLog(`✅ ${t('gen_log_story_ok')}：「${title}」`);
    if (newChars.length) addLog(`🆕 ${t('gen_log_newchars')}：${newChars.join('、')}`);

    const id = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const story = {
      id, title, text,
      lang,
      createdAt: Date.now(),
      newChars,
      highlights: [],
      hasImage: false,
      demo: !settings.apiKey,
    };

    // 產插圖
    if (settings.apiKey && settings.genImage && imagePrompt) {
      emoji.textContent = '🎨';
      msg.textContent = t('gen_drawing');
      const style = pickImageStyle(); // 風格池隨機選一種，畫風多樣化
      addLog(`🎨 ${t('gen_log_img')}（${settings.imageModel}｜${style.name}）…`);
      try {
        const blob = await generateImage(imagePrompt, style);
        await idbSet('images', id, blob);
        story.hasImage = true;
        addLog(`✅ ${t('gen_log_img_ok')}`);
      } catch (e) {
        console.warn('image failed', e);
        addLog(`⚠️ ${t('gen_log_img_fail')}：${e.message}`);
      }
    } else if (settings.apiKey && !settings.genImage) {
      addLog(`⏭️ ${t('gen_log_img_skip')}`);
    }

    // 記錄用字次數（以生成語系字形比對回字表原字）
    const storySet = new Set([...text]);
    const usedOriginals = words
      .filter((w) => storySet.has(convertTo(w.ch, lang)))
      .map((w) => w.ch);
    bumpUsed(usedOriginals);

    await addStory(story);
    currentId = id;
    setLogListener(null);
    m.close();
    sfx.sparkle();
    render();
  } catch (e) {
    console.error(e);
    setLogListener(null);
    if (e.message === 'NO_KEY') { m.close(); toast(t('api_missing'), true); return; }
    // 失敗時視窗留著，log 保留完整過程好除錯；按「好」才關
    emoji.textContent = '😢';
    if (e.message === 'GEN_FAIL') {
      msg.textContent = t('gen_fail');
      addLog(`❌ ${t('gen_fail')}`);
    } else {
      msg.textContent = t('err_title');
      addLog(`❌ ${e.message}`);
      const hint = errHintKey(e.message);
      if (hint) addLog(`👉 ${t(hint)}`);
    }
    m.foot.append(el('button', { class: 'btn', text: t('ok'), onclick: () => { sfx.tap(); m.close(); } }));
  } finally {
    setLogListener(null);
  }
}

// ---------- 發音 ----------
/** i 位置的字若是多音字（story.polys），回傳所屬詞條目（用儲存字形比對，索引與顯示文字對齊） */
function polyAt(story, i) {
  const chars = [...story.text];
  for (const p of (story.polys || [])) {
    if (p.char !== chars[i]) continue;
    const wchars = [...p.word];
    for (let off = 0; off < wchars.length; off++) {
      if (wchars[off] !== p.char) continue;
      const start = i - off;
      if (start < 0 || start + wchars.length > chars.length) continue;
      if (wchars.every((c, k) => chars[start + k] === c)) return p;
    }
  }
  return null;
}

/**
 * 點讀／長按發音：多音字播所屬詞的音（讀音才正確），其他播單字音。
 * 快取以「儲存原字形」為主 key——繁體是資料核心，簡體顯示只是換皮，
 * 這樣簡體同形字（髮/發 都顯示成 发）也能各播各的正確讀音。
 */
async function speakAt(story, dispCh, i) {
  const p = polyAt(story, i);
  const stored = [...story.text][i] || dispCh;

  // 多音字：播所屬詞（AI 快取 → 內建語音整詞唸，會依詞境選對讀音）
  if (p) {
    if (hasAudioCached(`w:${p.word}`)) {
      const blob = await idbGet('audio', `w:${p.word}`).catch(() => null);
      if (blob) { playBlob(blob); return; }
    }
    speakNative(p.word);
    return;
  }

  // 單字：AI 快取（原字形 → 顯示字形 → 繁簡另一邊）→ 音節庫 → 內建語音
  const key = [stored, dispCh, s2t(stored), t2s(stored)].find(hasAudioCached);
  if (key) {
    const blob = await idbGet('audio', key).catch(() => null);
    if (blob) { playBlob(blob); return; }
  }
  if (playSyllable(stored) || playSyllable(dispCh)) return;
  speakNative(stored);
}

async function prepStoryVoice(story) {
  if (!settings.apiKey) { toast(t('game_need_key'), true); return; }

  const m = openModal('', { closable: false });
  const msg = el('p', { text: t('game_prep') });
  const fill = el('div', { class: 'prep-fill' });
  m.body.append(el('div', { class: 'loading-scene' },
    el('span', { class: 'big-emoji', text: '🔊' }), msg,
    el('div', { class: 'prep-bar' }, fill),
  ));

  // 多音字偵測（每本只做一次，存在 story.polys）＋所屬詞整詞發音
  try {
    if (!story.polys) {
      msg.textContent = t('prep_poly');
      story.polys = await detectPolys(story.text);
      saveStories();
    }
  } catch (e) { console.warn('poly detect failed', e); }

  // 以「儲存原字形」生成與快取（不用顯示字形：簡體同形字會撞 key、送簡體字也會讓 TTS 讀音不準）
  const uniq = [...new Set([...story.text].filter(isHan))];
  const jobs = []; // { key, text }：單字 or 多音字所屬詞
  for (const ch of uniq) {
    const hit = await idbGet('audio', ch).catch(() => null);
    if (!hit) jobs.push({ key: ch, text: ch });
  }
  for (const p of (story.polys || [])) {
    const key = `w:${p.word}`;
    const hit = await idbGet('audio', key).catch(() => null);
    if (!hit && !jobs.some((j) => j.key === key)) jobs.push({ key, text: p.word });
  }
  if (!jobs.length) { m.close(); toast(t('prep_voice_done')); return; }

  let done = 0, fail = 0, lastErr = null;
  const failed = [];
  for (const j of jobs) {
    try {
      const blob = await ttsChar(j.text);
      await idbSet('audio', j.key, blob);
    } catch (e) { fail++; lastErr = e; failed.push(j.text); console.warn('tts failed', j.key, e); }
    done++;
    msg.textContent = `${t('game_prep')} ${done}/${jobs.length}`;
    fill.style.width = `${Math.round((done / jobs.length) * 100)}%`;
  }
  m.close();
  if (fail) {
    // 部分或全部失敗：顯示失敗數量、失敗的字與具體錯誤＋對策
    const hint = lastErr && errHintKey(lastErr.message);
    infoDialog(t('err_title'), [
      t('tts_fail_detail', { n: fail, total: jobs.length }),
      failed.slice(0, 20).join('、') + (failed.length > 20 ? '…' : ''),
      lastErr ? lastErr.message : '',
      hint ? `👉 ${t(hint)}` : '',
      t('tts_fallback_note'),
    ].filter(Boolean).join('\n'), true);
    return;
  }
  toast(t('prep_voice_done'));
}

export function refreshStoryPage() { render(); }
