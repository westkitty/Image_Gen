#!/usr/bin/env python3
"""A1111 Extras resize (P09): scale-by (+ max side) / scale-to with crop, upscaler 1 and upscaler 2 blended by visibility.

Usage: extras-resize.py <in.png> <out.png> '<options json>'   (options validated by extras-options.js)
Prints one JSON line {"src":[w,h],"stage":[w,h],"out":[w,h]}. Mirrors public/dexdiffusion/extras-options.js plan().

Port of scripts/postprocessing_upscale.py (upscale/process) and modules/upscaler.py Upscaler.upscale at
82a973c04367123ae98bd9abdf80d9eda9b910e2: each upscaler does do_upscale (resize to int(dim*scale)) and then a final
LANCZOS resize to dest = int((dim*scale)//8*8) when the sizes differ.
"""
import json
import sys

from PIL import Image

R = {'lanczos': Image.LANCZOS, 'bicubic': Image.BICUBIC, 'bilinear': Image.BILINEAR, 'nearest': Image.NEAREST}


def limit_size(w: float, h: float, limit: int) -> tuple[int, int]:
    """postprocessing_upscale.limit_size_by_one_dimention."""
    if h > w and h > limit:
        w = limit * w // h
        h = limit
    elif w > limit:
        h = limit * h // w
        w = limit
    return int(w), int(h)


def plan(w: int, h: int, o: dict) -> tuple[float, tuple[int, int], bool]:
    mode, crop = o['mode'], bool(o['mode'] == 'to' and o['crop'])
    if mode == 'to':
        f = max(o['width'] / w, o['height'] / h)
    else:
        f = o['scale']
        if o.get('max_side') and max(w, h) * f > o['max_side']:
            crop = False
            tw, th = limit_size(w * f, h * f, o['max_side'])
            f = max(tw / w, th / h)
    return f, (int((w * f) // 8 * 8), int((h * f) // 8 * 8)), crop


def upscale(img: Image.Image, scale: float, name: str) -> Image.Image:
    """Upscaler.upscale for the Pillow-resampler upscalers (upscaler.py:54-74)."""
    dest = (int((img.width * scale) // 8 * 8), int((img.height * scale) // 8 * 8))
    for i in range(3):
        if img.width >= dest[0] and img.height >= dest[1] and (i > 0 or scale != 1):
            break
        shape = img.size
        img = img.resize((int(img.width * scale), int(img.height * scale)), R[name])
        if shape == img.size:
            break
    if img.size != dest:
        img = img.resize(dest, Image.LANCZOS)
    return img


def main() -> None:
    src, dst, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    if opts['upscaler'] == 'none':
        sys.exit('Upscaler 1 is None: A1111 performs no upscale')
    img = Image.open(src).convert('RGB')
    w, h = img.size
    f, stage, crop = plan(w, h, opts)
    res = upscale(img, f, opts['upscaler'])
    if opts['upscaler2'] != 'none' and opts['visibility'] > 0:
        res = Image.blend(res, upscale(img, f, opts['upscaler2']), opts['visibility'])
    if crop:  # centred paste onto the target canvas: crops overflow, pads (black) any shortfall
        canvas = Image.new('RGB', (opts['width'], opts['height']))
        canvas.paste(res, (opts['width'] // 2 - res.width // 2, opts['height'] // 2 - res.height // 2))
        res = canvas
    res.save(dst, format='PNG')
    print(json.dumps({'src': [w, h], 'stage': list(stage), 'out': list(res.size)}))


if __name__ == '__main__':
    main()
