#!/usr/bin/env bash
# sdcpp-model-inventory-wc2tb.sh — inventory candidate model files on BigMac wc2tb.
# PASS = inventory and manifest writing completed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/sdcpp-lib.sh"
load_config

APPLY=0
INCLUDE_MEDIUM=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --include-medium) INCLUDE_MEDIUM=1; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bin/sdcpp-model-inventory-wc2tb.sh [--apply] [--include-medium]

Scans /Volumes/wc2tb for image-generation model candidates and writes a manifest
under /Volumes/wc2tb/ImageGen/manifests/. Dry-run by default.
EOF
      exit 0
      ;;
    *) fail "args" "Unknown argument: $1" ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
REMOTE_ROOT="/Volumes/wc2tb/ImageGen"
MODEL_VOLUME="wc2tb"
MODEL_VOLUME_PATH="/Volumes/wc2tb"
LOCAL_CACHE="$SDCPP_STATE_DIR/model-inventory-cache.json"

ROUTE_OUT="$(ssh -o ConnectTimeout=15 "$SSH_TARGET" 'whoami && hostname && pwd && sw_vers; printf "%s\n" "__MODEL_INVENTORY_ROUTE_DONE__"' 2>/dev/null || true)"
if ! printf '%s\n' "$ROUTE_OUT" | grep -q '__MODEL_INVENTORY_ROUTE_DONE__'; then
  fail "route" "ssh $SSH_TARGET did not return the inventory route sentinel."
fi

ROUTE_USER="$(printf '%s\n' "$ROUTE_OUT" | sed -n '1p')"
ROUTE_HOST="$(printf '%s\n' "$ROUTE_OUT" | sed -n '2p')"
if [ "$ROUTE_USER" != "bigmac" ] || [ "$ROUTE_HOST" != "bigmac" ]; then
  fail "route-identity" "Expected bigmac/bigmac, got ${ROUTE_USER}/${ROUTE_HOST}."
fi

VOLUME_OUT="$(ssh -o ConnectTimeout=20 "$SSH_TARGET" 'test -d /Volumes/wc2tb && df -h /Volumes/wc2tb && echo WC2TB_PRESENT' 2>/dev/null || true)"
if ! printf '%s\n' "$VOLUME_OUT" | grep -q 'WC2TB_PRESENT'; then
  fail "volume" "/Volumes/wc2tb is not mounted or not readable on BigMac."
fi

REMOTE_JSON="$(ssh -o ConnectTimeout=25 "$SSH_TARGET" "APPLY=$APPLY INCLUDE_MEDIUM=$INCLUDE_MEDIUM ROOT='$REMOTE_ROOT' TS='$TS' python3 -" <<'PYREMOTE'
import datetime as dt
import hashlib
import json
import os
import re
import shutil
from pathlib import Path

apply_requested = os.environ.get("APPLY", "0") == "1"
include_medium = os.environ.get("INCLUDE_MEDIUM", "0") == "1"
root = Path(os.environ["ROOT"])
ts = os.environ["TS"]
volume_root = Path("/Volumes/wc2tb")

manifest_dir = root / "manifests"
incoming_dir = root / "incoming"
manifest_dir.mkdir(parents=True, exist_ok=True)
incoming_dir.mkdir(parents=True, exist_ok=True)

inventory_path = manifest_dir / f"model-inventory-{ts}.json"
plan_path = manifest_dir / f"model-move-plan-{ts}.md"
result_path = manifest_dir / f"model-move-result-{ts}.md"

candidate_exts = {".safetensors", ".ckpt", ".gguf", ".pt", ".pth", ".bin", ".onnx"}
skip_dir_names = {
    ".git", "node_modules", "runs", "logs", "state", ".venv", "venv", "env", "__pycache__",
    ".Spotlight-V100", ".fseventsd", ".Trashes", ".Trash", ".cache", "Library", "dist", "build",
}
skip_path_markers = (
    "/voiceTools/".lower(),
    "/wan models/".lower(),
    "/deepseek".lower(),
    "/stationary/".lower(),
)

