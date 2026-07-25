// 進入點：分頁切換、初始化、PWA 註冊
import { setLang } from './i18n.js';
import { settings } from './store.js';
import { sfx } from './sfx.js';
import { initStory, refreshStoryPage } from './story.js';
import { initGame, refreshGamePage } from './game.js';
import { initWords, refreshWordsPage } from './words.js';
import { initSettings, refreshSettingsPage } from './settings.js';

setLang(settings.lang);

const pages = {
  story: document.getElementById('page-story'),
  game: document.getElementById('page-game'),
  words: document.getElementById('page-words'),
  settings: document.getElementById('page-settings'),
};

const refreshers = {
  story: refreshStoryPage,
  game: refreshGamePage,
  words: refreshWordsPage,
  settings: refreshSettingsPage,
};

let activePage = 'story';

document.querySelectorAll('#tabbar .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.page;
    if (target === activePage) return;
    sfx.tap();
    activePage = target;
    document.querySelectorAll('#tabbar .tab').forEach((x) => x.classList.toggle('active', x === tab));
    for (const [name, elp] of Object.entries(pages)) {
      elp.classList.toggle('active', name === target);
    }
    refreshers[target]();
  });
});

function refreshAll() {
  refreshers[activePage]();
}

initStory(pages.story);
initGame(pages.game);
initWords(pages.words);
initSettings(pages.settings, refreshAll);

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
