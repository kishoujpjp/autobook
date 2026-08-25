// 資料層：settings / 字表 / 故事 用 localStorage；圖片與語音 blob 用 IndexedDB
import { t2s, s2t } from './zhconv.js';

export const VERSION = '1.20.0';

const LS = {
  settings: 'autobook.settings',
  words: 'autobook.words',
  stories: 'autobook.stories',
  accounts: 'autobook.accounts',
  currentAccount: 'autobook.currentAccount',
  phrases: 'autobook.phrases',
  repGroups: 'autobook.repGroups',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  ttsApiKey: '',          // 選填：TTS 專用 key，留空共用 apiKey
  lang: 'zh-Hant',
  tapSpeak: true,
  storyFont: 'small', // small | big
  storyMode: 'hl',        // 故事點讀：'hl' 高亮模式（小孩自讀）| 'mark' 標註模式（親子共讀，紅綠輪換）
  storySpeak: true,       // 故事點字發音（標註模式下：標綠不發音、標紅發音一次）
  wordsLocked: false,     // 字表鎖定：點字只發音，不改紅綠
  parentGateOn: true,     // 切回家長帳號要通過算術確認（關閉＝直接切換）
  weakMode: false,        // 不熟模式：遊戲只出紅字與白字
  wordLen: 'all',         // 認詞彙長度：'2' | '3' | 'all'
  genImage: true,         // 做新繪本時生成插圖
  storyLayout: 'side',    // 閱讀版面：'side' 圖文並排（舊版）｜'focus' 專注閱讀（讀完才用特效打開圖片框）
  // 故事元素比例（0~10，生成面板雷達圖）：溫馨/有趣/衝突/悲傷/犯錯
  storyMix: { warm: 8, fun: 8, conflict: 2, sad: 0, mistake: 2 },
  repStrict: 'std',       // 跟讀評分嚴格度：'easy' | 'std' | 'hard'

  textModel: 'gemini-3-flash-preview',
  imageModel: 'gemini-2.5-flash-image',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  voice: 'Leda',
};

/** 備份要涵蓋的 localStorage 鍵（全部資料鍵） */
export const BACKUP_KEYS = Object.values(LS);

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ---------- 延遲寫入（效能） ----------
// 字表與故事在點讀/標註時每一下都會「存檔」，同步 stringify＋寫 localStorage
// 連點時會卡頓。改成合併延遲寫入：閒置 400ms 後才真正寫；
// 離開頁面（pagehide / 切到背景）時強制 flush，資料不會掉。
const pendingSaves = new Map(); // key -> getter
let saveTimer = 0;
function scheduleSave(key, getter) {
  pendingSaves.set(key, getter);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 400);
}
/** 立刻把延遲中的寫入全部落盤（備份匯出前要先呼叫） */
export function flushSaves() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  for (const [key, getter] of pendingSaves) save(key, getter());
  pendingSaves.clear();
}
/** 丟棄延遲中的寫入（匯入備份/清除資料後 reload 前呼叫，避免舊資料在 pagehide 蓋回去） */
export function cancelPendingSaves() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  pendingSaves.clear();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSaves);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaves();
  });
}

// ---------- settings ----------
export const settings = Object.assign({}, DEFAULT_SETTINGS, load(LS.settings, {}));
export function saveSettings() { save(LS.settings, settings); }

// 舊預設文字模型自動升級
if (settings.textModel === 'gemini-2.5-flash') {
  settings.textModel = 'gemini-3-flash-preview';
  saveSettings();
}

// ---------- 字表 ----------
// word: { ch, addedAt, usedCount, readCount, archived, cards }
// usedCount/readCount＝字表全域屬性（被故事使用、點讀次數）
// archived＝入庫（不進遊戲，仍可用於故事，字表排最後）
// cards＝熟悉度紀錄，依「帳號|語系」分開：{ 'accId|lang': {mark, markedAt, flashCount, ok, ng} }
//   mark＝'green'(學會)/'red'(還不會)/null；flashCount＝字卡出現次數；ok/ng＝聽音認字答對/錯
export let words = load(LS.words, []);
export function saveWords() { scheduleSave(LS.words, () => words); }

