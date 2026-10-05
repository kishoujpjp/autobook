// 開啟／回前景／恢復連線時接收故事；開著 App 時每分鐘檢查一次。
import { settings, saveSettings, stories, words, MAX_STORIES, getStory, commitInboxStory, commitInboxIllustrations,
  inboxReceipt, saveInboxReceipt, idbSet, idbDel, bumpUsed } from './store.js';
import { inboxUrl, parsePairing, InboxError, INBOX_LIMITS, INBOX_ID, illustrationReceiptId, validateIllustrationManifest } from './inbox-format.js';
import { receiveInboxStory, receiveInboxIllustrations } from './inbox-transfer.js';
import { findNewChars } from './gemini.js';

const listeners = new Set();
let state = { kind: 'idle', count: 0, images: 0, error: '', at: 0 };
let running = null;
let controller = null;
let started = false;
let paused = 0;

export function inboxStatus() { return state; }
export function watchInbox(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function status(next) {
  state = { ...state, ...next };
  for (const fn of listeners) fn(state);
}
export function hasInbox() { return !!(settings.inboxUrl && settings.inboxReadToken); }

function config() {
  return { url: inboxUrl(settings.inboxUrl), token: settings.inboxReadToken };
}

async function request(cfg, path, { signal, ...options } = {}) {
  const ac = new AbortController();
  const abort = () => ac.abort();
  if (signal?.aborted) ac.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45000);
  try {
    const response = await fetch(cfg.url + path, {
      ...options, signal: ac.signal, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { ...options.headers, Authorization: `Bearer ${cfg.token}` },
    });
    if (!response.ok) {
      let error = '';
      try { error = (await response.json()).error; } catch { /* 網路代理的非 JSON 回應 */ }
      throw new InboxError(error || (response.status === 401 ? 'auth' : 'network'), response.status);
    }
    // 讀取 body 也受逾時與切換收件匣取消控制。
    if (path.includes('/images/')) {
      const chunks = [];
      const reader = response.body.getReader();
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > INBOX_LIMITS.imageBytes) throw new InboxError('too_large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      return new Blob(chunks, { type: (response.headers.get('Content-Type') || '').split(';')[0] });
    }
    return await response.json();
  } catch (e) {
    if (e instanceof InboxError) throw e;
    throw new InboxError(signal?.aborted ? 'cancelled' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function pairInbox(code) {
  const pairing = parsePairing(code.trim());
  await request({ url: pairing.url, token: pairing.readToken }, '/v1/stories');
  controller?.abort();
  if (running) await running;
  const previous = { url: settings.inboxUrl, token: settings.inboxReadToken };
  settings.inboxUrl = pairing.url;
  settings.inboxReadToken = pairing.readToken;
  if (!saveSettings()) {
    settings.inboxUrl = previous.url;
    settings.inboxReadToken = previous.token;
    throw new InboxError('storage');
  }
  status({ kind: 'idle', error: '', count: 0, images: 0, at: 0 });
}

export function disconnectInbox() {
  controller?.abort();
  const previous = { url: settings.inboxUrl, token: settings.inboxReadToken };
  settings.inboxUrl = '';
  settings.inboxReadToken = '';
  if (!saveSettings()) {
    settings.inboxUrl = previous.url;
    settings.inboxReadToken = previous.token;
    throw new InboxError('storage');
  }
  status({ kind: 'idle', error: '', count: 0, images: 0, at: 0 });
}

function deviceId() {
  // 裝置身份不放備份：Safari 與原生 App 各有自己的接收回條。
  const key = 'autobook.inboxDevice';
  try {
    let id = localStorage.getItem(key);
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id || '')) {
      id = crypto.randomUUID ? crypto.randomUUID()
        : [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch { throw new InboxError('storage'); }
}

function prepareImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); reject(new InboxError('image')); }, 20000);
    img.onerror = () => { cleanup(); reject(new InboxError('image')); };
    img.onload = () => {
      try {
        if (!img.width || !img.height || img.width * img.height > 40000000) throw new InboxError('image');
        const k = Math.min(1, 1280 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * k));
        canvas.height = Math.max(1, Math.round(img.height * k));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => { cleanup(); b ? resolve(b) : reject(new InboxError('image')); }, 'image/jpeg', 0.85);
      } catch { cleanup(); reject(new InboxError('image')); }
    };
    img.src = url;
  });
}

export function syncInbox() {
  if (paused) return Promise.resolve({ count: 0 });
  if (running) return running;
  if (!hasInbox()) return Promise.resolve({ count: 0 });
  controller = new AbortController();
  const signal = controller.signal;
  running = sync(signal).finally(() => { running = null; controller = null; });
  return running;
}

/** 備份匯入／清除資料前等接收停止，避免兩個流程互相覆蓋 localStorage 與圖片。 */
export async function pauseInbox() {
  paused++;
  controller?.abort();
  if (running) await running;
  let resumed = false;
  return () => { if (!resumed) { resumed = true; paused--; } };
}

