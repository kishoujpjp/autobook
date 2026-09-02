import { test } from 'node:test';
import assert from 'node:assert/strict';
import './stubs.js';

const { findNewChars, joinB64, errHintKey } = await import('../js/gemini.js');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('findNewChars：只算不在字表的漢字，去重、保留出現順序', () => {
  const known = new Set(['小', '貓']);
  assert.deepEqual(findNewChars('小貓看星星，小貓笑。', known), ['看', '星', '笑']);
});

test('joinB64：各段獨立編碼可正確合併', () => {
  const out = joinB64([b64('hello '), b64('world')]);
  assert.equal(Buffer.from(out).toString('utf8'), 'hello world');
});

test('joinB64：同一段 base64 被切在 4 的倍數處也正確', () => {
  const whole = b64('0123456789abcdef');
  const out = joinB64([whole.slice(0, 8), whole.slice(8)]);
  assert.equal(Buffer.from(out).toString('utf8'), '0123456789abcdef');
});

test('errHintKey：對應到白話對策', () => {
  assert.equal(errHintKey('HTTP 429：quota'), 'hint_429');
  assert.equal(errHintKey('網路錯誤：Load failed'), 'hint_network');
  assert.equal(errHintKey('BLOCKED：SAFETY'), 'hint_blocked');
  assert.equal(errHintKey('NO_AUDIO：x'), 'hint_nodata');
  assert.equal(errHintKey('whatever'), null);
});
