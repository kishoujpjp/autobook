import { allSyllables, syllableOf } from './readings.js';
import { searchReadings } from './search-readings.js';
import { normalizePinyin } from './word-search.js';

// 補充錄音來源與授權見 js/vendor/pronunciation-sources.md。
const available = new Set([...allSyllables(), 'zhao2', 'zhe5']);
export function readingSyllables() { return [...available]; }

/** 只接受 App 已附錄音的單一拼音音節，避免存錯讀音或任意檔案路徑。 */
export function parseStoryReading(value) {
  const parsed = normalizePinyin(String(value).trim());
  if (!parsed) return null;
  const tone = parsed.tone || '5';
  const forms = [parsed.text.replace(/v/g, 'uu'), parsed.text.replace(/v/g, 'u')];
  return forms.map((form) => form + tone).find((syl) => available.has(syl)) || null;
}

export function readingChoices(ch) {
  return [...new Set([syllableOf(ch), ...searchReadings(ch).map(parseStoryReading)].filter(Boolean))];
}

/** 指定讀音以原文 Unicode 字索引存放；簡體顯示不改位置或原字。 */
export function readingAt(story, index) {
  if (!Number.isInteger(index) || index < 0) return null;
  const entry = story.readings?.[index];
  if (!entry || entry.char !== [...story.text][index]) return null;
  return available.has(entry.syllable) ? entry.syllable : null;
}

export function setStoryReading(story, index, value) {
  const char = [...story.text][index];
  const syllable = parseStoryReading(value);
  if (!Number.isInteger(index) || index < 0 || !/\p{Script=Han}/u.test(char || '') || !syllable) return false;
  story.readings = { ...story.readings, [index]: { char, syllable } };
  return true;
}

export function clearStoryReading(story, index) {
  if (story.readings) delete story.readings[index];
}
