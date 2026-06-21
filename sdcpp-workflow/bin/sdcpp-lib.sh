#!/usr/bin/env bash
# sdcpp-lib.sh — shared helpers for the BigMac SDCPP workflow.
#
# Source this from every script:   . "$(dirname "$0")/sdcpp-lib.sh"
# It does NOT set -euo pipefail itself; entry scripts do that. Functions are
# written to be safe under strict mode.
#
# Key safety rules baked in here:
#   - Remote paths (REMOTE_*) keep a literal $HOME and are expanded ON BigMac.
#   - Never use --backend metal (Metal auto-selects as MTL0).
#   - Never broad-kill; only workflow-owned tmux session / SSH control socket.
#   - A PNG only counts when verified locally with `file` + non-zero size.

# ----- project layout ---------------------------------------------------------

# Resolve project root (the dir that contains bin/ and config/), from this file.
_sdcpp_lib_path="${BASH_SOURCE[0]:-$0}"
SDCPP_BIN_DIR="$(cd "$(dirname "$_sdcpp_lib_path")" && pwd)"
SDCPP_PROJECT_ROOT="$(cd "$SDCPP_BIN_DIR/.." && pwd)"
SDCPP_CONFIG_DIR="$SDCPP_PROJECT_ROOT/config"

# ----- basic logging / failure ------------------------------------------------

timestamp() { date +%Y%m%d-%H%M%S; }
iso_now() { date +%Y-%m-%dT%H:%M:%S%z; }

yaml_escape() {
  # minimal YAML/JSON-ish double-quote escaping for one-line scalar values
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n\r\t' '   '
}

log() {
  # log <message...>  -> timestamped line to stderr (and SDCPP_LOGFILE if set)
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  printf '%s\n' "$line" >&2
  if [ -n "${SDCPP_LOGFILE:-}" ]; then
    printf '%s\n' "$line" >> "$SDCPP_LOGFILE" 2>/dev/null || true
  fi
}

fail() {
  # fail <gate-name> <message...>  -> print FIRST failed gate and exit non-zero.
  local gate="$1"; shift || true
  printf '\n==== FAIL ====\n' >&2
  printf 'First failed gate: %s\n' "$gate" >&2
  printf 'Error: %s\n' "$*" >&2
  if [ -n "${SDCPP_LOGFILE:-}" ]; then
    {
      printf '\n==== FAIL ====\n'
      printf 'First failed gate: %s\n' "$gate"
      printf 'Error: %s\n' "$*"
    } >> "$SDCPP_LOGFILE" 2>/dev/null || true
  fi
  exit 1
}

pass_banner() {
  # pass_banner <message...>
  printf '\n==== PASS ====\n%s\n' "$*"
}

# ----- config -----------------------------------------------------------------

load_config() {
  # Create config/sdcpp.env from example if missing (never overwrite), then
  # source it. Exports SDCPP_RUNS_DIR / SDCPP_LOGS_DIR / SDCPP_STATE_DIR as
  # resolved absolute paths.
  local env_file="$SDCPP_CONFIG_DIR/sdcpp.env"
  local example="$SDCPP_CONFIG_DIR/sdcpp.env.example"

  if [ ! -f "$env_file" ]; then
    if [ ! -f "$example" ]; then
      fail "config" "Neither $env_file nor $example exists."
    fi
    cp "$example" "$env_file"
    log "Created $env_file from sdcpp.env.example (first run)."
  fi

  # shellcheck disable=SC1090
  . "$env_file"

  # Resolve local dirs relative to project root unless absolute.
  SDCPP_RUNS_DIR="$(_resolve_local_dir "${RUNS_DIR:-../runs}")"
  SDCPP_LOGS_DIR="$(_resolve_local_dir "${LOGS_DIR:-../logs}")"
  SDCPP_STATE_DIR="$(_resolve_local_dir "${STATE_DIR:-../state}")"
  mkdir -p "$SDCPP_RUNS_DIR" "$SDCPP_LOGS_DIR" "$SDCPP_STATE_DIR"
  export SDCPP_RUNS_DIR SDCPP_LOGS_DIR SDCPP_STATE_DIR
}

