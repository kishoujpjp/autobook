// 共用等待場景（v1.26.0）：角色插畫＋三段進度（例如 寫故事 ▸ 畫圖 ▸ 好了）＋「通常要 1 分鐘」＋停止鈕。
// 技術 log 收在摺疊區，只有家長帳號看得到；小孩看到的只有角色、進度與停止。
// 取代原本各自長不一樣的等待畫面（跳動小精靈＋log、AI 光環、prep-bar）。
import { t } from './i18n.js';
import { el, openModal } from './ui.js';
import { icon } from './icons.js';
import { sfx } from './sfx.js';
import { isKid } from './store.js';

/**
 * @param {object} o
 * @param {string[]} o.steps   階段名稱（2～4 段），最後一段通常是「好了」
 * @param {string} [o.iconName='fairy'] 角色圖示
 * @param {string} [o.hint]    預估時間提示，例如 t('wait_hint_minute')
 * @param {function} [o.onStop] 有給就顯示停止鈕
 * @param {boolean} [o.progress=false] 顯示進度條（setProgress 才有東西動）
 * @returns {{ setStep, setMsg, setProgress, log, fail, close, modal }}
 */
export function waitScene({ steps, iconName = 'fairy', hint = '', onStop = null, progress = false }) {
  const m = openModal('', { closable: false });
  const figure = el('span', { class: 'wait-figure' }, icon(iconName));
  const msg = el('p', { class: 'wait-msg', text: steps[0] || '' });
  const stepEls = steps.map((label, i) => el('span', { class: `wait-step${i === 0 ? ' active' : ''}` },
    el('i', { class: 'wait-dot' }), label));
  const stepsRow = el('div', { class: 'wait-steps', role: 'list' }, ...stepEls);
  const fill = el('div', { class: 'prep-fill' });
  const bar = progress ? el('div', { class: 'prep-bar' }, fill) : null;
  const hintEl = hint ? el('p', { class: 'wait-hint', text: hint }) : null;

  // 技術紀錄：家長才看得到，預設摺疊
  const logBox = el('div', { class: 'gen-log' });
  const logWrap = isKid() ? null : el('details', { class: 'adv wait-log' },
    el('summary', { text: t('wait_log') }), logBox);

  m.body.append(el('div', { class: 'wait-scene' }, figure, msg, stepsRow, bar, hintEl), logWrap);

  let stopBtn = null;
  if (onStop) {
    stopBtn = el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); stopBtn.disabled = true; onStop(); } },
      icon('stop'), t('gen_stop'));
    m.foot.append(stopBtn);
  }

  function setStep(i, text = null) {
    stepEls.forEach((s, k) => {
      s.classList.toggle('done', k < i);
      s.classList.toggle('active', k === i);
    });
    msg.textContent = text || steps[i] || '';
    if (i >= steps.length - 1) figure.classList.add('done');
  }
  function setMsg(text) { msg.textContent = text; }
  function setProgress(ratio) { fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`; }
  function log(line) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    logBox.append(el('div', { class: 'gen-log-line', text: `${hh}:${mm}:${ss} ${line}` }));
    logBox.scrollTop = logBox.scrollHeight;
  }
  /** 失敗：換成難過的角色、留著視窗與 log，按「好」才關 */
  function fail(text) {
    figure.replaceChildren(icon('sad'));
    figure.classList.add('fail');
    msg.textContent = text;
    if (stopBtn) stopBtn.remove();
    if (logWrap) logWrap.open = true;
    m.foot.append(el('button', { class: 'btn', text: t('ok'), onclick: () => { sfx.tap(); m.close(); } }));
  }
  return { setStep, setMsg, setProgress, log, fail, close: m.close, modal: m };
}
