import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCharacters, normalizePinyin } from '../js/word-search.js';
import { syllableOf } from '../js/readings.js';
import { readFileSync, existsSync } from 'node:fs';

const pool = [...'燈等登鄧發髮行樂長女綠嗎馬貓狗'];
const search = (query, selected) => filterCharacters(pool, query, selected);

test('繁簡搜尋保留原字鍵，簡體合併字形仍分開', () => {
  assert.deepEqual(search('灯').matches, ['燈']);
  assert.deepEqual(search('燈').matches, ['燈']);
  assert.deepEqual(search('发').matches, ['發', '髮']);
  assert.deepEqual(search('發').matches, ['發']);
  assert.deepEqual(search('髮').matches, ['髮']);
});
test('無聲調、數字、聲調符號、大小寫及分解 Unicode', () => {
  assert.deepEqual(search('deng').matches, [...'燈等登鄧']);
  for (const q of ['deng1', 'DĒNG', 'dēng'.normalize('NFD')]) {
    assert.deepEqual(search(q).matches, ['燈', '登']);
  }
  assert.deepEqual(search('deng3').matches, ['等']);
  assert.deepEqual(search('deng4').matches, ['鄧']);
  assert.deepEqual(search('de1').matches, []);
});
test('多音字使用離線索引；聲音預設不變', () => {
  const defaults = [...'行樂長'].map(syllableOf);
  for (const q of ['xing2', 'hang2']) assert(search(q).matches.includes('行'));
  for (const q of ['le4', 'yue4']) assert(search(q).matches.includes('樂'));
  for (const q of ['chang2', 'zhang3']) assert(search(q).matches.includes('長'));
  assert.deepEqual([...'行樂長'].map(syllableOf), defaults);
});
test('ü 支援 v / u: 與聲調，輕聲 0 與 5 等價', () => {
  for (const q of ['nü3', 'nv3', 'nu:3', 'nǚ']) assert(search(q).matches.includes('女'));
  for (const q of ['lü4', 'lv4', 'lu:4', 'lǜ']) assert(search(q).matches.includes('綠'));
  assert.deepEqual(normalizePinyin('ma0'), normalizePinyin('ma5'));
  assert(search('ma5').matches.includes('嗎'));
  assert(search('ma0').matches.includes('嗎'));
});
test('中文字及分隔拼音取聯集，混合搜尋不重複', () => {
  for (const q of ['灯狗', 'deng1 gou3', 'deng1,gou3', "deng1'gou3", '灯 gou3']) {
    const matches = search(q).matches;
    assert(matches.includes('燈'));
    assert(matches.includes('狗'));
  }
  assert.deepEqual(search('燈灯deng1').matches, ['燈', '登']);
});
test('連續漢字與連續拼音一次篩出多個字，同音字一併顯示', () => {
  const chars = [...'大打搭天田我不貓狗'];
  assert.deepEqual(filterCharacters(chars, '大天我不').matches, [...'大天我不']);
  assert.deepEqual(filterCharacters(chars, 'datianwobu').matches, [...'大打搭天田我不']);
  assert.deepEqual(filterCharacters(chars, 'da tian wo bu').matches, [...'大打搭天田我不']);
});
test('全形與半形空白、拼音漢字混合均能切分，不重複結果', () => {
  const chars = [...'大天我不田打貓狗'];
  for (const query of ['da tian wo bu', 'da　tian　wo　bu', '大tian我bu', 'da天wo不', '大tianwo不', '大 da tian我bu不']) {
    const matches = filterCharacters(chars, query).matches;
    for (const ch of '大天我不') assert(matches.includes(ch), `${query} 找到 ${ch}`);
    assert.equal(matches.length, new Set(matches).size);
    assert(!matches.includes('貓'));
  }
});
test('連續拼音合併所有完整切法，空白可明確區分音節', () => {
  const chars = [...'先西安貓'];
  assert.deepEqual(filterCharacters(chars, 'xian').matches, [...'先西安']);
  assert.deepEqual(filterCharacters(chars, 'xi an').matches, [...'西安']);
  assert.deepEqual(filterCharacters(chars, 'xi　an').matches, [...'西安']);
  assert.deepEqual(filterCharacters(chars, 'xian1').matches, ['先']);
});
test('連續輸入聲調及 ü 仍保留音節的聲調限制', () => {
  const chars = [...'大打天田我不女綠'];
  assert.deepEqual(filterCharacters(chars, 'da4tian1wo3bu4').matches, [...'大天我不']);
  assert.deepEqual(filterCharacters(chars, 'dàtiānwǒbù').matches, [...'大天我不']);
  for (const query of ['nǚlǜ', 'nv3lv4', 'nu:3lu:4']) {
    assert.deepEqual(filterCharacters(chars, query).matches, [...'女綠']);
  }
});
test('輸入到一半可篩選最後一段前綴，無法完成的尾段不留下零碎匹配', () => {
  const chars = [...'大天我王貓'];
  assert.deepEqual(filterCharacters(chars, 'datianw').matches, [...'大天我王']);
  assert.deepEqual(filterCharacters(chars, 'datianxyz').matches, []);
  assert.deepEqual(filterCharacters(chars, 'datianxyz 貓').matches, ['貓']);
  // 音節字典不依候選字建立：即使沒有「天／我」，仍能辨識整串查詢中的「大」。
  assert.deepEqual(filterCharacters(['大'], 'datianwo').matches, ['大']);
});
test('多音節搜尋保留已選字與分類交集，長串歧義不列舉所有組合', () => {
  const chars = [...'大天我不貓'];
  const selected = new Set(['貓']);
  assert.deepEqual(filterCharacters(chars, 'datianwobu', selected, [...'大天']), {
    matches: [...'大天'], retained: ['貓'], visible: [...'大天貓'],
  });
  assert.deepEqual([...selected], ['貓']);
  assert.deepEqual(filterCharacters([...'先西安'], 'xian'.repeat(1000)).matches, [...'先西安']);
  assert.deepEqual(filterCharacters([...'先西安'], 'xian'.repeat(1000) + 'xyz').matches, []);
});
test('精確音節先於前綴，同組維持原排序', () => {
  assert.deepEqual(filterCharacters([...'媽馬麻'], 'ma').matches, [...'媽馬麻']);
  assert.deepEqual(filterCharacters([...'狗高哥'], 'g').matches, [...'狗高哥']);
  assert.deepEqual(filterCharacters([...'高狗哥'], 'gou').matches, ['狗']);
  assert.deepEqual(filterCharacters([...'好哈行'], 'ha').matches, ['哈', '好', '行']);
});
test('已選字留在同一格区；取消、清除、排序不破壞選取', () => {
  const selected = new Set(['貓', '髮']);
  const result = search('灯', selected);
  assert.deepEqual(result, { matches: ['燈'], retained: ['髮', '貓'], visible: ['燈', '髮', '貓'] });
  selected.delete('髮');
  assert.deepEqual(search('灯', selected).visible, ['燈', '貓']);
  assert.deepEqual(search('', selected).visible, pool);
  assert.deepEqual(filterCharacters([...pool].reverse(), '灯', selected).retained, ['貓']);
  assert.deepEqual([...selected], ['貓']);
});
test('沒有結果仍保留已選字；无效輸入不變成全字表', () => {
  assert.deepEqual(search('xyz', new Set(['貓'])).visible, ['貓']);
  assert.deepEqual(search('123!').matches, []);
  assert.deepEqual(search('  ').matches, pool);
});
test('搜尋及離線多音資料納入 PWA 快取與原生建置資源', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const path of ['word-search.js', 'word-search-ui.js', 'search-readings.js']) {
    assert(sw.includes(`'./js/${path}'`));
    assert(existsSync(new URL(`../js/${path}`, import.meta.url)));
  }
});
