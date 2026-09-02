import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './stubs.js';

// 先塞一些「壞資料」，驗證 load() 的防護：字表存成 "null"、題庫存成物件、故事有一筆缺 text
seed('autobook.words', null);
localStorage.setItem('autobook.phrases', '{"x":1}');
seed('autobook.stories', [{ id: 's1', title: 'ok', text: '小貓' }, { id: 's2' }, 'junk']);

const store = await import('../js/store.js');

test('壞資料回退成預設值，且原始內容留在 <key>.bad', () => {
  assert.deepEqual(store.words, []);
  assert.deepEqual(store.phrases, []);
  assert.equal(localStorage.getItem('autobook.words.bad'), 'null');
  assert.equal(localStorage.getItem('autobook.phrases.bad'), '{"x":1}');
});

test('故事清單逐筆驗證：缺 text 與非物件的被丟掉', () => {
  assert.equal(store.stories.length, 1);
  assert.equal(store.stories[0].id, 's1');
});

test('預設帳號是家長，isKid 為 false', () => {
  assert.equal(store.accounts.length, 1);
  assert.equal(store.isKid(), false);
});

test('addWords：跨繁簡一對一等價字略過，SELF_HANT 字對各自保留', () => {
  const r1 = store.addWords('貓狗');
  assert.equal(r1.added, 2);
  const r2 = store.addWords('猫'); // 貓⇄猫 一對一等價 → 略過
  assert.equal(r2.added, 0);
  assert.equal(r2.dup, 1);
  const r3 = store.addWords('游遊'); // 兩個都是合法繁體字 → 各自保留
  assert.equal(r3.added, 2);
  assert.equal(store.addWords('abc123').added, 0); // 非漢字不收
});

test('shelfVictim：未滿回 null，滿了回最舊（陣列最後）一本', async () => {
  assert.equal(store.shelfVictim(), null);
  for (let i = 0; i < store.MAX_STORIES; i++) {
    await store.addStory({ id: `t${i}`, title: `t${i}`, text: '一', createdAt: i });
  }
  assert.equal(store.stories.length, store.MAX_STORIES);
  const v = store.shelfVictim();
  assert.ok(v);
  assert.equal(v.id, store.stories[store.stories.length - 1].id);
});
