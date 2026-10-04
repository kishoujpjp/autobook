// 搜尋只建立顯示索引，不轉換字表鍵、不修改既有發音或學習紀錄。
import { t2s } from './zhconv.js';
import { syllableOf } from './readings.js';
import { searchReadings } from './search-readings.js';

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

// 多個中文字、分隔音節與混合輸入取聯集。數字聲調也可直接分隔音節。
function tokensFor(query) {
  return (query.normalize('NFC').match(/\p{Script=Han}|[\p{Script=Latin}\p{M}:]+[0-5]?/giu) || [])
    .map((raw) => /\p{Script=Han}/u.test(raw) ? { han: raw } : normalizePinyin(raw))
    .filter(Boolean);
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
        if (!token.tone && reading.text.startsWith(token.text)) rank = 1;
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
