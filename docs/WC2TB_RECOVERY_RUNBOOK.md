# WC2TB five-minute recovery runbook (Big Mac DexDiffusion)

Run these steps from the MacBook with `ssh westcat`, which reaches `bigmac@bigmac`.

- The commands are read-only unless a step says otherwise.
- Never use `kill`, `launchctl kickstart`, or `bin/dexdiffusion stop|restart` on Big Mac. The EngineHost worker is the only restart owner.
- Never change TCC, mounts, SMB, Tailscale, or model storage to "fix" a symptom.

## Minute 0–1: what is true right now?

```bash
ssh westcat 'cd ~/Image_Gen-wc2tb-20261120 && /opt/homebrew/bin/python3 scripts/wc2tb-release-doctor.py'
```

> Until the prevention branch is merged and deployed, run the doctor from a checkout of
> `codex/wc2tb-prevention-20261121`, for example
> `ssh westcat '/opt/homebrew/bin/python3 -' < scripts/wc2tb-release-doctor.py`.

Read the failing check IDs in the output. Each one maps to a step below.

| Symptom / failing check | Go to |
|---|---|
| no 31337 listener; Studio down | A |
| `wc2tb_access` BLOCKED (backend in internal fallback) | B |
| `node`, `dependencies`, `enginehost_worker` BLOCKED | C |
| `restart_authority` / `legacy_agent` / `process_ancestry` BLOCKED | D |
| `disk_reserve` BLOCKED, or jobs refused "Insufficient shared disk" | E |
| `macbook_ack` pending, images not reaching the MacBook | F |
| a code regression after a cutover | G |

## A. Backend down (this never stops a working backend)

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --ensure'
```

- `SERVICE_READY` means done.
- `SERVICE_PENDING` (exit 75) only means the 3-second loop expired. Rerun the doctor before doing anything else.
- `SERVICE_BLOCKED`: read the worker state.
  - `CIRCUIT_OPEN` means there were 4 crashes in 10 minutes. Check the logs first and fix the cause.
  - `PORT_HELD` means a foreign listener: identify it with `lsof -nP -iTCP:31337 -sTCP:LISTEN` and **do not kill it blindly**.

## B. WC2TB unreadable

- This is the designed behaviour: the runner selects the isolated internal fallback, and MacBook publication is suspended there.
- Shell EPERM on `/Volumes/wc2tb` is TCC attribution. It is **not** proof that the volume is unreadable.
- Only the backend's `storage.mode` counts as evidence.
- Restoring external mode needs the volume readable by the EngineHost lineage, followed by a gated owner restart (step G). Do not remount or change TCC from SSH.

## C. Runtime drift (Node, dependencies, EngineHost, worker)

- Stop here and do not restart: a restart would load the drifted runtime.
- Compare against the pins listed in `docs/WC2TB_PREVENTION.md`.
- Restore the exact file from its checksummed source only inside an owner-authorized window.

## D. More than one restart owner

- The legacy agent must be disabled and not loaded, and the supervision mode file must contain `production`.
- Re-enabling or bootstrapping `local.dexdiffusion.server` creates a second owner. Do not do it.
- Report the finding, and fix it only in an authorized window.

## E. Disk

- Admission needs 1280 + 256 × images MiB: 1536 MiB for one image, 5376 MiB for 16 or for unknown work.
- Free space by removing your own scratch files only.
- **Never** delete canonical images, historical job records, or publication staging that is still awaiting MacBook acknowledgement.

## F. MacBook delivery

On the MacBook:

```bash
~/Image_Gen/bin/dexdiffusion publication-sync
```

- This is a one-shot, lock-protected pull.
- Bytes are verified by SHA-256 before the acknowledgement is sent.
- Pending items stay on Big Mac until they are acknowledged.

## G. Restart or cutover to a revision (the gate is mandatory)

```bash
ssh westcat 'bash ~/Image_Gen-wc2tb-20261120/scripts/request-worker-backend.sh --restart --expect-revision <full sha>'
```

- **Result:** if the release gate refuses, the backend is left running (exit 78).
  - `BLOCKED` cannot be overridden.
  - `UNVERIFIED` can be overridden only with `--override-unverified "<20+ character reason>"`, after you verify the failing fact by hand. The override is logged.
- **Emergency rollback (owner-authorized window only):**
  - Use the package on branch `rollback/wc2tb-fallback-safe-v1-20261120` (`rollback-packages/wc2tb-emergency-internal-fallback-rollback-v1/`). Its runtime copy is at `~/Library/Application Support/DexDiffusion/wc2tb-fallback-rollback-v1/start-fallback-rollback.sh`, SHA-256 `03bb7a28…`.
  - The starter refuses while port 31337 has a listener.
  - **Known gap:** the worker's `backend-pause` operation is rehearsal-only, and the worker refuses it in `production` mode. So there is currently **no owner-sanctioned way to free 31337** for a production rollback while the worker supervises the backend.
  - A production rollback therefore needs a separately authorized maintenance window that changes supervision under its own written plan. Do not improvise one with `kill` or `launchctl`.
  - The starter was demonstrated on a disposable root on port 31357, **not** against production.
