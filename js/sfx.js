// WebAudio 合成音效（不需任何素材檔）＋ PCM→WAV 工具
let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, type = 'sine', gain = 0.25, glide = 0) {
  const c = audioCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, c.currentTime + start + dur);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export const sfx = {
  pop()   { tone(880, 0, 0.09, 'sine', 0.2, 1320); },
  unpop() { tone(660, 0, 0.09, 'sine', 0.15, 440); },
  // 故事點讀高亮用：極輕的短提示音，不干擾親子唸讀
  tick()  { tone(1200, 0, 0.045, 'sine', 0.06); },
  tock()  { tone(800, 0, 0.045, 'sine', 0.05); },
  tap()   { tone(520, 0, 0.06, 'triangle', 0.15); },
  correct() {
    tone(523.25, 0,    0.12, 'triangle', 0.28);
    tone(659.25, 0.09, 0.12, 'triangle', 0.28);
    tone(783.99, 0.18, 0.22, 'triangle', 0.3);
  },
  wrong() {
    tone(220, 0, 0.18, 'sawtooth', 0.12, 160);
    tone(180, 0.12, 0.22, 'sawtooth', 0.1, 120);
  },
  fanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => tone(f, i * 0.13, 0.2, 'triangle', 0.3));
    tone(1318.5, 0.78, 0.5, 'triangle', 0.32);
  },
  sparkle() {
    tone(1567.98, 0, 0.1, 'sine', 0.15);
    tone(2093, 0.07, 0.14, 'sine', 0.12);
  },
  /** 星星階梯音：第 i 顆（0~4）音高遞升，帶一點高八度亮光 */
  star(i) {
    const ladder = [523.25, 659.25, 783.99, 987.77, 1174.66]; // C5 E5 G5 B5 D6
    const f = ladder[Math.min(i, ladder.length - 1)];
    tone(f, 0, 0.22, 'triangle', 0.3);
    tone(f * 2, 0.02, 0.12, 'sine', 0.1);
  },
  whoosh() {
    const c = audioCtx();
    const len = 0.35 * c.sampleRate;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(600, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(3000, c.currentTime + 0.3);
    const g = c.createGain();
    g.gain.value = 0.18;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  },
};

// Gemini TTS 回傳 raw PCM (s16le, 24kHz, mono)，包成 WAV 才能給 <audio> 播
export function pcmToWav(pcmBytes, sampleRate = 24000, channels = 1) {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const byteRate = sampleRate * channels * 2;
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcmBytes.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, pcmBytes.length, true);
  return new Blob([header, pcmBytes], { type: 'audio/wav' });
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 播放 blob，回傳 Promise（播完 resolve）
let currentAudio = null;
export function playBlob(blob) {
  return new Promise((resolve) => {
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    currentAudio = a;
    a.onended = () => { URL.revokeObjectURL(url); resolve(); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    a.play().catch(() => resolve());
  });
}

/**
 * 裝置內建語音（離線、永不失敗）：AI 語音缺檔時的後備。
 * 中文一律 zh-TW（繁體＝資料核心，讀音以臺灣華語為準）；其他當英文唸。
 * 回傳是否有唸出來。
 *
 * iOS WebKit 有幾個已知怪癖，這裡逐一處理：
 * - 語音要在「使用者手勢中」先講過一次才解鎖 → 首次觸控時 primeNative()
 * - utterance 沒保留引用會被 GC，聲音出不來 → 存進 module 變數
 * - cancel() 後引擎偶發卡在 paused → speak 後補 resume()
 * - getVoices() 首次呼叫常是空陣列 → 監聽 voiceschanged；找不到聲音就靠 u.lang
 */
let nativeU = null;
// iOS 的 speechSynthesis 會把 app 的音訊 session 切成「壓低其他聲音」模式，
// 且講完後常不復原 → WebAudio/<audio> 全部變很小聲，要等別的 app 搶走 session 才恢復。
// 緩解：語音一結束就關掉舊的 AudioContext，下一個音效重開新的 context 重新取得正常音量。
function unduck() {
  if (!ctx) return;
  const old = ctx; ctx = null;
  try { old.close().catch(() => {}); } catch { /* ignore */ }
}
if (typeof speechSynthesis !== 'undefined') {
  try { speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices()); } catch { /* 舊瀏覽器 */ }
}

let nativePrimed = false;
function primeNative() {
  if (nativePrimed || !('speechSynthesis' in window)) return;
  nativePrimed = true;
  try {
    // 空字串＋預設音量：部分 iOS 版本會忽略 volume=0 的解鎖，空字串本身就無聲
    const u = new SpeechSynthesisUtterance('');
    u.onend = u.onerror = unduck;
    speechSynthesis.speak(u);
  } catch { /* ignore */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', primeNative, { once: true, capture: true });
}

export function speakNative(text) {
  if (!('speechSynthesis' in window)) return false;
  try {
    primeNative();
    const zh = /\p{Script=Han}/u.test(text);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = zh ? 'zh-TW' : 'en-US';
    u.rate = 0.8; // 給小孩聽，放慢一點
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => (x.lang || '').replace('_', '-') === u.lang)
      || vs.find((x) => (x.lang || '').startsWith(zh ? 'zh' : 'en'));
    if (v) u.voice = v;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    nativeU = u; // 保留引用避免 GC
    u.onend = () => { if (nativeU === u) nativeU = null; unduck(); };
    u.onerror = u.onend;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    speechSynthesis.speak(u);
    speechSynthesis.resume();
    return true;
  } catch { return false; }
}
