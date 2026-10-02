#!/usr/bin/env bash
set -euo pipefail

if [ "${DEX_SECONDARY_SLOT_LOCAL:-0}" != "1" ] && [ "${DEX_SECONDARY_SLOT_REMOTE:-0}" != "1" ]; then
  # Tailscale SSH can report zero for a failed remote activation. Validate
  # the returned state on the MacBook before any caller may use the slot.
  result="$(ssh -o BatchMode=yes -o ConnectTimeout=8 "${DEX_SSH_TARGET:-westcat}" \
    "DEX_SECONDARY_SLOT_REMOTE=1 /bin/bash -s -- $(printf '%q ' "$@")" < "$0")" || exit 1
  printf '%s\n' "$result"
  /usr/bin/python3 -c '
import json, sys
try:
    state = json.loads(sys.argv[1])
    if sys.argv[2] == "activate":
        assert state.get("lastSwitchResult", {}).get("status") == "pass"
        assert state.get("secondaryModelState") == "active"
        assert state.get("activeSecondaryModel") == sys.argv[3]
    else:
        assert state.get("primaryModel", {}).get("id") == "flux2-klein-4b"
except Exception:
    sys.exit(1)
' "$result" "$1" "${2:-}"
  exit $?
fi

/usr/bin/python3 - "$@" <<'PY'
import json, os, pathlib, shutil, sys, time, uuid

ROOT = pathlib.Path(os.path.expandvars(os.path.expanduser(
    os.environ.get('DEX_SECONDARY_SLOT_ROOT', '$HOME/Library/Caches/DexDiffusion/secondary-model')))).resolve()
VERSIONS = ROOT / 'versions'
CURRENT = ROOT / 'current'
LOCK = ROOT / '.switch-lock'
PRIMARY = {'id': 'flux2-klein-4b', 'role': 'protected-primary', 'backend': 'mflux'}

def read_state():
    try:
        return json.loads((CURRENT / 'state.json').read_text())
    except Exception:
        return {'primaryModel': PRIMARY, 'activeSecondaryModel': None, 'secondaryModelState': 'inactive',
                'sourcePath': None, 'activePath': None, 'backend': None, 'modelIdentity': None,
                'lastSwitchResult': None}

def emit(state, code=0):
    print(json.dumps(state, separators=(',', ':')))
    raise SystemExit(code)

def fail(message, previous, code=1):
    state = dict(previous)
    state['primaryModel'] = PRIMARY
    state['lastSwitchResult'] = {'status': 'fail', 'error': message, 'at': int(time.time())}
    if CURRENT.exists():
        tmp = CURRENT / ('.state-' + uuid.uuid4().hex + '.tmp')
        tmp.write_text(json.dumps(state, indent=2) + '\n')
        os.replace(tmp, CURRENT / 'state.json')
    emit(state, code)

if len(sys.argv) < 2 or sys.argv[1] not in ('status', 'activate'):
    emit({'error': 'usage: sdcpp-secondary-slot.sh status | activate TARGET SOURCE'}, 2)
if sys.argv[1] == 'status':
    emit(read_state())
if len(sys.argv) != 4:
    emit({'error': 'activate requires TARGET and SOURCE'}, 2)

target = sys.argv[2]
source_input = pathlib.Path(os.path.expandvars(os.path.expanduser(sys.argv[3])))
source_is_symlink = source_input.is_symlink()
source = source_input.resolve()
ROOT.mkdir(parents=True, exist_ok=True)
VERSIONS.mkdir(parents=True, exist_ok=True)
previous = read_state()
try:
    LOCK.mkdir()
except FileExistsError:
    fail('secondary model switch is busy', previous)

try:
    if target == PRIMARY['id']:
        fail('protected primary model cannot enter the secondary slot', previous)
    if source.suffix.lower() != '.safetensors' or not source.is_file() or source_is_symlink:
        fail('source checkpoint is missing, unsafe, or not a .safetensors file', previous)
    if source.stat().st_size <= 1024 * 1024:
        fail('source checkpoint is too small to be valid', previous)
    if os.environ.get('DEX_SECONDARY_SLOT_LOCAL') != '1':
        allowed = [pathlib.Path('/Users/bigmac/sdcpp-staging/models'), pathlib.Path('/Volumes/wc2tb/ImageGen/checkpoints'), pathlib.Path('/Volumes/wc2tb/ImageGen/flux'), pathlib.Path('/Volumes/wc2tb/dex-imagegen/models/checkpoints'), pathlib.Path('/Volumes/wc2tb/dex-imagegen/models/flux1/transformer')]
        if not any(source == p or p in source.parents for p in allowed):
            fail('source checkpoint is outside approved model roots', previous)

    token = time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8]
    version = VERSIONS / token
    version.mkdir()
    os.symlink(str(source), version / 'model.safetensors')
    state = {
        'primaryModel': PRIMARY,
        'activeSecondaryModel': target,
        'secondaryModelState': 'active',
        'sourcePath': str(source),
        'activePath': str(CURRENT / 'model.safetensors'),
        'backend': 'sdcpp',
        'modelIdentity': {'target': target, 'filename': source.name, 'bytes': source.stat().st_size},
        'lastSwitchResult': {'status': 'pass', 'at': int(time.time())},
    }
    (version / 'state.json').write_text(json.dumps(state, indent=2) + '\n')
    tmp_link = ROOT / ('.current-' + uuid.uuid4().hex)
    os.symlink(str(version), tmp_link)
    os.replace(tmp_link, CURRENT)
    for child in VERSIONS.iterdir():
        if child != version:
            shutil.rmtree(child)
    emit(state)
finally:
    try:
        LOCK.rmdir()
    except OSError:
        pass
PY