def iso_now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def sha256sum(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def short_sha(path: Path) -> str:
    return sha256sum(path)[:8]

def bytes_of(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0

def contains_any(value: str, needles) -> bool:
    return any(n in value for n in needles)

def classify(path: Path):
    lower = str(path).lower()
    name = path.name.lower()
    ext = path.suffix.lower()
    if str(path).startswith(str(root)):
        return None
    if ext not in candidate_exts:
        return None
    if contains_any(lower, skip_path_markers):
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "skip",
            "confidence": "low",
            "action": "skip",
            "reason": "Unrelated system/model tree; not an Image_Gen asset.",
            "proposed_destination": None,
        }
    if "controlnet" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "controlnet",
            "confidence": "high",
            "action": "move",
            "reason": "ControlNet model candidate.",
            "proposed_destination": str(root / "controlnet" / path.name),
        }
    if any(token in lower for token in ["realesrgan", "gfpgan", "codeformer", "swinir", "ultrasharp", "nmkd", "bsrgan", "upscale", "esrgan"]):
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "upscalers",
            "confidence": "high",
            "action": "move",
            "reason": "Upscaler weight candidate.",
            "proposed_destination": str(root / "upscalers" / path.name),
        }
    if "lora" in lower or "loras" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "loras",
            "confidence": "high",
            "action": "move",
            "reason": "LoRA candidate.",
            "proposed_destination": str(root / "loras" / path.name),
        }
    if "embedding" in lower or "embeddings" in lower or "textual_inversion" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "embeddings",
            "confidence": "high",
            "action": "move",
            "reason": "Embedding / textual inversion candidate.",
            "proposed_destination": str(root / "embeddings" / path.name),
        }
    if "hypernetwork" in lower or "hypernetworks" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "hypernetworks",
            "confidence": "high",
            "action": "move",
            "reason": "Hypernetwork candidate.",
            "proposed_destination": str(root / "hypernetworks" / path.name),
        }
    if name == "ae.safetensors" or name.startswith("ae.") or " ae." in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "flux/shared",
            "confidence": "high",
            "action": "move",
            "reason": "Flux autoencoder / shared component candidate.",
            "proposed_destination": str(root / "flux" / "shared" / path.name),
        }
    if "clip_l" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "flux/shared",
            "confidence": "high",
            "action": "move",
            "reason": "Flux CLIP-L candidate.",
            "proposed_destination": str(root / "flux" / "shared" / path.name),
        }
    if "t5xxl" in lower or "t5-v1_1-xxl" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "flux/shared",
            "confidence": "high",
            "action": "move",
            "reason": "Flux T5XXL candidate.",
            "proposed_destination": str(root / "flux" / "shared" / path.name),
        }
    if "flux1-schnell" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "flux/flux1-schnell",
            "confidence": "high",
            "action": "move",
            "reason": "Flux Schnell diffusion/model candidate.",
            "proposed_destination": str(root / "flux" / "flux1-schnell" / path.name),
        }
    if any(token in lower for token in ["sd_xl_turbo", "sdxl turbo", "turbo"]) and ("xl" in lower or "sdxl" in lower):
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sdxl-turbo",
            "confidence": "high",
            "action": "move",
            "reason": "SDXL Turbo checkpoint candidate.",
            "proposed_destination": str(root / "checkpoints" / "sdxl-turbo" / path.name),
        }
    if "sd_xl_base" in lower or ("sdxl" in lower and "base" in lower):
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sdxl",
            "confidence": "high",
            "action": "move",
            "reason": "SDXL base checkpoint candidate.",
            "proposed_destination": str(root / "checkpoints" / "sdxl" / path.name),
        }
    if any(token in lower for token in ["v1-5", "sd1.5", "sd15", "sd-v1-5"]) or "inpainting" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sd15",
            "confidence": "high",
            "action": "move",
            "reason": "Stable Diffusion 1.5 checkpoint candidate.",
            "proposed_destination": str(root / "checkpoints" / "sd15" / path.name),
        }
    if "xl" in lower and "checkpoint" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sdxl",
            "confidence": "medium",
            "action": "manual_review",
            "reason": "SDXL-like checkpoint name, but not specific enough for an automatic move.",
            "proposed_destination": str(root / "checkpoints" / "sdxl" / path.name),
        }
    if "xl" in lower and ext in {".safetensors", ".ckpt"}:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sdxl",
            "confidence": "medium",
            "action": "manual_review",
            "reason": "SDXL-ish name detected, but the filename is ambiguous enough to keep manual.",
            "proposed_destination": str(root / "checkpoints" / "sdxl" / path.name),
        }
    if "vae" in lower:
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "vaes",
            "confidence": "high",
            "action": "move",
            "reason": "VAE candidate.",
            "proposed_destination": str(root / "vaes" / path.name),
        }
    if ext == ".gguf":
        return {
            "source_path": str(path),
            "filename": path.name,
            "size_bytes": bytes_of(path),
            "extension": ext,
            "category": "checkpoints/sdxl",
            "confidence": "medium",
            "action": "manual_review",
            "reason": "GGUF candidate not recognized as a known Image_Gen model family.",
            "proposed_destination": str(root / "incoming" / path.name),
        }
    return {
        "source_path": str(path),
        "filename": path.name,
        "size_bytes": bytes_of(path),
        "extension": ext,
        "category": "incoming",
        "confidence": "low",
        "action": "manual_review",
        "reason": "Candidate file does not match a safe automatic move rule.",
        "proposed_destination": str(root / "incoming" / path.name),
    }

