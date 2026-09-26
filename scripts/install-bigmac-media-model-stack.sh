#!/usr/bin/env bash
# install-bigmac-media-model-stack.sh — install/verify DexDiffusion's Big Mac
# voice/music model stack (Kokoro, Qwen3-TTS Base + VoiceDesign, ACE-Step 1.5
# turbo + 0.6B LM, Magenta RealTime 2 small). Run from the MacBook.
#
#   scripts/install-bigmac-media-model-stack.sh           install/resume + validate
#   scripts/install-bigmac-media-model-stack.sh --verify  read-only: check the
#                                                         installed stack against
#                                                         the Big Mac manifest
#
# Operational rules (all learned from real failures; keep them):
#   * Success is the in-band marker "REMOTE MODEL STACK INSTALLATION: PASS";
#     `ssh westcat` has not reliably propagated remote exit status.
#   * Ollama models live at /Users/bigmac/.ollama/models (never touched).
#   * Space checks use real shell arithmetic and keep 15 GiB free on
#     /Volumes/wc2tb and 10 GiB internally.
#   * Downloads are revision-pinned and resumable (rerun-safe).
#   * Kokoro needs misaki[en] + en_core_web_sm (uv venvs have no pip for
#     spaCy's runtime download).
#   * The Magenta venv pins mlx==0.31.1: the published mrt2_small.mlxfn was
#     exported with MLX 0.31.1. The MFLUX venv is separate and untouched.
#   * The ACE-Step checkout's `checkpoints` symlink is expected on reruns.
#   * No git actions: the operator reviews MODEL_STACK.md/json and commits.
#   * No video models. Never touches rclone, MFLUX, ImageGen or Ollama.
set -euo pipefail

LOCAL_REPO="/Users/andrew/Image_Gen"
EXPECTED_REMOTE="git@github.com:westkitty/Image_Gen.git"
REMOTE_HOST="westcat"
EXPECTED_LOCAL_USER="andrew"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${1:-}" == "--verify" ]]; then
  # Read-only: every manifest model path must exist with ~its recorded size and
  # the three runtimes must be executable. Nothing is written or downloaded.
  ssh "$REMOTE_HOST" 'bash -s' <<'VERIFY'
set -u
M=/Volumes/wc2tb/generative-models/manifest.json
[ "$(whoami)@$(hostname -s)" = "bigmac@bigmac" ] || { echo "VERIFY FAIL: unexpected host"; exit 0; }
[ -s "$M" ] || { echo "VERIFY FAIL: manifest missing"; exit 0; }
/usr/bin/python3 - "$M" <<'VPY'
import json, os, subprocess, sys
d = json.load(open(sys.argv[1]))
ok = d.get("schema") == "dexdiffusion.model-stack.v1"
for m in d["models"]:
    p = m["local_path"]
    kb = int(subprocess.run(["du", "-sk", p], capture_output=True, text=True).stdout.split()[0]) if os.path.exists(p) else 0
    good = kb * 1024 >= 0.95 * m["disk_bytes"]
    ok = ok and good
    print(("OK  " if good else "BAD ") + m["friendly_name"] + " " + p)
home = os.path.expanduser("~")
for rt in ["Library/Caches/DexDiffusion/voice/venv/bin/python",
           "Library/Caches/DexDiffusion/music/ACE-Step-1.5/.venv/bin/python",
           "Library/Caches/DexDiffusion/music/magenta-rt-venv/bin/python"]:
    good = os.access(os.path.join(home, rt), os.X_OK)
    ok = ok and good
    print(("OK  " if good else "BAD ") + "runtime ~/" + rt)
print("VERIFY PASS" if ok else "VERIFY FAIL")
VPY
VERIFY
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "Run this from the MacBook terminal."
fi

if [[ "$(whoami)" != "$EXPECTED_LOCAL_USER" ]]; then
  fail "Expected local user $EXPECTED_LOCAL_USER, got $(whoami)."
fi

if [[ ! -d "$LOCAL_REPO/.git" ]]; then
  fail "Missing local repo: $LOCAL_REPO"
fi

cd "$LOCAL_REPO"

if [[ "$(git branch --show-current)" != "main" ]]; then
  fail "$LOCAL_REPO is not on main."
fi

if [[ "$(git remote get-url origin)" != "$EXPECTED_REMOTE" ]]; then
  fail "Unexpected origin: $(git remote get-url origin)"
fi

if ! git diff --cached --quiet; then
  fail "There are already staged Git changes. Review/unstage them before running this installer."
fi

if [[ -n "$(git status --porcelain -- MODEL_STACK.md MODEL_STACK.json)" ]]; then
  fail "MODEL_STACK.md or MODEL_STACK.json already has uncommitted changes; refusing to overwrite it."
fi

LOCAL_HEAD_BEFORE="$(git rev-parse HEAD)"
REMOTE_HEAD_BEFORE="$(git ls-remote origin refs/heads/main | awk '{print $1}')"

if [[ -z "$REMOTE_HEAD_BEFORE" ]]; then
  fail "Could not resolve origin/main."
fi

if [[ "$LOCAL_HEAD_BEFORE" != "$REMOTE_HEAD_BEFORE" ]]; then
  fail "Local main does not exactly match origin/main before installation. Local=$LOCAL_HEAD_BEFORE Remote=$REMOTE_HEAD_BEFORE"
fi

echo "== Big Mac voice/music model stack =="
echo "Local repo: $LOCAL_REPO"
echo "Starting Git HEAD: $LOCAL_HEAD_BEFORE"
echo "Remote target: $REMOTE_HOST"

