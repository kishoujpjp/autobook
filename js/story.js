// 故事頁：固定插圖＋可翻頁的點讀文字、迷霧、生成新故事、書架
// 顯示時故事文字依語系做繁簡轉換（儲存保持生成當下的字形）
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob } from './sfx.js';
import {
  settings, saveSettings, words, isHan, addWords, bumpUsed, bumpRead,
  stories, addStory, removeStory, getStory, saveStories,
  idbGet, idbSet,
  DEMO_STORY_HANT, DEMO_STORY_HANS,
} from './store.js';
import { generateStory, generateImage, ttsChar, findNewChars } from './gemini.js';
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

  // ---- 右欄：標題＋可翻頁文字＋控制列 ----
  const textWrap = el('div', { class: `story-text${settings.storyFont === 'big' ? ' bigfont' : ''}` });
  const scroll = el('div', { class: 'story-scroll' }, textWrap);
  const upBtn = el('button', { class: 'page-btn', text: '▲' });
  const downBtn = el('button', { class: 'page-btn', text: '▼' });
  const pageInd = el('span', { class: 'page-ind', text: '1 / 1' });

  // 一次翻「整行」的倍數，避免把字切一半（行高 = 字鈕高 + 10px 間距）
  function rowH() { return settings.storyFont === 'big' ? 118 : 82; }
  function pageStep() {
    const ROW = rowH();
    return Math.max(ROW, Math.floor((scroll.clientHeight - 20) / ROW) * ROW);
  }
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
    // 對齊整行邊界，手動捲動後也能回到不切字的位置
    const target = Math.max(0, (Math.round(scroll.scrollTop / step) + dir) * step);
    scroll.scrollTo({ top: target, behavior: 'smooth' });
  }
  upBtn.addEventListener('click', () => { sfx.tap(); flip(-1); });
  downBtn.addEventListener('click', () => { sfx.tap(); flip(1); });
  scroll.addEventListener('scroll', () => requestAnimationFrame(updatePager));
  window.addEventListener('resize', updatePager);

  // 字體大小切換（顯示的是「切過去會變成」的大小）
  const fontBtn = el('button', { class: 'btn ghost small' });
  function fontBtnLabel() {
    fontBtn.textContent = '';
    fontBtn.append(settings.storyFont === 'big' ? '🔡 ' : '🔠 ',
      t(settings.storyFont === 'big' ? 'font_small' : 'font_big'));
  }
  fontBtnLabel();
  fontBtn.addEventListener('click', () => {
    sfx.tap();
    settings.storyFont = settings.storyFont === 'big' ? 'small' : 'big';
    saveSettings();
    textWrap.classList.toggle('bigfont', settings.storyFont === 'big');
    fontBtnLabel();
    requestAnimationFrame(updatePager);
  });

  const rightCol = el('div', { class: 'text-col' },
    el('div', { class: 'story-title', text: dispTitle }),
    el('div', { class: 'card text-card' }, scroll),
    el('div', { class: 'story-controls' },
      el('button', {
        class: 'btn sky small', onclick: () => { sfx.tap(); prepStoryVoice(dispText); },
      }, '🔊 ', t('prep_voice')),
      fontBtn,
      el('span', { style: 'flex:1;' }),
      upBtn, pageInd, downBtn,
    ),
  );

  root.append(el('div', { class: 'story-layout' },
    el('div', { class: 'fig-col' }, figCard),
    rightCol,
  ));

  // ---- 圖片載入 ----
  loadImage(story, img, figWrap);

  // ---- 文字按鈕 ----
  const highlights = new Set(story.highlights || []);
  const hanIndices = [];
  const chars = [...dispText];

  chars.forEach((ch, i) => {
    if (ch === '\n') { textWrap.append(el('div', { class: 'linebreak' })); return; }
    if (!isHan(ch)) {
      textWrap.append(el('span', { class: 'punct', text: ch }));
      return;
    }
    hanIndices.push(i);
    const btn = el('button', {
      class: `zi${highlights.has(i) ? ' hl' : ''}`,
      text: ch,
    });
    btn.addEventListener('click', () => {
      const on = !btn.classList.contains('hl');
      btn.classList.toggle('hl', on);
      btn.classList.remove('pop');
      void btn.offsetWidth; // 重新觸發動畫
      btn.classList.add('pop');
      const bankCh = bankCharFor(ch);
      if (on) {
        highlights.add(i);
        sfx.pop();
        if (bankCh) bumpRead(bankCh, 1);
        if (settings.tapSpeak) speakIfCached(ch);
      } else {
        highlights.delete(i);
        sfx.unpop();
        if (bankCh) bumpRead(bankCh, -1);
      }
      story.highlights = [...highlights];
      saveStories();
      updateProgress();
    });
    textWrap.append(btn);
  });

  // ---- 迷霧與進度 ----
  function updateProgress() {
    const total = hanIndices.length || 1;
    const ratio = highlights.size / total;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (fog) fog.setRatio(ratio);
    if (ratio >= 0.999) {
      if (fogHint.textContent !== t('fog_hint_done')) {
        fogHint.textContent = t('fog_hint_done');
        sfx.fanfare();
        confetti();
      }
    } else {
      fogHint.textContent = `${t('fog_hint_locked')}（${t('read_progress')} ${highlights.size}/${total}）`;
    }
  }

  requestAnimationFrame(() => {
    fog = new Fog(fogCanvas, story.id);
    // 進場時直接顯示既有進度（不做動畫堆疊）
    const total = hanIndices.length || 1;
    fog.revealed = Math.floor(fog.total * (highlights.size / total));
    if (highlights.size >= total) fog.revealed = fog.total;
    fog.draw(1);
    fog.canvas.style.opacity = fog.revealed >= fog.total ? '0' : '1';
    updateProgress();
    updatePager();
  });
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
      w.ch,
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

  const lang = getLang();
  // 字表換成目前語系的字形給模型（顯示與驗證一致）
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
    else if (e.message === 'GEN_FAIL') toast(t('gen_fail'), true);
    else infoDialog(t('err_title'), `${e.message}${t('err_hint')}`, true);
  }
}

// ---------- 發音 ----------
async function speakIfCached(ch) {
  let blob = await idbGet('audio', ch).catch(() => null);
  if (!blob) {
    // 換一種字形再找（快取可能是在另一語系下準備的）
    const alt = getLang() === 'zh-Hans' ? s2t(ch) : t2s(ch);
    if (alt !== ch) blob = await idbGet('audio', alt).catch(() => null);
  }
  if (blob) playBlob(blob);
}

async function prepStoryVoice(dispText) {
  if (!settings.apiKey) { toast(t('game_need_key'), true); return; }
  const uniq = [...new Set([...dispText].filter(isHan))];
  const missing = [];
  for (const ch of uniq) {
    const hit = await idbGet('audio', ch).catch(() => null);
    if (!hit) missing.push(ch);
  }
  if (!missing.length) { toast(t('prep_voice_done')); return; }

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

export function refreshStoryPage() { render(); }
