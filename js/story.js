// 故事頁：圖片／影片＋可翻頁的點讀文字、迷霧、生成新故事、書架
// 兩種版面（設定→閱讀版面）：
//   side  圖文並排（舊版）：插圖蓋著迷霧放在旁邊，讀完迷霧散開
//   focus 專注閱讀：讀的時候整頁都是字，讀完才用特效打開一個童話外框的大圖片框
// 一本書可以放多組圖片／影片，讀完一遍換下一組（讀完最後一組之後固定用最後一組）
// 顯示時故事文字依語系做繁簡轉換（儲存保持生成當下的字形）
import { t, getLang } from './i18n.js';
import { el, toast, openModal, confirmDialog, infoDialog, confetti } from './ui.js';
import { sfx, playBlob, speakNative } from './sfx.js';
import {
  settings, saveSettings, words, isHan, addWords, bumpUsed, bumpRead, setMark, getCard, currentAccount,
  stories, addStory, removeStory, getStory, saveStories, currentAccountId,
  storyMedia, setStoryMedia, newMediaId, deleteMediaBlob, storyReads, bumpStoryReads,
  idbGet, idbSet, hasAudioCached, isKid, shelfVictim, MAX_STORIES,
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
let mediaView = null;  // 目前顯示的圖片／影片元件（重繪前要停播）
let stageEl = null;    // 專注版面的揭曉舞台（童話外框）
let objUrls = [];      // 這次 render 建立的 blob URL，重繪前釋放
let celebrateSeq = 0;  // 揭曉動畫的世代編號：重繪後舊的計時器就作廢
let autoTimer = 0;     // 自動翻頁的倒數（重繪或再點字都要取消）
let completeNow = null;// 目前這次 render 的「直接完成」動作（閱讀設定的按鈕用）

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
  celebrateSeq++;
  completeNow = null;
  clearTimeout(autoTimer);
  closeStage();
  if (mediaView) { mediaView.destroy(); mediaView = null; }
  for (const u of objUrls) URL.revokeObjectURL(u);
  objUrls = [];
  if (fog) { fog.destroy(); fog = null; }
  if (pageResize) { window.removeEventListener('resize', pageResize); pageResize = null; }
  if (pageRO) { pageRO.disconnect(); pageRO = null; }
  root.innerHTML = '';
  const story = currentId ? getStory(currentId) : null;
  root.classList.toggle('story-fixed', !!story);
  // 小孩帳號：頁首只留書架。閱讀設定（含編輯、重置、媒體管理）與生成都是家長的事。
  const kid = isKid();

  root.append(
    el('div', { class: 'spread', style: 'margin-bottom:16px;' },
      el('div', { class: 'h1', style: 'margin-bottom:0;' }, '📖 ', t('story_title')),
      el('div', { class: 'row' },
        story && !kid
          ? el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openReadSettings(story); } }, '⚙️ ', t('read_settings'))
          : null,
        stories.length
          ? el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); openShelfModal(); } }, '📚 ', t('shelf_title'))
          : null,
        kid
          ? null
          : el('button', { class: 'btn berry', onclick: () => { sfx.tap(); openGenModal(); } }, '✨ ', t('new_story')),
      ),
    ),
  );

  if (!story) {
    root.append(
      el('div', { class: 'card story-empty' },
        el('span', { class: 'emoji', text: '🧚' }),
        ...t(kid ? 'story_empty_kid' : 'story_empty').split('\n').map((line) => el('p', { text: line })),
        kid ? null : el('button', { class: 'btn big', onclick: () => { sfx.tap(); openGenModal(); } }, '✨ ', t('make_story')),
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

  const chars = [...dispText];
  const hanTotal = chars.filter(isHan).length || 1;
  // 書名的字也可以點讀，索引用負的（-1, -2…）跟內文分開；
  // 進度與「讀完整本」只算內文，點不點書名都不影響（舊書的進度紀錄也不會被改變意義）
  function doneCount() {
    let n = 0;
    if (mode === 'hl') { for (const i of highlights) if (i >= 0) n++; }
    else { for (const i of marks.keys()) if (i >= 0) n++; }
    return n;
  }

  // ---- 這一遍要打開的圖片／影片 ----
  // 讀完 N 遍＝已打開前 N 組；還沒讀完＝正在解第 N+1 組。
  // 讀完的當下不換（reads 加 1、completed 也變 true，index 不動），下次重開這本才換下一組。
  const layout = settings.storyLayout === 'focus' ? 'focus' : 'side';
  const media = storyMedia(story);
  const completed = doneCount() >= hanTotal;
  const slot = Math.max(0, (completed ? storyReads(story) - 1 : storyReads(story)));
  const mediaIdx = media.length ? Math.min(media.length - 1, slot) : -1;
  mediaView = createMediaView(mediaIdx >= 0 ? media[mediaIdx] : null);

  const fogCanvas = el('canvas', { class: 'fogc' });
  const figWrap = el('div', { class: 'fig-wrap' }, mediaView.el, fogCanvas);

  // 進度條、本篇新字、動作鈕：兩種版面共用。
  // 提示文字直接印在進度條上（省一整行），而且進度條不能點——
  // 讓「緊鄰翻頁鈕的東西永遠是不可點的進度條」，小孩戳翻頁鈕不會誤觸功能鈕。
  const progressText = el('span', { class: 'progress-text' });
  const progressFill = el('div', { class: 'progress-fill' });
  const progressTrack = el('div', { class: 'progress-track' }, progressFill, progressText);
  const newRow = dispNew.length
    ? el('div', { class: 'new-chars' },
      el('span', { class: 'nc-label', text: `${t('new_chars')}：` }),
      ...dispNew.map((ch) => {
        const b = el('button', { class: 'nc-zi', text: ch });
        b.addEventListener('click', () => { sfx.tap(); speakChar(story, ch); });
        return b;
      }))
    : null;

  const slotChip = el('span', { class: 'chip slot' });
  const againBtn = el('button', { class: 'btn mint small' });
  const replayBtn = el('button', { class: 'btn sky small' });
  replayBtn.addEventListener('click', () => { sfx.tap(); openStage(mediaView); });
  // 再讀一遍：清掉這本在目前模式的紀錄，重讀就能打開下一組圖片／影片
  againBtn.addEventListener('click', () => {
    sfx.tap();
    if (mode === 'hl') { if (story.hlBy) delete story.hlBy[currentAccountId]; }
    else if (story.marksBy) delete story.marksBy[currentAccountId];
    saveStories();
    render();
  });
  function refreshActs() {
    const done = doneCount() >= hanTotal;
    const reads = storyReads(story);
    againBtn.hidden = !done;
    againBtn.textContent = `🔁 ${t('story_again')}`; // 還剩幾個沒打開看旁邊的 chip，按鈕留短的才排得下
    replayBtn.hidden = !(done && layout === 'focus');
    replayBtn.textContent = `🖼 ${t('media_replay')}`;
    slotChip.hidden = media.length < 2;
    slotChip.textContent = t('media_unlocked', { a: Math.min(reads, media.length), b: media.length });
  }
  const actsRow = el('div', { class: 'meta-acts' }, slotChip, replayBtn, againBtn);

  // ---- 文字區：固定頁高、只靠上一頁/下一頁翻頁（不可手滑、無捲軸、整行完整顯示） ----
  const textWrap = el('div', { class: `story-text${settings.storyFont === 'big' ? ' bigfont' : ''}` });
  // 專注版面：書名當文字框的第一行（不另外佔一列），內文從第二行開始。
  // 書名的字跟內文一樣是可點的字塊（點了會唸），只是不計進度。
  // 整行高度鎖成一個字塊高，翻頁的整行對齊才不會跑掉；虛線分隔畫在行距裡（::after）。
  const titleLine = layout === 'focus' ? el('div', { class: 'story-title-line' }) : null;
  const titleTiles = []; // 書名的字塊與標點，寬度依可用寬度自動縮
  if (titleLine) textWrap.append(titleLine);
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
    if (titleLine) {
      titleLine.style.height = `${TILE}px`;
      sizeTitle(TILE);
    }
  }
  /** 書名字塊：最大跟內文一樣大，太長就等比縮到排得下（不換行、不裁字） */
  function sizeTitle(TILE) {
    if (!titleTiles.length) return;
    const avail = (scroll.clientWidth || textCard.clientWidth) - 20 - 16 - 4; // scroll 內距、title 內距
    const gaps = (titleTiles.length - 1) * 8;
    const size = Math.max(24, Math.min(TILE, Math.floor((avail - gaps) / titleTiles.length)));
    for (const n of titleTiles) {
      const wide = n.classList.contains('punct');
      n.style.width = `${Math.round(size * (wide ? 0.55 : 1))}px`;
      n.style.height = `${size}px`;
      n.style.fontSize = `${Math.round(size * (wide ? 0.55 : 0.6))}px`;
      if (!wide) n.style.borderRadius = `${Math.round(size * 0.26)}px`;
    }
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
    clearTimeout(autoTimer);
    const step = pageStep();
    const target = Math.max(0, (Math.round(scroll.scrollTop / step) + dir) * step);
    scroll.scrollTo({ top: target, behavior: 'smooth' });
  }
  upBtn.addEventListener('click', () => { sfx.tap(); flip(-1); });
  downBtn.addEventListener('click', () => { sfx.tap(); flip(1); });

  // 自動翻頁（閱讀設定裡的開關）：目前這一頁的字全部點過就等 2 秒翻下一頁。
  // 每點一次字都重新評估：取消掉之前排的，條件還成立才重排（取消標記也會跟著取消倒數）。
  const ziBtns = []; // { btn, i }：算「這一頁的字讀完了沒」要用
  function isDone(i) { return mode === 'hl' ? highlights.has(i) : marks.has(i); }
  function pageDone() {
    const top = scroll.getBoundingClientRect().top;
    const h = scroll.clientHeight;
    let any = false;
    for (const { btn, i } of ziBtns) {
      const y = btn.getBoundingClientRect().top - top;
      if (y < -2 || y >= h - 2) continue; // 不在目前這一頁
      any = true;
      if (!isDone(i)) return false;
    }
    return any;
  }
  function scheduleAutoPage() {
    clearTimeout(autoTimer);
    if (!settings.autoPage || downBtn.disabled) return;
    if (!pageDone()) return;
    autoTimer = setTimeout(() => { sfx.tap(); flip(1); }, 2000);
  }
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

  const pager = el('div', { class: 'story-pager' }, downBtn, pageInd, upBtn);
  if (layout === 'focus') {
    // 專注閱讀：整頁都是文字框（書名就是第一行），下面一條頁尾——
    // 上排是不可點的進度條，下排左邊擺功能（新字、動作鈕）、右邊擺翻頁鈕，
    // 兩群左右拉開，小孩戳翻頁不會掃到功能鈕。
    root.append(el('div', { class: 'story-layout focus' },
      textCard,
      el('div', { class: 'story-foot' },
        progressTrack,
        el('div', { class: 'foot-row' },
          el('div', { class: 'foot-left' }, actsRow, newRow),
          pager,
        ),
      ),
    ));
  } else {
    // 直向：圖上字下，最下排按鈕列；橫向：翻頁鈕移到圖片下方（下一頁在左、上一頁在右）
    // 圖卡裡把進度條放到最後：緊鄰翻頁鈕的是不可點的進度條，功能鈕都在它上面。
    root.append(el('div', { class: 'story-layout' },
      el('div', { class: 'story-title', text: dispTitle }),
      el('div', { class: 'fig-card' }, figWrap, actsRow, newRow, progressTrack),
      textCard,
      pager,
    ));
  }

  // ---- 文字按鈕 ----
  const hanIndices = [];
  const bankMap = buildBankMap();

  function markCls(mk) {
    return mk === 'green' ? ' mk-g' : mk === 'red' ? ' mk-r' : '';
  }

  /**
   * 一個可點的字塊。書名與內文共用同一套高亮／標註規則，只差在索引空間：
   * 內文用 0..n（就是字在內文的位置），書名用 -1, -2…（不計進度）。
   * speak 是這個字要怎麼唸（內文會查多音字，書名唸單字）。
   */
  function makeZi(ch, idx, speak) {
    const btn = el('button', {
      class: `zi${mode === 'hl' && highlights.has(idx) ? ' hl' : ''}${mode === 'mark' ? markCls(marks.get(idx)) : ''}`,
      text: ch,
    });

    // 長按：只發音，不改標記
    let lpTimer = 0, lpFired = false;
    btn.addEventListener('pointerdown', () => {
      lpFired = false;
      lpTimer = setTimeout(() => { lpFired = true; speak(); }, 500);
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
          highlights.add(idx);
          sfx.tick(); // 極輕提示音：連續點讀時不蓋過唸讀聲
          if (bankCh) bumpRead(bankCh, 1);
          if (settings.storySpeak) speak();
        } else {
          highlights.delete(idx);
          sfx.tock();
          if (bankCh) bumpRead(bankCh, -1);
        }
        story.hlBy[currentAccountId] = [...highlights];
      } else {
        // 標註模式：白→綠→紅→白，紅綠都算「讀過」，同步進認字卡（最後標註為準）
        const cur = marks.get(idx) || null;
        const next = cur === null ? 'green' : cur === 'green' ? 'red' : null;
        if (next) marks.set(idx, next); else marks.delete(idx);
        btn.classList.remove('mk-g', 'mk-r');
        if (next) btn.classList.add(next === 'green' ? 'mk-g' : 'mk-r');
        if (next === 'green') sfx.correct();
        else if (next === 'red') sfx.unpop();
        else sfx.tap();
        if (bankCh) setMark(bankCh, next);
        // 發音規則：標綠（已學會）不發音；標紅發音一次幫忙複習；清除不發音
        if (settings.storySpeak && next === 'red') speak();
        story.marksBy[currentAccountId] = Object.fromEntries(marks);
      }
      saveStories();
      updateProgress();
      scheduleAutoPage();
    });
    return btn;
  }

  // 書名：一排跟內文同款的字塊（點了會唸），不進 ziBtns 所以不影響「這一頁讀完了沒」
  if (titleLine) {
    const storedTitle = [...(story.title || '')];
    [...dispTitle].forEach((ch, k) => {
      if (!isHan(ch)) {
        const sp = el('span', { class: 'punct', text: ch });
        titleLine.append(sp);
        titleTiles.push(sp);
        return;
      }
      const stored = storedTitle[k] || ch;
      const btn = makeZi(ch, -(k + 1), () => speakOne(stored, ch));
      titleLine.append(btn);
      titleTiles.push(btn);
    });
  }

  chars.forEach((ch, i) => {
    if (ch === '\n') { textWrap.append(el('div', { class: 'linebreak' })); return; }
    if (!isHan(ch)) {
      textWrap.append(el('span', { class: 'punct', text: ch }));
      return;
    }
    hanIndices.push(i);
    const btn = makeZi(ch, i, () => speakAt(story, ch, i));
    textWrap.append(btn);
    ziBtns.push({ btn, i });
  });

  // ---- 進度與揭曉（高亮模式數高亮；標註模式紅綠都算） ----
  // 閱讀中只推進度條，圖片不打開；全部讀完才一次揭曉：
  //   並排版面：迷霧分批散開（配階梯音）→ 圖片放大回彈＋魔法星星＋彩帶＋完成音
  //   專注版面：星星階梯音 → 童話外框的圖片框從中央彈出＋魔法星星＋彩帶＋完成音
  let celebrated = false; // 這次 render 是否已放過揭曉動畫（重開已完成的書不重播）
  const mySeq = celebrateSeq;
  function bigCelebrate() {
    if (mySeq !== celebrateSeq) return;
    replayBtn.hidden = layout !== 'focus';
    if (layout === 'focus') { openStage(mediaView); return; }
    figWrap.classList.remove('reveal-bounce');
    void figWrap.offsetWidth;
    figWrap.classList.add('reveal-bounce');
    spawnMagicStars(figWrap);
    sfx.fanfare();
    confetti();
    mediaView.start();
  }
  function celebrate() {
    if (layout === 'focus') {
      // 沒有迷霧可以散，改用星星階梯音帶出圖片框
      let i = 0;
      const tick = () => {
        if (mySeq !== celebrateSeq) return;
        sfx.star(i);
        if (++i < 4) setTimeout(tick, 150);
        else setTimeout(bigCelebrate, 260);
      };
      tick();
      return;
    }
    if (!fog) return;
    fog.revealAll({
      onStep: (i) => sfx.star(i),
      onDone: bigCelebrate,
    });
  }
  // 迷霧解開後點圖可以再放一次特效（1.5 秒冷卻，連點不疊放）
  let lastReplay = 0;
  figWrap.addEventListener('click', (e) => {
    if (!celebrated) return;
    if (mediaView.kind === 'video') return;       // 影片正在播，不要被特效打斷
    if (e.target.closest('.media-sound')) return; // 影片的喇叭鈕不算
    const now = Date.now();
    if (now - lastReplay < 1500) return;
    lastReplay = now;
    bigCelebrate();
  });
  const hintKey = layout === 'focus' ? 'focus_hint' : 'fog_hint';
  function updateProgress() {
    const ratio = doneCount() / hanTotal;
    progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (ratio >= 0.999) {
      progressText.textContent = t(`${hintKey}_done`);
      if (!celebrated) {
        celebrated = true;
        bumpStoryReads(story); // 讀完一遍：下次重開這本就換下一組圖片／影片
        celebrate();
      }
    } else {
      progressText.textContent = `${t(`${hintKey}_locked`)} ${doneCount()}/${hanTotal}`;
    }
    refreshActs();
  }

  // 閱讀設定的「直接完成」：把這一輪還沒標的字一次補滿，之後走跟真的讀完一模一樣的路徑
  // （進度滿 → 計一次讀完 → 揭曉特效 → 已打開 +1）。
  // 刻意不寫字表的紅綠紀錄與點讀次數——這是大人用的捷徑，不是小孩真的認得這些字。
  completeNow = () => {
    for (const { btn, i } of ziBtns) {
      if (mode === 'hl') { highlights.add(i); btn.classList.add('hl'); }
      else if (!marks.has(i)) { marks.set(i, 'green'); btn.classList.add('mk-g'); }
    }
    if (mode === 'hl') story.hlBy[currentAccountId] = [...highlights];
    else story.marksBy[currentAccountId] = Object.fromEntries(marks);
    saveStories();
    updateProgress();
  };

  refreshActs(); // 先填好文字與顯示狀態，等 rAF 才填會閃一下空按鈕

  requestAnimationFrame(() => {
    if (layout !== 'focus') {
      fog = new Fog(fogCanvas, story.id);
      // 進場：已完成的書直接亮圖（不重播動畫）；未完成一律全罩迷霧
      fog.revealed = completed ? fog.total : 0;
      fog.draw(1);
      fog.canvas.style.opacity = completed ? '0' : '1';
      if (completed) mediaView.start();
    }
    if (completed) celebrated = true;
    updateProgress();
    sizeText();
    updatePager();
  });
}

