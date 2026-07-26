#!/usr/bin/env python3
"""生成 PWA icons：粉紅漸層底 + 向量兔子臉（與 app 內建頭像同款，無文字）
輸出 icon2-*.png（改檔名讓 iOS 重抓 apple-touch-icon，不吃舊快取）"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

SIZE = 1024
SS = 4                    # 超取樣倍數（抗鋸齒）
W = SIZE * SS

INK = (58, 46, 32)        # #3A2E20
WHITE = (255, 255, 255)
EAR_PINK = (255, 190, 210)
NOSE_PINK = (255, 122, 160)
BLUSH = (255, 140, 170, 130)

# 頭像 viewBox 是 96；臉放大置中佔畫面 ~84%
FACE = 0.84
SCALE = W * FACE / 96
OFF_X = (W - 96 * SCALE) / 2
OFF_Y = (W - 96 * SCALE) / 2 + 0.035 * W  # 略下移，耳朵上方留呼吸空間


def pt(x, y):
    return (OFF_X + x * SCALE, OFF_Y + y * SCALE)


def ell(d, cx, cy, rx, ry, fill):
    x, y = pt(cx, cy)
    d.ellipse([x - rx * SCALE, y - ry * SCALE, x + rx * SCALE, y + ry * SCALE], fill=fill)


def make_base():
    img = Image.new('RGB', (W, W), '#FFDDEA')
    d = ImageDraw.Draw(img)
    # 垂直漸層（淺粉 → 粉紅）
    top = (255, 235, 243)
    bot = (255, 187, 212)
    for y in range(W):
        t = y / W
        d.line([(0, y), (W, y)], fill=(
            int(top[0] * (1 - t) + bot[0] * t),
            int(top[1] * (1 - t) + bot[1] * t),
            int(top[2] * (1 - t) + bot[2] * t)))

    # 泡泡裝飾（淡白）
    for cx, cy, cr, alpha in [(0.15, 0.16, 0.11, 40), (0.87, 0.22, 0.08, 34),
                              (0.83, 0.84, 0.13, 28), (0.13, 0.85, 0.07, 32)]:
        ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        x, y, r = cx * W, cy * W, cr * W
        od.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, alpha))
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)

    # ---- 兔子臉（依 js/avatars.js 的 rabbit） ----
    # 耳朵（白）＋內耳（粉）
    ell(d, 38, 17, 8.5, 20, WHITE)
    ell(d, 58, 17, 8.5, 20, WHITE)
    ell(d, 38, 18, 4.5, 14, EAR_PINK)
    ell(d, 58, 18, 4.5, 14, EAR_PINK)
    # 頭（白）
    ell(d, 48, 54, 28, 28, WHITE)
    # 腮紅
    for bx in (28, 68):
        ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        x, y = pt(bx, 61)
        rx, ry = 5.8 * SCALE, 4.2 * SCALE
        od.ellipse([x - rx, y - ry, x + rx, y + ry], fill=BLUSH)
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)
    # 眼睛
    for ex in (48 - 12, 48 + 12):
        x, y = pt(ex, 50)
        r = 4.6 * SCALE
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK)
        hx, hy = pt(ex + 1.5, 50 - 1.5)
        r2 = 1.5 * SCALE
        d.ellipse([hx - r2, hy - r2, hx + r2, hy + r2], fill=WHITE)
    # 鼻子（粉）
    ell(d, 48, 59.5, 4, 3, NOSE_PINK)
    # 微笑（ω 形：兩個小弧）
    lw = int(1.5 * SCALE)
    x0, y0 = pt(42.5, 60.5)
    x1, y1 = pt(48.5, 66.5)
    d.arc([x0, y0, x1, y1], 20, 160, fill=INK, width=lw)
    x0, y0 = pt(47.5, 60.5)
    x1, y1 = pt(53.5, 66.5)
    d.arc([x0, y0, x1, y1], 20, 160, fill=INK, width=lw)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def rounded_rect_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    return m


base = make_base()

for size, name in [(512, 'icon2-512.png'), (192, 'icon2-192.png'), (180, 'icon2-180.png')]:
    im = base.resize((size, size), Image.LANCZOS)
    if name != 'icon2-180.png':  # iOS apple-touch-icon 自己會加圓角
        rgba = im.convert('RGBA')
        rgba.putalpha(rounded_rect_mask(size, int(size * 0.22)))
        rgba.save(os.path.join(OUT, name))
    else:
        im.save(os.path.join(OUT, name))
    print('wrote', name)
