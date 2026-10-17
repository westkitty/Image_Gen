#!/usr/bin/env python3
"""A1111 "SD upscale" script geometry: init-image upscale, split_grid, combine_grid (faithful Pillow port).

Pinned upstream: AUTOMATIC1111/stable-diffusion-webui @ 82a973c04367123ae98bd9abdf80d9eda9b910e2
  scripts/sd_upscale.py, modules/images.py (split_grid / combine_grid / flatten), modules/upscaler.py.

Subcommands
  plan     <src.png> --out-dir DIR --tile-width W --tile-height H --overlap N
           [--scale S --upscale-resampler none|lanczos|nearest|bicubic|bilinear]
           [--upscaled-input --source-size WxH] [--seed N --batch-size B --batch-count C]
           Writes DIR/tile_NNN.png and DIR/plan.json; prints the plan JSON.
  combine  --plan DIR/plan.json --tiles-dir DIR2 --out out.png
           Pastes processed tiles (same names/sizes as the plan) exactly as combine_grid.
Inputs are never modified. Mirrors public/dexdiffusion/sd-upscale.js plan().

Not ported: model upscalers are not run here (the caller runs Real-ESRGAN and passes
--upscaled-input; the final Lanczos resize to the //8 destination is still applied here).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

from PIL import Image

RESAMPLERS = {
    "lanczos": Image.LANCZOS,
    "nearest": Image.NEAREST,
    "bicubic": Image.BICUBIC,
    "bilinear": Image.BILINEAR,
}
BACKGROUND = "#ffffff"  # opts.img2img_background_color default (shared_options.py:221)


def flatten(img: Image.Image, bgcolor: str = BACKGROUND) -> Image.Image:
    """images.flatten (images.py:841-849)."""
    if img.mode == "RGBA":
        background = Image.new("RGBA", img.size, bgcolor)
        background.paste(img, mask=img)
        img = background
    return img.convert("RGB")


def dest_size(w: int, h: int, scale: float) -> tuple[int, int]:
    """Upscaler.upscale dest_w/dest_h (upscaler.py:56-57): int((dim * scale) // 8 * 8)."""
    return int((w * scale) // 8 * 8), int((h * scale) // 8 * 8)


def upscale_init(img: Image.Image, scale: float, resampler: str,
                 source_size: tuple[int, int] | None = None, already_upscaled: bool = False) -> Image.Image:
    """sd_upscale.py:42-45 + Upscaler.upscale (upscaler.py:54-74) for the built-in Lanczos/Nearest.

    'none' returns the image untouched. Otherwise one do_upscale resize to int(w*scale), then the
    final LANCZOS resize to the //8 destination when sizes differ (upscaler.py:73-74).
    """
    if resampler == "none":
        return img
    sw, sh = source_size if source_size else img.size
    dw, dh = dest_size(sw, sh, scale)
    if not already_upscaled:
        img = img.resize((int(sw * scale), int(sh * scale)), resample=RESAMPLERS[resampler])
    if img.size != (dw, dh):
        img = img.resize((dw, dh), resample=Image.LANCZOS)
    return img


def grid_geometry(w: int, h: int, tile_w: int, tile_h: int, overlap: int) -> dict[str, Any]:
    """images.split_grid (images.py:78-111), geometry only. Tiles are row-major."""
    nw, nh = tile_w - overlap, tile_h - overlap
    if nw <= 0 or nh <= 0:
        raise ValueError("overlap must be smaller than the tile size")
    cols = math.ceil((w - overlap) / nw)
    rows = math.ceil((h - overlap) / nh)
    if cols < 1 or rows < 1:
        raise ValueError("image must be larger than the overlap")
    dx = (w - tile_w) / (cols - 1) if cols > 1 else 0
    dy = (h - tile_h) / (rows - 1) if rows > 1 else 0
    tiles = []
    for row in range(rows):
        y = int(row * dy)
        if y + tile_h >= h:
            y = h - tile_h
        for col in range(cols):
            x = int(col * dx)
            if x + tile_w >= w:
                x = w - tile_w
            tiles.append({"row": row, "col": col, "x": x, "y": y})
    return {"cols": cols, "rows": rows, "tiles": tiles}


def seed_offset(index: int, batch_size: int) -> int:
    """Per-tile seed offset from sd_upscale.py:79-82,92-95 and process_images (seed + position in batch).

    Batch i starts at seed + i (p.seed = processed.seed + 1, NOT + batch_size); tile j of a batch
    uses start + j. With batch_size 1 this is seed + tile_index.
    """
    return index // batch_size + index % batch_size


def build_plan(img: Image.Image, tile_w: int, tile_h: int, overlap: int, seed: int | None,
               batch_size: int, batch_count: int) -> dict[str, Any]:
    w, h = img.size
    g = grid_geometry(w, h, tile_w, tile_h, overlap)
    for i, t in enumerate(g["tiles"]):
        t["index"] = i
        t["file"] = f"tile_{i:03d}.png"
        t["box"] = [t["x"], t["y"], t["x"] + tile_w, t["y"] + tile_h]
        t["seed_offset"] = seed_offset(i, batch_size)
        if seed is not None:
            t["seed"] = seed + t["seed_offset"]
    return {
        "version": 1,
        "upstream": "AUTOMATIC1111/stable-diffusion-webui@82a973c04367123ae98bd9abdf80d9eda9b910e2 scripts/sd_upscale.py",
        "image": [w, h], "tile": [tile_w, tile_h], "overlap": overlap,
        "cols": g["cols"], "rows": g["rows"], "tile_count": len(g["tiles"]),
        "order": "row-major",
        "batch_size": batch_size, "batch_count": math.ceil(len(g["tiles"]) / batch_size),
        "iterations": batch_count,
        "seed_rule": "tile k: seed + (k // batch_size) + (k % batch_size); iteration n adds n to seed (sd_upscale.py:78-95)",
        "tiles": g["tiles"],
    }


def make_masks(overlap: int, tile_h: int, image_w: int) -> tuple[Image.Image, Image.Image]:
    """combine_grid make_mask_image (images.py:115-121): value = uint8(trunc(i * 255 / overlap))."""
    ramp = bytes((i * 255) // overlap for i in range(overlap))  # exact == float32 trunc (gaps >= 1/256)
    mask_w = Image.frombytes("L", (overlap, tile_h), ramp * tile_h)
    mask_h = Image.frombytes("L", (image_w, overlap), b"".join(bytes([v]) * image_w for v in ramp))
    return mask_w, mask_h


def combine_grid(plan: dict[str, Any], tiles: list[Image.Image]) -> Image.Image:
    """images.combine_grid (images.py:114-141), same paste order and masks.

    overlap == 0 is a crash upstream (empty mask); here tiles are simply pasted unblended.
    """
    iw, ih = plan["image"]
    tw, th = plan["tile"]
    ov = plan["overlap"]
    if ov > 0:
        mask_w, mask_h = make_masks(ov, th, iw)
    combined = Image.new("RGB", (iw, ih))
    by_row: dict[int, list[dict[str, Any]]] = {}
    for t in plan["tiles"]:
        by_row.setdefault(t["row"], []).append(t)
    for r in sorted(by_row):
        row = by_row[r]
        y = row[0]["y"]
        crow = Image.new("RGB", (iw, th))
        for t in row:
            x, tile = t["x"], tiles[t["index"]]
            if x == 0:
                crow.paste(tile, (0, 0))
                continue
            if ov > 0:
                crow.paste(tile.crop((0, 0, ov, th)), (x, 0), mask=mask_w)
            crow.paste(tile.crop((ov, 0, tw, th)), (x + ov, 0))
        if y == 0:
            combined.paste(crow, (0, 0))
            continue
        if ov > 0:
            combined.paste(crow.crop((0, 0, crow.width, ov)), (0, y), mask=mask_h)
        combined.paste(crow.crop((0, ov, crow.width, th)), (0, y + ov))
    return combined


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmd_plan(a: argparse.Namespace) -> None:
    src = Path(a.src)
    out_dir = Path(a.out_dir)
    img = flatten(Image.open(src))
    source_size = None
    if a.upscaled_input:
        if not a.source_size:
            raise SystemExit("--upscaled-input requires --source-size WxH")
        sw, sh = a.source_size.lower().split("x")
        source_size = (int(sw), int(sh))
    img = upscale_init(img, a.scale, a.upscale_resampler, source_size, a.upscaled_input)
    plan = build_plan(img, a.tile_width, a.tile_height, a.overlap, a.seed, a.batch_size, a.batch_count)
    plan["scale"] = a.scale
    plan["upscaler"] = a.upscale_resampler
    plan["source_sha256"] = sha256(src)
    out_dir.mkdir(parents=True, exist_ok=True)
    for t in plan["tiles"]:
        dest = out_dir / t["file"]
        if dest.resolve() == src.resolve():
            raise SystemExit("refusing to overwrite the source image")
        img.crop(tuple(t["box"])).save(dest, format="PNG")
    (out_dir / "plan.json").write_text(json.dumps(plan, indent=2))
    print(json.dumps(plan))


def cmd_combine(a: argparse.Namespace) -> None:
    plan = json.loads(Path(a.plan).read_text())
    tiles_dir = Path(a.tiles_dir)
    tiles = []
    for t in plan["tiles"]:
        p = tiles_dir / t["file"]
        if not p.is_file():
            raise SystemExit(f"missing processed tile: {p}")
        im = Image.open(p).convert("RGB")
        if im.size != tuple(plan["tile"]):
            raise SystemExit(f"{p.name} is {im.size[0]}x{im.size[1]}, expected {plan['tile'][0]}x{plan['tile'][1]}")
        tiles.append(im)
    out = Path(a.out)
    if out.resolve() == Path(a.plan).resolve() or out.parent.resolve() == tiles_dir.resolve() and out.name in {t["file"] for t in plan["tiles"]}:
        raise SystemExit("--out must not overwrite the plan or a tile")
    combine_grid(plan, tiles).save(out, format="PNG")
    print(json.dumps({"out": str(out), "size": plan["image"]}))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("src")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--tile-width", type=int, required=True)
    p.add_argument("--tile-height", type=int, required=True)
    p.add_argument("--overlap", type=int, default=64)
    p.add_argument("--scale", type=float, default=2.0)
    p.add_argument("--upscale-resampler", default="lanczos", choices=["none", *RESAMPLERS])
    p.add_argument("--upscaled-input", action="store_true")
    p.add_argument("--source-size")
    p.add_argument("--seed", type=int)
    p.add_argument("--batch-size", type=int, default=1)
    p.add_argument("--batch-count", type=int, default=1)
    p.set_defaults(fn=cmd_plan)
    c = sub.add_parser("combine")
    c.add_argument("--plan", required=True)
    c.add_argument("--tiles-dir", required=True)
    c.add_argument("--out", required=True)
    c.set_defaults(fn=cmd_combine)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