REMOTE_LOG="$(mktemp -t dex-model-stack-remote.XXXXXX)"
ssh "$REMOTE_HOST" 'bash -s' <<'REMOTE' | tee "$REMOTE_LOG"
set -euo pipefail

EXPECTED_USER="bigmac"
EXPECTED_HOST="bigmac"

MODEL_ROOT="/Volumes/wc2tb/generative-models"
VOICE_ROOT="$MODEL_ROOT/voice"
MUSIC_ROOT="$MODEL_ROOT/music"
VALID_ROOT="$MODEL_ROOT/_validation"

TOOLS_ENV="$HOME/Library/Caches/DexDiffusion/model-tools"
VOICE_ENV="$HOME/Library/Caches/DexDiffusion/voice/venv"
ACE_SRC="$HOME/Library/Caches/DexDiffusion/music/ACE-Step-1.5"
ACE_CKPT="$MUSIC_ROOT/ace-step/checkpoints"
MAGENTA_ENV="$HOME/Library/Caches/DexDiffusion/music/magenta-rt-venv"
MAGENTA_BASE="$MUSIC_ROOT/magenta-realtime"
MAGENTA_DATA="$MAGENTA_BASE/magenta-rt-v2"

KOKORO_DIR="$VOICE_ROOT/kokoro/Kokoro-82M-bf16"
QWEN_BASE_DIR="$VOICE_ROOT/qwen3-tts-base/Qwen3-TTS-12Hz-1.7B-Base-bf16"
QWEN_DESIGN_DIR="$VOICE_ROOT/qwen3-tts-voice-design/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"

RESERVE_BYTES=$((15 * 1024 * 1024 * 1024))
GLOBAL_MARGIN_BYTES=$((3 * 1024 * 1024 * 1024))
FAMILY_MARGIN_BYTES=$((512 * 1024 * 1024))
INTERNAL_RESERVE_BYTES=$((10 * 1024 * 1024 * 1024))

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

bytes_in_dir() {
  local p="$1"
  if [[ -d "$p" ]]; then
    local kb
    kb="$(du -sk "$p" 2>/dev/null | awk '{print $1}')"
    echo $(( ${kb:-0} * 1024 ))
  else
    echo 0
  fi
}

free_bytes() {
  local kb
  kb="$(df -Pk /Volumes/wc2tb | awk 'NR==2 {print $4}')"
  echo $((kb * 1024))
}

internal_free_bytes() {
  local kb
  kb="$(df -Pk "$HOME" | awk 'NR==2 {print $4}')"
  echo $((kb * 1024))
}

check_family_space() {
  local label="$1"
  local expected="$2"
  local existing_path="$3"
  local free existing missing need

  free="$(free_bytes)"
  existing="$(bytes_in_dir "$existing_path")"
  missing=$((expected > existing ? expected - existing : 0))
  need=$((RESERVE_BYTES + FAMILY_MARGIN_BYTES + missing))

  echo "Space check [$label]: free=$free expected=$expected existing~=$existing missing~=$missing reserve=$RESERVE_BYTES"

  if (( free < need )); then
    fail "$label will not safely fit while retaining the 15 GiB reserve"
  fi
}

echo
echo "== Environment identity =="

USER_NOW="$(whoami)"
HOST_NOW="$(hostname -s 2>/dev/null || hostname)"

[[ "$USER_NOW" == "$EXPECTED_USER" ]] || fail "wrong remote user: $USER_NOW"
[[ "$HOST_NOW" == "$EXPECTED_HOST" ]] || fail "wrong remote host: $HOST_NOW"
[[ "$(uname -m)" == "arm64" ]] || fail "Big Mac is not arm64 Apple Silicon"

df -P /Volumes/wc2tb >/dev/null 2>&1 || fail "/Volumes/wc2tb is not mounted/readable"
[[ -w /Volumes/wc2tb ]] || fail "/Volumes/wc2tb is not writable"

echo "Identity: $USER_NOW@$HOST_NOW"
echo "Architecture: $(uname -m)"
git --version
python3 --version
if command -v brew >/dev/null 2>&1; then
  brew --version
fi
df -h /Volumes/wc2tb
df -h "$HOME"

INTERNAL_FREE="$(internal_free_bytes)"
if (( INTERNAL_FREE < INTERNAL_RESERVE_BYTES )); then
  fail "Big Mac internal storage has less than the protected 10 GiB reserve needed for isolated runtimes"
fi

echo
echo "== Google Drive migration observation =="

if ps aux | grep -E '[r]clone .*andrew-gdrive' >/dev/null 2>&1; then
  echo "rclone migration: RUNNING"
  echo "It will be left completely untouched."
else
  echo "rclone migration: not currently detected"
  echo "No action will be taken on it."
fi

echo
echo "== Protecting existing AI stacks =="

[[ -d "$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit" ]] ||
  fail "proven internal FLUX model is unexpectedly missing"

[[ -d "$HOME/Library/Caches/DexDiffusion/mflux/venv" ]] ||
  fail "proven MFLUX venv is unexpectedly missing"

[[ -d /Volumes/wc2tb/ImageGen ]] ||
  fail "/Volumes/wc2tb/ImageGen is unexpectedly missing"

[[ -d /Users/bigmac/.ollama/models ]] ||
  fail "/Users/bigmac/.ollama/models is unexpectedly missing"

echo "Protected existing stacks: present"

mkdir -p \
  "$VOICE_ROOT/kokoro" \
  "$VOICE_ROOT/qwen3-tts-base" \
  "$VOICE_ROOT/qwen3-tts-voice-design" \
  "$MUSIC_ROOT/ace-step" \
  "$MAGENTA_BASE" \
  "$VALID_ROOT"