// ---------- 圖片／影片 ----------
/**
 * YouTube／Vimeo 連結 → 可自動靜音循環播放的嵌入網址；其他連結回傳 null（當成直接檔案播）。
 * 兒童產品的加固：用 youtube-nocookie、關掉控制列／鍵盤／全螢幕／註解，
 * 再配合 iframe 的 sandbox（不給跳頁、不給彈窗）與蓋在上面的透明遮罩（.media-shield），
 * 小孩點到影片標題或 logo 不會跳出 App 進 YouTube。
 */
function embedUrl(url) {
  if (!url) return null;
  const yt = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) {
    return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&loop=1&playlist=${yt[1]}`
      + '&playsinline=1&rel=0&controls=0&modestbranding=1&disablekb=1&fs=0&iv_load_policy=3';
  }
  const vm = String(url).match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) {
    return `https://player.vimeo.com/video/${vm[1]}?autoplay=1&muted=1&loop=1&playsinline=1`
      + '&controls=0&title=0&byline=0&portrait=0&dnt=1';
  }
  return null;
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;
const VID_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i;
/** 從網址猜是圖片還是影片（猜不到當圖片，使用者可在面板上改） */
function guessKind(url) {
  if (VID_EXT.test(url) || embedUrl(url)) return 'video';
  if (IMG_EXT.test(url)) return 'image';
  return 'image';
}

