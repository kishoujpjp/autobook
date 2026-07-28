// 發音統一入口。優先序：
// 1) AI 語音快取（音質最自然，能存多少算多少）
// 2) 音節庫 syl/*.mp3（App 自帶靜態檔，臺灣讀音、離線、永不失敗；不受「清除語音快取」影響）
// 3) 裝置內建語音（最後保底；也負責音節庫沒有的輕聲字與整詞多音字）
// 注意：iOS 要求聲音在使用者手勢的同步呼叫堆疊中觸發，
// 所以這裡的決策全部同步（hasAudioCached／syllableOf 都是同步查表）。
import { idbGet, hasAudioCached } from './store.js';
import { playBlob, speakNative } from './sfx.js';
import { syllableOf } from './readings.js';

let sylAudio = null;

/** 播音節庫的音（同步觸發）；查無此字回傳 false */
export function playSyllable(ch) {
  const syl = syllableOf(ch);
  if (!syl) return false;
  if (sylAudio) { sylAudio.pause(); sylAudio = null; }
  const a = new Audio(`syl/${syl}.mp3`);
  sylAudio = a;
  a.play().catch(() => {});
  return true;
}

/**
 * 單字發音。keys＝AI 快取的候選 key（原字形在前，繁簡另一形在後）。
 * 必須在使用者手勢內呼叫。
 */
export function speakChar(ch, extraKeys = []) {
  const key = [ch, ...extraKeys].find(hasAudioCached);
  if (key) {
    idbGet('audio', key).then((b) => b && playBlob(b)).catch(() => {});
    return;
  }
  if (playSyllable(ch)) return;
  speakNative(ch);
}
