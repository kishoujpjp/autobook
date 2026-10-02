import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareStoredStory, prepareStoredWords, repairLegacyText } from '../js/text-policy.js';

test('舊錯詞只依明確詞組修復，不全面替換後／幹／裏', () => {
  assert.equal(repairLegacyText('皇後起牀喫飯。遊泳一公裏，嶽父幹涉。'), '皇后起床吃飯。游泳一公里，岳父干涉。');
  assert.equal(repairLegacyText('皇後的頭發幹淨，臺風過後去籤訂。'), '皇后的頭髮乾淨，颱風過後去簽訂。');
  assert.equal(repairLegacyText('後天幹活，裡面有旅遊指南。'), '後天幹活，裡面有旅遊指南。');
});

test('舊故事保留完整原文備份與同長度索引，修復後不再重複轉換', () => {
  const story = { id: 'old', title: '喫飯', text: '皇後起牀喫飯。', lang: 'zh-Hant',
    hlBy: { kid: [2, 4] }, marksBy: { kid: { 2: 'green' } }, readsBy: { kid: 3 },
    polys: [{ char: '後', word: '皇後' }], media: [{ id: 'photo', kind: 'image' }] };
  const copy = structuredClone(story);
  const fixed = prepareStoredStory(story, new Set('皇后起床吃飯'), { legacy: true });
  assert.equal(fixed.text, '皇后起床吃飯。');
  assert.equal(fixed.title, '吃飯');
  assert.deepEqual(fixed.textBackup, copy);
  assert.deepEqual(story, copy);
  assert.deepEqual(fixed.hlBy, story.hlBy);
  assert.deepEqual(fixed.marksBy, story.marksBy);
  assert.deepEqual(fixed.readsBy, story.readsBy);
  assert.deepEqual(fixed.media, story.media);
  assert.deepEqual(fixed.newChars, []);
  assert.equal(fixed.polys, undefined);
  assert.strictEqual(prepareStoredStory(fixed, new Set(), { legacy: true }), fixed);
});

test('簡體舊書轉繁體，新繁體資料與姓氏原文保持不變', () => {
  const fixed = prepareStoredStory({ id: 'oldHans', title: '头发', text: '皇后头发干净。', lang: 'zh-Hans' }, new Set(), { legacy: true });
  assert.equal(fixed.text, '皇后頭髮乾淨。');
  assert.equal(fixed.lang, 'zh-Hant');
  assert.equal(fixed.textBackup.lang, 'zh-Hans');
  const input = { title: '于先生', text: '于先生和云先生吃飯，游泳一公里。苧麻。', lang: 'zh-Hant' };
  const stored = prepareStoredStory(input);
  assert.equal(stored.title, input.title);
  assert.equal(stored.text, input.text);
  assert.equal(stored.textBackup, undefined);
  assert.strictEqual(prepareStoredStory(stored, new Set(), { legacy: true }), stored);
});

test('字表簡體鍵轉繁體，重合項保留最新標色／各帳號紀錄，不混淆發髮', () => {
  const records = [
    { ch: '猫', addedAt: 1, cards: { 'kid|zh-Hant': { mark: 'red', markedAt: 10, flashCount: 2, ok: 4 } } },
    { ch: '貓', addedAt: 2, cards: { 'kid|zh-Hant': { mark: 'green', markedAt: 20, flashCount: 1, ok: 1 }, other: { mark: 'red' } } },
    { ch: '發', cards: {} }, { ch: '髮', cards: {} }, { ch: '游', cards: {} }, { ch: '遊', cards: {} },
  ];
  const copy = structuredClone(records);
  const words = prepareStoredWords(records);
  assert.deepEqual(records, copy);
  assert.deepEqual(words.map((w) => w.ch), ['貓', '發', '髮', '游', '遊']);
  assert.equal(words[0].cards['kid|zh-Hant'].mark, 'green');
  assert.equal(words[0].cards['kid|zh-Hant'].flashCount, 2);
  assert.equal(words[0].cards['kid|zh-Hant'].ok, 4);
  assert.ok(words[0].cards.other);
  assert.deepEqual(words[0].sourceChars, ['猫']);
  assert.deepEqual(prepareStoredWords(words), words);
});