/** 熟悉度紀錄的鍵：指定帳號（預設目前帳號）＋目前語系 */
export function cardKey(accId) {
  return `${accId || currentAccountId}|${settings.lang}`;
}

const EMPTY_CARD = Object.freeze({ mark: null, markedAt: 0, flashCount: 0, ok: 0, ng: 0 });

/** accId 可指定要看哪個帳號的紀錄（家長檢視小孩用），省略＝目前帳號 */
export function getCard(w, accId) {
  return (w.cards && w.cards[cardKey(accId)]) || EMPTY_CARD;
}

export function ensureCard(w, accId) {
  if (!w.cards) w.cards = {};
  const k = cardKey(accId);
  if (!w.cards[k]) w.cards[k] = { mark: null, markedAt: 0, flashCount: 0, ok: 0, ng: 0 };
  return w.cards[k];
}

/** 學會的字 3 天內不進出題池 */
export const GREEN_COOLDOWN_MS = 3 * 24 * 3600 * 1000;

export function isCooling(w, now = Date.now()) {
  const c = getCard(w);
  return c.mark === 'green' && now - c.markedAt < GREEN_COOLDOWN_MS;
}

/** 點按循環：null → green → red → null，回傳新狀態；accId 可代別的帳號標（家長檢視小孩用） */
export function cycleMark(ch, accId) {
  const w = words.find((x) => x.ch === ch);
  if (!w) return null;
  const c = ensureCard(w, accId);
  c.mark = c.mark === null ? 'green' : c.mark === 'green' ? 'red' : null;
  c.markedAt = c.mark ? Date.now() : 0;
  saveWords();
  return c.mark;
}

/** 直接設定熟悉度（故事標註等其他入口用）：各入口共用同一份紀錄，以最後一次標註為準 */
export function setMark(ch, mark) {
  const w = words.find((x) => x.ch === ch);
  if (!w) return;
  const c = ensureCard(w);
  c.mark = mark;
  c.markedAt = mark ? Date.now() : 0;
  saveWords();
}

export function bumpFlash(chs) {
  const set = new Set(chs);
  for (const w of words) if (set.has(w.ch)) ensureCard(w).flashCount++;
  saveWords();
}

export function setArchived(chs, on) {
  const set = new Set(chs);
  for (const w of words) if (set.has(w.ch)) w.archived = on;
  saveWords();
}

export function wordSet() { return new Set(words.map((w) => w.ch)); }

const HAN_RE = /\p{Script=Han}/u;
export function isHan(ch) { return HAN_RE.test(ch); }

/**
 * 「簡體側字形本身也是合法繁體字」的字對（游/遊、后/後、里/裏…）。
 * 對照表看起來是雙向一對一，但兩邊都是各自獨立的繁體字形，依規則要各自保留，不可去重。
 * 產生方式：對照表中所有雙向一對一的字對，取簡體側字形也出現在繁體詞庫（js/wordbank.js 繁體側）者。
 */
const SELF_HANT = new Set('伙夥准準占佔台臺吃喫后後咨諮唇脣岩巖岳嶽峰峯干幹床牀征徵游遊秘祕糍餈群羣辟闢郁鬱采採里裏霉黴');

/** 某字的「雙向一對一」等價字形（貓⇄猫）。多對應字（发↔發/髮）與 SELF_HANT 不算等價，不會被去重。 */
function equivalents(ch) {
  const out = [ch];
  if (SELF_HANT.has(ch)) return out;
  const s = t2s(ch);
  if (s !== ch && s2t(s) === ch) out.push(s);
  const tr = s2t(ch);
  if (tr !== ch && t2s(tr) === ch) out.push(tr);
  return out;
}

