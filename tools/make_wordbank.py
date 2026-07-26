#!/usr/bin/env python3
"""生成 js/wordbank.js：jieba 詞頻(簡) × CEDICT(繁簡對照、濾專有名詞) → 常用 2~3 字詞
幼教用：內建不當詞黑名單（髒話/暴力/成人/賭毒等，繁簡都擋）。

用法：python3 tools/make_wordbank.py <資料目錄>
資料目錄需有 jieba_dict.txt 與 cedict.u8
"""
import os
import re
import sys

HAN = re.compile(r'^[㐀-鿿]+$')

# 不當詞（子字串比對，繁簡都列）。寧可錯殺。
BLOCK_SUBSTR = [
    # 髒話/侮辱
    '妈的', '媽的', '他妈', '他媽', '尼玛', '尼瑪', '操', '肏', '艹',
    '屄', '屌', '鸡巴', '雞巴', '王八', '混蛋', '浑蛋', '渾蛋',
    '滚', '滾', '傻逼', '煞笔', '贱', '賤', '婊',
    # 死亡/暴力
    '死', '杀', '殺', '尸', '屍', '虐', '暴力', '强暴', '強暴', '施暴', '家暴',
    '砍', '斬', '斩', '刺傷', '刺伤', '槍', '枪', '炸彈', '炸弹', '爆炸',
    # 成人
    '淫', '奸', '姦', '嫖', '妓', '娼', '性交', '性感', '性愛', '性爱',
    '做愛', '做爱', '色情', '情色', '裸', '賣身', '卖身',
    # 賭毒
    '賭', '赌', '毒品', '吸毒', '販毒', '贩毒', '海洛因', '嗎啡', '吗啡',
    # 其他不宜
    '屎', '自焚', '綁架', '绑架', '勒索', '恐怖分子', '監獄', '监狱',
]


def blocked(word_t, word_s):
    for b in BLOCK_SUBSTR:
        if b in word_t or b in word_s:
            return True
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
    out = f"""// 常用詞庫（jieba 詞頻 × CC-CEDICT 繁簡對照，2~3 字、無專有名詞、含幼教黑名單過濾，取前 {TOP}）
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
