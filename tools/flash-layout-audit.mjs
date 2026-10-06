// 字／詞卡幾何與點擊回歸；獨立 context、合成字表，不操作私人資料。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER || 'chromium';
const browser = await engines[engine].launch({ headless: true });
const output = process.env.AUDIT_OUTPUT || `/tmp/autobook-flash-layout-${engine}`;
fs.mkdirSync(output, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
try {
  await page.addInitScript(() => {
    localStorage.setItem('autobook.accounts', JSON.stringify([
      { id: 'layout-parent', role: 'parent', name: '測試家長', avatar: { kind: 'preset', preset: 'fox' } },
      { id: 'layout-kid', role: 'kid', name: '測試小孩', avatar: { kind: 'preset', preset: 'cat' } },
    ]));
    localStorage.setItem('autobook.currentAccount', JSON.stringify('layout-parent'));
    localStorage.setItem('autobook.settings', JSON.stringify({ onboarded: true, tapSpeak: false, toastVoice: false, parentGateOn: false, weakMode: false, wordLen: 'all' }));
    localStorage.setItem('autobook.words', JSON.stringify([... '大海小水花'].map((ch) => ({ ch, addedAt: Date.now(), usedCount: 0, cards: {}, archived: false }))));
  });
  await page.goto(process.env.AUDIT_URL || 'http://127.0.0.1:8138');
  await page.waitForFunction(() => window.__autobookReady);
  cases: for (const viewport of [
    { width: 1366, height: 1024 }, { width: 1366, height: 980 },
    { width: 1194, height: 834 }, { width: 1024, height: 768 },
    { width: 1024, height: 1366 }, { width: 834, height: 1194 },
  ]) for (const role of ['parent', 'kid']) for (const safe of [0, 24]) for (const n of process.env.REPRO_ONLY ? [2] : [1, 2, 3, 4, 5]) {
    await page.setViewportSize(viewport);
    await page.evaluate(async ({ role, safe, n }) => {
      const s = await import('/js/store.js');
      s.setCurrentAccount('layout-' + role);
      (await import('/js/account.js')).applyRole();
      const style = document.documentElement.style;
      style.setProperty('--safe-t', safe + 'px'); style.setProperty('--safe-b', safe + 'px');
      const text = '大海小水花'.slice(0, n);
      const { WORDS } = await import('/js/wordbank.js');
      WORDS.splice(0, WORDS.length, { t: text, s: text });
      (await import('/js/nav.js')).showPage('game');
      (await import('/js/flash.js')).startFlash(document.querySelector('#page-game'), n === 1 ? 'char' : 'word', () => (document.querySelector('#tab-game').click()));
    }, { role, safe, n });
    await page.waitForTimeout(280);
    for (const pop of [false, true]) {
      if (pop) await page.locator('.fc-zi').evaluateAll((els) => els.forEach((el) => {
        el.classList.add('pop');
        for (const animation of el.getAnimations()) { animation.pause(); animation.currentTime = 120; }
      }));
      const geometry = await page.evaluate(() => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const visible = (el) => el && el.getClientRects().length;
        const area = rect(document.querySelector('.fc-area'));
        const cards = [...document.querySelectorAll('.fc-zi')].map(rect);
        const controls = [...document.querySelectorAll('.fc-stage > .spread button, .fc-controls button, #parent-btn, #avatar-btn, #tabbar')].filter(visible);
        const hit = controls.filter((el) => el.tagName === 'BUTTON' && !el.disabled).every((el) => {
          const r = rect(el); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return top === el || el.contains(top);
        });
        const overlap = cards.some((c) => controls.some((el) => {
          const r = rect(el); return c.x < r.right && c.right > r.x && c.y < r.bottom && c.bottom > r.y;
        }));
        return { area, cards, overlap, hit, contained: cards.every((r) => r.x >= area.x - 1 && r.right <= area.right + 1 && r.y >= area.y - 1 && r.bottom <= area.bottom + 1) };
      });
      const result = { viewport, role, safe, n, pop, ...geometry };
      results.push(result);
      if (process.env.REPRO_ONLY && (!geometry.contained || geometry.overlap || !geometry.hit)) {
        await page.screenshot({ path: `${output}/before.png` });
        fs.writeFileSync(`${output}/report.json`, JSON.stringify({ results, errors }, null, 2));
        console.log(JSON.stringify(result));
        process.exitCode = 1; break;
      }
      if (!process.env.REPRO_ONLY) {
        assert.equal(geometry.contained, true, JSON.stringify(result));
        assert.equal(geometry.overlap, false, JSON.stringify(result));
        assert.equal(geometry.hit, true, JSON.stringify(result));
      }
    }
    if (process.exitCode) break cases;
    if (viewport.width === 1366 && viewport.height === 980 && role === 'parent' && safe === 24 && n === 2) {
      await page.locator('.fc-zi').evaluateAll((els) => els.forEach((el) => el.classList.remove('pop')));
      await page.screenshot({ path: `${output}/word-landscape.png` });
    }
    // 字卡出題及歷史往返仍由原按鈕／鍵盤處理。
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('.fc-counter').innerText(), '第 2 張');
    await page.keyboard.press('ArrowLeft'); assert.equal(await page.locator('.fc-counter').innerText(), '第 1 張');
  }
  if (!process.env.REPRO_ONLY) {
    const beforeRotate = await page.locator('.fc-counter').innerText();
    const text = await page.locator('.fc-card').innerText();
    for (const size of [{ width: 1366, height: 980 }, { width: 1024, height: 1366 }]) {
      await page.setViewportSize(size); await page.waitForTimeout(150);
      assert.equal(await page.locator('.fc-counter').innerText(), beforeRotate, '旋轉不換題');
      assert.equal(await page.locator('.fc-card').innerText(), text, '旋轉保留當前字卡');
      assert.equal(await page.locator('.fc-area').evaluate((area) => {
        const a = area.getBoundingClientRect();
        return [...area.querySelectorAll('.fc-zi')].every((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= a.top && r.bottom <= a.bottom && r.left >= a.left && r.right <= a.right;
        });
      }), true, '同張字卡旋轉後仍完整顯示');
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${output}/report.json`, JSON.stringify({ passed: !process.exitCode, engine, cases: results.length, results, errors }, null, 2));
  console.log(`${engine} 字卡版面：${results.length} 組；${output}/report.json`);
} finally { await browser.close(); }
