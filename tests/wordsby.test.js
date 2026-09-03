import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './stubs.js';

// v1.28.0：字表全家共用一份、紅綠依帳號分開。v1.27.0 的每帳號字表（wordsBy）啟動時要合併回共用。
seed('autobook.words', [{ ch: '貓', addedAt: 1, usedCount: 2, readCount: 0, archived: false, cards: { 'k1|zh-Hant': { mark: 'red', markedAt: 5, flashCount: 0, ok: 0, ng: 0 } } }]);
seed('autobook.wordsBy', {
  k1: [{ ch: '貓', addedAt: 1, usedCount: 0, readCount: 0, archived: false, cards: {} }],
  k2: [{ ch: '狗', addedAt: 2, usedCount: 0, readCount: 0, archived: true, cards: { 'k2|zh-Hant': { mark: 'green', markedAt: 9, flashCount: 1, ok: 0, ng: 0 } } }],
});
seed('autobook.accounts', [
  { id: 'p1', name: '家長', role: 'parent', avatar: { kind: 'preset', preset: 'bear' } },
  { id: 'k1', name: '大寶', role: 'kid', avatar: { kind: 'preset', preset: 'cat' } },
  { id: 'k2', name: '二寶', role: 'kid', avatar: { kind: 'preset', preset: 'dog' } },
]);
seed('autobook.currentAccount', 'p1');

const store = await import('../js/store.js');

test('每帳號字表合併回共用：字取聯集、各帳號紅綠保留、wordsBy 清掉', () => {
  assert.deepEqual(store.words.map((w) => w.ch).sort(), ['狗', '貓']);
  const dog = store.words.find((w) => w.ch === '狗');
  assert.equal(dog.archived, true);
  assert.equal(store.getCard(dog, 'k2').mark, 'green');
  assert.equal(store.getCard(store.words.find((w) => w.ch === '貓'), 'k1').mark, 'red');
  assert.equal(localStorage.getItem('autobook.wordsBy'), null);
});

test('家長登入時紅綠對象是第一個小孩；切換管理對象後寫給另一個小孩，字表不變', () => {
  assert.equal(store.activeAccId, 'k1');
  assert.equal(store.cardKey(), `k1|${store.settings.lang}`);
  store.setManageAcc('k2');
  store.setMark('貓', 'green');
  const cat = store.words.find((w) => w.ch === '貓');
  assert.equal(store.getCard(cat, 'k2').mark, 'green');
  assert.equal(store.getCard(cat, 'k1').mark, 'red');
  store.addWords('魚');
  assert.equal(store.words.length, 3); // 新字所有帳號共用
});

test('小孩帳號登入時紅綠對象是自己，不受 manageAcc 影響', () => {
  store.setManageAcc('k1');
  store.setCurrentAccount('k2');
  assert.equal(store.isKid(), true);
  assert.equal(store.activeAccId, 'k2');
  assert.equal(store.getCard(store.words.find((w) => w.ch === '貓')).mark, 'green');
});
