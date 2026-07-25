// UI 小工具：DOM 建構、toast、modal、confirm、彩帶
import { t } from './i18n.js';
import { sfx } from './sfx.js';

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

export function toast(msg, warn = false) {
  const root = document.getElementById('toast-root');
  const node = el('div', { class: `toast${warn ? ' warn' : ''}`, text: msg });
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 0.4s, transform 0.4s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-16px)';
    setTimeout(() => node.remove(), 450);
  }, 2600);
}

/** 開啟 modal，回傳 {close, body, foot}；onClose 在關閉時呼叫 */
export function openModal(title, { onClose, closable = true } = {}) {
  const root = document.getElementById('modal-root');
  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });
  const head = el('div', { class: 'modal-head' }, el('span', { text: title }));
  const mask = el('div', { class: 'modal-mask' });
  const modal = el('div', { class: 'modal' }, head, body, foot);

  function close() {
    mask.remove();
    if (onClose) onClose();
  }
  if (closable) {
    head.append(el('button', { class: 'modal-close', text: '✕', onclick: () => { sfx.tap(); close(); } }));
  }
  mask.append(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask && closable) close(); });
  root.append(mask);
  return { close, body, foot, head, modal };
}

/** 兒童友善的確認對話框 */
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const m = openModal('🤔', { closable: false });
    m.body.append(el('p', { text: message, style: 'font-size:24px;font-weight:700;padding:10px 4px 6px;' }));
    m.foot.append(
      el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => { sfx.tap(); m.close(); resolve(false); } }),
      el('button', { class: 'btn berry', text: t('confirm'), onclick: () => { sfx.tap(); m.close(); resolve(true); } }),
    );
  });
}

// ---------- 彩帶 ----------
const COLORS = ['#FF8A3D', '#4ECDC4', '#FF6B9D', '#5AA9F9', '#FFD93D', '#7DC855'];
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
