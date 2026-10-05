import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import './stubs.js';
import * as store from '../js/store.js';
import { sha256, illustrationReceiptId, validateIllustrationManifest } from '../js/inbox-format.js';
import { receiveInboxIllustrations, inboxStoryId } from '../js/inbox-transfer.js';
import { cleanupReceived } from '../cloud/inbox/worker.js';
import { PNG, base, readToken, writeToken, env, call, body, upload } from './inbox-fixtures.js';

beforeEach(() => { localStorage.clear(); store.stories.splice(0); store.inboxReceipts.splice(0); });

const manifest = async (id = 'append_001') => ({ id, targetId: 'story_001', kind: 'illustrations',
  version: 1, createdAt: Date.now(), digest: 'a'.repeat(64),
  images: [{ index: 0, size: PNG.length, mime: 'image/png', sha256: await sha256(PNG) }] });

async function receiver({ legacy = false } = {}) {
  const id = await inboxStoryId(base, 'story_001');
  store.commitInboxStory({ id, inbox: { source: base, id: 'story_001' }, title: '原書', text: '小貓回家。',
    textPolicy: 1, lang: 'zh-Hant', hasImage: true, manual: true, imagePrompt: '原圖提示',
    ...(legacy ? {} : { media: [{ id: 'original_image', kind: 'image' }] }),
    hlBy: { child: [0, 1] }, marksBy: { child: { 1: 'green' } }, readsBy: { child: 2 },
    readings: { 0: { char: '小', syllable: 'xiao3' } } });
  const images = new Map(), events = [];
  const io = {
    receipt: store.inboxReceipt, saveReceipt: (source, rid, pending, outcome) => store.saveInboxReceipt(source, rid, pending, 'ipad_001', outcome),
    findStory: store.getStory, commit: store.commitInboxIllustrations,
    download: async () => { events.push('download'); return new Blob([PNG], { type: 'image/png' }); },
    prepare: async (blob) => blob, put: async (key, blob) => { images.set(key, blob); events.push('image'); },
    remove: async (key) => images.delete(key), checkActive() {},
    onApplied: () => events.push('applied'), ack: async (rid, outcome) => events.push(outcome),
  };
  return { id, images, events, io };
}

test('追加有獨立私人清單；舊書不可變且不會多一本，寫入與回條權限分離', async () => {
  const e = env();
  await upload(e);
  const original = await (await call(e, '/v1/stories/story_001')).json();
  assert.equal((await call(e, '/v1/illustrations', null)).status, 401);
  assert.equal((await call(e, '/v1/illustrations', readToken, { method: 'POST', body: body('illustrations') })).status, 403);
  assert.equal((await upload(e, 'illustrations')).status, 201);
  const packet = await (await call(e, '/v1/illustrations/append_001')).json();
  validateIllustrationManifest(packet);
  assert.deepEqual(await (await call(e, '/v1/stories')).json(), { ids: ['story_001'], cursor: null });
  assert.deepEqual(await (await call(e, '/v1/stories/story_001')).json(), original);
  assert.equal((await call(e, '/v1/illustrations/append_001/images/0', null)).status, 401);
  assert.equal((await call(e, '/v1/illustrations/append_001/receipts')).status, 403);
});

