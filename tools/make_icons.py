#!/usr/bin/env python3
"""生成 PWA icons：暖色圓角底 + 向量狐狸臉（與 app 內建頭像同款，無文字）"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

SIZE = 1024
SS = 4                    # 超取樣倍數（抗鋸齒）
W = SIZE * SS             # 4096

INK = (58, 46, 32)        # #3A2E20
FOX = (240, 140, 74)      # #F08C4A
WHITE = (255, 255, 255)

# 頭像 viewBox 是 96；臉放大置中佔畫面 ~86%
FACE = 0.86
SCALE = W * FACE / 96
OFF_X = (W - 96 * SCALE) / 2
OFF_Y = (W - 96 * SCALE) / 2 + 0.03 * W  # 整體略下移，視覺置中


def pt(x, y):
    """viewBox 座標 → 畫布座標"""
    return (OFF_X + x * SCALE, OFF_Y + y * SCALE)


def quad_points(p0, c, p1, n=24):
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p1[1]
        out.append((x, y))
    return out


def make_base():
    img = Image.new('RGB', (W, W), '#FFF3DF')
    d = ImageDraw.Draw(img)
    # 垂直漸層（奶油 → 蜜桃）
    top = (255, 245, 226)
    bot = (255, 216, 168)
    for y in range(W):
        t = y / W
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))

    # 泡泡裝飾（淡白）
    for cx, cy, cr, alpha in [(0.16, 0.14, 0.11, 36), (0.86, 0.20, 0.08, 32),
                              (0.82, 0.84, 0.13, 26), (0.14, 0.86, 0.07, 30)]:
        ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        x, y, r = cx * W, cy * W, cr * W
        od.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, alpha))
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)

    # ---- 狐狸臉（依 js/avatars.js 的 fox 調整成 icon 版） ----
    # 外耳
    d.polygon([pt(19, 40), pt(12, 11), pt(41, 23)], fill=FOX)
    d.polygon([pt(77, 40), pt(84, 11), pt(55, 23)], fill=FOX)
    # 內耳（縮小）
    d.polygon([pt(22, 34), pt(18, 19), pt(33, 25)], fill=WHITE)
    d.polygon([pt(74, 34), pt(78, 19), pt(63, 25)], fill=WHITE)
    # 頭
    hx, hy = pt(48, 52)
    hr = 30 * SCALE
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=FOX)
    # 白色口鼻區（小橢圓）
    mx, my = pt(48, 64)
    mrx, mry = 15.5 * SCALE, 10.5 * SCALE
    d.ellipse([mx - mrx, my - mry, mx + mrx, my + mry], fill=WHITE)
    # 腮紅
    for bx in (27, 69):
        x, y = pt(bx, 56)
        rx, ry = 5.5 * SCALE, 4 * SCALE
        ov = Image.new('RGBA', (W, W), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.ellipse([x - rx, y - ry, x + rx, y + ry], fill=(255, 157, 181, 150))
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)
    # 眼睛
    for ex in (48 - 13.5, 48 + 13.5):
        x, y = pt(ex, 46)
        r = 4.8 * SCALE
        d.ellipse([x - r, y - r, x + r, y + r], fill=INK)
        hxl, hyl = pt(ex + 1.6, 46 - 1.6)
        r2 = 1.6 * SCALE
        d.ellipse([hxl - r2, hyl - r2, hxl + r2, hyl + r2], fill=WHITE)
    # 鼻子（在白色口鼻上）
    d.polygon([pt(44.5, 59.5), pt(51.5, 59.5), pt(48, 64.5)], fill=INK)
    # 微笑
    sx0, sy0 = pt(43, 62.5)
    sx1, sy1 = pt(53, 71)
    d.arc([sx0, sy0, sx1, sy1], 25, 155, fill=INK, width=int(1.6 * SCALE))

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def rounded_rect_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    return m


base = make_base()

for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')]:
    im = base.resize((size, size), Image.LANCZOS)
    if name != 'icon-180.png':  # iOS apple-touch-icon 自己會加圓角
        rgba = im.convert('RGBA')
        rgba.putalpha(rounded_rect_mask(size, int(size * 0.22)))
        rgba.save(os.path.join(OUT, name))
    else:
        im.save(os.path.join(OUT, name))
    print('wrote', name)
