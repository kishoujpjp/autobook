// 私人收件匣的上傳工具。憑證只讀 .inbox/config.json，不放 URL 或命令列。
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { inboxUrl, validateStoryInput, INBOX_ID, INBOX_LIMITS, imageMime } from '../js/inbox-format.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privateDir = join(root, '.inbox');
const configFile = join(privateDir, 'config.json');

async function privateFile(path, content) {
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function loadConfig() {
  let config;
  try { config = JSON.parse(await readFile(configFile, 'utf8')); }
  catch { throw new Error('請先執行 init，建立本機憑證。'); }
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(config.writeToken || '') || !/^[a-zA-Z0-9_-]{32,128}$/.test(config.readToken || '')) {
    throw new Error('本機憑證格式不正確。');
  }
  return config;
}

async function api(config, path, options = {}) {
  const url = inboxUrl(config.url);
  const response = await fetch(url + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { ...options.headers, Authorization: `Bearer ${config.writeToken}` } });
  let body;
  try { body = await response.json(); } catch { throw new Error(`接口回應不是 JSON（HTTP ${response.status}）。`); }
  if (!response.ok) throw new Error(`接口拒絕請求（HTTP ${response.status}，${body.error || 'unknown'}）。`);
  return body;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'init') {
    try { await readFile(configFile); throw new Error('已經有憑證，保留現有配對。'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    const config = { url: args[0] ? inboxUrl(args[0]) : '',
      readToken: randomBytes(32).toString('base64url'), writeToken: randomBytes(32).toString('base64url') };
    await privateFile(configFile, JSON.stringify(config, null, 2) + '\n');
    console.log('本機憑證已建立於 .inbox/config.json（不會提交到 Git）。');
    return;
  }
  if (command === 'set-url') {
    const config = await loadConfig();
    config.url = inboxUrl(args[0]);
    await privateFile(configFile, JSON.stringify(config, null, 2) + '\n');
    console.log('收件匣網址已儲存。');
    return;
  }
  if (command === 'secrets') {
    const config = await loadConfig();
    await privateFile(join(privateDir, 'secrets.json'), JSON.stringify({ READ_TOKEN: config.readToken, WRITE_TOKEN: config.writeToken }));
    console.log('已產生 .inbox/secrets.json，供 Wrangler secret bulk 使用。');
    return;
  }
  if (command === 'pair') {
    const config = await loadConfig();
    const code = 'AB1.' + Buffer.from(JSON.stringify({ url: inboxUrl(config.url), readToken: config.readToken })).toString('base64url');
    await privateFile(join(privateDir, 'pairing.txt'), code + '\n');
    console.log('配對碼已寫入 .inbox/pairing.txt；請貼到 App「設定 → 故事收件匣」。');
    return;
  }
  if (command === 'upload') {
    const [path, ...imagePaths] = args;
    if (!path || !imagePaths.length || imagePaths.length > INBOX_LIMITS.images) throw new Error('需要一份故事 JSON 與 1～8 張圖片。');
    const config = await loadConfig();
    const raw = JSON.parse(await readFile(resolve(path), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('故事 JSON 必須是一個物件。');
    if (!raw.id) {
      raw.id = randomUUID();
      // 第一次生成的 id 存回原檔；中途斷線再傳同一份檔案時，不會變成第二本。
      await writeFile(resolve(path), JSON.stringify(raw, null, 2) + '\n');
    }
    const story = validateStoryInput(raw);
    const form = new FormData();
    form.set('story', JSON.stringify(story));
    let total = 0;
    for (const path of imagePaths) {
      const bytes = await readFile(resolve(path));
      total += bytes.length;
      if (!bytes.length || bytes.length > INBOX_LIMITS.imageBytes || total > INBOX_LIMITS.uploadBytes) throw new Error('圖片過大：每張最多 4 MB，整組最多 20 MB。');
      form.append('images', new Blob([bytes], { type: imageMime(bytes) }), 'image');
    }
    const result = await api(config, '/v1/stories', { method: 'POST', body: form });
    console.log(JSON.stringify({ ...result, status: result.expired ? '這本故事先前已送達並清理；要重新傳送請使用新 id。' : '雲端已收到；等待 App 接收。' }, null, 2));
    return;
  }
  if (command === 'status') {
    if (!INBOX_ID.test(args[0] || '')) throw new Error('需要故事 id。');
    const config = await loadConfig();
    const receipts = [];
    let expired = false;
    let cursor = null;
    do {
      const result = await api(config, `/v1/stories/${args[0]}/receipts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      receipts.push(...result.receipts);
      expired = !!result.expired;
      cursor = result.cursor;
    } while (cursor);
    console.log(JSON.stringify({ id: args[0], status: expired ? 'App 已匯入；雲端故事與圖片已清理。' : receipts.length ? 'App 已匯入。' : '雲端已收到；等待 App 接收。', expired, receipts }, null, 2));
    return;
  }
  console.log('用法：node tools/inbox-upload.mjs init [收件匣網址]\n'
    + '      node tools/inbox-upload.mjs secrets\n'
    + '      node tools/inbox-upload.mjs set-url <https://…workers.dev>\n'
    + '      node tools/inbox-upload.mjs pair\n'
    + '      node tools/inbox-upload.mjs upload <故事.json> <圖片1> [圖片2…]\n'
    + '      node tools/inbox-upload.mjs status <故事id>');
}

main().catch((e) => { console.error(e.code === 'format' ? '故事格式不正確：書名最多 40 字，中文內文最多 1500 字。' : e.message); process.exitCode = 1; });