/** 連結直接給 src；blob 從 IndexedDB 取（URL 記到 objUrls，重繪時釋放） */
function setMediaSrc(node, box, m) {
  if (m.url) { node.src = m.url; return; }
  idbGet('images', m.id).then((blob) => {
    if (!blob) { box.classList.add('media-none'); node.remove(); return; }
    const url = URL.createObjectURL(blob);
    objUrls.push(url);
    node.src = url;
  }).catch(() => {});
}

/**
 * 建一組圖片／影片的顯示元件。
 * 回傳 { el, start, stop, destroy }：start() 要等揭曉動畫之後才呼叫，影片這時才開始循環播放。
 * 影片一律先靜音（iOS 不給沒手勢的有聲自動播放），旁邊有喇叭鈕可以開聲音。
 */
function createMediaView(m) {
  const box = el('div', { class: 'media-view' });
  const noop = () => {};
  const kind = m ? m.kind : 'none';
  if (!m) {
    box.classList.add('media-none');
    box.append(el('span', { class: 'media-none-emoji', text: '🌈' }));
    return { el: box, kind, start: noop, stop: noop, destroy: noop };
  }

  if (m.kind === 'video') {
    const embed = embedUrl(m.url);
    if (embed) {
      // iframe 一放進 DOM 就開始載入播放，所以等揭曉時才建立
      let frame = null;
      const ph = el('span', { class: 'media-none-emoji', text: '🎬' });
      const shield = el('div', { class: 'media-shield' }); // 吃掉所有點擊：小孩點影片不會跳去 YouTube
      box.append(ph);
      const stop = () => { if (frame) { frame.remove(); shield.remove(); frame = null; box.append(ph); } };
      return {
        el: box,
        kind,
        start() {
          if (frame) return;
          ph.remove();
          frame = el('iframe', {
            class: 'media-el', src: embed, frameborder: '0',
            // 不給 allow-top-navigation／allow-popups：播放器裡的連結點了也出不去
            sandbox: 'allow-scripts allow-same-origin allow-presentation',
            allow: 'autoplay; encrypted-media',
          });
          box.append(frame, shield);
        },
        stop,
        destroy: stop,
      };
    }
    const v = el('video', { class: 'media-el' });
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    const sound = el('button', { class: 'media-sound', text: '🔇' });
    sound.hidden = true; // 迷霧還沒散開前不露出喇叭鈕
    sound.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.tap();
      v.muted = !v.muted;
      sound.textContent = v.muted ? '🔇' : '🔊';
      v.play().catch(() => {});
    });
    box.append(v, sound);
    setMediaSrc(v, box, m);
    return {
      el: box,
      kind,
      start() { sound.hidden = false; v.play().catch(() => {}); },
      stop() { sound.hidden = true; try { v.pause(); } catch { /* 還沒載好 */ } },
      destroy() { try { v.pause(); } catch { /* 還沒載好 */ } v.removeAttribute('src'); },
    };
  }

  const img = el('img', { class: 'media-el', alt: '' });
  box.append(img);
  setMediaSrc(img, box, m);
  return { el: box, kind, start: noop, stop: noop, destroy: noop };
}

