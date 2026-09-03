// 夜間模式：在 CSS 套用前就把 data-theme 寫到 <html>，不會先閃一下亮底。
// 設定存在 autobook.settings.theme（'light' | 'dark'）；壞資料交給 rescue.js，這裡只安靜略過。
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('autobook.settings') || '{}');
    if (s && s.theme === 'dark') document.documentElement.dataset.theme = 'dark';
  } catch (e) { /* ignore */ }
})();
