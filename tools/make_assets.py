#!/usr/bin/env python3
"""Generates the store banner, icons and watch menu icon for Should I Fly?"""
from PIL import Image, ImageDraw, ImageFont
import math, os

NAVY_TOP = (9, 24, 54)
NAVY_BOT = (26, 74, 122)
SKY = (150, 215, 255)
WHITE = (245, 248, 252)
GREY = (120, 135, 155)
DARK = (22, 30, 48)
ACCENT = (80, 220, 140)
FONT_B = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def gradient(w, h, top, bot):
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return im


def swoosh(d, x0, x1, y, curl_r, width, color):
    """Horizontal wind line that ends in a small curl."""
    d.line([(x0, y), (x1, y)], fill=color, width=width)
    d.ellipse([x0 - width / 2, y - width / 2, x0 + width / 2, y + width / 2], fill=color)
    cx, cy = x1, y - curl_r
    d.arc([cx - curl_r, cy - curl_r, cx + curl_r, cy + curl_r], start=90, end=360, fill=color, width=width)
    # round the tail end of the curl
    ex, ey = cx + curl_r, cy
    d.ellipse([ex - width / 2, ey - width / 2, ex + width / 2, ey + width / 2], fill=color)


def drone(d, cx, cy, s):
    """Front view quadcopter, s = overall half-width."""
    # landing legs
    for sx in (-1, 1):
        d.line([(cx + sx * 0.28 * s, cy + 0.10 * s), (cx + sx * 0.36 * s, cy + 0.42 * s)], fill=GREY, width=max(2, int(s * 0.045)))
        d.line([(cx + sx * 0.28 * s, cy + 0.42 * s), (cx + sx * 0.46 * s, cy + 0.42 * s)], fill=GREY, width=max(2, int(s * 0.045)))
    # arms
    aw = max(3, int(s * 0.07))
    for sx in (-1, 1):
        d.line([(cx + sx * 0.18 * s, cy - 0.02 * s), (cx + sx * 0.78 * s, cy - 0.26 * s)], fill=WHITE, width=aw)
        # motor
        mx, my = cx + sx * 0.78 * s, cy - 0.26 * s
        d.rounded_rectangle([mx - 0.06 * s, my - 0.12 * s, mx + 0.06 * s, my + 0.02 * s], radius=int(0.03 * s), fill=GREY)
        # rotor blades (flat ellipse, slightly translucent look via two layers)
        d.ellipse([mx - 0.30 * s, my - 0.20 * s, mx + 0.30 * s, my - 0.10 * s], fill=(190, 225, 250))
        d.ellipse([mx - 0.22 * s, my - 0.18 * s, mx + 0.22 * s, my - 0.12 * s], fill=(235, 246, 255))
    # body
    d.rounded_rectangle([cx - 0.30 * s, cy - 0.20 * s, cx + 0.30 * s, cy + 0.16 * s], radius=int(0.14 * s), fill=WHITE)
    d.rounded_rectangle([cx - 0.30 * s, cy - 0.04 * s, cx + 0.30 * s, cy + 0.16 * s], radius=int(0.10 * s), fill=(215, 225, 238))
    # status light
    d.ellipse([cx - 0.05 * s, cy - 0.16 * s, cx + 0.05 * s, cy - 0.06 * s], fill=ACCENT)
    # gimbal camera
    d.rounded_rectangle([cx - 0.10 * s, cy + 0.12 * s, cx + 0.10 * s, cy + 0.22 * s], radius=int(0.04 * s), fill=GREY)
    d.ellipse([cx - 0.12 * s, cy + 0.17 * s, cx + 0.12 * s, cy + 0.41 * s], fill=DARK)
    d.ellipse([cx - 0.07 * s, cy + 0.22 * s, cx + 0.07 * s, cy + 0.36 * s], fill=(40, 70, 120))
    d.ellipse([cx - 0.035 * s, cy + 0.235 * s, cx + 0.0 * s, cy + 0.27 * s], fill=(200, 230, 255))


