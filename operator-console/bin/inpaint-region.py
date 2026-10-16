#!/usr/bin/env python3
"""Inpaint geometry helpers (P08) — A1111 "Only masked" crop/paste-back and "Masked content: fill".

  inpaint-region.py region   SRC MASK OUT_IMG OUT_MASK PADDING WORK_W WORK_H [fill]
      crop SRC/MASK to the padded mask box (grown to the work aspect ratio, like A1111's get_crop_region +
      expand_crop_region), resize both to WORK_W x WORK_H, optionally fill the masked area; prints JSON {"box":[x1,y1,x2,y2]}
  inpaint-region.py fill     SRC MASK OUT_IMG                     fill the masked area of the whole image
  inpaint-region.py pasteback GEN SRC MASK X1 Y1 X2 Y2 BLUR        paste GEN (resized to the box) into SRC through the
      blurred mask; the pixels outside the mask are the original's. Overwrites GEN with the full-size result.
Sources are only read (except GEN in pasteback, which the caller hands over as an owned staged copy).
"""
import json
import sys
from PIL import Image, ImageFilter, ImageOps


def crop_region(bbox, padding, work_w, work_h, img_w, img_h):
    x1, y1 = max(bbox[0] - padding, 0), max(bbox[1] - padding, 0)
    x2, y2 = min(bbox[2] + padding, img_w), min(bbox[3] + padding, img_h)
    ratio_crop, ratio_work = (x2 - x1) / (y2 - y1), work_w / work_h
    if ratio_crop > ratio_work:
        desired = (x2 - x1) / ratio_work
        diff = int(desired - (y2 - y1))
        y1 -= diff // 2
        y2 += diff - diff // 2
        if y2 >= img_h:
            d = y2 - img_h
            y2 -= d
            y1 -= d
        if y1 < 0:
            y2 -= y1
            y1 = 0
        if y2 >= img_h:
            y2 = img_h
    else:
        desired = (y2 - y1) * ratio_work
        diff = int(desired - (x2 - x1))
        x1 -= diff // 2
        x2 += diff - diff // 2
        if x2 >= img_w:
            d = x2 - img_w
            x2 -= d
            x1 -= d
        if x1 < 0:
            x2 -= x1
            x1 = 0
        if x2 >= img_w:
            x2 = img_w
    return x1, y1, x2, y2


def fill(image, mask):
    """A1111 masking.fill: replace the masked area with colours diffused in from the unmasked surroundings."""
    image = image.convert("RGB")
    image_mod = Image.new("RGBA", image.size)
    image_masked = Image.new("RGBa", image.size)
    image_masked.paste(image.convert("RGBA").convert("RGBa"), mask=ImageOps.invert(mask.convert("L")))
    image_masked = image_masked.convert("RGBa")
    for radius, repeats in [(256, 1), (64, 1), (16, 2), (4, 4), (2, 2), (0, 1)]:
        blurred = image_masked.filter(ImageFilter.GaussianBlur(radius)).convert("RGBA")
        for _ in range(repeats):
            image_mod.alpha_composite(blurred)
    return image_mod.convert("RGB")


def main(argv):
    cmd = argv[1]
    if cmd == "region":
        src, mask_p, out_img, out_mask, padding, ww, wh = argv[2:9]
        want_fill = len(argv) > 9 and argv[9] == "fill"
        img = Image.open(src).convert("RGB")
        mask = Image.open(mask_p).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.LANCZOS)
        bbox = mask.point(lambda v: 255 if v > 0 else 0).getbbox()
        if not bbox:
            raise SystemExit("empty mask")
        ww, wh = int(ww), int(wh)
        box = crop_region(bbox, int(padding), ww, wh, img.width, img.height)
        ci, cm = img.crop(box), mask.crop(box)
        if want_fill:
            ci = fill(ci, cm)
        ci.resize((ww, wh), Image.LANCZOS).save(out_img, format="PNG")
        cm.resize((ww, wh), Image.LANCZOS).save(out_mask, format="PNG")
        print(json.dumps({"box": list(box)}))
    elif cmd == "fill":
        src, mask_p, out_img = argv[2:5]
        img = Image.open(src).convert("RGB")
        mask = Image.open(mask_p).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.LANCZOS)
        fill(img, mask).save(out_img, format="PNG")
        print("filled")
    elif cmd == "pasteback":
        gen_p, src_p, mask_p = argv[2:5]
        x1, y1, x2, y2, blur = [int(v) for v in argv[5:10]]
        gen = Image.open(gen_p).convert("RGB")
        src = Image.open(src_p).convert("RGB")
        mask = Image.open(mask_p).convert("L")
        if mask.size != src.size:
            mask = mask.resize(src.size, Image.LANCZOS)
        if blur:
            mask = mask.filter(ImageFilter.GaussianBlur(radius=blur))
        box_w, box_h = x2 - x1, y2 - y1
        patch = gen.resize((box_w, box_h), Image.LANCZOS)
        out = src.copy()
        out.paste(patch, (x1, y1), mask.crop((x1, y1, x2, y2)))
        out.save(gen_p, format="PNG")
        print("pasted")
    else:
        raise SystemExit("bad command")


if __name__ == "__main__":
    main(sys.argv)