mkdir -p \
  "$(dirname "$TOOLS_ENV")" \
  "$(dirname "$VOICE_ENV")" \
  "$(dirname "$ACE_SRC")" \
  "$(dirname "$MAGENTA_ENV")"

echo
echo "== Isolated installer tooling =="

if [[ ! -x "$TOOLS_ENV/bin/python" ]]; then
  python3 -m venv "$TOOLS_ENV"
fi

"$TOOLS_ENV/bin/python" -m pip install -q --upgrade pip
"$TOOLS_ENV/bin/python" -m pip install -q --upgrade 'huggingface_hub[hf_xet]' uv

HF_PY="$TOOLS_ENV/bin/python"
UV="$TOOLS_ENV/bin/uv"
HF="$TOOLS_ENV/bin/hf"

"$HF_PY" -c 'import huggingface_hub; print("huggingface_hub", huggingface_hub.__version__)'
"$UV" --version
"$UV" venv --help >/dev/null
"$UV" sync --help >/dev/null

if [[ -x "$HF" ]]; then
  if "$HF" auth whoami >/dev/null 2>&1; then
    echo "Hugging Face auth: configured"
  else
    echo "Hugging Face auth: not configured; selected repositories are expected to be public"
  fi
fi

echo
echo "== Exact current model-size preflight =="

PLAN_JSON="$VALID_ROOT/download-plan.json"

"$HF_PY" - "$PLAN_JSON" <<'PY'
import fnmatch
import json
import sys
from huggingface_hub import HfApi

out = sys.argv[1]
api = HfApi()

targets = [
    ("kokoro", "mlx-community/Kokoro-82M-bf16", ["*"]),
    ("qwen3_tts_base", "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16", ["*"]),
    ("qwen3_tts_voice_design", "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit", ["*"]),
    (
        "ace_main_selected",
        "ACE-Step/Ace-Step1.5",
        [
            "vae/**",
            "Qwen3-Embedding-0.6B/**",
            "acestep-v15-turbo/**",
            "config.json",
            "README.md",
            ".gitattributes",
        ],
    ),
    ("ace_lm_0_6b", "ACE-Step/acestep-5Hz-lm-0.6B", ["*"]),
    (
        "magenta_small_selected",
        "google/magenta-realtime-2",
        ["resources/**", "models/mrt2_small/**"],
    ),
]

rows = []

for name, repo, patterns in targets:
    info = api.model_info(repo, files_metadata=True)
    total = 0
    matched = 0

    for f in info.siblings:
        if not any(fnmatch.fnmatch(f.rfilename, p) for p in patterns):
            continue

        size = getattr(f, "size", None)

        if size is None and getattr(f, "lfs", None):
            if isinstance(f.lfs, dict):
                size = f.lfs.get("size")
            else:
                size = getattr(f.lfs, "size", None)

        if size is None:
            raise SystemExit(
                f"Missing size metadata for {repo}:{f.rfilename}; "
                "refusing to underestimate storage"
            )

        total += int(size)
        matched += 1

    if matched == 0:
        raise SystemExit(
            f"No files matched planned patterns for {repo}"
        )

    rows.append(
        {
            "name": name,
            "repo": repo,
            "revision": info.sha,
            "bytes": total,
            "files": matched,
            "patterns": patterns,
        }
    )

result = {
    "targets": rows,
    "total_bytes": sum(r["bytes"] for r in rows),
}

with open(out, "w") as f:
    json.dump(result, f, indent=2)

print(json.dumps(result, indent=2))
PY

plan_bytes() {
  "$HF_PY" - "$PLAN_JSON" "$1" <<'PY'
import json
import sys

p = json.load(open(sys.argv[1]))
name = sys.argv[2]

for row in p["targets"]:
    if row["name"] == name:
        print(row["bytes"])
        raise SystemExit(0)

raise SystemExit(f"missing plan row {name}")
PY
}

plan_revision() {
  "$HF_PY" - "$PLAN_JSON" "$1" <<'PY'
import json
import sys

p = json.load(open(sys.argv[1]))
name = sys.argv[2]

for row in p["targets"]:
    if row["name"] == name:
        print(row["revision"])
        raise SystemExit(0)

raise SystemExit(f"missing plan row {name}")
PY
}

EXPECTED_BYTES="$(
  "$HF_PY" -c \
    'import json,sys; print(json.load(open(sys.argv[1]))["total_bytes"])' \
    "$PLAN_JSON"
)"

FREE_BYTES="$(free_bytes)"
CURRENT_MODEL_BYTES="$(bytes_in_dir "$MODEL_ROOT")"

if (( EXPECTED_BYTES > CURRENT_MODEL_BYTES )); then
  MISSING_ESTIMATE=$((EXPECTED_BYTES - CURRENT_MODEL_BYTES))
else
  MISSING_ESTIMATE=0
fi

REQUIRED_NOW=$((MISSING_ESTIMATE + RESERVE_BYTES + GLOBAL_MARGIN_BYTES))

echo "Free bytes:                 $FREE_BYTES"
echo "Selected model bytes:       $EXPECTED_BYTES"
echo "Already under model root:   $CURRENT_MODEL_BYTES"
echo "Estimated remaining bytes:  $MISSING_ESTIMATE"
echo "Protected free reserve:     $RESERVE_BYTES"
echo "Metadata/validation margin: $GLOBAL_MARGIN_BYTES"

if (( FREE_BYTES < REQUIRED_NOW )); then
  fail "selected stack does not safely fit while retaining the protected reserve"
fi

echo "Space preflight: PASS"

