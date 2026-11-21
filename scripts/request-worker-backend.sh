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
exec /opt/homebrew/bin/python3 - "${1:---ensure}" <<'PY'
import json, socket, sys, time, urllib.request
action = sys.argv[1]
if action not in ('--ensure', '--restart'):
    sys.exit(2)
def request(op):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(2)
        sock.connect('/Users/bigmac/.dexdiffusion-engine/engine.sock')
        sock.sendall((json.dumps({'op': op}) + '\n').encode())
        return json.loads(sock.makefile().readline(4096))
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
