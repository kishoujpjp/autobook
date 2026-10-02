import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import worker from '../cloud/inbox/worker.js';
import { sha256, sha256Portable, inboxUrl, parsePairing, validateManifest } from '../js/inbox-format.js';
import { receiveInboxStory } from '../js/inbox-transfer.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4uoAAAAASUVORK5CYII=', 'base64');
const readToken = 'r'.repeat(43);
const writeToken = 'w'.repeat(43);
const base = 'https://autobook-inbox.test.workers.dev';

test('WKWebView 沒有 SubtleCrypto 時，SHA-256 校驗與 Node 標準實作一致', async () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('abc'), Buffer.from('小貓回家。'), randomBytes(55), randomBytes(56), randomBytes(63), randomBytes(64), randomBytes(1000000)]) {
    assert.equal(sha256Portable(bytes), createHash('sha256').update(bytes).digest('hex'));
  }
  const previous = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try { assert.equal(await sha256('abc'), createHash('sha256').update('abc').digest('hex')); }
  finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: previous }); }
});

class Bucket {
  data = new Map();
  failImage = false;
  async get(key) {
    if (!this.data.has(key)) return null;
    const v = this.data.get(key);
    const response = new Response(v.body);
    return { body: response.body, json: () => response.json() };
  }
  async put(key, body, options = {}) {
    if (key.startsWith('images/') && this.failImage) throw new Error('simulated R2 failure');
    if (options.onlyIf?.get('If-None-Match') === '*' && this.data.has(key)) return null;
    this.data.set(key, { body, options });
    return { key };
  }
  async list({ prefix, cursor, limit }) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    return { objects: keys.slice(start, start + limit).map((key) => ({ key })),
      truncated: start + limit < keys.length, cursor: String(start + limit) };
  }
}

function env() { return { INBOX: new Bucket(), READ_TOKEN: readToken, WRITE_TOKEN: writeToken,
  ALLOWED_ORIGINS: 'https://kishoujpjp.github.io,https://localhost' }; }

async function call(e, path, token, options = {}) {
  return worker.fetch(new Request(base + path, { ...options, headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e);
}

function uploadBody({ id = 'story_001', title = '小猫', text = '小猫有好朋友。' } = {}, bytes = PNG) {
  const body = new FormData();
  body.set('story', JSON.stringify({ id, title, text }));
  body.append('images', new Blob([bytes], { type: 'image/png' }), 'cat.png');
  return body;
}

test('私人接口：匿名無法列故事，讀取憑證無法寫故事或查看全家回條', async () => {
  const e = env();
  assert.equal((await call(e, '/v1/stories')).status, 401);
  assert.equal((await call(e, '/v1/stories', readToken, { method: 'POST', body: uploadBody() })).status, 403);
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody() })).status, 201);
  assert.equal((await call(e, '/v1/stories/story_001/receipts', readToken)).status, 403);
  assert.equal((await call(e, '/v1/stories/story_001/images/0')).status, 401);
});

test('CORS 限定 App origin，合法預檢支援 Authorization，回應不快取', async () => {
  const e = env();
  const allowed = await call(e, '/v1/stories', null, { method: 'OPTIONS', headers: { Origin: 'https://localhost' } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://localhost');
  assert.match(allowed.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const rejected = await call(e, '/v1/stories', readToken, { headers: { Origin: 'https://unknown.example' } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(rejected.headers.get('Cache-Control'), 'no-store');
});

test('圖片存好才發布；相同內容可重傳，不同內容同 id 拒絕，核心文字轉繁體', async () => {
  const e = env();
  e.INBOX.failImage = true;
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody() })).status, 500);
  assert.equal((await (await call(e, '/v1/stories', readToken)).json()).ids.length, 0);
  e.INBOX.failImage = false;
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody() })).status, 201);
  const original = await (await call(e, '/v1/stories/story_001', readToken)).json();
  assert.equal(original.title, '小貓');
  assert.equal(original.text, '小貓有好朋友。');
  validateManifest(original);
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody() })).status, 200);
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody({ text: '小狗來了。' }) })).status, 409);
  assert.equal((await (await call(e, '/v1/stories/story_001', readToken)).json()).digest, original.digest);
});

test('並行傳送同 id 不同內容，只有一份 manifest 生效，圖片仍屬於該份內容', async () => {
  const e = env();
  const results = await Promise.all([
    call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody({ text: '小貓回家。' }) }),
    call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody({ text: '小狗回家。' }) }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const packet = await (await call(e, '/v1/stories/story_001', readToken)).json();
  const image = await (await call(e, '/v1/stories/story_001/images/0', readToken)).arrayBuffer();
  assert.equal(await sha256(image), packet.images[0].sha256);
});

test('拒絕偽裝成 image/png 的 HTML 與超長故事', async () => {
  const e = env();
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody({}, Buffer.from('<html>bad</html>')) })).status, 400);
  assert.equal((await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody({ text: '字'.repeat(1501) }) })).status, 400);
  assert.equal(e.INBOX.data.size, 0);
});

