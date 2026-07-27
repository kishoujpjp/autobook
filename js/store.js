// 資料層：settings / 字表 / 故事 用 localStorage；圖片與語音 blob 用 IndexedDB
import { t2s, s2t } from './zhconv.js';

export const VERSION = '1.10.0';

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
  weakMode: false,        // 不熟模式：遊戲只出紅字與白字
  wordLen: 'all',         // 認詞彙長度：'2' | '3' | 'all'
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
export function saveWords() { save(LS.words, words); }

/** 熟悉度紀錄的鍵：目前帳號＋目前語系 */
export function cardKey() {
  return `${currentAccountId}|${settings.lang}`;
}

const EMPTY_CARD = Object.freeze({ mark: null, markedAt: 0, flashCount: 0, ok: 0, ng: 0 });

export function getCard(w) {
  return (w.cards && w.cards[cardKey()]) || EMPTY_CARD;
}

export function ensureCard(w) {
  if (!w.cards) w.cards = {};
  const k = cardKey();
  if (!w.cards[k]) w.cards[k] = { mark: null, markedAt: 0, flashCount: 0, ok: 0, ng: 0 };
  return w.cards[k];
}

/** 學會的字 3 天內不進出題池 */
export const GREEN_COOLDOWN_MS = 3 * 24 * 3600 * 1000;

export function isCooling(w, now = Date.now()) {
  const c = getCard(w);
  return c.mark === 'green' && now - c.markedAt < GREEN_COOLDOWN_MS;
}

/** 點按循環：null → green → red → null，回傳新狀態 */
export function cycleMark(ch) {
  const w = words.find((x) => x.ch === ch);
  if (!w) return null;
  const c = ensureCard(w);
  c.mark = c.mark === null ? 'green' : c.mark === 'green' ? 'red' : null;
  c.markedAt = c.mark ? Date.now() : 0;
  saveWords();
  return c.mark;
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

/** 某字的「雙向一對一」等價字形（貓⇄猫）。多對應字（发↔發/髮）不算等價，不會被去重。 */
function equivalents(ch) {
  const out = [ch];
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
// story: { id, title, text, lang, createdAt, newChars:[], highlights:[idx], hasImage, demo }
export let stories = load(LS.stories, []);
export function saveStories() { save(LS.stories, stories); }

const MAX_STORIES = 24;

export async function addStory(story) {
  stories.unshift(story);
  while (stories.length > MAX_STORIES) {
    const old = stories.pop();
    await idbDel('images', old.id).catch(() => {});
  }
  saveStories();
}

export async function removeStory(id) {
  stories = stories.filter((s) => s.id !== id);
  saveStories();
  await idbDel('images', id).catch(() => {});
}

export function getStory(id) { return stories.find((s) => s.id === id); }

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
export const idbSet = (store, key, val) => tx(store, 'readwrite', (s) => s.put(val, key));
export const idbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());
export const idbClear = (store) => tx(store, 'readwrite', (s) => s.clear());

export async function clearAll() {
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
  '我你他的了在有一二三四五六七八九十大小上下天地日月山水火木花草蟲魚鳥貓狗兔熊媽爸家人手口心目耳朵頭來去看見說笑哭吃喝玩跑跳飛走坐站睡覺好不是要和跟朋友學校車球書畫紅黃藍綠白黑色風雨雲星亮光開關門窗高矮長短多少快慢新舊愛喜歡想什麼誰哪裡今明年月日早晚安';

export const DEMO_STORY_HANT = {
  title: '小貓看星星',
  text: '晚上，小貓坐在家門口看天上的星星。星星一亮一亮，好像在笑。小貓說：「我要跟星星玩！」他跳上高高的山，伸出手，想要摸星星。可是星星太高了，摸不到。月亮出來了，說：「小貓，星星在天上，也在水裡喔！」小貓跑到山下的水邊，看見好多星星在水裡一亮一亮。小貓開心地笑了：「我看見星星了！」他坐在水邊，看了好久好久，開開心心地回家睡覺了。',
};

export const DEMO_STORY_HANS = {
  title: '小猫看星星',
  text: '晚上，小猫坐在家门口看天上的星星。星星一亮一亮，好像在笑。小猫说：“我要跟星星玩！”他跳上高高的山，伸出手，想要摸星星。可是星星太高了，摸不到。月亮出来了，说：“小猫，星星在天上，也在水里哦！”小猫跑到山下的水边，看见好多星星在水里一亮一亮。小猫开心地笑了：“我看见星星了！”他坐在水边，看了好久好久，开开心心地回家睡觉了。',
};