download_repo() {
  local repo="$1"
  local revision="$2"
  local dest="$3"
  local patterns_json="$4"

  mkdir -p "$dest"

  "$HF_PY" - \
    "$repo" \
    "$revision" \
    "$dest" \
    "$patterns_json" <<'PY'
import json
import sys

from huggingface_hub import snapshot_download

repo = sys.argv[1]
revision = sys.argv[2]
dest = sys.argv[3]
patterns = json.loads(sys.argv[4])

snapshot_download(
    repo_id=repo,
    revision=revision,
    local_dir=dest,
    allow_patterns=patterns,
    max_workers=2,
)

print(
    f"READY {repo}@{revision} -> {dest}"
)
PY
}

echo
echo "=================================================="
echo "1/5 KOKORO"
echo "=================================================="

KOKORO_BYTES="$(plan_bytes kokoro)"

check_family_space \
  "Kokoro" \
  "$KOKORO_BYTES" \
  "$KOKORO_DIR"

download_repo \
  "mlx-community/Kokoro-82M-bf16" \
  "$(plan_revision kokoro)" \
  "$KOKORO_DIR" \
  '["*"]'

if [[ ! -x "$VOICE_ENV/bin/python" ]]; then
  "$UV" venv \
    --python 3.12 \
    "$VOICE_ENV"
fi

"$UV" pip install \
  --python "$VOICE_ENV/bin/python" \
  --upgrade \
  mlx-audio \
  'misaki[en]' \
  'en-core-web-sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'

mkdir -p "$VALID_ROOT/kokoro"

KOKORO_PREFIX="kokoro_validation_$(date +%Y%m%d%H%M%S)_$$"
KOKORO_OUTPUT="$VALID_ROOT/kokoro/${KOKORO_PREFIX}_000.wav"
KOKORO_VOICE="$KOKORO_DIR/voices/af_heart.safetensors"

[[ -s "$KOKORO_VOICE" ]] ||
  fail "Kokoro local voice asset missing: $KOKORO_VOICE"

"$VOICE_ENV/bin/mlx_audio.tts.generate" \
  --model "$KOKORO_DIR" \
  --text "DexDiffusion local voice validation." \
  --voice "$KOKORO_VOICE" \
  --lang_code a \
  --output_path "$VALID_ROOT/kokoro" \
  --file_prefix "$KOKORO_PREFIX" \
  --audio_format wav

[[ -s "$KOKORO_OUTPUT" ]] ||
  fail "Kokoro smoke test produced no valid audio at $KOKORO_OUTPUT"

echo "Kokoro: PASS"
df -h /Volumes/wc2tb

echo
echo "=================================================="
echo "2/5 QWEN3-TTS BASE"
echo "=================================================="

QWEN_BASE_BYTES="$(plan_bytes qwen3_tts_base)"

check_family_space \
  "Qwen3-TTS Base" \
  "$QWEN_BASE_BYTES" \
  "$QWEN_BASE_DIR"

download_repo \
  "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16" \
  "$(plan_revision qwen3_tts_base)" \
  "$QWEN_BASE_DIR" \
  '["*"]'

mkdir -p "$VALID_ROOT/qwen-base"

QWEN_BASE_PREFIX="qwen_base_validation_$(date +%Y%m%d%H%M%S)_$$"
QWEN_BASE_OUTPUT="$VALID_ROOT/qwen-base/${QWEN_BASE_PREFIX}_000.wav"

"$VOICE_ENV/bin/mlx_audio.tts.generate" \
  --model "$QWEN_BASE_DIR" \
  --text "Qwen voice clone validation." \
  --ref_audio "$KOKORO_OUTPUT" \
  --ref_text "DexDiffusion local voice validation." \
  --lang_code en \
  --output_path "$VALID_ROOT/qwen-base" \
  --file_prefix "$QWEN_BASE_PREFIX" \
  --audio_format wav

[[ -s "$QWEN_BASE_OUTPUT" ]] ||
  fail "Qwen3-TTS Base clone smoke produced no valid audio at $QWEN_BASE_OUTPUT"

echo "Qwen3-TTS Base: voice-clone smoke PASS"
df -h /Volumes/wc2tb

echo
echo "=================================================="
echo "3/5 QWEN3-TTS VOICE DESIGN"
echo "=================================================="

QWEN_DESIGN_BYTES="$(plan_bytes qwen3_tts_voice_design)"

check_family_space \
  "Qwen3-TTS VoiceDesign" \
  "$QWEN_DESIGN_BYTES" \
  "$QWEN_DESIGN_DIR"

download_repo \
  "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit" \
  "$(plan_revision qwen3_tts_voice_design)" \
  "$QWEN_DESIGN_DIR" \
  '["*"]'

mkdir -p "$VALID_ROOT/qwen-design"

QWEN_DESIGN_PREFIX="qwen_design_validation_$(date +%Y%m%d%H%M%S)_$$"
QWEN_DESIGN_OUTPUT="$VALID_ROOT/qwen-design/${QWEN_DESIGN_PREFIX}_000.wav"

"$VOICE_ENV/bin/mlx_audio.tts.generate" \
  --model "$QWEN_DESIGN_DIR" \
  --text "Voice design validation." \
  --instruct "A calm, clear, low-pitched adult male voice speaking naturally." \
  --lang_code en \
  --output_path "$VALID_ROOT/qwen-design" \
  --file_prefix "$QWEN_DESIGN_PREFIX" \
  --audio_format wav

[[ -s "$QWEN_DESIGN_OUTPUT" ]] ||
  fail "Qwen3-TTS VoiceDesign smoke produced no valid audio at $QWEN_DESIGN_OUTPUT"

echo "Qwen3-TTS VoiceDesign: generation smoke PASS"
df -h /Volumes/wc2tb

