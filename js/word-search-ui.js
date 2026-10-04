import { el } from './ui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { filterCharacters } from './word-search.js';
import { syllableOf } from './readings.js';

/** 篩選既有字卡節點，保留其標色、讀音、選框及事件；輸入時不重繪頁面。 */
export function createWordSearch({ grid, entries, getSelected, getCandidates, value = '', onQueryChange = () => {}, maxSelected }) {
  const nodes = new Map(entries.map(({ ch, node }) => [ch, node]));
  const pool = [...nodes.keys()];
  let query = value;
  let composing = false;
  let result;
  const input = el('input', {
    class: 'text-input', type: 'search', placeholder: t('word_search_ph'),
    'aria-label': t('word_search_label'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  input.value = value;
  const clear = el('button', { class: 'btn ghost small', type: 'button', 'aria-label': t('word_search_clear') }, icon('close'));
  const summary = el('p', { class: 'settings-note word-search-summary', role: 'status', 'aria-live': 'polite' });
  const empty = el('p', { class: 'settings-note word-search-empty', text: t('word_search_empty') });
  const root = el('div', { class: 'word-search' },
    el('div', { class: 'word-search-field' }, icon('search'), input, clear), summary, empty);
  grid.classList.add('word-search-grid');

  function refresh({ deferLayout = false } = {}) {
    const selected = getSelected?.() || new Set();
    const candidates = getCandidates?.() || pool;
    result = filterCharacters(pool, query, selected, candidates);
    clear.hidden = !input.value;
    let label = t('word_search_count', { n: result.matches.length, total: candidates.length });
    if (result.retained.length) label += ' · ' + t('word_search_retained', { n: result.retained.length });
    if (getSelected) label += ' · ' + t('word_search_selected', { n: selected.size }) + (maxSelected ? ` / ${maxSelected}` : '');
    summary.textContent = label;
    empty.hidden = (!query.trim() && !getCandidates) || result.matches.length > 0;
    if (deferLayout) return;
    const visible = new Set(result.visible);
    for (const [ch, node] of nodes) {
      node.hidden = !visible.has(ch);
      if (getSelected) node.setAttribute('aria-pressed', String(selected.has(ch)));
      // 簡體畫面上「發／髮」仍有不同的可存取名稱。
      const reading = syllableOf(ch)?.replace(/uu/g, 'v');
      node.setAttribute('aria-label', reading ? `${ch}，${reading}` : ch);
    }
    // 維持原節點：輸入法焦點、按鈕監聽及原字身份不會被清掉。
    const current = [...grid.children].filter((node) => !node.hidden);
    if (result.visible.some((ch, i) => current[i] !== nodes.get(ch))) {
      for (const ch of result.visible) grid.append(nodes.get(ch));
    }
  }
  function apply() {
    query = input.value;
    onQueryChange(query);
    refresh();
  }
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; apply(); });
  input.addEventListener('input', (event) => { if (!composing && !event.isComposing) apply(); });
  clear.addEventListener('click', () => { input.value = ''; composing = false; apply(); input.focus(); });
  refresh();
  return { root, refresh, matches: () => result.matches };
}
