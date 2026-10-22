#!/usr/bin/env bash
# Run on Big Mac after copying worker files and the server-owned registry.
set -euo pipefail
[ "$(id -un)" = bigmac ] && [ "$HOME" = /Users/bigmac ] || exit 1
root="$HOME/.dexdiffusion-engine"
app="$HOME/Applications/DexDiffusion Engine Worker.app"
label=local.dexdiffusion.engine-worker
launch="$HOME/Library/LaunchAgents/$label.plist"
# Never replace a running worker or interrupt inference implicitly.
if launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || [ -S "$root/engine.sock" ]; then echo 'Worker already running; stop it while idle before installing.' >&2; exit 1; fi
umask 077
mkdir -p "$app/Contents/MacOS" "$HOME/Library/LaunchAgents" "$root/jobs"
chmod 700 "$root"
/usr/bin/swiftc "$root/EngineHost.swift" -o "$app/Contents/MacOS/DexDiffusionEngineHost"
/usr/bin/python3 - "$app/Contents/Info.plist" "$launch" "$app/Contents/MacOS/DexDiffusionEngineHost" "$root" <<'PY'
import plistlib, sys
info, agent, executable, root = sys.argv[1:]
with open(info, 'wb') as f:
    plistlib.dump({'CFBundleIdentifier':'local.dexdiffusion.engine-worker', 'CFBundleName':'DexDiffusion Engine Worker',
                  'CFBundleExecutable':'DexDiffusionEngineHost', 'CFBundleVersion':'1', 'CFBundlePackageType':'APPL',
                  'LSUIElement':True, 'NSRemovableVolumesUsageDescription':'Read installed image models and adapters for DexDiffusion inference.'}, f)
with open(agent, 'wb') as f:
    plistlib.dump({'Label':'local.dexdiffusion.engine-worker', 'ProgramArguments':[executable],
                  'RunAtLoad':True, 'KeepAlive':True, 'ThrottleInterval':10, 'ProcessType':'Interactive',
                  'LimitLoadToSessionType':'Aqua', 'ExitTimeOut':20, 'StandardOutPath':root+'/host.log',
                  'StandardErrorPath':root+'/host-error.log'}, f)
PY
/usr/bin/codesign --force --sign - --identifier "$label" "$app"
launchctl bootstrap "gui/$(id -u)" "$launch"
printf 'ENGINE_INSTALLED: %s\nSTARTUP: %s\n' "$app" "$launch"