export function addWords(text) {
  // 跨繁簡去重：只略過「雙向一對一」等價的字；絕不刪改既有的字
  const equiv = new Set();
  for (const w of words) for (const e of equivalents(w.ch)) equiv.add(e);

  let added = 0, dup = 0;
  const collide = []; // 加入了，但與既有字在某一邊字形顯示相同（如 髮 vs 发）
  const now = Date.now();
  for (const ch of text) {
    if (!isHan(ch)) continue;
    if (equiv.has(ch)) { dup++; continue; }
    for (const w of words) {
      if (w.ch !== ch && (t2s(w.ch) === t2s(ch) || s2t(w.ch) === s2t(ch))) {
        collide.push(ch);
        break;
      }
    }
    words.push({
      ch, addedAt: now + added, usedCount: 0, readCount: 0,
      archived: false, cards: {},
    });
    for (const e of equivalents(ch)) equiv.add(e);
    added++;
  }
  if (added) saveWords();
  return { added, dup, collide };
}

export function removeWord(ch) {
  words = words.filter((w) => w.ch !== ch);
  saveWords();
}

export function removeWords(chs) {
  const set = new Set(chs);
  words = words.filter((w) => !set.has(w.ch));
  saveWords();
}

export function bumpUsed(chars) {
  const set = new Set(chars);
  for (const w of words) if (set.has(w.ch)) w.usedCount++;
  saveWords();
}

export function bumpRead(ch, delta) {
  const w = words.find((x) => x.ch === ch);
  if (w) { w.readCount = Math.max(0, (w.readCount || 0) + delta); saveWords(); }
}

export function bumpGame(ch, correct) {
  const w = words.find((x) => x.ch === ch);
  if (w) {
    const c = ensureCard(w);
    correct ? c.ok++ : c.ng++;
    saveWords();
  }
}

// ---------- 故事 ----------
// story: { id, title, text, lang, createdAt, newChars:[], hasImage, demo,
//          hlBy:   { 帳號id: [索引] },                 高亮模式的紀錄（依帳號分開）
//          marksBy:{ 帳號id: { 索引: 'green'|'red' } }, 標註模式的紀錄（依帳號分開）
//          readsBy:{ 帳號id: 次數 },                   讀完整本的次數（高亮／標註都算）
//          media:  [{ id, kind, url }],                圖片／影片清單（見下方 storyMedia）
//          polys:  [{ char, word }] }                  多音字與所屬詞（每本偵測一次）
// 舊版全域 highlights 於故事頁首次開啟時遷移給當時的帳號
export let stories = load(LS.stories, []);
export function saveStories() { scheduleSave(LS.stories, () => stories); }

const MAX_STORIES = 24;

export async function addStory(story) {
  stories.unshift(story);
  while (stories.length > MAX_STORIES) {
    const old = stories.pop();
    await dropStoryBlobs(old);
  }
  saveStories();
}

export async function removeStory(id) {
  const gone = stories.find((s) => s.id === id);
  stories = stories.filter((s) => s.id !== id);
  saveStories();
  if (gone) await dropStoryBlobs(gone);
}

export function getStory(id) { return stories.find((s) => s.id === id); }

/** 刪掉一本書所有存在 IndexedDB 的媒體 blob（外部連結沒有 blob） */
async function dropStoryBlobs(story) {
  for (const m of storyMedia(story)) await deleteMediaBlob(m);
  await idbDel('images', story.id).catch(() => {}); // 舊資料的第一張插圖 key＝故事 id
}

// ---------- 故事的圖片／影片 ----------
// media: [{ id, kind: 'image' | 'video', url? }]
//   url 有值＝外部連結（直接檔案網址，或 YouTube／Vimeo）；沒有＝blob 存在 IndexedDB
//   的 'images' store，key＝m.id。舊資料沒有 media 欄位：hasImage 就是唯一一張，key＝故事 id。
// 清單順序＝解鎖順序：讀完第 1 遍看 media[0]，第 2 遍看 media[1]…讀完最後一個之後固定用最後一個。

/** 這本書的媒體清單（含舊資料的相容轉換），永遠回傳陣列 */
export function storyMedia(story) {
  if (Array.isArray(story.media)) return story.media;
  return story.hasImage ? [{ id: story.id, kind: 'image' }] : [];
}

