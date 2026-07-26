#!/usr/bin/env python3
"""生成 js/phonemes.js：CMUdict × google-10000 常用詞 → 內嵌音素庫
音素去重音數字後映射成單一字元，比對時直接對編碼字串做編輯距離。

用法：python3 tools/make_phonemes.py <資料目錄>
資料目錄需有 cmudict.dict 與 common10k.txt
"""
import os
import re
import sys

# ARPAbet 39 音素（無重音）
PHONES = ['AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'B', 'CH', 'D', 'DH', 'EH', 'ER',
          'EY', 'F', 'G', 'HH', 'IH', 'IY', 'JH', 'K', 'L', 'M', 'N', 'NG',
          'OW', 'OY', 'P', 'R', 'S', 'T', 'TH', 'UH', 'UW', 'V', 'W', 'Y',
          'Z', 'ZH']
ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl'
assert len(ALPHABET) >= len(PHONES)
ENC = {p: ALPHABET[i] for i, p in enumerate(PHONES)}


def main(data_dir):
    common = []
    with open(os.path.join(data_dir, 'common10k.txt'), encoding='utf-8') as f:
        for line in f:
            w = line.strip().lower()
            if w:
                common.append(w)
    common_set = set(common)

    # word -> [encoded variants]
    prons = {}
    with open(os.path.join(data_dir, 'cmudict.dict'), encoding='utf-8', errors='ignore') as f:
        for line in f:
            parts = line.strip().split(' ')
            if len(parts) < 2:
                continue
            word = re.sub(r'\(\d+\)$', '', parts[0]).lower()
            if word not in common_set:
                continue
            phones = []
            ok = True
            for p in parts[1:]:
                p = re.sub(r'\d', '', p).split('#')[0].strip()
                if not p:
                    continue
                if p not in ENC:
                    ok = False
                    break
                phones.append(ENC[p])
            if not ok or not phones:
                continue
            enc = ''.join(phones)
            lst = prons.setdefault(word, [])
            if enc not in lst and len(lst) < 2:  # 最多兩種唸法
                lst.append(enc)

    # 依常用順序輸出
    lines = []
    for w in common:
        if w in prons:
            lines.append(f'{w}:{"/".join(prons[w])}')

    payload = '\n'.join(lines)
    out = f"""// 英文常用詞音素庫（CMUdict × google-10000，去重音、單字元編碼、最多兩種唸法）
// 由 tools/make_phonemes.py 生成，勿手改。格式：word:enc[/enc2]，每字元＝一個音素。
const RAW = `{payload}`;

let MAP = null;
function ensure() {{
  if (MAP) return;
  MAP = new Map();
  for (const line of RAW.split('\\n')) {{
    const i = line.indexOf(':');
    if (i > 0) MAP.set(line.slice(0, i), line.slice(i + 1).split('/'));
  }}
}}

/** 回傳單字的音素編碼字串陣列（查不到回傳 null） */
export function phonemesOf(word) {{
  ensure();
  return MAP.get(word.toLowerCase()) || null;
}}
"""
    dest = os.path.join(os.path.dirname(__file__), '..', 'js', 'phonemes.js')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    print('words:', len(lines), 'bytes:', os.path.getsize(dest))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
