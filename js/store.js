// 資料層：settings / 字表 / 故事 用 localStorage；圖片與語音 blob 用 IndexedDB
export const VERSION = '1.4.2';

const LS = {
  settings: 'autobook.settings',
  words: 'autobook.words',
  stories: 'autobook.stories',
  accounts: 'autobook.accounts',
  currentAccount: 'autobook.currentAccount',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  lang: 'zh-Hant',
  tapSpeak: true,
  storyFont: 'small', // small | big

  textModel: 'gemini-2.5-flash',
  imageModel: 'gemini-2.5-flash-image',
  ttsModel: 'gemini-2.5-flash-preview-tts',
  voice: 'Leda',
};

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

// ---------- 字表 ----------
// word: { ch, addedAt, usedCount, readCount, ok, ng, flashCount, mark, markedAt }
// flashCount＝字卡/詞卡出現次數；mark＝'green'(學會)/'red'(還不會)/null；markedAt＝標記時間
export let words = load(LS.words, []);
for (const w of words) {
  if (w.flashCount == null) w.flashCount = 0;
  if (w.mark === undefined) w.mark = null;
  if (w.markedAt == null) w.markedAt = 0;
}
export function saveWords() { save(LS.words, words); }

/** 學會的字 3 天內不進出題池 */
export const GREEN_COOLDOWN_MS = 3 * 24 * 3600 * 1000;

export function isCooling(w, now = Date.now()) {
  return w.mark === 'green' && now - w.markedAt < GREEN_COOLDOWN_MS;
}

/** 點按循環：null → green → red → null，回傳新狀態 */
export function cycleMark(ch) {
  const w = words.find((x) => x.ch === ch);
  if (!w) return null;
  w.mark = w.mark === null ? 'green' : w.mark === 'green' ? 'red' : null;
  w.markedAt = w.mark ? Date.now() : 0;
  saveWords();
  return w.mark;
}

export function bumpFlash(chs) {
  const set = new Set(chs);
  for (const w of words) if (set.has(w.ch)) w.flashCount++;
  saveWords();
}

export function wordSet() { return new Set(words.map((w) => w.ch)); }

const HAN_RE = /\p{Script=Han}/u;
export function isHan(ch) { return HAN_RE.test(ch); }

export function addWords(text) {
  const set = wordSet();
  let added = 0, dup = 0;
  const now = Date.now();
  for (const ch of text) {
    if (!isHan(ch)) continue;
    if (set.has(ch)) { dup++; continue; }
    set.add(ch);
    words.push({
      ch, addedAt: now + added, usedCount: 0, readCount: 0, ok: 0, ng: 0,
      flashCount: 0, mark: null, markedAt: 0,
    });
    added++;
  }
  if (added) saveWords();
  return { added, dup };
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
  if (w) { correct ? w.ok++ : w.ng++; saveWords(); }
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
