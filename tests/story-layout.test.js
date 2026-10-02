import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyLines } from '../js/story-layout.js';

const isHan = (ch) => /\p{Script=Han}/u.test(ch);
const groups = (text) => storyLines(text, isHan).map((line) => line.map((group) => group.map(({ ch }) => ch).join('')));

test('開引號與括號跟後字，句尾標點與閉引號跟前字', () => {
  assert.deepEqual(groups('說：「我吃！」好（甜）。'), [['說：', '「我', '吃！」', '好', '（甜）。']]);
  assert.deepEqual(groups('“「好！」”'), [['“「好！」”']]);
  assert.deepEqual(groups('說："好！"'), [['說：', '"好！"']]);
});

test('空白段落保留完整行，點讀與標註索引不受分組影響', () => {
  const text = '甲\n\n「乙！」\r\n丙';
  assert.deepEqual(groups(text), [['甲'], [], ['「乙！」'], ['丙']]);
  assert.deepEqual(storyLines(text, isHan).flat(2).filter((n) => n.han).map(({ ch, i }) => [ch, i]), [['甲', 0], ['乙', 4], ['丙', 9]]);
});

test('只有標點、孤立開引號、Unicode 字元均不遺失', () => {
  for (const text of ['「', '！？', '甲「\n乙', '🐷「乙！」', '', '甲\n']) {
    assert.equal(storyLines(text, isHan).map((line) => line.flat().map((n) => n.ch).join('')).join('\n'), text);
  }
});
