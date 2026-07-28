#!/usr/bin/env python3
"""生成音節庫：syl/*.mp3（拼音音節錄音）＋ js/readings.js（字→音節對照表）

資料來源（均可自由使用）：
- 音檔：davinfifield/mp3-chinese-pinyin-sound（Unlicense／公有領域），
  檔名為「拼音＋聲調數字」如 hao3.mp3；輕聲為 5；ü 拼作 uu（nuu、luue）。
- 讀音：Unicode Unihan kMandarin。有兩個值時第一值為中國大陸讀音、
  第二值為臺灣讀音——本表採「臺灣讀音優先」（app 以繁體／臺灣華語為核心事實）。

用法：
  python3 tools/make_syllabank.py <mp3目錄> <Unihan_Readings.txt>
（會覆寫 repo 的 syl/ 與 js/readings.js）

TW_OVERRIDES 可手工修正個別字的讀音（key=字，value=數字調拼音如 he2）。
"""
import re
import shutil
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 手工覆蓋（臺灣讀音為準；Unihan 少數字與教育部標準不一致時在這裡修）
TW_OVERRIDES = {
    # '和': 'han4',  # 例：連接詞「和」教育部讀 hàn；預設維持 hé（歌謠、詞語較常見）
}

TONE_MARKS = {'\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4}


def pinyin_to_numbered(py):
    """hǎo → ('hao', 3)；de → ('de', 5)；lǜ → ('lü', 4)。無法解析回傳 None"""
    tone = 5
    out = []
    for ch in unicodedata.normalize('NFD', py.strip().lower()):
        if ch in TONE_MARKS:
            tone = TONE_MARKS[ch]
        elif ch == '\u0308':          # ü 的兩點
            out.append('\u0308')
        elif ch.isalpha():
            out.append(ch)
        else:
            return None                # 其他符號（如 ê 的 ^）不處理
    s = ''.join(out)
    s = s.replace('u\u0308', 'ü')
    if not s or '\u0308' in s:
        return None
    return s, tone


def file_candidates(base, tone):
    """依音檔命名慣例產生候選檔名（不含 .mp3），依序嘗試"""
    forms = []
    if 'ü' in base:
        head = base[0]
        if head in 'jqxy':
            forms.append(base.replace('ü', 'u'))
        forms.append(base.replace('ü', 'uu'))   # nuu / luue
        forms.append(base.replace('ü', 'u'))
        forms.append(base.replace('ü', 'v'))
    else:
        forms.append(base)
    cands = []
    for f in forms:
        cands.append(f'{f}{tone}')
        if tone == 5:
            cands.append(f)                      # 輕聲備援：de.mp3
    return cands


def main():
    mp3_dir = Path(sys.argv[1])
    readings_txt = Path(sys.argv[2])

    available = {p.stem for p in mp3_dir.glob('*.mp3')}
    print(f'音檔：{len(available)} 個')

    char_syl = {}
    skipped = []
    for line in readings_txt.open(encoding='utf-8'):
        m = re.match(r'U\+([0-9A-F]+)\tkMandarin\t(.+)', line)
        if not m:
            continue
        cp = int(m.group(1), 16)
        if cp > 0xFFFF or not (0x3400 <= cp <= 0x9FFF):
            continue                             # 只收 BMP 常用漢字區
        ch = chr(cp)
        vals = m.group(2).split()
        py = vals[-1]                            # 兩值時第二值＝臺灣讀音
        parsed = pinyin_to_numbered(py)
        if not parsed:
            skipped.append((ch, py))
            continue
        base, tone = parsed
        for cand in file_candidates(base, tone):
            if cand in available:
                char_syl[ch] = cand
                break
        else:
            skipped.append((ch, f'{base}{tone}'))

    for ch, syl in TW_OVERRIDES.items():
        if syl in available:
            char_syl[ch] = syl

    print(f'對照表：{len(char_syl)} 字；略過 {len(skipped)} 字（無對應音檔或無法解析）')
    if skipped[:10]:
        print('  略過示例：', ' '.join(f'{c}={p}' for c, p in skipped[:10]))

    # 只複製有被引用的音檔
    used = sorted(set(char_syl.values()))
    out_dir = ROOT / 'syl'
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir()
    for syl in used:
        shutil.copy2(mp3_dir / f'{syl}.mp3', out_dir / f'{syl}.mp3')
    total_kb = sum(p.stat().st_size for p in out_dir.glob('*.mp3')) // 1024
    print(f'syl/：{len(used)} 個 mp3，共 {total_kb} KB')

    # 依音節分組壓縮輸出
    by_syl = {}
    for ch, syl in sorted(char_syl.items()):
        by_syl.setdefault(syl, []).append(ch)
    lines = [f'{syl}:{"".join(chs)}' for syl, chs in sorted(by_syl.items())]

    js = (
        '// 字→拼音音節對照表（臺灣讀音優先；Unihan kMandarin × 音節音檔庫）\n'
        '// 由 tools/make_syllabank.py 生成，勿手改。格式：每行「音節:字字字…」\n'
        'const RAW = `' + '\n'.join(lines) + '`;\n'
        '\n'
        'const MAP = new Map();\n'
        'for (const line of RAW.split(\'\\n\')) {\n'
        '  const i = line.indexOf(\':\');\n'
        '  const syl = line.slice(0, i);\n'
        '  for (const ch of line.slice(i + 1)) MAP.set(ch, syl);\n'
        '}\n'
        '\n'
        '/** 單字的音節檔名（如 hao3），查無回傳 null */\n'
        'export function syllableOf(ch) {\n'
        '  return MAP.get(ch) || null;\n'
        '}\n'
    )
    (ROOT / 'js' / 'readings.js').write_text(js, encoding='utf-8')
    print(f'js/readings.js：{len(js) // 1024} KB')


if __name__ == '__main__':
    main()
