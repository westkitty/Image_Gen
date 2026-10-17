#!/usr/bin/env python3
"""Faithful ports of AUTOMATIC1111's two stock outpainting scripts, as building blocks around an inpaint step.

Upstream: AUTOMATIC1111/stable-diffusion-webui @ 82a973c04367123ae98bd9abdf80d9eda9b910e2
  scripts/poor_mans_outpainting.py  (cited as PM:<line>)
  scripts/outpainting_mk_2.py       (cited as MK2:<line>)
  modules/images.py split_grid/combine_grid (IM:<line>), modules/masking.py fill (MASK:<line>),
  modules/processing.py img2img mask blur / fill (PROC:<line>)

Pure Python 3 + Pillow, no numpy. White (255) in every mask means "repaint". Inputs are only ever read.

Poor man's outpainting (expand once, inpaint overlapping tiles, blend them back):
  poor-plan    (--source IMG | --size WxH) --pixels N --directions left,right,up,down --mask-blur N
               --masked-content fill|original [--tile-w 512 --tile-h 512] [--geometry-only] --out-dir DIR
      writes expanded.png, mask.png, latent_mask.png and, per tile that upstream processes, tile_NNN_init.png (masked
      content "fill" already applied, as PROC:1696), tile_NNN_mask.png (binary), tile_NNN_mask_blurred.png (the mask
      as PROC:1621-1631 blurs it, for compositing) and tile_NNN_latent_mask.png; plan.json lists every work item.
  poor-combine --plan plan.json --expanded expanded.png --results-dir DIR --out PNG [--allow-missing]
      DIR holds tile_NNN_result.png for each work item; tiles upstream skips come from the expanded image (PM:128-138).
Outpainting mk2 (expand one direction at a time with spectrum-matched noise, inpaint, repeat in left,right,up,down order):
  mk2-plan     (--source IMG | --size WxH) --pixels N --directions ... --mask-blur N --work-w W --work-h H
      geometry of every step (sizes, crop boxes, mask rectangles), no images.
  mk2-prepare  --source CURRENT.png --direction left|right|up|down [--orig-size WxH] --pixels N --directions ...
               --mask-blur N --noise-q Q --color-variation V [--seed S] --work-w W --work-h H --out-dir DIR
      writes full.png (noise-filled expanded canvas), init.png (crop to inpaint), mask.png, mask_blurred.png,
      latent_mask.png, step.json (also printed).
  mk2-finish   --full full.png --processed RESULT.png --step step.json --out PNG
      pastes the inpainted crop back and crops to the step's result size (MK2:252-254).
Errors: JSON {"error": ...} on stderr, exit status 2.
"""
from __future__ import annotations

import argparse
import cmath
import json
import math
import os
import sys
import time
from bisect import bisect_right
from collections import Counter
from operator import add as _add, sub as _sub
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from PIL import Image, ImageDraw, ImageFilter, ImageOps

DIRECTIONS = ("left", "right", "up", "down")
MASKED_CONTENT_RUNNABLE = ("fill", "original")
MASKED_CONTENT_ALL = ("fill", "original", "latent noise", "latent nothing")
# Slider ranges copied from the upstream gr.Slider definitions (PM:23-24, MK2:134-138).
RANGES = {
    "pixels": (8, 256, 8),
    "mask_blur": (0, 64, 1),
    "noise_q": (0.0, 4.0, 0.01),
    "color_variation": (0.0, 1.0, 0.01),
}


class CliError(Exception):
    """A user-facing failure: printed as JSON on stderr, exit status 2."""


# --------------------------------------------------------------------------------------------------------------
# option validation
# --------------------------------------------------------------------------------------------------------------

def parse_directions(text: str) -> List[str]:
    out = [d.strip().lower() for d in text.split(",") if d.strip()]
    for d in out:
        if d not in DIRECTIONS:
            raise CliError("direction must be any of left,right,up,down (got %r)" % d)
    if not out:
        raise CliError("at least one outpainting direction is required (upstream's behaviour with none selected is undefined)")
    return [d for d in DIRECTIONS if d in out]


def check_slider(name: str, value: float) -> None:
    lo, hi, step = RANGES[name]
    if value < lo or value > hi:
        raise CliError("%s must be between %s and %s" % (name, lo, hi))
    k = (value - lo) / step
    if abs(k - round(k)) > 1e-6:
        raise CliError("%s must be a multiple of %s" % (name, step))


def normalize_masked_content(value: str) -> str:
    v = value.strip().lower().replace("_", " ")
    if v not in MASKED_CONTENT_ALL:
        raise CliError("masked content must be one of %s" % ", ".join(MASKED_CONTENT_ALL))
    if v not in MASKED_CONTENT_RUNNABLE:
        raise CliError('masked content "%s" is not available: sd-cli cannot initialise the masked latent with noise or nothing' % v)
    return v


def parse_size(text: str) -> Tuple[int, int]:
    try:
        w, h = [int(p) for p in text.lower().split("x")]
    except ValueError:
        raise CliError("size must look like 512x512")
    if w < 1 or h < 1:
        raise CliError("size must be positive")
    return w, h


# --------------------------------------------------------------------------------------------------------------
# shared geometry (PM:38-56 and MK2:153-185 are the same computation)
# --------------------------------------------------------------------------------------------------------------

