// 全站 SVG 圖示（v1.25.0 設計系統）：48 viewBox、圓頭粗線、currentColor。
// 取代介面上的 emoji；emoji 只留給故事內容與家長端技術 log。
// 用法：icon('trash') → <svg class="ic">…</svg>；el('button', {...}, icon('plus'), ' 新增')
const S = 'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
const S7 = 'fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor"';

export const ICONS = {
  // ---- 導航 ----
  book: `<path d="M24 12 C19 8 12 8 7 10 V38 C12 36 19 36 24 40 C29 36 36 36 41 38 V10 C36 8 29 8 24 12 Z" ${S}/><path d="M24 12 V40" ${S}/>`,
  balloon: `<ellipse cx="24" cy="18" rx="12" ry="14" ${S}/><path d="M24 32 L22 37 H26 L24 32 M24 37 C22 41 26 43 24 46" ${S}/>`,
  mic: `<rect x="18" y="6" width="12" height="22" rx="6" ${F}/><path d="M12 24 a12 12 0 0 0 24 0" ${S}/><path d="M24 36 V42" ${S}/>`,
  cards: `<rect x="6" y="14" width="26" height="28" rx="5" ${S}/><path d="M14 8 H36 A5 5 0 0 1 41 13 V34" ${S}/>`,
  gear: `<circle cx="24" cy="24" r="7" ${S}/><path d="M24 4 V10 M24 38 V44 M4 24 H10 M38 24 H44 M9.9 9.9 L14 14 M34 34 L38.1 38.1 M9.9 38.1 L14 34 M34 14 L38.1 9.9" ${S}/><circle cx="24" cy="24" r="15" ${S}/>`,
  home: `<path d="M8 24 L24 8 L40 24" ${S}/><path d="M14 22 V40 H22 V30 H26 V40 H34 V22" ${S}/>`,
  back: `<path d="M28 10 L14 24 L28 38" ${S7}/>`,
  prev: `<path d="M30 8 L14 24 L30 40" ${S7}/>`,
  next: `<path d="M18 8 L34 24 L18 40" ${S7}/>`,
  up: `<path d="M8 30 L24 14 L40 30" ${S7}/>`,
  down: `<path d="M8 18 L24 34 L40 18" ${S7}/>`,
  close: `<path d="M12 12 L36 36 M36 12 L12 36" ${S7}/>`,
  check: `<path d="M8 25 L19 36 L40 13" ${S7}/>`,
  cross: `<path d="M12 12 L36 36 M36 12 L12 36" ${S7}/>`,
  plus: `<path d="M24 8 V40 M8 24 H40" ${S7}/>`,
  minus: `<path d="M8 24 H40" ${S7}/>`,
  // ---- 媒體 ----
  play: `<path d="M15 8 L38 24 L15 40 Z" ${F} stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>`,
  stop: `<rect x="11" y="11" width="26" height="26" rx="5" ${F}/>`,
  speaker: `<path d="M8 18 H16 L26 10 V38 L16 30 H8 Z" ${F}/><path d="M32 17 a9 9 0 0 1 0 14 M37 12 a15 15 0 0 1 0 24" ${S}/>`,
  mute: `<path d="M8 18 H16 L26 10 V38 L16 30 H8 Z" ${F}/><path d="M32 18 L42 30 M42 18 L32 30" ${S}/>`,
  image: `<rect x="6" y="9" width="36" height="30" rx="5" ${S}/><circle cx="17" cy="19" r="4" ${F}/><path d="M8 35 L19 25 L27 32 L33 27 L41 35" ${S}/>`,
  video: `<rect x="5" y="11" width="28" height="26" rx="5" ${S}/><path d="M33 20 L43 14 V34 L33 28" ${S}/>`,
  camera: `<path d="M6 16 H15 L19 10 H29 L33 16 H42 V38 H6 Z" ${S}/><circle cx="24" cy="27" r="7" ${S}/>`,
  sparkle: `<path d="M24 5 L28 19 L42 24 L28 29 L24 43 L20 29 L6 24 L20 19 Z" ${F}/><path d="M38 6 L39.5 10.5 L44 12 L39.5 13.5 L38 18 L36.5 13.5 L32 12 L36.5 10.5 Z" ${F}/>`,
  star: `<path d="M24 5 L30 17 L43 19 L33.5 28.5 L36 42 L24 35.5 L12 42 L14.5 28.5 L5 19 L18 17 Z" ${F} stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>`,
  starOutline: `<path d="M24 5 L30 17 L43 19 L33.5 28.5 L36 42 L24 35.5 L12 42 L14.5 28.5 L5 19 L18 17 Z" ${S}/>`,
  trophy: `<path d="M14 8 H34 V18 A10 10 0 0 1 14 18 Z" ${F}/><path d="M14 11 H9 A5 5 0 0 0 14 20 M34 11 H39 A5 5 0 0 1 34 20" ${S}/><path d="M22 27 H26 V33 H22 Z M16 35 H32 V40 H16 Z" ${F}/>`,
  refresh: `<path d="M38 20 A15 15 0 1 0 40 32" ${S}/><path d="M40 8 V20 H28 Z" ${F}/>`,
  // ---- 編輯 ----
  edit: `<path d="M9 39 L11 31 L31 11 L37 17 L17 37 Z" ${S}/><path d="M27 15 L33 21" ${S}/>`,
  trash: `<path d="M9 13 H39 M18 13 V9 H30 V13" ${S}/><path d="M13 13 L15 40 H33 L35 13" ${S}/><path d="M20 20 V33 M28 20 V33" ${S}/>`,
  save: `<path d="M24 6 V28 M15 20 L24 29 L33 20" ${S}/><path d="M8 30 V40 H40 V30" ${S}/>`,
  upload: `<path d="M24 30 V8 M15 16 L24 7 L33 16" ${S}/><path d="M8 30 V40 H40 V30" ${S}/>`,
  download: `<path d="M24 8 V30 M15 22 L24 31 L33 22" ${S}/><path d="M8 32 V40 H40 V32" ${S}/>`,
  copy: `<rect x="16" y="14" width="24" height="26" rx="4" ${S}/><path d="M32 14 V10 A2 2 0 0 0 30 8 H10 A2 2 0 0 0 8 10 V30 A2 2 0 0 0 10 32 H14" ${S}/>`,
  link: `<path d="M20 28 L28 20" ${S}/><path d="M17 31 L12 36 A7 7 0 0 1 2 26 L12 16 A7 7 0 0 1 20 18" ${S}/><path d="M31 17 L36 12 A7 7 0 0 1 46 22 L36 32 A7 7 0 0 1 28 30" ${S}/>`,
  tag: `<path d="M6 8 H24 L42 26 L26 42 L8 24 Z" ${S}/><circle cx="16" cy="16" r="3" ${F}/>`,
  folder: `<path d="M6 12 H18 L22 17 H42 V38 H6 Z" ${S}/>`,
  list: `<path d="M14 12 H42 M14 24 H42 M14 36 H42" ${S}/><circle cx="7" cy="12" r="3" ${F}/><circle cx="7" cy="24" r="3" ${F}/><circle cx="7" cy="36" r="3" ${F}/>`,
  search: `<circle cx="21" cy="21" r="12" ${S}/><path d="M30 30 L41 41" ${S7}/>`,
  text: `<path d="M8 12 H40 M24 12 V40 M16 40 H32" ${S}/>`,
  broom: `<path d="M30 6 L18 26" ${S}/><path d="M12 24 L26 30 L22 42 L8 36 Z" ${S}/><path d="M14 30 L12 40 M20 33 L17 42" ${S}/>`,
  dice: `<rect x="8" y="8" width="32" height="32" rx="7" ${S}/><circle cx="17" cy="17" r="3" ${F}/><circle cx="31" cy="17" r="3" ${F}/><circle cx="24" cy="24" r="3" ${F}/><circle cx="17" cy="31" r="3" ${F}/><circle cx="31" cy="31" r="3" ${F}/>`,
  sliders: `<path d="M8 14 H40 M8 24 H40 M8 34 H40" ${S}/><circle cx="18" cy="14" r="4" ${F}/><circle cx="30" cy="24" r="4" ${F}/><circle cx="14" cy="34" r="4" ${F}/>`,
  // ---- 狀態／帳號 ----
  lock: `<rect x="10" y="20" width="28" height="22" rx="5" ${S}/><path d="M16 20 V14 A8 8 0 0 1 32 14 V20" ${S}/><circle cx="24" cy="31" r="3" ${F}/>`,
  unlock: `<rect x="10" y="20" width="28" height="22" rx="5" ${S}/><path d="M16 20 V14 A8 8 0 0 1 31 11" ${S}/><circle cx="24" cy="31" r="3" ${F}/>`,
  key: `<circle cx="16" cy="24" r="9" ${S}/><path d="M25 24 H42 M36 24 V31 M31 24 V29" ${S}/>`,
  keypad: `<circle cx="12" cy="12" r="4" ${F}/><circle cx="24" cy="12" r="4" ${F}/><circle cx="36" cy="12" r="4" ${F}/><circle cx="12" cy="24" r="4" ${F}/><circle cx="24" cy="24" r="4" ${F}/><circle cx="36" cy="24" r="4" ${F}/><circle cx="12" cy="36" r="4" ${F}/><circle cx="24" cy="36" r="4" ${F}/><circle cx="36" cy="36" r="4" ${F}/>`,
  users: `<circle cx="17" cy="16" r="7" ${S}/><path d="M4 40 C4 30 10 27 17 27 C24 27 30 30 30 40" ${S}/><circle cx="33" cy="18" r="5" ${S}/><path d="M34 27 C40 27 44 31 44 39" ${S}/>`,
  user: `<circle cx="24" cy="15" r="9" ${S}/><path d="M6 42 C6 31 14 27 24 27 C34 27 42 31 42 42" ${S}/>`,
  globe: `<circle cx="24" cy="24" r="18" ${S}/><path d="M6 24 H42 M24 6 C17 14 17 34 24 42 M24 6 C31 14 31 34 24 42" ${S}/>`,
  moon: `<path d="M38 30 A16 16 0 1 1 18 10 A12 12 0 0 0 38 30 Z" ${F}/>`,
  sun: `<circle cx="24" cy="24" r="8" ${F}/><path d="M24 4 V9 M24 39 V44 M4 24 H9 M39 24 H44 M10 10 L13.5 13.5 M34.5 34.5 L38 38 M10 38 L13.5 34.5 M34.5 13.5 L38 10" ${S}/>`,
  warn: `<path d="M24 6 L44 40 H4 Z" ${S}/><path d="M24 18 V28" ${S}/><circle cx="24" cy="34" r="2.5" ${F}/>`,
  info: `<circle cx="24" cy="24" r="18" ${S}/><path d="M24 22 V34" ${S}/><circle cx="24" cy="15" r="2.5" ${F}/>`,
  help: `<circle cx="24" cy="24" r="18" ${S}/><path d="M18 18 A6 6 0 1 1 26 24 C24 25 24 27 24 29" ${S}/><circle cx="24" cy="35" r="2.5" ${F}/>`,
  eye: `<path d="M4 24 C10 14 18 10 24 10 C30 10 38 14 44 24 C38 34 30 38 24 38 C18 38 10 34 4 24 Z" ${S}/><circle cx="24" cy="24" r="6" ${F}/>`,
  ear: `<path d="M14 20 A10 10 0 0 1 34 20 C34 28 26 28 26 34 A5 5 0 0 1 16 34" ${S}/><path d="M20 20 A4 4 0 0 1 28 20 C28 24 24 24 24 28" ${S}/>`,
  hand: `<path d="M18 40 L10 26 A3 3 0 0 1 15 23 L19 28 V9 A3 3 0 0 1 25 9 V22 M25 14 A3 3 0 0 1 31 14 V24 M31 17 A3 3 0 0 1 37 17 V30 C37 37 32 42 26 42 H22 C20 42 19 41 18 40 Z" ${S}/>`,
  fire: `<path d="M24 5 C26 14 34 16 34 27 A10 10 0 0 1 14 27 C14 22 17 19 19 17 C19 22 22 23 23 22 C23 16 22 10 24 5 Z" ${S}/>`,
  leaf: `<path d="M8 40 C8 20 22 8 42 8 C42 28 30 42 10 40 Z" ${S}/><path d="M10 38 C18 30 24 24 32 16" ${S}/>`,
  radio: `<circle cx="24" cy="36" r="4" ${F}/><path d="M15 27 A13 13 0 0 1 33 27 M8 20 A22 22 0 0 1 40 20" ${S}/>`,
  clock: `<circle cx="24" cy="24" r="18" ${S}/><path d="M24 12 V24 L32 29" ${S}/>`,
  package: `<path d="M24 5 L42 14 V34 L24 43 L6 34 V14 Z" ${S}/><path d="M6 14 L24 23 L42 14 M24 23 V43" ${S}/>`,
  rocket: `<path d="M24 5 C31 10 33 20 30 32 H18 C15 20 17 10 24 5 Z" ${S}/><circle cx="24" cy="19" r="3.5" ${F}/><path d="M18 26 L10 32 L16 34 M30 26 L38 32 L32 34 M20 36 L24 43 L28 36" ${S}/>`,
  target: `<circle cx="24" cy="24" r="18" ${S}/><circle cx="24" cy="24" r="10" ${S}/><circle cx="24" cy="24" r="3" ${F}/>`,
  puzzle: `<path d="M10 14 H19 A5 5 0 0 1 29 14 H38 V23 A5 5 0 0 1 38 33 V42 H29 A5 5 0 0 0 19 42 H10 V33 A5 5 0 0 0 10 23 Z" ${S}/>`,
  fox: `<path d="M8 8 L18 16 H30 L40 8 L38 26 C38 36 31 42 24 42 C17 42 10 36 10 26 Z" ${S}/><circle cx="18" cy="24" r="2.5" ${F}/><circle cx="30" cy="24" r="2.5" ${F}/><path d="M21 32 L24 34 L27 32" ${S}/>`,
  clipboard: `<rect x="10" y="10" width="28" height="32" rx="4" ${S}/><path d="M18 10 V6 H30 V10" ${S}/><path d="M17 22 H31 M17 30 H27" ${S}/>`,
  chat: `<path d="M8 10 H40 V32 H22 L12 40 V32 H8 Z" ${S}/>`,
  arrowRight: `<path d="M8 24 H38 M26 12 L38 24 L26 36" ${S7}/>`,
  stethoscope: `<path d="M12 6 V18 A8 8 0 0 0 28 18 V6" ${S}/><path d="M20 26 V32 A8 8 0 0 0 36 32 V27" ${S}/><circle cx="36" cy="22" r="4" ${S}/>`,
  wand: `<path d="M8 40 L30 18" ${S7}/><path d="M34 6 L36 11 L41 13 L36 15 L34 20 L32 15 L27 13 L32 11 Z" ${F}/><path d="M40 24 L41 27 L44 28 L41 29 L40 32 L39 29 L36 28 L39 27 Z" ${F}/>`,
  smile: `<circle cx="24" cy="24" r="18" ${S}/><circle cx="17" cy="20" r="2.5" ${F}/><circle cx="31" cy="20" r="2.5" ${F}/><path d="M15 29 C19 34 29 34 33 29" ${S}/>`,
  sad: `<circle cx="24" cy="24" r="18" ${S}/><circle cx="17" cy="20" r="2.5" ${F}/><circle cx="31" cy="20" r="2.5" ${F}/><path d="M15 33 C19 28 29 28 33 33" ${S}/>`,
  rainbow: `<path d="M6 36 A18 18 0 0 1 42 36 M13 36 A11 11 0 0 1 35 36" ${S}/>`,
  palette: `<path d="M24 6 A18 18 0 1 0 24 42 C28 42 28 37 26 35 C24 32 28 30 32 30 C38 30 42 28 42 24 A18 18 0 0 0 24 6 Z" ${S}/><circle cx="15" cy="22" r="3" ${F}/><circle cx="22" cy="14" r="3" ${F}/><circle cx="32" cy="16" r="3" ${F}/>`,
  fairy: `<path d="M24 5 L27 15 L37 18 L27 21 L24 31 L21 21 L11 18 L21 15 Z" ${F}/><path d="M24 31 V43 M17 43 H31" ${S}/>`,
};

const NS = 'http://www.w3.org/2000/svg';

/** 回傳一個 <svg class="ic ic-name"> 元素（內容為靜態字串，無使用者輸入） */
export function icon(name, cls = '') {
  const body = ICONS[name];
  if (!body) throw new Error(`unknown icon: ${name}`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `ic ic-${name}${cls ? ` ${cls}` : ''}`);
  svg.innerHTML = body;
  return svg;
}

/** 圖示的 HTML 字串（給 innerHTML 組合用） */
export function iconHTML(name, cls = '') {
  const body = ICONS[name];
  if (!body) throw new Error(`unknown icon: ${name}`);
  return `<svg class="ic ic-${name}${cls ? ` ${cls}` : ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false" xmlns="${NS}">${body}</svg>`;
}