echo
echo "=================================================="
echo "4/5 ACE-STEP 1.5 TURBO + 0.6B LM"
echo "=================================================="

ACE_MAIN_BYTES="$(plan_bytes ace_main_selected)"
ACE_LM_BYTES="$(plan_bytes ace_lm_0_6b)"
ACE_TOTAL_BYTES=$((ACE_MAIN_BYTES + ACE_LM_BYTES))

check_family_space \
  "ACE-Step 1.5 Turbo + 0.6B LM" \
  "$ACE_TOTAL_BYTES" \
  "$ACE_CKPT"

if [[ ! -d "$ACE_SRC/.git" ]]; then
  git clone \
    --depth 1 \
    https://github.com/ACE-Step/ACE-Step-1.5.git \
    "$ACE_SRC"
else
  ACE_REMOTE="$(
    git -C "$ACE_SRC" \
      remote get-url origin \
      2>/dev/null \
      || true
  )"

  case "$ACE_REMOTE" in
    https://github.com/ACE-Step/ACE-Step-1.5.git|https://github.com/ace-step/ACE-Step-1.5.git)
      ;;
    *)
      fail "unexpected ACE-Step runtime remote: $ACE_REMOTE"
      ;;
  esac

  # The installer's own checkpoints symlink is expected; anything else is a real modification.
  if [[ -n "$(git -C "$ACE_SRC" status --porcelain -- . ':!checkpoints')" ]]; then
    fail "ACE-Step runtime checkout has local modifications; refusing to alter it"
  fi

  echo "Existing clean ACE-Step runtime checkout retained at $(git -C "$ACE_SRC" rev-parse HEAD)"
fi

mkdir -p "$ACE_CKPT"

if [[ -e "$ACE_SRC/checkpoints" && ! -L "$ACE_SRC/checkpoints" ]]; then
  fail "$ACE_SRC/checkpoints already exists as a real path; refusing to replace it"
fi

if [[ ! -e "$ACE_SRC/checkpoints" ]]; then
  ln -s "$ACE_CKPT" "$ACE_SRC/checkpoints"
fi

[[ "$(readlink "$ACE_SRC/checkpoints")" == "$ACE_CKPT" ]] ||
  fail "ACE-Step checkpoints symlink points somewhere unexpected"

if [[ ! -x "$ACE_SRC/.venv/bin/python" ]]; then
  "$UV" venv \
    --python 3.12 \
    "$ACE_SRC/.venv"
fi

"$UV" sync \
  --project "$ACE_SRC"

download_repo \
  "ACE-Step/Ace-Step1.5" \
  "$(plan_revision ace_main_selected)" \
  "$ACE_CKPT" \
  '[
    "vae/**",
    "Qwen3-Embedding-0.6B/**",
    "acestep-v15-turbo/**",
    "config.json",
    "README.md",
    ".gitattributes"
  ]'

download_repo \
  "ACE-Step/acestep-5Hz-lm-0.6B" \
  "$(plan_revision ace_lm_0_6b)" \
  "$ACE_CKPT/acestep-5Hz-lm-0.6B" \
  '["*"]'

ACESTEP_CHECKPOINTS_DIR="$ACE_CKPT" \
ACESTEP_LM_BACKEND=mlx \
"$UV" run \
  --project "$ACE_SRC" \
  acestep --help \
  >/dev/null

ACESTEP_CHECKPOINTS_DIR="$ACE_CKPT" \
ACESTEP_LM_BACKEND=mlx \
"$UV" run \
  --project "$ACE_SRC" \
  python - "$ACE_CKPT" <<'PY'
import pathlib
import sys

from safetensors import safe_open

root = pathlib.Path(sys.argv[1])

required = [
    "vae",
    "Qwen3-Embedding-0.6B",
    "acestep-v15-turbo",
    "acestep-5Hz-lm-0.6B",
]

for name in required:
    p = root / name

    if not p.is_dir():
        raise SystemExit(
            f"missing {p}"
        )

    weights = list(
        p.rglob("*.safetensors")
    )

    if not weights:
        raise SystemExit(
            f"no safetensors found in {p}"
        )

    for wf in weights:
        with safe_open(
            str(wf),
            framework="pt",
            device="cpu",
        ) as f:
            keys = list(f.keys())

            if not keys:
                raise SystemExit(
                    f"empty safetensors file {wf}"
                )

import mlx.core
import mlx_lm
import acestep

from acestep.llm_inference import LLMHandler

handler = LLMHandler()

ok, message = handler._load_mlx_model(
    str(root / "acestep-5Hz-lm-0.6B")
)

if not ok:
    raise SystemExit(message)

handler.unload()

print("ACE-Step runtime imports: PASS")
print("ACE-Step official MLX 0.6B LM loader: PASS")
PY

echo "ACE-Step selected components: PASS"
df -h /Volumes/wc2tb

echo
echo "=================================================="
echo "5/5 MAGENTA REALTIME 2 SMALL"
echo "=================================================="

MAGENTA_BYTES="$(plan_bytes magenta_small_selected)"

check_family_space \
  "Magenta RealTime 2 Small" \
  "$MAGENTA_BYTES" \
  "$MAGENTA_DATA"

if [[ ! -x "$MAGENTA_ENV/bin/python" ]]; then
  "$UV" venv \
    --python 3.12 \
    "$MAGENTA_ENV"
fi

"$UV" pip install \
  --python "$MAGENTA_ENV/bin/python" \
  --upgrade \
  'magenta-rt[mlx]'

# mrt2_small.mlxfn is exported with MLX 0.31.1; newer MLX rejects it
# ("[import_function] Invalid string size"). Pin in this venv only.
"$UV" pip install \
  --python "$MAGENTA_ENV/bin/python" \
  'mlx==0.31.1'

