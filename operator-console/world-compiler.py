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
import struct
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
    values = np.round(depth_arr * 65535).astype(">u2")
    with out.open("wb") as f:
        f.write(f"P5\n{values.shape[1]} {values.shape[0]}\n65535\n".encode("ascii"))
        f.write(values.tobytes())
    result = {"schema": "dexdiffusion.world.depth360.v1", "method": "bounded-luminance-fallback", "width": int(arr.shape[1]), "height": int(arr.shape[0]), "validPixelRatio": 1.0, "nanCount": 0, "infCount": 0, "overlapDisagreement": None, "confidence": "LOW", "sha256": sha256(out)}
    write_json(Path(args.manifest), result)
    return result


def point_cloud(args: argparse.Namespace) -> dict:
    pano = np.asarray(image(Path(args.panorama)), dtype=np.float32) / 255.0
    dep = np.asarray(Image.open(args.depth), dtype=np.float32) / 65535.0
    h, w, _ = pano.shape
    step = max(1, int(math.ceil(math.sqrt((w * h) / max(args.max_points, 1)))))
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
    with ply.open("wb") as f:
        f.write(b"ply\nformat binary_little_endian 1.0\n")
        f.write(f"element vertex {len(rows)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n".encode("ascii"))
        for row in rows:
            f.write(struct.pack("<fffBBB", *row))
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


