// 把純靜態的 web 檔案收進 dist/（給 Capacitor 的 webDir 用；PWA 本身不需要 build）
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const ITEMS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'syl'];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const it of ITEMS) cpSync(join(root, it), join(dist, it), { recursive: true });
console.log(`dist/ 已產生（${ITEMS.join(', ')}）`);
