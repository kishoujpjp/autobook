import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './stubs.js';
import { convertTo } from '../js/zhconv.js';

const originalWords = [{ ch: '猫', addedAt: 1, cards: { 'kid|zh-Hant': { mark: 'red', markedAt: 10 } } },
  { ch: '貓', addedAt: 2, cards: { 'kid|zh-Hant': { mark: 'green', markedAt: 20 } } }];
const originalStory = { id: 'legacy', title: '皇後喫飯', text: '皇後起牀喫飯。', lang: 'zh-Hant',
  hlBy: { kid: [0, 2] }, marksBy: { kid: { 1: 'red' } }, readsBy: { kid: 4 } };
seed('autobook.words', originalWords);
seed('autobook.stories', [originalStory]);
const store = await import('../js/store.js');

test('啟動時舊字表／故事先備份，再保存繁體資料與標註', () => {
  assert.deepEqual(store.words.map((w) => w.ch), ['貓']);
  const backup = JSON.parse(localStorage.getItem('autobook.textBackup'));
  assert.deepEqual(backup.words.map((w) => w.ch), originalWords.map((w) => w.ch));
  assert.equal(backup.words[0].cards['kid|zh-Hant'].mark, 'red');
  assert.equal(store.words[0].cards['kid|zh-Hant'].mark, 'green');
  const fixed = store.getStory('legacy');
  assert.equal(fixed.text, '皇后起床吃飯。');
  assert.deepEqual(fixed.textBackup, originalStory);
  assert.deepEqual(fixed.hlBy, originalStory.hlBy);
  assert.deepEqual(fixed.marksBy, originalStory.marksBy);
  assert.deepEqual(fixed.readsBy, originalStory.readsBy);
  assert.equal(JSON.parse(localStorage.getItem('autobook.stories'))[0].text, fixed.text);
  assert.ok(store.BACKUP_KEYS.includes('autobook.textBackup'));
});

test('簡體介面新增故事與字表仍以繁體落盤，顯示轉換不回寫', async () => {
  store.settings.lang = 'zh-Hans';
  const newStory = { id: 'manual', title: '皇后吃饭', text: '头发干净。苎麻。', lang: 'zh-Hans' };
  await store.addStory(newStory);
  assert.equal(newStory.lang, 'zh-Hant');
  assert.equal(newStory.text, '頭髮乾淨。苧麻。');
  const original = JSON.stringify(newStory);
  assert.equal(convertTo(newStory.text, 'zh-Hans'), '头发干净。苎麻。');
  assert.equal(JSON.stringify(newStory), original);
  assert.equal(store.addWords('饭').added, 1);
  assert.ok(store.words.some((w) => w.ch === '飯'));
  assert.ok(!store.words.some((w) => w.ch === '饭'));
  store.flushSaves();
  assert.equal(JSON.parse(localStorage.getItem('autobook.stories'))[0].text, newStory.text);
});

test('字形備份因配額滿而失敗時，不改寫舊字表或舊故事', async () => {
  store.cancelPendingSaves();
  seed('autobook.words', originalWords);
  seed('autobook.stories', [originalStory]);
  localStorage.removeItem('autobook.textBackup');
  const setItem = localStorage.setItem;
  localStorage.setItem = (key, val) => {
    if (key === 'autobook.textBackup') throw new Error('QuotaExceeded');
    return setItem(key, val);
  };
  let failed;
  try {
    failed = await import('../js/store.js?backup-denied');
    assert.deepEqual(failed.words.map((w) => w.ch), ['猫', '貓']);
    assert.equal(failed.getStory('legacy').text, originalStory.text);
    assert.deepEqual(JSON.parse(localStorage.getItem('autobook.words')), originalWords);
    assert.deepEqual(JSON.parse(localStorage.getItem('autobook.stories')), [originalStory]);
  } finally {
    failed?.cancelPendingSaves();
    localStorage.setItem = setItem;
  }
});
