#!/usr/bin/env bash
# Install/load the TCC-compatible user LaunchAgent, or the explicitly requested system LaunchDaemon.
set -euo pipefail

ROOT=/Users/bigmac/Image_Gen
LABEL=local.dexdiffusion.server
SOURCE="$ROOT/scripts/$LABEL.plist"
DEST="/Library/LaunchDaemons/$LABEL.plist"
USER_HOME=/Users/bigmac
USER_UID="$(/usr/bin/id -u bigmac)"
AGENT_DOMAIN="user/$USER_UID"
AGENT_DEST="$USER_HOME/Library/LaunchAgents/$LABEL.plist"
AGENT_SOURCE="$ROOT/scripts/$LABEL.agent-legacy.plist"
ENABLE_AFTER_TCC=0
USER_SESSION=0

recovery_remaining() {
  local now="$(/bin/date +%s)"
  if [[ -z "${DEX_RECOVERY_DEADLINE:-}" ]]; then
    printf '40\n'
  else
    local left=$(( DEX_RECOVERY_DEADLINE - now ))
    (( left > 0 )) && printf '%s\n' "$left" || return 1
  fi
}

case "${1:-}" in
  "") ;;
  --enable-after-tcc) ENABLE_AFTER_TCC=1 ;;
  --user-session) USER_SESSION=1 ;;
  --user-session-enable-after-tcc) USER_SESSION=1; ENABLE_AFTER_TCC=1 ;;
  *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
esac

if [[ "$USER_SESSION" == 1 ]]; then
  [[ "$EUID" -ne 0 && "$(/usr/bin/id -un)" == bigmac ]] || {
    echo "ERROR: --user-session must run as bigmac without sudo." >&2; exit 2;
  }
  [[ "$(/bin/hostname -s)" == bigmac ]] || { echo "ERROR: installation must run on Big Mac." >&2; exit 2; }
  # Backend runner selects an isolated internal mode when wc2tb is unreadable.
  # Do not make external mount state a prerequisite for service registration.
  /usr/bin/plutil -lint "$AGENT_SOURCE" >/dev/null
  SESSION="$(/bin/launchctl print "gui/$USER_UID" 2>&1 || true)"
  /usr/bin/grep -F 'session = Aqua' <<<"$SESSION" >/dev/null || {
    echo "ERROR: no active Aqua login session for bigmac; user-session service cannot start." >&2; exit 4;
  }
  SYSTEM_SERVICE="$(/bin/launchctl print "system/$LABEL" 2>&1 || true)"
  if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$SYSTEM_SERVICE" >/dev/null; then
    echo "ERROR: system service is loaded; refusing duplicate user-session service." >&2; exit 4;
  fi
  if [[ -e "$AGENT_DEST" ]] && ! /usr/bin/cmp -s "$AGENT_SOURCE" "$AGENT_DEST"; then
    echo "ERROR: existing LaunchAgent differs from project source; preserving it." >&2; exit 5;
  fi
  AGENT_LOADED="$(/bin/launchctl print "gui/$USER_UID/$LABEL" 2>&1 || true)"
  SERVICE_REGISTERED=0
  if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$AGENT_LOADED" >/dev/null; then
    SERVICE_REGISTERED=1
  fi
  LISTENER="$(/usr/sbin/lsof -nP -iTCP:31337 -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -1 || true)"
  if [[ -n "$LISTENER" && "$SERVICE_REGISTERED" == 0 ]]; then
    echo "ERROR: port 31337 is already owned by PID $LISTENER; refusing to start another backend." >&2
    exit 6
  fi
  if /usr/bin/grep -F '"local.dexdiffusion.server" => disabled' < <(/bin/launchctl print-disabled "gui/$USER_UID" 2>&1) >/dev/null; then
    if [[ "$ENABLE_AFTER_TCC" != 1 ]]; then
      echo "ERROR: user-session service is disabled in launchd; preserving its current state." >&2
      echo "Inspect launchd and storage-access permissions; use --enable-after-tcc only after confirming re-enable is intended." >&2
      exit 9
    fi
    /bin/launchctl enable "gui/$USER_UID/$LABEL"
    echo "Retrying the explicitly re-enabled user service once; failure will leave launchd throttling in effect."
  fi
  /bin/mkdir -p "$USER_HOME/Library/LaunchAgents"
  if [[ ! -e "$AGENT_DEST" ]]; then
    /usr/bin/install -o bigmac -g staff -m 0644 "$AGENT_SOURCE" "$AGENT_DEST"
  fi
  if [[ "$SERVICE_REGISTERED" == 0 ]]; then
    /bin/launchctl bootstrap "gui/$USER_UID" "$AGENT_DEST"
  fi
  READY=0
  for ((attempt=0; attempt<30; attempt++)); do
    recovery_remaining >/dev/null || break
    if /usr/bin/curl -fs --max-time 2 http://127.0.0.1:31337/api/version -o "/tmp/dexdiffusion-version.$$.json" &&
       /usr/bin/curl -fs --max-time 2 http://127.0.0.1:31337/dexdiffusion/ -o /dev/null &&
       /usr/bin/python3 - "$ROOT/operator-console" "/tmp/dexdiffusion-version.$$.json" <<'PY'
