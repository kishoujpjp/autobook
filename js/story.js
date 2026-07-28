// 故事頁：固定插圖＋可翻頁的點讀文字、迷霧、生成新故事、書架
// 顯示時故事文字依語系做繁簡轉換（儲存保持生成當下的字形）
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob, speakNative } from './sfx.js';
import {
  settings, saveSettings, words, isHan, addWords, bumpUsed, bumpRead, setMark,
  stories, addStory, removeStory, getStory, saveStories, currentAccountId,
  idbGet, idbSet,
  DEMO_STORY_HANT, DEMO_STORY_HANS,
} from './store.js';
import { generateStory, generateImage, ttsChar, findNewChars, detectPolys, errHintKey } from './gemini.js';
import { convertTo, t2s, s2t } from './zhconv.js';
import { Fog } from './fog.js';

let root = null;
let currentId = null;
let fog = null;

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

/** 點到的顯示字 → 字表裡對應的原字（找不到回傳 null） */
function bankCharFor(dispCh) {
  const lang = getLang();
  const w = words.find((x) => x.ch === dispCh || convertTo(x.ch, lang) === dispCh);
  return w ? w.ch : null;
}

export function render() {
  if (fog) { fog.destroy(); fog = null; }
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

  // 行高 = 字鈕高 + 10px 間距；頁高鎖成整行的倍數，字不會被切到或溢出邊緣
  function rowH() { return settings.storyFont === 'big' ? 118 : 82; }
  let pageRows = 1;
  function sizeText() {
    const ROW = rowH();
    const avail = textCard.clientHeight - 24; // text-card 內距 12×2
    pageRows = Math.max(1, Math.floor((avail - 10) / ROW)); // story-scroll 內距 10×2，行間距抵掉一半
    scroll.style.height = `${pageRows * ROW + 10}px`;
  }
  function pageStep() { return pageRows * rowH(); }
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
  window.addEventListener('resize', () => { sizeText(); updatePager(); });

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
      const bankCh = bankCharFor(ch);

      if (mode === 'hl') {
        const on = !btn.classList.contains('hl');
        btn.classList.toggle('hl', on);
        if (on) {
          highlights.add(i);
          sfx.pop();
          if (bankCh) bumpRead(bankCh, 1);
          if (settings.tapSpeak) speakAt(story, ch, i);
        } else {
          highlights.delete(i);
          sfx.unpop();
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
        if (settings.tapSpeak && next) speakAt(story, ch, i);
        story.marksBy[currentAccountId] = Object.fromEntries(marks);
      }
      saveStories();
      updateProgress();
    });
    textWrap.append(btn);
  });

  // ---- 迷霧與進度（高亮模式數高亮；標註模式紅綠都算，迷霧隨白字減少而打開） ----
  function doneCount() {
    return mode === 'hl' ? highlights.size : marks.size;
  }
  function updateProgress() {
    const total = hanIndices.length || 1;
    const ratio = doneCount() / total;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (fog) fog.setRatio(ratio);
    if (ratio >= 0.999) {
      if (fogHint.textContent !== t('fog_hint_done')) {
        fogHint.textContent = t('fog_hint_done');
        sfx.fanfare();
        confetti();
      }
    } else {
      fogHint.textContent = `${t('fog_hint_locked')}（${t('read_progress')} ${doneCount()}/${total}）`;
    }
  }

  requestAnimationFrame(() => {
    fog = new Fog(fogCanvas, story.id);
    // 進場時直接顯示既有進度（不做動畫堆疊）
    const total = hanIndices.length || 1;
    fog.revealed = Math.floor(fog.total * (doneCount() / total));
    if (doneCount() >= total) fog.revealed = fog.total;
    fog.draw(1);
    fog.canvas.style.opacity = fog.revealed >= fog.total ? '0' : '1';
    updateProgress();
    sizeText();
    updatePager();
  });
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

  m.body.append(
    el('div', { class: 'field-label', text: t('rs_mode') }), modeSeg,
    el('div', { class: 'field-label', text: t('rs_font') }), fontSeg,
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
    m.body.append(el('div', { class: 'book-row' }, openBtn, delBtn));
  }
}

