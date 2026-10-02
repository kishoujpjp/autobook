import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './stubs.js';

seed('autobook.stories', []);
const store = await import('../js/store.js');
const story = () => ({ id: 'inbox_test', title: '小貓', text: '小貓回家。', inbox: { source: 'https://test.workers.dev', id: 'story_001' }, manual: true });

test('匯入提交立即保存故事與接收紀錄，不依賴延遲 flush', () => {
  store.commitInboxStory(story());
  assert.equal(JSON.parse(localStorage.getItem('autobook.stories'))[0].id, 'inbox_test');
  assert.equal(JSON.parse(localStorage.getItem('autobook.inbox'))[0].ackPending, true);
  assert.equal(store.commitInboxStory(story()), false);
  assert.equal(store.stories.length, 1);
});

test('localStorage 配額滿時不新增記憶體故事、不回報接收成功', () => {
  const prev = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  try {
    assert.throws(() => store.commitInboxStory({ ...story(), id: 'inbox_failed' }), /storage/);
    assert.equal(store.getStory('inbox_failed'), undefined);
  } finally { localStorage.setItem = prev; }
});

test('網路匯入書架滿時保留既有 240 本，接收紀錄隨備份保存', () => {
  while (store.stories.length < store.MAX_STORIES) store.stories.push({ id: `full_${store.stories.length}`, title: '書', text: '字' });
  const ids = store.stories.map((s) => s.id);
  assert.throws(() => store.commitInboxStory({ ...story(), id: 'inbox_full' }), /shelf_full/);
  assert.deepEqual(store.stories.map((s) => s.id), ids);
  assert.ok(store.BACKUP_KEYS.includes('autobook.inbox'));
  assert.ok(!store.BACKUP_KEYS.includes('autobook.inboxDevice'));
});
