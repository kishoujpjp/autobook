// 只處理目前頁面的快捷鍵；重繪時替換動作，不累積 document 監聽。
const bindings = new WeakMap();
let listening = false;

export function bindPageKeys(root, actions, scope = root) {
  bindings.set(root, { actions, scope });
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const page = document.querySelector('.page.active');
    const binding = bindings.get(page);
    if (!binding || !binding.scope.isConnected || !page.contains(binding.scope)) return;
    // 對話框／揭曉舞台擁有自己的操作；不能穿透到下面的故事或字卡。
    if (document.querySelector('#modal-root .modal-mask') || page.querySelector('.reveal-stage')) return;
    const target = event.target;
    if (target.isContentEditable || target.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
      '[role="slider"], [role="spinbutton"], [role="combobox"], [role="listbox"], ' +
      '[role="menu"], [role="tablist"], audio, video',
    )) return;
    // 空白鍵保留按鈕、連結的原生啟動行為；S 可在字卡按鈕有焦點時只發音。
    if (event.key === ' ' && target.closest?.('button, a[href], summary, [role="button"], [role="switch"]')) return;
    const name = {
      ArrowLeft: 'prev', PageUp: 'prev',
      ArrowRight: 'next', PageDown: 'next',
      Home: 'first', End: 'last', Escape: 'exit',
      ' ': 'speak', s: 'speak', S: 'speak',
    }[event.key];
    const action = binding.actions[name];
    if (!action) return;
    event.preventDefault();
    // 按住不連翻、不重播，並阻止瀏覽器在重複按鍵時捲動。
    if (!event.repeat) action();
  });
}
