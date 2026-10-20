// 真實 .page 捲動容器與合成字表；先啟動 tools/devserver.py 8138。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8138';
const output = process.env.AUDIT_OUTPUT || '/tmp/autobook-words-toolbar';
fs.mkdirSync(output, { recursive: true });
const results = [];
const measure = (page) => page.evaluate(() => {
  const root = document.querySelector('#test-root');
  const box = (selector) => {
    const el = root.querySelector(selector);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height, hit: el === hit || el.contains(hit) };
  };
  return { scrollTop: root.scrollTop, overflow: root.scrollWidth > root.clientWidth,
    toolbar: box('.words-search-bar'), sort: box('.words-sort-select'), input: box('.word-search input'),
    lock: box('.words-lock-btn'), edit: box('.words-edit-btn'), add: box('.words-add-btn'),
    avatar: box('#avatar-btn'), parent: box('#parent-btn'),
    mask: getComputedStyle(root.querySelector('.words-search-bar'), '::before').content,
    standalone: root.querySelector('.words-search-bar').parentElement === root };
});
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  if (!fs.existsSync(type.executablePath())) continue;
  const browser = await type.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }, { width: 390, height: 844 }]) {
      for (const safeTop of [0, 24]) {
        const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${origin}/tests/word-search-browser.html?layout=words&theme=${safeTop ? 'dark' : 'light'}`);
        await page.locator('.words-search-bar input').waitFor().catch((error) => {
          throw new Error(`${engine} ${viewport.width} safe=${safeTop}: ${errors.join('; ') || error.message}`);
        });
        await page.evaluate(async (safeTop) => {
          document.documentElement.style.setProperty('--safe-t', `${safeTop}px`);
          const store = await import('/js/store.js');
          store.addWords(Array.from({ length: 240 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join(''));
          (await import('/js/words.js')).refreshWordsPage();
        }, safeTop);
        const initial = await measure(page);
        assert.equal(initial.overflow, false);
        assert(initial.sort.right <= initial.input.x && initial.input.right <= initial.lock.x);
        assert(initial.standalone && initial.mask === 'none', '工具列獨立於字格，不使用外加遮罩');
        assert(initial.toolbar.right - initial.lock.right <= (viewport.width <= 700 ? 10 : 14), '鎖定右側不可有空白保留區');
        assert(Math.abs((initial.sort.y + initial.sort.height / 2) - (initial.lock.y + initial.lock.height / 2)) < 2);
        assert(initial.edit.right <= initial.add.x && Math.abs(initial.edit.y - initial.add.y) < 2);
        assert.equal(await page.locator('.words-mode-hint,.word-search-hint,.word-search-summary,.word-search-empty').count(), 0);
        const initialImage = engine === 'webkit' && safeTop === 0 && viewport.width > 700
          ? `${engine}-${viewport.width}-initial.png` : undefined;
        if (initialImage) await page.screenshot({ path: `${output}/${initialImage}` });
        await page.locator('#test-root').evaluate((el) => { el.scrollTop = 650; });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const scrolled = await measure(page);
        const topGap = scrolled.toolbar.y - safeTop;
        assert(Math.abs(topGap) < 2,
          JSON.stringify({ engine, viewport, safeTop, initial, scrolled }));
        for (const key of ['sort', 'input', 'lock']) assert(scrolled[key].hit, `${key} 捲動後可點按`);
        assert(scrolled.avatar.bottom < scrolled.toolbar.y && scrolled.parent.bottom < scrolled.toolbar.y, '頁首入口隨頁首捲走，不與工具列重疊');
        await page.locator('.words-lock-btn').click();
        const locked = await measure(page);
        assert(Math.abs(locked.scrollTop - scrolled.scrollTop) < 2, '切換鎖定不跳動');
        assert.equal(await page.locator('.words-lock-btn').getAttribute('aria-pressed'), 'true');
        await page.locator('.words-sort-select').selectOption('least');
        const sorted = await measure(page);
        assert(Math.abs(sorted.scrollTop - locked.scrollTop) < 2, '排序不跳動');
        const image = `${engine}-${viewport.width}-safe${safeTop}.png`;
        await page.screenshot({ path: `${output}/${image}` });
        await page.locator('.words-search-bar input').fill('datianwobu');
        assert.equal(await page.locator('.words-search-bar input').inputValue(), 'datianwobu');
        assert.equal(await page.locator('.words-lock-btn').getAttribute('aria-pressed'), 'true');
        let navigation;
        if (safeTop === 0 && viewport.width === 1366) {
          // 透過真正 main.js 驗證入口搬移與返回，避免只在 fixture 中看起來正常。
          await page.goto(origin);
          await page.waitForFunction(() => window.__autobookReady);
          await page.evaluate(async () => (await import('/js/nav.js')).showPage('words'));
          assert.equal(await page.locator('#page-words .words-account-actions #avatar-btn').count(), 1);
          await page.locator('#avatar-btn').click();
          await page.locator('.switch-grid').waitFor();
          await page.locator('.modal-close').last().click();
          await page.locator('#page-words .words-sort-select').selectOption('least');
          assert.equal(await page.locator('#page-words .words-account-actions #avatar-btn').count(), 1);
          await page.locator('#parent-btn').click();
          assert.equal(await page.locator('#page-parent').evaluate((el) => el.classList.contains('active')), true);
          assert.equal(await page.locator('#avatar-btn').evaluate((el) => el.parentElement === document.body && getComputedStyle(el).position === 'fixed'), true);
          await page.evaluate(async () => (await import('/js/nav.js')).showPage('words'));
          assert.equal(await page.locator('#page-words .words-account-actions #avatar-btn').count(), 1);
          navigation = 'account modal, rerender, parent return, words reentry passed';
        }
        assert.deepEqual(errors, []);
        results.push({ engine, viewport, safeTop, initial, scrolled, locked, sorted, initialImage, image, navigation, errors });
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
assert(results.length >= 6);
fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, output }));
