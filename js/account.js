// 帳號：右上角頭像鈕、切換帳號、家長確認（算術門）、帳號編輯器
// 小孩帳號看不到「設定」分頁（字表看得到，但固定鎖定只能點字發音）；
// 小孩切到家長帳號要先過家長確認。
import { t } from './i18n.js';
import { el, toast, openModal, confirmDialog } from './ui.js';
import { sfx } from './sfx.js';
import {
  accounts, saveAccounts, currentAccount, setCurrentAccount,
  removeAccount, parentCount, idbSet, idbDel, settings, saveSettings,
} from './store.js';
import { PRESETS, avatarEl } from './avatars.js';

let avatarBtn = null;
let onAccountChange = null; // main.js 提供：套用權限＋刷新頁面

export function initAccountUI(changeCb) {
  onAccountChange = changeCb;
  avatarBtn = el('button', { id: 'avatar-btn', 'aria-label': 'account' });
  avatarBtn.addEventListener('click', () => { sfx.tap(); openSwitchModal(); });
  document.body.append(avatarBtn);
  refreshAvatarBtn();
  applyRole();
}

export function refreshAvatarBtn() {
  if (!avatarBtn) return;
  avatarBtn.innerHTML = '';
  avatarBtn.append(avatarEl(currentAccount()));
}

/** 依目前帳號套用分頁權限（字表小孩也能看，words.js 內自行鎖定） */
export function applyRole() {
  const kid = currentAccount().role === 'kid';
  for (const name of ['settings']) {
    const tab = document.querySelector(`#tabbar .tab[data-page="${name}"]`);
    if (tab) tab.style.display = kid ? 'none' : '';
    if (kid) {
      const page = document.getElementById(`page-${name}`);
      if (page && page.classList.contains('active')) {
        document.querySelector('#tabbar .tab[data-page="story"]').click();
      }
    }
  }
}

// ---------- 切換帳號 ----------
function openSwitchModal() {
  const m = openModal(`👨‍👩‍👧 ${t('acc_switch')}`);
  const grid = el('div', { class: 'switch-grid' });
  for (const a of accounts) {
    const item = el('button', { class: `switch-item${a.id === currentAccount().id ? ' current' : ''}` },
      avatarEl(a, 'avatar acct-avatar'),
      el('span', { text: a.name }),
      el('span', { class: `role-chip${a.role === 'kid' ? ' kid' : ''}`, text: t(a.role === 'kid' ? 'acc_kid' : 'acc_parent') }),
    );
    item.addEventListener('click', async () => {
      sfx.tap();
      if (a.id === currentAccount().id) { m.close(); return; }
      if (a.role === 'parent' && currentAccount().role === 'kid') {
        m.close();
        const ok = await parentGate();
        if (!ok) return;
      } else {
        m.close();
      }
      setCurrentAccount(a.id);
      sfx.sparkle();
      refreshAvatarBtn();
      if (onAccountChange) onAccountChange();
    });
    grid.append(item);
  }
  m.body.append(grid);
}

// ---------- 家長確認（PIN 或算術門） ----------
// settings.parentGateOn 關掉＝不確認直接切。開著時：有設 PIN 用 PIN，沒有就用個位數算術題。
// 通過後 5 分鐘內不再問（家長來回切換不用一直輸入）。
// PIN 錯 3 次鎖 30 秒，之後每多錯一次鎖的時間加倍（鎖定狀態寫在 localStorage，重開 App 也還在）。
const GATE_OK_MS = 5 * 60 * 1000;
const LOCK_KEY = 'autobook.gateLock';
let gateOkUntil = 0;

function lockState() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null') || { fails: 0, until: 0 }; }
  catch { return { fails: 0, until: 0 }; }
}
function saveLock(s) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

export function parentGate() {
  if (!settings.parentGateOn) return Promise.resolve(true);
  if (Date.now() < gateOkUntil) return Promise.resolve(true);
  const p = settings.parentPin ? pinGate() : mathGate();
  return p.then((ok) => { if (ok) gateOkUntil = Date.now() + GATE_OK_MS; return ok; });
}

/**
 * 4 位數字鍵盤面板。resolve 輸入完成的字串；關掉面板 resolve null。
 * check(code) 可選：回 false 表示錯誤（面板留著、清空重來），回 true 才 resolve。
 */