def ceil64(v: int) -> int:
    return -(-v // 64) * 64


def expansion(src_w: int, src_h: int, pixels: int, directions: Sequence[str]) -> Dict[str, int]:
    """PM:38-56 / MK2:153-185: requested pixels per side, grown so the result is a multiple of 64 and split in proportion."""
    left = pixels if "left" in directions else 0
    right = pixels if "right" in directions else 0
    up = pixels if "up" in directions else 0
    down = pixels if "down" in directions else 0
    target_w = ceil64(src_w + left + right)
    target_h = ceil64(src_h + up + down)
    if left > 0:
        left = left * (target_w - src_w) // (left + right)
    if right > 0:
        right = target_w - src_w - left
    if up > 0:
        up = up * (target_h - src_h) // (up + down)
    if down > 0:
        down = target_h - src_h - up
    return {"left": left, "right": right, "up": up, "down": down, "target_w": target_w, "target_h": target_h}


def rect_checked(rect: Tuple[int, int, int, int], what: str) -> Tuple[int, int, int, int]:
    # Pillow >= 9 raises for x1 < x0 in ImageDraw.rectangle; upstream crashes there, so we report it clearly instead.
    if rect[2] < rect[0] or rect[3] < rect[1]:
        raise CliError("%s rectangle is degenerate %s: pixels too small for this mask blur" % (what, list(rect)))
    return rect


def fill_rect(size: Tuple[int, int], rect: Tuple[int, int, int, int]) -> Image.Image:
    """White canvas with the (inclusive, as PIL draws it) rectangle black: black = keep, white = repaint."""
    mask = Image.new("L", size, 255)
    ImageDraw.Draw(mask).rectangle(rect, fill=0)
    return mask


# --------------------------------------------------------------------------------------------------------------
# mask blur: OpenCV GaussianBlur emulation for rectangle masks (PROC:1621-1631)
# --------------------------------------------------------------------------------------------------------------

def _reflect101(i: int, n: int) -> int:
    if n == 1:
        return 0
    period = 2 * (n - 1)
    i %= period
    return period - i if i >= n else i


def _gauss_kernel(sigma: float) -> List[float]:
    # PROC:1623 kernel_size = 2 * int(2.5 * sigma + 0.5) + 1 ; cv2.getGaussianKernel(ksize, sigma)
    radius = int(2.5 * sigma + 0.5)
    k = [math.exp(-(i * i) / (2.0 * sigma * sigma)) for i in range(-radius, radius + 1)]
    total = sum(k)
    return [v / total for v in k]


def _blur_indicator(ind: Sequence[int], sigma: float) -> List[float]:
    n = len(ind)
    if sigma <= 0:
        return [float(v) for v in ind]
    ker = _gauss_kernel(sigma)
    radius = len(ker) // 2
    out = []
    for i in range(n):
        acc = 0.0
        for j, w in enumerate(ker):
            acc += w * ind[_reflect101(i + j - radius, n)]
        out.append(acc)
    return out


def _round_u8(v: float) -> int:
    return max(0, min(255, int(round(v))))


def blur_rect_mask(size: Tuple[int, int], rect: Tuple[int, int, int, int], sigma_x: float, sigma_y: float) -> Image.Image:
    """The mask 'white everywhere except an inclusive black rectangle', blurred like processing.py does:
    GaussianBlur((k,1), sigma_x) then GaussianBlur((1,k), sigma_y), each result rounded to uint8, reflect-101 borders.
    The rectangle is separable (ind_x * ind_y), so each pass is a 1-D blur of an indicator: exact up to OpenCV's
    fixed-point rounding (+-1 grey level), and fast for any sigma. The rectangle may be clipped by / outside the image."""
    w, h = size
    x0, y0, x1, y1 = rect
    ix = [1 if x0 <= x <= x1 else 0 for x in range(w)]
    iy = [1 if y0 <= y <= y1 else 0 for y in range(h)]
    if not any(ix) or not any(iy):
        return Image.new("L", size, 255)
    bx = _blur_indicator(ix, sigma_x)
    by = _blur_indicator(iy, sigma_y)
    # after the x pass (rounded to uint8): rows inside the rectangle hold r1[x], all other rows 255
    r1 = [_round_u8(255.0 * (1.0 - v)) for v in bx]
    data = bytearray()
    outside_row = bytes([255]) * w
    cache: Dict[float, bytes] = {}
    for y in range(h):
        if sigma_y <= 0:
            data += bytes(r1) if iy[y] else outside_row
            continue
        q = by[y]
        row = cache.get(q)
        if row is None:
            row = bytes(_round_u8(255.0 - (255.0 - r1v) * q) for r1v in r1)
            cache[q] = row
        data += row
    return Image.frombytes("L", size, bytes(data))


# --------------------------------------------------------------------------------------------------------------
# masking.fill (MASK:80-95), same as bin/inpaint-region.py
# --------------------------------------------------------------------------------------------------------------

def masking_fill(image: Image.Image, mask: Image.Image) -> Image.Image:
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


# --------------------------------------------------------------------------------------------------------------
# images.split_grid / combine_grid (IM:78-141)
# --------------------------------------------------------------------------------------------------------------

def split_grid_layout(w: int, h: int, tile_w: int, tile_h: int, overlap: int) -> Dict[str, object]:
    """IM:78-111 geometry only: rows of [x, tile_w] and row origins y (tile boxes may start negative when the image is smaller than a tile)."""
    non_overlap_width = tile_w - overlap
    non_overlap_height = tile_h - overlap
    if non_overlap_width <= 0 or non_overlap_height <= 0:
        raise CliError("pixels (tile overlap) must be smaller than the tile size (upstream divides by zero)")
    cols = math.ceil((w - overlap) / non_overlap_width)
    rows = math.ceil((h - overlap) / non_overlap_height)
    dx = (w - tile_w) / (cols - 1) if cols > 1 else 0
    dy = (h - tile_h) / (rows - 1) if rows > 1 else 0
    ys: List[int] = []
    xs: List[int] = []
    for row in range(rows):
        y = int(row * dy)
        if y + tile_h >= h:
            y = h - tile_h
        ys.append(y)
    for col in range(cols):
        x = int(col * dx)
        if x + tile_w >= w:
            x = w - tile_w
        xs.append(x)
    return {"cols": cols, "rows": rows, "xs": xs, "ys": ys}


def combine_grid(tiles: List[Tuple[int, int, List[Tuple[int, int, Image.Image]]]], image_w: int, image_h: int,
                 tile_h: int, overlap: int) -> Image.Image:
    """IM:114-141. tiles = [(y, h, [(x, w, tile_image), ...]), ...]."""
    ramp = [(i * 255) // overlap for i in range(overlap)]  # IM:116-118 (float32 arange*255/overlap, truncated to uint8)
    mask_w = Image.new("L", (overlap, tile_h))
    mask_w.putdata(ramp * tile_h)
    mask_h = Image.new("L", (image_w, overlap))
    mask_h.putdata([v for v in ramp for _ in range(image_w)])
    combined_image = Image.new("RGB", (image_w, image_h))
    for y, h, row in tiles:
        combined_row = Image.new("RGB", (image_w, h))
        for x, w, tile in row:
            if x == 0:
                combined_row.paste(tile, (0, 0))
                continue
            combined_row.paste(tile.crop((0, 0, overlap, h)), (x, 0), mask=mask_w)
            combined_row.paste(tile.crop((overlap, 0, w, h)), (x + overlap, 0))
        if y == 0:
            combined_image.paste(combined_row, (0, 0))
            continue
        combined_image.paste(combined_row.crop((0, 0, combined_row.width, overlap)), (0, y), mask=mask_h)
        combined_image.paste(combined_row.crop((0, overlap, combined_row.width, h)), (0, y + overlap))
    return combined_image


# --------------------------------------------------------------------------------------------------------------
# poor man's outpainting
# --------------------------------------------------------------------------------------------------------------

def poor_geometry(src_w: int, src_h: int, pixels: int, directions: Sequence[str], mask_blur: int,
                  tile_w: int, tile_h: int) -> Dict[str, object]:
    """Everything poor-plan derives from sizes alone (PM:34-107)."""
    ex = expansion(src_w, src_h, pixels, directions)
    left, right, up, down = ex["left"], ex["right"], ex["up"], ex["down"]
    tw, th = ex["target_w"], ex["target_h"]
    # PM:63-68 mask rectangle (mask_blur*2 inset on the expanded sides), PM:72-77 latent mask (mask_blur//2 inset)
    mask_rect = rect_checked((
        left + (mask_blur * 2 if left > 0 else 0),
        up + (mask_blur * 2 if up > 0 else 0),
        tw - right - (mask_blur * 2 if right > 0 else 0),
        th - down - (mask_blur * 2 if down > 0 else 0)), "mask")
    latent_rect = rect_checked((
        left + (mask_blur // 2 if left > 0 else 0),
        up + (mask_blur // 2 if up > 0 else 0),
        tw - right - (mask_blur // 2 if right > 0 else 0),
        th - down - (mask_blur // 2 if down > 0 else 0)), "latent mask")
    layout = split_grid_layout(tw, th, tile_w, tile_h, pixels)  # PM:81 overlap=pixels
    tiles = []
    work = 0
    for r, y in enumerate(layout["ys"]):
        for c, x in enumerate(layout["xs"]):
            # PM:99 tiles lying fully inside the original image are skipped
            inside = x >= left and x + tile_w <= tw - right and y >= up and y + tile_h <= th - down
            tiles.append({"row": r, "col": c, "x": x, "y": y, "w": tile_w, "h": tile_h, "process": not inside,
                          "work_index": None if inside else work})
            if not inside:
                work += 1
    return {
        "src_w": src_w, "src_h": src_h, "pixels": pixels, "directions": list(directions), "mask_blur": mask_blur,
        "left": left, "right": right, "up": up, "down": down, "target_w": tw, "target_h": th,
        "mask_rect": list(mask_rect), "latent_rect": list(latent_rect),
        "mask_blur_sigma": mask_blur * 2,  # PM:34 p.mask_blur = mask_blur * 2
        "overlap": pixels, "tile_w": tile_w, "tile_h": tile_h, "cols": layout["cols"], "rows": layout["rows"],
        "tiles": tiles, "work_count": work,
    }


def _check_outputs(sources: Iterable[Optional[str]], outputs: Iterable[str]) -> None:
    srcs = {os.path.realpath(s) for s in sources if s}
    for o in outputs:
        if os.path.realpath(o) in srcs:
            raise CliError("refusing to overwrite an input: %s" % o)


def cmd_poor_plan(args: argparse.Namespace) -> Dict[str, object]:
    directions = parse_directions(args.directions)
    check_slider("pixels", args.pixels)
    check_slider("mask_blur", args.mask_blur)
    content = normalize_masked_content(args.masked_content)
    if args.source:
        src = Image.open(args.source)
        src.load()
        src_w, src_h = src.size
    elif args.size:
        src, (src_w, src_h) = None, parse_size(args.size)
    else:
        raise CliError("--source or --size is required")
    plan = poor_geometry(src_w, src_h, args.pixels, directions, args.mask_blur, args.tile_w, args.tile_h)
    plan["masked_content"] = content
    if args.geometry_only:
        return plan
    if src is None or not args.out_dir:
        raise CliError("--source and --out-dir are required unless --geometry-only")
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    _check_outputs([args.source], [os.path.join(out_dir, n) for n in ("expanded.png", "mask.png", "latent_mask.png", "plan.json")])

    left, up = plan["left"], plan["up"]
    img = Image.new("RGB", (plan["target_w"], plan["target_h"]))  # PM:58
    img.paste(src.convert("RGB"), (left, up))                       # PM:59
    mask = fill_rect(img.size, tuple(plan["mask_rect"]))            # PM:61-68
    latent_mask = fill_rect(img.size, tuple(plan["latent_rect"]))   # PM:70-77
    img.save(os.path.join(out_dir, "expanded.png"), format="PNG")
    mask.save(os.path.join(out_dir, "mask.png"), format="PNG")
    latent_mask.save(os.path.join(out_dir, "latent_mask.png"), format="PNG")
    plan["expanded"] = "expanded.png"
    plan["mask"] = "mask.png"
    plan["latent_mask"] = "latent_mask.png"

    sigma = plan["mask_blur_sigma"]
    mrect = plan["mask_rect"]
    for t in plan["tiles"]:
        if not t["process"]:
            continue
        box = (t["x"], t["y"], t["x"] + t["w"], t["y"] + t["h"])
        name = "tile_%03d" % t["work_index"]
        tile_img = img.crop(box)           # IM:105 (PIL crop pads out-of-range with black)
        tile_mask = mask.crop(box)
        tile_latent = latent_mask.crop(box)
        if content == "fill":              # PROC:1696-1697, per tile with the tile's latent mask
            tile_img = masking_fill(tile_img, tile_latent)
        blurred = blur_rect_mask((t["w"], t["h"]), (mrect[0] - t["x"], mrect[1] - t["y"], mrect[2] - t["x"], mrect[3] - t["y"]), sigma, sigma)
        tile_img.save(os.path.join(out_dir, name + "_init.png"), format="PNG")
        tile_mask.save(os.path.join(out_dir, name + "_mask.png"), format="PNG")
        blurred.save(os.path.join(out_dir, name + "_mask_blurred.png"), format="PNG")
        tile_latent.save(os.path.join(out_dir, name + "_latent_mask.png"), format="PNG")
        t.update({"init": name + "_init.png", "mask": name + "_mask.png", "mask_blurred": name + "_mask_blurred.png",
                  "latent_mask": name + "_latent_mask.png", "result": name + "_result.png",
                  "seed_offset": t["work_index"]})  # PM:123 p.seed = processed.seed + 1 per tile
    with open(os.path.join(out_dir, "plan.json"), "w") as fh:
        json.dump(plan, fh, indent=1)
    return plan


def cmd_poor_combine(args: argparse.Namespace) -> Dict[str, object]:
    with open(args.plan) as fh:
        plan = json.load(fh)
    expanded = Image.open(args.expanded).convert("RGB")
    if expanded.size != (plan["target_w"], plan["target_h"]):
        raise CliError("expanded image size %s does not match the plan %sx%s" % (expanded.size, plan["target_w"], plan["target_h"]))
    _check_outputs([args.expanded, args.plan], [args.out])
    tile_w, tile_h = plan["tile_w"], plan["tile_h"]
    rows: Dict[int, Tuple[int, int, List[Tuple[int, int, Image.Image]]]] = {}
    for t in plan["tiles"]:
        box = (t["x"], t["y"], t["x"] + t["w"], t["y"] + t["h"])
        if t["process"]:
            path = os.path.join(args.results_dir, t["result"])
            if os.path.exists(path):
                tile = Image.open(path).convert("RGB")
                if tile.size != (tile_w, tile_h):
                    raise CliError("%s is %dx%d, expected %dx%d" % (t["result"], tile.width, tile.height, tile_w, tile_h))
            elif args.allow_missing:
                tile = Image.new("RGB", (tile_w, tile_h))  # PM:135 upstream substitutes a black tile
            else:
                raise CliError("missing result tile %s" % t["result"])
        else:
            tile = expanded.crop(box)                       # PM:132 untouched tiles keep the expanded image
        entry = rows.setdefault(t["row"], (t["y"], t["h"], []))
        entry[2].append((t["x"], t["w"], tile))
    ordered = [rows[r] for r in sorted(rows)]
    combined = combine_grid(ordered, plan["target_w"], plan["target_h"], tile_h, plan["overlap"])  # PM:138
    combined.save(args.out, format="PNG")
    return {"out": args.out, "size": [combined.width, combined.height]}


# --------------------------------------------------------------------------------------------------------------
# pure Python FFT. Row-vector formulation: every butterfly operates on a whole row at once, so the Python loop
# count is O(n log n) per axis while the per-element work stays inside list comprehensions.
# Complexity of a 2-D transform of H x W: O(H*W*(log H + log W)) for smooth sizes (factors <= 31, e.g. all
# multiples of 64 such as 640 = 2^7*5), O(H*W*(log H + log W)) with a ~6x constant for sizes with a large prime
# factor (Bluestein chirp-z).
# --------------------------------------------------------------------------------------------------------------

_TW_CACHE: Dict[Tuple[int, int], List[complex]] = {}


def _twiddles(n: int, sign: int) -> List[complex]:
    key = (n, sign)
    tw = _TW_CACHE.get(key)
    if tw is None:
        tw = [cmath.exp(sign * 2j * math.pi * k / n) for k in range(n)]
        _TW_CACHE[key] = tw
    return tw


def _smallest_factor(n: int) -> int:
    if n % 2 == 0:
        return 2
    f = 3
    while f * f <= n:
        if n % f == 0:
            return f
        f += 2
    return n


def _largest_factor(n: int) -> int:
    best = 1
    while n > 1:
        f = _smallest_factor(n)
        best = max(best, f)
        n //= f
    return best


Rows = List[List[complex]]


def _fft_rows(rows: Rows, sign: int) -> Rows:
    """Unnormalised DFT along the row index (sign=-1 forward, +1 inverse) of a list of equal-length rows."""
    n = len(rows)
    if n == 1:
        return rows
    if _largest_factor(n) > 31:
        return _bluestein_rows(rows, sign)
    p = _smallest_factor(n)
    q = n // p
    subs = [_fft_rows(rows[r::p], sign) for r in range(p)]
    tw = _twiddles(n, sign)
    out: List[Optional[List[complex]]] = [None] * n
    if p == 2:
        a, b = subs
        for k in range(q):
            ra, rb = a[k], b[k]
            if k:
                rb = list(map(tw[k].__mul__, rb))
            out[k] = list(map(_add, ra, rb))
            out[k + q] = list(map(_sub, ra, rb))
        return out  # type: ignore[return-value]
    wp = _twiddles(p, sign)
    for k in range(q):
        t = [subs[0][k]]
        for r in range(1, p):
            t.append(list(map(tw[(r * k) % n].__mul__, subs[r][k])))
        for s in range(p):
            acc = t[0]
            for r in range(1, p):
                c = wp[(r * s) % p]
                acc = list(map(_add, acc, map(c.__mul__, t[r])))
            out[k + q * s] = acc
    return out  # type: ignore[return-value]


def _bluestein_rows(rows: Rows, sign: int) -> Rows:
    n = len(rows)
    m = 1
    while m < 2 * n - 1:
        m *= 2
    chirp = [cmath.exp(sign * 1j * math.pi * ((k * k) % (2 * n)) / n) for k in range(n)]
    width = len(rows[0])
    zero = [0j] * width
    a = [[chirp[k] * x for x in rows[k]] for k in range(n)] + [zero] * (m - n)
    b = [0j] * m
    for k in range(n):
        b[k] = chirp[k].conjugate()
        if k:
            b[m - k] = b[k]
    fa = _fft_rows(a, -1)
    fb = _fft_rows([[v] for v in b], -1)
    prod = [[x * fb[i][0] for x in fa[i]] for i in range(m)]
    conv = _fft_rows(prod, +1)
    inv_m = 1.0 / m
    return [[chirp[k] * inv_m * x for x in conv[k]] for k in range(n)]


def _transpose(rows: Rows) -> Rows:
    return [list(col) for col in zip(*rows)]


def fft2(plane: Rows, inverse: bool = False) -> Rows:
    """2-D DFT of an H x W plane, numpy.fft.fft2/ifft2 with norm='ortho' (1/sqrt(H*W) on both directions)."""
    sign = 1 if inverse else -1
    h, w = len(plane), len(plane[0])
    scale = 1.0 / math.sqrt(h * w)
    cols_done = _fft_rows([[complex(v) for v in row] for row in plane], sign)
    rows_done = _transpose(_fft_rows(_transpose(cols_done), sign))
    return [[v * scale for v in row] for row in rows_done]


def _roll(plane: Rows, sy: int, sx: int) -> Rows:
    h, w = len(plane), len(plane[0])
    sy %= h
    sx %= w
    rows = plane[h - sy:] + plane[:h - sy] if sy else plane
    if sx:
        rows = [r[w - sx:] + r[:w - sx] for r in rows]
    return rows


def shifted_fft2(plane: Rows) -> Rows:
    """MK2:17-30 _fft2 for one channel: fftshift -> fft2(ortho) -> ifftshift."""
    h, w = len(plane), len(plane[0])
    return _roll(fft2(_roll(plane, h // 2, w // 2)), -(h // 2), -(w // 2))


def shifted_ifft2(plane: Rows) -> Rows:
    """MK2:32-44 _ifft2 for one channel: fftshift -> ifft2(ortho) -> ifftshift (upstream uses fftshift first, kept as is)."""
    h, w = len(plane), len(plane[0])
    return _roll(fft2(_roll(plane, h // 2, w // 2), inverse=True), -(h // 2), -(w // 2))


def _neg_index(plane: Rows) -> Rows:
    """plane[(-k1) % H][(-k2) % W]."""
    return [[r[0]] + r[:0:-1] for r in ([plane[0]] + plane[:0:-1])]


def fft_real_planes(planes: Sequence[Plane]) -> List[Rows]:
    """shifted_fft2 of several REAL planes, two per complex transform (A = (Z + conj Z[-k]) / 2, B = (Z - conj Z[-k]) / 2i)."""
    out: List[Rows] = []
    for i in range(0, len(planes), 2):
        a = planes[i]
        if i + 1 >= len(planes):
            out.append(shifted_fft2(a))
            continue
        b = planes[i + 1]
        h, w = len(a), len(a[0])
        z = fft2(_roll([[complex(x, y) for x, y in zip(ra, rb)] for ra, rb in zip(a, b)], h // 2, w // 2))
        zc = [[v.conjugate() for v in row] for row in _neg_index(z)]
        fa = [[(u + v) * 0.5 for u, v in zip(rz, rc)] for rz, rc in zip(z, zc)]
        fb = [[(u - v) * -0.5j for u, v in zip(rz, rc)] for rz, rc in zip(z, zc)]
        out.append(_roll(fa, -(h // 2), -(w // 2)))
        out.append(_roll(fb, -(h // 2), -(w // 2)))
    return out


def ifft_real_parts(specs: Sequence[Rows]) -> List[Plane]:
    """[real(shifted_ifft2(s)) for s in specs], two spectra per complex transform: re(ifft2(Z)) = ifft2(Hermitian part of Z)."""
    out: List[Plane] = []
    for i in range(0, len(specs), 2):
        h, w = len(specs[i]), len(specs[i][0])
        if i + 1 >= len(specs):
            out.append([[v.real for v in row] for row in shifted_ifft2(specs[i])])
            continue
        herm = []
        for s in (specs[i], specs[i + 1]):
            z = _roll(s, h // 2, w // 2)
            zc = _neg_index(z)
            herm.append([[(u + v.conjugate()) * 0.5 for u, v in zip(rz, rc)] for rz, rc in zip(z, zc)])
        comb = [[u + 1j * v for u, v in zip(ra, rb)] for ra, rb in zip(herm[0], herm[1])]
        res = _roll(fft2(comb, inverse=True), -(h // 2), -(w // 2))
        out.append([[v.real for v in row] for row in res])
        out.append([[v.imag for v in row] for row in res])
    return out


def naive_dft2(plane: Rows, inverse: bool = False) -> Rows:
    """O((HW)^2) reference used by the tests."""
    h, w = len(plane), len(plane[0])
    sign = 1 if inverse else -1
    scale = 1.0 / math.sqrt(h * w)
    out = []
    for ky in range(h):
        row = []
        for kx in range(w):
            acc = 0j
            for y in range(h):
                for x in range(w):
                    acc += plane[y][x] * cmath.exp(sign * 2j * math.pi * (ky * y / h + kx * x / w))
            row.append(acc * scale)
        out.append(row)
    return out


# --------------------------------------------------------------------------------------------------------------
# numpy.random.default_rng(seed).random(), bit-exact (SeedSequence + PCG64 XSL-RR, 53-bit doubles)
# --------------------------------------------------------------------------------------------------------------

_M32 = 0xFFFFFFFF
_M64 = 0xFFFFFFFFFFFFFFFF
_M128 = (1 << 128) - 1
_PCG_MULT = 0x2360ED051FC65DA44385DF649FCCF645


def _seed_sequence_state(seed: int) -> List[int]:
    """numpy SeedSequence(seed).generate_state(4, uint64) (bit_generator.pyx)."""
    words: List[int] = []
    s = seed
    while True:
        words.append(s & _M32)
        s >>= 32
        if not s:
            break
    pool_size = 4
    pool = [0] * pool_size
    hc = 0x43B0D7E5
    mult_a, mult_b = 0x931E8875, 0x58F38DED

    def hashmix(value: int) -> int:
        nonlocal hc
        value = (value ^ hc) & _M32
        hc = (hc * mult_a) & _M32
        value = (value * hc) & _M32
        return value ^ (value >> 16)

    def mix(x: int, y: int) -> int:
        r = (0xCA01F9DD * x - 0x4973F715 * y) & _M32
        return r ^ (r >> 16)

    for i in range(pool_size):
        pool[i] = hashmix(words[i] if i < len(words) else 0)
    for i_src in range(pool_size):
        for i_dst in range(pool_size):
            if i_src != i_dst:
                pool[i_dst] = mix(pool[i_dst], hashmix(pool[i_src]))
    for i_src in range(pool_size, len(words)):
        for i_dst in range(pool_size):
            pool[i_dst] = mix(pool[i_dst], hashmix(words[i_src]))
    hb = 0x8B51F9DD
    out32 = []
    for i_dst in range(8):
        v = pool[i_dst % pool_size]
        v = (v ^ hb) & _M32
        hb = (hb * mult_b) & _M32
        v = (v * hb) & _M32
        v ^= v >> 16
        out32.append(v)
    return [out32[2 * j] | (out32[2 * j + 1] << 32) for j in range(4)]


class Pcg64Random:
    """numpy.random.default_rng(seed) restricted to .random() doubles."""

    def __init__(self, seed: int) -> None:
        if seed < 0:
            raise CliError("seed must be >= 0")
        val = _seed_sequence_state(seed)
        init_state = (val[0] << 64) | val[1]
        init_seq = (val[2] << 64) | val[3]
        self.inc = ((init_seq << 1) | 1) & _M128
        self.state = 0
        self._step()
        self.state = (self.state + init_state) & _M128
        self._step()

    def _step(self) -> None:
        self.state = (self.state * _PCG_MULT + self.inc) & _M128

    def next_u64(self) -> int:
        st = (self.state * _PCG_MULT + self.inc) & _M128
        self.state = st
        x = ((st >> 64) ^ st) & _M64
        rot = st >> 122
        return ((x >> rot) | (x << ((-rot) & 63))) & _M64

    def doubles(self, count: int) -> List[float]:
        mult, inc = _PCG_MULT, self.inc
        st = self.state
        out = []
        append = out.append
        scale = 1.0 / 9007199254740992.0
        for _ in range(count):
            st = (st * mult + inc) & _M128
            x = ((st >> 64) ^ st) & _M64
            rot = st >> 122
            append(((((x >> rot) | (x << ((-rot) & 63))) & _M64) >> 11) * scale)
        self.state = st
        return out


# --------------------------------------------------------------------------------------------------------------
# outpainting mk2: get_matched_noise (MK2:16-117)
# --------------------------------------------------------------------------------------------------------------

Plane = List[List[float]]


def _gaussian_window_mode1(n0: int, n1: int, std: float = 3.14) -> Plane:
    """MK2:46-59 with mode=1 (the call at MK2:91). Axis 0 has n0 samples ('width' in upstream's naming), axis 1 has n1."""
    scale0 = float(n0 / min(n0, n1))
    scale1 = float(n1 / min(n0, n1))
    ax = [((i / n0 * 2.0 - 1.0) * scale0) ** 2 + 1.0 for i in range(n0)]
    ay = [((j / n1 * 2.0 - 1.0) * scale1) ** 2 + 1.0 for j in range(n1)]
    e = std / 3.14
    return [[(1.0 / (a * b)) ** e for b in ay] for a in ax]


def _match_channel(source: List[float], template: List[float]) -> List[float]:
    """skimage.exposure.histogram_matching._match_cumulative_cdf for one channel."""
    src_counts = Counter(source)
    tmpl_counts = Counter(template)
    src_values = sorted(src_counts)
    tmpl_values = sorted(tmpl_counts)
    n_src, n_tmpl = len(source), len(template)
    src_q: List[float] = []
    acc = 0
    for v in src_values:
        acc += src_counts[v]
        src_q.append(acc / n_src)
    tmpl_q: List[float] = []
    acc = 0
    for v in tmpl_values:
        acc += tmpl_counts[v]
        tmpl_q.append(acc / n_tmpl)
    last = len(tmpl_q) - 1
    mapped: Dict[float, float] = {}
    for v, x in zip(src_values, src_q):  # numpy.interp(x, tmpl_q, tmpl_values)
        if x <= tmpl_q[0]:
            y = tmpl_values[0]
        elif x >= tmpl_q[last]:
            y = tmpl_values[last]
        else:
            j = bisect_right(tmpl_q, x) - 1
            slope = (tmpl_values[j + 1] - tmpl_values[j]) / (tmpl_q[j + 1] - tmpl_q[j])
            y = slope * (x - tmpl_q[j]) + tmpl_values[j]
        mapped[v] = y
    return [mapped[v] for v in source]


def get_matched_noise(src: List[Plane], mask: Plane, noise_q: float = 1.0, color_variation: float = 0.05, seed: int = 0) -> List[Plane]:
    """Port of MK2:16-117. src = 3 planes (H rows x W floats in 0..1, upstream's `_np_src_image`), mask = H x W of 0/1
    (white = new area). Returns 3 planes in 0..1. `seed` replaces upstream's constant default_rng(0) (MK2:89); seed 0
    reproduces upstream's stream exactly. Deviation: a zero-magnitude src spectrum bin gets phase 1 (upstream: NaN)."""
    h, w = len(src[0]), len(src[0][0])
    nch = len(src)
    grey = [[(m + m + m) / 3.0 for m in row] for row in mask]            # MK2:76
    img_sel = [[g > 1e-6 for g in row] for row in grey]                  # MK2:77
    ref_sel = [[g < 1e-3 for g in row] for row in grey]                  # MK2:78

    # MK2:80-82 windowed image: unmasked pixels, normalised by the global max, masked area = average of the whole src image
    windowed = [[[v * (1.0 - g) for v, g in zip(srow, grow)] for srow, grow in zip(plane, grey)] for plane in src]
    peak = max(max(max(row) for row in plane) for plane in windowed)
    if peak <= 0.0:
        raise CliError("the unmasked part of the image is entirely black: nothing to match noise to")
    avg = sum(sum(sum(row) for row in plane) for plane in src) / (h * w * nch)
    windowed = [[[v / peak + avg * m for v, m in zip(wrow, mrow)] for wrow, mrow in zip(plane, mask)] for plane in windowed]

    src_fft = fft_real_planes(windowed)                                  # MK2:84
    src_dist = [[[abs(v) for v in row] for row in p] for p in src_fft]   # MK2:85
    src_phase = [[[v / d if d else 1.0 + 0j for v, d in zip(frow, drow)] for frow, drow in zip(pf, pd)]
                 for pf, pd in zip(src_fft, src_dist)]                   # MK2:86

    rng = Pcg64Random(seed)                                              # MK2:89
    window = _gaussian_window_mode1(h, w)                                # MK2:91
    raw = [rng.doubles(w * nch) for _ in range(h)]                       # MK2:92 rng.random((h, w, c)), C order
    noise = [[row[c::nch] for row in raw] for c in range(nch)]
    noise_grey = []
    for y in range(h):
        grow = []
        for x in range(w):
            s = noise[0][y][x]
            for c in range(1, nch):
                s += noise[c][y][x]
            grow.append(s / 3.0)                                          # MK2:93
        noise_grey.append(grow)
    cv = color_variation
    noise = [[[v * cv + (1.0 - cv) * g for v, g in zip(nrow, grow)]       # MK2:94-96
              for nrow, grow in zip(plane, noise_grey)] for plane in noise]

    nf_all = fft_real_planes(noise)                                      # MK2:98
    nf_all = [[[v * wv for v, wv in zip(row, wrow)] for row, wrow in zip(nf, window)] for nf in nf_all]  # MK2:99-100
    n_real = ifft_real_parts(nf_all)                                     # MK2:101
    sf_all = fft_real_planes(n_real)                                     # MK2:102
    sf_all = [[[(abs(v) ** 2) * (d ** noise_q) * ph for v, d, ph in zip(frow, drow, prow)]      # MK2:103
               for frow, drow, prow in zip(sf, src_dist[c], src_phase[c])] for c, sf in enumerate(sf_all)]
    shaped_planes: List[Plane] = ifft_real_parts(sf_all)                 # MK2:109

    lo = min(min(min(row) for row in p) for p in shaped_planes)          # MK2:110
    shaped_planes = [[[v - lo for v in row] for row in p] for p in shaped_planes]
    hi = max(max(max(row) for row in p) for p in shaped_planes)          # MK2:111
    if hi <= 0.0:
        raise CliError("degenerate noise (all values equal)")
    shaped_planes = [[[v / hi for v in row] for row in p] for p in shaped_planes]

    # MK2:112 histogram-match the new area's noise to the original area's colour distribution, per channel
    for c in range(nch):
        sel_new = [(y, x) for y in range(h) for x in range(w) if img_sel[y][x]]
        if not sel_new:
            continue
        template = [src[c][y][x] for y in range(h) for x in range(w) if ref_sel[y][x]]
        if not template:
            raise CliError("no unmasked pixels to match noise to")
        matched = _match_channel([shaped_planes[c][y][x] for y, x in sel_new], template)
        for (y, x), v in zip(sel_new, matched):
            shaped_planes[c][y][x] = v

    out: List[Plane] = []
    for c in range(nch):                                                 # MK2:113, 117
        plane = []
        for y in range(h):
            plane.append([min(max(s * (1.0 - m) + n * m, 0.0), 1.0)
                          for s, m, n in zip(src[c][y], mask[y], shaped_planes[c][y])])
        out.append(plane)
    return out


# --------------------------------------------------------------------------------------------------------------
# outpainting mk2 steps
# --------------------------------------------------------------------------------------------------------------

def mk2_steps(src_w: int, src_h: int, pixels: int, directions: Sequence[str], mask_blur: int,
              work_w: int, work_h: int) -> Dict[str, object]:
    """Geometry of the whole mk2 run (MK2:145-277): one step per selected direction in left,right,up,down order."""
    ex = expansion(src_w, src_h, pixels, directions)
    mask_blur_x = mask_blur if (ex["left"] > 0 or ex["right"] > 0) else 0   # MK2:158-166
    mask_blur_y = mask_blur if (ex["up"] > 0 or ex["down"] > 0) else 0
    steps = []
    cw, ch = src_w, src_h
    for d in DIRECTIONS:
        e = ex[d]
        if e <= 0:
            continue
        left, right, top, bottom = d == "left", d == "right", d == "up", d == "down"
        horiz, vert = left or right, top or bottom
        res_w = cw + (e if horiz else 0)                                    # MK2:196-197
        res_h = ch + (e if vert else 0)
        prw, prh = ceil64(res_w), ceil64(res_h)                             # MK2:198-199
        rect = rect_checked((                                               # MK2:205-210
            e + mask_blur_x if left else 0,
            e + mask_blur_y if top else 0,
            prw - e - mask_blur_x if right else res_w,
            prh - e - mask_blur_y if bottom else res_h), "mask")
        tw = min(work_w, cw + (e if horiz else 0)) if horiz else prw        # MK2:217-218
        th = min(work_h, ch + (e if vert else 0)) if vert else prh
        crop = (0 if left else prw - tw, 0 if top else prh - th,            # MK2:222-227
                tw if left else prw, th if top else prh)
        lrect = rect_checked((                                              # MK2:238-243 (mask.width/height are the crop's)
            e + mask_blur_x * 2 if left else 0,
            e + mask_blur_y * 2 if top else 0,
            tw - e - mask_blur_x * 2 if right else res_w,
            th - e - mask_blur_y * 2 if bottom else res_h), "latent mask")
        steps.append({
            "index": len(steps), "direction": d, "expand_pixels": e, "src_w": cw, "src_h": ch,
            "res_w": res_w, "res_h": res_h, "canvas_w": prw, "canvas_h": prh,
            "paste": [e if left else 0, e if top else 0],                   # MK2:202
            "mask_rect": list(rect), "latent_rect": list(lrect),
            "work_w": tw, "work_h": th, "crop": list(crop),
            "mask_blur_sigma_x": mask_blur_x * 4, "mask_blur_sigma_y": mask_blur_y * 4,  # MK2:168-169
        })
        cw, ch = res_w, res_h                                               # MK2:254 output cropped to (res_w, res_h)
    return {"src_w": src_w, "src_h": src_h, "pixels": pixels, "directions": list(directions), "mask_blur": mask_blur,
            "left": ex["left"], "right": ex["right"], "up": ex["up"], "down": ex["down"],
            "target_w": ex["target_w"], "target_h": ex["target_h"], "mask_blur_x": mask_blur_x, "mask_blur_y": mask_blur_y,
            "process_w": work_w, "process_h": work_h, "steps": steps, "final_w": cw, "final_h": ch}


def _sizes(args: argparse.Namespace) -> Tuple[Optional[Image.Image], int, int]:
    if args.source:
        im = Image.open(args.source)
        im.load()
        return im, im.width, im.height
    if args.size:
        w, h = parse_size(args.size)
        return None, w, h
    raise CliError("--source or --size is required")


def _mk2_common(args: argparse.Namespace) -> Tuple[List[str], None]:
    directions = parse_directions(args.directions)
    check_slider("pixels", args.pixels)
    check_slider("mask_blur", args.mask_blur)
    if args.work_w < 64 or args.work_h < 64:
        raise CliError("work size must be at least 64")
    return directions, None


def cmd_mk2_plan(args: argparse.Namespace) -> Dict[str, object]:
    directions, _ = _mk2_common(args)
    _, w, h = _sizes(args)
    return mk2_steps(w, h, args.pixels, directions, args.mask_blur, args.work_w, args.work_h)


def cmd_mk2_prepare(args: argparse.Namespace) -> Dict[str, object]:
    directions, _ = _mk2_common(args)
    check_slider("noise_q", args.noise_q)
    check_slider("color_variation", args.color_variation)
    if args.direction not in directions:
        raise CliError("--direction %s is not in --directions" % args.direction)
    cur = Image.open(args.source)
    cur.load()
    cur = cur.convert("RGB")
    if args.orig_size:
        ow, oh = parse_size(args.orig_size)
    elif args.direction == directions[0]:
        ow, oh = cur.size
    else:
        raise CliError("--orig-size is required for every step after the first")
    plan = mk2_steps(ow, oh, args.pixels, directions, args.mask_blur, args.work_w, args.work_h)
    step = next(s for s in plan["steps"] if s["direction"] == args.direction)
    if (step["src_w"], step["src_h"]) != cur.size:
        raise CliError("--source is %dx%d but step %s expects %dx%d (apply earlier directions first)" % (
            cur.width, cur.height, args.direction, step["src_w"], step["src_h"]))
    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    names = ["full.png", "init.png", "mask.png", "mask_blurred.png", "latent_mask.png", "step.json"]
    _check_outputs([args.source], [os.path.join(out_dir, n) for n in names])

    cw, ch = step["canvas_w"], step["canvas_h"]
    img = Image.new("RGB", (cw, ch))                                   # MK2:201
    img.paste(cur, tuple(step["paste"]))                               # MK2:202
    mask = fill_rect((cw, ch), tuple(step["mask_rect"]))               # MK2:203-210
    mask_data = mask.tobytes()
    planes = _planes(img)
    mplane = [[mask_data[y * cw + x] / 255.0 for x in range(cw)] for y in range(ch)]
    t0 = time.time()
    noised = get_matched_noise(planes, mplane, args.noise_q, args.color_variation, args.seed)   # MK2:214
    noise_seconds = round(time.time() - t0, 3)
    rgb = bytearray(cw * ch * 3)
    for c in range(3):
        for y in range(ch):
            row = noised[c][y]
            base = (y * cw) * 3 + c
            for x in range(cw):
                rgb[base + x * 3] = int(min(max(row[x] * 255.0, 0.0), 255.0))   # MK2:215 astype(uint8) truncates
    full = Image.frombytes("RGB", (cw, ch), bytes(rgb))
    crop = tuple(step["crop"])
    init = full.crop(crop)                                             # MK2:231
    mask_c = mask.crop(crop)                                           # MK2:228
    wk = (step["work_w"], step["work_h"])
    latent = fill_rect(wk, tuple(step["latent_rect"]))                 # MK2:236-244
    cm = step["mask_rect"]
    blurred = blur_rect_mask(wk, (cm[0] - crop[0], cm[1] - crop[1], cm[2] - crop[0], cm[3] - crop[1]),
                             step["mask_blur_sigma_x"], step["mask_blur_sigma_y"])  # PROC:1621-1631 on the cropped mask
    full.save(os.path.join(out_dir, "full.png"), format="PNG")
    init.save(os.path.join(out_dir, "init.png"), format="PNG")
    mask_c.save(os.path.join(out_dir, "mask.png"), format="PNG")
    blurred.save(os.path.join(out_dir, "mask_blurred.png"), format="PNG")
    latent.save(os.path.join(out_dir, "latent_mask.png"), format="PNG")
    step.update({"seed": args.seed, "noise_q": args.noise_q, "color_variation": args.color_variation,
                 "files": {"full": "full.png", "init": "init.png", "mask": "mask.png", "mask_blurred": "mask_blurred.png",
                           "latent_mask": "latent_mask.png"},
                 "is_last": step["index"] == len(plan["steps"]) - 1})
    with open(os.path.join(out_dir, "step.json"), "w") as fh:
        json.dump(step, fh, indent=1)
    return dict(step, noise_seconds=noise_seconds)  # timing stays out of step.json so identical runs write identical files


def _planes(img: Image.Image) -> List[Plane]:
    w, h = img.size
    data = img.tobytes()
    return [[[data[(y * w + x) * 3 + c] / 255.0 for x in range(w)] for y in range(h)] for c in range(3)]


def cmd_mk2_finish(args: argparse.Namespace) -> Dict[str, object]:
    with open(args.step) as fh:
        step = json.load(fh)
    full = Image.open(args.full).convert("RGB")
    proc = Image.open(args.processed).convert("RGB")
    _check_outputs([args.full, args.processed, args.step], [args.out])
    if proc.size != (step["work_w"], step["work_h"]):
        raise CliError("processed image is %dx%d, expected %dx%d" % (proc.width, proc.height, step["work_w"], step["work_h"]))
    d = step["direction"]
    pos = (0 if d == "left" else full.width - proc.width, 0 if d == "up" else full.height - proc.height)  # MK2:253
    out = full.copy()
    out.paste(proc, pos)
    out = out.crop((0, 0, step["res_w"], step["res_h"]))                                                  # MK2:254
    out.save(args.out, format="PNG")
    return {"out": args.out, "size": [out.width, out.height]}


# --------------------------------------------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--source")
        p.add_argument("--size")
        p.add_argument("--pixels", type=int, default=128)
        p.add_argument("--directions", default="left,right,up,down")

    p = sub.add_parser("poor-plan")
    common(p)
    p.add_argument("--mask-blur", type=int, default=4)
    p.add_argument("--masked-content", default="fill")
    p.add_argument("--tile-w", type=int, default=512)
    p.add_argument("--tile-h", type=int, default=512)
    p.add_argument("--geometry-only", action="store_true")
    p.add_argument("--out-dir")
    p.set_defaults(fn=cmd_poor_plan)

    p = sub.add_parser("poor-combine")
    p.add_argument("--plan", required=True)
    p.add_argument("--expanded", required=True)
    p.add_argument("--results-dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--allow-missing", action="store_true")
    p.set_defaults(fn=cmd_poor_combine)

    p = sub.add_parser("mk2-plan")
    common(p)
    p.add_argument("--mask-blur", type=int, default=8)
    p.add_argument("--work-w", type=int, default=512)
    p.add_argument("--work-h", type=int, default=512)
    p.set_defaults(fn=cmd_mk2_plan)

    p = sub.add_parser("mk2-prepare")
    common(p)
    p.add_argument("--direction", required=True, choices=DIRECTIONS)
    p.add_argument("--orig-size")
    p.add_argument("--mask-blur", type=int, default=8)
    p.add_argument("--noise-q", type=float, default=1.0)
    p.add_argument("--color-variation", type=float, default=0.05)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--work-w", type=int, default=512)
    p.add_argument("--work-h", type=int, default=512)
    p.add_argument("--out-dir", required=True)
    p.set_defaults(fn=cmd_mk2_prepare)

    p = sub.add_parser("mk2-finish")
    p.add_argument("--full", required=True)
    p.add_argument("--processed", required=True)
    p.add_argument("--step", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_mk2_finish)
    return ap


def main(argv: Sequence[str]) -> int:
    args = build_parser().parse_args(argv[1:])
    try:
        result = args.fn(args)
    except CliError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