import json, subprocess, sys
expected, version_path = sys.argv[1:]
with open(version_path, encoding='utf-8') as f: version = json.load(f)
if version.get('name') != 'Image_Gen Operator Console' or version.get('cwd') != expected: raise SystemExit(1)
pid = str(version.get('pid', ''))
owners = subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:31337','-sTCP:LISTEN','-t'],capture_output=True,text=True)
owner = subprocess.run(['/bin/ps','-o','user=','-p',pid],capture_output=True,text=True)
if owners.returncode or pid not in owners.stdout.split() or owner.returncode or owner.stdout.strip() != 'bigmac': raise SystemExit(1)
# comm and args are read separately: a combined comm=,args= column truncates comm to 16 bytes.
comm = subprocess.run(['/bin/ps','-o','comm=','-p',pid],capture_output=True,text=True)
args = subprocess.run(['/bin/ps','-o','args=','-p',pid],capture_output=True,text=True)
if comm.returncode or args.returncode: raise SystemExit(1)
if comm.stdout.strip().rsplit('/', 1)[-1] != 'node' or 'server.js' not in args.stdout: raise SystemExit(1)
PY
    then READY=1; break; fi
    /bin/sleep 1
  done
  /bin/rm -f "/tmp/dexdiffusion-version.$$.json"
  if [[ "$READY" != 1 ]]; then
    if [[ "$SERVICE_REGISTERED" == 0 ]]; then
      /bin/launchctl bootout "gui/$USER_UID/$LABEL" >/dev/null 2>&1 || true
    fi
    if [[ "$SERVICE_REGISTERED" == 1 ]]; then
      echo "ERROR: service is registered but not API-ready; leaving the existing service untouched." >&2
    else
      echo "ERROR: newly registered service did not pass API/Studio identity checks; launchd retains its configured throttling." >&2
      echo "Recent TCC messages are not attributed to this Node process without matching client and failed-operation evidence." >&2
    fi
    exit 8
  fi
  if [[ "$SERVICE_REGISTERED" == 1 ]]; then
    echo "SERVICE_READY domain=gui/$USER_UID label=$LABEL user=bigmac api=200 studio=200 existing=1"
  else
    echo "SERVICE_READY domain=gui/$USER_UID label=$LABEL user=bigmac api=200 studio=200 existing=0"
  fi
  exit 0
fi

[[ "$EUID" -eq 0 ]] || { echo "ERROR: run via sudo to install the system service." >&2; exit 2; }
[[ "$(/bin/hostname -s)" == bigmac ]] || { echo "ERROR: installation must run on Big Mac." >&2; exit 2; }
[[ "${SUDO_USER:-}" == bigmac ]] || { echo "ERROR: expected sudo caller bigmac; preserving service state." >&2; exit 2; }
# External readiness is checked via bounded read by the runner.
# Service installation must also work when wc2tb is absent.
/usr/bin/plutil -lint "$SOURCE" >/dev/null

agent_loaded() {
  local output
  for domain in "gui/$USER_UID" "$AGENT_DOMAIN"; do
    output="$(/bin/launchctl print "$domain/$LABEL" 2>&1 || true)"
    if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$output" >/dev/null; then
      echo "ERROR: legacy LaunchAgent is loaded in $domain; refusing a duplicate service." >&2
      return 0
    fi
  done
  return 1
}

migrate_agent_file() {
  [[ -e "$AGENT_DEST" ]] || return 0
  if ! /usr/bin/cmp -s "$AGENT_SOURCE" "$AGENT_DEST"; then
    echo "ERROR: existing LaunchAgent differs from the known project definition; preserving it." >&2
    return 1
  fi
  local backup="$AGENT_DEST.migrated-system-daemon-20261102"
  [[ ! -e "$backup" ]] || { echo "ERROR: migration backup already exists; preserving both files." >&2; return 1; }
  /bin/mv "$AGENT_DEST" "$backup"
  echo "PRESERVED legacy LaunchAgent as $backup"
}

if agent_loaded; then exit 4; fi

LOADED="$(/bin/launchctl print "system/$LABEL" 2>&1 || true)"
SYSTEM_REGISTERED=0
if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$LOADED" >/dev/null; then
  if [[ -e "$DEST" ]] && /usr/bin/cmp -s "$SOURCE" "$DEST"; then
    SYSTEM_REGISTERED=1
  else
    echo "ERROR: system service is loaded but its installed definition differs; preserving it." >&2
    exit 5
  fi