// ---------- 揭曉舞台（專注版面的童話外框圖片框） ----------
function closeStage() {
  if (stageEl) { stageEl.remove(); stageEl = null; }
}

/** 把媒體放進童話外框、蓋在整頁上彈出來；點外面或「收起來」關掉（文字還在下面隨時可以再讀） */
function openStage(view) {
  closeStage();
  const frame = el('div', { class: 'story-frame in' },
    ...['tl', 'tr', 'bl', 'br'].map((k) => el('span', { class: `orn ${k}`, text: '✦' })),
    el('div', { class: 'frame-mat' }, view.el),
  );
  const shut = () => { sfx.tap(); view.stop(); closeStage(); };
  // 點框可以再放一次特效（1.5 秒冷卻，連點不疊放）；影片正在播就不打斷
  let lastReplay = Date.now();
  frame.addEventListener('click', () => {
    if (view.kind === 'video') return;
    const now = Date.now();
    if (now - lastReplay < 1500) return;
    lastReplay = now;
    frame.classList.remove('in', 'pop');
    void frame.offsetWidth; // 重新觸發動畫
    frame.classList.add('pop');
    spawnMagicStars(frame);
    sfx.fanfare();
    confetti();
  });
  const stage = el('div', { class: 'reveal-stage' },
    frame,
    el('button', { class: 'stage-close', onclick: (e) => { e.stopPropagation(); shut(); } }, '✕ ', t('reveal_close')),
  );
  stage.addEventListener('click', (e) => { if (e.target === stage) shut(); });
  // 掛在故事頁裡：切到別的分頁時整頁 display:none，舞台跟著收起來
  root.append(stage);
  stageEl = stage;
  spawnMagicStars(frame);
  sfx.fanfare();
  confetti();
  view.start();
}

