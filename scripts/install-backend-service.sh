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
STATE_DIR="$USER_HOME/Library/Application Support/DexDiffusion"
TCC_MARKER="$STATE_DIR/backend-service-tcc-disabled"
ENABLE_AFTER_TCC=0
USER_SESSION=0

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
  [[ -d /Volumes/wc2tb && -d /Volumes/wc2tb/DexDiffusion ]] || {
    echo "ERROR: durable storage unavailable at /Volumes/wc2tb/DexDiffusion; refusing install." >&2; exit 3;
  }
  /sbin/mount | /usr/bin/grep -F ' on /Volumes/wc2tb (' >/dev/null || {
    echo "ERROR: /Volumes/wc2tb is not mounted as a filesystem." >&2; exit 3;
  }
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
  if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$AGENT_LOADED" >/dev/null; then
    /bin/rm -f "$TCC_MARKER"
    echo "SERVICE_ALREADY_LOADED domain=gui/$USER_UID label=$LABEL"
    exit 0
  fi
  LISTENER="$(/usr/sbin/lsof -nP -iTCP:31337 -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -1 || true)"
  if [[ -n "$LISTENER" ]]; then
    echo "ERROR: port 31337 is already owned by PID $LISTENER; refusing to start another backend." >&2
    exit 6
  fi
  if /usr/bin/grep -F '"local.dexdiffusion.server" => disabled' < <(/bin/launchctl print-disabled "gui/$USER_UID" 2>&1) >/dev/null; then
    if [[ "$ENABLE_AFTER_TCC" != 1 && ! -f "$TCC_MARKER" ]]; then
      echo "ERROR: user-session service is disabled after a removable-volume privacy denial." >&2
      echo "This job was not disabled by the installer; inspect launchd state before enabling it." >&2
      exit 9
    fi
    /bin/launchctl enable "gui/$USER_UID/$LABEL"
    echo "Retrying the previously TCC-disabled user service once; failure will disable it again."
  fi
  /bin/mkdir -p "$USER_HOME/Library/LaunchAgents"
  if [[ ! -e "$AGENT_DEST" ]]; then
    /usr/bin/install -o bigmac -g staff -m 0644 "$AGENT_SOURCE" "$AGENT_DEST"
  fi
  /bin/launchctl bootstrap "gui/$USER_UID" "$AGENT_DEST"
  READY=0
  for _ in {1..30}; do
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
PY
    then READY=1; break; fi
    /bin/sleep 1
  done
  /bin/rm -f "/tmp/dexdiffusion-version.$$.json"
  if [[ "$READY" != 1 ]]; then
    /bin/launchctl bootout "gui/$USER_UID/$LABEL" >/dev/null 2>&1 || true
    if /usr/bin/log show --last 3m --style compact --predicate 'process == "tccd"' 2>/dev/null |
        /usr/bin/grep -F 'kTCCServiceSystemPolicyRemovableVolumes' |
        /usr/bin/grep -F 'Refusing TCCAccessRequest' >/dev/null; then
      if /bin/launchctl disable "gui/$USER_UID/$LABEL"; then
        /bin/mkdir -p "$STATE_DIR"
        /usr/bin/touch "$TCC_MARKER"
      fi
      echo "ERROR: macOS TCC denied Node Removable Volumes access in the user session; service unloaded to prevent a launch loop." >&2
    else
      echo "ERROR: user-session service did not pass API/Studio identity checks; service unloaded." >&2
    fi
    exit 8
  fi
  /bin/rm -f "$TCC_MARKER"
  echo "SERVICE_READY domain=gui/$USER_UID label=$LABEL user=bigmac api=200 studio=200"
  exit 0
fi