function pinPad(title, check = null, onWrong = null) {
  return new Promise((resolve) => {
    let code = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal(`🔒 ${title}`, { onClose: () => done(null) });
    const dots = el('div', { class: 'pin-dots' }, ...[0, 1, 2, 3].map(() => el('span', { class: 'pin-dot' })));
    const pad = el('div', { class: 'pin-pad' });
    const refresh = () => {
      [...dots.children].forEach((d, i) => d.classList.toggle('on', i < code.length));
    };
    const push = (d) => {
      if (code.length >= 4) return;
      sfx.tap();
      code += d;
      refresh();
      if (code.length === 4) {
        if (!check || check(code)) { done(code); m.close(); return; }
        sfx.wrong();
        dots.classList.remove('shake');
        void dots.offsetWidth;
        dots.classList.add('shake');
        code = '';
        setTimeout(refresh, 350);
        if (onWrong && onWrong() === false) { done(null); m.close(); }
      }
    };
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      pad.append(el('button', { class: 'pin-key', text: d, onclick: () => push(d) }));
    }
    pad.append(
      el('span'),
      el('button', { class: 'pin-key', text: '0', onclick: () => push('0') }),
      el('button', { class: 'pin-key soft', text: '⌫', onclick: () => { sfx.tap(); code = code.slice(0, -1); refresh(); } }),
    );
    m.body.append(dots, pad);
  });
}

function pinGate() {
  const lk = lockState();
  if (lk.until > Date.now()) {
    toast(t('pin_locked', { s: Math.ceil((lk.until - Date.now()) / 1000) }), true);
    return Promise.resolve(false);
  }
  let fails = lk.fails || 0;
  return pinPad(t('pin_title'), (code) => code === settings.parentPin, () => {
    fails++;
    if (fails >= 3) {
      const secs = 30 * Math.pow(2, fails - 3);
      saveLock({ fails, until: Date.now() + secs * 1000 });
      toast(t('pin_locked', { s: secs }), true);
      return false; // 關掉面板
    }
    saveLock({ fails, until: 0 });
    toast(t('pin_wrong'), true);
    return true;
  }).then((code) => {
    const ok = code !== null;
    if (ok) saveLock({ fails: 0, until: 0 });
    return ok;
  });
}

/** 設定頁：設定／更改 PIN（輸入兩次要一樣） */
export async function openPinSetup() {
  const first = await pinPad(t('pin_new'));
  if (!first) return false;
  const again = await pinPad(t('pin_again'));
  if (!again) return false;
  if (first !== again) { toast(t('pin_mismatch'), true); return false; }
  settings.parentPin = first;
  saveSettings();
  saveLock({ fails: 0, until: 0 });
  sfx.sparkle();
  toast(t('pin_saved'));
  return true;
}

export function clearPin() {
  settings.parentPin = '';
  saveSettings();
  saveLock({ fails: 0, until: 0 });
  toast(t('pin_cleared'));
}

function mathGate() {
  return new Promise((resolve) => {
    // 個位數加減，4 個選項（3 個時幼兒亂按兩次就有近九成機會過）
    let a = 2 + ((Math.random() * 8) | 0);
    let b = 1 + ((Math.random() * 9) | 0);
    const minus = Math.random() < 0.5;
    if (minus && b > a) [a, b] = [b, a];
    const answer = minus ? a - b : a + b;
    const q = `${a} ${minus ? '−' : '+'} ${b}`;
    const opts = new Set([answer]);
    while (opts.size < 4) {
      const n = answer + ((Math.random() * 9) | 0) - 4;
      if (n >= 0 && n !== answer) opts.add(n);
    }
    const shuffled = [...opts].sort(() => Math.random() - 0.5);

    let settled = false;
    const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
    const m = openModal(`🔒 ${t('acc_gate')}`, { onClose: () => done(false) });
    let tries = 0;
    m.body.append(
      el('p', { style: 'font-size:30px;font-weight:800;text-align:center;padding:8px 0 18px;', text: `${t('acc_gate_q')}：${q} = ?` }),
      el('div', { class: 'gate-opts' },
        shuffled.map((n) => {
          const btn = el('button', { class: 'btn sky', text: String(n) });
          btn.addEventListener('click', () => {
            if (n === answer) { sfx.correct(); done(true); m.close(); }
            else {
              sfx.wrong();
              tries++;
              btn.disabled = true;
              if (tries >= 2) { done(false); m.close(); }
              else toast(t('acc_gate_wrong'), true);
            }
          });
          return btn;
        }),
      ),
    );
  });
}