def banner(path):
    W, H, K = 720, 320, 3
    im = gradient(W * K, H * K, NAVY_TOP, NAVY_BOT).convert('RGBA')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    # wind streaks, faint to bright
    streaks = [
        (20, 250, 70, 14, 7, 70), (90, 330, 118, 18, 8, 110), (0, 200, 168, 12, 6, 60),
        (60, 360, 214, 22, 9, 130), (150, 330, 262, 14, 7, 80), (10, 150, 40, 10, 5, 50),
        (380, 470, 70, 12, 6, 60),
    ]
    for x0, x1, y, r, w, a in streaks:
        swoosh(d, x0 * K, x1 * K, y * K, r * K, w * K, SKY + (a,))
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    drone(d, 215 * K, 150 * K, 150 * K)
    # text
    f1 = ImageFont.truetype(FONT_B, 60 * K)
    f2 = ImageFont.truetype(FONT_R, 21 * K)
    d.text((400 * K, 112 * K), 'Should I', font=f1, fill=WHITE)
    d.text((400 * K, 172 * K), 'Fly?', font=f1, fill=ACCENT)
    d.text((402 * K, 250 * K), 'Wind, airspace, go/no-go', font=f2, fill=SKY)
    im.convert('RGB').resize((W, H), Image.LANCZOS).save(path)


def square_icon(size, path, rounded=True):
    K = 4
    S = size * K
    im = gradient(S, S, NAVY_TOP, NAVY_BOT).convert('RGBA')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    swoosh(d, int(S * 0.04), int(S * 0.40), int(S * 0.78), int(S * 0.06), max(3, int(S * 0.028)), SKY + (150,))
    swoosh(d, int(S * 0.55), int(S * 0.92), int(S * 0.86), int(S * 0.05), max(3, int(S * 0.024)), SKY + (110,))
    im = Image.alpha_composite(im, ov)
    d = ImageDraw.Draw(im)
    drone(d, S // 2, int(S * 0.42), S * 0.50)
    out = im.resize((size, size), Image.LANCZOS)
    if rounded and size >= 80:
        mask = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size * 4 - 1, size * 4 - 1], radius=size * 4 // 6, fill=255)
        out.putalpha(mask.resize((size, size), Image.LANCZOS))
    out.save(path)


def menu_icon(path):
    # hand-tuned 25x25 pixel art: white drone on navy
    P = {'.': NAVY_BOT, 'w': WHITE, 'g': (150, 215, 255), 'k': DARK, 'a': ACCENT, 'd': GREY}
    rows = [
        '.........................',
        '.........................',
        '.........................',
        '..gggg...........gggg....',
        '.gwwwwg.........gwwwwg...',
        '..dddd...........dddd....',
        '....d.d.........d.d......',
        '.....d.dwwwwwwwwd.d......',
        '......dwwwwwwwwwwd.......',
        '.......wwwwwawwwww.......',
        '.......wwwwwwwwwww.......',
        '.......wwwwwwwwwww.......',
        '.......ddwwwwwwwdd.......',
        '.........dkkkkkd.........',
        '..........kkkkk..........',
        '..........kdddk..........',
        '..........kkkkk..........',
        '.........................',
        '..gg.....................',
        '.gggggggg.........gggg...',
        '...........ggggggg..g....',
        '.....................g...',
        '.........................',
        '.........................',
        '.........................',
    ]
    im = Image.new('RGB', (25, 25), NAVY_TOP)
    px = im.load()
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            px[x, y] = P[c]
    im.save(path)


if __name__ == '__main__':
    root = os.path.join(os.path.dirname(__file__), '..')
    sc = os.path.join(root, 'screenshots')
    banner(os.path.join(sc, 'banner.png'))
    square_icon(144, os.path.join(sc, 'icon-144.png'))
    square_icon(80, os.path.join(sc, 'icon-80.png'))
    square_icon(25, os.path.join(sc, 'icon-25.png'), rounded=False)
    menu_icon(os.path.join(root, 'resources', 'images', 'menu_icon.png'))
    print('assets written')
