#!/usr/bin/env python3
"""生成 js/wordbank.js：jieba 詞頻(簡) × CEDICT(繁簡對照、濾專有名詞) → 常用 2~3 字詞
只擋髒話，其餘不過濾：詞庫內容由家長自己審（2026-09-03 決定）。

用法：python3 tools/make_wordbank.py <資料目錄>
資料目錄需有 jieba_dict.txt 與 cedict.u8
"""
import os
import re
import sys

HAN = re.compile(r'^[㐀-鿿]+$')

# 只擋髒話與罵人的話（2026-09-03 用戶決定）：其他詞一律不過濾（死亡、離婚、戰爭…都是正常詞），內容由家長自己審。
PROFANITY = [
    '媽的', '妈的', '他媽', '他妈', '尼瑪', '尼玛', '肏', '屄', '屌', '雞巴', '鸡巴',
    '王八', '混蛋', '渾蛋', '浑蛋', '混帳', '混账', '傻逼', '煞笔', '婊', '賤人', '贱人',
    '幹你', '干你', '操你', '靠北', '機掰', '鸡掰', '白痴', '智障',
]


def blocked(word_t, word_s):
    return any(b in word_t or b in word_s for b in PROFANITY)


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
    out = f"""// 常用詞庫（jieba 詞頻 × CC-CEDICT 繁簡對照，2~3 字、無專有名詞、只擋髒話，取前 {TOP}）
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
