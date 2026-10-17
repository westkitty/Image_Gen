#!/usr/bin/env python3
"""Cold/warm performance harness for DexDiffusion (infrastructure D).

Submits N identical controlled-generate jobs through the running console
(127.0.0.1:31337, so the arbiter, quarantine and privacy rules all apply),
one at a time, and splits each run's wall time into the sd-cli phases logged on
Big Mac: process + model load, conditioning, sampling, VAE decode, and the
MacBook-side overhead (preflight, ssh, transfer, publish).

Run 1 is the first process start in this harness; it is not assumed to be a true
cold OS file-cache run. Runs 2..N are sequential repeats. Every per-run sd-cli worker reloads the weights,
so the load lines on the warm runs ARE the per-run reload cost that a resident
server would avoid. Matched conditions: same target, size, steps, sampler and
seed, the console queue must be idle, and Big Mac load is sampled before each run.

The prompt is a fixed neutral test string; nothing private is sent or written.
Usage: python3 -I perf_harness.py --target sd15 --runs 3 --out docs/parity/perf/<file>.json
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:31337"
ROOT = Path(__file__).resolve().parents[3]
RUNS = ROOT / "sdcpp-workflow" / "runs"
PROMPT = "perf harness test card, grey geometric shapes"
TERMINAL = {"pass", "complete", "failed", "fail", "cancelled", "interrupted"}
PHASES = {
    "load_s": re.compile(r"loading tensors completed, taking ([\d.]+)s"),
    "condition_s": re.compile(r"get_learned_condition completed, taking ([\d.]+)s"),
    "sampling_s": re.compile(r"sampling completed, taking ([\d.]+)s"),
    "decode_s": re.compile(r"decode_first_stage completed, taking ([\d.]+)s"),
    "generate_s": re.compile(r"generate_image completed in ([\d.]+)s"),
}


def api(path: str, body: dict | None = None) -> dict:
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        return json.load(e)


def busy() -> list[str]:
    d = api("/api/jobs")
    jobs = d.get("jobs", d)
    return [j["id"][:8] for j in jobs if str(j.get("status")).lower() in ("queued", "running")]


def bigmac_load() -> str | None:
    try:
        out = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "westcat",
                              "echo LOAD=$(sysctl -n vm.loadavg)"], capture_output=True, text=True, timeout=30).stdout
        m = re.search(r"LOAD=\{?\s*([\d.]+)", out)   # output marker, never the ssh exit status
        return m.group(1) if m else None
    except Exception:
        return None


def phases_for(image_id: str) -> dict:
    run = RUNS / re.sub(r"-s\d+-.*$", "", image_id.rsplit(".", 1)[0])
    out: dict = {"run_dir": run.name}
    text = "".join(p.read_text(errors="replace") for p in sorted(run.glob("*.log")))
    for k, rx in PHASES.items():
        vals = [float(v) for v in rx.findall(text)]
        # one sd-cli invocation per run; tensor loads are summed (model, then VAE/encoder lazily)
        out[k] = round(sum(vals), 2) if k == "load_s" else (vals[-1] if vals else None)
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default="sd15")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--sampler", default="euler")
    ap.add_argument("--seed", type=int, default=7001)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    if busy():
        print("REFUSED: console queue is not idle:", busy(), file=sys.stderr)
        return 2
    body = dict(target=a.target, prompt=PROMPT, width=a.width, height=a.height, steps=a.steps,
                cfg_scale=7, seed=a.seed, sampler=a.sampler)
    rows = []
    for i in range(a.runs):
        load = bigmac_load()
        t0 = time.monotonic()
        r = api("/api/actions/generate-controlled", body)
        jid = r.get("job_id") or r.get("jobId")
        if not jid:
            print("SUBMIT FAILED", r, file=sys.stderr)
            return 1
        started = None
        deadline = time.monotonic() + 1200
        while True:
            j = api("/api/jobs/" + jid)
            j = j.get("job", j)
            st = str(j.get("status")).lower()
            if st == "running" and started is None:
                started = time.monotonic()
            # `pass` can appear before the final job-store write. Do not submit
            # the next run until the durable terminal timestamp is present.
            done_at = j.get("completedAt", j.get("completed_at"))
            if st in TERMINAL and (st not in ("pass", "complete") or done_at):
                break
            if time.monotonic() >= deadline:
                print("JOB TIMED OUT waiting for terminal status:", st, jid, file=sys.stderr)
                return 1
            time.sleep(0.5)
        wall = time.monotonic() - t0
        imgs = [x.get("imageId") for x in (j.get("results") or []) if x.get("imageId")]
        if not imgs and j.get("canonicalImages"):
            imgs = [c.get("id") if isinstance(c, dict) else c for c in j["canonicalImages"]]
        row = dict(run=i + 1, kind="first-process-start" if i == 0 else "repeat", job=jid, status=st, wall_s=round(wall, 2),
                   queue_s=round((started or t0) - t0, 2), bigmac_load1=load, image=imgs[0] if imgs else None)
        if imgs:
            row.update(phases_for(imgs[0]))
            if row.get("generate_s") is not None:
                row["overhead_s"] = round(wall - row["queue_s"] - row["generate_s"], 2)
        rows.append(row)
        print(json.dumps(row))
        sys.stdout.flush()
        if st not in ("pass", "complete"):
            break
    warm = [r for r in rows if r["kind"] == "repeat" and r["status"] in ("pass", "complete")]

    def med(k: str) -> float | None:
        v = [r[k] for r in warm if r.get(k) is not None]
        return round(statistics.median(v), 2) if v else None

    summary = dict(schema="dexdiffusion.perf.v1", at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                   engine="sd-cli 7f0e728 (per-run worker)", conditions=dict(body, prompt="<fixed neutral test string>"),
                   runs=rows, warm_median={k: med(k) for k in ("wall_s", "load_s", "condition_s", "sampling_s", "decode_s", "generate_s", "overhead_s")},
                   note="load_s on warm runs is the per-run model reload cost a resident engine would avoid; not compared against sd-server (not running).")
    Path(a.out).write_text(json.dumps(summary, indent=1) + "\n")
    return 0 if len(rows) == a.runs and all(r["status"] in ("pass", "complete") for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
