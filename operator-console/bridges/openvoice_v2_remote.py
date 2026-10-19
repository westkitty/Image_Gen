#!/usr/bin/env python3
"""Job-scoped OpenVoice V2 tone-color conversion worker.

Inputs, outputs and request JSON must live inside the exact ephemeral job folder.
The model is read-only and stays in the isolated external-volume environment.
"""
import hashlib
import json
import math
import os
import sys
import traceback
import wave
import glob


def marker(name, value=None):
    print(f"DEXMEDIA_{name}" if value is None else f"DEXMEDIA_{name}={value}", flush=True)


def fail(gate, message):
    marker("FAIL", gate)
    marker("ERROR", str(message).replace("\n", " ")[:400])
    raise SystemExit(0)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def within(path, root):
    real, base = os.path.realpath(path), os.path.realpath(root)
    return real != base and os.path.commonpath([real, base]) == base


def wav_facts(path):
    with wave.open(path, "rb") as w:
        frames, rate, channels, width = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
        if frames <= 0 or rate <= 0 or channels not in (1, 2) or width not in (2, 3, 4):
            raise ValueError("WAV header has invalid audio properties")
        duration = frames / float(rate)
    if os.path.getsize(path) < 1024 or duration < 0.25 or duration > 120:
        raise ValueError("WAV must be 0.25-120 seconds and at least 1024 bytes")
    return {"bytes": os.path.getsize(path), "duration": duration, "sample_rate": rate, "channels": channels, "sample_width": width}


def validate_request(req, job_dir):
    source = os.path.realpath(req.get("source_audio", ""))
    target = os.path.realpath(req.get("target_audio", ""))
    out_dir = os.path.realpath(req.get("out_dir", ""))
    model_dir = os.path.realpath(req.get("model_dir", ""))
    if not all(within(p, job_dir) for p in (source, target, out_dir)):
        fail("input-scope", "source, target and output must remain inside the owned job directory")
    if not os.path.isfile(source) or not os.path.isfile(target) or not os.path.isdir(out_dir):
        fail("input-missing", "source, target or output directory is missing")
    if not os.path.isdir(model_dir):
        fail("model-missing", "OpenVoice V2 checkpoint directory is missing")
    config = os.path.join(model_dir, "converter", "config.json")
    checkpoint = os.path.join(model_dir, "converter", "checkpoint.pth")
    if not os.path.isfile(config) or not os.path.isfile(checkpoint):
        fail("model-missing", "OpenVoice V2 converter config/checkpoint is incomplete")
    model_sha = sha256(checkpoint)
    if model_sha != req.get("model_sha256"):
        fail("model-checksum", "OpenVoice V2 checkpoint checksum differs from the verified model")
    source_sha, target_sha = sha256(source), sha256(target)
    if source_sha == target_sha or os.path.samefile(source, target):
        fail("identity-separation", "source performance and target reference must be distinct audio")
    if source_sha != req.get("source_wav_sha256") or target_sha != req.get("target_wav_sha256"):
        fail("input-checksum", "transferred source or target WAV checksum differs from the MacBook copy")
    try:
        src_facts, tgt_facts = wav_facts(source), wav_facts(target)
    except Exception as exc:
        fail("audio-input", exc)
    return {"source": source, "target": target, "out_dir": out_dir, "model_dir": model_dir, "config": config,
            "checkpoint": checkpoint, "model_sha": model_sha, "source_sha": source_sha, "target_sha": target_sha,
            "src_facts": src_facts, "tgt_facts": tgt_facts}


def main(request_path):
    job_dir = os.path.dirname(os.path.realpath(request_path))
    with open(request_path, "r", encoding="utf-8") as f:
        req = json.load(f)
    os.unlink(request_path)
    validated = validate_request(req, job_dir)
    source, target, out_dir = validated["source"], validated["target"], validated["out_dir"]
    model_dir, config, checkpoint, model_sha = validated["model_dir"], validated["config"], validated["checkpoint"], validated["model_sha"]
    source_sha, target_sha, src_facts = validated["source_sha"], validated["target_sha"], validated["src_facts"]
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    output = os.path.join(out_dir, "converted.wav")
    marker("STARTED", "openvoice-v2")
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from openvoice.api import ToneColorConverter

        converter = ToneColorConverter(config, device="cpu")  # default watermark remains enabled
        converter.load_ckpt(checkpoint)
        marker("MODEL_LOADED", torch.__version__)
        watermark_files = glob.glob(os.path.join(os.environ.get("HF_HOME", ""), "hub", "models--M4869--WavMark", "snapshots", "*", "step59000_snr39.99_pesq4.35_BERP_none0.30_mean1.81_std1.81.model.pkl"))
        if not watermark_files or sha256(watermark_files[0]) != req.get("watermark_sha256"):
            fail("watermark-checksum", "OpenVoice default watermark model is missing or differs from verified metadata")
        source_embedding = converter.extract_se([source])
        target_embedding = converter.extract_se([target])
        if source_embedding.shape != target_embedding.shape or not source_embedding.numel():
            fail("embedding-shape", "source and target speaker embeddings have incompatible shapes")
        if not torch.isfinite(source_embedding).all() or not torch.isfinite(target_embedding).all():
            fail("embedding-invalid", "speaker embedding contains non-finite values")
        marker("EMBEDDINGS", str(tuple(source_embedding.shape)))
        converter.convert(source, source_embedding, target_embedding, output_path=output)
        if not os.path.isfile(output) or os.path.getsize(output) < 1024:
            fail("output-missing", "OpenVoice returned without a usable WAV")
        facts = wav_facts(output)
        audio, rate = sf.read(output, dtype="float32", always_2d=True)
        if rate != facts["sample_rate"] or not np.isfinite(audio).all():
            fail("output-invalid", "converted WAV could not be decoded as finite audio")
        rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
        if not math.isfinite(rms) or rms < 1e-5:
            fail("output-silent", "converted WAV is silent or near-silent")
        out_sha = sha256(output)
        if out_sha in (source_sha, target_sha):
            fail("output-unchanged", "converted WAV is byte-identical to an input")
        if not 0.5 <= facts["duration"] / src_facts["duration"] <= 1.5:
            fail("duration-invalid", "converted duration differs implausibly from its source")
        marker("OUTPUT", output)
        marker("SHA256", out_sha)
        marker("BYTES", facts["bytes"])
        marker("DURATION", round(facts["duration"], 4))
        marker("SAMPLE_RATE", facts["sample_rate"])
        marker("CHANNELS", facts["channels"])
        marker("RMS", f"{rms:.8f}")
        marker("WATERMARK", "enabled-default")
        marker("MODEL_SHA256", model_sha)
        marker("WATERMARK_SHA256", sha256(watermark_files[0]))
        marker("PASS")
    except SystemExit:
        raise
    except BaseException as exc:  # worker errors return in-band diagnostics
        detail = traceback.format_exc().strip().splitlines()[-1:]
        fail("inference", f"{type(exc).__name__}: {exc} {' '.join(detail)}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("request", "expected one job request path")
    try:
        main(sys.argv[1])
    except SystemExit:
        raise
    except BaseException as exc:
        fail("worker", f"{type(exc).__name__}: {exc}")
