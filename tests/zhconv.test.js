import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORDS } from '../js/wordbank.js';
import { convertTo, s2t, t2s, toStoredTraditional, hasSimplifiedOnly, audioKeysFor } from '../js/zhconv.js';

test('內建 8000 詞：繁體入庫／顯示保留原文，簡體顯示保持字塊索引長度', () => {
  for (const { t } of WORDS) {
    assert.equal(toStoredTraditional(t, 'zh-Hant'), t, t);
    assert.equal(toStoredTraditional(t), t, t);
    assert.equal(convertTo(t, 'zh-Hant'), t, t);
    assert.equal([...convertTo(t, 'zh-Hans')].length, [...t].length, t);
  }
});

test('簡體詞組依語境轉成臺灣繁體，不產生舊體字或改錯詞義', () => {
  for (const [from, to] of [
    ['吃饭，起床，一群人，山峰，嘴唇。', '吃飯，起床，一群人，山峰，嘴唇。'],
    ['为了众人启动反对虚伪。', '為了眾人啟動反對虛偽。'],
    ['皇后游泳一公里，岳父干涉，小丑占卜。', '皇后游泳一公里，岳父干涉，小丑占卜。'],
    ['干净、干杯、干活、干涉、若干、批准。', '乾淨、乾杯、幹活、干涉、若干、批准。'],
    ['头发、发现、签订、签署、分钟、台风、关系、面包。', '頭髮、發現、簽訂、簽署、分鐘、颱風、關係、麵包。'],
  ]) assert.equal(toStoredTraditional(from, 'zh-Hans'), to);
});

test('自動判斷只看簡體專有字，不把皇后／公里／于先生視為簡體', () => {
  for (const text of ['皇后', '公里', '于先生', '云先生', '苧麻', '游泳', '干涉']) {
    assert.equal(hasSimplifiedOnly(text), false, text);
    assert.equal(toStoredTraditional(text), text);
  }
  assert.equal(hasSimplifiedOnly('小猫头发'), true);
  assert.equal(toStoredTraditional('小猫头发'), '小貓頭髮');
  assert.equal(toStoredTraditional('苎麻', 'zh-Hans'), '苧麻');
  assert.equal(toStoredTraditional('苧麻', 'zh-Hant'), '苧麻');
  assert.equal(convertTo('苧麻', 'zh-Hant'), '苧麻');
  assert.equal(toStoredTraditional('面包'), '面包');
  assert.equal(toStoredTraditional('面包', 'zh-Hans'), '麵包');
  assert.equal(toStoredTraditional('工厂', 'zh-Hans'), '工廠');
});

test('繁簡切換不改底層且可分辨發／髮；共用顯示字不共用音訊', () => {
  const stored = '皇后吃飯，頭髮乾淨，發現山峰。';
  const simp = convertTo(stored, 'zh-Hans');
  assert.equal(simp, '皇后吃饭，头发干净，发现山峰。');
  assert.equal(convertTo(stored, 'zh-Hant'), stored);
  assert.deepEqual(audioKeysFor('髮'), ['髮']);
  assert.deepEqual(audioKeysFor('發'), ['發']);
  assert.deepEqual(audioKeysFor('貓'), ['貓', '猫']);
  assert.equal(s2t('头发'), '頭髮');
  assert.equal(t2s('頭髮'), '头发');
});

test('PWA 離線快取涵蓋轉換實作與詞典，版本與原生殼一致', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const file of ['js/vendor/opencc.js', 'js/text-policy.js', 'js/zhconv.js']) assert.ok(sw.includes(`'./${file}'`));
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(sw.includes(`autobook-v${version}`));
  const ios = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  assert.equal([...ios.matchAll(/MARKETING_VERSION = ([\d.]+)/g)].filter((m) => m[1] === version).length, 2);
});