MRT="$MAGENTA_ENV/bin/mrt"

[[ -x "$MRT" ]] ||
  fail "mrt CLI missing after magenta-rt installation"

"$MRT" models init --help >/dev/null
"$MRT" models download --help >/dev/null
"$MRT" mlx generate --help >/dev/null

download_repo \
  "google/magenta-realtime-2" \
  "$(plan_revision magenta_small_selected)" \
  "$MAGENTA_DATA" \
  '[
    "resources/**",
    "models/mrt2_small/**"
  ]'

MAGENTA_VALID_BASE="$VALID_ROOT/magenta-home"
MAGENTA_VALID_DATA="$MAGENTA_VALID_BASE/magenta-rt-v2"

mkdir -p "$MAGENTA_VALID_DATA"

for item in resources models; do
  target="$MAGENTA_DATA/$item"
  link="$MAGENTA_VALID_DATA/$item"

  [[ -d "$target" ]] ||
    fail "Magenta required directory missing: $target"

  if [[ -e "$link" && ! -L "$link" ]]; then
    fail "Magenta validation path already exists and is not a symlink: $link"
  fi

  if [[ ! -e "$link" ]]; then
    ln -s "$target" "$link"
  fi

  [[ "$(readlink "$link")" == "$target" ]] ||
    fail "Magenta validation symlink points somewhere unexpected: $link"
done

MAGENTA_OUTPUT="$MAGENTA_VALID_DATA/outputs/output_audio_mlx_mrt2_small.wav"

BEFORE_MTIME=""

if [[ -e "$MAGENTA_OUTPUT" ]]; then
  BEFORE_MTIME="$(
    stat -f '%m' "$MAGENTA_OUTPUT"
  )"
fi

MAGENTA_HOME="$MAGENTA_VALID_BASE" \
"$MRT" mlx generate \
  --prompt "minimal ambient electronic pulse" \
  --duration 4.0 \
  --model mrt2_small

[[ -s "$MAGENTA_OUTPUT" ]] ||
  fail "Magenta MLX generation produced no nonempty WAV at $MAGENTA_OUTPUT"

if [[ -n "$BEFORE_MTIME" ]]; then
  AFTER_MTIME="$(
    stat -f '%m' "$MAGENTA_OUTPUT"
  )"

  [[ "$AFTER_MTIME" != "$BEFORE_MTIME" ]] ||
    fail "Magenta validation output was not refreshed"
fi

echo "Magenta RealTime 2 Small: 4-second MLX generation PASS"
df -h /Volumes/wc2tb

echo
echo "== Final protected-stack checks =="

[[ -d "$HOME/Library/Caches/DexDiffusion/mflux/flux2-klein-4b-4bit" ]] ||
  fail "FLUX model changed unexpectedly"

[[ -d "$HOME/Library/Caches/DexDiffusion/mflux/venv" ]] ||
  fail "MFLUX venv changed unexpectedly"

[[ -d /Volumes/wc2tb/ImageGen ]] ||
  fail "ImageGen changed unexpectedly"

[[ -d /Users/bigmac/.ollama/models ]] ||
  fail "Ollama storage changed unexpectedly"

echo
echo "== Writing manifests =="

"$HF_PY" - \
  "$MODEL_ROOT" \
  "$PLAN_JSON" \
  "$VOICE_ENV" \
  "$ACE_SRC" \
  "$ACE_CKPT" \
  "$MAGENTA_ENV" \
  "$MAGENTA_DATA" <<'PY'
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(sys.argv[1])
plan = json.load(open(sys.argv[2]))
voice_env = sys.argv[3]
ace_src = sys.argv[4]
ace_ckpt = pathlib.Path(sys.argv[5])
magenta_env = sys.argv[6]
magenta_data = pathlib.Path(sys.argv[7])


def directory_bytes(path):
    path = pathlib.Path(path)
    total = 0

    if not path.exists():
        return 0

    for item in path.rglob("*"):
        try:
            if item.is_file() and not item.is_symlink():
                total += item.stat().st_size
        except OSError:
            pass

    return total


def package_version(python, package):
    try:
        return subprocess.check_output(
            [
                python,
                "-c",
                (
                    "import importlib.metadata as m; "
                    f'print(m.version("{package}"))'
                ),
            ],
            text=True,
        ).strip()
    except Exception:
        return "unknown"


paths = {
    "Kokoro":
        root
        / "voice/kokoro/Kokoro-82M-bf16",

    "Qwen3-TTS Base":
        root
        / "voice/qwen3-tts-base/"
        "Qwen3-TTS-12Hz-1.7B-Base-bf16",

    "Qwen3-TTS VoiceDesign":
        root
        / "voice/qwen3-tts-voice-design/"
        "Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",

    "ACE-Step":
        ace_ckpt,

    "Magenta":
        magenta_data,
}

ace_revision = subprocess.check_output(
    [
        "git",
        "-C",
        ace_src,
        "rev-parse",
        "HEAD",
    ],
    text=True,
).strip()

source_revisions = {
    x["name"]: x["revision"]
    for x in plan["targets"]
}

today = datetime.date.today().isoformat()

