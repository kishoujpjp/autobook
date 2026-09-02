// 測試用的最小瀏覽器環境：store.js 在 module 求值時就會碰 localStorage／document／indexedDB，
// 這裡給它們一個記憶體版，讓純函式可以在 node:test 裡直接 import。
// 新版 Node 有些全域（navigator、localStorage）是唯讀 getter，所以一律用 defineProperty 覆蓋。
const mem = new Map();
const def = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

def('localStorage', {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
});
def('window', globalThis);
def('document', {
  addEventListener() {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {} }),
});
def('CustomEvent', class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } });
def('dispatchEvent', () => true);
def('addEventListener', () => {});
// IndexedDB：一律「開啟失敗」（下一個 tick 觸發 onerror），所有 idb* 呼叫都會 reject 並被呼叫端的 .catch 吃掉；
// 不能讓它永遠 pending，否則 addStory 淘汰舊書時 await dropStoryBlobs 會卡住整個測試
def('indexedDB', {
  open: () => {
    const req = { error: new Error('no indexedDB in tests') };
    setTimeout(() => { if (req.onerror) req.onerror(); }, 0);
    return req;
  },
});
def('navigator', { userAgent: 'node-test' });
export const seed = (key, value) => mem.set(key, JSON.stringify(value));