def walk_candidates(base: Path):
    for current, dirs, files in os.walk(base):
        current_path = Path(current)
        rel = current_path.as_posix().lower()
        if str(current_path).startswith(str(root)):
            dirs[:] = []
            continue
        if any(marker in rel for marker in skip_path_markers):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in skip_dir_names]
        if any(part in current_path.parts for part in ("ImageGen", ".git")):
            dirs[:] = []
        for filename in files:
            file_path = current_path / filename
            if file_path.suffix.lower() not in candidate_exts:
                continue
            rec = classify(file_path)
            if rec:
                yield rec

def render_table(rows, columns):
    if not rows:
        return "No rows.\n"
    widths = {col: len(col) for col in columns}
    for row in rows:
        for col in columns:
            widths[col] = max(widths[col], len(str(row.get(col, ""))))
    header = "| " + " | ".join(col.ljust(widths[col]) for col in columns) + " |"
    sep = "|-" + "-|-".join("-" * widths[col] for col in columns) + "-|"
    lines = [header, sep]
    for row in rows:
        lines.append("| " + " | ".join(str(row.get(col, "")).replace("\n", " ").ljust(widths[col]) for col in columns) + " |")
    return "\n".join(lines) + "\n"

records = list(walk_candidates(volume_root))
high_candidates = [r for r in records if r["confidence"] == "high" and r["action"] == "move"]
medium_candidates = [r for r in records if r["confidence"] == "medium" and r["action"] == "manual_review"]
low_candidates = [r for r in records if r["confidence"] == "low"]

selected = [r for r in records if r["confidence"] == "high" or (include_medium and r["confidence"] == "medium")]
inventory_write_ok = True
plan_write_ok = True
result_write_ok = True
moved_count = duplicate_count = collision_count = skipped_count = 0

if apply_requested:
    for rec in selected:
        source = Path(rec["source_path"])
        dest = Path(rec["proposed_destination"])
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not source.exists():
            rec["action"] = "missing_skip"
            rec["reason"] = "Source path no longer exists; it was likely already moved or removed."
            skipped_count += 1
            continue
        if dest.exists():
            source_sha = sha256sum(source)
            dest_sha = sha256sum(dest)
            rec["sha256"] = source_sha
            rec["destination_sha256"] = dest_sha
            if dest.stat().st_size == source.stat().st_size and dest_sha == source_sha:
                rec["action"] = "duplicate_skip"
                rec["reason"] = "Destination already exists with identical size and sha256."
                duplicate_count += 1
                continue
            suffix = f".conflict-{source_sha[:8]}"
            if dest.suffix:
                collision_dest = dest.with_name(dest.stem + suffix + dest.suffix)
            else:
                collision_dest = dest.with_name(dest.name + suffix)
            shutil.move(str(source), str(collision_dest))
            rec["action"] = "move_collision"
            rec["moved_to"] = str(collision_dest)
            rec["reason"] = "Destination existed with different content; preserved both files using a collision suffix."
            rec["sha256"] = source_sha
            collision_count += 1
            moved_count += 1
        else:
            shutil.move(str(source), str(dest))
            rec["action"] = "move"
            rec["moved_to"] = str(dest)
            moved_count += 1

