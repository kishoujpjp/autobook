// 進入點：頁面切換、初始化、PWA 註冊
// v1.26.0：分頁列只有故事／遊戲／跟讀（小孩層）；書架是整頁；家長頁、字表、設定從頭像旁的鎖頭進（家長層）。
import { setLang, t } from './i18n.js';
import { settings, isKid } from './store.js';
import { sfx } from './sfx.js';
import { toast } from './ui.js';
import { icon } from './icons.js';
import { setNavHandler } from './nav.js';
import { initStory, refreshStoryPage, initShelf, refreshShelfPage } from './story.js';
import { initGame, refreshGamePage } from './game.js';
import { initWords, refreshWordsPage } from './words.js';
import { initSettings, refreshSettingsPage } from './settings.js';
import { initRepeat, refreshRepeatPage } from './repeat.js';
import { initParent, refreshParentPage } from './parent.js';
import { initAccountUI, applyRole } from './account.js';
import { maybeOnboard } from './onboarding.js';

setLang(settings.lang);

const pages = {
  story: document.getElementById('page-story'),
  game: document.getElementById('page-game'),
  repeat: document.getElementById('page-repeat'),
  shelf: document.getElementById('page-shelf'),
  parent: document.getElementById('page-parent'),
  words: document.getElementById('page-words'),
  settings: document.getElementById('page-settings'),
};

const refreshers = {
  story: refreshStoryPage,
  game: refreshGamePage,
  repeat: refreshRepeatPage,
  shelf: refreshShelfPage,
  parent: refreshParentPage,
  words: refreshWordsPage,
  settings: refreshSettingsPage,
};

const PARENT_ONLY = new Set(['parent', 'words', 'settings']);
let activePage = 'story';

function showPage(target) {
  if (!pages[target]) return;
  if (PARENT_ONLY.has(target) && isKid()) target = 'story'; // 小孩帳號：程式面也擋
  activePage = target;
  document.querySelectorAll('#tabbar .tab').forEach((x) => {
    const on = x.dataset.page === target;
    x.classList.toggle('active', on);
    x.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  for (const [name, elp] of Object.entries(pages)) {
    elp.classList.toggle('active', name === target);
  }
  try { refreshers[target](); } catch (e) {
    console.error(`refresh ${target} failed`, e);
    if (window.__autobookError) window.__autobookError(e, `refresh:${target}`);
  }
}
setNavHandler(showPage);

document.querySelectorAll('#tabbar .tab').forEach((tab) => {
  tab.querySelector('.tab-icon').replaceChildren(icon(tab.dataset.icon)); // 分頁列圖示（SVG）
  tab.addEventListener('click', () => {
    const target = tab.dataset.page;
    if (target === activePage) return;
    sfx.tap();
    showPage(target);
  });
});

function refreshAll() {
  refreshers[activePage]();
}

// 每個分頁各自初始化：一個分頁的資料壞掉不拖垮其他分頁；錯誤交給救援層（js/rescue.js）處理
const inits = [
  ['story', () => initStory(pages.story)],
  ['shelf', () => initShelf(pages.shelf)],
  ['game', () => initGame(pages.game)],
  ['repeat', () => initRepeat(pages.repeat)],
  ['words', () => initWords(pages.words)],
  ['settings', () => initSettings(pages.settings, refreshAll)],
  ['parent', () => initParent(pages.parent)],
  ['account', () => initAccountUI(() => { applyRole(); refreshAll(); })],
];
for (const [name, fn] of inits) {
  try { fn(); } catch (e) {
    console.error(`init ${name} failed`, e);
    if (window.__autobookError) window.__autobookError(e, `init:${name}`);
  }
}
window.__autobookReady = true; // 之後的錯誤只記錄、不彈救援畫面（見 rescue.js）

// 第一次使用：三步 onboarding（選頭像 → 讀示範書 → 家長設定）
try { maybeOnboard(); } catch (e) { console.error('onboarding failed', e); }

// 存檔失敗（空間滿、私密模式）：提醒去備份，不中斷操作
window.addEventListener('autobook:savefail', () => toast(t('save_fail'), true));

// 阻止 iOS 雙擊縮放與長按選單殘留行為
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => {
  const t = e.target;
  if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') e.preventDefault();
});
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch < 350 && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    e.target.click && e.target.click();
  }
  lastTouch = now;
}, { passive: false });

// PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
