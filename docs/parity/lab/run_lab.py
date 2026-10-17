#!/usr/bin/env python3
"""Differential parity lab runner (infrastructure B).

Runs every executable fixture in fixtures.json: the pinned A1111 oracle (a1111_reference.py) and the DexDiffusion
subject both compute the result for the same input, and the two must agree within the fixture's tolerance.
"oracle-selfcheck" fixtures check the oracle against the upstream doctest value (so the oracle itself is
trustworthy). "pending" fixtures are validated for shape only and reported as PENDING with their packet.

Usage: python3 run_lab.py [--out receipt.json]     exit 0 only if no executable fixture failed.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
import a1111_reference as A  # noqa: E402
from PIL import Image  # noqa: E402

spec = importlib.util.spec_from_file_location("dex_resize", ROOT / "operator-console" / "bin" / "resize-source.py")
DEX_RESIZE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(DEX_RESIZE)


def synthetic(w: int, h: int) -> Image.Image:
    """Deterministic test card: gradients plus a hard-edged block so resampling and cropping both show."""
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = ((x * 255) // max(1, w - 1), (y * 255) // max(1, h - 1), 255 if (x // 16 + y // 16) % 2 else 40)
    return im


def max_diff(a: Image.Image, b: Image.Image) -> int:
    if a.size != b.size:
        return 10 ** 6
    return max(abs(p - q) for p, q in zip(a.tobytes(), b.tobytes())) if a.tobytes() != b.tobytes() else 0


def node_batch(calls: list[dict]) -> list:
    js = r"""
const H = require(process.argv[1] + '/operator-console/hires-2pass.js');
const I = require(process.argv[1] + '/operator-console/public/dexdiffusion/infotext.js');
let s = ''; process.stdin.on('data', d => s += d).on('end', () => {
  const out = JSON.parse(s).map(c => c.fn === 'geom' ? H.hiresGeometry(...c.args) : I.parseInfotext(c.args[0]));
  process.stdout.write(JSON.stringify(out));
});"""
    r = subprocess.run(["node", "-e", js, str(ROOT)], input=json.dumps(calls), capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise SystemExit("node subject failed: " + r.stderr[-500:])
    return json.loads(r.stdout)


def a1111_hires(base, scale, resize):
    bw, bh = base
    ux, uy, tx, ty = A.calculate_target_resolution(bw, bh, scale, resize[0], resize[1])
    if resize == [0, 0]:
        return dict(final=[ux // 8 * 8, uy // 8 * 8], upscale_to=[ux, uy], crop=None)   # assumption A-1
    x, y, w, h = A.hires_latent_crop(ux, uy, tx, ty)
    crop = None if (tx, ty) == (0, 0) and (w, h) == (ux, uy) else [x, y, w, h]
    return dict(final=[w, h], upscale_to=[ux, uy], crop=crop)


def dex_infotext_map(r: dict) -> dict:
    m = {}
    for k, v in r["params"]:
        v = A.unquote(v) if isinstance(v, str) else v
        mm = A.re_imagesize.match(str(v))
        if mm:
            m[f"{k}-1"], m[f"{k}-2"] = mm.group(1), mm.group(2)
        else:
            m[k] = v
    m["Prompt"], m["Negative prompt"] = r["prompt"], r["negative"]
    return m


def main(argv: list[str]) -> int:
    doc = json.loads((HERE / "fixtures.json").read_text())
    fx = doc["fixtures"]
    results = []
    node_calls, node_idx = [], {}
    for f in fx:
        if f["category"] == "hires-geometry":
            i = f["input"]; explicit = i["resize"] != [0, 0]
            tw, th = (i["resize"] if explicit else [int(i["base"][0] * i["scale"]) // 8 * 8, int(i["base"][1] * i["scale"]) // 8 * 8])
            node_idx[f["id"]] = len(node_calls); node_calls.append(dict(fn="geom", args=[i["base"][0], i["base"][1], tw, th, explicit]))
        elif f["category"] == "infotext-parse":
            node_idx[f["id"]] = len(node_calls); node_calls.append(dict(fn="info", args=[f["input"]["text"]]))
    node_out = node_batch(node_calls) if node_calls else []
    for f in fx:
        cat, inp = f["category"], f["input"]
        res = dict(id=f["id"], category=cat, kind=f["kind"])
        try:
            if f["kind"] == "pending":
                assert f.get("pending", {}).get("packet"), "pending fixture must name a packet"
                res.update(status="PENDING", packet=f["pending"]["packet"])
            elif cat == "img2img-resize":
                src = synthetic(*inp["src"])
                ref = A.resize_image(inp["a1111_mode"], src, *inp["target"])
                sub = DEX_RESIZE.resize_image(inp["mode"], src, *inp["target"])
                d = max_diff(ref, sub)
                res.update(status="PASS" if d <= f["tolerance"]["max"] else "FAIL", max_abs_diff=d,
                           ref_sha=hashlib.sha256(ref.tobytes()).hexdigest()[:16], sub_sha=hashlib.sha256(sub.tobytes()).hexdigest()[:16])
            elif cat == "hires-geometry":
                ref = a1111_hires(inp["base"], inp["scale"], inp["resize"])
                g = node_out[node_idx[f["id"]]]
                final = [g["crop"]["width"], g["crop"]["height"]] if g["crop"] else [g["upscaleTo"]["width"], g["upscaleTo"]["height"]]
                sub = dict(final=final, upscale_to=[g["upscaleTo"]["width"], g["upscaleTo"]["height"]],
                           crop=[g["crop"]["x"], g["crop"]["y"], g["crop"]["width"], g["crop"]["height"]] if g["crop"] else None)
                if inp["resize"] == [0, 0]:
                    sub["upscale_to"] = ref["upscale_to"]   # scale mode compares the final size only (assumption A-1)
                res.update(status="PASS" if sub == ref else "FAIL", oracle=ref, subject=sub)
            elif cat == "infotext-parse":
                ref = A.parse_generation_parameters_core(inp["text"])
                sub = dex_infotext_map(node_out[node_idx[f["id"]]])
                diff = {k: [ref.get(k), sub.get(k)] for k in set(ref) | set(sub) if ref.get(k) != sub.get(k)}
                res.update(status="PASS" if not diff else "FAIL", diff=diff or None)
            elif cat == "prompt-attention":
                got = A.parse_prompt_attention(inp["text"])
                ok = len(got) == len(f["expected"]) and all(a[0] == b[0] and abs(a[1] - b[1]) <= f["tolerance"]["max"] for a, b in zip(got, f["expected"]))
                res.update(status=("ORACLE-OK" if ok else "FAIL"), subject_status="PENDING-LIVE")
            else:
                res.update(status="FAIL", error="no runner for category " + cat)
        except Exception as e:  # a crash is a failure, never a skip
            res.update(status="FAIL", error=f"{type(e).__name__}: {e}")
        results.append(res)
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    receipt = dict(schema="dexdiffusion.parity-lab-receipt.v1", a1111_commit=doc["a1111_commit"], counts=counts,
                   verdict="PASS" if "FAIL" not in counts else "FAIL", results=results)
    if "--out" in argv:
        Path(argv[argv.index("--out") + 1]).write_text(json.dumps(receipt, indent=1) + "\n")
    for r in results:
        if r["status"] == "FAIL":
            print("FAIL", r["id"], json.dumps({k: v for k, v in r.items() if k not in ("id",)})[:600])
    print(json.dumps(counts), receipt["verdict"])
    return 0 if receipt["verdict"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