remaining_high_confidence_paths = [r["source_path"] for r in records if r["confidence"] == "high" and r["action"] == "move"]
manual_review_paths = [r["source_path"] for r in records if r["action"] == "manual_review"]
duplicate_skip_paths = [r["source_path"] for r in records if r["action"] == "duplicate_skip"]
missing_source_paths = [r["source_path"] for r in records if r["action"] == "missing_skip"]

total_candidates = len(records)
manual_review_count = len([r for r in records if r["action"] == "manual_review"])
duplicate_skip_count = len(duplicate_skip_paths)
missing_source_skip_count = len(missing_source_paths)
skipped_count = skipped_count + len([r for r in records if r["action"] == "skip"])
if remaining_high_confidence_paths:
    recommended_next_step = "Review the remaining high-confidence model candidates outside the new root, then rerun with --apply only if their destinations are correct."
else:
    recommended_next_step = "Inventory complete; rerun the stage check to confirm the current root state."

summary = {
    "checked_at": iso_now(),
    "route_ok": True,
    "model_volume": "wc2tb",
    "model_volume_path": "/Volumes/wc2tb",
    "model_volume_mounted": True,
    "model_volume_free_space": "",
    "external_root": str(root),
    "apply_requested": apply_requested,
    "include_medium": include_medium,
    "root_exists": root.exists(),
    "write_test": "pass" if root.exists() else "fail",
    "total_candidates": total_candidates,
    "high_confidence_candidates": len(high_candidates),
    "medium_confidence_candidates": len(medium_candidates),
    "low_confidence_candidates": len(low_candidates),
    "manual_review_count": manual_review_count,
    "remaining_high_confidence_outside_root": len(remaining_high_confidence_paths),
    "still_actionable_high_confidence_count": len(remaining_high_confidence_paths),
    "remaining_high_confidence_preview": remaining_high_confidence_paths[:20],
    "still_actionable_high_confidence_preview": remaining_high_confidence_paths[:20],
    "manual_review_preview": manual_review_paths[:20],
    "duplicate_skip_count": duplicate_skip_count,
    "duplicate_skip_preview": duplicate_skip_paths[:20],
    "missing_source_skip_count": missing_source_skip_count,
    "missing_source_preview": missing_source_paths[:20],
    "recommended_next_step": recommended_next_step,
    "moved_count": moved_count,
    "duplicate_count": duplicate_count,
    "collision_count": collision_count,
    "skipped_count": skipped_count,
    "inventory_path": str(inventory_path),
    "plan_path": str(plan_path),
    "result_path": str(result_path),
    "inventory_write_ok": inventory_write_ok,
    "plan_write_ok": plan_write_ok,
    "result_write_ok": result_write_ok,
    "records": records,
    "selected_records": selected,
}

# Free space is filled in after the inventory snapshot so it reflects the remote volume.
try:
    import subprocess
    df = subprocess.run(["df", "-h", "/Volumes/wc2tb"], capture_output=True, text=True, check=True)
    lines = [line for line in df.stdout.splitlines() if line.strip()]
    summary["model_volume_free_space"] = lines[-1] if lines else ""
except Exception:
    summary["model_volume_free_space"] = ""