[[ "$EUID" -eq 0 ]] || { echo "ERROR: run via sudo to install the system service." >&2; exit 2; }
[[ "$(/bin/hostname -s)" == bigmac ]] || { echo "ERROR: installation must run on Big Mac." >&2; exit 2; }
[[ "${SUDO_USER:-}" == bigmac ]] || { echo "ERROR: expected sudo caller bigmac; preserving service state." >&2; exit 2; }
[[ -d /Volumes/wc2tb && -d /Volumes/wc2tb/DexDiffusion ]] || {
  echo "ERROR: durable storage unavailable at /Volumes/wc2tb/DexDiffusion; refusing install." >&2; exit 3;
}
/sbin/mount | /usr/bin/grep -F ' on /Volumes/wc2tb (' >/dev/null || {
  echo "ERROR: /Volumes/wc2tb is not mounted as a filesystem." >&2; exit 3;
}
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
if /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$LOADED" >/dev/null; then
  if [[ -e "$DEST" ]] && /usr/bin/cmp -s "$SOURCE" "$DEST"; then
    migrate_agent_file
    echo "SERVICE_ALREADY_LOADED domain=system label=$LABEL"
    exit 0
  fi
  echo "ERROR: system service is loaded but its installed definition differs; preserving it." >&2
  exit 5
fi

DISABLED="$(/bin/launchctl print-disabled system 2>&1 || true)"
if /usr/bin/grep -F '"local.dexdiffusion.server" => disabled' <<<"$DISABLED" >/dev/null; then
  if [[ "$ENABLE_AFTER_TCC" != 1 ]]; then
    echo "ERROR: system service is intentionally disabled after a removable-volume privacy denial." >&2
    echo "Grant Node Removable Volumes access in the Big Mac GUI session, then rerun with --enable-after-tcc." >&2
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
if [[ -n "$listener" ]]; then
  echo "ERROR: port 31337 is already owned by PID $listener; refusing to start another backend." >&2
  exit 6
fi

/bin/mkdir -p /Library/LaunchDaemons
if [[ ! -e "$DEST" ]]; then
  temp="$DEST.tmp.$$"
  /usr/bin/install -o root -g wheel -m 0644 "$SOURCE" "$temp"
  /bin/mv "$temp" "$DEST"
fi

/bin/launchctl bootstrap system "$DEST"
LOADED="$(/bin/launchctl print "system/$LABEL" 2>&1 || true)"
if ! /usr/bin/grep -F "$ROOT/scripts/run-backend-service.sh" <<<"$LOADED" >/dev/null; then
  echo "ERROR: launchd did not retain the project runner in the system domain." >&2
  echo "$LOADED" | /usr/bin/head -30 >&2
  exit 7
fi

ready=0
for _ in {1..30}; do
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
PY
  then ready=1; break; fi
  /bin/sleep 1
done
/bin/rm -f /tmp/dexdiffusion-version.$$.json
if [[ "$ready" != 1 ]]; then
  if /usr/bin/log show --last 3m --style compact --predicate 'process == "tccd"' 2>/dev/null |
      /usr/bin/grep -F 'kTCCServiceSystemPolicyRemovableVolumes' |
      /usr/bin/grep -F 'Refusing TCCAccessRequest' >/dev/null; then
    /bin/launchctl bootout "system/$LABEL" >/dev/null 2>&1 || true
    /bin/launchctl disable "system/$LABEL"
    echo "ERROR: macOS TCC denied Node Removable Volumes access in the background session." >&2
    echo "The daemon has been unloaded and disabled to prevent a launch loop. Grant access in the Big Mac GUI, then rerun with --enable-after-tcc." >&2
    exit 8
  fi
  echo "ERROR: system service loaded but project API/Studio did not become ready as bigmac." >&2
  /bin/launchctl print "system/$LABEL" 2>&1 | /usr/bin/head -50 >&2 || true
  /usr/bin/tail -40 "$ROOT/operator-console/server-error.log" >&2 || true
  exit 8
fi

migrate_agent_file
echo "SERVICE_READY domain=system label=$LABEL user=bigmac api=200 studio=200"