def views(args: argparse.Namespace) -> dict:
    pano = image(Path(args.panorama))
    width, height = pano.size
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    # These are deterministic ERP-aligned proposals. They are intentionally
    # named projected views rather than pretending to be learned perspective
    # renders; the rig manifest carries the exact yaw/pitch provenance.
    specs = [("front", 0, 0), ("right", 90, 0), ("back", 180, 0), ("left", 270, 0), ("up", 0, 90), ("down", 0, -90)]
    records = []
    for name, yaw, pitch in specs:
        if pitch == 0:
            center = int((yaw / 360.0 + 0.5) * width) % width
            half = max(1, width // 8)
            rolled = np.roll(np.asarray(pano), width // 2 - center, axis=1)
            crop = Image.fromarray(rolled[:, width // 2 - half:width // 2 + half])
        else:
            crop = pano.crop((0, 0, width, max(1, height // 2))) if pitch > 0 else pano.crop((0, height // 2, width, height))
        crop = ImageOps.fit(crop, (512, 512), method=Image.Resampling.LANCZOS)
        target = out_dir / f"{name}.png"
        crop.save(target, format="PNG", optimize=True)
        records.append({"id": name, "yaw": yaw, "pitch": pitch, "fov": 105, "overlapDegrees": 15, "path": str(target), "sha256": sha256(target), "width": crop.width, "height": crop.height})
    result = {"schema": "dexdiffusion.world.projected-views.v1", "projection": "erp-window", "views": records, "count": len(records)}
    write_json(Path(args.manifest), result)
    return result


def read_binary_ply(path: Path) -> list[tuple[float, float, float, int, int, int]]:
    data = path.read_bytes()
    marker = b"end_header\n"
    end = data.find(marker)
    if end < 0:
        raise ValueError(f"PLY header missing: {path}")
    header = data[:end + len(marker)].decode("ascii", errors="strict")
    if "format binary_little_endian 1.0" not in header:
        raise ValueError(f"PLY is not binary little endian: {path}")
    count_match = next((line.split()[-1] for line in header.splitlines() if line.startswith("element vertex ")), None)
    if not count_match:
        raise ValueError(f"PLY vertex count missing: {path}")
    count = int(count_match)
    props = []
    in_vertex = False
    sizes = {"float": 4, "float32": 4, "uchar": 1, "uint8": 1}
    for line in header.splitlines():
        fields = line.split()
        if fields[:2] == ["element", "vertex"]:
            in_vertex = True
        elif fields[:1] == ["element"]:
            in_vertex = False
        elif in_vertex and fields[:1] == ["property"] and len(fields) >= 3 and fields[1] in sizes:
            props.append((fields[2], fields[1]))
    offsets = {}
    stride = 0
    for name, typ in props:
        offsets[name] = (stride, typ)
        stride += sizes[typ]
    required = ["x", "y", "z"]
    if any(name not in offsets for name in required) or stride <= 0:
        raise ValueError(f"PLY position properties incomplete: {path}")
    out = []
    for i in range(count):
        base = end + len(marker) + i * stride
        if base + stride > len(data):
            break
        xyz = [struct.unpack_from("<f", data, base + offsets[name][0])[0] for name in required]
        rgb = [data[base + offsets[name][0]] if name in offsets else 180 for name in ("red", "green", "blue")]
        if all(math.isfinite(v) for v in xyz):
            out.append((*xyz, *rgb))
    return out


def fuse(args: argparse.Namespace) -> dict:
    inputs = json.loads(Path(args.inputs).read_text())
    voxel = max(float(args.voxel_size), 0.0001)
    buckets: dict[tuple[int, int, int], list[float]] = {}
    total = 0
    for item in inputs:
        yaw = math.radians(float(item.get("yaw", 0)))
        pitch = math.radians(float(item.get("pitch", 0)))
        cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
        for x, y, z, r, g, b in read_binary_ply(Path(item["path"])):
            # Camera-local proposals are rotated into the declared ERP frame.
            yp = cp * y - sp * z
            zp = sp * y + cp * z
            xp = x
            xf = cy * xp + sy * zp
            zf = -sy * xp + cy * zp
            key = (round(xf / voxel), round(yp / voxel), round(zf / voxel))
            acc = buckets.setdefault(key, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
            acc[0] += xf; acc[1] += yp; acc[2] += zf; acc[3] += r; acc[4] += g; acc[5] += b; acc[6] += 1
            total += 1
    rows = [(v[0] / v[6], v[1] / v[6], v[2] / v[6], int(v[3] / v[6]), int(v[4] / v[6]), int(v[5] / v[6])) for v in buckets.values()]
    if len(rows) > args.max_points:
        step = int(math.ceil(len(rows) / args.max_points))
        rows = rows[::step]
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as f:
        f.write(b"ply\nformat binary_little_endian 1.0\n")
        f.write(f"element vertex {len(rows)}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n".encode("ascii"))
        for row in rows:
            f.write(struct.pack("<fffBBB", *row))
    result = {"schema": "dexdiffusion.world.fusion.v1", "method": "aligned-voxel-dedup", "inputs": len(inputs), "inputPoints": total, "outputPoints": len(rows), "voxelSize": voxel, "finite": True, "sha256": sha256(out)}
    write_json(Path(args.manifest), result)
    return result


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="command", required=True)
    a = sub.add_parser("anchor"); a.add_argument("--source", required=True); a.add_argument("--output", required=True); a.add_argument("--mask", required=True); a.add_argument("--manifest", required=True); a.add_argument("--width", type=int, default=1024); a.add_argument("--height", type=int, default=512); a.add_argument("--fov", type=float, default=70); a.set_defaults(fn=anchor)
    s = sub.add_parser("score"); s.add_argument("--source", required=True); s.add_argument("--panorama", required=True); s.set_defaults(fn=score)
    d = sub.add_parser("depth"); d.add_argument("--panorama", required=True); d.add_argument("--output", required=True); d.add_argument("--manifest", required=True); d.set_defaults(fn=depth)
    g = sub.add_parser("scaffold"); g.add_argument("--panorama", required=True); g.add_argument("--depth", required=True); g.add_argument("--output", required=True); g.add_argument("--collision", required=True); g.add_argument("--manifest", required=True); g.add_argument("--max-points", type=int, default=250000); g.set_defaults(fn=point_cloud)
    r = sub.add_parser("rig"); r.add_argument("--output", required=True); r.set_defaults(fn=rig)
    v = sub.add_parser("views"); v.add_argument("--panorama", required=True); v.add_argument("--output-dir", required=True); v.add_argument("--manifest", required=True); v.set_defaults(fn=views)
    f = sub.add_parser("fuse"); f.add_argument("--inputs", required=True); f.add_argument("--output", required=True); f.add_argument("--manifest", required=True); f.add_argument("--voxel-size", type=float, default=0.02); f.add_argument("--max-points", type=int, default=250000); f.set_defaults(fn=fuse)
    args = p.parse_args(); result = args.fn(args)
    if args.command != "score": print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