/** 產生新媒體的 IndexedDB key（帶故事 id 前綴，好認；序號確保同一毫秒連加多張也不會撞） */
let mediaSeq = 0;
export function newMediaId(story) {
  return `${story.id}|m${Date.now().toString(36)}${(mediaSeq++).toString(36)}${(Math.random() * 1e4 | 0).toString(36)}`;
}

/** 寫回媒體清單；hasImage 同步維護（書架封面與舊程式碼還在看它） */
export function setStoryMedia(story, list) {
  story.media = list;
  story.hasImage = list.some((m) => m.kind === 'image');
  saveStories();
}

export async function deleteMediaBlob(m) {
  if (!m.url) await idbDel('images', m.id).catch(() => {});
}

/** 讀完整本的次數（依帳號分開）：高亮讀完或標註讀完都算一次 */
export function storyReads(story, accId) {
  return (story.readsBy && story.readsBy[accId || currentAccountId]) || 0;
}

export function bumpStoryReads(story) {
  if (!story.readsBy) story.readsBy = {};
  story.readsBy[currentAccountId] = storyReads(story) + 1;
  saveStories();
  return story.readsBy[currentAccountId];
}

// ---------- 跟讀題庫 ----------
// phrase: { id, text, addedAt, hasImage, tags:[], stats: { [accId]: {last, best, tries} } }
export let phrases = load(LS.phrases, []);
for (const p of phrases) if (!p.tags) p.tags = [];
export function savePhrases() { save(LS.phrases, phrases); }

/** 加入題目池（可帶 tags）。回傳 {added, ids}；ids 含所有輸入行對應的題目 id（重複的對到既有題） */
export function addPhrases(lines, tags = []) {
  let added = 0;
  const ids = [];
  const now = Date.now();
  for (const raw of lines) {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text || !/[a-zA-Z]/.test(text)) continue;
    const existing = phrases.find((p) => p.text.toLowerCase() === text.toLowerCase());
    if (existing) {
      if (!ids.includes(existing.id)) ids.push(existing.id);
      continue;
    }
    const id = `p${(now + added).toString(36)}${(Math.random() * 1e4 | 0).toString(36)}`;
    phrases.push({ id, text, addedAt: now + added, hasImage: false, tags: [...tags], stats: {} });
    ids.push(id);
    added++;
  }
  if (added) savePhrases();
  return { added, ids };
}

/** 幫一批題目加 tag（不重複） */
export function tagPhrases(ids, tag) {
  const set = new Set(ids);
  for (const p of phrases) {
    if (!set.has(p.id)) continue;
    if (!p.tags) p.tags = [];
    if (tag && !p.tags.includes(tag)) p.tags.push(tag);
  }
  savePhrases();
}

export function clearPhraseTags(ids) {
  const set = new Set(ids);
  for (const p of phrases) if (set.has(p.id)) p.tags = [];
  savePhrases();
}

/** 批次刪題（連同所有練習組內的引用與配圖快取） */
export async function removePhrases(ids) {
  const set = new Set(ids);
  phrases = phrases.filter((p) => !set.has(p.id));
  savePhrases();
  let dirty = false;
  for (const g of repGroups) {
    const before = g.ids.length;
    g.ids = g.ids.filter((x) => !set.has(x));
    if (g.ids.length !== before) dirty = true;
  }
  if (dirty) saveRepGroups();
  for (const id of ids) await idbDel('images', `ph|${id}`).catch(() => {});
}

export function allPhraseTags() {
  const s = new Set();
  for (const p of phrases) for (const tg of (p.tags || [])) s.add(tg);
  return [...s].sort();
}

/** 這題被幾個練習組收錄 */
export function phraseGroupCount(id) {
  return repGroups.reduce((n, g) => n + (g.ids.includes(id) ? 1 : 0), 0);
}

export async function removePhrase(id) {
  phrases = phrases.filter((p) => p.id !== id);
  savePhrases();
  // 從所有練習組移除
  let dirty = false;
  for (const g of repGroups) {
    const before = g.ids.length;
    g.ids = g.ids.filter((x) => x !== id);
    if (g.ids.length !== before) dirty = true;
  }
  if (dirty) saveRepGroups();
  await idbDel('images', `ph|${id}`).catch(() => {});
}

