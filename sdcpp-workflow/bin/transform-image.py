#!/usr/bin/env python3
"""Nondestructive image transform: rotate / flip / crop. Reads SRC, writes a NEW PNG at DST (never overwrites SRC).
usage: transform-image.py SRC DST '<json ops>'
ops: [{"op":"rotate","degrees":90|180|270}, {"op":"flip","axis":"h"|"v"}, {"op":"crop","x":int,"y":int,"w":int,"h":int}]
Prints one JSON line: {"width":..,"height":..,"ops":n}. Exit 1 with a one-line reason on stderr for any invalid input."""
import json, os, sys
from PIL import Image, ImageOps

MAX_OPS, MAX_SIDE, MIN_CROP = 6, 4096, 8

def die(msg):
    print('transform-invalid: ' + msg, file=sys.stderr); sys.exit(1)

def main():
    if len(sys.argv) != 4: die('usage: SRC DST OPS_JSON')
    src, dst = sys.argv[1], sys.argv[2]
    try: ops = json.loads(sys.argv[3])
    except Exception: die('ops must be JSON')
    if not isinstance(ops, list) or not ops or len(ops) > MAX_OPS: die('1-%d operations required' % MAX_OPS)
    if os.path.realpath(src) == os.path.realpath(dst): die('output must differ from the source')
    if os.path.exists(dst): die('output already exists')
    with Image.open(src) as im0:
        im = ImageOps.exif_transpose(im0) if getattr(im0, 'getexif', None) else im0
        im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
    for o in ops:
        if not isinstance(o, dict): die('operation must be an object')
        k = o.get('op')
        if k == 'rotate':
            d = o.get('degrees')
            if d not in (90, 180, 270): die('rotate degrees must be 90, 180 or 270')
            im = im.rotate(-d, expand=True)          # PIL rotates counter-clockwise; UI degrees are clockwise
        elif k == 'flip':
            a = o.get('axis')
            if a == 'h': im = ImageOps.mirror(im)
            elif a == 'v': im = ImageOps.flip(im)
            else: die('flip axis must be h or v')
        elif k == 'crop':
            try: x, y, w, h = (int(o[n]) for n in ('x', 'y', 'w', 'h'))
            except Exception: die('crop needs integer x, y, w, h')
            W, H = im.size
            if x < 0 or y < 0 or w < MIN_CROP or h < MIN_CROP or x + w > W or y + h > H: die('crop box %d,%d %dx%d is outside the %dx%d image' % (x, y, w, h, W, H))
            im = im.crop((x, y, x + w, y + h))
        else: die('unknown operation')
        if max(im.size) > MAX_SIDE: die('result larger than %d px' % MAX_SIDE)
    tmp = dst + '.part'
    im.save(tmp, format='PNG'); os.replace(tmp, dst)
    print(json.dumps({'width': im.size[0], 'height': im.size[1], 'ops': len(ops)}))

main()
