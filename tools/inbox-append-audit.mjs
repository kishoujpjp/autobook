// 在全新瀏覽器 context 使用合成資料與記憶體 Worker；不連真實收件匣或讀取私人書架。
// 先啟動 tools/devserver.py 8138；PLAYWRIGHT_MODULE 可指向既有 Playwright。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import worker from '../cloud/inbox/worker.js';
import { inboxStoryId } from '../js/inbox-transfer.js';
import { base, readToken, PNG, env, upload } from '../tests/inbox-fixtures.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8138';
const output = process.env.AUDIT_OUTPUT || '/tmp/autobook-inbox-append-audit';
const id = await inboxStoryId(base, 'story_001');
const browser = await chromium.launch({ headless: true });
const reports = [];
fs.mkdirSync(output, { recursive: true });

try {
  for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
    const e = env();
    await upload(e);
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let oldWorker = false;
    let failEarlierImage = false;
    let failAck = false;
    await page.route(`${base}/**`, async (route) => {
      const req = route.request();
      if ((oldWorker && req.url().endsWith('/v1/illustrations'))
          || (failEarlierImage && req.url().includes('/append_earlier/images/'))
          || (failAck && req.url().includes('/illustrations/') && req.url().endsWith('/receipts'))) {
        await route.fulfill({ status: oldWorker ? 404 : 503, contentType: 'application/json', body: JSON.stringify({ error: oldWorker ? 'not_found' : 'network' }) });
        return;
      }
      const headers = await req.allHeaders();
      const response = await worker.fetch(new Request(req.url(), { method: req.method(), headers,
        ...(req.postDataBuffer() ? { body: req.postDataBuffer() } : {}) }), e);
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.addInitScript(({ id, base, readToken, image }) => {
      if (localStorage.getItem('autobook.settings')) return;
      const parent = 'qa_parent';
      localStorage.setItem('autobook.accounts', JSON.stringify([{ id: parent, name: '家長', role: 'parent', avatar: { kind: 'preset', preset: 'fox' } }]));
      localStorage.setItem('autobook.currentAccount', JSON.stringify(parent));
      localStorage.setItem('autobook.inboxDevice', 'qa_device');
      localStorage.setItem('autobook.settings', JSON.stringify({ onboarded: true, storyLayout: 'side', storySpeak: false,
        tapSpeak: false, parentGateOn: false, toastVoice: false, inboxUrl: base, inboxReadToken: readToken, inboxAuto: false }));
      localStorage.setItem('autobook.stories', JSON.stringify([{ id, title: '合成測試繪本', text: '小貓回家。', lang: 'zh-Hant', textPolicy: 1,
        manual: true, hasImage: true, imagePrompt: '原圖', inbox: { source: base, id: 'story_001' },
        media: [{ id: 'qa_original', kind: 'image', url: image }],
        readsBy: { [parent]: 1, qa_child: 3 }, hlBy: { [parent]: [0], qa_child: [0, 1] },
        marksBy: { qa_child: { 1: 'green' } }, readings: { 0: { char: '小', syllable: 'xiao3' } } }]));
      localStorage.setItem('autobook.inbox', JSON.stringify([{ source: base, id: 'story_001', ackPending: false, deviceId: 'qa_device' }]));
    }, { id, base, readToken, image: `data:image/png;base64,${PNG.toString('base64')}` });
    await page.goto(origin);
    await page.waitForFunction(() => window.__autobookReady);
    await page.waitForFunction(() => document.querySelector('.media-view img')?.src);
    const initial = await page.evaluate(async (id) => {
      const store = await import('/js/store.js');
      return { story: structuredClone(store.getStory(id)), image: document.querySelector('.media-view img').src, words: JSON.stringify(store.words) };
    }, id);
    oldWorker = true;
    assert.equal((await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox())).error, '');
    oldWorker = false;
    await upload(e, 'illustrations', { id: 'append_first' });
    const first = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    assert.equal(first.images, 1);
    const received = await page.evaluate(async (id) => {
      const store = await import('/js/store.js');
      const story = store.getStory(id);
      return { story: structuredClone(story), image: document.querySelector('.media-view img').src,
        stored: !!await store.idbGet('images', story.media[1].id), words: JSON.stringify(store.words) };
    }, id);
    assert.equal(received.image, initial.image, '閱讀中不切換原圖');
    assert.ok(received.stored, '追加圖片已保存至真實 IndexedDB');
    assert.equal(received.words, initial.words, '追加不增加字表使用次數');
    const { media, inboxIllustrations, ...rest } = received.story;
    const { media: originalMedia, ...originalRest } = initial.story;
    assert.deepEqual(rest, originalRest);
    assert.deepEqual(media[0], originalMedia[0]);
    assert.equal(inboxIllustrations.length, 1);
    assert.equal((await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox())).images, 0);
    await page.evaluate(async () => {
      const nav = await import('/js/nav.js'); nav.showPage('shelf'); nav.showPage('story');
    });
    await page.waitForFunction(() => document.querySelector('.media-view img')?.src.startsWith('blob:'));
    assert.ok(await page.locator('.media-view img').evaluate((el) => el.complete && el.naturalWidth > 0));
    // 跨清單分頁、名稱逆序，仍按時間追加；較早圖失敗時同書較晚封包不能超車。
    await upload(e, 'illustrations', { id: 'append_earlier' });
    const earlierKey = 'illustrations/append_earlier.json';
    const earlier = await (await e.INBOX.get(earlierKey)).json();
    await e.INBOX.put(earlierKey, JSON.stringify({ ...earlier, createdAt: earlier.createdAt + 1 }));
    await upload(e, 'illustrations', { id: 'append_000_later' });
    const laterKey = 'illustrations/append_000_later.json';
    const later = await (await e.INBOX.get(laterKey)).json();
    await e.INBOX.put(laterKey, JSON.stringify({ ...later, createdAt: earlier.createdAt + 2 }));
    for (let i = 0; i < 50; i++) {
      const fid = `append_page_${String(i).padStart(3, '0')}`;
      await e.INBOX.put(`illustrations/${fid}.json`, JSON.stringify({ ...earlier, id: fid, createdAt: earlier.createdAt + 3 + i }));
    }
    failEarlierImage = true;
    const blocked = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    assert.equal(blocked.images, 0);
    assert.equal(blocked.error, 'network');
    // 這些分頁項目只測清單讀取，不需下載 50 份圖。
    for (let i = 0; i < 50; i++) await e.INBOX.delete(`illustrations/append_page_${String(i).padStart(3, '0')}.json`);
    failEarlierImage = false;
    failAck = true;
    const ackFailure = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    assert.equal(ackFailure.images, 1);
    failAck = false;
    const retry = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    assert.equal(retry.images, 1);
    const appliedOrder = await page.evaluate(async (id) => (await import('/js/store.js')).getStory(id).inboxIllustrations.map((u) => u.id), id);
    assert.deepEqual(appliedOrder, ['append_first', 'append_earlier', 'append_000_later']);
    // 家長手動上傳尚未完成時收到雲端追加，兩邊都不能用舊清單蓋掉另一張。
    await page.getByRole('button', { name: '閱讀設定', exact: true }).click();
    await page.getByRole('button', { name: '管理圖片／影片', exact: true }).click();
    const beforeManual = await page.evaluate(async (id) => (await import('/js/store.js')).getStory(id).media.length, id);
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (...args) {
        HTMLCanvasElement.prototype.toBlob = original;
        window.__qaUploadHeld = true;
        window.__qaReleaseUpload = () => original.apply(this, args);
      };
    });
    await page.locator('input[type=file][accept="image/*"]').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => window.__qaUploadHeld);
    await upload(e, 'illustrations', { id: 'append_during_manual' });
    assert.equal((await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox())).images, 1);
    assert.equal(await page.locator('.media-item').count(), beforeManual + 1);
    await page.evaluate(() => window.__qaReleaseUpload());
    await page.waitForFunction(async ({ id, count }) => (await import('/js/store.js')).getStory(id).media.length === count, { id, count: beforeManual + 2 });
    assert.equal(await page.locator('.media-item').count(), beforeManual + 2);
    await page.screenshot({ path: `${output}/media-${viewport.width}.png` });
    await page.locator('.modal-mask').last().locator('.modal-close').click();
    // 新圖及去重紀錄可由重新載入後的儲存層取得。
    await page.reload();
    await page.waitForFunction(() => window.__autobookReady);
    const persisted = await page.evaluate(async (id) => {
      const store = await import('/js/store.js');
      const story = store.getStory(id);
      return { count: story.media.length, allBlobs: (await Promise.all(story.media.slice(1).map((m) => store.idbGet('images', m.id)))).every(Boolean) };
    }, id);
    assert.equal(persisted.count, beforeManual + 2);
    assert.ok(persisted.allBlobs);
    // 真正 sync 的滿書架路徑：拒收新書但仍替既有書收圖。
    await upload(e, 'stories', { id: 'extra_story' });
    await upload(e, 'illustrations', { id: 'append_full_shelf' });
    await page.evaluate(async () => { const store = await import('/js/store.js'); while (store.stories.length < store.MAX_STORIES) store.stories.push({ id: `qa_full_${store.stories.length}`, title: '測試書', text: '書', textPolicy: 1 }); });
    const full = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    assert.equal(full.images, 1);
    assert.equal(full.error, 'shelf_full');
    // 刪書不復活；尚未收過的原書保持待收。
    await page.evaluate(async (id) => (await import('/js/store.js')).removeStory(id), id);
    await upload(e, 'illustrations', { id: 'append_deleted' });
    await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    const deleted = await (await e.INBOX.get('illustration-receipts/append_deleted/qa_device.json')).json();
    assert.equal(deleted.outcome, 'skipped_deleted');
    await page.evaluate(async () => { (await import('/js/store.js')).stories.splice(1); });
    await upload(e, 'stories', { id: 'new_story' });
    await upload(e, 'illustrations', { id: 'append_missing', targetId: 'new_story' });
    const missing = await page.evaluate(async () => (await import('/js/inbox.js')).syncInbox());
    // 現在空間足夠，先收原書再追加，不能建立第二份原書。
    assert.equal(missing.count, 1);
    assert.equal(missing.images, 1);
    assert.equal(missing.error, '');
    await page.evaluate(async () => (await import('/js/nav.js')).showPage('settings'));
    await page.screenshot({ path: `${output}/settings-${viewport.width}.png` });
    assert.deepEqual(errors, []);
    reports.push({ viewport, first, retry, appliedOrder, persisted, full, missing, errors });
    await context.close();
  }
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(reports, null, 2) + '\n');
  console.log(JSON.stringify({ passed: reports.length, output }));
} finally { await browser.close(); }
