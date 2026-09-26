#!/usr/bin/env python3
"""DexDiffusion voice/music execution driver (runs ON Big Mac, compute only).

Invoked by operator-console/media-bridge.js over `ssh westcat` with the
worker's own Python (voice venv, ACE-Step .venv or the Magenta venv):

    <worker python> dexmedia_remote.py <job-dir>/request.json

Contract:
  * request.json is written 0600 by the bridge and deleted here immediately
    after reading, so private text (speech text, transcripts, descriptions,
    prompts, lyrics) never appears in process arguments or stays on disk.
  * All output goes to <job-dir>/out; the bridge copies the final WAV to the
    MacBook, verifies its checksum and then deletes the whole job dir.
  * Results are reported only through in-band markers on stdout
    (Tailscale SSH exit status is not trusted):
        DEXMEDIA_OUTPUT=<path>  DEXMEDIA_SHA256=<hex>  DEXMEDIA_BYTES=<n>
        DEXMEDIA_DURATION=<sec> DEXMEDIA_SAMPLE_RATE=<hz> DEXMEDIA_CHANNELS=<n>
        DEXMEDIA_PASS           or   DEXMEDIA_FAIL=<gate> + DEXMEDIA_ERROR=<msg>
"""

import glob
import hashlib
import json
import os
import shutil
import sys
import traceback
import wave

PRIVATE_KEYS = ("text", "ref_text", "instruct", "prompt", "caption", "lyrics")


def marker(key, value=None):
    print(f"DEXMEDIA_{key}" + ("" if value is None else f"={value}"), flush=True)


def scrub(msg, req):
    """Remove any private request text from an error message."""
    out = str(msg)
    for k in PRIVATE_KEYS:
        v = req.get(k)
        if isinstance(v, str) and len(v) >= 3:
            out = out.replace(v, "[REDACTED]")
    return out.replace("\n", " ")[:300]


def fail(gate, msg, req):
    marker("FAIL", gate)
    marker("ERROR", scrub(msg, req))
    sys.exit(0)


def run_cli(main, argv):
    """Run a console-script main() in-process (argv never reaches `ps`)."""
    sys.argv = argv
    try:
        rc = main()
    except SystemExit as e:  # click/argparse CLIs exit on completion
        rc = e.code
    if rc not in (None, 0):
        raise RuntimeError(f"generator exited with status {rc}")


def gen_tts(req, out_dir):
    import mlx.core as mx
    from mlx_audio.tts import generate as tts

    if req.get("seed") is not None:
        mx.random.seed(int(req["seed"]))
    argv = ["mlx_audio.tts.generate", "--model", req["model"], "--text", req["text"],
            "--output_path", out_dir, "--file_prefix", "out", "--audio_format", "wav"]
    w = req["worker"]
    if w == "kokoro":
        argv += ["--voice", req["voice_path"], "--lang_code", req["lang_code"], "--speed", str(req.get("speed", 1.0))]
    elif w == "qwen3-tts-base":
        argv += ["--ref_audio", req["ref_audio"], "--lang_code", req["lang_code"]]
        if req.get("ref_text"):
            argv += ["--ref_text", req["ref_text"]]
    elif w == "qwen3-tts-voice-design":
        argv += ["--instruct", req["instruct"], "--lang_code", req["lang_code"]]
    else:
        raise ValueError("unknown tts worker")
    run_cli(tts.main, argv)
    files = sorted(glob.glob(os.path.join(out_dir, "out*.wav")))
    return files[0] if files else None


def gen_magenta(req, out_dir):
    # MAGENTA_HOME is a job-private dir whose resources/models symlink to the
    # installed mrt2_small tree, so outputs never land in the model store.
    from magenta_rt.cli import main

    run_cli(main, ["mrt", "mlx", "generate", "--prompt", req["prompt"],
                   "--duration", str(float(req["duration"])), "--model", "mrt2_small"])
    produced = os.path.join(os.environ["MAGENTA_HOME"], "magenta-rt-v2", "outputs", "output_audio_mlx_mrt2_small.wav")
    if not os.path.isfile(produced):
        return None
    dest = os.path.join(out_dir, "magenta.wav")
    shutil.move(produced, dest)
    return dest


