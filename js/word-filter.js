/** 統計篩選沿用目前小孩的熟悉度；不改字表或學習紀錄。 */
export function matchesWordFilter(word, filter, card) {
  if (filter === 'learned') return card.mark === 'green';
  if (filter === 'weak') return card.mark === 'red';
  if (filter === 'unused') return word.usedCount === 0;
  return true;
}