fi

DISABLED="$(/bin/launchctl print-disabled system 2>&1 || true)"
if /usr/bin/grep -F '"local.dexdiffusion.server" => disabled' <<<"$DISABLED" >/dev/null; then
  if [[ "$ENABLE_AFTER_TCC" != 1 ]]; then
    echo "ERROR: system service is disabled in launchd; preserving its current state." >&2
    echo "Inspect launchd and storage-access permissions; use --enable-after-tcc only after confirming re-enable is intended." >&2
    exit 9
  fi
  /bin/launchctl enable "system/$LABEL"
fi

if [[ -e "$DEST" ]] && ! /usr/bin/cmp -s "$SOURCE" "$DEST"; then
  echo "ERROR: existing system service definition differs from project source; preserving it." >&2
  exit 5
fi
if [[ -e "$AGENT_DEST" ]] && ! /usr/bin/cmp -s "$AGENT_SOURCE" "$AGENT_DEST"; then
  echo "ERROR: existing LaunchAgent differs from the known project definition; preserving it." >&2
  exit 5
fi

listener="$(/usr/sbin/lsof -nP -iTCP:31337 -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -1 || true)"
if [[ -n "$listener" && "$SYSTEM_REGISTERED" == 0 ]]; then
  echo "ERROR: port 31337 is already owned by PID $listener; refusing to start another backend." >&2
  exit 6
fi

/bin/mkdir -p /Library/LaunchDaemons
if [[ ! -e "$DEST" ]]; then
  temp="$DEST.tmp.$$"
  /usr/bin/install -o root -g wheel -m 0644 "$SOURCE" "$temp"
  /bin/mv "$temp" "$DEST"
fi

if [[ "$SYSTEM_REGISTERED" == 0 ]]; then
  /bin/launchctl bootstrap system "$DEST"
  LOADED="$(/bin/launchctl print "system/$LABEL" 2>&1 || true)"
  if ! /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$LOADED" >/dev/null; then
    echo "ERROR: launchd did not retain the project runner in the system domain." >&2
    echo "$LOADED" | /usr/bin/head -30 >&2
    exit 7
  fi
fi

ready=0
for ((attempt=0; attempt<30; attempt++)); do
  recovery_remaining >/dev/null || break
  if /usr/bin/curl -fs --max-time 2 http://127.0.0.1:31337/api/version -o /tmp/dexdiffusion-version.$$.json &&
     /usr/bin/curl -fs --max-time 2 http://127.0.0.1:31337/dexdiffusion/ -o /dev/null &&
     /usr/bin/python3 - "$ROOT/operator-console" /tmp/dexdiffusion-version.$$.json <<'PY'
import json, os, subprocess, sys
expected, version_path = sys.argv[1:]
with open(version_path, encoding='utf-8') as f:
    v = json.load(f)
if v.get('name') != 'Image_Gen Operator Console' or v.get('cwd') != expected:
    raise SystemExit(1)
pid = str(v.get('pid', ''))
owners = subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:31337','-sTCP:LISTEN','-t'],capture_output=True,text=True)
if owners.returncode or pid not in owners.stdout.split():
    raise SystemExit(1)
owner = subprocess.run(['/bin/ps','-o','user=','-p',pid],capture_output=True,text=True)
if owner.returncode or owner.stdout.strip() != 'bigmac':
    raise SystemExit(1)
# comm and args are read separately: a combined comm=,args= column truncates comm to 16 bytes.
comm = subprocess.run(['/bin/ps','-o','comm=','-p',pid],capture_output=True,text=True)
args = subprocess.run(['/bin/ps','-o','args=','-p',pid],capture_output=True,text=True)
if comm.returncode or args.returncode or comm.stdout.strip().rsplit('/', 1)[-1] != 'node' or 'server.js' not in args.stdout:
    raise SystemExit(1)
PY
  then ready=1; break; fi
  /bin/sleep 1
done
/bin/rm -f /tmp/dexdiffusion-version.$$.json
if [[ "$ready" != 1 ]]; then
  echo "ERROR: system service loaded but project API/Studio did not become ready as bigmac." >&2
  echo "Recent TCC messages are not attributed to this Node process without matching client and failed-operation evidence." >&2
  /bin/launchctl print "system/$LABEL" 2>&1 | /usr/bin/head -50 >&2 || true
  /usr/bin/tail -40 "$ROOT/operator-console/server-error.log" >&2 || true
  exit 8
fi

if [[ "$SYSTEM_REGISTERED" == 0 ]]; then migrate_agent_file; fi
echo "SERVICE_READY domain=system label=$LABEL user=bigmac api=200 studio=200 existing=$SYSTEM_REGISTERED"
