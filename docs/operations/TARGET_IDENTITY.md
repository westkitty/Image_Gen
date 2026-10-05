# DexDiffusion target identity

Reuse `bin/dexdiffusion status` / `doctor` and the console's existing endpoints; do not add another runtime owner. Those health commands can probe remote assets but never constitute generation proof. For a local identity check without remote contact:

```sh
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
curl -fsS --max-time 5 http://127.0.0.1:31337/api/version
lsof -nP -iTCP:31337 -sTCP:LISTEN
plutil -extract DexDiffusionProjectRoot raw /Applications/DexDiffusion.app/Contents/Info.plist
plutil -extract DexDiffusionSourceHead raw /Applications/DexDiffusion.app/Contents/Info.plist
```

Require expected repository root; API cwd==root/operator-console; nonempty API gitHead prefix of full checkout HEAD; API PID==listener PID; loopback binding; installed wrapper root matches. Any mismatch stops reuse/repair until ownership is resolved. Wrapper build stamp is separate lineage: expose its difference, do not rewrite it to pretend a rebuild occurred. Dated identity receipts expire when source/process/install changes; regenerate the observation before relying on it.

Cold wrapper acceptance: first confirm inactive wrapper, no active `/api/jobs` or `/api/generic-jobs`, and null owner/empty waiting in `/api/resources`. Open the ordinary installed app without restarting the console; witness actual native UI URL, rendered controls, wrapper process and API/listener identity. Preserve services and settings; do not Generate. Cold server boot is a separate gate when the server can safely be inactive. [2026-10-04 receipt](target-identity-20261004.json) records actual cold wrapper acceptance, unchanged server PID and remaining gates.