test('同一追加編號重試不重複，換圖或換原書回 409，並行競爭只有一份生效', async () => {
  const e = env();
  await upload(e);
  await upload(e, 'stories', { id: 'story_002' });
  const results = await Promise.all([
    upload(e, 'illustrations'), upload(e, 'illustrations', { targetId: 'story_002' }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const p = await (await call(e, '/v1/illustrations/append_001')).json();
  assert.equal((await upload(e, 'illustrations', { targetId: p.targetId })).status, 200);
  assert.equal((await upload(e, 'illustrations', { targetId: p.targetId }, Buffer.concat([PNG, Buffer.from('changed')]))).status, 409);
  const image = await (await call(e, '/v1/illustrations/append_001/images/0')).arrayBuffer();
  assert.equal(await sha256(image), p.images[0].sha256);
});

test('追加到不存在的原書或偽裝圖片遭拒；圖片寫入失敗不發布追加', async () => {
  const e = env();
  assert.equal((await upload(e, 'illustrations')).status, 404);
  await upload(e);
  assert.equal((await upload(e, 'illustrations', {}, Buffer.from('<html>'))).status, 400);
  e.INBOX.failImage = true;
  assert.equal((await upload(e, 'illustrations')).status, 500);
  assert.deepEqual((await (await call(e, '/v1/illustrations')).json()).ids, []);
});

test('追加七天清理獨立於原書，已清理原書仍可追加，清理後重試不復活', async () => {
  const e = env();
  await upload(e);
  const original = await (await call(e, '/v1/stories/story_001')).json();
  await upload(e, 'illustrations');
  for (const outcome of ['applied', 'skipped_deleted']) {
    const deviceId = outcome === 'applied' ? 'ipad_001' : 'safari_001';
    const res = await call(e, '/v1/illustrations/append_001/receipts', readToken,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, outcome }) });
    assert.equal(res.status, 200);
  }
  await cleanupReceived(e.INBOX, Date.now() + 8 * 86400000);
  assert.equal((await call(e, '/v1/illustrations/append_001')).status, 410);
  assert.deepEqual(await (await call(e, '/v1/stories/story_001')).json(), original);
  const status = await (await call(e, '/v1/illustrations/append_001/receipts', writeToken)).json();
  assert.equal(status.expired, true);
  assert.deepEqual(status.receipts.map((r) => r.outcome).sort(), ['applied', 'skipped_deleted']);
  assert.equal((await (await upload(e, 'illustrations')).json()).expired, true);
  await e.INBOX.put('completed/story_001.json', JSON.stringify({ digest: original.digest }));
  await e.INBOX.delete('manifests/story_001.json');
  assert.equal((await upload(e, 'illustrations', { id: 'append_002' })).status, 201);
});

test('追加落盤後才回條，保留原圖、內文、所有帳號閱讀紀錄與指定讀音', async () => {
  const r = await receiver();
  const original = structuredClone(store.getStory(r.id));
  assert.equal(await receiveInboxIllustrations(await manifest(), base, r.io), 1);
  const updated = store.getStory(r.id);
  const { media, inboxIllustrations, ...rest } = updated;
  const { media: oldMedia, ...oldRest } = original;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(media[0], oldMedia[0]);
  assert.equal(media.length, 2);
  assert.equal(inboxIllustrations.length, 1);
  assert.deepEqual(r.events, ['download', 'image', 'applied', 'applied']);
  assert.equal(JSON.parse(localStorage.getItem('autobook.stories'))[0].media.length, 2);
  assert.equal(store.inboxReceipt(base, illustrationReceiptId('append_001')).ackPending, false);
  assert.equal(await receiveInboxIllustrations(await manifest(), base, r.io), 0);
  assert.equal(r.images.size, 1);
});

test('舊式單張插圖兼容，書架滿仍能追加，下載期間加入的媒體保留順序', async () => {
  const r = await receiver({ legacy: true });
  while (store.stories.length < store.MAX_STORIES) store.stories.push({ id: `full_${store.stories.length}`, text: '書' });
  r.io.prepare = async (blob) => {
    const s = store.getStory(r.id);
    s.media = [...store.storyMedia(s), { id: 'manual_during_download', kind: 'video', url: 'https://example.com/video' }];
    s.readsBy.child = 3;
    return blob;
  };
  await receiveInboxIllustrations(await manifest(), base, r.io);
  assert.deepEqual(store.getStory(r.id).media.slice(0, 2).map((m) => m.id), [r.id, 'manual_during_download']);
  assert.equal(store.getStory(r.id).readsBy.child, 3);
  assert.equal(store.stories.length, store.MAX_STORIES);
});

