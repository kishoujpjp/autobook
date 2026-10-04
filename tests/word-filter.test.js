import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWordFilter } from '../js/word-filter.js';
import { filterCharacters } from '../js/word-search.js';

test('四色篩選依目前小孩的紅綠和共用使用次數，入庫字仍可管理', () => {
  const word = { ch: '燈', usedCount: 0, archived: true };
  assert(matchesWordFilter(word, 'total', { mark: null }));
  assert(matchesWordFilter(word, 'learned', { mark: 'green' }));
  assert(!matchesWordFilter(word, 'learned', { mark: 'red' }));
  assert(matchesWordFilter(word, 'weak', { mark: 'red' }));
  assert(!matchesWordFilter(word, 'weak', { mark: null }));
  assert(matchesWordFilter(word, 'unused', { mark: 'green' }));
  word.usedCount = 1;
  assert(!matchesWordFilter(word, 'unused', { mark: 'green' }));
});

test('分類與拼音搜尋交集，完整選取仍保留於同一字格', () => {
  const pool = [...'燈貓狗'];
  const selected = new Set(['貓']);
  assert.deepEqual(filterCharacters(pool, 'deng1', selected, ['燈']), { matches: ['燈'], retained: ['貓'], visible: ['燈', '貓'] });
  assert.deepEqual(filterCharacters(pool, 'gou3', selected, ['燈']), { matches: [], retained: ['貓'], visible: ['貓'] });
  assert.deepEqual(filterCharacters(pool, '', selected, []), { matches: [], retained: ['貓'], visible: ['貓'] });
  assert.deepEqual([...selected], ['貓']);
});
