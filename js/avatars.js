// 內建自繪向量頭像（10 個小動物）＋頭像渲染工具
import { el } from './ui.js';
import { idbGet } from './store.js';

const S = (body, bg) =>
  `<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">` +
  `<circle cx="48" cy="48" r="48" fill="${bg}"/>` + body + `</svg>`;

// 共用五官
const eyes = (dx = 13, y = 46, r = 4.5) =>
  `<circle cx="${48 - dx}" cy="${y}" r="${r}" fill="#3A2E20"/><circle cx="${48 + dx}" cy="${y}" r="${r}" fill="#3A2E20"/>` +
  `<circle cx="${48 - dx + 1.5}" cy="${y - 1.5}" r="1.4" fill="#fff"/><circle cx="${48 + dx + 1.5}" cy="${y - 1.5}" r="1.4" fill="#fff"/>`;
const smile = (y = 58, w = 7) =>
  `<path d="M${48 - w} ${y} Q48 ${y + 7} ${48 + w} ${y}" stroke="#3A2E20" stroke-width="3" fill="none" stroke-linecap="round"/>`;
const blush = (y = 55) =>
  `<circle cx="26" cy="${y}" r="5.5" fill="#FF9DB5" opacity="0.55"/><circle cx="70" cy="${y}" r="5.5" fill="#FF9DB5" opacity="0.55"/>`;

