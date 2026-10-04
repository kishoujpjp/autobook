import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseStoryReading, setStoryReading, readingAt, clearStoryReading, readingChoices, readingSyllables } from '../js/story-pronunciation.js';
import { prepareStoredStory } from '../js/text-policy.js';

test('指定音節接受聲調、輕聲與 ü；拒絕無音檔音節及路徑', () => {
  for (const value of ['zhao2', 'zháo', 'ZHÁO'.normalize('NFD')]) assert.equal(parseStoryReading(value), 'zhao2');
  for (const value of ['zhe', 'zhe5', 'zhe0']) assert.equal(parseStoryReading(value), 'zhe5');
  for (const value of ['lü4', 'lv4', 'lu:4']) assert.equal(parseStoryReading(value), 'luu4');
  for (const value of ['../../zhao2', 'zhao2 zhe5', 'fake9', 'sleep', '', '著']) assert.equal(parseStoryReading(value), null);
});

test('同篇相同字的兩個位置使用不同讀音，備份往返及恢復只影響一處', () => {
  const story = { text: '看著月亮，睡著了。', lang: 'zh-Hant', polys: [{ char: '著', word: '睡著' }] };
  assert(setStoryReading(story, 1, 'zhe5'));
  assert(setStoryReading(story, 6, 'zhao2'));
  const restored = JSON.parse(JSON.stringify(story));
  assert.equal(readingAt(restored, 1), 'zhe5');
  assert.equal(readingAt(restored, 6), 'zhao2');
  clearStoryReading(restored, 1);
  assert.equal(readingAt(restored, 1), null);
  assert.equal(readingAt(restored, 6), 'zhao2');
  assert.deepEqual(story.polys, [{ char: '著', word: '睡著' }]);
});

test('Unicode 字索引、非法位置、原字不符及無效備份均安全', () => {
  const story = { text: '🌙看著。' };
  assert(setStoryReading(story, 2, 'zhe5'));
  assert.equal(readingAt(story, 2), 'zhe5');
  for (const index of [-1, 1.5, 0, 3, 20]) assert.equal(setStoryReading(story, index, 'zhe5'), false);
  story.text = '🌙看月。';
  assert.equal(readingAt(story, 2), null);
  story.readings[2] = { char: '月', syllable: '../../secret' };
  assert.equal(readingAt(story, 2), null);
});

test('內文轉換清除舊位置讀音，純標題修改與未改內文保留', () => {
  const story = { title: '故事', text: '睡著了。', lang: 'zh-Hant' };
  setStoryReading(story, 1, 'zhao2');
  assert.equal(readingAt(prepareStoredStory(story), 1), 'zhao2');
  const changed = prepareStoredStory({ ...story, text: '看着月亮。', lang: 'zh-Hans' });
  assert.equal(changed.readings, undefined);
  const titleOnly = prepareStoredStory({ ...story, title: '头发', lang: 'zh-Hans' });
  assert.equal(readingAt(titleOnly, 1), 'zhao2');
});

test('所有可選讀音都有實體錄音；著的選項包含 zhao2 和輕聲', () => {
  assert(readingChoices('著').includes('zhao2'));
  assert(readingChoices('著').includes('zhe5'));
  for (const syl of readingSyllables()) assert(existsSync(new URL(`../syl/${syl}.mp3`, import.meta.url)), syl);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const path of ['story-pronunciation.js', 'story-pronunciation-ui.js', 'word-filter.js']) assert(sw.includes(`'./js/${path}'`));
  for (const syl of ['zhao2', 'zhe5']) assert(sw.includes(`'./syl/${syl}.mp3'`));
});