/** 點「本篇新字」的字：找它在內文第一次出現的位置來發音（找不到就唸單字） */
function speakChar(story, dispCh) {
  const i = [...displayText(story, story.text)].indexOf(dispCh);
  speakAt(story, dispCh, i);
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

  // 閱讀版面：並排（舊版）／專注閱讀（讀完才用特效打開大圖片框）
  const layoutSeg = el('div', { class: 'seg' });
  const curLayout = settings.storyLayout === 'focus' ? 'focus' : 'side';
  const mkLayout = (val, label) => {
    const b = el('button', { class: curLayout === val ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap();
      if (settings.storyLayout !== val) {
        settings.storyLayout = val;
        saveSettings();
      }
      m.close();
      render();
    });
    return b;
  };
  layoutSeg.append(mkLayout('side', `🖼 ${t('layout_side')}`), mkLayout('focus', `🔍 ${t('layout_focus')}`));

  // 點字發音開關（標註模式下：標綠不發音、標紅發音一次）
  const speakSw = el('button', { class: `switch${settings.storySpeak ? ' on' : ''}` });
  speakSw.addEventListener('click', () => {
    sfx.tap();
    settings.storySpeak = !settings.storySpeak;
    saveSettings();
    speakSw.classList.toggle('on', settings.storySpeak);
  });

  // 自動翻頁：這一頁的字都點過了，2 秒後自動翻下一頁
  const autoSw = el('button', { class: `switch${settings.autoPage ? ' on' : ''}` });
  autoSw.addEventListener('click', () => {
    sfx.tap();
    settings.autoPage = !settings.autoPage;
    saveSettings();
    autoSw.classList.toggle('on', settings.autoPage);
  });

  m.body.append(
    el('div', { class: 'field-label', text: t('rs_mode') }), modeSeg,
    el('div', { class: 'field-label', text: t('rs_font') }), fontSeg,
    el('div', { class: 'field-label', text: t('rs_layout') }), layoutSeg,
    el('p', { class: 'settings-note', text: t('rs_layout_note') }),
    el('div', { class: 'settings-line', style: 'margin-top:14px;' },
      el('span', { text: `🗣️ ${t('rs_speak')}` }), speakSw,
    ),
    el('p', { class: 'settings-note', text: t('rs_speak_note') }),
    el('div', { class: 'settings-line', style: 'margin-top:14px;' },
      el('span', { text: `📄 ${t('rs_autopage')}` }), autoSw,
    ),
    el('p', { class: 'settings-note', text: t('rs_autopage_note') }),
  );

  // 這本書的圖片／影片（可放多組，讀完一遍換下一組）與內文編輯
  m.body.append(
    el('div', { class: 'field-label', text: `🖼 ${t('rs_media')}` }),
    el('div', { class: 'row' },
      el('button', { class: 'btn sky small', onclick: () => { sfx.tap(); m.close(); openMediaModal(story, render); } },
        '🖼 ', t('rs_media_btn')),
      el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); m.close(); openEditStoryModal(story, render); } },
        '✏️ ', t('story_edit')),
    ),
  );

  // 追加新字：把本篇還沒在字表裡的字（繁體）挑選後加入字表
  m.body.append(
    el('div', { class: 'field-label', text: t('rs_add_new_label') }),
    el('button', { class: 'btn mint small', onclick: () => { sfx.tap(); m.close(); openAddNewChars(story); } },
      '➕ ', t('rs_add_new')),
  );

  // 閱讀進度：直接完成（跳過點讀，照樣播特效與計次）／狀態重置（回到還沒讀過）
  const progRow = el('div', { class: 'row' });
  if (readProgress(story).ratio < 0.999) {
    progRow.append(el('button', { class: 'btn sky small', onclick: () => {
      sfx.tap();
      m.close(); // 先關掉面板，特效才看得到
      if (completeNow) completeNow();
    } }, '✅ ', t('rs_finish')));
  }
  progRow.append(el('button', { class: 'btn ghost small', onclick: async () => {
    sfx.tap();
    const yes = await confirmDialog(t('rs_reset_confirm'));
    if (!yes) return;
    // 只回退這本、這個帳號的閱讀狀態：兩種模式的標記與「已打開」次數；字表紅綠不動
    if (story.hlBy) delete story.hlBy[currentAccountId];
    if (story.marksBy) delete story.marksBy[currentAccountId];
    if (story.readsBy) delete story.readsBy[currentAccountId];
    saveStories();
    m.close();
    toast(t('rs_reset_done'));
    render();
  } }, '♻️ ', t('rs_reset')));
  m.body.append(
    el('div', { class: 'field-label', text: t('rs_progress_label') }),
    progRow,
    el('p', { class: 'settings-note', text: t('rs_progress_note') }),
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

// ---------- 書架（modal：書本形卡片） ----------
// 每本書：封面（讀完才顯示插圖，中央清晰四周模糊；未讀完＝書名首字＋柔色底）、進度條、
// 書名／日期／pill（新字＝未入字表或入了但標紅的字數，>0 才顯示；讀完／讀到 N% 視情況）。
// 排序：最新／有新字／還沒讀完（記在 settings.shelfSort）。小孩帳號不顯示 ✏️🗑，改「📖 打開」。
const COVER_TINTS = [
  ['#5AA9F9', '#4ECDC4'], ['#FF6B9D', '#FFB35C'], ['#FFD93D', '#FF8A3D'],
  ['#7DC855', '#4ECDC4'], ['#B98CF2', '#5AA9F9'], ['#FF8A3D', '#FF6B9D'],
];
function coverTint(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COVER_TINTS[h % COVER_TINTS.length];
}
/** 這本在目前帳號×目前點讀模式的閱讀進度（負索引＝書名的字，不計） */
function readProgress(story) {
  const total = [...(story.text || '')].filter(isHan).length || 1;
  const mode = settings.storyMode === 'mark' ? 'mark' : 'hl';
  const done = mode === 'hl'
    ? ((story.hlBy || {})[currentAccountId] || []).filter((i) => i >= 0).length
    : Object.keys((story.marksBy || {})[currentAccountId] || {}).filter((k) => +k >= 0).length;
  return { done, total, ratio: Math.min(1, done / total) };
}

/** 書架用的統計：已讀比例（目前帳號×目前點讀模式）、新字數（未入字表或標紅） */
function shelfStats(story) {
  const { ratio } = readProgress(story);
  const byHant = new Map(words.map((w) => [convertTo(w.ch, 'zh-Hant'), w]));
  let fresh = 0;
  for (const ch of new Set([...s2t(story.text || '')].filter(isHan))) {
    const w = byHant.get(ch);
    if (!w || getCard(w).mark === 'red') fresh++;
  }
  return { ratio, done: ratio >= 0.999, fresh };
}
function openShelfModal() {
  const urls = []; // 封面 blob URL，關閉時釋放
  const m = openModal(`📚 ${t('shelf_title')}`, { onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });
  const kid = currentAccount().role === 'kid';
  const sort = ['new', 'fresh', 'unread'].includes(settings.shelfSort) ? settings.shelfSort : 'new';
  const items = stories.map((s) => ({ s, st: shelfStats(s) }));
  const byTime = (a, b) => (b.s.createdAt || 0) - (a.s.createdAt || 0);
  if (sort === 'fresh') items.sort((a, b) => (b.st.fresh - a.st.fresh) || byTime(a, b));
  else if (sort === 'unread') items.sort((a, b) => (Number(a.st.done) - Number(b.st.done)) || byTime(a, b));
  else items.sort(byTime);
  const doneN = items.filter((x) => x.st.done).length;

  // 排序列
  const seg = el('div', { class: 'seg small' });
  for (const [key, label] of [['new', t('shelf_sort_new')], ['fresh', t('shelf_sort_fresh')], ['unread', t('shelf_sort_unread')]]) {
    const b = el('button', { class: sort === key ? 'on' : '', text: label });
    b.addEventListener('click', () => {
      sfx.tap();
      if (settings.shelfSort !== key) { settings.shelfSort = key; saveSettings(); }
      m.close(); openShelfModal();
    });
    seg.append(b);
  }
  m.body.append(el('div', { class: 'shelf-sub' },
    el('span', { class: 'shelf-count', text: t('shelf_count', { n: stories.length, done: doneN }) }),
    seg,
  ));

  const grid = el('div', { class: 'shelf-grid' });
  for (const { s, st } of items) {
    const art = el('div', { class: 'bk-art' });
    const cover = storyMedia(s).find((mi) => mi.kind === 'image'); // 影片沒有縮圖，用色底封面
    if (st.done && cover) {
      // 讀完：插圖（底層模糊＋上層遮罩只露中央）
      const blur = el('div', { class: 'bk-blur' });
      const sharp = el('div', { class: 'bk-sharp' });
      art.append(blur, sharp);
      if (cover.url) {
        blur.style.backgroundImage = sharp.style.backgroundImage = `url("${cover.url}")`;
      } else {
        idbGet('images', cover.id).then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob); urls.push(url);
          blur.style.backgroundImage = sharp.style.backgroundImage = `url("${url}")`;
        }).catch(() => {});
      }
    } else {
      const [c1, c2] = coverTint(s.id);
      art.classList.add('plain');
      art.style.background = `linear-gradient(160deg, ${c1}, ${c2})`;
      const first = [...displayText(s, s.title)].find(isHan) || '📖';
      art.append(el('span', { text: first }));
    }
    const prog = el('div', { class: 'bk-prog' }, el('i', { style: `width:${Math.round(st.ratio * 100)}%` }));
    const pills = el('div', { class: 'bk-pills' });
    if (st.fresh) pills.append(el('span', { class: 'chip new', text: t('shelf_pill_fresh', { n: st.fresh }) }));
    if (st.done) pills.append(el('span', { class: 'chip done', text: `✓ ${t('shelf_pill_done')}` }));
    else if (st.ratio > 0) pills.append(el('span', { class: 'chip reading', text: t('shelf_pill_reading', { n: Math.round(st.ratio * 100) }) }));
    const label = el('div', { class: 'bk-label' },
      el('div', { class: 'bk-name', text: displayText(s, s.title) }),
      el('div', { class: 'bk-meta' },
        el('span', { class: 'bk-date', text: new Date(s.createdAt).toLocaleDateString() }),
        pills,
      ),
    );
    const coverBtn = el('button', { class: 'bk-cover', 'aria-label': displayText(s, s.title) }, art, prog, label);
    const open = () => { sfx.tap(); currentId = s.id; m.close(); render(); };
    coverBtn.addEventListener('click', open);

    const acts = el('div', { class: 'bk-acts' });
    if (kid) {
      acts.append(el('button', { class: 'btn sky small', onclick: open }, '📖 ', t('shelf_open')));
    } else {
      const editBtn = el('button', { class: 'book-del book-edit', text: '✏️' });
      editBtn.addEventListener('click', () => {
        sfx.tap();
        openEditStoryModal(s, () => { m.close(); if (currentId === s.id) render(); openShelfModal(); });
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
      acts.append(editBtn, delBtn);
    }
    grid.append(el('div', { class: `bk${s.id === currentId ? ' current' : ''}` },
      s.id === currentId ? el('span', { class: 'bk-ribbon' }) : null, coverBtn, acts));
  }
  if (!kid) {
    const addCover = el('button', { class: 'bk-cover add' },
      el('span', { class: 'bk-plus' }, el('b', { text: '＋' }), t('make_story')));
    addCover.addEventListener('click', () => { sfx.tap(); m.close(); openGenModal(); });
    grid.append(el('div', { class: 'bk' }, addCover));
  }
  m.body.append(grid);
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
    el('div', { class: 'field-label', text: `🖼 ${t('rs_media')}` }),
    el('button', { class: 'btn sky small', onclick: () => {
      sfx.tap();
      m.close();
      openMediaModal(story, onSaved);
    } }, '🖼 ', t('rs_media_btn')),
  );
  // 這本的插圖放在最下面，改文字時捲下去就能對照
  const cover = storyMedia(story).find((mi) => mi.kind === 'image');
  if (cover) {
    const img = el('img', { class: 'edit-story-img', alt: '' });
    m.body.append(img);
    if (cover.url) img.src = cover.url;
    else {
      idbGet('images', cover.id).then((blob) => {
        if (blob) { imgUrl = URL.createObjectURL(blob); img.src = imgUrl; }
        else img.remove();
      }).catch(() => img.remove());
    }
  }
  m.foot.append(saveBtn);
}