export const PRESETS = [
  { id: 'cat', svg: S(
    `<path d="M20 34 L14 12 L36 22 Z" fill="#F7A76C"/><path d="M76 34 L82 12 L60 22 Z" fill="#F7A76C"/>` +
    `<path d="M22 32 L18 18 L32 24 Z" fill="#FFD9B8"/><path d="M74 32 L78 18 L64 24 Z" fill="#FFD9B8"/>` +
    `<circle cx="48" cy="52" r="30" fill="#F7A76C"/><ellipse cx="48" cy="60" rx="16" ry="12" fill="#FFEFD9"/>` +
    eyes(13, 48) + `<path d="M45 57 L51 57 L48 61 Z" fill="#E9538A"/>` + smile(62, 6) +
    `<path d="M14 52 L28 54 M14 60 L28 59" stroke="#D98B4F" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M82 52 L68 54 M82 60 L68 59" stroke="#D98B4F" stroke-width="2.4" stroke-linecap="round"/>`,
    '#FFE3C2') },
  { id: 'dog', svg: S(
    `<ellipse cx="20" cy="38" rx="10" ry="16" fill="#B98A5E" transform="rotate(18 20 38)"/>` +
    `<ellipse cx="76" cy="38" rx="10" ry="16" fill="#B98A5E" transform="rotate(-18 76 38)"/>` +
    `<circle cx="48" cy="52" r="30" fill="#E4BE93"/><ellipse cx="48" cy="62" rx="15" ry="11" fill="#FFF3E2"/>` +
    eyes(13, 48) + `<ellipse cx="48" cy="58" rx="5" ry="4" fill="#3A2E20"/>` + smile(64, 6) + blush(58),
    '#DDF1FF') },
  { id: 'rabbit', svg: S(
    `<ellipse cx="38" cy="18" rx="8" ry="20" fill="#FFF"/><ellipse cx="58" cy="18" rx="8" ry="20" fill="#FFF"/>` +
    `<ellipse cx="38" cy="19" rx="4" ry="14" fill="#FFCFDD"/><ellipse cx="58" cy="19" rx="4" ry="14" fill="#FFCFDD"/>` +
    `<circle cx="48" cy="54" r="28" fill="#FFF"/>` + eyes(12, 50) +
    `<ellipse cx="48" cy="59" rx="4" ry="3" fill="#FF8FAF"/>` + smile(64, 5) + blush(60),
    '#FFE8F0') },
  { id: 'bear', svg: S(
    `<circle cx="24" cy="26" r="11" fill="#A9805C"/><circle cx="72" cy="26" r="11" fill="#A9805C"/>` +
    `<circle cx="24" cy="26" r="5.5" fill="#D8B592"/><circle cx="72" cy="26" r="5.5" fill="#D8B592"/>` +
    `<circle cx="48" cy="52" r="30" fill="#C49A70"/><ellipse cx="48" cy="61" rx="15" ry="11" fill="#EED9BE"/>` +
    eyes(13, 48) + `<ellipse cx="48" cy="58" rx="5" ry="4" fill="#3A2E20"/>` + smile(64, 6),
    '#FFF0CE') },
  { id: 'panda', svg: S(
    `<circle cx="24" cy="26" r="11" fill="#3A3A3A"/><circle cx="72" cy="26" r="11" fill="#3A3A3A"/>` +
    `<circle cx="48" cy="52" r="30" fill="#FFF"/>` +
    `<ellipse cx="35" cy="47" rx="8" ry="10" fill="#3A3A3A" transform="rotate(-12 35 47)"/>` +
    `<ellipse cx="61" cy="47" rx="8" ry="10" fill="#3A3A3A" transform="rotate(12 61 47)"/>` +
    `<circle cx="35" cy="48" r="3.4" fill="#fff"/><circle cx="61" cy="48" r="3.4" fill="#fff"/>` +
    `<circle cx="35" cy="48" r="1.8" fill="#3A2E20"/><circle cx="61" cy="48" r="1.8" fill="#3A2E20"/>` +
    `<ellipse cx="48" cy="60" rx="4.5" ry="3.5" fill="#3A3A3A"/>` + smile(65, 5),
    '#E1F5DC') },
  { id: 'fox', svg: S(
    `<path d="M18 40 L10 10 L40 24 Z" fill="#F08C4A"/><path d="M78 40 L86 10 L56 24 Z" fill="#F08C4A"/>` +
    `<path d="M20 36 L15 17 L34 26 Z" fill="#FFF"/><path d="M76 36 L81 17 L62 26 Z" fill="#FFF"/>` +
    `<circle cx="48" cy="52" r="30" fill="#F08C4A"/>` +
    `<path d="M48 82 Q26 78 22 58 Q34 66 48 66 Q62 66 74 58 Q70 78 48 82" fill="#FFF"/>` +
    eyes(14, 47) + `<path d="M44 60 L52 60 L48 65 Z" fill="#3A2E20"/>`,
    '#FFE9D2') },
  { id: 'frog', svg: S(
    `<circle cx="30" cy="24" r="12" fill="#8CCB5E"/><circle cx="66" cy="24" r="12" fill="#8CCB5E"/>` +
    `<circle cx="30" cy="24" r="6" fill="#FFF"/><circle cx="66" cy="24" r="6" fill="#FFF"/>` +
    `<circle cx="30" cy="24" r="3" fill="#3A2E20"/><circle cx="66" cy="24" r="3" fill="#3A2E20"/>` +
    `<circle cx="48" cy="54" r="28" fill="#8CCB5E"/>` + smile(56, 10) + blush(58),
    '#E9F9D0') },
  { id: 'chick', svg: S(
    `<circle cx="48" cy="52" r="28" fill="#FFDE59"/>` +
    `<path d="M42 24 Q48 14 54 24 Q51 20 48 21 Q45 20 42 24" fill="#F5A623"/>` +
    eyes(11, 48, 4) + `<path d="M44 57 L52 57 L48 63 Z" fill="#F5A623"/>` + blush(58),
    '#FFF6D6') },
  { id: 'penguin', svg: S(
    `<circle cx="48" cy="52" r="30" fill="#3E4A5A"/>` +
    `<ellipse cx="48" cy="60" rx="18" ry="16" fill="#FFF"/>` +
    eyes(13, 46) + `<path d="M43 55 L53 55 L48 62 Z" fill="#F5A623"/>` + blush(60),
    '#D6ECFF') },
  { id: 'pig', svg: S(
    `<circle cx="22" cy="30" r="9" fill="#F5A9C0"/><circle cx="74" cy="30" r="9" fill="#F5A9C0"/>` +
    `<circle cx="48" cy="52" r="30" fill="#FBC4D4"/>` + eyes(14, 46) +
    `<ellipse cx="48" cy="58" rx="9" ry="7" fill="#F08CAC"/>` +
    `<circle cx="44.5" cy="58" r="2" fill="#B04A6E"/><circle cx="51.5" cy="58" r="2" fill="#B04A6E"/>` + smile(69, 5),
    '#FFE4EC') },
];

export function presetSvg(id) {
  const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
  return p.svg;
}

/** 帳號頭像元素（image 類型會非同步載入，載不到退回預設圖） */
export function avatarEl(account, cls = 'avatar') {
  const node = el('span', { class: cls });
  if (!account) { node.innerHTML = presetSvg('bear'); return node; }
  if (account.avatar && account.avatar.kind === 'image') {
    node.innerHTML = presetSvg(account.avatar.fallback || 'bear');
    idbGet('avatars', account.id).then((blob) => {
      if (!blob) return;
      const img = new Image();
      // 解碼完立刻釋放 blob URL（每次 render 都會建一個，不釋放會越用越肥）
      img.onload = () => { node.innerHTML = ''; node.append(img); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(blob);
    }).catch(() => {});
  } else {
    node.innerHTML = presetSvg(account.avatar ? account.avatar.preset : 'bear');
  }
  return node;
}
