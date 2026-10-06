#!/usr/bin/env python3
"""Claude Lane news card renderer (docs/CLAUDE_LANE.md step 3).

Deterministic, free, offline: draws a 1080x1350 JPEG from a lane record using
Pillow and system fonts. No AI imagery, so nothing in the picture can be
mistaken for a documentary photograph.

usage: render_card.py <record.json> <out.jpg>
"""
import json
import sys
import textwrap
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1350
NAVY, NAVY2 = (8, 14, 32), (18, 34, 72)
WHITE, YELLOW, RED, GREY = (255, 255, 255), (255, 204, 0), (214, 40, 40), (170, 182, 205)
FONT_DIRS = ['/usr/share/fonts/truetype/dejavu/']


def font(bold, size):
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    for d in FONT_DIRS:
        try:
            return ImageFont.truetype(d + name, size)
        except OSError:
            continue
    raise SystemExit('FONT_MISSING: install fonts-dejavu-core')


def fit_lines(draw, text, bold, max_w, max_lines, start, floor):
    """Largest font size whose wrapped text fits max_w within max_lines."""
    for size in range(start, floor - 1, -2):
        f = font(bold, size)
        avg = draw.textlength('abcdefghijklmnopqrstuvwxyz', font=f) / 26
        width_chars = max(8, int(max_w / avg))
        lines = textwrap.wrap(text, width=width_chars)
        if len(lines) <= max_lines and all(draw.textlength(l, font=f) <= max_w for l in lines):
            return f, lines
    f = font(bold, floor)
    lines = textwrap.wrap(text, width=int(max_w / (draw.textlength('a', font=f) or 1)))[:max_lines]
    lines[-1] = lines[-1].rstrip(' .,;:') + '…'
    return f, lines


def render(record, out_path):
    img = Image.new('RGB', (W, H), NAVY)
    d = ImageDraw.Draw(img)
    for y in range(H):  # vertical gradient
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] + (NAVY2[i] - NAVY[i]) * t) for i in range(3)))
    for x in range(0, W, 60):  # faint grid
        d.line([(x, 0), (x, H)], fill=(20, 32, 62))
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(20, 32, 62))

    m = 64
    d.text((m, 56), 'MATRIX', font=font(True, 54), fill=WHITE)
    d.text((m + d.textlength('MATRIX ', font=font(True, 54)), 56), '24', font=font(True, 54), fill=YELLOW)
    d.text((m, 118), 'G L O B A L', font=font(False, 22), fill=GREY)

    badge_f = font(True, 26)
    badge = 'ÚLTIMA HORA · BREAKING'
    bw = d.textlength(badge, font=badge_f) + 40
    d.rounded_rectangle([W - m - bw, 62, W - m, 112], radius=8, fill=RED)
    d.text((W - m - bw + 20, 72), badge, font=badge_f, fill=WHITE)

    cat = (record.get('category') or 'World').upper()
    cf = font(True, 26)
    d.rounded_rectangle([m, 300, m + d.textlength(cat, font=cf) + 36, 346], radius=6, fill=RED)
    d.text((m + 18, 308), cat, font=cf, fill=WHITE)

    es = record.get('headline_es') or record['headline']
    hf, hl = fit_lines(d, es.upper(), True, W - 2 * m, 6, 84, 44)
    y = 380
    for line in hl:
        d.text((m, y), line, font=hf, fill=WHITE)
        y += int(hf.size * 1.15)

    y += 30
    ef, el = fit_lines(d, record['headline'], False, W - 2 * m, 4, 40, 28)
    for line in el:
        d.text((m, y), line, font=ef, fill=YELLOW)
        y += int(ef.size * 1.25)

    d.line([(m, H - 190), (W - m, H - 190)], fill=YELLOW, width=4)
    sf = font(False, 26)
    sources = 'Fuentes / Sources: ' + ', '.join(record.get('source_names', []))
    sf2, sl = fit_lines(d, sources, False, W - 2 * m, 2, 26, 20)
    yy = H - 165
    for line in sl:
        d.text((m, yy), line, font=sf2, fill=WHITE)
        yy += int(sf2.size * 1.3)
    date = datetime.strptime(record['created_at'][:10], '%Y-%m-%d').strftime('%d.%m.%Y')
    d.text((m, H - 70), date + '  ·  @matrix24global', font=font(False, 24), fill=GREY)
    img.save(out_path, 'JPEG', quality=90, optimize=True)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    with open(sys.argv[1], encoding='utf-8') as fh:
        render(json.load(fh), sys.argv[2])
