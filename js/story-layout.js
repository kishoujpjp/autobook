// 保留原始 code-point 索引：點讀、標註與進度仍對應儲存的故事文字。
const OPENING = new Set([...'「『“‘（《〈【〔［｛([{']);

export function storyLines(text, isHan) {
  const lines = [[]];
  let pending = [], doubleQuoteOpen = false;
  const flush = () => {
    if (!pending.length) return;
    const line = lines.at(-1);
    if (line.length) line.at(-1).push(...pending);
    else line.push(pending);
    pending = [];
  };
  const chars = [...text];
  chars.forEach((ch, i) => {
    if (ch === '\r' && chars[i + 1] === '\n') return;
    if (ch === '\n' || ch === '\r') {
      flush();
      lines.push([]);
      return;
    }
    const item = { ch, i, han: isHan(ch) };
    const opening = OPENING.has(ch) || (ch === '"' && !doubleQuoteOpen);
    if (ch === '"') doubleQuoteOpen = !doubleQuoteOpen;
    if (opening) {
      pending.push(item);
    } else if (item.han) {
      lines.at(-1).push([...pending, item]);
      pending = [];
    } else if (pending.length) {
      pending.push(item);
    } else {
      const line = lines.at(-1);
      if (line.length) line.at(-1).push(item);
      else line.push([item]);
    }
  });
  flush();
  return lines;
}
