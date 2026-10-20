// 獨立 localhost 與合成字表；先啟動 python3 tools/devserver.py 8138。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8138';
const output = process.env.AUDIT_OUTPUT || '/tmp/autobook-word-search-audit';
fs.mkdirSync(output, { recursive: true });
const results = [];
const skipped = [];
for (const [engine, type] of Object.entries({ chromium, webkit })) {
  if (!fs.existsSync(type.executablePath())) { skipped.push(engine); continue; }
  const browser = await type.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${origin}/tests/word-search-browser.html?theme=${theme}`);
        await page.locator('.word-search input').waitFor();
        await page.locator('#run').click();
        await page.waitForFunction(() => document.querySelector('#results').dataset.result);
        const report = await page.locator('#results').evaluate((el) => ({ result: el.dataset.result, checks: [...el.children].map((li) => li.textContent) }));
        assert.equal(report.result, 'passed', report.checks.join('\n'));
        await page.locator('#words').click();
        const input = page.getByRole('searchbox', { name: '搜尋字表' });
        await input.fill('');
        for (const [chunk, expected] of [['da', '大'], ['tian', '大天'], ['wo', '大天我'], ['bu', '大天我不']]) {
          await input.pressSequentially(chunk);
          const incremental = await page.locator('.word-search-grid > :not([hidden])').evaluateAll((nodes) => nodes.map((el) => el.dataset.ch));
          assert([...expected].every((ch) => incremental.includes(ch)), `逐段輸入 ${chunk} 即時篩選`);
        }
        const visible = await page.locator('.word-search-grid > :not([hidden])').evaluateAll((nodes) => nodes.map((el) => el.dataset.ch));
        assert([...'大天我不'].every((ch) => visible.includes(ch)));
        assert.equal(await input.evaluate((el) => document.activeElement === el), true);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false);
        const image = `${engine}-${theme}-${viewport.width}.png`;
        await page.locator('#toast-root').evaluate((el) => el.replaceChildren());
        await page.locator('#confetti-canvas').evaluate((el) => { el.hidden = true; });
        await page.locator('#test-root').screenshot({ path: `${output}/${image}` });
        assert.deepEqual(errors, []);
        results.push({ engine, viewport, theme, ...report, visible, overflow, image, errors });
        await context.close();
      }
    }
  } finally { await browser.close(); }
}
assert(results.length > 0, '至少需一個可用的瀏覽器');
fs.writeFileSync(`${output}/report.json`, JSON.stringify({ results, skipped }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, checksPerRun: results[0].checks.length, skipped, output }));
