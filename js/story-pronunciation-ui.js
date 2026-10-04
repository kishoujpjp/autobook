import { t } from './i18n.js';
import { el, openModal, toast } from './ui.js';
import { icon } from './icons.js';
import { isKid, saveStories } from './store.js';
import { playReading } from './voice.js';
import { readingAt, readingChoices, parseStoryReading, setStoryReading, clearStoryReading } from './story-pronunciation.js';

/** 家長逐次選字：全文順序呈現，保留標點、換行及相同字的不同位置。 */
export function openStoryPronunciation(story) {
  if (isKid()) return;
  const m = openModal(t('pron_title'), { icon: 'speaker' });
  m.modal.classList.add('pronunciation-modal');
  const chars = [...story.text];
  let active = null;
  const nodes = new Map();
  const editor = el('div', { class: 'pronunciation-editor', hidden: '' });
  const context = el('p', { class: 'pronunciation-context' });
  const input = el('input', { class: 'text-input', 'aria-label': t('pron_input'), placeholder: t('pron_input_ph'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const choices = el('div', { class: 'row pronunciation-choices' });
  const error = el('p', { class: 'settings-note', role: 'status' });
  const preview = el('button', { class: 'btn sky', disabled: '' }, icon('speaker'), t('pron_preview'));
  const save = el('button', { class: 'btn mint', disabled: '' }, icon('check'), t('acc_save'));
  const reset = el('button', { class: 'btn ghost', disabled: '' }, icon('refresh'), t('pron_reset'));
  const valid = () => {
    const syl = parseStoryReading(input.value);
    preview.disabled = save.disabled = !syl;
    input.setAttribute('aria-invalid', String(!!input.value.trim() && !syl));
    error.textContent = input.value.trim() && !syl ? t('pron_invalid') : '';
    reset.disabled = !readingAt(story, active);
  };
  const select = (index) => {
    active = index;
    editor.hidden = false;
    for (const [i, node] of nodes) node.setAttribute('aria-pressed', String(i === active));
    context.replaceChildren(chars.slice(Math.max(0, index - 5), index).join(''),
      el('b', { text: chars[index] }), chars.slice(index + 1, index + 6).join(''));
    input.value = readingAt(story, index)?.replace(/uu/g, 'v') || '';
    choices.replaceChildren(...readingChoices(chars[index]).map((syl) => el('button', {
      class: 'btn ghost', text: syl.replace(/uu/g, 'v'),
      onclick: () => { input.value = syl.replace(/uu/g, 'v'); valid(); playReading(syl); },
    })));
    valid();
    editor.scrollIntoView({ block: 'nearest' });
  };
  const text = el('div', { class: 'pronunciation-text', 'aria-label': t('pron_text') });
  chars.forEach((ch, i) => {
    if (/\p{Script=Han}/u.test(ch)) {
      const node = el('button', {
        class: `pronunciation-char${readingAt(story, i) ? ' custom' : ''}`,
        'data-index': i, 'aria-pressed': 'false', 'aria-label': t('pron_char', { ch, n: i + 1 }),
        text: ch, onclick: () => select(i),
      });
      nodes.set(i, node); text.append(node);
    } else text.append(document.createTextNode(ch));
  });
  input.addEventListener('input', valid);
  preview.addEventListener('click', () => { const syl = parseStoryReading(input.value); if (syl) playReading(syl); });
  save.addEventListener('click', () => {
    if (!setStoryReading(story, active, input.value)) return;
    saveStories(); nodes.get(active).classList.add('custom'); valid(); toast(t('pron_saved'));
  });
  reset.addEventListener('click', () => {
    clearStoryReading(story, active); saveStories(); nodes.get(active).classList.remove('custom');
    input.value = ''; valid(); toast(t('pron_reset_done'));
  });
  editor.append(context, el('label', { class: 'field-label', text: t('pron_input') }), input, error,
    choices, el('div', { class: 'row' }, preview, reset, save));
  m.body.append(el('p', { class: 'settings-note', text: t('pron_hint') }), editor, text,
    el('p', { class: 'settings-note pronunciation-credit' },
      el('a', { href: new URL('./vendor/pronunciation-sources.md', import.meta.url).href, target: '_blank', rel: 'noopener', text: t('pron_credit') }),
      ' · ', el('a', { href: new URL('./vendor/moe-concised-use.pdf', import.meta.url).href, target: '_blank', rel: 'noopener', text: t('pron_license') }),
    ));
  m.foot.append(el('button', { class: 'btn sky', text: t('pron_done'), onclick: () => m.close() }));
}