// ---------- 圖片／影片管理（閱讀設定與書架的編輯都可進來） ----------
// 清單順序＝解鎖順序：讀完第 1 遍看第 1 個、第 2 遍看第 2 個…
// 每次增刪、上下移都直接存檔（不用再按儲存），關掉面板時重繪故事頁。
function openMediaModal(story, onChanged) {
  const urls = [];
  let changed = false;
  const m = openModal(`🖼 ${t('media_title')}`, {
    onClose: () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      if (changed && onChanged) onChanged();
    },
  });

  const list = el('div', { class: 'media-list' });
  function commit(next) {
    setStoryMedia(story, next);
    changed = true;
    draw();
  }
  function draw() {
    const media = storyMedia(story);
    list.innerHTML = '';
    if (!media.length) {
      list.append(el('p', { class: 'settings-note', style: 'margin-top:0;', text: t('media_empty') }));
      return;
    }
    media.forEach((mi, i) => {
      const thumb = el('div', { class: `mi-thumb${mi.kind === 'video' ? ' vid' : ''}` });
      if (mi.kind === 'video') {
        thumb.append(el('span', { text: '🎬' }));
      } else if (mi.url) {
        thumb.style.backgroundImage = `url("${mi.url}")`;
      } else {
        idbGet('images', mi.id).then((blob) => {
          if (!blob) { thumb.append(el('span', { text: '❔' })); return; }
          const u = URL.createObjectURL(blob);
          urls.push(u);
          thumb.style.backgroundImage = `url("${u}")`;
        }).catch(() => {});
      }
      const kindLabel = mi.kind === 'video' ? t('media_kind_video') : t('media_kind_image');
      const srcLabel = mi.url ? t('media_src_link') : t('media_src_file');
      const info = el('div', { class: 'mi-info' },
        el('b', { text: t('media_slot', { n: i + 1 }) }),
        el('span', { text: `${kindLabel}・${srcLabel}` }),
        mi.url ? el('small', { text: mi.url }) : null,
      );
      const up = el('button', { class: 'mi-btn', text: '⬆' });
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        sfx.tap();
        const n = [...media];
        [n[i - 1], n[i]] = [n[i], n[i - 1]];
        commit(n);
      });
      const down = el('button', { class: 'mi-btn', text: '⬇' });
      down.disabled = i === media.length - 1;
      down.addEventListener('click', () => {
        sfx.tap();
        const n = [...media];
        [n[i + 1], n[i]] = [n[i], n[i + 1]];
        commit(n);
      });
      const del = el('button', { class: 'mi-btn danger', text: '🗑' });
      del.addEventListener('click', async () => {
        sfx.tap();
        const yes = await confirmDialog(t('media_del_confirm'));
        if (!yes) return;
        const gone = storyMedia(story)[i];
        const next = storyMedia(story).filter((_, k) => k !== i);
        commit(next);
        await deleteMediaBlob(gone);
      });
      list.append(el('div', { class: 'media-item' }, thumb, info, el('div', { class: 'mi-acts' }, up, down, del)));
    });
  }

  // ---- 上傳（圖片可一次多張；影片存原檔，太大會提醒備份會變肥） ----
  const imgFile = el('input', { type: 'file', accept: 'image/*', multiple: '', style: 'display:none;' });
  imgFile.addEventListener('change', async () => {
    const files = [...(imgFile.files || [])];
    imgFile.value = '';
    if (!files.length) return;
    const next = [...storyMedia(story)];
    let ok = 0;
    for (const f of files) {
      try {
        const blob = await downscaleImage(f, 1280);
        const id = newMediaId(story);
        await idbSet('images', id, blob);
        next.push({ id, kind: 'image' });
        ok++;
      } catch (e) {
        console.warn('add image failed', e);
      }
    }
    if (!ok) { toast(t('acc_img_fail'), true); return; }
    commit(next);
    toast(t('media_added'));
  });

  const vidFile = el('input', { type: 'file', accept: 'video/*', multiple: '', style: 'display:none;' });
  vidFile.addEventListener('change', async () => {
    const files = [...(vidFile.files || [])];
    vidFile.value = '';
    if (!files.length) return;
    const next = [...storyMedia(story)];
    let ok = 0;
    for (const f of files) {
      const mb = Math.round(f.size / 1e6);
      if (mb >= 30) toast(t('media_video_big', { n: mb }));
      const id = newMediaId(story);
      try {
        await idbSet('images', id, f); // 影片原檔直接存（'images' 就是個 blob KV）
        next.push({ id, kind: 'video' });
        ok++;
      } catch (e) {
        console.warn('add video failed', e);
      }
    }
    if (!ok) { toast(t('acc_img_fail'), true); return; }
    commit(next);
    toast(t('media_added'));
  });

  // ---- 連結（直接檔案網址，或 YouTube／Vimeo）----
  const kindSeg = el('div', { class: 'seg small' });
  const kindBtns = {};
  let linkKind = 'image';
  const setKind = (k) => {
    linkKind = k;
    for (const [kk, bb] of Object.entries(kindBtns)) bb.classList.toggle('on', kk === k);
  };
  for (const [k, label] of [['image', `🖼 ${t('media_kind_image')}`], ['video', `🎬 ${t('media_kind_video')}`]]) {
    const b = el('button', { class: k === linkKind ? 'on' : '', text: label });
    b.addEventListener('click', () => { sfx.tap(); setKind(k); });
    kindBtns[k] = b;
    kindSeg.append(b);
  }
  const linkInput = el('input', {
    class: 'text-input', placeholder: t('media_link_ph'),
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  // 貼上網址時自動猜類型（猜錯可以馬上按上面的按鈕改）
  linkInput.addEventListener('input', () => setKind(guessKind(linkInput.value.trim())));
  const addLink = el('button', { class: 'btn ghost small' }, '🔗 ', t('media_add_link'));
  addLink.addEventListener('click', () => {
    const url = linkInput.value.trim();
    if (!/^https?:\/\//i.test(url)) { toast(t('media_link_bad'), true); return; }
    sfx.tap();
    commit([...storyMedia(story), { id: newMediaId(story), kind: linkKind, url }]);
    linkInput.value = '';
    toast(t('media_added'));
  });

  // ---- AI 再畫一張（用這本存下來的畫圖提示，沒有就拿內文開頭當場景）----
  const aiBtn = el('button', { class: 'btn berry small' }, '✨ ', t('media_ai'));
  aiBtn.addEventListener('click', async () => {
    sfx.tap();
    const label = aiBtn.textContent;
    aiBtn.disabled = true;
    aiBtn.textContent = `⏳ ${t('media_ai_doing')}`;
    try {
      const scene = story.imagePrompt || s2t(story.text).slice(0, 200);
      const blob = await generateImage(scene, pickImageStyle());
      const id = newMediaId(story);
      await idbSet('images', id, blob);
      commit([...storyMedia(story), { id, kind: 'image' }]);
      toast(t('media_added'));
    } catch (e) {
      console.warn('ai image failed', e);
      toast(`${t('media_ai_fail')}：${e.message}`, true);
    }
    aiBtn.disabled = false;
    aiBtn.textContent = label;
  });

  m.body.append(
    el('p', { class: 'settings-note', style: 'margin-top:0;', text: t('media_hint') }),
    list,
    el('div', { class: 'field-label', text: `➕ ${t('media_add_link')}` }),
    kindSeg,
    el('div', { class: 'row', style: 'flex-wrap:nowrap;margin-top:8px;' }, linkInput, addLink),
    el('div', { class: 'field-label', text: `➕ ${t('media_add_image')}／${t('media_add_video')}` }),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); imgFile.click(); } }, '🖼 ', t('media_add_image')),
      el('button', { class: 'btn ghost small', onclick: () => { sfx.tap(); vidFile.click(); } }, '🎬 ', t('media_add_video')),
      settings.apiKey ? aiBtn : null,
    ),
    el('p', { class: 'settings-note', text: t('media_video_note') }),
    imgFile, vidFile,
  );
  m.foot.append(el('button', { class: 'btn', text: t('ok'), onclick: () => { sfx.tap(); m.close(); } }));
  draw();
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

