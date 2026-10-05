// 收件匣測試專用的私人 R2 替身；不讀取真實憑證或裝置資料。
import worker from '../cloud/inbox/worker.js';

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4uoAAAAASUVORK5CYII=', 'base64');
export const base = 'https://autobook-inbox.test.workers.dev';
export const readToken = 'r'.repeat(43), writeToken = 'w'.repeat(43);

export class Bucket {
  data = new Map();
  failImage = false;
  async get(key) {
    const saved = this.data.get(key);
    if (!saved) return null;
    const response = new Response(saved.body);
    return { body: response.body, json: () => response.json() };
  }
  async put(key, body, options = {}) {
    if (key.includes('images/') && this.failImage) throw new Error('R2 image failure');
    if (options.onlyIf?.get('If-None-Match') === '*' && this.data.has(key)) return null;
    this.data.set(key, { body, options });
    return { key };
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key); }
  async list({ prefix, cursor, limit }) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    return { objects: keys.slice(start, start + limit).map((key) => ({ key })),
      truncated: start + limit < keys.length, cursor: String(start + limit) };
  }
}

export function env() {
  return { INBOX: new Bucket(), READ_TOKEN: readToken, WRITE_TOKEN: writeToken,
    ALLOWED_ORIGINS: 'https://localhost,http://127.0.0.1:8138' };
}

export function call(e, path, token = readToken, options = {}) {
  return worker.fetch(new Request(base + path, { ...options,
    headers: { ...options.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }), e);
}

export function body(kind = 'stories', raw = {}, bytes = PNG) {
  const form = new FormData();
  form.set(kind === 'stories' ? 'story' : 'update', JSON.stringify(kind === 'stories'
    ? { id: 'story_001', title: '小貓', text: '小貓回家。', lang: 'zh-Hant', ...raw }
    : { id: 'append_001', targetId: 'story_001', ...raw }));
  form.append('images', new Blob([bytes], { type: 'image/png' }), 'image.png');
  return form;
}

export const upload = (e, kind = 'stories', raw = {}, bytes = PNG) => call(e, `/v1/${kind}`, writeToken,
  { method: 'POST', body: body(kind, raw, bytes) });
