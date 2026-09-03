// 首啟三步 onboarding（v1.26.0）：選頭像 → 讀示範書 → 家長設定。
// 只在完全沒資料（沒故事、沒字表、只有預設家長帳號）且沒跑過時出現；舊用戶直接標記為已完成。
import { t } from './i18n.js';
import { el, openModal, toast } from './ui.js';
import { icon } from './icons.js';
import { sfx } from './sfx.js';
import { settings, saveSettings, stories, words, accounts, saveAccounts, addWords, DEMO_WORDS } from './store.js';
import { PRESETS, presetSvg } from './avatars.js';
import { createDemoStory } from './story.js';
import { showPage } from './nav.js';

export function maybeOnboard() {
  if (settings.onboarded) return;
  if (stories.length || words.length || accounts.length > 1) {
    settings.onboarded = true;
    saveSettings();
    return;
  }
  openOnboarding();
}

function finish() {
  settings.onboarded = true;
  saveSettings();
}

export function openOnboarding() {
  let step = 0;
  let preset = PRESETS[1] ? PRESETS[1].id : PRESETS[0].id;
  let kidName = '';
  let demoDone = false;
  const m = openModal(t('ob_title'), { icon: 'sparkle', closable: false });

  function dots() {
    return el('div', { class: 'ob-steps', 'aria-hidden': 'true' },
      ...[0, 1, 2].map((i) => el('span', { class: `ob-step${i === step ? ' on' : ''}` })));
  }

  function renderStep() {
    m.body.innerHTML = '';
    m.foot.innerHTML = '';
    const skip = el('button', { class: 'btn ghost small', text: t('ob_skip'), onclick: () => { sfx.tap(); finish(); m.close(); } });

    if (step === 0) {
      const nameInput = el('input', { class: 'text-input', placeholder: t('ob_name_ph'), value: kidName, autocomplete: 'off', maxlength: '12' });
      nameInput.addEventListener('input', () => { kidName = nameInput.value; });
      const grid = el('div', { class: 'ob-avatars' });
      const refresh = () => grid.querySelectorAll('.preset-pick').forEach((b) => b.classList.toggle('on', b.dataset.preset === preset));
      for (const p of PRESETS) {
        const b = el('button', { class: 'preset-pick', 'data-preset': p.id, 'aria-label': p.id });
        b.innerHTML = presetSvg(p.id);
        b.addEventListener('click', () => { sfx.tap(); preset = p.id; refresh(); });
        grid.append(b);
      }
      refresh();
      m.body.append(dots(),
        el('div', { class: 'ob-title', text: t('ob_s1_title') }),
        el('p', { class: 'ob-text', text: t('ob_s1_text') }),
        nameInput,
        el('div', { style: 'height:14px' }),
        grid,
      );
      m.foot.append(skip, el('button', { class: 'btn', onclick: () => {
        sfx.tap();
        const name = kidName.trim() || t('ob_kid_default');
        accounts.push({
          id: `a-kid-${Date.now().toString(36)}`,
          name, role: 'kid',
          avatar: { kind: 'preset', preset },
        });
        saveAccounts();
        step = 1; renderStep();
      } }, t('ob_next'), icon('next')));
      return;
    }

    if (step === 1) {
      const demoBtn = el('button', { class: 'btn mint' }, icon('book'), t('ob_demo_btn'));
      const status = el('p', { class: 'ob-text', style: 'min-height:1.6em;' });
      if (demoDone) { demoBtn.disabled = true; status.replaceChildren(icon('check'), ' ', t('ob_demo_done')); }
      demoBtn.addEventListener('click', async () => {
        sfx.tap();
        demoBtn.disabled = true;
        try {
          addWords(DEMO_WORDS);
          await createDemoStory();
          demoDone = true;
          sfx.sparkle();
          status.replaceChildren(icon('check'), ' ', t('ob_demo_done'));
        } catch (e) {
          console.error(e);
          demoBtn.disabled = false;
          toast(t('err_title'), true);
        }
      });
      m.body.append(dots(),
        el('div', { class: 'ob-hero' }, icon('fairy')),
        el('div', { class: 'ob-title', text: t('ob_s2_title') }),
        el('p', { class: 'ob-text', text: t('ob_s2_text') }),
        el('div', { style: 'text-align:center;' }, demoBtn),
        status,
      );
      m.foot.append(skip, el('button', { class: 'btn', onclick: () => { sfx.tap(); step = 2; renderStep(); } }, t('ob_next'), icon('next')));
      return;
    }

    m.body.append(dots(),
      el('div', { class: 'ob-hero', style: 'color:var(--sky);' }, icon('lock')),
      el('div', { class: 'ob-title', text: t('ob_s3_title') }),
      el('p', { class: 'ob-text', text: t('ob_s3_text') }),
    );
    m.foot.append(
      el('button', { class: 'btn ghost', onclick: () => { sfx.tap(); finish(); m.close(); showPage('settings'); } }, icon('gear'), t('ob_go_settings')),
      el('button', { class: 'btn', onclick: () => { sfx.tap(); finish(); m.close(); showPage('story'); } }, icon('check'), t('ob_finish')),
    );
  }
  renderStep();
}