test('兩個裝置各自回報接收狀態，回條不刪除故事，列表分頁保留 cursor', async () => {
  const e = env();
  await call(e, '/v1/stories', writeToken, { method: 'POST', body: uploadBody() });
  for (const deviceId of ['ipad_001', 'safari_001']) {
    assert.equal((await call(e, '/v1/stories/story_001/receipts', readToken, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId }) })).status, 200);
  }
  const receipts = await (await call(e, '/v1/stories/story_001/receipts', writeToken)).json();
  assert.equal(receipts.receipts.length, 2);
  assert.equal((await call(e, '/v1/stories/story_001', readToken)).status, 200);
  for (let i = 0; i < 50; i++) await e.INBOX.put(`manifests/page_${String(i).padStart(3, '0')}.json`, '{}');
  const first = await (await call(e, '/v1/stories', readToken)).json();
  assert.equal(first.ids.length, 50);
  assert.ok(first.cursor);
  const second = await (await call(e, `/v1/stories?cursor=${first.cursor}`, readToken)).json();
  assert.equal(second.ids.length, 1);
  assert.equal(second.cursor, null);
});

async function packet() {
  return { id: 'story_001', title: '小貓', text: '小貓回家。', createdAt: Date.now(), version: 1,
    digest: 'a'.repeat(64), images: [{ index: 0, size: PNG.length, mime: 'image/png', sha256: await sha256(PNG) }] };
}

function receiver() {
  const saved = new Map(), receipts = new Map(), images = new Map(), events = [];
  const io = {
    receipt: (source, id) => receipts.get(source + id),
    saveReceipt: (source, id, ackPending) => receipts.set(source + id, { ackPending }),
    findStory: (id) => saved.get(id), hasRoom: () => true, newChars: () => [],
    download: async () => new Blob([PNG], { type: 'image/png' }), prepare: async (blob) => blob,
    put: async (key, blob) => { images.set(key, blob); events.push('image'); }, remove: async (key) => images.delete(key),
    checkActive() {},
    commit: (story) => { saved.set(story.id, story); events.push('story'); io.saveReceipt(base, story.inbox.id, true); },
    onImported: () => events.push('imported'), ack: async () => events.push('ack'),
  };
  return { io, saved, receipts, images, events };
}

test('圖片與故事落盤後才回條；刪除已收到故事不會重新下載／新增', async () => {
  const r = receiver();
  assert.equal(await receiveInboxStory(await packet(), base, r.io), true);
  assert.deepEqual(r.events, ['image', 'story', 'imported', 'ack']);
  r.saved.clear(); // 使用者刪書，接收紀錄仍在
  assert.equal(await receiveInboxStory(await packet(), base, r.io), false);
  assert.equal(r.saved.size, 0);
  assert.deepEqual(r.events, ['image', 'story', 'imported', 'ack']);
});

test('回條斷線後，只重送回條，不重存書或圖片', async () => {
  const r = receiver();
  r.io.ack = async () => { throw new Error('offline'); };
  await assert.rejects(receiveInboxStory(await packet(), base, r.io), /offline/);
  assert.equal(r.saved.size, 1);
  assert.equal(r.images.size, 1);
  r.io.ack = async () => r.events.push('ack');
  assert.equal(await receiveInboxStory(await packet(), base, r.io), false);
  assert.deepEqual(r.events, ['image', 'story', 'imported', 'ack']);
});

test('故事落盤後接收紀錄寫入失敗，保留圖片，下次由已存好的故事恢復', async () => {
  const r = receiver();
  r.io.commit = (story) => { r.saved.set(story.id, story); throw new Error('storage'); };
  await assert.rejects(receiveInboxStory(await packet(), base, r.io), /storage/);
  assert.equal(r.images.size, 1);
  assert.equal(await receiveInboxStory(await packet(), base, r.io), false);
  assert.equal(r.saved.size, 1);
  assert.deepEqual(r.events, ['image', 'ack']);
});

test('半途下載失敗清理已存圖片，書架滿時完全不下載，不發回條', async () => {
  const r = receiver();
  const p = await packet();
  p.images.push({ ...p.images[0], index: 1 });
  r.io.download = async (id, index) => {
    if (index === 1) throw new Error('offline');
    return new Blob([PNG], { type: 'image/png' });
  };
  await assert.rejects(receiveInboxStory(p, base, r.io), /offline/);
  assert.equal(r.images.size, 0);
  assert.equal(r.saved.size, 0);
  assert.deepEqual(r.events, ['image']);
  r.io.hasRoom = () => false;
  await assert.rejects(receiveInboxStory(await packet(), base, r.io), /shelf_full/);
  assert.deepEqual(r.events, ['image']);
});

test('圖片校驗值不對與取消接收，均不留下新故事／回條', async () => {
  const r = receiver();
  const bad = await packet();
  bad.images[0].sha256 = 'b'.repeat(64);
  await assert.rejects(receiveInboxStory(bad, base, r.io), /image/);
  assert.equal(r.images.size, 0);
  r.io.checkActive = () => { throw new Error('cancelled'); };
  await assert.rejects(receiveInboxStory(await packet(), base, r.io), /cancelled/);
  assert.equal(r.images.size, 0);
  assert.equal(r.saved.size, 0);
  assert.ok(!r.events.includes('ack'));
});

test('配對碼只允許 HTTPS workers.dev 根網址，不攜帶寫入憑證', () => {
  assert.equal(inboxUrl(base + '/'), base);
  for (const bad of ['http://autobook-inbox.test.workers.dev', base + '/path', base + '?key=x', 'https://workers.dev.evil.example', 'https://user:pass@autobook-inbox.test.workers.dev']) {
    assert.throws(() => inboxUrl(bad), /config/);
  }
  const code = 'AB1.' + Buffer.from(JSON.stringify({ url: base, readToken })).toString('base64url');
  assert.deepEqual(parsePairing(code), { url: base, readToken });
  assert.throws(() => parsePairing('AB1.invalid'), /config/);
});
