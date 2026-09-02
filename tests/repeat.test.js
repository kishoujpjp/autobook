import { test } from 'node:test';
import assert from 'node:assert/strict';
import './stubs.js';

const { scoreAttempt } = await import('../js/repeat.js');

test('scoreAttempt：唸對拿高分，唸錯拿低分，沒唸只剩鼓勵底分；回傳 {wordScores, overall}', () => {
  const good = scoreAttempt('red apple', [{ text: 'red apple', conf: 0.95 }]);
  const bad = scoreAttempt('red apple', [{ text: 'blue banana', conf: 0.95 }]);
  const none = scoreAttempt('red apple', []);
  assert.equal(good.wordScores.length, 2);
  assert.ok(good.overall >= 80, `good=${good.overall}`);
  assert.ok(bad.overall < good.overall, `bad=${bad.overall} good=${good.overall}`);
  assert.ok(none.overall <= 20 && none.overall < good.overall, `none=${none.overall}`); // 沒唸＝每個字都是最低檔的鼓勵分
  assert.ok(good.overall <= 100 && bad.overall >= 0);
});