rows = [
    {
        "friendly_name":
            "Kokoro",

        "repositories": [
            "mlx-community/Kokoro-82M-bf16"
        ],

        "revision":
            source_revisions["kokoro"],

        "purpose":
            "fast general text-to-speech",

        "local_path":
            str(paths["Kokoro"]),

        "disk_bytes":
            directory_bytes(paths["Kokoro"]),

        "runtime":
            "mlx-audio "
            + package_version(
                voice_env + "/bin/python",
                "mlx-audio",
            ),

        "validation":
            "short WAV generation PASS",

        "authentication_required":
            False,

        "download_date":
            today,

        "known_limitations":
            "Validation used a short American-English WAV smoke test.",
    },
    {
        "friendly_name":
            "Qwen3-TTS Base",

        "repositories": [
            "mlx-community/"
            "Qwen3-TTS-12Hz-1.7B-Base-bf16"
        ],

        "revision":
            source_revisions["qwen3_tts_base"],

        "purpose":
            "reference-audio voice cloning / speech generation",

        "local_path":
            str(paths["Qwen3-TTS Base"]),

        "disk_bytes":
            directory_bytes(
                paths["Qwen3-TTS Base"]
            ),

        "runtime":
            "mlx-audio "
            + package_version(
                voice_env + "/bin/python",
                "mlx-audio",
            ),

        "validation":
            "reference-audio voice-clone WAV smoke PASS",

        "authentication_required":
            False,

        "download_date":
            today,

        "known_limitations":
            (
                "Validated with a short synthetic reference-audio clone "
                "smoke; production voice quality was not evaluated."
            ),
    },
    {
        "friendly_name":
            "Qwen3-TTS VoiceDesign",

        "repositories": [
            "mlx-community/"
            "Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit"
        ],

        "revision":
            source_revisions["qwen3_tts_voice_design"],

        "purpose":
            "voice design from descriptive instructions",

        "local_path":
            str(paths["Qwen3-TTS VoiceDesign"]),

        "disk_bytes":
            directory_bytes(
                paths["Qwen3-TTS VoiceDesign"]
            ),

        "runtime":
            "mlx-audio "
            + package_version(
                voice_env + "/bin/python",
                "mlx-audio",
            ),

        "validation":
            "VoiceDesign WAV generation smoke PASS",

        "authentication_required":
            False,

        "download_date":
            today,

        "known_limitations":
            (
                "Validated with one short VoiceDesign generation; "
                "production voice quality was not evaluated."
            ),
    },
    {
        "friendly_name":
            "ACE-Step 1.5 Turbo + 0.6B LM",

        "repositories": [
            (
                "ACE-Step/Ace-Step1.5 "
                "(selected VAE, Qwen3 embedding, turbo)"
            ),
            "ACE-Step/acestep-5Hz-lm-0.6B",
        ],

        "revision":
            ace_revision,

        "purpose":
            "full-song/music generation",

        "local_path":
            str(paths["ACE-Step"]),

        "disk_bytes":
            directory_bytes(
                paths["ACE-Step"]
            ),

        "runtime":
            "ACE-Step git "
            + ace_revision
            + " / MLX",

        "validation":
            (
                "runtime imports + safetensors headers + "
                "official 0.6B MLX LM loader PASS"
            ),

        "authentication_required":
            False,

        "download_date":
            today,

        "known_limitations":
            (
                "Validated runtime, safetensors readability, and "
                "ACE-Step official 0.6B MLX LM loader; "
                "no full-song generation was run."
            ),
    },
    {
        "friendly_name":
            "Magenta RealTime 2 Small",

        "repositories": [
            (
                "google/magenta-realtime-2 "
                "(resources + mrt2_small)"
            )
        ],

        "revision":
            source_revisions[
                "magenta_small_selected"
            ],

        "purpose":
            "realtime / interactive music generation",

        "local_path":
            str(paths["Magenta"]),

        "disk_bytes":
            directory_bytes(
                paths["Magenta"]
            ),

        "runtime":
            "magenta-rt "
            + package_version(
                magenta_env + "/bin/python",
                "magenta-rt",
            ),

        "validation":
            "4-second MLX audio generation PASS",

        "authentication_required":
            False,

        "download_date":
            today,

        "known_limitations":
            (
                "mrt2_small selected intentionally for practical "
                "real-time use on Apple Silicon; "
                "4-second MLX smoke only."
            ),
    },
]

free = shutil.disk_usage(
    "/Volumes/wc2tb"
).free

result = {
    "schema":
        "dexdiffusion.model-stack.v1",

    "date":
        today,

    "host": {
        "user":
            os.getenv(
                "USER",
                "bigmac",
            ),

        "hostname":
            subprocess.check_output(
                [
                    "hostname",
                    "-s",
                ],
                text=True,
            ).strip(),
    },

    "models":
        rows,

    "total_model_root_bytes":
        directory_bytes(root),

    "free_bytes_wc2tb":
        free,

    "source_revisions":
        source_revisions,

    "ace_runtime_revision":
        ace_revision,

    "runtime_versions": {
        "system_python":
            subprocess.check_output(
                [
                    "python3",
                    "--version",
                ],
                text=True,
            ).strip(),

        "git":
            subprocess.check_output(
                [
                    "git",
                    "--version",
                ],
                text=True,
            ).strip(),

        "mlx_audio":
            package_version(
                voice_env + "/bin/python",
                "mlx-audio",
            ),

        "magenta_rt":
            package_version(
                magenta_env + "/bin/python",
                "magenta-rt",
            ),
    },

    "notes": [
        "Video intentionally not installed.",
        (
            "Existing MFLUX internal SSD model, ImageGen, "
            "Ollama storage, and rclone migration were not modified."
        ),
        (
            "ACE-Step uses the selected 0.6B LM instead of "
            "downloading the unified repository's default 1.7B LM."
        ),
        (
            "Magenta uses mrt2_small with MAGENTA_HOME mapped "
            "to the external model hierarchy."
        ),
        (
            "Model installation is complete, but DexDiffusion "
            "voice/music execution bridges and current dormant-worker "
            "probe paths remain a separate integration step; "
            "this installer does not falsely enable them."
        ),
    ],
}

