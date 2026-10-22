#!/usr/bin/env python3
"""Create a repeatable conventional-LoRA equivalent of the installed rsLoRA.

This tool never edits its input. It requires exactly paired rank-128 A/B
matrices and applies alpha/sqrt(rank) to B so MFLUX's no-alpha conventional
loader produces the same user-strength-scaled delta.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
from pathlib import Path

import mlx.core as mx

EXPECTED_SOURCE_SHA256 = "eec52255dd0611861def82a2a7c8b0439a4b0748a77ca55802a097013176564a"
EXPECTED_DERIVED_SHA256 = "414e5662d884f2d1353602a82d67b842eaa037f0b7df81cb16b08f2811c69ee5"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: mflux-rslora-convert.py ORIGINAL.safetensors DERIVED.safetensors")
    source, destination = map(Path, sys.argv[1:])
    if not source.is_file() or source.resolve() == destination.resolve():
        raise SystemExit("source must exist and destination must be a distinct file")
    if destination.is_file():
        try:
            _, existing_metadata = mx.load(str(destination), return_metadata=True)
            proof = json.loads(existing_metadata.get("dexdiffusion_conversion", "{}"))
            cached_hash = sha256(destination)
            if (proof.get("source_sha256") == EXPECTED_SOURCE_SHA256 and proof.get("rank") == 128
                    and proof.get("alpha") == 64 and cached_hash == EXPECTED_DERIVED_SHA256):
                # Reuse the independently verified cache without re-reading the
                # preserved removable-volume source on every generation.
                print(json.dumps({"source_sha256": EXPECTED_SOURCE_SHA256, "derived_sha256": cached_hash,
                                  "pairs": 80, "factor": 64.0 / math.sqrt(128.0),
                                  "representative_relative_max_error": proof.get("representative_relative_max_error"),
                                  "destination": str(destination), "reused": True}, sort_keys=True))
                return 0
        except (ValueError, RuntimeError, json.JSONDecodeError):
            pass
    source_hash = sha256(source)
    if source_hash != EXPECTED_SOURCE_SHA256:
        raise SystemExit(f"source SHA-256 changed: {source_hash}")
    weights, metadata = mx.load(str(source), return_metadata=True)
    keys = set(weights)
    a_keys = {key for key in keys if key.endswith(".lora_A.weight")}
    b_keys = {key for key in keys if key.endswith(".lora_B.weight")}
    if len(a_keys) != 80 or len(b_keys) != 80:
        raise SystemExit(f"expected 80 A/B pairs; found A={len(a_keys)} B={len(b_keys)}")
    factor = 64.0 / math.sqrt(128.0)
    converted = dict(weights)
    for a_key in sorted(a_keys):
        b_key = a_key.replace(".lora_A.weight", ".lora_B.weight")
        if b_key not in b_keys:
            raise SystemExit(f"unpaired A matrix: {a_key}")
        a, b = weights[a_key], weights[b_key]
        if a.ndim != 2 or b.ndim != 2 or a.shape[0] != 128 or b.shape[1] != 128 or a.shape[0] != b.shape[1]:
            raise SystemExit(f"unexpected factor dimensions: {a_key}={a.shape} {b_key}={b.shape}")
        converted[b_key] = (b.astype(mx.float32) * factor).astype(b.dtype)
    if len(a_keys | b_keys) != len(keys):
        raise SystemExit("unexpected tensor keys outside the validated A/B pairs")

    # Validate a representative real pair after destination-dtype rounding.
    sample_a = weights[sorted(a_keys)[0]].T.astype(mx.float32)
    sample_b = weights[sorted(b_keys)[0]].T.astype(mx.float32)
    sample_converted_b = converted[sorted(b_keys)[0]].T.astype(mx.float32)
    expected = (sample_a @ sample_b) * factor
    observed = sample_a @ sample_converted_b
    mx.eval(expected, observed)
    max_error = float(mx.max(mx.abs(expected - observed)).item())
    max_expected = float(mx.max(mx.abs(expected)).item())
    relative_error = max_error / max(max_expected, 1e-12)
    if not math.isfinite(relative_error) or relative_error > 0.01:
        raise SystemExit(f"representative rsLoRA equivalence check failed: relative max error {relative_error}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    # mlx.save_safetensors appends the extension when it is absent.
    temp = destination.with_name(destination.stem + f".tmp-{os.getpid()}.safetensors")
    out_metadata = dict(metadata or {})
    out_metadata["dexdiffusion_conversion"] = json.dumps({
        "method": "rsLoRA alpha/sqrt(rank) folded into B",
        "source_sha256": source_hash,
        "rank": 128,
        "alpha": 64,
        "factor": factor,
        "pairs": len(a_keys),
        "representative_relative_max_error": relative_error,
    }, sort_keys=True)
    try:
        mx.save_safetensors(str(temp), converted, metadata=out_metadata)
        os.replace(temp, destination)
    finally:
        if temp.exists():
            temp.unlink()
    check, check_metadata = mx.load(str(destination), return_metadata=True)
    if len(check) != len(weights) or check_metadata.get("dexdiffusion_conversion") != out_metadata["dexdiffusion_conversion"]:
        destination.unlink(missing_ok=True)
        raise SystemExit("derived file read-back verification failed")
    print(json.dumps({"source_sha256": source_hash, "derived_sha256": sha256(destination),
                      "pairs": len(a_keys), "factor": factor,
                      "representative_relative_max_error": relative_error,
                      "destination": str(destination)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