// ---------- 跟讀練習組 ----------
// group: { id, name, ids:[phraseId], addedAt }
export let repGroups = load(LS.repGroups, []);
export function saveRepGroups() { save(LS.repGroups, repGroups); }

export function addRepGroup(name, ids) {
  const g = {
    id: `g${Date.now().toString(36)}${(Math.random() * 1e4 | 0).toString(36)}`,
    name, ids: [...ids], addedAt: Date.now(),
  };
  repGroups.push(g);
  saveRepGroups();
  return g;
}

export function removeRepGroup(id) {
  repGroups = repGroups.filter((g) => g.id !== id);
  saveRepGroups();
}

export function groupPhrases(g) {
  return g.ids.map((id) => phrases.find((p) => p.id === id)).filter(Boolean);
}

// v1.6 → v1.7 遷移：已有散題但還沒有練習組 → 收成一個預設組
if (phrases.length && !repGroups.length) {
  addRepGroup(settings.lang === 'zh-Hans' ? '我的题组' : '我的題組', phrases.map((p) => p.id));
}

export function phraseStat(p) {
  return (p.stats && p.stats[currentAccountId]) || null;
}

export function setPhraseStat(p, score) {
  if (!p.stats) p.stats = {};
  const s = p.stats[currentAccountId] || { last: 0, best: 0, tries: 0 };
  s.last = score;
  s.best = Math.max(s.best, score);
  s.tries++;
  p.stats[currentAccountId] = s;
  savePhrases();
}

// ---------- 帳號 ----------
// account: { id, name, role:'parent'|'kid', avatar:{kind:'preset',preset} | {kind:'image',fallback} }
export let accounts = load(LS.accounts, []);
export let currentAccountId = load(LS.currentAccount, null);

if (!accounts.length) {
  accounts = [{
    id: 'a-default',
    name: settings.lang === 'zh-Hans' ? '家长' : '家長',
    role: 'parent',
    avatar: { kind: 'preset', preset: 'bear' },
  }];
  save(LS.accounts, accounts);
}
if (!accounts.some((a) => a.id === currentAccountId)) {
  currentAccountId = accounts[0].id;
  save(LS.currentAccount, currentAccountId);
}

export function saveAccounts() { save(LS.accounts, accounts); }

export function currentAccount() {
  return accounts.find((a) => a.id === currentAccountId) || accounts[0];
}

export function setCurrentAccount(id) {
  if (accounts.some((a) => a.id === id)) {
    currentAccountId = id;
    save(LS.currentAccount, currentAccountId);
  }
}

export function parentCount() {
  return accounts.filter((a) => a.role === 'parent').length;
}

export async function removeAccount(id) {
  accounts = accounts.filter((a) => a.id !== id);
  saveAccounts();
  await idbDel('avatars', id).catch(() => {});
  if (currentAccountId === id) setCurrentAccount(accounts[0].id);
}

// ---------- 舊字表資料遷移（v1.4 → v1.5：全域熟悉度 → 帳號×語系） ----------
// 需在帳號初始化之後執行（cardKey 用到 currentAccountId）
(function migrateWordCards() {
  let dirty = false;
  for (const w of words) {
    if (w.archived == null) { w.archived = false; dirty = true; }
    if (!w.cards) { w.cards = {}; dirty = true; }
    if (w.mark !== undefined || w.flashCount != null || w.ok != null || w.ng != null) {
      if ((w.mark || w.flashCount || w.ok || w.ng) && !w.cards[cardKey()]) {
        w.cards[cardKey()] = {
          mark: w.mark || null, markedAt: w.markedAt || 0,
          flashCount: w.flashCount || 0, ok: w.ok || 0, ng: w.ng || 0,
        };
      }
      delete w.mark; delete w.markedAt; delete w.flashCount; delete w.ok; delete w.ng;
      dirty = true;
    }
  }
  if (dirty) saveWords();
})();

