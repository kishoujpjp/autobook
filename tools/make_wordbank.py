#!/usr/bin/env python3
"""生成 js/wordbank.js：jieba 詞頻(簡) × CEDICT(繁簡對照、濾專有名詞) → 常用 2~3 字詞
不做黑名單過濾：詞庫內容由家長自己審（2026-09-03 決定）。

用法：python3 tools/make_wordbank.py <資料目錄>
資料目錄需有 jieba_dict.txt 與 cedict.u8
"""
import os
import re
import sys

HAN = re.compile(r'^[㐀-鿿]+$')

# 不做黑名單過濾（2026-09-03 用戶決定：詞庫內容由家長自己審，不預先拿掉「死」「離婚」這類正常詞）。
def blocked(word_t, word_s):  # noqa: ARG001
    return False


def main(data_dir):
    # 1) CEDICT: simp -> trad；跳過專有名詞（拼音首字母大寫）
    cedict = {}
    with open(os.path.join(data_dir, 'cedict.u8'), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            m = re.match(r'^(\S+) (\S+) \[([^\]]+)\]', line)
            if not m:
                continue
            trad, simp, pinyin = m.groups()
            if not (HAN.match(trad) and HAN.match(simp)):
                continue
            if not (2 <= len(simp) <= 3):
                continue
            if any(s[0].isupper() for s in pinyin.split()):
                continue
            cedict.setdefault(simp, trad)

    # 2) jieba 詞頻排序
    rows = []
    with open(os.path.join(data_dir, 'jieba_dict.txt'), encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            if len(parts) < 2:
                continue
            w, freq = parts[0], int(parts[1])
            if not HAN.match(w) or not (2 <= len(w) <= 3):
                continue
            if w not in cedict:
                continue
            if blocked(cedict[w], w):
                continue
            rows.append((freq, w))
    rows.sort(reverse=True)

    TOP = 8000
    picked = rows[:TOP]

    lines = []
    for _, simp in picked:
        trad = cedict[simp]
        lines.append(trad if trad == simp else f'{trad}|{simp}')

    payload = '\n'.join(lines)
    out = f"""// 常用詞庫（jieba 詞頻 × CC-CEDICT 繁簡對照，2~3 字、無專有名詞、不過濾黑名單，取前 {TOP}）
// 由 tools/make_wordbank.py 生成，勿手改。格式：每行「繁|簡」，繁簡相同時只有一個。
const RAW = `{payload}`;

/** 回傳 [{{t, s}}]（繁體形 / 簡體形） */
export const WORDS = RAW.split('\\n').map((line) => {{
  const i = line.indexOf('|');
  return i === -1 ? {{ t: line, s: line }} : {{ t: line.slice(0, i), s: line.slice(i + 1) }};
}});
"""
    dest = os.path.join(os.path.dirname(__file__), '..', 'js', 'wordbank.js')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    print('words:', len(picked), 'bytes:', os.path.getsize(dest))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
