#!/usr/bin/env bash
# Exact Big Mac recovery through an already authorized DEX//REACH user session.
# Never changes TCC, mounts, firewall, model files, or the MacBook canonical root.
# Invoke through Big Mac DEX//REACH: scripts/recover-backend-authorized.sh --restore-external
set -euo pipefail
ROOT=/Users/bigmac/Image_Gen
LABEL=local.dexdiffusion.server
SVC="gui/$(/usr/bin/id -u)/$LABEL"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$ROOT/scripts/run-backend-service.sh"
BASE=http://127.0.0.1:31337
MODE="${1:---ensure}"
case "$MODE" in --status|--ensure|--restore-external) ;; *) echo "STOP: invalid recovery mode" >&2; exit 2 ;; esac

[[ "$(/usr/bin/id -un)" == bigmac && "$(/bin/hostname -s)" == bigmac ]] ||
  { echo "STOP: expected bigmac@bigmac" >&2; exit 10; }
cd "$ROOT"
[[ "$(/usr/bin/git rev-parse --show-toplevel)" == "$ROOT" &&
   "$(/usr/bin/git branch --show-current)" == main ]] ||
  { echo "STOP: repository identity mismatch" >&2; exit 11; }

if [[ "$MODE" != --status && "${DEX_AUTHORIZED_LOCKED:-0}" != 1 ]]; then
  /bin/mkdir -p "$HOME/Library/Caches/DexDiffusion"
  exec /usr/bin/lockf -t 0 "$HOME/Library/Caches/DexDiffusion/authorized-backend-recovery.lock" \
    /usr/bin/env DEX_AUTHORIZED_LOCKED=1 /bin/bash "$ROOT/scripts/recover-backend-authorized.sh" "$MODE"
fi

