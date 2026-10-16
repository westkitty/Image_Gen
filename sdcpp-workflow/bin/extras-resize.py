#!/usr/bin/env python3
"""A1111 Extras resize (P09): scale-by / scale-to with crop, upscaler 1 and upscaler 2 blended by visibility.
Usage: extras-resize.py <in.png> <out.png> '<options json>'   (options validated by extras-options.js)
Prints one JSON line {"src":[w,h],"stage":[w,h],"out":[w,h]}. Mirrors public/dexdiffusion/extras-options.js plan()."""
import json, sys
from PIL import Image

R = {'lanczos': Image.LANCZOS, 'bicubic': Image.BICUBIC, 'bilinear': Image.BILINEAR, 'nearest': Image.NEAREST}


def plan(w, h, o):
    f = o['scale'] if o['mode'] == 'by' else max(o['width'] / w, o['height'] / h)
    no_scale = o['upscaler'] == 'none' and (o['upscaler2'] == 'none' or o['visibility'] == 0)
    stage = (w, h) if no_scale else (round_half_up(w * f), round_half_up(h * f))
    return stage, bool(o['mode'] == 'to' and o['crop'])


def round_half_up(x):  # matches JS Math.round for positives
    return int(x + 0.5)


def main():
    src, dst, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
    img = Image.open(src).convert('RGB')
    w, h = img.size
    stage, crop = plan(w, h, opts)

    def scaled(name):
        return img if name == 'none' else img.resize(stage, R[name])

    res = scaled(opts['upscaler'])
    if opts['upscaler2'] != 'none' and opts['visibility'] > 0:
        res = Image.blend(res, scaled(opts['upscaler2']), opts['visibility'])
    if crop:  # centred paste onto the target canvas: crops overflow, pads (black) any shortfall
        canvas = Image.new('RGB', (opts['width'], opts['height']))
        canvas.paste(res, (opts['width'] // 2 - res.width // 2, opts['height'] // 2 - res.height // 2))
        res = canvas
    res.save(dst, format='PNG')
    print(json.dumps({'src': [w, h], 'stage': list(stage), 'out': list(res.size)}))


if __name__ == '__main__':
    main()
