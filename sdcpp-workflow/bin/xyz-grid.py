#!/usr/bin/env python3
"""X/Y/Z plot grid (P10): one PNG per Z value, X across, Y down, with optional legends.
Usage: xyz-grid.py <spec.json>
spec: {"out_dir", "dims":[nx,ny,nz], "axes":[{"label","values":[..]}|null x3], "cells":[{"path","ix","iy","iz"}],
       "legend":bool, "margin":int}
Cells of different sizes (Width/Height axes) are centred in uniform tiles, never resized. Prints the file names written."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

FONTS = ['/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf']


def font(size):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            pass
    return ImageFont.load_default(size)


def wrap(draw, text, fnt, width):
    lines, cur = [], ''
    for word in str(text).split(' '):
        trial = (cur + ' ' + word).strip()
        if cur and draw.textlength(trial, font=fnt) > width:
            lines.append(cur); cur = word
        else:
            cur = trial
    lines.append(cur)
    return lines


def main():
    spec = json.load(open(sys.argv[1]))
    nx, ny, nz = spec['dims']
    axes, margin, legend = spec['axes'], int(spec.get('margin', 0)), bool(spec.get('legend', True))
    imgs = {}
    for c in spec['cells']:
        if c.get('path') and os.path.exists(c['path']):
            imgs[(c['ix'], c['iy'], c['iz'])] = Image.open(c['path']).convert('RGB')
    if not imgs:
        print('FAIL: no cell images', file=sys.stderr); sys.exit(1)
    tw = max(i.width for i in imgs.values()); th = max(i.height for i in imgs.values())
    fnt = font(max(14, tw // 26)); small = font(max(12, tw // 32))
    probe = ImageDraw.Draw(Image.new('RGB', (4, 4)))
    lh = int(fnt.size * 1.3)
    written = []
    for iz in range(nz):
        # legend geometry
        top_lines = []
        if legend and axes[0]:
            top_lines = [wrap(probe, f"{axes[0]['label']}: {v}", fnt, tw - 8) for v in axes[0]['values']]
        top_h = (max(len(l) for l in top_lines) * lh + 12) if top_lines else 0
        title = (f"{axes[2]['label']}: {axes[2]['values'][iz]}" if legend and axes[2] else '')
        title_h = lh + 12 if title else 0
        left_w = 0
        if legend and axes[1]:
            left_w = int(min(tw, max(probe.textlength(f"{axes[1]['label']}: {v}", font=fnt) for v in axes[1]['values']) / 2 + 24))
        W = left_w + nx * tw + (nx - 1) * margin
        H = title_h + top_h + ny * th + (ny - 1) * margin
        sheet = Image.new('RGB', (W, H), (255, 255, 255))
        d = ImageDraw.Draw(sheet)
        if title:
            d.text((W // 2, 6), title, font=fnt, fill=(0, 0, 0), anchor='ma')
        for ix in range(nx):
            x0 = left_w + ix * (tw + margin)
            if top_lines:
                for k, ln in enumerate(top_lines[ix]):
                    d.text((x0 + tw // 2, title_h + 6 + k * lh), ln, font=fnt, fill=(0, 0, 0), anchor='ma')
            for iy in range(ny):
                im = imgs.get((ix, iy, iz))
                y0 = title_h + top_h + iy * (th + margin)
                if im is None:
                    d.rectangle([x0, y0, x0 + tw - 1, y0 + th - 1], outline=(200, 0, 0)); d.text((x0 + 8, y0 + 8), 'failed', font=small, fill=(200, 0, 0))
                else:
                    sheet.paste(im, (x0 + (tw - im.width) // 2, y0 + (th - im.height) // 2))
        if left_w:
            for iy in range(ny):
                y0 = title_h + top_h + iy * (th + margin)
                for k, ln in enumerate(wrap(d, f"{axes[1]['label']}: {axes[1]['values'][iy]}", fnt, left_w - 12)):
                    d.text((left_w - 8, y0 + th // 2 + k * lh - lh // 2), ln, font=fnt, fill=(0, 0, 0), anchor='ra')
        name = f"xyz-grid-z{iz + 1}.png" if nz > 1 else 'xyz-grid.png'
        sheet.save(os.path.join(spec['out_dir'], name), format='PNG')
        written.append(name)
    print(json.dumps({'files': written, 'tile': [tw, th]}))


if __name__ == '__main__':
    main()
