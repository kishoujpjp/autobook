// 獨立 browser context 與合成資料；不操作正式站或私人帳號／書架。
// 啟動 python3 tools/devserver.py 8138，設定 PLAYWRIGHT_MODULE 後執行。
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_URL || 'http://127.0.0.1:8138';
const output = process.env.AUDIT_OUTPUT || '/tmp/autobook-keyboard';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
fs.mkdirSync(output, { recursive: true });

try {
  await page.addInitScript(() => {
    const account = 'keyboard-parent';
    const text = '小兔和小貓一起看書。\n他們走到小河邊，看見一朵小花。\n今天真是美好的一天。\n'.repeat(7);
    localStorage.setItem('autobook.accounts', JSON.stringify([{ id: account, name: '測試家長', role: 'parent', avatar: { kind: 'preset', preset: 'fox' } }]));
    localStorage.setItem('autobook.currentAccount', JSON.stringify(account));
    localStorage.setItem('autobook.settings', JSON.stringify({ onboarded: true, storyLayout: 'focus', storySpeak: false, tapSpeak: false, toastVoice: false, parentGateOn: false }));
    localStorage.setItem('autobook.stories', JSON.stringify([{ id: 'keyboard-book', title: '小兔的花園', text, lang: 'zh-Hant', textPolicy: 1, createdAt: Date.now(), newChars: [], media: [] }]));
    localStorage.setItem('autobook.words', JSON.stringify([...new Set([...text + '好朋友大小天地'].filter((ch) => /\p{Script=Han}/u.test(ch)))].map((ch) => ({ ch, addedAt: Date.now(), archived: false, usedCount: 0, cards: {} }))));
    // 只記錄播放要求，不需麥克風／喇叭或外部 AI。
    window.__keyboardAudio = [];
    HTMLMediaElement.prototype.play = function () {
      window.__keyboardAudio.push(this.getAttribute('src'));
      return Promise.resolve();
    };
    window.speechSynthesis.speak = (u) => window.__keyboardAudio.push(u.text);
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.__autobookReady);
  async function press(key) {
    await page.keyboard.press(key);
    if (key === 'Home' || key === 'End') {
      await page.waitForFunction((key) => {
        const el = document.querySelector('.story-scroll');
        return key === 'Home' ? el.scrollTop <= 1 : el.scrollTop >= el.scrollHeight - el.clientHeight - 1;
      }, key);
      await page.waitForTimeout(100);
    } else await page.waitForTimeout(650);
  }
  async function pager() { return page.locator('.page-ind').innerText(); }
  async function nav(name) {
    await page.evaluate(async (name) => (await import('/js/nav.js')).showPage(name), name);
    await page.waitForTimeout(150);
  }
  async function blur() { await page.evaluate(() => document.activeElement.blur()); }
  async function data() {
    return page.evaluate(async () => {
      const s = await import('/js/store.js');
      return JSON.stringify({ stories: s.stories, words: s.words });
    });
  }

  const initial = await data();
  for (const viewport of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
    await page.setViewportSize(viewport);
    for (const layout of ['focus', 'side']) for (const font of ['small', 'big']) {
      await page.evaluate(async ({ layout, font }) => {
        const s = await import('/js/store.js');
        Object.assign(s.settings, { storyLayout: layout, storyFont: font });
        (await import('/js/story.js')).render();
      }, { layout, font });
      await page.waitForTimeout(200);
      const first = await pager();
      assert.match(first, /^1 \/ /);
      await press('ArrowLeft'); assert.equal(await pager(), first);
      await press('ArrowRight'); assert.match(await pager(), /^2 \/ /);
      await press('PageDown'); assert.match(await pager(), /^3 \/ /);
      await press('PageUp'); assert.match(await pager(), /^2 \/ /);
      await press('Home'); assert.equal(await pager(), first);
      await press('End');
      const [last, total] = (await pager()).split(' / ');
      assert.equal(last, total, JSON.stringify(await page.locator('.story-scroll').evaluate((el) => ({
        top: el.scrollTop, height: el.clientHeight, totalHeight: el.scrollHeight,
        max: el.scrollHeight - el.clientHeight,
      }))));
      await press('ArrowRight'); assert.equal(await pager(), `${last} / ${total}`);
      await press('Home');
      assert.equal(await data(), initial, '翻頁不標字、不增加讀完次數');
      results.push({ viewport, layout, font, total: +total });
    }
  }
  await press('Control+ArrowRight'); assert.match(await pager(), /^1 \/ /);
  await press('Meta+ArrowRight'); assert.match(await pager(), /^1 \/ /);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', isComposing: true, bubbles: true })));
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 229, bubbles: true })));
  assert.match(await pager(), /^1 \/ /);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true, bubbles: true })));
  assert.match(await pager(), /^1 \/ /);

  // 開啟面板時不穿透；Esc 只收面板，下一次才返回書架。
  await page.getByRole('button', { name: '閱讀設定', exact: true }).click();
  await press('ArrowRight'); assert.match(await pager(), /^1 \/ /);
  await press('Escape'); assert.equal(await page.locator('.modal-mask').count(), 0);
  assert.equal(await page.locator('#page-story.active').count(), 1);
  await press('Escape'); assert.equal(await page.locator('#page-shelf.active').count(), 1);
  await nav('story');

  // 無 modal 時，輸入框／選单／可編輯區仍擁有方向鍵。
  for (const tag of ['input', 'textarea', 'select', 'div']) {
    await page.evaluate((tag) => {
      const control = document.createElement(tag); control.id = 'keyboard-input';
      if (tag === 'div') control.contentEditable = 'true';
      if (tag === 'select') control.innerHTML = '<option>一</option><option>二</option>';
      document.querySelector('.page.active').append(control); control.focus();
    }, tag);
    await press('ArrowRight'); assert.match(await pager(), /^1 \/ /);
    await press('Escape'); assert.equal(await page.locator('#page-story.active').count(), 1);
    await page.locator('#keyboard-input').evaluate((el) => el.remove());
  }
  await page.evaluate(async () => {
    const { openModal } = await import('/js/ui.js');
    window.__underModal = openModal('下面');
    window.__topModal = openModal('確認', { closable: false });
  });
  await press('Escape'); assert.equal(await page.locator('.modal-mask').count(), 2);
  await page.evaluate(() => window.__topModal.close());
  await press('Escape'); assert.equal(await page.locator('.modal-mask').count(), 0);
  assert.equal(await page.locator('#page-story.active').count(), 1);
  results.push({ guards: 'modifiers, IME, repeat, inputs, nested dialogs' });

  // 圖片舞台先收起，不能順便返回書架；本來的完成流程仍正常。
  await page.evaluate(async () => {
    const s = await import('/js/store.js'); s.settings.storyLayout = 'focus';
    (await import('/js/story.js')).render();
  });
  await page.getByRole('button', { name: '閱讀設定', exact: true }).click();
  await page.getByRole('button', { name: '直接完成', exact: true }).click();
  await page.locator('.reveal-stage').waitFor();
  const behind = await pager();
  await press('ArrowRight'); assert.equal(await pager(), behind);
  await press('Escape'); assert.equal(await page.locator('.reveal-stage').count(), 0);
  assert.equal(await page.locator('#page-story.active').count(), 1);
  results.push({ reveal: 'Esc closes only the stage' });

  for (const mode of ['char', 'word', 'char']) {
    await nav('game');
    await page.getByRole('button', { name: mode === 'char' ? '認字卡' : '詞語卡', exact: true }).click();
    if (mode === 'char') await page.getByRole('button', { name: '直接開始', exact: true }).click();
    await page.locator('.fc-stage').waitFor();
    for (const size of [{ width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
      await page.setViewportSize(size); await page.waitForTimeout(150);
      assert.equal(await page.locator('.fc-stage').evaluate((el) => el.scrollWidth <= el.clientWidth), true, '字／詞卡頁首不溢出');
      if (mode === 'word') await page.screenshot({ path: `${output}/word-card-${size.width}.png` });
    }
    await blur();
    const counter = () => page.locator('.fc-counter').innerText();
    const flashStart = await data();
    await press('ArrowLeft'); assert.equal(await counter(), '第 1 張');
    await press('ArrowRight'); assert.equal(await counter(), '第 2 張');
    const afterNew = await data(); assert.notEqual(afterNew, flashStart);
    await press('ArrowLeft'); assert.equal(await counter(), '第 1 張');
    await press('PageDown'); assert.equal(await counter(), '第 2 張');
    assert.equal(await data(), afterNew, '歷史來回不重複累加次數');
    await press('PageUp'); assert.equal(await counter(), '第 1 張');
    await page.evaluate(() => { window.__keyboardAudio = []; });
    await press('Space'); await press('s');
    assert.equal(await page.evaluate(() => window.__keyboardAudio.length), 2);
    assert.equal(await data(), afterNew, '聽一次不改熟悉度或次數');
    await page.locator('.fc-zi').first().focus();
    await press('s'); assert.equal(await data(), afterNew, '字卡有焦點時 S 不標記');
    await press('Space'); assert.notEqual(await data(), afterNew, '空白鍵仍啟動焦點上的字卡');
    const marked = await data();
    await page.getByRole('button', { name: '聽一次', exact: true }).click();
    assert.equal(await data(), marked);
    await blur();
    await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
    assert.equal(await counter(), '第 2 張', '按住只前進一張');
    const totalCount = await data();
    await nav('shelf'); await press('ArrowRight'); assert.equal(await data(), totalCount, '隱藏字卡不出題');
    await nav('game'); // 重新進入遊戲首頁；舊字卡 scope 已移除。
    await press('ArrowRight'); assert.equal(await page.locator('.fc-stage').count(), 0);
    await page.getByRole('button', { name: mode === 'char' ? '認字卡' : '詞語卡', exact: true }).click();
    if (mode === 'char') await page.getByRole('button', { name: '直接開始', exact: true }).click();
    await page.locator('.fc-stage').waitFor(); await blur();
    await press('ArrowRight'); assert.equal(await counter(), '第 2 張', '重開字卡不累積監聽');
    await press('Escape'); assert.equal(await page.locator('.fc-stage').count(), 0);
    assert.equal(await page.locator('#page-game.active .game-menu').count(), 1);
    results.push({ mode, cards: 'navigation, counts, speech, focus, repeat, re-entry, Escape' });
  }
  assert.deepEqual(errors, []);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(`${output}/report.json`, JSON.stringify({ passed: true, results, errors }, null, 2));
  console.log(`鍵盤回歸通過：8 組閱讀版面與字／詞卡完整流程；${output}/report.json`);
} finally {
  await browser.close();
}
