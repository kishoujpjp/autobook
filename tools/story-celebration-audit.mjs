// 隔離帳號、合成插圖，驗證真正完成流程、觸控重播、收起與減少動態效果。
// 先啟動 python3 tools/devserver.py 8139；可用 PLAYWRIGHT_MODULE 指定模組。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8139';
const output = process.env.AUDIT_OUTPUT || '/tmp/autobook-celebration';
fs.mkdirSync(output, { recursive: true });
const results = [];
const canvasVisible = (page) => page.evaluate(() => {
  const c = document.querySelector('#confetti-canvas');
  return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some(v => v !== 0);
});
for (const engine of ['chromium', 'webkit']) {
  const browser = await engines[engine].launch({ headless: true });
  try {
    for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        const account = 'qa-parent';
        localStorage.setItem('autobook.accounts', JSON.stringify([{ id: account, name: '測試', role: 'parent', avatar: { kind: 'preset', preset: 'fox' } }]));
        localStorage.setItem('autobook.currentAccount', JSON.stringify(account));
        localStorage.setItem('autobook.settings', JSON.stringify({ onboarded: true, storyLayout: 'focus', storySpeak: false, tapSpeak: false, toastVoice: false }));
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="750"><rect width="1000" height="750" fill="#dcefe9"/><circle cx="800" cy="140" r="65" fill="#ffe08a"/><path d="M0 510Q250 310 500 510T1000 510V750H0Z" fill="#92c0a1"/><ellipse cx="430" cy="550" rx="95" ry="100" fill="#fff9ef"/><ellipse cx="390" cy="410" rx="24" ry="95" fill="#fff9ef"/><ellipse cx="460" cy="410" rx="24" ry="95" fill="#fff9ef"/><circle cx="405" cy="525" r="7" fill="#4a3b2a"/><circle cx="455" cy="525" r="7" fill="#4a3b2a"/></svg>';
        localStorage.setItem('autobook.stories', JSON.stringify([{ id: 'qa-story', title: '小兔看書', text: '小兔看書。', lang: 'zh-Hant', textPolicy: 1, media: [{ id: 'qa-media', kind: 'image', url: 'data:image/svg+xml,' + encodeURIComponent(svg) }], hlBy: {}, readsBy: {} }]));
      });
      await page.goto(origin);
      await page.waitForFunction(() => window.__autobookReady);
      // 真正點完內文字塊，驗證只計一次讀完。
      for (const tile of await page.locator('.story-text .zi').all()) await tile.click();
      await page.locator('.reveal-stage').waitFor();
      await page.waitForTimeout(650);
      assert(await canvasVisible(page), '首次讀完有彩帶');
      await page.screenshot({ path: `${output}/${engine}-${viewport.width}.png` });
      const geometry = await page.evaluate(() => {
        const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
        return { frame: box('.story-frame'), close: box('.stage-close'), hint: box('.reveal-replay-hint'), fit: getComputedStyle(document.querySelector('.frame-mat img')).objectFit };
      });
      assert(geometry.frame.x >= 0 && geometry.frame.y >= 0 && geometry.frame.right <= viewport.width && geometry.close.bottom <= viewport.height && geometry.hint.bottom <= geometry.close.y, '圖片、提示與收起鈕完整可見');
      assert.equal(geometry.fit, 'contain');
      // 觸控圖片及背景皆重播；一次只保留一組星星。
      await page.locator('.story-frame').tap();
      await page.waitForTimeout(500);
      await page.locator('.reveal-stage').tap({ position: { x: 12, y: viewport.height / 2 } });
      assert.equal(await page.locator('.reveal-stage').count(), 1, '點背景不關閉');
      assert.equal(await page.locator('.magic-star').count(), 24, '重播替換上一輪星星');
      await page.waitForTimeout(200);
      assert(await canvasVisible(page), '背景重播有彩帶');
      await page.waitForTimeout(4100);
      assert.equal(await canvasVisible(page), false, '播放結束清空彩帶');
      await page.locator('.story-frame').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      assert(await canvasVisible(page), '鍵盤可以重播');
      assert.equal(await page.evaluate(async () => { const s = await import('/js/store.js'); return s.storyReads(s.stories[0]); }), 1, '重播不增加閱讀次數');
      await page.getByRole('button', { name: '收起來', exact: true }).tap();
      assert.equal(await canvasVisible(page), false, '收起立即清掉彩帶');
      await page.getByRole('button', { name: '再看一次', exact: true }).tap();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.reveal-stage').count(), 0, 'Escape 關閉');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: '再看一次', exact: true }).tap();
      await page.locator('.story-frame').tap();
      await page.waitForTimeout(250);
      assert.equal(await canvasVisible(page), false, '減少動態效果不播放彩帶');
      assert.equal(await page.locator('.magic-star').count(), 0);
      await page.keyboard.press('Escape');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(async () => { const s = await import('/js/store.js'); s.settings.storyLayout = 'side'; (await import('/js/story.js')).render(); });
      await page.waitForTimeout(100);
      await page.locator('.fig-wrap').tap();
      await page.waitForTimeout(250);
      assert(await canvasVisible(page), '圖文並排也能觸控重播');
      await page.evaluate(async () => (await import('/js/nav.js')).showPage('words'));
      assert.equal(await canvasVisible(page), false, '切頁清掉彩帶');
      assert.deepEqual(errors, []);
      results.push({ engine, viewport, geometry, passed: true });
      await context.close();
    }
  } finally { await browser.close(); }
}
fs.writeFileSync(`${output}/report.json`, JSON.stringify(results, null, 2) + '\n');
console.log(`${results.length} 組慶祝動畫回歸通過：${output}`);