/**
 * 書架有上限（MAX_STORIES）。以前滿了會靜默丟掉最舊的一本（連家長上傳的照片影片一起）；
 * 現在做新書前先問，不同意就不做（也不浪費 API 額度）。
 */
async function ensureShelfRoom() {
  const victim = shelfVictim();
  if (!victim) return true;
  return confirmDialog(t('shelf_full_confirm', { n: MAX_STORIES, title: displayText(victim, victim.title) }));
}

// ---------- 生成面板 ----------
function openGenModal() {
  let mic = null; // 語音輸入：面板關掉（含按下生成）時一定要停，不然麥克風會一直收音
  const m = openModal(`✨ ${t('gen_title')}`, { onClose: () => { if (mic) mic.stop(); } });
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
  mic = setupMic(micBtn, promptInput);

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
    el('button', { class: 'btn big berry', onclick: async () => {
      if (words.length < 10 && settings.apiKey) {
        toast(t('gen_need_words'), true);
        return;
      }
      if (!(await ensureShelfRoom())) return;
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
      if (preview.src) URL.revokeObjectURL(preview.src);
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
    if (!(await ensureShelfRoom())) return;
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
      story.media = [{ id, kind: 'image' }];
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
/** 回傳 { stop }：面板關閉時呼叫，確保麥克風不會在背景繼續收音（最長也只收 30 秒） */
function setupMic(btn, input) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    btn.addEventListener('click', () => toast(t('voice_unsupported'), true));
    return { stop() {} };
  }
  let rec = null;
  let guard = 0;
  const stop = () => {
    clearTimeout(guard);
    if (rec) { try { rec.abort(); } catch { /* 已停止 */ } rec = null; }
    btn.classList.remove('rec');
  };
  btn.addEventListener('click', () => {
    sfx.tap();
    if (rec) { stop(); return; }
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
    rec.onend = () => { btn.classList.remove('rec'); rec = null; clearTimeout(guard); };
    rec.onerror = () => { btn.classList.remove('rec'); rec = null; clearTimeout(guard); };
    rec.start();
    guard = setTimeout(stop, 30000);
  });
  return { stop };
}

// ---------- 生成流程 ----------
async function runGeneration(mustInclude, extraPrompt) {
  const ac = new AbortController(); // 「停止」鈕：中止 API 呼叫（含重試），什麼都不存
  const m = openModal('', { closable: false });
  const emoji = el('span', { class: 'big-emoji', text: '🧚' });
  const msg = el('p', { text: t('gen_writing') });
  const stopBtn = el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); stopBtn.disabled = true; ac.abort(); } }, '⏹ ', t('gen_stop'));
  m.foot.append(stopBtn);
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
        signal: ac.signal,
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
      media: [],
      imagePrompt: imagePrompt || '', // 留著給「AI 再畫一張」當場景
      demo: !settings.apiKey,
    };

    // 產插圖
    if (settings.apiKey && settings.genImage && imagePrompt) {
      emoji.textContent = '🎨';
      msg.textContent = t('gen_drawing');
      const style = pickImageStyle(); // 風格池隨機選一種，畫風多樣化
      addLog(`🎨 ${t('gen_log_img')}（${settings.imageModel}｜${style.name}）…`);
      try {
        const blob = await generateImage(imagePrompt, style, ac.signal);
        await idbSet('images', id, blob);
        story.hasImage = true;
        story.media = [{ id, kind: 'image' }];
        addLog(`✅ ${t('gen_log_img_ok')}`);
      } catch (e) {
        if (e.message === 'CANCELLED') throw e; // 使用者按了停止：整本不存
        console.warn('image failed', e);
        addLog(`⚠️ ${t('gen_log_img_fail')}：${e.message}`);
      }
    } else if (settings.apiKey && !settings.genImage) {
      addLog(`⏭️ ${t('gen_log_img_skip')}`);
    } else if (!settings.apiKey) {
      // 示範模式：配一張內建插圖，第一次體驗讀完才不會揭開一片空白
      story.hasImage = true;
      story.media = [{ id: `${id}|demo`, kind: 'image', url: 'icons/demo-cat.svg' }];
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
    if (e.message === 'CANCELLED') { m.close(); toast(t('gen_cancelled')); return; }
    // 失敗時視窗留著，log 保留完整過程好除錯；按「好」才關
    stopBtn.remove();
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
  await speakOne(stored, dispCh);
}

