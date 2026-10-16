#!/usr/bin/env python3
"""Prepare an img2img source (P07): A1111 resize modes + transparency flattening. Writes a temporary PNG.

usage: resize-source.py SRC OUT MODE WIDTH HEIGHT BACKGROUND
  MODE resize | crop | fill   (stable-diffusion-webui images.resize_image modes 0/1/2, PIL LANCZOS)
  BACKGROUND #rrggbb          colour transparent pixels are flattened onto (img2img_background_color)
Prints "<width> <height>". The source is only read.
"""
import sys
from PIL import Image


def flatten(im, bg):
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, bg)
        base.alpha_composite(im)
        return base.convert("RGB")
    return im.convert("RGB")


def resize_image(mode, im, w, h):
    if mode == "resize":
        return im.resize((w, h), resample=Image.LANCZOS)
    ratio = w / h
    src_ratio = im.width / im.height
    if mode == "crop":
        src_w = w if ratio > src_ratio else im.width * h // im.height
        src_h = h if ratio <= src_ratio else im.height * w // im.width
        resized = im.resize((src_w, src_h), resample=Image.LANCZOS)
        res = Image.new("RGB", (w, h))
        res.paste(resized, box=(w // 2 - src_w // 2, h // 2 - src_h // 2))
        return res
    # fill
    src_w = w if ratio < src_ratio else im.width * h // im.height
    src_h = h if ratio >= src_ratio else im.height * w // im.width
    resized = im.resize((src_w, src_h), resample=Image.LANCZOS)
    res = Image.new("RGB", (w, h))
    res.paste(resized, box=(w // 2 - src_w // 2, h // 2 - src_h // 2))
    if ratio < src_ratio:
        fill_height = h // 2 - src_h // 2
        if fill_height > 0:
            res.paste(resized.resize((w, fill_height), box=(0, 0, w, 0)), box=(0, 0))
            res.paste(resized.resize((w, fill_height), box=(0, resized.height, w, resized.height)), box=(0, fill_height + src_h))
    elif ratio > src_ratio:
        fill_width = w // 2 - src_w // 2
        if fill_width > 0:
            res.paste(resized.resize((fill_width, h), box=(0, 0, 0, h)), box=(0, 0))
            res.paste(resized.resize((fill_width, h), box=(resized.width, 0, resized.width, h)), box=(fill_width + src_w, 0))
    return res


def main(argv):
    src, out, mode, w, h, bg = argv[1:7]
    if mode not in ("resize", "crop", "fill"):
        raise SystemExit("bad mode")
    bg_rgb = tuple(int(bg[i:i + 2], 16) for i in (1, 3, 5))
    im = flatten(Image.open(src), bg_rgb)
    res = resize_image(mode, im, int(w), int(h))
    res.save(out, format="PNG")
    print(res.width, res.height)


if __name__ == "__main__":
    main(sys.argv)
