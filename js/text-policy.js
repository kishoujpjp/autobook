// 故事入庫、舊故事修復與字表遷移。純函式，App 與 Worker 共用，無瀏覽器相依。
import OpenCC from './vendor/opencc.js';
import { legacyS2T, toStoredTraditional } from './zhconv.js';

export const TEXT_POLICY_VERSION = 1;
const HAN_RE = /\p{Script=Han}/u;

// 只列明確可還原的詞；不做「後→后／幹→干／裏→里」等全面替換。
const ORIGINAL_PHRASES = [
  '皇太后', '皇后', '太后', '后羿', '公里', '千里', '萬里', '海里', '里程', '村里', '故里',
  '批准', '若干', '干涉', '干擾', '干預', '干燥', '游泳', '游擊', '上游', '下游', '中游',
  '征服', '出征', '遠征', '長征', '親征', '岳父', '岳母', '濃郁', '風采', '神采', '小丑', '占卜',
];
const REPAIR_PAIRS = ORIGINAL_PHRASES.map((word) => [legacyS2T(word), word]).filter(([a, b]) => a !== b);
// 舊簡體輸入逐字轉出的錯詞（前一組是繁體原文遭誤轉）。
REPAIR_PAIRS.push(['幹淨', '乾淨'], ['幹杯', '乾杯'], ['頭發', '頭髮'], ['籤訂', '簽訂'],
  ['籤署', '簽署'], ['臺風', '颱風'], ['分鍾', '分鐘']);
const repairPhrases = OpenCC.CustomConverter(REPAIR_PAIRS);
let repairVariants;

export function repairLegacyText(text) {
  // 只正規化繁體異體字，絕不把完整繁體文字再送進 s2tw。
  repairVariants ||= OpenCC.Converter({ from: 't', to: 'tw' });
  return repairVariants(repairPhrases(text));
}

export function newHanChars(text, known) {
  return [...new Set([...text].filter((ch) => HAN_RE.test(ch) && !known.has(ch)))];
}

/** 入庫後 lang 表示儲存字形，與介面語系無關。 */
export function prepareStoredStory(story, known = new Set(), { legacy = false } = {}) {
  if (legacy && story.textPolicy === TEXT_POLICY_VERSION) return story;
  const sourceLang = story.lang || 'auto';
  const normalize = (text) => {
    const converted = toStoredTraditional(text, sourceLang);
    return legacy ? repairLegacyText(converted) : converted;
  };
  const title = normalize(story.title || '');
  const text = normalize(story.text || '');
  const changed = title !== (story.title || '') || text !== (story.text || '');
  const next = { ...story, title, text, lang: 'zh-Hant', textPolicy: TEXT_POLICY_VERSION,
    newChars: newHanChars(text, known) };
  if (legacy && (changed || sourceLang === 'zh-Hans')) {
    // 完整保留改動前的文字、索引、標註與多音字；備份匯出會一起帶走。
    next.textBackup = story.textBackup || JSON.parse(JSON.stringify(story));
  }
  if (changed) {
    if (text !== story.text) delete next.readings;
    delete next.polys; // 舊詞組的音訊仍留在 IDB，新詞組使用新的快取 key。
    if ([...text].length !== [...(story.text || '')].length || [...title].length !== [...(story.title || '')].length) {
      next.hlBy = {};
      next.marksBy = {};
      delete next.highlights;
    }
  }
  return next;
}

/** 舊字表改用繁體鍵；重合項合併紀錄，原始完整字表由資料層先備份。 */
export function prepareStoredWords(records) {
  const byChar = new Map();
  for (const record of records) {
    const ch = toStoredTraditional(record.ch);
    const sourceChars = Array.isArray(record.sourceChars) ? record.sourceChars : [];
    const aliases = [...new Set([...sourceChars, ...(ch === record.ch ? [] : [record.ch])])];
    const word = { ...record, ch, cards: { ...record.cards }, ...(aliases.length ? { sourceChars: aliases } : {}) };
    const prev = byChar.get(ch);
    if (!prev) { byChar.set(ch, word); continue; }
    prev.sourceChars = [...new Set([...(prev.sourceChars || []), ...aliases])];
    prev.addedAt = Math.min(prev.addedAt || 0, word.addedAt || 0);
    prev.usedCount = Math.max(prev.usedCount || 0, word.usedCount || 0);
    prev.readCount = Math.max(prev.readCount || 0, word.readCount || 0);
    prev.archived = !!(prev.archived || word.archived);
    for (const [key, card] of Object.entries(word.cards)) {
      const old = prev.cards[key];
      if (!old) { prev.cards[key] = card; continue; }
      if (!card || typeof card !== 'object') continue;
      const latest = (card.markedAt || 0) > (old.markedAt || 0) ? card : old;
      prev.cards[key] = { ...old, ...latest,
        flashCount: Math.max(old.flashCount || 0, card.flashCount || 0),
        ok: Math.max(old.ok || 0, card.ok || 0), ng: Math.max(old.ng || 0, card.ng || 0) };
    }
  }
  return [...byChar.values()];
}
