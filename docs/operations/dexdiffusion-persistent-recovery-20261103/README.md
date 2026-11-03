# DexDiffusion persistent recovery release — 2026-11-03

Evidence dossier for PR #22 (`fix/dexdiffusion-publication-proof-20261103`). Detailed,
timestamped receipts live in `OPERATIONAL_STATE.md` (2026-11-03 entries). Every claim
below was observed live unless marked otherwise.

## Defect ledger

| Observed | Root cause | Repair | Invariant / test | Live proof | Verdict |
|---|---|---|---|---|---|
| Image `…57ece1e8…` stuck `PUBLICATION_PENDING`; absent on MacBook | Consumer existed but nothing scheduled it | Controller dispatches `publication-sync` after verified health | `test_recovery_controller.py`: pending dispatch + backoff; unhealthy route never publishes | Published 192,271 B, SHA `0ea753df…`, receipt + ACK | FIXED |
| Recovery LaunchAgent absent | Never installed | `scripts/install-recovery-agent.sh install` (user-approved) | `recovery-controller-launchd.test.js` | `gui/501/local.dexdiffusion.recovery` loaded, 60 runs, last exit 0 | FIXED |
| `state.json` stuck `VERIFYING` | Earlier run killed mid-episode | Any in-flight state found under the lock becomes `INTERRUPTED_RECOVERY`, budget kept, fresh probe required | stale-VERIFYING test | VERIFYING → INTERRUPTED_RECOVERY → HEALTHY, zero mutations | FIXED |
| Stale test expectations (40/110 s, `start`, `{}` on corrupt state) | Tests predated controller | Tests assert actual 105/180 s, `__controller-start`, fail-closed BLOCKED | 16/16 Python; Node suites pass | — | FIXED |
| `bin/dexdiffusion open` aborts when the controller is not HEALTHY | `set -e` on `cmd_recovery` | Warn and still activate the app | `native-wrapper-launch.test.js` | — | FIXED |
| Installed app older than source | No rebuild since native changes | Rollback-preserving installer rebuild | Installer fingerprint checks | Fingerprint `ce2fd5e1…`, Studio bootstrap verified, quit/relaunch/reopen | FIXED |
| Tunnel stalled after app quit/relaunch | UNKNOWN (same symptom as earlier Nov 3 stall) | Existing two-strike, tunnel-only repair | dock-tunnel-recovery suite | ssh 91661 → 99069 by launchd; backend 24709 untouched | SELF-HEALED; cause open |
| PR `component.js` said `✗ Offline` vs served `⚠ Degraded` | Divergent copies | PR aligned to served text | — | Big Mac served file byte-identical to PR | FIXED |

## Release certificate

```
DEXDIFFUSION PERSISTENT-RECOVERY RELEASE CERTIFICATE
Timestamp (America/Detroit): 2026-11-03
RESULT: PERSISTENT_SYSTEM_PASS (scope: active login sessions; reboot/logout NOT_TESTED)
Source: westkitty/Image_Gen, PR #22, branch fix/dexdiffusion-publication-proof-20261103
MacBook: andrew, /Users/andrew/Image_Gen; /Applications/DexDiffusion.app local.image-gen.wrapper,
  Swift SHA-256 ce2fd5e13bfcffef2f19540db47645af1cc9a0a9a64fed989a83d3428550ccee, icon .icns unchanged,
  1 Dock tile; WKWebView Studio bootstrap verified + window screenshot; quit/relaunch/reopen OK
Big Mac: gui/503/local.dexdiffusion.server PID 24709, startedAt 2026-11-03T09:17:00.758Z;
  backend sources byte-identical to PR blobs (server, producer, image-store, outbox, system-info,
  storage-paths, service scripts, served component.js); /Volumes/wc2tb mounted; TCC via Aqua user agent
Transport: owned ssh -L 31337 (91661, replaced by controller with 99069); Studio 200 / 184,781 B
Controller: gui/501/local.dexdiffusion.recovery, 60 s, 60 runs, last exit 0; HEALTHY, circuit closed,
  1 automatic tunnel episode; lock + persisted state verified
Publication: 4/4 CANONICAL_VERIFIED, 0 pending
  - 20261103-093026-…-57ece1e8 192,271 B 0ea753df… (stuck item, manual sync)
  - 20261103-125457-…-d9a2b82a 284,177 B 70d2c2f7… (fresh job, app open)
  - 20261103-125955-…-b5ef20be 223,002 B fe5c6de8… (fresh job, app CLOSED, launchd tick)
  each: MacBook file = Big Mac bytes + SHA, receipt, Big Mac ACK, Library entry, working copy retained
Tests: Python controller 16/16; MacBook Node focused 88/89 (1 host-gated, passes on Big Mac 4/4);
  swiftc typecheck, bash -n, node --check, plutil, git diff --check PASS
Resilience: app-closed publication PASS; reopen PASS; live stalled-tunnel self-heal PASS;
  resource contention/sleep-wake/network change NOT_TESTED live (fixtures only)
Preservation: no images, journals, models, jobs or foreign services touched; uncommitted work on
  both checkouts preserved (MacBook controlled-publication.js etc., Big Mac local-engine-routing.js)
Pages: NOT_CONFIGURED (GET /repos/westkitty/Image_Gen/pages → 404)
Gates: G00–G14 PASS except physical reboot/logout persistence (NOT_TESTED, configured RunAtLoad)
Rollback: app → ~/Library/Application Support/DexDiffusion/retired-launchers/DexDiffusion-previous-20261103-075142.app
  Dock → ~/Library/Application Support/DexDiffusion/dock-backup-20261103-075142.plist
  agent → scripts/install-recovery-agent.sh uninstall
  MacBook code → ~/Library/Application Support/DexDiffusion/code-backups/recovery-20261103-073226/
  Big Mac outbox → ~bigmac/Library/Application Support/DexDiffusion/rollout-20261103/publication-outbox.before-2c621a8.js
Residual: tunnel-stall root cause unknown; Library does not surface MacBook canonical state;
  checkout HEAD stamped in app Info.plist is not a clean-tree identity (use the Swift fingerprint)
NEXT ACTION: after the next reboot run `launchctl print gui/$(id -u)/local.dexdiffusion.recovery` and
  `bin/dexdiffusion recovery-status`
```
