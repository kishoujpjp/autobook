#!/usr/bin/env python3
"""生成 fonts/tw-kai-*.woff2 與 css/fonts.css：全字庫正楷體 TW-Kai 子集（學習字用）。

字集：
  繁檔 = Big5 常用字 5401 + 詞庫繁體字 + 標點與 ASCII
  簡檔 = GB2312 一級字 + 詞庫簡體字 + 繁檔各字的簡體對應，扣掉繁檔已有者（用 unicode-range 按需載入；
  繁檔不設 range＝永遠載入，簡檔定義在後、命中 range 時優先取用）
來源：中華民國數位發展部 [2022] [全字庫]，政府資料開放授權條款 https://data.gov.tw/license
需要：pip install fonttools brotli
"""
import os, re, sys, urllib.request
from fontTools.ttLib import TTFont
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
SRC_URL = 'https://raw.githubusercontent.com/XiaoPanPanKevinPan/fontCollection/main/TW-Kai-98_1.ttf'
SRC = os.path.join(CACHE, 'TW-Kai-98_1.ttf')

def han(s):
    return {c for c in s if '㐀' <= c <= '鿿' or '豈' <= c <= '﫿'}

def codec_set(codec, hi_range, lo_ranges, stop=None):
    out = set()
    for hi in hi_range:
        for lo in lo_ranges:
            if stop and (hi, lo) > stop:
                break
            try:
                out.add(bytes([hi, lo]).decode(codec))
            except Exception:
                pass
    return han(out)

def charsets():
    z = open(os.path.join(ROOT, 'js/zhconv.js'), encoding='utf8').read()
    t2s_from = re.search(r"const T2S_FROM\s*=\s*'([^']*)'", z).group(1)
    t2s_to = re.search(r"const T2S_TO\s*=\s*'([^']*)'", z).group(1)
    T2S = dict(zip(t2s_from, t2s_to))
    wb = open(os.path.join(ROOT, 'js/wordbank.js'), encoding='utf8').read()
    raw = re.search(r"RAW = `([^`]*)`", wb).group(1)
    wt, ws = set(), set()
    for line in raw.split('\n'):
        if line.strip():
            p = line.split('|'); wt |= han(p[0]); ws |= han(p[-1])
    big5 = codec_set('big5', range(0xA4, 0xC7), list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)), stop=(0xC6, 0x7E))
    gb1 = codec_set('gb2312', range(0xB0, 0xD8), range(0xA1, 0xFF))
    punct = set('，。！？、：；「」『』（）…—～─《》〈〉·．') | {chr(c) for c in range(0x20, 0x7F)}
    trad = big5 | wt | punct
    simp = (gb1 | ws | {T2S[c] for c in (big5 | wt) if c in T2S}) - trad
    return trad, simp

def ranges(chars):
    cps = sorted(ord(c) for c in chars)
    out, start, prev = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp; continue
        out.append((start, prev)); start = prev = cp
    out.append((start, prev))
    return ', '.join('U+%04X' % a if a == b else 'U+%04X-%04X' % (a, b) for a, b in out)

def make(chars, out):
    font = TTFont(SRC)
    o = subset.Options()
    o.flavor = 'woff2'; o.hinting = False; o.desubroutinize = True
    o.notdef_outline = True; o.ignore_missing_unicodes = True; o.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    s = subset.Subsetter(o)
    s.populate(unicodes=[ord(c) for c in chars])
    s.subset(font)
    font.flavor = 'woff2'
    font.save(out)
    return os.path.getsize(out)

def main():
    if not os.path.exists(SRC):
        os.makedirs(CACHE, exist_ok=True)
        print('下載 TW-Kai 原檔（約 52 MB）…')
        urllib.request.urlretrieve(SRC_URL, SRC)
    trad, simp = charsets()
    fd = os.path.join(ROOT, 'fonts'); os.makedirs(fd, exist_ok=True)
    a = make(trad, os.path.join(fd, 'tw-kai-trad.woff2'))
    b = make(simp, os.path.join(fd, 'tw-kai-simp.woff2'))
    css = f"""/* 學習字字型：全字庫正楷體 TW-Kai 子集（由 tools/make_fonts.py 生成，勿手改）
   繁檔 {len(trad)} 字 {a//1024} KB；簡檔 {len(simp)} 字 {b//1024} KB（只在畫面出現簡體專有字時才載入）
   中華民國數位發展部 [2022] [全字庫]，依政府資料開放授權條款釋出 https://data.gov.tw/license */
@font-face {{
  font-family: "TW-Kai";
  src: url("../fonts/tw-kai-trad.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}}
@font-face {{
  font-family: "TW-Kai";
  src: url("../fonts/tw-kai-simp.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: {ranges(simp)};
}}
"""
    open(os.path.join(ROOT, 'css/fonts.css'), 'w', encoding='utf8').write(css)
    print(f'繁檔 {len(trad)} 字 {a//1024} KB；簡檔 {len(simp)} 字 {b//1024} KB；css/fonts.css {len(css)//1024} KB')

if __name__ == '__main__':
    main()