listener() { /usr/sbin/lsof -nP -iTCP:31337 -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1 || :; }
get_version() { /usr/bin/curl --noproxy '*' -fsS --max-time 4 "$BASE/api/version" 2>/dev/null || :; }
version_field() {
  /usr/bin/python3 -c 'import json,sys;v=json.load(sys.stdin);k=sys.argv[1]; x=v; [None for part in k.split(".") if (x:=x.get(part) if isinstance(x,dict) else None) is None]; print(x if x is not None else "")' "$1" 2>/dev/null || :
}
probe_external() {
  /sbin/mount | /usr/bin/grep -F ' on /Volumes/wc2tb (' >/dev/null || return 1
  /opt/homebrew/bin/gtimeout -k 1s 3s /bin/ls -a /Volumes/wc2tb/DexDiffusion/state >/dev/null 2>&1 || return 1
  /opt/homebrew/bin/gtimeout -k 1s 3s /bin/ls -a /Volumes/wc2tb/DexDiffusion/runs >/dev/null 2>&1 || return 1
  /opt/homebrew/bin/gtimeout -k 1s 3s /bin/sh -c '[ ! -e "$1" ] || /usr/bin/head -c 1 "$1" >/dev/null' sh \
    /Volumes/wc2tb/DexDiffusion/state/jobs.json >/dev/null 2>&1
}
trusted_listener() {
  local pid="$1" data="$2" expected
  [[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] || return 1
  [[ "$(/bin/ps -p "$pid" -o user= 2>/dev/null | /usr/bin/tr -d '[:space:]')" == bigmac ]] || return 1
  [[ "$(/bin/ps -p "$pid" -o comm= 2>/dev/null | /usr/bin/sed 's@.*/@@')" == node ]] || return 1
  /bin/ps -p "$pid" -o args= 2>/dev/null | /usr/bin/grep -F 'server.js' >/dev/null || return 1
  [[ "$(printf '%s' "$data" | version_field pid)" == "$pid" ]] || return 1
  [[ "$(printf '%s' "$data" | version_field cwd)" == "$ROOT/operator-console" ]] || return 1
  [[ "$(printf '%s' "$data" | version_field name)" == 'Image_Gen Operator Console' ]] || return 1
}
old_pid="$(listener)"
old_data="$(get_version)"
if [[ -n "$old_pid" ]] && ! trusted_listener "$old_pid" "$old_data"; then
  echo "STOP: port 31337 belongs to an unverified process $old_pid" >&2; exit 12
fi
old_mode="$(printf '%s' "$old_data" | version_field storage.mode)"
old_head="$(printf '%s' "$old_data" | version_field gitHead)"
head="$(/usr/bin/git rev-parse --short HEAD)"
if [[ "$MODE" == --status ]]; then
  echo "SERVICE_STATUS pid=${old_pid:-none} mode=${old_mode:-unknown} revision=${old_head:-unknown} wanted=$head"
  exit 0
fi
[[ -z "$(/usr/bin/git status --porcelain)" ]] ||
  { echo "STOP: dirty source checkout; commit and validate before service recovery" >&2; exit 13; }
if [[ -n "$old_pid" && "$old_mode" == external && "$old_head" == "$head" && "$MODE" == --ensure ]]; then
  echo "SERVICE_ALREADY_LOADED pid=$old_pid mode=external revision=$old_head"; exit 0
fi
if [[ -n "$old_pid" && "$old_mode" == internal-fallback && "$MODE" == --ensure ]] && ! probe_external; then
  echo "SERVICE_ALREADY_LOADED pid=$old_pid mode=internal-fallback reason=external-unreadable"; exit 0
fi
if [[ "$MODE" == --restore-external ]] && ! probe_external; then
  echo "STOP: external storage not readable in THIS execution context; existing service preserved" >&2; exit 14
fi
if [[ -n "$old_pid" ]]; then
  /usr/bin/curl --noproxy '*' -fsS --max-time 5 "$BASE/api/resources" |
    /usr/bin/python3 -c 'import json,sys;v=json.load(sys.stdin);assert v.get("owner") is None and not v.get("waiting"),"active resource lease"' ||
    { echo "STOP: active compute reservation" >&2; exit 15; }
  /usr/bin/curl --noproxy '*' -fsS --max-time 5 "$BASE/api/jobs?limit=100" |
    /usr/bin/python3 -c 'import json,sys;v=json.load(sys.stdin);assert not v.get("jobs"),"active job"' ||
    { echo "STOP: active image job" >&2; exit 16; }
  children="$(/usr/bin/pgrep -P "$old_pid" -l || :)"
  [[ -z "$children" ]] || { echo "STOP: backend has live child processes" >&2; exit 17; }
fi

loaded="$(/bin/launchctl print "$SVC" 2>&1 || :)"
if /usr/bin/grep -F "$RUNNER" <<<"$loaded" >/dev/null; then
  launched_pid="$(/usr/bin/awk '/^[[:space:]]*pid = [0-9]+/{print $3;exit}' <<<"$loaded")"
  [[ -n "$old_pid" && "$old_pid" == "$launched_pid" ]] ||
    { echo "STOP: LaunchAgent ownership/pid mismatch" >&2; exit 18; }
  /bin/launchctl bootout "$SVC"
  echo "PROJECT_LAUNCHAGENT_UNLOADED"
elif [[ -n "$old_pid" ]]; then
  /bin/kill -TERM "$old_pid"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if ! /bin/kill -0 "$old_pid" 2>/dev/null; then break; fi
    /bin/sleep 1
  done
  if /bin/kill -0 "$old_pid" 2>/dev/null; then
    echo "STOP: old backend refused graceful termination; not force-killing" >&2; exit 19
  fi
elif [[ "$loaded" == *"$RUNNER"* ]]; then
  echo "STOP: LaunchAgent registered without a verified listener; no blind bootout" >&2; exit 20
fi
[[ -z "$(listener)" ]] || { echo "STOP: port did not become free" >&2; exit 21; }

logdir="$HOME/Library/Application Support/DexDiffusion/diagnostics"
/bin/mkdir -p "$logdir"
/bin/chmod 700 "$logdir"
log="$(/usr/bin/mktemp "$logdir/authorized-recovery-XXXXXXXX")"
[[ -n "$log" ]] || exit 22
/bin/chmod 600 "$log"
nohup /usr/bin/env DEX_DATA_ROOT=/Volumes/wc2tb/DexDiffusion \
  DEX_DATA_ROOT_MOUNT=/Volumes/wc2tb DEX_LOCAL_ENGINE_BRIDGE=1 \
  OPERATOR_CONSOLE_PORT=31337 \
  DEX_IMAGE_VALIDATION_PYTHON=/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python \
  PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /bin/bash "$RUNNER" >"$log" 2>&1 </dev/null &
spawn_pid="$!"
echo "AUTHORIZED_SESSION_SPAWN pid=$spawn_pid log=$log"

ready=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  data="$(get_version)"
  pid="$(listener)"
  mode="$(printf '%s' "$data" | version_field storage.mode)"
  rev="$(printf '%s' "$data" | version_field gitHead)"
  canonical="$(printf '%s' "$data" | version_field storage.canonicalImages)"
  working="$(printf '%s' "$data" | version_field storage.workingImages)"
  if [[ -n "$pid" ]] && trusted_listener "$pid" "$data" && [[ "$rev" == "$head" ]] &&
     [[ "$canonical" == /Users/andrew/images_made ]] &&
     [[ "$mode" == external || "$MODE" == --ensure ]]; then
    if /usr/bin/curl --noproxy '*' -fsS --max-time 3 "$BASE/dexdiffusion/" >/dev/null; then ready=1; break; fi
  fi
  /bin/sleep 1
done
if [[ "$ready" == 1 ]]; then
  echo "SERVICE_READY pid=$pid mode=$mode revision=$rev canonical=$canonical working=$working"
  exit 0
fi
echo "RECOVERY_NOT_READY: restoring known fallback launch agent when safe" >&2
if [[ "$(listener)" == "$spawn_pid" ]] &&
   /bin/ps -p "$spawn_pid" -o args= 2>/dev/null | /usr/bin/grep -F 'server.js' >/dev/null; then
  /bin/kill -TERM "$spawn_pid" 2>/dev/null || :
fi
/bin/sleep 2
if [[ -z "$(listener)" && -f "$PLIST" ]] &&
   /usr/bin/grep -F "$RUNNER" "$PLIST" >/dev/null; then
  /bin/launchctl bootstrap "gui/$(/usr/bin/id -u)" "$PLIST" || :
  echo "FALLBACK_BOOTSTRAP_REQUESTED"
fi
exit 23
