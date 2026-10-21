// UI 小工具：DOM 建構、toast、modal、confirm、彩帶
import { t } from './i18n.js';
import { sfx, speakNative } from './sfx.js';
import { icon } from './icons.js';
import { isKid, settings } from './store.js';

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
  if (kid) {
    try { if (warn) sfx.tock(); else sfx.tick(); } catch { /* 音效失敗不影響提示 */ }
    // 小孩還看不懂字：把提示唸出來（設定頁可關）
    if (settings.toastVoice) { try { speakNative(String(msg)); } catch { /* 沒有語音就只看圖示 */ } }
  }
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
    document.removeEventListener('keydown', onKey);
    mask.remove();
    if (onClose) onClose();
  }
  function onKey(e) {
    if (!closable || e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229 ||
        e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.key !== 'Escape') return;
    if (root.lastElementChild !== mask) return; // 只收最上層，不能跳過不可關閉的確認框。
    e.preventDefault();
    sfx.tap();
    close();
  }
  if (closable) {
    head.append(el('button', { class: 'modal-close', 'aria-label': t('close_label'), onclick: () => { sfx.tap(); close(); } }, icon('close')));
  }
  mask.append(modal);
  mask.addEventListener('click', (e) => { if (e.target === mask && closable) close(); });
  root.append(mask);
  document.addEventListener('keydown', onKey);
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
let confettiRun = 0; // 每次呼叫一個世代：新的一場開始，舊的迴圈自己退場（以前共用一個旗標會互相殺）

export function stopConfetti() {
  confettiRun++;
  const canvas = document.getElementById('confetti-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

export function confetti(durationMs = 2200, count = 120, { ribbons = false, ignoreReducedMotion = false } = {}) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  if (!ignoreReducedMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stopConfetti();
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);

  // 繪本慶祝：錯開落下時間，先加速再受空氣阻力緩降，搭配緩慢翻面與側向飄移。
  // 長彩帶只佔 1/12；以經過時間計算，120Hz iPad 也不會加速。
  if (ribbons) {
    const width = innerWidth, height = innerHeight;
    const parts = Array.from({ length: count }, (_, i) => {
      const ribbon = i % 12 === 0;
      return {
        x: Math.random() * width,
        delay: i < 12 ? Math.random() * 0.08 : 0.08 + Math.random() ** 1.3 * 1.55,
        speed: (height + 100) / (2.7 + Math.random() * 1.2),
        drag: 0.3 + Math.random() * 0.4,
        drift: -16 + Math.random() * 32,
        sway: 12 + Math.random() * 23,
        frequency: 1.3 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * (ribbon ? 0.6 : 1.6),
        w: ribbon ? 4 : 6 + Math.random() * 5,
        h: ribbon ? 22 + Math.random() * 14 : 5 + Math.random() * 5,
        ribbon,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      };
    });
    const start = performance.now();
    const myRun = ++confettiRun;
    const frame = (now) => {
      if (myRun !== confettiRun) return;
      const elapsed = now - start;
      ctx2d.clearRect(0, 0, width, height);
      if (elapsed >= durationMs) return;
      const fade = Math.min(1, (durationMs - elapsed) / 900);
      for (const p of parts) {
        const age = elapsed / 1000 - p.delay;
        if (age < 0) continue;
        const settle = 1 - Math.exp(-age / p.drag);
        const y = -8 + p.speed * age - (p.speed - 65) * p.drag * settle;
        if (y > height + 80) continue;
        ctx2d.save();
        const flutter = age * p.frequency + p.phase;
        ctx2d.globalAlpha = fade * Math.min(1, age / 0.12);
        ctx2d.translate(p.x + p.drift * age + (Math.sin(flutter) - Math.sin(p.phase)) * p.sway, y);
        ctx2d.rotate(p.phase + Math.sin(flutter) * 0.65 + p.spin * age);
        ctx2d.scale(0.25 + Math.abs(Math.cos(flutter * 1.6)) * 0.75, 1);
        ctx2d.fillStyle = ctx2d.strokeStyle = p.color;
        if (p.ribbon) {
          ctx2d.lineWidth = p.w;
          ctx2d.lineCap = 'butt';
          ctx2d.beginPath();
          ctx2d.moveTo(0, -p.h / 2);
          const bend = Math.sin(flutter) * 8;
          ctx2d.bezierCurveTo(-bend, -p.h / 4, bend, p.h / 4, 0, p.h / 2);
          ctx2d.stroke();
        } else ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx2d.restore();
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return;
  }

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
  const myRun = ++confettiRun;

  function frame(now) {
    if (myRun !== confettiRun) return;
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
    else ctx2d.clearRect(0, 0, innerWidth, innerHeight);
  }
  requestAnimationFrame(frame);
}
