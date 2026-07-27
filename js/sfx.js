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