// ---------- 生成面板 ----------
function openGenModal() {
  if (words.length < 10 && settings.apiKey) {
    toast(t('gen_need_words'), true);
    return;
  }

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

  m.body.append(
    el('div', { class: 'field-label', text: `🌱 ${t('gen_today')}` }),
    todayInput,
    el('div', { class: 'field-label', text: t('gen_must') }),
    grid,
    el('div', { class: 'field-label', text: t('gen_extra') }),
    el('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start;' }, promptInput, micBtn),
    settings.apiKey ? null : el('p', { class: 'settings-note', text: `⚠️ ${t('demo_mode')}` }),
  );

  m.foot.append(
    el('button', { class: 'btn big berry', onclick: () => {
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
  m.body.append(el('div', { class: 'loading-scene' }, emoji, msg));

  // AI 生成一律用繁體（簡體顯示交給 app 轉換，避免混淆）；示範模式沿用語系版本
  const lang = settings.apiKey ? 'zh-Hant' : getLang();
  // 字表換成生成語系的字形給模型（與驗證一致）
  const bankConv = [...new Set(words.map((w) => convertTo(w.ch, lang)))];

  try {
    let title, text, imagePrompt, newChars;

    if (!settings.apiKey) {
      // 示範模式
      await new Promise((r) => setTimeout(r, 1200));
      const demo = lang === 'zh-Hans' ? DEMO_STORY_HANS : DEMO_STORY_HANT;
      title = demo.title;
      text = demo.text;
      imagePrompt = '';
      newChars = findNewChars(text, new Set(bankConv));
    } else {
      // 優先使用次數少的字
      const priority = [...words]
        .sort((a, b) => a.usedCount - b.usedCount)
        .slice(0, 15)
        .map((w) => convertTo(w.ch, lang))
        .filter((ch) => !mustInclude.includes(ch));

      const result = await generateStory({
        knownChars: bankConv,
        mustInclude: mustInclude.map((ch) => convertTo(ch, lang)),
        priority,
        extraPrompt,
        lang,
        onStatus: () => { msg.textContent = t('gen_writing'); },
      });
      ({ title, text, newChars } = result);
      imagePrompt = result.imagePrompt;
    }

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
    if (settings.apiKey && imagePrompt) {
      emoji.textContent = '🎨';
      msg.textContent = t('gen_drawing');
      try {
        const blob = await generateImage(imagePrompt);
        await idbSet('images', id, blob);
        story.hasImage = true;
      } catch (e) {
        console.warn('image failed', e);
      }
    }

    // 記錄用字次數（以生成語系字形比對回字表原字）
    const storySet = new Set([...text]);
    const usedOriginals = words
      .filter((w) => storySet.has(convertTo(w.ch, lang)))
      .map((w) => w.ch);
    bumpUsed(usedOriginals);

    await addStory(story);
    currentId = id;
    m.close();
    sfx.sparkle();
    render();
  } catch (e) {
    console.error(e);
    m.close();
    if (e.message === 'NO_KEY') toast(t('api_missing'), true);
    else if (e.message === 'GEN_FAIL') {
      // 附上每次嘗試失敗的原因（JSON 壞掉／缺欄位／表外字太多）
      infoDialog(t('err_title'), `${t('gen_fail')}${e.detail ? `\n\n${e.detail}` : ''}`, true);
    } else {
      const hint = errHintKey(e.message);
      infoDialog(t('err_title'), `${e.message}${hint ? `\n👉 ${t(hint)}` : ''}${t('err_hint')}`, true);
    }
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
  if (p) {
    const blob = await idbGet('audio', `w:${p.word}`).catch(() => null);
    if (blob) { playBlob(blob); return; }
  }
  const stored = [...story.text][i] || dispCh;
  // 依序找：原字形 → 顯示字形 → 繁簡另一邊（涵蓋舊版以顯示字形建立的快取）
  for (const key of new Set([stored, dispCh, s2t(stored), t2s(stored)])) {
    const blob = await idbGet('audio', key).catch(() => null);
    if (blob) { playBlob(blob); return; }
  }
  speakNative(stored); // AI 語音缺檔：用裝置內建語音頂上，保證有聲音
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