/** 唸一個字：AI 快取（原字形 → 顯示字形 → 繁簡另一邊）→ 音節庫 → 內建語音 */
async function speakOne(stored, dispCh) {
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

  const ac = new AbortController(); // 「停止」鈕：一篇 100 多個字、TTS 成功率又不高時，不能讓人乾等 10 分鐘
  const m = openModal('', { closable: false });
  const msg = el('p', { text: t('game_prep') });
  const fill = el('div', { class: 'prep-fill' });
  m.body.append(el('div', { class: 'loading-scene' },
    el('span', { class: 'big-emoji', text: '🔊' }), msg,
    el('div', { class: 'prep-bar' }, fill),
  ));
  const stopBtn = el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); stopBtn.disabled = true; ac.abort(); } }, '⏹ ', t('gen_stop'));
  m.foot.append(stopBtn);
  const cancelled = () => { m.close(); toast(t('gen_cancelled')); };

  // 多音字偵測（每本只做一次，存在 story.polys）＋所屬詞整詞發音
  try {
    if (!story.polys) {
      msg.textContent = t('prep_poly');
      const polys = await detectPolys(story.text, ac.signal);
      // 偵測失敗（回空陣列）不永久存，下次還會再試；有結果才存
      if (polys.length) { story.polys = polys; saveStories(); }
    }
  } catch (e) {
    if (e.message === 'CANCELLED') { cancelled(); return; }
    console.warn('poly detect failed', e);
  }

  // 以「儲存原字形」生成與快取（不用顯示字形：簡體同形字會撞 key、送簡體字也會讓 TTS 讀音不準）
  const uniq = [...new Set([...story.text, ...(story.title || '')].filter(isHan))];
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
    if (ac.signal.aborted) break;
    try {
      const blob = await ttsChar(j.text, ac.signal);
      await idbSet('audio', j.key, blob);
    } catch (e) {
      if (e.message === 'CANCELLED') break;
      fail++; lastErr = e; failed.push(j.text); console.warn('tts failed', j.key, e);
    }
    done++;
    msg.textContent = `${t('game_prep')} ${done}/${jobs.length}`;
    fill.style.width = `${Math.round((done / jobs.length) * 100)}%`;
  }
  if (ac.signal.aborted) { cancelled(); return; }
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
