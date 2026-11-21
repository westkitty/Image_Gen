# wc2tb-emergency-internal-fallback-rollback-v1

Emergency internal-fallback rollback for DexDiffusion on Big Mac.
**This is not a pristine baseline.** It is baseline `39534f2` plus two approved
corrections. It has not been deployed.

## Identity

| Item | Value |
|---|---|
| Package version | `wc2tb-emergency-internal-fallback-rollback-v1` |
| Branch | `rollback/wc2tb-fallback-safe-v1-20261120` (local only, not pushed) |
| Worktree | `/Users/bigmac/Image_Gen-wc2tb-fallback-rollback-20261120` |
| Original baseline commit | `39534f2eeb55bd3786ab9292aaf785466cef8379` (production `main` HEAD) |
| Corrected source revision | `c7708e4a40edff156cbaaccda7f6299088c0f306` (sole parent: `39534f2`) |
| This manifest | committed separately on top of `c7708e4`; it adds documentation only |

## Scope of the changes (all in `c7708e4`, see `CHANGED-FILES.txt`)

1. **Production PNG-to-canonical Edit import.** `operator-console/public/dexdiffusion/edit-ui.js`,
   applied byte-for-byte from the checksummed
   `/Users/bigmac/wc2tb-rollback-materials.JWlZ1U9p/production-edit-ui.patch`.
   The resulting file SHA-256 is `44e7e73974642c1c71b57592c61a078b40415f0a931ab90bce1c0798030577e8`,
   which matches the protected dirty production file.
2. **Internal-fallback publication isolation.** When `DEX_STORAGE_MODE=internal-fallback`:
   - `server.js`: `crossHostPublicationEnabled` is false, so there is no outbox create or
     reconcile, no pull/content/ack/failure routes (404), and no verified-image sweep.
   - `server.js`: the MacBook image client is not created, even when `DEX_MACBOOK_IMAGES_URL` is set.
     That means no manifest polling, no pulls, and no cleanup based on MacBook state.
   - `server.js` `/api/system-info`: reports `publication: 'suspended-internal-fallback'`
     and says images stay on Big Mac, instead of claiming MacBook publication.
   - `bin/canonicalize-image.js`: no `macbook-pull-v1` publication and no outbox.
   - `bin/local-engine-generate.js` (`createJobImageStore`): no `onPublished` and no outbox.
   - External mode is unchanged.
3. **Tests only:** a new real-server regression test (`tests/fallback-publication-runtime.test.js`,
   adapted to the baseline `createJobImageStore` API), plus two source-assertion tests
   updated to the corrected conditions.

No Gate E supervisor, EngineHost, worker, launcher, or launchd changes are included.

## Required runtime and dependencies (external to this package, referenced and not copied)

This package is **not self-contained**. It depends on:

| Dependency | Path | Integrity |
|---|---|---|
| Standalone Node v26.13.1 | `~/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/node/bin/node` | SHA-256 `266dec4d…751ec` (`RUNTIME-SHA256SUMS`); tarball `aec2514e…c9735` matches the upstream `SHASUMS256.txt` line |
| Node dependencies (express 5, three 0.186.1, @sparkjsdev/spark 2.3.1) | `~/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/baseline/operator-console/node_modules` (80 MB, 3898 files) | tree digest below; its `package-lock.json` is byte-identical to the one in `c7708e4` |
| Image validation Python (Pillow) | `/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python` | not hashed (symlink to uv CPython 3.13.13) |
| Original rollback materials | `/Users/bigmac/wc2tb-rollback-materials.JWlZ1U9p` | its `SHA256SUMS` and `STATE-POINTERS.sha256` both pass |

To reproduce the dependency tree digest:

```
cd "$HOME/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/baseline/operator-console/node_modules"
find . -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256
# expected: 3d29db1642d26d23a9a016861ba42617eb5fb111f9726c05f2121330ec52847a
```

The Node runtime (222 MB extracted) is deliberately **not** duplicated, because Big Mac has
about 5.3 GiB of free internal space.

## Integrity checks

```
cd /Users/bigmac/Image_Gen-wc2tb-fallback-rollback-20261120
git cat-file -t c7708e4a40edff156cbaaccda7f6299088c0f306          # commit
git rev-parse c7708e4a40edff156cbaaccda7f6299088c0f306^            # 39534f2eeb55…
git diff --quiet c7708e4a40edff156cbaaccda7f6299088c0f306 HEAD -- operator-console scripts && echo SOURCE_MATCHES_c7708e4
shasum -a 256 -c rollback-packages/wc2tb-emergency-internal-fallback-rollback-v1/SOURCE-SHA256SUMS
shasum -a 256 -c rollback-packages/wc2tb-emergency-internal-fallback-rollback-v1/RUNTIME-SHA256SUMS
```