test('回條斷線與回條存檔失敗可恢復，不重下載或重加圖片', async () => {
  const r = await receiver();
  r.io.ack = async () => { throw new Error('offline'); };
  await assert.rejects(receiveInboxIllustrations(await manifest(), base, r.io), /offline/);
  assert.equal(store.getStory(r.id).media.length, 2);
  r.io.ack = async () => r.events.push('ack');
  await receiveInboxIllustrations(await manifest(), base, r.io);
  assert.equal(r.events.filter((s) => s === 'download').length, 1);
  const raw = await manifest('append_002');
  const set = localStorage.setItem;
  localStorage.setItem = (key, val) => { if (key === 'autobook.inbox') throw new Error('QuotaExceeded'); set(key, val); };
  try { await assert.rejects(receiveInboxIllustrations(raw, base, r.io), /storage/); }
  finally { localStorage.setItem = set; }
  assert.equal(r.images.size, 2);
  await receiveInboxIllustrations(raw, base, r.io);
  assert.equal(r.events.filter((s) => s === 'download').length, 2);
  assert.equal(store.getStory(r.id).media.length, 3);
});

test('故事配額滿、取消或中途下載失敗不殘留媒體、不回條', async () => {
  const r = await receiver();
  const before = structuredClone(store.getStory(r.id));
  const set = localStorage.setItem;
  localStorage.setItem = (key, val) => { if (key === 'autobook.stories') throw new Error('QuotaExceeded'); set(key, val); };
  try { await assert.rejects(receiveInboxIllustrations(await manifest(), base, r.io), /storage/); }
  finally { localStorage.setItem = set; }
  assert.deepEqual(store.getStory(r.id), before);
  assert.equal(r.images.size, 0);
  const p = await manifest();
  p.images.push({ ...p.images[0], index: 1 });
  r.io.download = async (id, index) => { if (index === 1) throw new Error('offline'); return new Blob([PNG], { type: 'image/png' }); };
  await assert.rejects(receiveInboxIllustrations(p, base, r.io), /offline/);
  assert.equal(r.images.size, 0);
  r.io.checkActive = () => { throw new Error('cancelled'); };
  await assert.rejects(receiveInboxIllustrations(await manifest(), base, r.io), /cancelled/);
  assert.equal(r.images.size, 0);
  assert.equal(store.inboxReceipt(base, illustrationReceiptId(p.id)), undefined);
});

test('原書未收到時保留待收；已刪除時略過，不復活、不下載，回條明確區分', async () => {
  const r = await receiver();
  store.stories.splice(0);
  assert.equal(await receiveInboxIllustrations(await manifest(), base, r.io), 0);
  assert.deepEqual(r.events, ['skipped_deleted']);
  assert.equal(store.inboxReceipt(base, illustrationReceiptId('append_001')).outcome, 'skipped_deleted');
  store.inboxReceipts.splice(0);
  await assert.rejects(receiveInboxIllustrations(await manifest('append_002'), base, r.io), /target_missing/);
  assert.equal(r.images.size, 0);
});

test('下載途中原書被刪除時清理新圖，下次略過；移除追加圖後不重新加入', async () => {
  const r = await receiver();
  r.io.prepare = async (blob) => { store.stories.splice(0); return blob; };
  await assert.rejects(receiveInboxIllustrations(await manifest(), base, r.io), /target_missing/);
  assert.equal(r.images.size, 0);
  await receiveInboxIllustrations(await manifest(), base, r.io);
  const r2 = await receiver();
  const p = await manifest('append_003');
  await receiveInboxIllustrations(p, base, r2.io);
  store.getStory(r2.id).media.splice(1);
  store.inboxReceipts.splice(store.inboxReceipts.findIndex((r) => r.id === illustrationReceiptId(p.id)), 1);
  await receiveInboxIllustrations(p, base, r2.io);
  assert.equal(store.getStory(r2.id).media.length, 1);
  assert.equal(r2.events.filter((s) => s === 'download').length, 1);
});

test('來源不符或圖片校驗不符不能追加，故事與追加回條可用相同外部編號', async () => {
  const r = await receiver();
  const p = await manifest('story_001');
  await receiveInboxIllustrations(p, base, r.io);
  assert.ok(store.inboxReceipt(base, 'story_001'));
  assert.ok(store.inboxReceipt(base, 'illustration:story_001'));
  const bad = await manifest('append_bad');
  bad.images[0].sha256 = 'b'.repeat(64);
  await assert.rejects(receiveInboxIllustrations(bad, base, r.io), /image/);
  store.getStory(r.id).inbox.source = 'https://other.workers.dev';
  await assert.rejects(receiveInboxIllustrations(await manifest(), base, r.io), /conflict/);
  assert.equal(r.images.size, 1);
});