_resolve_local_dir() {
  # Resolve a possibly-relative dir. Relative paths from config are interpreted
  # relative to the project root (config uses ../runs etc.). Creates nothing.
  local d="$1"
  case "$d" in
    /*) printf '%s\n' "$d" ;;
    ../*) printf '%s\n' "$SDCPP_PROJECT_ROOT/${d#../}" ;;
    ./*) printf '%s\n' "$SDCPP_PROJECT_ROOT/${d#./}" ;;
    *) printf '%s\n' "$SDCPP_PROJECT_ROOT/$d" ;;
  esac
}

make_run_dir() {
  # make_run_dir <suffix>  -> echoes a fresh timestamped run dir under runs/.
  # If SDCPP_RUN_DIR_OVERRIDE is set (used by the benchmark to control per-cell
  # output), that dir is created and returned instead.
  if [ -n "${SDCPP_RUN_DIR_OVERRIDE:-}" ]; then
    mkdir -p "$SDCPP_RUN_DIR_OVERRIDE"
    printf '%s\n' "$SDCPP_RUN_DIR_OVERRIDE"
    return 0
  fi
  local suffix="${1:-run}"
  local dir="$SDCPP_RUNS_DIR/$(timestamp)-$suffix"
  mkdir -p "$dir"
  printf '%s\n' "$dir"
}

# ----- presets ----------------------------------------------------------------

load_presets() {
  # Source config/presets.env if present. Safe to call repeatedly.
  local pf="$SDCPP_CONFIG_DIR/presets.env"
  if [ -f "$pf" ]; then
    # shellcheck disable=SC1090
    . "$pf"
    SDCPP_PRESETS_LOADED=1
  fi
}

apply_preset() {
  # apply_preset <name>  -> sets PRESET_W/PRESET_H/PRESET_STEPS/PRESET_CFG/PRESET_SAMPLER
  # from config/presets.env. Returns non-zero (via fail) on unknown preset.
  load_presets
  local name keyu
  name="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$name" in
    smoke)        keyu=SMOKE ;;
    thumbnail|thumb) keyu=THUMB ;;
    fast)         keyu=FAST ;;
    balanced)     keyu=BALANCED ;;
    quality)      keyu=QUALITY ;;
    quality_plus|quality-plus|qualityplus) keyu=QUALITY_PLUS ;;
    *) fail "preset" "Unknown preset '$1' (smoke|thumbnail|fast|balanced|quality|quality_plus)." ;;
  esac
  # Indirect expansion (bash 3.2 compatible).
  eval "PRESET_W=\${PRESET_${keyu}_WIDTH:-}"
  eval "PRESET_H=\${PRESET_${keyu}_HEIGHT:-}"
  eval "PRESET_STEPS=\${PRESET_${keyu}_STEPS:-}"
  eval "PRESET_CFG=\${PRESET_${keyu}_CFG_SCALE:-}"
  eval "PRESET_SAMPLER=\${PRESET_${keyu}_SAMPLER:-}"
  if [ -z "$PRESET_W" ] || [ -z "$PRESET_STEPS" ]; then
    fail "preset" "Preset '$name' is not fully defined in config/presets.env."
  fi
  PRESET_NAME="$name"
  log "Preset '$name': ${PRESET_W}x${PRESET_H} steps=$PRESET_STEPS cfg=$PRESET_CFG sampler=$PRESET_SAMPLER"
}

# ----- seed resolution --------------------------------------------------------

gen_random_seed() {
  # Positive 32-bit-ish integer; recorded so the run is reproducible later.
  awk 'BEGIN{srand(); printf "%d", int(rand()*2000000000)+1}'
}

resolve_seed() {
  # resolve_seed <raw>  -> echoes "<seed>\t<controlled yes|no>\t<label>"
  #   raw "" (omitted) -> 42 / no  / default(42)   (CLI default; honest "not forced")
  #   raw fixed        -> 42 / yes / 42
  #   raw random       -> <rand> / yes / <rand>(random)
  #   raw <int>        -> <int> / yes / <int>
  local raw="$1" s
  case "$raw" in
    "")     printf '%s\t%s\t%s\n' "42" "no" "default(42)" ;;
    fixed)  printf '%s\t%s\t%s\n' "42" "yes" "42" ;;
    random) s="$(gen_random_seed)"; printf '%s\t%s\t%s\n' "$s" "yes" "$s(random)" ;;
    -[0-9]*|[0-9]*)
      case "$raw" in *[!0-9-]*) fail "seed" "Invalid --seed '$raw' (use N|random|fixed)." ;; esac
      printf '%s\t%s\t%s\n' "$raw" "yes" "$raw" ;;
    *) fail "seed" "Invalid --seed '$raw' (use N|random|fixed)." ;;
  esac
}

# ----- timing -----------------------------------------------------------------

now_epoch() {
  # Fractional epoch seconds if possible (gdate, then date +%s.%N), else integer.
  local t
  if command -v gdate >/dev/null 2>&1; then
    t="$(gdate +%s.%N 2>/dev/null)"
  else
    t="$(date +%s.%N 2>/dev/null)"
  fi
  case "$t" in
    *N*|'') t="$(date +%s)" ;;   # %N not supported -> integer seconds
  esac
  printf '%s\n' "$t"
}

elapsed_seconds() {
  # elapsed_seconds <start> <end>  -> end-start, 2 decimals, never negative.
  awk -v a="$1" -v b="$2" 'BEGIN{d=b-a; if(d<0)d=0; printf "%.2f", d}'
}

sanitize_tsv() {
  # Strip tabs/newlines from a value so it is TSV-safe.
  printf '%s' "$1" | tr '\t\n\r' '   '
}

# ----- metrics (per-generation, machine-readable) -----------------------------

metrics_header() {
  printf 'timestamp\thost\troute\trepo_commit\tbuild_dir\tmodel_path\tmode\tpreset\tprompt\tnegative\twidth\theight\tsteps\tcfg_scale\tsampler\tseed\tstart_epoch\tend_epoch\telapsed_seconds\tremote_elapsed_seconds\tlocal_decode_seconds\tpng_path\tpng_bytes\tsha256\twarm_state\tremote_port\tlocal_port\tcleanup_state\tstatus\n'
}

png_bytes() {
  # png_bytes <file> -> byte size or 0
  [ -f "$1" ] && (stat -f %z "$1" 2>/dev/null || wc -c < "$1") || echo 0
}

extract_remote_elapsed() {
  # extract_remote_elapsed <remote-log-path-literal-with-$HOME>
  # Pulls the "generate_image completed in N.NNs" seconds from the remote log.
  ssh_remote "grep -hoE 'generate_image completed in [0-9.]+s' \"$1\" 2>/dev/null | tail -1 | grep -oE '[0-9.]+'" 2>/dev/null || true
}

# ----- tool checks ------------------------------------------------------------

require_local_tool() {
  # require_local_tool <tool>
  command -v "$1" >/dev/null 2>&1 || fail "local-tool:$1" "Required local tool '$1' not found on the MacBook."
}

require_remote_tool() {
  # require_remote_tool <tool>  -> checks presence on BigMac (never installs).
  local t="$1"
  if ! remote_test "command -v '$t' >/dev/null 2>&1"; then
    fail "remote-tool:$t" "Required remote tool '$t' not found on BigMac (install manually; this workflow never auto-installs)."
  fi
}

# ----- ssh / remote path helpers ----------------------------------------------

ssh_remote() {
  # ssh_remote <remote-command-string...>
  # The command runs in a remote shell on BigMac. REMOTE_* values that contain
  # a literal $HOME are expanded there. Add -o ConnectTimeout to fail fast.
  ssh -o ConnectTimeout=15 "${SSH_TARGET:?SSH_TARGET unset}" "$@"
}

remote_eval_path() {
  # remote_eval_path '<literal-with-$HOME>'  -> echoes the path resolved on BigMac.
  # Example: remote_eval_path "$REMOTE_STAGING"  ->  /Users/bigmac/sdcpp-staging
  ssh_remote "printf '%s\n' \"$1\""
}

remote_test() {
  # remote_test '<remote-shell-test-expr>'  -> 0 if true on BigMac, else 1.
  #
  # IMPORTANT: this BigMac's sshd does NOT propagate remote *command* exit codes
  # (every `ssh westcat '<cmd>'` returns 0 regardless; ssh-layer failures like
  # 255 still propagate). So boolean checks must be made via the remote command's
  # OUTPUT, not its exit status. We evaluate the test inside the remote shell and
  # echo a sentinel that we match locally.
  local out
  out="$(ssh_remote "if $1; then printf '%s\n' '__SDCPP_TRUE__'; else printf '%s\n' '__SDCPP_FALSE__'; fi" 2>/dev/null)" || return 1
  case "$out" in
    *__SDCPP_TRUE__*) return 0 ;;
    *) return 1 ;;
  esac
}

# ----- proven-state verification ----------------------------------------------

verify_route() {
  # SSH reachable and hostname is the expected one.
  local host
  host="$(ssh_remote 'hostname' 2>/dev/null)" \
    || fail "route" "ssh $SSH_TARGET failed (host unreachable? Tailscale down? See TROUBLESHOOTING.md)."
  if [ "$host" != "${REMOTE_HOST_EXPECTED:?}" ]; then
    fail "route-hostname" "Remote hostname is '$host', expected '$REMOTE_HOST_EXPECTED'. Refusing to continue."
  fi
  log "Route OK: ssh $SSH_TARGET -> hostname=$host"
  printf '%s\n' "$host"
}

verify_remote_home() {
  # Discover and print remote $HOME (never guessed).
  local home
  home="$(ssh_remote 'printf "%s\n" "$HOME"')" \
    || fail "remote-home" "Could not read remote \$HOME."
  [ -n "$home" ] || fail "remote-home" "Remote \$HOME was empty."
  log "Remote HOME discovered: $home"
  printf '%s\n' "$home"
}

verify_repo_clean() {
  # Repo exists, HEAD is the pinned commit, working tree clean.
  local want="${1:-7f0e728}"
  local out head status
  remote_test "test -d \"$REMOTE_REPO/.git\"" \
    || fail "repo" "Repo not found or not a git checkout at remote \$HOME/stable-diffusion.cpp."
  out="$(ssh_remote "cd \"$REMOTE_REPO\" && printf 'HEAD=%s\n' \"\$(git rev-parse --short HEAD)\" && printf 'STATUS=[%s]\n' \"\$(git status --short | tr '\n' ';')\"")" \
    || fail "repo" "Could not read git state at remote \$HOME/stable-diffusion.cpp."
  head="$(printf '%s\n' "$out" | sed -n 's/^HEAD=//p')"
  status="$(printf '%s\n' "$out" | sed -n 's/^STATUS=\[\(.*\)\]$/\1/p')"
  if [ "$head" != "$want" ]; then
    fail "repo-pin" "Repo HEAD is '$head', expected pinned '$want'. Refusing to continue."
  fi
  if [ -n "$status" ]; then
    fail "repo-dirty" "Repo working tree is dirty: [$status]. Refusing to continue (will not modify it)."
  fi
  log "Repo OK: HEAD=$head clean"
  printf '%s\n' "$head"
}

get_build_dir() {
  # Echo the remote build dir from build_dir.txt (validated non-empty + exists).
  local bd
  bd="$(ssh_remote "cat \"$REMOTE_BUILD_DIR_FILE\" 2>/dev/null")" \
    || fail "build-dir-file" "Could not read $REMOTE_BUILD_DIR_FILE on BigMac."
  [ -n "$bd" ] || fail "build-dir-file" "Build dir pointer file is empty: $REMOTE_BUILD_DIR_FILE."
  remote_test "test -d '$bd'" \
    || fail "build-dir" "Build dir does not exist on BigMac: $bd."
  printf '%s\n' "$bd"
}

verify_binaries() {
  # verify_binaries <build-dir>  -> sd-cli and sd-server are executable.
  local bd="$1"
  remote_test "test -x '$bd/bin/sd-cli'" || fail "sd-cli" "sd-cli missing/not executable at $bd/bin/sd-cli."
  remote_test "test -x '$bd/bin/sd-server'" || fail "sd-server" "sd-server missing/not executable at $bd/bin/sd-server."
  log "Binaries OK: $bd/bin/{sd-cli,sd-server}"
}

verify_model() {
  # Staged SD 1.5 model exists and is non-empty.
  remote_test "test -s \"$REMOTE_MODEL\"" \
    || fail "model" "SD 1.5 model missing or empty on BigMac at \$HOME path (REMOTE_MODEL). Do NOT download; stage manually."
  local sz
  sz="$(ssh_remote "(stat -f %z \"$REMOTE_MODEL\" 2>/dev/null || wc -c < \"$REMOTE_MODEL\")")"
  log "Model OK: $(remote_eval_path "$REMOTE_MODEL") ($sz bytes)"
  printf '%s\n' "$sz"
}

ensure_remote_dirs() {
  # Create remote output/log dirs if needed (under $HOME staging; never wc2tb).
  ssh_remote "mkdir -p \"$REMOTE_OUTPUT_DIR\" \"$REMOTE_LOG_DIR\"" >/dev/null 2>&1 || true
  remote_test "test -d \"$REMOTE_OUTPUT_DIR\" && test -d \"$REMOTE_LOG_DIR\"" \
    || fail "remote-dirs" "Could not create/verify remote output/log dirs."
  log "Remote output/log dirs ready."
}

# ----- base64 + PNG verification ----------------------------------------------

portable_base64_decode() {
  # portable_base64_decode <in.b64> <out.bin>
  local in="$1" out="$2"
  if base64 --decode "$in" > "$out" 2>/dev/null; then
    return 0
  fi
  if base64 -D < "$in" > "$out" 2>/dev/null; then
    return 0
  fi
  fail "base64-decode" "Both 'base64 --decode' and 'base64 -D' failed for $in."
}

verify_png() {
  # verify_png <png-path> [label]  -> PASS only if it's a real, non-empty PNG.
  local png="$1" label="${2:-PNG}"
  [ -f "$png" ] || fail "png-missing" "$label not found: $png"
  [ -s "$png" ] || fail "png-empty" "$label is empty (0 bytes): $png"
  local ftype
  ftype="$(file "$png")"
  case "$ftype" in
    *"PNG image data"*) : ;;
    *) fail "png-type" "$label is not a PNG: $ftype" ;;
  esac
  log "$label verified:"
  file "$png" >&2
  ls -lh "$png" >&2
  return 0
}

local_sha256() {
  shasum -a 256 "$1" 2>/dev/null | awk '{print $1}'
}

remote_sha256() {
  # Prefer shasum -a 256 remotely; fall back to md5 (prefixed) if absent.
  local path="$1"
  ssh_remote "if command -v shasum >/dev/null 2>&1; then shasum -a 256 \"$path\" | awk '{print \$1}'; else printf 'md5:'; md5 -q \"$path\"; fi"
}

# ----- port checks ------------------------------------------------------------

check_local_port_free() {
  # check_local_port_free <port>  -> returns 0 if free; prints occupant if busy.
  local port="$1"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    log "Local port $port is OCCUPIED:"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    return 1
  fi
  return 0
}

check_remote_port_free() {
  # check_remote_port_free <port>  -> returns 0 if free; prints occupant if busy.
  # Uses remote_test (sentinel) because this host's ssh masks remote exit codes.
  local port="$1"
  if remote_test "lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1"; then
    log "Remote port $port is OCCUPIED:"
    ssh_remote "lsof -nP -iTCP:$port -sTCP:LISTEN" >&2 || true
    return 1
  fi
  return 0
}

# ----- tunnel lifecycle (workflow-owned) --------------------------------------

tunnel_socket_path() {
  printf '%s\n' "$SDCPP_STATE_DIR/sdcpp-tunnel.sock"
}

start_tunnel() {
  # start_tunnel <local-port> <remote-port>  -> creates control-socket tunnel.
  local lport="$1" rport="$2"
  local sock; sock="$(tunnel_socket_path)"
  if [ -S "$sock" ] && ssh -S "$sock" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    fail "tunnel-exists" "A workflow tunnel control socket is already active: $sock. Run sdcpp-server-stop.sh or sdcpp-server-status.sh first."
  fi
  # Stale socket file with no master: remove only the file (not a process kill).
  if [ -e "$sock" ] && ! ssh -S "$sock" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    rm -f "$sock" 2>/dev/null || true
  fi
  ssh -M -S "$sock" -f -N -L "$lport:127.0.0.1:$rport" "$SSH_TARGET" \
    || fail "tunnel-start" "Failed to start SSH tunnel $lport->127.0.0.1:$rport via $SSH_TARGET."
  printf '%s\n' "$sock"
}

stop_tunnel() {
  # stop_tunnel  -> closes ONLY the workflow control socket. Safe if absent.
  local sock; sock="$(tunnel_socket_path)"
  if [ -S "$sock" ] && ssh -S "$sock" -O check "$SSH_TARGET" >/dev/null 2>&1; then
    ssh -S "$sock" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
    log "Closed workflow SSH tunnel ($sock)."
  else
    log "No active workflow tunnel control socket to close (already stopped)."
  fi
  [ -e "$sock" ] && rm -f "$sock" 2>/dev/null || true
}

# ----- server lifecycle (workflow-owned) --------------------------------------

start_remote_server() {
  # start_remote_server <session> <remote-port> <remote-log>
  # Starts sd-server in a named tmux session on BigMac. NO --backend metal.
  local session="$1" rport="$2" rlog="$3"
  local bd; bd="$(get_build_dir)"
  # Persist state locally and remotely.
  printf '%s\n' "$session" > "$SDCPP_STATE_DIR/current-server-session"
  ssh_remote "printf '%s\n' '$session' > \"$REMOTE_STAGING/server_session.txt\"" \
    || fail "server-state" "Could not write remote server_session.txt."
  ssh_remote "printf '%s\n' '$rport' > \"$REMOTE_STAGING/server_port.txt\"" \
    || fail "server-state" "Could not write remote server_port.txt."
  # Launch (single-quoted remote pieces; $HOME/$REMOTE_* expand on BigMac).
  ssh_remote "tmux new-session -d -s '$session' \"cd \\\"$REMOTE_REPO\\\" && \\\"$bd/bin/sd-server\\\" -m \\\"$REMOTE_MODEL\\\" --listen-ip 127.0.0.1 --listen-port $rport --diffusion-fa -v 2>&1 | tee \\\"$rlog\\\"\"" \
    || fail "server-start" "Failed to launch sd-server tmux session '$session'."
  log "Launched sd-server tmux session '$session' on remote port $rport (log: $rlog)."
}

wait_remote_listener() {
  # wait_remote_listener <port> <max-seconds>  -> 0 when listening, else 1.
  local port="$1" max="${2:-90}" i=0
  while [ "$i" -lt "$max" ]; do
    if remote_test "lsof -nP -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1"; then
      return 0
    fi
    i=$((i + 3)); sleep 3
  done
  return 1
}

stop_remote_server() {
  # stop_remote_server  -> kills ONLY the recorded tmux session. Safe if absent.
  local session=""
  if [ -f "$SDCPP_STATE_DIR/current-server-session" ]; then
    session="$(cat "$SDCPP_STATE_DIR/current-server-session" 2>/dev/null || true)"
  fi
  if [ -z "$session" ]; then
    session="$(ssh_remote "cat \"$REMOTE_STAGING/server_session.txt\" 2>/dev/null" || true)"
  fi
  if [ -z "$session" ]; then
    log "No recorded server session found (nothing to stop)."
    return 0
  fi
  if remote_test "tmux has-session -t '$session' 2>/dev/null"; then
    ssh_remote "tmux kill-session -t '$session'" >/dev/null 2>&1 || true
    log "Killed remote tmux session '$session'."
  else
    log "Remote tmux session '$session' already gone (already stopped)."
  fi
}

# ----- reporting --------------------------------------------------------------

record_run_report() {
  # record_run_report <report-file> <line...>  -> append a line to a report.
  local rf="$1"; shift || true
  printf '%s\n' "$*" >> "$rf"
}

write_ui_run_card() {
  # write_ui_run_card <run_dir> <run_type> <status> <primary_image_rel> <manifest_json_rel>
  #   <prompt> <settings_line> <created_at>  [extra_md_file]
  # Emits a UI-stable ui-run-card.md (schema sdcpp.run.v1) with YAML front matter.
  local dir="$1" rtype="$2" status="$3" primary="$4" manifest="$5" prompt="$6" settings="$7" created="$8" extra="${9:-}"
  local card="$dir/ui-run-card.md" run_id
  run_id="$(basename "$dir")"
  {
    echo "---"
    echo "schema: sdcpp.run.v1"
    echo "run_id: \"$run_id\""
    echo "run_type: \"$rtype\""
    echo "status: \"$status\""
    echo "created_at: \"$created\""
    echo "primary_image: \"$primary\""
    echo "manifest_json: \"$manifest\""
    echo "---"
    echo
    echo "# SDCPP Run Card"
    echo
    echo "## Status"
    echo "$status"
    echo
    echo "## Primary Image"
    if [ -n "$primary" ]; then echo "![Primary image]($primary)"; else echo "(none)"; fi
    echo
    echo "## Prompt"
    echo "$prompt"
    echo
    echo "## Settings"
    echo "$settings"
    echo
    echo "## Files"
    echo "- primary image: \`$primary\`"
    echo "- manifest: \`$manifest\`"
    [ -n "$extra" ] && cat "$extra"
  } > "$card"
  printf '%s\n' "$card"
}
