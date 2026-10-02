// 故事收件匣的共用格式：App、Worker、上傳工具使用同一套驗證。
export const INBOX_VERSION = 1;
export const INBOX_LIMITS = { title: 40, text: 1500, images: 8, imageBytes: 4 * 1048576, uploadBytes: 20 * 1048576 };
export const INBOX_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export class InboxError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function inboxUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new InboxError('config'); }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev$/.test(u.hostname)
      || u.username || u.password || u.port || u.search || u.hash || u.pathname !== '/') {
    throw new InboxError('config');
  }
  return u.origin;
}

export function validateStoryInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.id !== 'string' || !INBOX_ID.test(raw.id)) throw new InboxError('format');
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!title || [...title].length > INBOX_LIMITS.title || !/[\u3400-\u9fff]/u.test(text)
      || [...text].length > INBOX_LIMITS.text) throw new InboxError('format');
  const imagePrompt = typeof raw.imagePrompt === 'string' ? raw.imagePrompt.trim().slice(0, 4000) : '';
  return { id: raw.id, title, text, imagePrompt };
}

export function validateManifest(raw) {
  const story = validateStoryInput(raw);
  if (raw.version !== INBOX_VERSION || !Number.isSafeInteger(raw.createdAt) || raw.createdAt <= 0
      || !SHA256.test(raw.digest || '') || !Array.isArray(raw.images) || !raw.images.length
      || raw.images.length > INBOX_LIMITS.images) throw new InboxError('format');
  const images = raw.images.map((im, i) => {
    if (!im || im.index !== i || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(im.mime)
        || !Number.isSafeInteger(im.size) || im.size <= 0 || im.size > INBOX_LIMITS.imageBytes
        || !SHA256.test(im.sha256 || '')) throw new InboxError('format');
    return { index: i, mime: im.mime, size: im.size, sha256: im.sha256 };
  });
  if (images.reduce((n, im) => n + im.size, 0) > INBOX_LIMITS.uploadBytes) throw new InboxError('too_large', 413);
  return { ...story, version: INBOX_VERSION, createdAt: raw.createdAt, digest: raw.digest, images };
}

export function imageMime(bytes) {
  const start = String.fromCharCode(...bytes.slice(0, 12));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return 'image/png';
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.startsWith('RIFF') && start.slice(8, 12) === 'WEBP') return 'image/webp';
  throw new InboxError('image');
}

export async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  // 部分 WKWebView 自訂 scheme 不提供 SubtleCrypto；圖片校驗仍需能離線運作。
  if (!globalThis.crypto?.subtle) return sha256Portable(bytes);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotate = (n, bits) => (n >>> bits) | (n << (32 - bits));

/** FIPS 180-4 SHA-256，供缺少 WebCrypto 的原生 WebView 做內容校驗。 */
export function sha256Portable(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(size);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(size - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(size - 4, (bytes.length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = w[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    for (const [i, n] of [a, b, c, d, e, f, g, hh].entries()) h[i] += n;
  }
  return [...h].map((n) => n.toString(16).padStart(8, '0')).join('');
}

export function parsePairing(code) {
  try {
    if (!code.startsWith('AB1.')) throw new Error();
    const body = code.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))));
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(raw.readToken || '')) throw new Error();
    return { url: inboxUrl(raw.url), readToken: raw.readToken };
  } catch { throw new InboxError('config'); }
}