// ---------- IndexedDB（blob 快取） ----------
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('autobook', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('images')) d.createObjectStore('images');
        if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
        if (!d.objectStoreNames.contains('avatars')) d.createObjectStore('avatars');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

export const idbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const idbSet = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key))
  .then((r) => { if (store === 'audio' && audioKeys) audioKeys.add(key); return r; });
export const idbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key))
  .then((r) => { if (store === 'audio' && audioKeys) audioKeys.delete(key); return r; });
export const idbKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());
export const idbClear = (store) => tx(store, 'readwrite', (s) => s.clear())
  .then((r) => { if (store === 'audio') audioKeys = new Set(); return r; });

// ---------- 語音快取 key 的同步索引 ----------
// iOS 的 speechSynthesis 必須在使用者手勢的「同步」呼叫堆疊中觸發；
// 點擊時不能先 await 查 IndexedDB 再決定要不要用內建語音，
// 所以開站載入一次 key 清單，之後同步查、寫入時同步維護。
let audioKeys = null;
export function hasAudioCached(key) { return !!(audioKeys && audioKeys.has(key)); }
export async function refreshAudioKeys() {
  try { audioKeys = new Set(await idbKeys('audio')); } catch { audioKeys = new Set(); }
}
refreshAudioKeys();

export async function clearAll() {
  cancelPendingSaves(); // 不讓延遲寫入把清掉的資料寫回去
  localStorage.removeItem(LS.settings);
  localStorage.removeItem(LS.words);
  localStorage.removeItem(LS.stories);
  localStorage.removeItem(LS.accounts);
  localStorage.removeItem(LS.currentAccount);
  await idbClear('images').catch(() => {});
  await idbClear('audio').catch(() => {});
  await idbClear('avatars').catch(() => {});
}

// ---------- 示範資料 ----------
export const DEMO_WORDS =
  '我你他的了在有一二三四五六七八九十大小上下天地日月山水火木花草蟲魚鳥貓狗兔熊媽爸家人手口心目耳朵頭來去看見說笑哭吃喝玩跑跳飛走坐站睡覺好不是要和跟朋友學校車球書畫紅黃藍綠白黑色風雨雲星亮光開關門窗高矮長短多少快慢新舊愛喜歡想什麼誰哪裡今明年月日早晚安成真習石葉哥還游泳再方也捉迷藏米得向話隻牛陽著鴨貝眉鼻孩子戲起弟急教落過興聰唱歌土季又雪妹馬春夏秋冬樂回很氣字羊青奶寶問個哈面爺遊東西南北生會能叫雞們就樹到都對請公做變嗎田打兒姐出太爬前進動玉住找總刀用禮念老文後班里后幼河婆筆甜竹尖勇聽謝果怕乖夢園拿冷鵝尾猴飯最告電放桃具沒送按農民伯敢巴';

export const DEMO_STORY_HANT = {
  title: '小貓看星星',
  text: '晚上，小貓坐在家門口看天上的星星。星星一亮一亮，好像在笑。小貓說：「我要跟星星玩！」他跳上高高的山，伸出手，想要摸星星。可是星星太高了，摸不到。月亮出來了，說：「小貓，星星在天上，也在水裡喔！」小貓跑到山下的水邊，看見好多星星在水裡一亮一亮。小貓開心地笑了：「我看見星星了！」他坐在水邊，看了好久好久，開開心心地回家睡覺了。',
};

export const DEMO_STORY_HANS = {
  title: '小猫看星星',
  text: '晚上，小猫坐在家门口看天上的星星。星星一亮一亮，好像在笑。小猫说：“我要跟星星玩！”他跳上高高的山，伸出手，想要摸星星。可是星星太高了，摸不到。月亮出来了，说：“小猫，星星在天上，也在水里哦！”小猫跑到山下的水边，看见好多星星在水里一亮一亮。小猫开心地笑了：“我看见星星了！”他坐在水边，看了好久好久，开开心心地回家睡觉了。',
};