async function sync(signal) {
  let count = 0;
  let images = 0;
  const failures = [];
  status({ kind: 'checking', count: 0, images: 0, error: '' });
  try {
    const cfg = config();
    const device = deviceId();
    let cursor = null;
    const cursors = new Set();
    do {
      const page = await request(cfg, `/v1/stories${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal });
      if (!Array.isArray(page.ids) || page.ids.length > 50 || (page.cursor !== null && typeof page.cursor !== 'string')) throw new InboxError('format');
      for (const id of page.ids) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(id)) throw new InboxError('format');
        const receipt = inboxReceipt(cfg.url, id);
        const ack = async (remoteId) => {
          await request(cfg, `/v1/stories/${remoteId}/receipts`, {
            method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: device }),
          });
        };
        if (receipt && !receipt.ackPending && receipt.deviceId === device) continue;
        try {
          if (receipt) {
            await ack(id);
            saveInboxReceipt(cfg.url, id, false, device);
            continue;
          }
          const packet = await request(cfg, `/v1/stories/${id}`, { signal });
          if (packet.id !== id) throw new InboxError('format');
          await receiveInboxStory(packet, cfg.url, {
            receipt: inboxReceipt, saveReceipt: (source, remoteId, pending) => saveInboxReceipt(source, remoteId, pending, device), findStory: getStory,
            hasRoom: () => stories.length < MAX_STORIES,
            newChars: (text) => findNewChars(text, new Set(words.map((w) => w.ch))),
            download: (remoteId, index) => request(cfg, `/v1/stories/${remoteId}/images/${index}`, { signal }),
            prepare: prepareImage, put: (key, blob) => idbSet('images', key, blob), remove: (key) => idbDel('images', key),
            checkActive: () => { if (signal.aborted || settings.inboxUrl !== cfg.url || settings.inboxReadToken !== cfg.token) throw new InboxError('cancelled'); },
            commit: commitInboxStory, ack,
            onImported: (story) => {
              count++;
              bumpUsed(words.filter((w) => story.text.includes(w.ch)).map((w) => w.ch));
              window.dispatchEvent(new CustomEvent('autobook:inbox-story', { detail: { id: story.id } }));
              status({ count });
            },
          });
        } catch (e) {
          const code = e.code || (['storage', 'shelf_full'].includes(e.message) ? e.message : 'network');
          if (code === 'cancelled' || code === 'auth' || code === 'storage') throw new InboxError(code);
          failures.push(code);
        }
      }
      cursor = page.cursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new InboxError('format');
        cursors.add(cursor);
      }
    } while (cursor);
    // 原書先接收，再處理追加；書架滿也不妨礙既有書收圖。
    await syncIllustrations(cfg, device, signal, failures, (id, n) => {
      images += n;
      window.dispatchEvent(new CustomEvent('autobook:inbox-story', { detail: { id } }));
      status({ images });
    });
    status({ kind: failures.length ? 'error' : 'done', count, error: failures[0] || '', at: Date.now() });
  } catch (e) {
    if (e.code !== 'cancelled') status({ kind: 'error', count, error: e.code || 'network', at: Date.now() });
  }
  return { count, images, error: state.error };
}

async function syncIllustrations(cfg, device, signal, failures, onApplied) {
  const packets = [];
  const cursors = new Set();
  let cursor = null;
  const ack = (id, outcome) => request(cfg, `/v1/illustrations/${id}/receipts`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: device, outcome }),
  });
  do {
    let page;
    try { page = await request(cfg, `/v1/illustrations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }); }
    catch (e) {
      if (!cursor && e.status === 404 && e.code === 'not_found') return; // 相容尚未升級的 Worker
      throw e;
    }
    if (!Array.isArray(page.ids) || page.ids.length > 50 || (page.cursor !== null && typeof page.cursor !== 'string')) throw new InboxError('format');
    for (const id of page.ids) {
      if (typeof id !== 'string' || !INBOX_ID.test(id)) throw new InboxError('format');
      const receiptId = illustrationReceiptId(id);
      const receipt = inboxReceipt(cfg.url, receiptId);
      if (receipt) {
        if (receipt.ackPending || receipt.deviceId !== device) {
          await ack(id, receipt.outcome);
          saveInboxReceipt(cfg.url, receiptId, false, device, receipt.outcome);
        }
        continue;
      }
      const packet = validateIllustrationManifest(await request(cfg, `/v1/illustrations/${id}`, { signal }));
      if (packet.id !== id) throw new InboxError('format');
      packets.push(packet);
    }
    cursor = page.cursor;
    if (cursor) {
      if (cursors.has(cursor)) throw new InboxError('format');
      cursors.add(cursor);
    }
  } while (cursor);
  // 跨分頁按上傳時間處理；同一本較早追加失敗時，後續追加留到下一輪。
  packets.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const blocked = new Set();
  for (const packet of packets) {
    if (blocked.has(packet.targetId)) continue;
    try {
      await receiveInboxIllustrations(packet, cfg.url, {
        receipt: inboxReceipt, saveReceipt: (source, id, pending, outcome) => saveInboxReceipt(source, id, pending, device, outcome),
        findStory: getStory, download: (id, index) => request(cfg, `/v1/illustrations/${id}/images/${index}`, { signal }),
        prepare: prepareImage, put: (key, blob) => idbSet('images', key, blob), remove: (key) => idbDel('images', key),
        checkActive: () => { if (signal.aborted || settings.inboxUrl !== cfg.url || settings.inboxReadToken !== cfg.token) throw new InboxError('cancelled'); },
        commit: commitInboxIllustrations, ack, onApplied,
      });
    } catch (e) {
      const code = e.code || (['storage', 'target_missing', 'conflict'].includes(e.message) ? e.message : 'network');
      if (['cancelled', 'auth', 'storage'].includes(code)) throw new InboxError(code);
      blocked.add(packet.targetId);
      failures.push(code);
    }
  }
}

export function startInbox() {
  if (started) return;
  started = true;
  const auto = () => {
    if (settings.inboxAuto && document.visibilityState === 'visible' && navigator.onLine !== false) syncInbox();
  };
  document.addEventListener('visibilitychange', auto);
  window.addEventListener('online', auto);
  setInterval(auto, 60000);
  auto();
}