def gen_ace(req, out_dir):
    src = req["ace_src"]
    sys.path.insert(0, src)
    os.chdir(src)
    from acestep.handler import AceStepHandler
    from acestep.llm_inference import LLMHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music

    dit = AceStepHandler()
    msg, ok = dit.initialize_service(project_root=src, config_path="acestep-v15-turbo", device="auto", offload_to_cpu=False)
    if not ok:
        raise RuntimeError(f"ACE-Step DiT init failed: {msg}")
    llm = LLMHandler()
    msg, ok = llm.initialize(checkpoint_dir=os.path.join(src, "checkpoints"), lm_model_path="acestep-5Hz-lm-0.6B",
                             backend="mlx", device="auto", offload_to_cpu=False, dtype=None)
    if not ok:
        raise RuntimeError(f"ACE-Step 0.6B LM init failed: {msg}")
    kw = dict(task_type="text2music", thinking=True, caption=req["caption"],
              lyrics=req.get("lyrics") or ("[Instrumental]" if req.get("instrumental") else ""),
              instrumental=bool(req.get("instrumental")), vocal_language=req.get("vocal_language") or "unknown",
              duration=float(req["duration"]), inference_steps=8, guidance_scale=1.0, seed=int(req["seed"]))
    if req.get("ref_audio"):
        kw["reference_audio"] = req["ref_audio"]
        kw["audio_cover_strength"] = float(req.get("influence", 0.5))
    params = GenerationParams(**kw)
    config = GenerationConfig(batch_size=1, audio_format="wav", use_random_seed=False, seeds=[int(req["seed"])])
    result = generate_music(dit, llm, params=params, config=config, save_dir=out_dir)
    if not result.success:
        raise RuntimeError(f"ACE-Step generation failed: {result.status_message}")
    paths = [a.get("path") for a in (result.audios or []) if a.get("path")]
    paths = [p for p in paths if os.path.isfile(p)] or sorted(glob.glob(os.path.join(out_dir, "**", "*.wav"), recursive=True))
    return paths[0] if paths else None


def validate(path, req):
    if not path or not os.path.isfile(path):
        fail("output-missing", "generator finished without producing a WAV", req)
    size = os.path.getsize(path)
    if size < 1024:
        fail("output-invalid", f"output WAV too small ({size} bytes)", req)
    try:
        with wave.open(path, "rb") as w:
            frames, rate, ch = w.getnframes(), w.getframerate(), w.getnchannels()
    except Exception as e:  # not a readable PCM WAV
        fail("output-invalid", f"output is not a readable WAV: {e}", req)
    if frames <= 0 or rate <= 0:
        fail("output-invalid", "output WAV has no audio frames", req)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    marker("OUTPUT", path)
    marker("SHA256", h.hexdigest())
    marker("BYTES", size)
    marker("DURATION", round(frames / float(rate), 3))
    marker("SAMPLE_RATE", rate)
    marker("CHANNELS", ch)
    marker("PASS")


def main():
    req_path = sys.argv[1]
    try:
        with open(req_path) as f:
            req = json.load(f)
    finally:
        try:
            os.unlink(req_path)
        except OSError:
            pass
    # Paths from the MacBook may use $HOME (WORKER_PATHS); expand them here.
    for k in ("out_dir", "model", "voice_path", "ace_src", "ref_audio"):
        if isinstance(req.get(k), str):
            req[k] = os.path.expanduser(os.path.expandvars(req[k]))
    out_dir = req["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    marker("STARTED", req["worker"])
    try:
        w = req["worker"]
        if w in ("kokoro", "qwen3-tts-base", "qwen3-tts-voice-design"):
            path = gen_tts(req, out_dir)
        elif w == "magenta-rt":
            path = gen_magenta(req, out_dir)
        elif w == "ace-step":
            path = gen_ace(req, out_dir)
        else:
            fail("worker-unavailable", f"unknown worker {w}", req)
    except SystemExit:
        raise
    except BaseException as e:  # noqa: BLE001 - report every generator failure
        tb = traceback.format_exc().strip().splitlines()[-1:]
        fail("generation", f"{type(e).__name__}: {e} | {' '.join(tb)}", req)
    validate(path, req)


if __name__ == "__main__":
    main()