// ---------- 新增／編輯帳號（設定頁呼叫） ----------
export function openAccountEditor(existing, onDone) {
  const m = openModal(existing ? `✏️ ${t('acc_edit')}` : `➕ ${t('acc_add')}`);

  const nameInput = el('input', {
    class: 'text-input', placeholder: t('acc_name_ph'),
    value: existing ? existing.name : '', maxlength: '12',
  });

  let role = existing ? existing.role : 'kid';
  const roleSeg = el('div', { class: 'seg' });
  function roleBtn(r, label) {
    const btn = el('button', { class: role === r ? 'on' : '', text: label });
    btn.addEventListener('click', () => {
      sfx.tap();
      role = r;
      [...roleSeg.children].forEach((c) => c.classList.remove('on'));
      btn.classList.add('on');
    });
    return btn;
  }
  roleSeg.append(roleBtn('kid', t('acc_kid')), roleBtn('parent', t('acc_parent')));

  // 頭像選擇：預設向量圖 + 上傳
  let avatar = existing ? { ...existing.avatar } : { kind: 'preset', preset: PRESETS[(Math.random() * PRESETS.length) | 0].id };
  let uploadBlob = null; // 新上傳待存
  const grid = el('div', { class: 'preset-grid' });

  const uploadPreview = el('span', { class: 'avatar' });
  function refreshGrid() {
    [...grid.querySelectorAll('.preset-pick')].forEach((p) => {
      p.classList.toggle('on',
        (avatar.kind === 'preset' && p.dataset.preset === avatar.preset) ||
        (avatar.kind === 'image' && p.dataset.preset === '__upload__'));
    });
  }

  for (const p of PRESETS) {
    const pick = el('button', { class: 'preset-pick', 'data-preset': p.id });
    pick.innerHTML = p.svg;
    pick.addEventListener('click', () => {
      sfx.tap();
      avatar = { kind: 'preset', preset: p.id };
      uploadBlob = null;
      refreshGrid();
    });
    grid.append(pick);
  }

  // 上傳格
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none;' });
  const uploadPick = el('button', { class: 'preset-pick upload', 'data-preset': '__upload__' }, uploadPreview);
  uploadPreview.innerHTML = '<div style="font-size:30px;display:flex;align-items:center;justify-content:center;width:100%;height:100%;">📷</div>';
  if (existing && existing.avatar.kind === 'image') {
    const tmp = avatarEl(existing, 'avatar');
    uploadPreview.replaceWith(tmp);
  }
  uploadPick.addEventListener('click', () => { sfx.tap(); fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      uploadBlob = await downscale(file, 256);
      avatar = { kind: 'image', fallback: 'bear' };
      const img = el('img', { alt: '' });
      img.onload = () => URL.revokeObjectURL(img.src);
      img.src = URL.createObjectURL(uploadBlob);
      uploadPick.innerHTML = '';
      uploadPick.append(el('span', { class: 'avatar' }, img));
      refreshGrid();
    } catch (e) {
      console.warn(e);
      toast(t('acc_img_fail'), true);
    }
  });
  grid.append(uploadPick);
  refreshGrid();

  m.body.append(
    el('div', { class: 'field-label', text: t('acc_name') }), nameInput,
    el('div', { class: 'field-label', text: t('acc_role') }), roleSeg,
    el('div', { class: 'field-label', text: t('acc_avatar') }), grid,
    fileInput,
  );

  // 刪除（不能刪掉最後一個家長）
  if (existing) {
    const delBtn = el('button', { class: 'btn ghost small' }, '🗑 ', t('acc_delete'));
    delBtn.addEventListener('click', async () => {
      sfx.tap();
      if (existing.role === 'parent' && parentCount() <= 1) {
        toast(t('acc_last_parent'), true);
        return;
      }
      const yes = await confirmDialog(t('acc_del_confirm', { n: existing.name }));
      if (yes) {
        await removeAccount(existing.id);
        m.close();
        refreshAvatarBtn();
        if (onAccountChange) onAccountChange();
        if (onDone) onDone();
      }
    });
    m.foot.append(delBtn);
  }

  const saveBtn = el('button', { class: 'btn mint' }, '💾 ', t('acc_save'));
  saveBtn.addEventListener('click', async () => {
    sfx.tap();
    const name = nameInput.value.trim();
    if (!name) { toast(t('acc_need_name'), true); return; }
    // 降級最後一個家長也不行
    if (existing && existing.role === 'parent' && role === 'kid' && parentCount() <= 1) {
      toast(t('acc_last_parent'), true);
      return;
    }
    let acc = existing;
    if (!acc) {
      acc = { id: `a${Date.now().toString(36)}${(Math.random() * 1e4 | 0).toString(36)}` };
      accounts.push(acc);
    }
    acc.name = name;
    acc.role = role;
    acc.avatar = avatar;
    if (uploadBlob) await idbSet('avatars', acc.id, uploadBlob).catch(() => {});
    else if (avatar.kind === 'preset') await idbDel('avatars', acc.id).catch(() => {});
    saveAccounts();
    sfx.sparkle();
    m.close();
    refreshAvatarBtn();
    if (onAccountChange) onAccountChange();
    if (onDone) onDone();
  });
  m.foot.append(saveBtn);
}

/** 圖片縮到 size×size（置中裁切）回傳 blob */
function downscale(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img load failed')); };
    img.src = url;
  });
}