(root / "manifest.json").write_text(
    json.dumps(
        result,
        indent=2,
    )
    + "\n"
)

lines = [
    "# DexDiffusion Big Mac Voice/Music Model Stack",
    "",
    f"Date: {result['date']}",
    (
        "Big Mac: "
        f"{result['host']['user']}@"
        f"{result['host']['hostname']}"
    ),
    "",
    (
        "| Model | Repository | Local path | "
        "Disk size | Runtime | Validation |"
    ),
    "|---|---|---|---:|---|---|",
]

for row in rows:
    lines.append(
        "| "
        + row["friendly_name"]
        + " | "
        + "<br>".join(
            row["repositories"]
        )
        + " | `"
        + row["local_path"]
        + "` | "
        + f"{row['disk_bytes'] / 1024**3:.2f} GiB"
        + " | "
        + row["runtime"]
        + " | "
        + row["validation"]
        + " |"
    )

lines += [
    "",
    (
        "Total `/Volumes/wc2tb/generative-models`: "
        f"{result['total_model_root_bytes'] / 1024**3:.2f} GiB"
    ),
    (
        "Remaining `/Volumes/wc2tb` free: "
        f"{free / 1024**3:.2f} GiB"
    ),
    "",
    "## Protected / unchanged",
    "- Video models: not installed.",
    (
        "- Proven internal FLUX.2 Klein 4B "
        "MFLUX model/venv: unchanged."
    ),
    "- `/Volumes/wc2tb/ImageGen`: unchanged.",
    "- `/Users/bigmac/.ollama/models`: unchanged.",
    (
        "- Google Drive rclone migration: "
        "never modified or interrupted by this installer."
    ),
    "",
    "## Integration status",
    (
        "- Model/runtime acquisition and validation are complete "
        "when this manifest reports PASS."
    ),
    (
        "- DexDiffusion voice/music execution bridges and dormant-worker "
        "probe paths are not changed by this installer; enabling them "
        "remains a separate evidence-gated integration step."
    ),
    "",
    "## Repository revisions",
]

for row in plan["targets"]:
    lines.append(
        f"- `{row['repo']}`: `{row['revision']}`"
    )

lines.append(
    f"- `ACE-Step/ACE-Step-1.5` runtime: `{ace_revision}`"
)

lines += [
    "",
    "## Validation depth / known limitations",
]

for row in rows:
    lines.append(
        f"- **{row['friendly_name']}**: "
        f"{row['known_limitations']}"
    )

(root / "MANIFEST.md").write_text(
    "\n".join(lines) + "\n"
)

print(
    "\n".join(lines)
)
PY

echo
echo "== Final storage check =="

df -h /Volumes/wc2tb

FINAL_FREE="$(free_bytes)"

(( FINAL_FREE >= RESERVE_BYTES )) ||
  fail "free space fell below the protected 15 GiB reserve"

if ps aux |
   grep -E '[r]clone .*andrew-gdrive' \
     >/dev/null 2>&1; then

  echo "rclone migration after install: RUNNING"
else
  echo "rclone migration after install: not detected"
  echo "No action was taken on it."
fi

echo
echo "REMOTE MODEL STACK INSTALLATION: PASS"

REMOTE

if ! grep -qx 'REMOTE MODEL STACK INSTALLATION: PASS' "$REMOTE_LOG"; then
  echo "ERROR: Big Mac installer did not reach its success marker." >&2
  echo "Nothing will be staged, committed, or pushed." >&2
  echo "Remote transcript: $REMOTE_LOG" >&2
  exit 1
fi

rm -f "$REMOTE_LOG"

echo
echo "== Recording installation state in Image_Gen =="

TMP_MD="$(
  mktemp -t dex-model-stack-md.XXXXXX
)"

TMP_JSON="$(
  mktemp -t dex-model-stack-json.XXXXXX
)"

trap 'rm -f "$TMP_MD" "$TMP_JSON"' EXIT

ssh "$REMOTE_HOST" \
  'cat /Volumes/wc2tb/generative-models/MANIFEST.md' \
  > "$TMP_MD"

ssh "$REMOTE_HOST" \
  'cat /Volumes/wc2tb/generative-models/manifest.json' \
  > "$TMP_JSON"

[[ -s "$TMP_MD" ]] || fail "remote MANIFEST.md was empty"
[[ -s "$TMP_JSON" ]] || fail "remote manifest.json was empty"
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d.get("schema")=="dexdiffusion.model-stack.v1"; assert isinstance(d.get("models"), list) and len(d["models"]) == 5' "$TMP_JSON" || fail "remote manifest.json is invalid or incomplete"
grep -q '^# DexDiffusion Big Mac Voice/Music Model Stack' "$TMP_MD" || fail "remote MANIFEST.md failed content validation"

{
  echo '<!-- Generated from /Volumes/wc2tb/generative-models/MANIFEST.md on Big Mac. Model weights are NOT stored in Git. -->'
  cat "$TMP_MD"
} > "$LOCAL_REPO/MODEL_STACK.md"

cp \
  "$TMP_JSON" \
  "$LOCAL_REPO/MODEL_STACK.json"

# Git publication is performed separately (one cohesive commit together with the
# DexDiffusion probe reconciliation), so this installer stops after writing the
# validated manifests into the working tree.
echo "LOCAL MANIFESTS WRITTEN: $LOCAL_REPO/MODEL_STACK.md $LOCAL_REPO/MODEL_STACK.json"
echo "INSTALLER COMPLETE (no git actions taken)"