plan_lines = [
    f"# Model Move Plan ({ts})",
    "",
    f"- Canonical root: `{root}`",
    f"- Apply requested: `{str(apply_requested).lower()}`",
    f"- Include medium confidence: `{str(include_medium).lower()}`",
    f"- Total candidates: `{total_candidates}`",
f"- High confidence: `{len(high_candidates)}`",
f"- Medium confidence: `{len(medium_candidates)}`",
f"- Manual review: `{manual_review_count}`",
f"- Remaining high-confidence outside root: `{len(remaining_high_confidence_paths)}`",
    "",
    "## Candidates",
    "",
    render_table(
        [
            {
                "action": r["action"],
                "confidence": r["confidence"],
                "category": r["category"],
                "filename": r["filename"],
                "source": r["source_path"],
                "destination": r.get("proposed_destination") or "",
                "reason": r["reason"],
            }
            for r in records
        ],
        ["action", "confidence", "category", "filename", "source", "destination", "reason"],
    ),
]

result_lines = [
    f"# Model Move Result ({ts})",
    "",
    f"- Apply requested: `{str(apply_requested).lower()}`",
    f"- Moved: `{moved_count}`",
    f"- Duplicates: `{duplicate_count}`",
    f"- Collisions: `{collision_count}`",
    f"- Manual review: `{manual_review_count}`",
    "",
    "## Actions",
    "",
    render_table(
        [
            {
                "action": r["action"],
                "filename": r["filename"],
                "source": r["source_path"],
                "destination": r.get("moved_to") or r.get("proposed_destination") or "",
                "reason": r["reason"],
            }
            for r in records
            if r["action"] in {"move", "move_collision", "duplicate_skip", "manual_review", "skip"}
        ],
        ["action", "filename", "source", "destination", "reason"],
    ),
]

try:
    with inventory_path.open("w") as f:
        json.dump(summary, f, indent=2)
        f.write("\n")
except Exception:
    inventory_write_ok = False
    summary["inventory_write_ok"] = False

try:
    plan_path.write_text("\n".join(plan_lines))
except Exception:
    plan_write_ok = False
    summary["plan_write_ok"] = False

try:
    if apply_requested:
        result_lines.append("")
        result_lines.append("## Moves Applied")
        result_lines.append("")
        result_lines.append(render_table(
            [
                {
                    "action": r["action"],
                    "filename": r["filename"],
                    "destination": r.get("moved_to") or r.get("proposed_destination") or "",
                    "sha256": r.get("sha256") or "",
                }
                for r in records
                if r["action"] in {"move", "move_collision", "duplicate_skip"}
            ],
            ["action", "filename", "destination", "sha256"],
        ))
    else:
        result_lines.append("")
        result_lines.append("## Dry Run")
        result_lines.append("")
        result_lines.append("No files were moved.")
    result_path.write_text("\n".join(result_lines))
except Exception:
    result_write_ok = False
    summary["result_write_ok"] = False

summary["inventory_write_ok"] = inventory_write_ok
summary["plan_write_ok"] = plan_write_ok
summary["result_write_ok"] = result_write_ok

print(json.dumps(summary, indent=2))
PYREMOTE
)"

printf '%s\n' "$REMOTE_JSON" > "$LOCAL_CACHE"

TOTAL="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("total_candidates", 0))' "$REMOTE_JSON")"
HIGH="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("high_confidence_candidates", 0))' "$REMOTE_JSON")"
MOVED="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("moved_count", 0))' "$REMOTE_JSON")"
WRITE_OK="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print("yes" if d.get("inventory_write_ok") and d.get("plan_write_ok") and d.get("result_write_ok") else "no")' "$REMOTE_JSON")"

if [ "$TOTAL" -eq 0 ] || [ "$WRITE_OK" != "yes" ]; then
  printf '\n==== PARTIAL ====\nInventory completed, but no candidates were found or one of the manifests failed to write.\nCache: %s\n' "$LOCAL_CACHE"
  exit 0
fi

if [ "$APPLY" -eq 1 ]; then
  pass_banner "Inventory and move application complete.
Candidates: $TOTAL
High confidence: $HIGH
Moved: $MOVED
Cache: $LOCAL_CACHE"
else
  pass_banner "Inventory complete.
Candidates: $TOTAL
High confidence: $HIGH
Moved: $MOVED
Cache: $LOCAL_CACHE"
fi
