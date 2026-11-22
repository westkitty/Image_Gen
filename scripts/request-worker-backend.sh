#!/bin/bash
# Invoked over the existing authenticated SSH transport.
set -euo pipefail
[[ "$(id -un)" == bigmac && "$(hostname -s)" == bigmac ]]
mode=/Users/bigmac/.dexdiffusion-engine/backend-supervisor-mode
if [[ ! -e "$mode" && ! -L "$mode" ]]; then
  [[ "${1:---ensure}" == --ensure ]]
  exec /bin/bash /Users/bigmac/Image_Gen/scripts/install-backend-service.sh --user-session
fi
[[ ! -L "$mode" && "$(cat "$mode")" == production ]] || {
  echo 'SERVICE_BLOCKED: worker supervision mode is not production' >&2
  exit 78
}
action="${1:---ensure}"
if [[ "$action" == --restart ]]; then
  # A restart stops a working backend: the release doctor must pass first.
  # No environment variable can skip this; see docs/WC2TB_RECOVERY_RUNBOOK.md.
  shift
  [[ -z "${DEX_RELEASE_GATE_FIXTURE_FACTS:-}" ]] || { echo 'SERVICE_BLOCKED: fixture facts cannot authorize a restart' >&2; exit 78; }
  /bin/bash "$(dirname "${BASH_SOURCE[0]}")/release-gate.sh" "$@" || { echo 'SERVICE_BLOCKED: release gate refused restart; backend left running' >&2; exit 78; }
elif [[ "$action" == --handoff-fallback || "$action" == --return-external ]]; then
  # Owner-authorized production <-> internal-fallback handoff. The EngineHost
  # worker re-verifies identity, idleness, package and port itself and refuses
  # before touching the running backend. See docs/WC2TB_RECOVERY_RUNBOOK.md.
  shift
  [[ -z "${DEX_RELEASE_GATE_FIXTURE_FACTS:-}" ]] || { echo 'SERVICE_BLOCKED: fixture facts cannot authorize a handoff' >&2; exit 78; }
  expect="" reason=""
  while (($#)); do
    case "$1" in
      --expect-revision) expect="${2:-}"; shift 2 ;;
      --reason) reason="${2:-}"; shift 2 ;;
      *) echo "SERVICE_BLOCKED: unknown handoff argument $1" >&2; exit 2 ;;
    esac
  done
  exec /opt/homebrew/bin/python3 - "$action" "$expect" "$reason" <<'PY'
import json, socket, sys, time
action, expect, reason = sys.argv[1:]
target = 'fallback' if action == '--handoff-fallback' else 'external'
final = {'fallback': 'RUNNING_FALLBACK', 'external': 'RUNNING_EXTERNAL'}[target]
def request(payload):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(20)
        sock.connect('/Users/bigmac/.dexdiffusion-engine/engine.sock')
        sock.sendall((json.dumps(payload) + '\n').encode())
        return json.loads(sock.makefile().readline(1 << 20))
try:
    reply = request({'op': 'backend-handoff', 'target': target, 'expect_revision': expect, 'reason': reason})
except (OSError, ValueError) as error:
    print('HANDOFF_BLOCKED: worker unavailable or handoff unsupported: %s' % error, file=sys.stderr); sys.exit(78)
if not reply.get('ok'):
    for code in reply.get('refused') or [reply.get('error', 'refused')]:
        print('HANDOFF_REFUSED ' + str(code), file=sys.stderr)
    print('HANDOFF_REFUSED: running backend left untouched', file=sys.stderr); sys.exit(78)
print('HANDOFF_ACCEPTED target=%s state=%s' % (target, (reply.get('handoff') or {}).get('state')))
for _ in range(360):
    time.sleep(.5)
    try:
        status = request({'op': 'backend-status'})
    except (OSError, ValueError):
        continue
    state = (status.get('handoff') or {}).get('state')
    if state == final:
        print('HANDOFF_COMPLETE state=%s pid=%s profile=%s' % (state, status.get('pid'), status.get('profile'))); sys.exit(0)
    if state == 'HANDOFF_FAILED' or (target == 'fallback' and state == 'RUNNING_EXTERNAL'):
        print('HANDOFF_FAILED state=%s detail=%s' % (state, json.dumps(status.get('handoff'))), file=sys.stderr); sys.exit(70)
print('HANDOFF_PENDING: transition still in progress; read backend-status', file=sys.stderr); sys.exit(75)
PY
elif [[ $# -gt 1 ]]; then
  echo 'SERVICE_BLOCKED: --ensure takes no further arguments' >&2; exit 2
fi
exec /opt/homebrew/bin/python3 - "$action" <<'PY'
import json, socket, sys, time, urllib.request
action = sys.argv[1]
if action not in ('--ensure', '--restart'):
    sys.exit(2)
def request(op):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(2)
        sock.connect('/Users/bigmac/.dexdiffusion-engine/engine.sock')
        sock.sendall((json.dumps({'op': op}) + '\n').encode())
        return json.loads(sock.makefile().readline(1 << 20))
try:
    original = request('backend-status')
    if action == '--restart':
        if not request('backend-restart').get('ok'):
            raise RuntimeError('worker refused restart')
    for _ in range(6):
        state = request('backend-status')
        if not state.get('ok') or state.get('port') != 31337 or state.get('state') in ('RECOVERY_BLOCKED', 'CIRCUIT_OPEN', 'PORT_HELD'):
            raise RuntimeError(state.get('state', 'unknown'))
        if state.get('pid') and (action == '--ensure' or state['pid'] != original.get('pid')):
            try:
                with urllib.request.urlopen('http://127.0.0.1:31337/api/version', timeout=1) as response:
                    version = json.load(response)
                if version.get('pid') == state['pid'] and version.get('cwd') == '/Users/bigmac/Image_Gen-wc2tb-20261120/operator-console':
                    print('SERVICE_READY supervisor=engine-worker pid=' + str(state['pid']))
                    sys.exit(0)
            except OSError:
                pass
        time.sleep(.5)
except (OSError, ValueError, RuntimeError) as error:
    print('SERVICE_BLOCKED: ' + str(error), file=sys.stderr)
    sys.exit(78)
print('SERVICE_PENDING: worker has not confirmed readiness', file=sys.stderr)
sys.exit(75)
PY
