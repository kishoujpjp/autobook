// UI 小工具：DOM 建構、toast、modal、confirm、彩帶
import { t } from './i18n.js';
import { sfx } from './sfx.js';
import { icon } from './icons.js';
import { isKid } from './store.js';

/** 全站互動時間常數（毫秒）：雙擊合成、防連點、長按——以前三處各自寫死 */
export const TIMING = Object.freeze({ dblTap: 350, tapGuard: 450, longPress: 500 });

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

/** toast：家長＝文字；小孩帳號＝大圖示＋短音效＋大字（kid 級） */
export function toast(msg, warn = false) {
  const root = document.getElementById('toast-root');
  const kid = isKid();
  const node = el('div', { class: `toast${warn ? ' warn' : ''}${kid ? ' kid' : ''}` },
    (warn || kid) ? icon(warn ? 'warn' : 'check') : null, msg);
  if (kid) { try { if (warn) sfx.tock(); else sfx.tick(); } catch { /* 音效失敗不影響提示 */ } }
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 0.4s, transform 0.4s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-16px)';
    setTimeout(() => node.remove(), 450);
  }, 2600);
}

/** 開啟 modal，回傳 {close, body, foot}；onClose 在關閉時呼叫；icon 是標題前的圖示名（js/icons.js） */
export function openModal(title, { onClose, closable = true, icon: iconName = null } = {}) {
  const root = document.getElementById('modal-root');
  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });
  const head = el('div', { class: 'modal-head' }, el('span', {}, iconName ? icon(iconName) : null, title));
  const mask = el('div', { class: 'modal-mask' });
  const modal = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || undefined }, head, body, foot);

  function close() {
    mask.remove();
    if (onClose) onClose();
  }
  if (closable) {
    head.append(el('button', { class: 'modal-close', 'aria-label': t('close_label'), onclick: () => { sfx.tap(); close(); } }, icon('close')));
  }
  mask.append(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask && closable) close(); });
  root.append(mask);
  return { close, body, foot, head, modal };
}

/** 兒童友善的確認對話框 */
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const m = openModal(t('confirm_title'), { closable: false, icon: 'help' });
    m.body.append(el('p', { text: message, style: 'font-size:24px;font-weight:700;padding:10px 4px 6px;' }));
    m.foot.append(
      el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => { sfx.tap(); m.close(); resolve(false); } }),
      el('button', { class: 'btn berry', text: t('confirm'), onclick: () => { sfx.tap(); m.close(); resolve(true); } }),
    );
  });
}

/** 錯誤／訊息對話框：完整顯示內容，按「好」關閉 */
export function infoDialog(title, message, isError = false) {
  return new Promise((resolve) => {
    const m = openModal(title, { closable: false });
    m.body.append(el('p', {
      text: message,
      style: `font-size:19px;font-weight:600;padding:6px 4px 10px;word-break:break-all;white-space:pre-wrap;${isError ? 'color:var(--danger);' : ''}`,
    }));
    m.foot.append(
      el('button', { class: 'btn', text: t('ok'), onclick: () => { sfx.tap(); m.close(); resolve(); } }),
    );
  });
}

/** 開關（role=switch）：on 是初始狀態，onToggle(next) 回傳 false 可取消切換 */
export function switchEl(on, onToggle, label = '') {
  const sw = el('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label || null });
  sw.addEventListener('click', () => {
    const next = !sw.classList.contains('on');
    if (onToggle && onToggle(next) === false) return;
    sw.classList.toggle('on', next);
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
  });
  return sw;
}

// ---------- 彩帶 ----------
const COLORS = ['#E9631A', '#199E94', '#E64B82', '#2F82D6', '#FFD93D', '#7DC855'];
let confettiRunning = false;

export function confetti(durationMs = 2200, count = 120) {
  const canvas = document.getElementById('confetti-canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);

  const parts = Array.from({ length: count }, () => ({
    x: Math.random() * innerWidth,
    y: -20 - Math.random() * innerHeight * 0.5,
    w: 8 + Math.random() * 8,
    h: 6 + Math.random() * 6,
    vy: 2.5 + Math.random() * 3.5,
    vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI,
    vr: -0.12 + Math.random() * 0.24,
    color: COLORS[(Math.random() * COLORS.length) | 0],
  }));

  const start = performance.now();
  confettiRunning = true;

  function frame(now) {
    if (!confettiRunning) return;
    const elapsed = now - start;
    ctx2d.clearRect(0, 0, innerWidth, innerHeight);
    let alive = false;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      if (p.y < innerHeight + 30) alive = true;
      ctx2d.save();
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rot);
      ctx2d.fillStyle = p.color;
      ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx2d.restore();
    }
    if (alive && elapsed < durationMs + 3000) requestAnimationFrame(frame);
    else { ctx2d.clearRect(0, 0, innerWidth, innerHeight); confettiRunning = false; }
  }
  requestAnimationFrame(frame);
}