`SOURCE-SHA256SUMS` paths are relative to the repository root. They cover every changed file
plus `package.json`, `package-lock.json`, and `scripts/run-backend-service.sh`.

## Restoration (future, owner-authorized maintenance window only)

Nothing below has been run against production. Every step needs explicit owner authority
at the time it is run.

1. Run the integrity checks above.
2. Export the source into a **new, empty** directory, with no overwrite:
   `git -C /Users/bigmac/Image_Gen-wc2tb-fallback-rollback-20261120 archive c7708e4a40edff156cbaaccda7f6299088c0f306 | tar -x -C <new-empty-dir>`
3. Link the verified dependency tree:
   `ln -s "$HOME/Library/Application Support/DexDiffusion/wc2tb-recovery-runtime/baseline/operator-console/node_modules" <new-empty-dir>/operator-console/node_modules`
4. Start the backend in fallback mode with the **standalone** Node, from `<new-empty-dir>/operator-console`,
   using the same environment that the baseline launcher's fallback branch exports
   (`scripts/run-backend-service.sh`, lines 43–66):
   `DEX_DATA_ROOT=/Users/bigmac/DexDiffusion-InternalFallback DEX_STORAGE_MODE=internal-fallback DEX_LOCAL_ENGINE_BRIDGE=0 DEX_CHAT_ENABLED=0 DEX_IMAGE_VALIDATION_PYTHON=/Users/bigmac/Library/Caches/DexDiffusion/mflux/venv/bin/python OPERATOR_CONSOLE_PORT=31337 <standalone node> server.js`
   (Do not set `DEX_MACBOOK_IMAGES_URL`. It is ignored in fallback mode anyway.)
5. Verify: `/api/version` `storage.mode=internal-fallback`; `/api/publications/status` `enabled=false`;
   `/api/capabilities` has exactly `flux-fp8`, `flux2-klein-4b`, `sdxl-photonic`; and `/dexdiffusion/` returns HTTP 200.

## Known limitations

- **The launcher is not pinned.** The baseline `scripts/run-backend-service.sh` ends with
  `exec /opt/homebrew/bin/node server.js`. Homebrew Node 26.13.1_2 is present again
  (reinstalled 2026-11-16), but it is not hash-verified, and it was previously deleted.
  Using the launcher as-is does **not** use the verified runtime. Changing it was outside
  the approved correction set, so restoration step 4 runs the standalone Node directly.
- **The production dependency link is broken.** `/Users/bigmac/Image_Gen/operator-console/node_modules`
  points to a missing directory. Restarting production in place from `/Users/bigmac/Image_Gen`
  would fail to load dependencies. This package avoids that by using the exported tree from step 3.
- **Not demonstrated:** a restart under launchd or EngineHost, real inference in fallback mode,
  whether the three fallback model files exist and load from internal storage, behavior against
  the existing `/Users/bigmac/DexDiffusion-InternalFallback` contents, and any
  production listener interaction.
- The test exercises the publication contract. It is not a full feature regression
  (Edit, World, Audio, Video, and chat were not exercised here).
- **No automatic merge or mode return.** Inherited pending or verified receipts stay suspended
  while in fallback mode, and nothing reconciles them back to external storage.

## Validation (2026-11-21, Big Mac, standalone Node v26.13.1)

| Check | Source | Result |
|---|---|---|
| Syntax (`node --check`) on all changed JS files | worktree at `c7708e4` content | PASS |
| `git diff --check` | same | PASS |
| Focused + real-server tests (`fallback-publication-runtime`, `internal-fallback`, `authorized-recovery`) | worktree | 7/7 PASS |
| Related publication, recovery, transfer, and storage suites (21 files, Pillow Python) | worktree | 131/131 PASS |
| Real-server tests run from a **clean `git archive` export of `c7708e4`** with linked deps | export | 2/2 PASS |
| Negative control: same test against an unpatched `39534f2` export | export | FAILS as expected ("CLI producer must not offer MacBook publication"); external case passes |

Real-server fallback proof (private port, temporary data root, loopback MacBook canary):
`publication.enabled=false`, `pending=0`, inherited pending receipt `suspended=1`, pending queue `[]`,
3 model targets, Studio HTTP 200, `system-info.publication=suspended-internal-fallback`,
ack route 404, **0 canary requests**. Both inherited receipts (PUBLICATION_PENDING and CANONICAL_VERIFIED)
were deep-equal before and after. Local image bytes kept the same SHA-256. A verified image that the
canary manifest claimed was **not** removed. No new outbox records were written by the CLI, the engine
store, or the server. The test-owned backend was terminated.

Real-server external proof: `publication.enabled=true`, `pending>=1`, canary received `GET /manifest`,
CLI and engine-store entries carry `macbook-pull-v1` with outbox `PUBLICATION_PENDING`, and image
bytes were kept with no receipt.
