#!/usr/bin/env python3
"""Deterministic, local-only world compiler helpers.

The script deliberately keeps the global frame simple and inspectable: ERP
pixels define spherical coordinates, depth is an explicit fallback artifact,
and every command emits JSON metrics. Learned workers may replace a stage later
without changing the manifest or coordinate conventions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def dims(path: Path) -> dict:
    with Image.open(path) as im:
        return {"width": im.width, "height": im.height}


def anchor(args: argparse.Namespace) -> dict:
    src = image(Path(args.source))
    width, height = args.width, args.height
    # The calibrated source frustum occupies the centre of the ERP. The mask
    # is explicit so later fusion can prefer observed pixels over invention.
    frustum_width = max(1, round(width * args.fov / 360.0))
    resized = ImageOps.contain(src, (frustum_width, height), Image.Resampling.LANCZOS)
    canvas = src.resize((width, height), Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(18))
    x0 = (width - resized.width) // 2
    y0 = (height - resized.height) // 2
    canvas.paste(resized, (x0, y0))
    mask = Image.new("L", (width, height), 0)
    mask.paste(255, (x0, y0), Image.new("L", resized.size, 255))
    out = Path(args.output)
    mask_out = Path(args.mask)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, format="PNG", optimize=True)
    mask.save(mask_out, format="PNG", optimize=True)
    result = {
        "schema": "dexdiffusion.world.camera.v1",
        "method": "deterministic-default",
        "confidence": "heuristic",
        "fovHorizontal": args.fov,
        "fovVertical": round(args.fov * src.height / max(src.width, 1), 4),
        "focalEstimatePixels": round(src.width / (2 * math.tan(math.radians(args.fov) / 2)), 4),
        "orientation": {"yaw": 0, "pitch": 0, "roll": 0},
        "sourceDimensions": {"width": src.width, "height": src.height},
        "erpDimensions": {"width": width, "height": height},
        "sourceConfidenceMask": str(mask_out),
        "sourceArtifactSha256": sha256(Path(args.source)),
        "erpReferenceSha256": sha256(out),
    }
    write_json(Path(args.manifest), result)
    return result


def score(args: argparse.Namespace) -> dict:
    pano = np.asarray(image(Path(args.panorama)), dtype=np.float32) / 255.0
    source = np.asarray(image(Path(args.source)).resize((pano.shape[1] // 2, pano.shape[0]), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    # ERP seam continuity compares the wrapped columns. Source preservation
    # compares the central frustum, not the generated hidden half.
    seam = float(np.abs(pano[:, 0] - pano[:, -1]).mean())
    x0 = (pano.shape[1] - source.shape[1]) // 2
    observed = pano[:, x0:x0 + source.shape[1]]
    preservation = float(1.0 - np.abs(observed - source).mean())
    gray = pano.mean(axis=2)
    gx = np.abs(np.diff(gray, axis=1)).mean()
    gy = np.abs(np.diff(gray, axis=0)).mean()
    discontinuity = float(min(1.0, (gx + gy) * 2.0))
    result = {"seamError": round(seam, 6), "sourcePreservation": round(max(0.0, preservation), 6), "grossDiscontinuity": round(discontinuity, 6), "scoreFormula": "0.5*sourcePreservation + 0.3*(1-seamError) + 0.2*(1-grossDiscontinuity)"}
    result["score"] = round(0.5 * result["sourcePreservation"] + 0.3 * (1 - result["seamError"]) + 0.2 * (1 - result["grossDiscontinuity"]), 6)
    print(json.dumps(result, sort_keys=True))
    return result


def depth(args: argparse.Namespace) -> dict:
    arr = np.asarray(image(Path(args.panorama)), dtype=np.float32) / 255.0
    gray = arr.mean(axis=2)
    # Conservative bounded fallback. It is intentionally labeled heuristic;
    # it supplies a usable scaffold but cannot claim learned depth quality.
    depth_arr = np.clip(0.35 + 0.65 * (1.0 - gray), 0.05, 1.0)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.round(depth_arr * 65535).astype(np.uint16), mode="I;16").save(out)
    result = {"schema": "dexdiffusion.world.depth360.v1", "method": "bounded-luminance-fallback", "width": int(arr.shape[1]), "height": int(arr.shape[0]), "validPixelRatio": 1.0, "nanCount": 0, "infCount": 0, "overlapDisagreement": None, "confidence": "LOW", "sha256": sha256(out)}
    write_json(Path(args.manifest), result)
    return result


def point_cloud(args: argparse.Namespace) -> dict:
    pano = np.asarray(image(Path(args.panorama)), dtype=np.float32) / 255.0
    dep = np.asarray(Image.open(args.depth), dtype=np.float32) / 65535.0
    h, w, _ = pano.shape
    step = max(1, int(math.sqrt((w * h) / max(args.max_points, 1))))
    rows = []
    for y in range(0, h, step):
        phi = (0.5 - (y + 0.5) / h) * math.pi
        cp = math.cos(phi)
        sp = math.sin(phi)
        for x in range(0, w, step):
            theta = ((x + 0.5) / w - 0.5) * 2 * math.pi
            radius = float(0.25 + dep[y, x] * 2.5)
            rows.append((radius * cp * math.sin(theta), radius * sp, radius * cp * math.cos(theta), int(pano[y, x, 0] * 255), int(pano[y, x, 1] * 255), int(pano[y, x, 2] * 255)))
    ply = Path(args.output)
    ply.parent.mkdir(parents=True, exist_ok=True)
    with ply.open("w", encoding="ascii") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {len(rows)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
        for row in rows:
            f.write("%.6f %.6f %.6f %d %d %d\n" % row)
    # A separate low-density navigation shell; it is never used as the visual
    # splat artifact.
    obj = Path(args.collision)
    with obj.open("w", encoding="ascii") as f:
        rings, sectors = 8, 16
        for ring in range(1, rings):
            phi = math.pi * (ring / rings - 0.5)
            for sector in range(sectors):
                theta = 2 * math.pi * sector / sectors
                r = 1.5
                f.write(f"v {r * math.cos(phi) * math.sin(theta):.5f} {r * math.sin(phi):.5f} {r * math.cos(phi) * math.cos(theta):.5f}\n")
        for ring in range(rings - 2):
            for sector in range(sectors):
                a = ring * sectors + sector + 1
                b = ring * sectors + (sector + 1) % sectors + 1
                c = (ring + 1) * sectors + (sector + 1) % sectors + 1
                d = (ring + 1) * sectors + sector + 1
                f.write(f"f {a} {b} {c} {d}\n")
    bounds = {"min": [float(np.min([r[i] for r in rows])) for i in range(3)], "max": [float(np.max([r[i] for r in rows])) for i in range(3)]}
    result = {"schema": "dexdiffusion.world.scaffold.v1", "points": len(rows), "bounds": bounds, "finite": True, "collisionVertices": (rings - 1) * sectors, "plySha256": sha256(ply), "collisionSha256": sha256(obj)}
    write_json(Path(args.manifest), result)
    return result


def rig(args: argparse.Namespace) -> dict:
    cameras = []
    for name, yaw in zip(("front", "right", "back", "left", "up", "down"), (0, 90, 180, 270, 0, 0)):
        cameras.append({"id": name, "yaw": yaw, "pitch": 90 if name == "up" else -90 if name == "down" else 0, "fov": 105, "overlapDegrees": 15, "projection": "erp-perspective", "source": "deterministic-world-frame"})
    result = {"schema": "dexdiffusion.world.camera-rig.v1", "coordinateFrame": "erp-spherical", "cameras": cameras, "cube6Compatible": True, "sha256": None}
    write_json(Path(args.output), result)
    result["sha256"] = sha256(Path(args.output))
    write_json(Path(args.output), result)
    return result


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("anchor"); a.add_argument("--source", required=True); a.add_argument("--output", required=True); a.add_argument("--mask", required=True); a.add_argument("--manifest", required=True); a.add_argument("--width", type=int, default=1024); a.add_argument("--height", type=int, default=512); a.add_argument("--fov", type=float, default=70); a.set_defaults(fn=anchor)
    s = sub.add_parser("score"); s.add_argument("--source", required=True); s.add_argument("--panorama", required=True); s.set_defaults(fn=score)
    d = sub.add_parser("depth"); d.add_argument("--panorama", required=True); d.add_argument("--output", required=True); d.add_argument("--manifest", required=True); d.set_defaults(fn=depth)
    g = sub.add_parser("scaffold"); g.add_argument("--panorama", required=True); g.add_argument("--depth", required=True); g.add_argument("--output", required=True); g.add_argument("--collision", required=True); g.add_argument("--manifest", required=True); g.add_argument("--max-points", type=int, default=250000); g.set_defaults(fn=point_cloud)
    r = sub.add_parser("rig"); r.add_argument("--output", required=True); r.set_defaults(fn=rig)
    args = p.parse_args(); result = args.fn(args)
    if args.command != "score": print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
