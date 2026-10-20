// 搜尋只建立顯示索引，不轉換字表鍵、不修改既有發音或學習紀錄。
import { t2s } from './zhconv.js';
import { syllableOf, allSyllables } from './readings.js';
import { searchReadings, searchSyllables } from './search-readings.js';

const index = new Map();
const tones = new Map([['\u0304', '1'], ['\u0301', '2'], ['\u030c', '3'], ['\u0300', '4']]);

export function normalizePinyin(value) {
  let text = '', tone = '';
  for (const ch of value.toLowerCase().replace(/u:/g, 'ü').normalize('NFD')) {
    if (tones.has(ch)) tone = tones.get(ch);
    else if (ch === '\u0308' && text.endsWith('u')) text = text.slice(0, -1) + 'v';
    else if (!/\p{M}/u.test(ch)) text += ch;
  }
  const numbered = text.match(/([0-5])$/);
  if (numbered) { tone = numbered[1]; text = text.slice(0, -1); }
  if (tone === '0') tone = '5';
  return /^[a-z]+$/.test(text) ? { text, tone } : null;
}

function entryFor(ch) {
  if (!index.has(ch)) {
    const audio = syllableOf(ch)?.replace(/uu/g, 'v');
    const readings = new Set([...searchReadings(ch), ...(audio ? [audio] : [])]);
    index.set(ch, { aliases: new Set([ch, t2s(ch)]), readings: [...readings].map(normalizePinyin).filter(Boolean) });
  }
  return index.get(ch);
}

let vocabulary;
function pinyinVocabulary() {
  if (!vocabulary) {
    const syllables = new Set([...searchSyllables(), ...allSyllables()]
      .map((raw) => normalizePinyin(raw.replace(/uu/g, 'v'))?.text).filter(Boolean));
    const prefixes = new Set();
    for (const text of syllables) {
      for (let n = 1; n < text.length; n++) prefixes.add(text.slice(0, n));
    }
    vocabulary = { syllables, prefixes, maxLength: Math.max(...[...syllables].map((s) => s.length)) + 1 };
  }
  return vocabulary;
}

// 只收能走完整段的切分；先算前後可達位置，再合併候選，不列舉指數量的切法。
function splitPinyin(raw, separated) {
  const text = raw.toLowerCase().replace(/u:/g, 'ü').normalize('NFC');
  const { syllables, prefixes, maxLength } = pinyinVocabulary();
  const whole = normalizePinyin(text);
  // 空白／漢字已劃定完整音節，或單音節已指定聲調時，不拆壞這個音節。
  const accentCount = (text.normalize('NFD').match(/[\u0304\u0301\u030c\u0300]/g) || []).length;
  if (whole && syllables.has(whole.text) && accentCount <= 1 && (separated || whole.tone)) {
    return [{ ...whole, exact: true }];
  }
  const edges = Array.from({ length: text.length + 1 }, () => []);
  const reachable = new Uint8Array(text.length + 1);
  reachable[0] = 1;
  for (let start = 0; start < text.length; start++) {
    if (!reachable[start]) continue;
    for (let end = start + 1; end <= Math.min(text.length, start + maxLength); end++) {
      const part = text.slice(start, end);
      if ((part.normalize('NFD').match(/[\u0304\u0301\u030c\u0300]/g) || []).length > 1) continue;
      const token = normalizePinyin(part);
      if (token && syllables.has(token.text)) {
        edges[start].push({ end, token: { ...token, exact: true } });
        reachable[end] = 1;
      }
    }
  }
  // 完整音節優先；還沒輸完時，僅最後一段可用拼音前綴。
  if (!reachable[text.length]) {
    for (let start = Math.max(0, text.length - maxLength); start < text.length; start++) {
      if (!reachable[start]) continue;
      const token = normalizePinyin(text.slice(start));
      if (token && !token.tone && prefixes.has(token.text)) edges[start].push({ end: text.length, token });
    }
  }
  const complete = new Uint8Array(text.length + 1);
  complete[text.length] = 1;
  for (let start = text.length - 1; start >= 0; start--) {
    complete[start] = edges[start].some(({ end }) => complete[end]);
  }
  return edges.flatMap((list, start) => reachable[start]
    ? list.filter(({ end }) => complete[end]).map(({ token }) => token) : []);
}

// 漢字、空白／標點分隔及連續拼音取聯集；數字聲調自然分隔音節。
function tokensFor(query) {
  const parts = query.normalize('NFC').match(/\p{Script=Han}|[\p{Script=Latin}\p{M}:]+[0-5]?/giu) || [];
  const tokens = parts.flatMap((raw) => {
    if (/\p{Script=Han}/u.test(raw)) return [{ han: raw }];
    const split = splitPinyin(raw, parts.length > 1);
    const single = parts.length === 1 ? normalizePinyin(raw) : null;
    return [...split, ...(single ? [single] : [])];
  });
  return [...new Map(tokens.map((token) => [JSON.stringify(token), token])).values()];
}

/** 0 = 字形或完整音節，1 = 拼音前綴，Infinity = 未符合。 */
function matchRank(ch, tokens) {
  const entry = entryFor(ch);
  let rank = Infinity;
  for (const token of tokens) {
    if (token.han) {
      if (entry.aliases.has(token.han)) return 0;
    } else {
      for (const reading of entry.readings) {
        if (token.tone && token.tone !== reading.tone) continue;
        if (reading.text === token.text) return 0;
        if (!token.exact && !token.tone && reading.text.startsWith(token.text)) rank = 1;
      }
    }
  }
  return rank;
}

/** pool 保留原排序；完整音節優先。selected 非符合項仍留在同一格區。 */
export function filterCharacters(pool, query, selected = new Set(), candidates = pool) {
  const tokens = tokensFor(query);
  const ranked = candidates.map((ch) => ({ ch, rank: query.trim() ? matchRank(ch, tokens) : 0 }));
  const matches = ranked.filter((item) => Number.isFinite(item.rank))
    .sort((a, b) => a.rank - b.rank).map((item) => item.ch);
  const matched = new Set(matches);
  const retained = pool.filter((ch) => selected.has(ch) && !matched.has(ch));
  return { matches, retained, visible: [...matches, ...retained] };
}
