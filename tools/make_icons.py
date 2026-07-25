#!/usr/bin/env python3
"""生成 PWA icons：暖色圓角底 + 打開的書 + 「書」字"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

SIZE = 1024


def find_font():
    candidates = [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/Hiragino Sans GB.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def rounded_rect_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    return m


def make_base():
    img = Image.new('RGB', (SIZE, SIZE), '#FF8A3D')
    d = ImageDraw.Draw(img)
    # 垂直漸層
    for y in range(SIZE):
        t = y / SIZE
        r = int(0xFF * (1 - t) + 0xF0 * t)
        g = int(0xA6 * (1 - t) + 0x72 * t)
        b = int(0x4D * (1 - t) + 0x1F * t)
        d.line([(0, y), (SIZE, y)], fill=(r, g, b))
    # 泡泡裝飾
    for cx, cy, cr, alpha in [(180, 170, 120, 40), (860, 240, 90, 35), (780, 830, 150, 30), (200, 860, 80, 35)]:
        ov = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=(255, 255, 255, alpha))
        img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
        d = ImageDraw.Draw(img)

    # 打開的書（白色）
    cx, cy = SIZE // 2, 640
    w, h = 640, 300
    book = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bd = ImageDraw.Draw(book)
    # 左頁
    bd.polygon([(cx, cy - h // 3), (cx - w // 2, cy - h // 2), (cx - w // 2, cy + h // 3), (cx, cy + h // 2)],
               fill=(255, 253, 246, 255), outline=(74, 59, 42, 255), width=14)
    # 右頁
    bd.polygon([(cx, cy - h // 3), (cx + w // 2, cy - h // 2), (cx + w // 2, cy + h // 3), (cx, cy + h // 2)],
               fill=(255, 248, 232, 255), outline=(74, 59, 42, 255), width=14)
    # 書縫
    bd.line([(cx, cy - h // 3), (cx, cy + h // 2)], fill=(74, 59, 42, 255), width=14)
    # 頁面線條
    for i in range(3):
        yy = cy - h // 6 + i * 60
        bd.line([(cx - w // 2 + 70, yy), (cx - 60, yy + 26)], fill=(230, 210, 180, 255), width=12)
        bd.line([(cx + 60, yy + 26), (cx + w // 2 - 70, yy)], fill=(230, 210, 180, 255), width=12)
    img = Image.alpha_composite(img.convert('RGBA'), book).convert('RGB')

    # 「書」字
    font_path = find_font()
    if font_path:
        try:
            font = ImageFont.truetype(font_path, 330, index=0)
            d = ImageDraw.Draw(img)
            text = '書'
            bbox = d.textbbox((0, 0), text, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            tx, ty = (SIZE - tw) // 2 - bbox[0], 130 - bbox[1]
            # 白色描邊
            d.text((tx, ty), text, font=font, fill='#FFFDF6',
                   stroke_width=26, stroke_fill='#FFFDF6')
            d.text((tx, ty), text, font=font, fill='#4A3B2A')
        except Exception as e:
            print('font failed:', e)
    return img


base = make_base()

# 圓角版（一般 icon）
for size, name in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')]:
    im = base.resize((size, size), Image.LANCZOS)
    if name != 'icon-180.png':  # iOS apple-touch-icon 自己會加圓角
        rgba = im.convert('RGBA')
        rgba.putalpha(rounded_rect_mask(size, int(size * 0.22)))
        rgba.save(os.path.join(OUT, name))
    else:
        im.save(os.path.join(OUT, name))
    print('wrote', name)
