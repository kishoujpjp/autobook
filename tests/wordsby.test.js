import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './stubs.js';

// v1.27.0：每個小孩各自一份字表。舊版單一字表（autobook.words）第一次啟動要搬給第一個小孩帳號
seed('autobook.words', [{ ch: '貓', addedAt: 1, usedCount: 0, readCount: 0, archived: false, cards: {} }]);
seed('autobook.accounts', [
  { id: 'p1', name: '家長', role: 'parent', avatar: { kind: 'preset', preset: 'bear' } },
  { id: 'k1', name: '大寶', role: 'kid', avatar: { kind: 'preset', preset: 'cat' } },
  { id: 'k2', name: '二寶', role: 'kid', avatar: { kind: 'preset', preset: 'dog' } },
]);
seed('autobook.currentAccount', 'p1');

const store = await import('../js/store.js');

test('舊字表搬給第一個小孩；家長登入時作用中的字表就是那個小孩的', () => {
  assert.equal(store.activeAccId, 'k1');
  assert.deepEqual(store.words.map((w) => w.ch), ['貓']);
  assert.equal(store.wordCountOf('k2'), 0);
  assert.equal(store.cardKey(), `k1|${store.settings.lang}`);
});

test('切換管理對象後 words 換成另一個小孩的清單（live binding），各自獨立', () => {
  store.setManageAcc('k2');
  assert.equal(store.activeAccId, 'k2');
  assert.deepEqual(store.words, []);
  store.addWords('狗');
  assert.deepEqual(store.words.map((w) => w.ch), ['狗']);
  assert.equal(store.wordCountOf('k1'), 1);
  store.setManageAcc('k1');
  assert.deepEqual(store.words.map((w) => w.ch), ['貓']);
});

test('copyWords 只複製字不複製紅綠；removeWords 只動作用中的清單', () => {
  store.setMark('貓', 'red');
  const n = store.copyWords('k1', 'k2');
  assert.equal(n, 1);
  store.setManageAcc('k2');
  assert.deepEqual(store.words.map((w) => w.ch).sort(), ['狗', '貓']);
  assert.equal(store.getCard(store.words.find((w) => w.ch === '貓')).mark, null);
  store.removeWords(['貓']);
  assert.deepEqual(store.words.map((w) => w.ch), ['狗']);
  assert.equal(store.wordCountOf('k1'), 1);
});

test('小孩帳號登入時作用中的字表是自己的，不受 manageAcc 影響', () => {
  store.setManageAcc('k1');
  store.setCurrentAccount('k2');
  assert.equal(store.isKid(), true);
  assert.equal(store.activeAccId, 'k2');
  assert.deepEqual(store.words.map((w) => w.ch), ['狗']);
});
