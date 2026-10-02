// 私人故事收件匣。R2 bucket 不公開；所有內容只能經帶憑證的 Worker 讀取。
import { INBOX_VERSION, INBOX_LIMITS, INBOX_ID, InboxError, validateStoryInput, imageMime, sha256 } from '../../js/inbox-format.js';
import { toStoredTraditional } from '../../js/zhconv.js';
import { TEXT_POLICY_VERSION } from '../../js/text-policy.js';

const manifestKey = (id) => `manifests/${id}.json`;
const completedKey = (id) => `completed/${id}.json`;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function equalsSecret(value, secret) {
  if (!secret || !value || value.length > 256) return false;
  const [a, b] = await Promise.all([sha256(value), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) throw new InboxError('origin', 403);
  return origin;
}

async function readManifest(bucket, id) {
  if (await bucket.get(completedKey(id))) throw new InboxError('expired', 410);
  const obj = await bucket.get(manifestKey(id));
  if (!obj) throw new InboxError('not_found', 404);
  return obj.json();
}

async function limitedBody(request) {
  if (Number(request.headers.get('Content-Length')) > INBOX_LIMITS.uploadBytes + 65536) throw new InboxError('too_large', 413);
  if (!request.body) throw new InboxError('format');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > INBOX_LIMITS.uploadBytes + 65536) throw new InboxError('too_large', 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return new Blob(chunks);
}

async function upload(request, bucket) {
  if (!(request.headers.get('Content-Type') || '').startsWith('multipart/form-data;')) throw new InboxError('format');
  const body = await limitedBody(request);
  let form;
  try { form = await new Response(body, { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData(); }
  catch { throw new InboxError('format'); }
  let raw;
  try { raw = JSON.parse(form.get('story')); } catch { throw new InboxError('format'); }
  const story = validateStoryInput(raw);
  story.title = toStoredTraditional(story.title, story.lang);
  story.text = toStoredTraditional(story.text, story.lang);
  story.lang = 'zh-Hant';
  story.textPolicy = TEXT_POLICY_VERSION;
  const files = form.getAll('images');
  if (!files.length || files.length > INBOX_LIMITS.images) throw new InboxError('image');
  const images = [];
  const blobs = [];
  for (const file of files) {
    if (!(file instanceof Blob) || !file.size || file.size > INBOX_LIMITS.imageBytes) throw new InboxError('too_large', 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = imageMime(bytes);
    const digest = await sha256(bytes);
    images.push({ index: images.length, mime, size: file.size, sha256: digest });
    blobs.push(bytes);
  }
  const digest = await sha256(JSON.stringify({ ...story, images }));
  const completed = await bucket.get(completedKey(story.id));
  if (completed) {
    if ((await completed.json()).digest !== digest) throw new InboxError('conflict', 409);
    return json({ id: story.id, uploaded: true, duplicate: true, expired: true });
  }
  const prev = await bucket.get(manifestKey(story.id));
  if (prev) {
    const saved = await prev.json();
    if (saved.digest !== digest) throw new InboxError('conflict', 409);
    return json({ id: story.id, uploaded: true, duplicate: true });
  }
  // 圖先存完，manifest 最後才發布；不同內容使用不同 key，並行上傳不會互相換圖。
  for (const im of images) {
    await bucket.put(`images/${story.id}/${digest}/${im.index}`, blobs[im.index], { httpMetadata: { contentType: im.mime } });
  }
  const saved = await bucket.put(manifestKey(story.id), JSON.stringify({
    ...story, images, digest, createdAt: Date.now(), version: INBOX_VERSION,
  }), { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' } });
  if (!saved) {
    const winner = await readManifest(bucket, story.id);
    if (winner.digest !== digest) throw new InboxError('conflict', 409);
  }
  return json({ id: story.id, uploaded: true, duplicate: !saved }, saved ? 201 : 200);
}

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ app: 'autobook-inbox', version: INBOX_VERSION });
  if (!env.INBOX || !env.READ_TOKEN || !env.WRITE_TOKEN || env.READ_TOKEN === env.WRITE_TOKEN) throw new InboxError('unconfigured', 503);
  const bearer = request.headers.get('Authorization') || '';
  const token = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const writer = await equalsSecret(token, env.WRITE_TOKEN);
  const reader = writer || await equalsSecret(token, env.READ_TOKEN);
  if (!reader) throw new InboxError('auth', 401);

  if (url.pathname === '/v1/stories') {
    if (request.method === 'POST') {
      if (!writer) throw new InboxError('forbidden', 403);
      return upload(request, env.INBOX);
    }
    if (request.method === 'GET') {
      const cursor = url.searchParams.get('cursor') || undefined;
      if (cursor && cursor.length > 2048) throw new InboxError('format');
      const list = await env.INBOX.list({ prefix: 'manifests/', limit: 50, cursor });
      return json({ ids: list.objects.map((o) => o.key.slice('manifests/'.length, -5)), cursor: list.truncated ? list.cursor : null });
    }
  }
  const match = /^\/v1\/stories\/([a-zA-Z0-9_-]+)(?:\/(images|receipts)(?:\/([0-9]+))?)?$/.exec(url.pathname);
  if (!match || !INBOX_ID.test(match[1])) throw new InboxError('not_found', 404);
  const [, id, section, index] = match;
  // 小型回條與 id 校驗值保留，清理後仍可查接收狀態，重試上傳也不會復活舊書。
  if (section === 'receipts' && index === undefined && request.method === 'GET') {
    if (!writer) throw new InboxError('forbidden', 403);
    const completed = await env.INBOX.get(completedKey(id));
    if (!completed) await readManifest(env.INBOX, id);
    const cursor = url.searchParams.get('cursor') || undefined;
    const list = await env.INBOX.list({ prefix: `receipts/${id}/`, limit: 50, cursor });
    const receipts = await Promise.all(list.objects.map(async (o) => (await env.INBOX.get(o.key)).json()));
    return json({ id, uploaded: true, expired: !!completed, receipts, cursor: list.truncated ? list.cursor : null });
  }
  const story = await readManifest(env.INBOX, id);
  if (!section && request.method === 'GET') return json(story);
  if (section === 'images' && index !== undefined && request.method === 'GET') {
    const im = story.images[Number(index)];
    if (!im) throw new InboxError('not_found', 404);
    const obj = await env.INBOX.get(`images/${id}/${story.digest}/${im.index}`);
    if (!obj) throw new InboxError('not_found', 404);
    return new Response(obj.body, { headers: { 'Content-Type': im.mime, 'Content-Length': String(im.size) } });
  }
  if (section === 'receipts' && index === undefined) {
    if (request.method === 'POST') {
      if (Number(request.headers.get('Content-Length')) > 1024) throw new InboxError('format');
      const body = await limitedReceipt(request);
      if (!body || typeof body.deviceId !== 'string' || !INBOX_ID.test(body.deviceId)) throw new InboxError('format');
      // 只有 App 在圖片與故事落盤後，才會送回這筆接收回條。
      const receiptKey = `receipts/${id}/${body.deviceId}.json`;
      const receipt = { deviceId: body.deviceId, receivedAt: Date.now() };
      const saved = await env.INBOX.put(receiptKey, JSON.stringify(receipt), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
      const first = saved ? receipt : await (await env.INBOX.get(receiptKey)).json();
      const expiresAt = first.receivedAt + RETENTION_MS;
      // 時間排序的工作列：回條重送不會延後期限；任一装置收到後都給其他装置七天接收。
      await env.INBOX.put(`cleanup/${String(expiresAt).padStart(13, '0')}/${id}.json`, JSON.stringify({ id, digest: story.digest, expiresAt }),
        { onlyIf: new Headers({ 'If-None-Match': '*' }) });
      return json({ received: true });
    }
  }
  throw new InboxError('not_found', 404);
}

export async function cleanupReceived(bucket, now = Date.now()) {
  // 每小時最多三本，限制一次排程的操作數；未到期工作按時間排序，後面的也不需讀。
  const jobs = await bucket.list({ prefix: 'cleanup/', limit: 3 });
  let cleaned = 0;
  for (const obj of jobs.objects) {
    const value = await bucket.get(obj.key);
    if (!value) continue;
    const job = await value.json();
    if (job.expiresAt > now) break;
    if (!INBOX_ID.test(job.id) || !/^[a-f0-9]{64}$/.test(job.digest) || !Number.isFinite(job.expiresAt)) throw new Error('invalid cleanup job');
    // 先記完成再移除 manifest。失敗時保留工作，下一輪可繼續清理；相同 id 不可重新發布。
    await bucket.put(completedKey(job.id), JSON.stringify({ id: job.id, digest: job.digest, purgedAt: now }),
      { onlyIf: new Headers({ 'If-None-Match': '*' }) });
    await bucket.delete(manifestKey(job.id));
    const images = await bucket.list({ prefix: `images/${job.id}/`, limit: 1000 });
    if (images.objects.length) await bucket.delete(images.objects.map((im) => im.key));
    // 極端情況有超過一頁的孤立圖片，保留工作，下輪繼續；不影響其他故事。
    if (images.truncated) continue;
    await bucket.delete(obj.key);
    cleaned++;
  }
  return { cleaned };
}

async function limitedReceipt(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new InboxError('format');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) throw new InboxError('format');
      chunks.push(value);
    }
    return JSON.parse(await new Blob(chunks).text());
  } catch { throw new InboxError('format'); }
  finally { await reader.cancel().catch(() => {}); }
}

export default {
  async scheduled(event, env) {
    await cleanupReceived(env.INBOX, event.scheduledTime);
  },
  async fetch(request, env) {
    let origin = null;
    let response;
    try {
      origin = checkOrigin(request, env);
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env);
    } catch (e) {
      if (!(e instanceof InboxError)) console.error('inbox request failed', e.name);
      response = json({ error: e instanceof InboxError ? e.code : 'server' }, e instanceof InboxError ? e.status : 500);
    }
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Vary', 'Origin');
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }
    return new Response(response.body, { status: response.status, headers });
  },
};
