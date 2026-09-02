import { test } from 'node:test';
import assert from 'node:assert/strict';
import './stubs.js';

const { pickWrong } = await import('../js/game.js');

test('pickWrong：永遠不回傳題目本身；只剩一個字回 null（不會無限迴圈）', () => {
  for (let i = 0; i < 200; i++) {
    const w = pickWrong('一', ['一', '二', '三']);
    assert.notEqual(w, '一');
    assert.ok(['二', '三'].includes(w));
  }
  assert.equal(pickWrong('一', ['一']), null);
  assert.equal(pickWrong('一', []), null);
});
