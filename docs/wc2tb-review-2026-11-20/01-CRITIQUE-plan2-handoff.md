# Critique: "DexDiffusion / DEX//REACH Permanent WC2TB Access and Recovery Plan (Plan 2)"

**Document reviewed:** `~/Downloads/DEXDIFFUSION_WC2TB_PLAN2_FULL_HANDOFF_2026-11-20.md` (971 lines)
**Reviewed:** 2026-11-20
**Project identity checked:** `westkitty/Image_Gen`, `~/Image_Gen` on the MacBook, branch `main` @ `39534f2`, clean tree. Big Mac is `bigmac@bigmac`, reached over SSH alias `westcat`.
**Method:** I read the full dossier and the source files it cites (MacBook checkout, `39534f2`, the same revision Big Mac runs). I then ran **read-only** commands on Big Mac to test its central claims. Nothing was changed on either machine. No services, permissions, files, or Git state were touched.

---

## 1. Verdict

The dossier is careful about evidence and very good at forbidding dangerous shortcuts. As a diagnosis and an execution plan, though, it is **weak**:

1. It never uses the one read-only tool that answers its main open question (*which process does macOS deny, and why?*). That tool is the TCC unified log. I ran it in a few minutes, and it gave a concrete mechanism.
2. It misses the most likely root cause, even though the project's own source code names it: **macOS privacy (TCC) attribution is tied to ad-hoc-signed Homebrew binaries, and `brew upgrade`/cleanup deletes them from under running processes.** This also explains the user's main complaint, that permission fixes never last.
3. It misreads the live backend. The backend that reports `storage.mode=external` is **not a launchd service**. It is an orphaned `nohup` process (PPID 1). The recovery script that would restore it currently **cannot work**, because its probe runs in the same DEX//REACH context that now gets `EPERM`.
4. It ties a separate project (a second DEX//REACH node and a cross-node GPU admission ledger) to the storage repair, and requires it before the repair can count as "COMPLETE".
5. For what is probably a three-part fix, it proposes 10 stages, 22 acceptance scenarios, a 9-state recovery machine, and a possible media broker. The broker would have to touch about **47 non-test source files** that read state, runs, or media roots.

**What to keep:** the hard constraints (no SMB, network, mount, or model relocation), the proof vocabulary (`SOURCE_PASS` / `LIVE_PASS` / `NOT_RUN`), "never rebuild or re-sign EngineHost", the publication/ACK invariants, and the falsification mindset.
**What to change:** run the diagnosis first with the right instrument, put the Homebrew-churn hypothesis first, fix the definite fallback bug now, split out the second node, and shrink the plan to match the size of the actual cause.

---

## 2. New evidence gathered during this review (read-only, Big Mac, 2026-11-20 ~11:10 local)

| # | Check | Result | Why it matters |
|---|---|---|---|
| E1 | `ps -o pid,ppid` for the backend PID 77247 | `77247 PPID 1 /opt/homebrew/bin/node server.js`, started **Sat Nov 14 22:34** | The backend has no supervisor. |
| E2 | `launchctl print gui/503/local.dexdiffusion.server` | **"Could not find service"** (not loaded). `print-disabled` shows it **enabled**. The plist is still in `~/Library/LaunchAgents`, next to `local.dexdiffusion.server.plist.disabled-tcc-20261102` | Today there is no KeepAlive. At the **next login or reboot**, launchd will load the agent and probe from a launchd context. That probe failed on Nov 2, so the backend would most likely come up in `internal-fallback`. |
| E3 | `lsof -p 77247` txt | executing `/opt/homebrew/Cellar/node/26.13.1/bin/node` | |
| E4 | `ls /opt/homebrew/Cellar/node/` | only `26.13.1_2` (installed **Nov 16 07:34**). `26.13.1` **no longer exists** | The running backend's executable was deleted by a Homebrew upgrade/cleanup. |
| E5 | DEX//REACH node PID 77284 (`com.stinkyweasel.dex-reach.node`, started Nov 12) | executing `/opt/homebrew/Cellar/node/26.13.0_2/bin/node`, **also deleted** | The DEX//REACH shell's parent ("responsible process") has a deleted binary. This is the context the dossier sees failing with `EPERM`. |
| E6 | `codesign -dv` of Homebrew `node` and of EngineHost | **both `Signature=adhoc`, no TeamIdentifier** | TCC can only identify ad-hoc binaries by their exact code hash (cdhash). Every Homebrew upgrade produces a new identity. EngineHost is stable only because nobody rebuilds it. |
| E7 | SSH probe plus `log show … process == "tccd"` | `ls …/state: Operation not permitted`. tccd logged `service="kTCCServiceSystemPolicyRemovableVolumes"`, **"Failed to fetch responsible file descriptor: [2: No such file or directory]"**, **"failed to construct a process for the responsible audit token"**, `auth_error_code=5` | This is TCC's **Removable Volumes** service denying the read because it **cannot build an attribution chain to the responsible process**. It is not ACLs, not SMB, and not a dead drive. Note: SSH to Big Mac is **Tailscale SSH**; the shell's parent is `tailscaled be-child ssh-monitor`. |
| E8 | `ls -le` on `state`, `runs` | the `+` is `group:admin inherited allow …`, an **allow** ACL | ACLs are ruled out as the denier. An ACL denial would also return `EACCES`, not `EPERM`. |
| E9 | `curl 127.0.0.1:31337/api/world/projects`, `/api/jobs` | HTTP 200 with real world-project data | The orphan backend still appears to read wc2tb state. This may be an in-process cache; **not proven**. |
| E10 | EngineHost PID 683 (`local.dexdiffusion.engine-worker`, KeepAlive + RunAtLoad), since the **Nov 9 21:42 boot** | running; the deployed `engine-worker.py` is byte-identical to the repo (last changed Nov 5) | A **launchd-launched, stable app bundle** kept wc2tb access through a reboot. This is the existence proof for a lasting identity. |
| E11 | `sdcpp-workflow/worker/engine-worker.py:46-47` (source) | *"A Homebrew cleanup can delete the Cellar directory a running process executes from; macOS TCC then cannot attribute it and removable-volume reads fail."* | The project already knows this mechanism and protects against it **only in the worker**. The backend (`node`) and the DEX//REACH agent (`node`) have no such protection. |
| E12 | `grep` of non-test source referencing `STATE_DIR / stateDir / RUNS_DIR / runsDir / mediaRoots` | **47 files** (server.js, voice-routes, world-bridge, asset3d-bridge, library-index, roughly 30 sdcpp-workflow scripts, …) | Rough size of a "broker every direct external read" approach. |

E9 is only partly consistent with E4. Why the orphan backend can still read while DEX shells cannot is **UNKNOWN**; tccd may cache a decision per process. Capturing tccd logs during a guaranteed fresh read by the backend would settle it (see the improved plan, Stage 1).

---

## 3. Critiques, ranked by severity

### C1 — CRITICAL: the decisive diagnostic tool is never used

The dossier says many times that the mechanism is "not proven", "TCC is credible", "avoid labeling it exclusively a TCC failure". Its proposed test (H1) is a long multi-process probe campaign.

macOS logs every TCC decision. `log show --predicate 'process == "tccd"' --info --debug` around a single failing `ls` names the TCC **service**, the **responsible process**, the **accessing binary**, and the **reason**. This is read-only, safe, and takes seconds. E7 shows it working. Without it, the plan keeps H1–H6 open long after they could have been resolved, and Stages 1–2 turn into open-ended investigation.

**Fix:** make "capture tccd attribution for each failing context" the first action in Stage 1, and drive the rest of the plan from its output.

### C2 — CRITICAL: the leading root cause is not stated

The dossier's H3 limits Homebrew churn to "the worker's Python interpreter". The evidence points to a broader mechanism:

- TCC grants for **ad-hoc-signed** binaries are tied to the exact code hash (cdhash), or at least to a binary that still exists on disk (E6, E7, E11).
- Big Mac sees frequent Homebrew activity. The Cellar shows new installs on Nov 16, 18 (×6) and 19. A `brew install` of anything can upgrade shared dependencies such as `node`, and by default it **cleans up** the old Cellar directory.
- Once that happens, every long-running Homebrew-`node` process (the backend, the DEX//REACH agent) runs from a deleted file (E4, E5). New child processes, for example DEX//REACH shells, fail attribution and get `EPERM`. After a restart, the new `node` has a different cdhash than the one the user granted.
- That explains **"permission fixes help briefly, then regress"** without any user setting changing. Each grant attaches to a Homebrew binary that a later upgrade replaces.
- The one component that kept access across reboots and weeks is EngineHost: a launchd-launched app bundle that nobody rebuilds (E10).

The dossier comes close (it discusses "process identity", "interpreter path churn", "re-signing EngineHost changes TCC attribution"). It never puts these together into a single cause, so it never proposes the cheapest fix: **stop deleting binaries from under running processes, and anchor the backend's TCC identity on something stable.**

**Fix:** promote "H0: TCC attribution to churned ad-hoc Homebrew binaries" to the top hypothesis, with a direct test: tccd log plus `lsof` txt path versus Cellar contents. That takes minutes.

### C3 — HIGH: the backend's live state is misread, and the recovery path is broken today

The dossier treats `GET /api/version → storage.mode=external, startedAt Nov 15 05:34Z` as "a startup snapshot" of a service. It missed:

- PID 77247 is **not supervised by launchd** (E1, E2). It was started by `scripts/recover-backend-authorized.sh` (`nohup … /bin/bash run-backend-service.sh &`) from a DEX//REACH session. If it crashes, **nothing restarts it**.
- That same recovery script decides whether it may restore external mode with `probe_external` (`recover-backend-authorized.sh:34-40`), and the probe runs in the DEX//REACH shell. That shell now gets `EPERM` (dossier §5.3, and E5). So `--restore-external` will **exit 14** and `--ensure` will not get past the probe either. **Today, the existing automation cannot bring the backend back into external mode after any crash or restart.**
- At the next reboot or login, the enabled-but-unloaded LaunchAgent (E2) will start the backend from a launchd context. The `…disabled-tcc-20261102` artifact suggests that context was denied before, so the most likely result is `internal-fallback` with the bridge forced off (C5). In effect, **reboot is a predictable failure**, not merely an untested one.

The dossier lists "installed-service checks" and "reboot proof" as future acceptance items. It does not notice that the backend has no installed service, or that reboot behavior can already be predicted from source.

### C4 — HIGH: "Node cannot read wc2tb" mixes up the evidence

The `EPERM` evidence in the dossier comes from **DEX//REACH shells and SSH**, not from the backend Node process. The backend currently reads external state (E9). The useful distinction is **which responsible process (TCC attribution root) a process descends from**, not "Node versus the native worker". Under that view:

| Context | Responsible root | wc2tb |
|---|---|---|
| Engine worker + inference children | EngineHost.app (stable, ad-hoc, launchd) | works |
| Big Mac Terminal (user grant 2026-11-05) | Terminal.app (Apple-signed) | works |
| Orphan backend 77247 | spawned via DEX//REACH session on Nov 14 | works now (cache?) |
| DEX//REACH shell | DEX node 77284, deleted Homebrew node | **EPERM** |
| SSH (Tailscale SSH) | `tailscaled be-child`, short-lived or unattributable | **EPERM** |
| Backend via LaunchAgent at login | Homebrew `node` via script | **probably EPERM** (Nov 2) |

Plan 2's core idea ("Node should not need wc2tb") follows from the mixed-up framing. A more accurate framing is that the backend needs a **stable responsible root**. That opens a cheaper option the dossier never considers (C7).

### C5 — HIGH: a definite, small bug is buried under ten stages

`scripts/run-backend-service.sh:61` sets `DEX_LOCAL_ENGINE_BRIDGE=0` in fallback, with the comment *"Use the existing direct MFLUX/SDCPP routes until external storage is restored"*. In fallback, the backend by definition **cannot read wc2tb**, and the models live only on wc2tb, so those direct routes **cannot work**. Fallback disables the one generation path that could work (the worker reaches the models through EngineHost, and `local-engine-client.js` talks to it over `~/.dexdiffusion-engine/engine.sock` without touching wc2tb).

Also, `DEX_LOCAL_ENGINE_BRIDGE=1` is **necessary but not sufficient**. `local-engine-routing.js:6-11` still needs `local-engine-bridge.json` with `enabled:true`, read from the state directory, which in fallback resolves through the `sdcpp-workflow/state` symlink to wc2tb. Even if line 61 were removed, the bridge would stay off.

The dossier finds both problems (H2) and then holds the fix until Stage 3, behind Stage 0–2 gates. It also cites an isolated patch that already addresses `local-engine-routing.js`. The fix is a few lines and the decision logic is fully testable. It should go first, gated only on Gate 1's live generation proof.

### C6 — HIGH: unrelated scope is coupled to the repair

The dossier itself says a second DEX//REACH node is **not** a storage fix (H6). Yet `COMPLETE` (§11.4) requires the `dexdiffusion` node, and Stage 8 adds a **shared physical-machine admission ledger across two node identities**. That is a new piece of distributed-coordination design (leases, recovery, double-admission tests) with its own risks.

Coupling them means the storage fix cannot be called done until a separate project is done, and the extra risk lands on the same change window. It also invites a mistaken assumption that a new LaunchAgent label changes privacy attribution. It does, but usually for the worse: a new `node`-based LaunchAgent will be ad-hoc Homebrew `node` with no grant.

**Fix:** split it into a separate plan with its own acceptance criteria. Storage `COMPLETE` should not depend on it.

### C7 — MEDIUM-HIGH: Plan 1 is a straw man; its strongest forms are missing

"Plan 1: stabilize identities" is described vaguely and judged by whether direct reads "remain unreliable". Two concrete, constraint-compliant options are missing:

- **P1-a: stop the churn.** Set `HOMEBREW_NO_INSTALL_CLEANUP=1` for the `bigmac` user, and/or `brew pin node python@3.15`. Then add a post-upgrade check that flags any DexDiffusion or DEX//REACH process whose txt path no longer exists, and restarts it **only when idle**. The worker already does this for itself. This changes no SMB, network, mount, TCC, or model settings. It is a reversible Homebrew preference. (Pinning `tailscale` is deliberately excluded, because Tailscale is a locked area.)
- **P1-b: borrow EngineHost's stable identity without touching its binary.** TCC attributes to the **responsible** process. Anything the worker spawns inherits EngineHost as its responsible root. `engine-worker.py` is an unsigned script and is **not** part of EngineHost's code identity (E10 is consistent with this but does not prove it; verify). An **opt-in, narrowly scoped "supervise backend" mode in the worker** could launch `run-backend-service.sh`, so the backend gets the same lasting access, including at boot, through the already-KeepAlive'd EngineHost agent. There is no new binary, no re-signing, and no consent prompt. Trade-offs: the backend's lifetime becomes tied to EngineHost (an EngineHost restart means a backend restart); the worker becomes a supervisor; and the whole HTTP backend gets wc2tb access. That last point is **the existing intended design**, not an expansion.

Either option may make most of Plan 2's broker and ledger work unnecessary.

### C8 — MEDIUM: Plan 2's broker would be much larger than it looks

§8.5 and Stage 6 treat "mediate only demonstrably failing external media operations" as a small addition. In practice, 47 non-test files reference state, runs, or media roots (E12), including about 30 `sdcpp-workflow/bin/*.sh` scripts spawned by the backend. Under Plan 2, every one of those child processes would also lose wc2tb access, not just the HTTP routes. The real Plan 2 surface is "every backend-spawned workflow script plus every media route". The dossier's own warning about broker growth is an understatement.

### C9 — MEDIUM: the recovery state machine duplicates an existing controller

The MacBook already runs `local.dexdiffusion.recovery` (`scripts/dexdiffusion-recovery-controller.py`), with states such as HEALTHY, BLOCKED and CIRCUIT_OPEN, a latched circuit breaker with manual retry, and journal output (`recovery/controller.jsonl`). The dossier proposes a new 9-state machine without mentioning it. Two recovery authorities for one backend is the double-owner hazard the dossier warns about elsewhere.

**Fix:** extend the existing controller with the new fault classes (`AUTHORIZATION_REQUIRED`, `STORAGE_UNREADABLE`, `STALE_BINARY`) instead of inventing a parallel one.

### C10 — MEDIUM: constraint tension is not surfaced to the user

"No TCC changes, ever" combined with "use only access presently granted" leaves exactly one lasting identity: EngineHost. That is workable (P1-b, Plan 2). But the user should be told plainly that **grants to ad-hoc Homebrew binaries can never last**, so any past grant to `node`/`bash`/Terminal-launched processes was never going to survive upgrades. Also, EngineHost is itself ad-hoc: if it ever has to be rebuilt, access **will** be lost and **one** consent will be needed. The plan should keep a documented "EngineHost identity lost" runbook rather than treat the binary as permanent.

### C11 — MEDIUM: usability for the executor

- 971 lines, with heavy repetition of the same caveats. The operative decision tree is spread across §7, §9, §13, §14 and §15.
- Two overlapping status vocabularies (§11.1 `SOURCE_PASS…UNKNOWN` and §11.4 `SAFE_TO_IMPLEMENT…COMPLETE`).
- It cites inputs the executor cannot access: "`Pasted text.txt` in this conversation", "`pasted.txt` in this conversation", the "418-line brief". A future session will not have them.
- Unsourced numbers ("19/19 registered model paths") with no artifact path.
- No time-boxes or cost estimates for any stage, although it warns against "arbitrary loops".

### C12 — LOW: smaller technical gaps

- `DEX_IMAGE_VALIDATION_PYTHON` and the MFLUX venv live under `~/Library/Caches/DexDiffusion/…`. Caches can be purged by macOS or cleanup tools, and venvs built on Homebrew Python break when it is cleaned up. This is a runtime-durability risk the plan does not mention.
- `local-engine-client.js:10` hard-codes `/opt/homebrew/bin/python3` for the IPC client. The client needs no wc2tb access, but it does depend on Homebrew Python still existing.
- `local-engine-client.js` falls back to `ssh westcat … engine-worker.py client` when the socket is missing. On Big Mac that is Tailscale SSH to itself, which is unattributable for TCC (E7). It does not matter for IPC (no wc2tb read), but it is a confusing path that should be removed or documented for the Big Mac host.
- The run-backend probe uses `/opt/homebrew/bin/gtimeout`. If Homebrew `coreutils` is removed or churned, the backend refuses to start (exit 4). This is acceptable, but should be listed as a dependency.
- §5.3 uses `startedAt` as evidence of service health. It is actually the spawn time of the orphan.

---

## 4. What the dossier does well (keep these)

- The hard constraints and the "forbidden substitution" table (§3.1).
- Separating `mounted`, `listed`, `content-readable`, `model-health`, and `real generation` as different levels of proof.
- "Do not rebuild or re-sign EngineHost" (correct, and more important than the dossier realizes, because EngineHost is ad-hoc).
- The publication/ACK invariants (§10 "additional invariants").
- Explicit approval gates for every production mutation (§3.3).
- The worker-broker security invariants (§8.6). These are good if a broker ever turns out to be necessary.
- Its willingness to be falsified (§13).

---

## 5. Summary of recommended changes

| # | Change |
|---|---|
| R1 | Make **tccd log attribution** the first diagnostic. Classify every context by its responsible root. |
| R2 | Put **"TCC attribution to churned ad-hoc Homebrew binaries"** first as H0, with a minutes-long test. |
| R3 | Record that the **backend is an unsupervised orphan** and that the **recovery script is currently ineffective**. Treat this as the top live risk. |
| R4 | Fix the **fallback bridge bug** (line 61 plus legacy-state gating) as the first code change, after Gate 1. |
| R5 | Add **P1-a (stop the churn)** and **P1-b (backend supervised under EngineHost's responsible root)** as real alternatives. Choose by evidence before considering any broker or ledger. |
| R6 | **Split out the `dexdiffusion` second node** and the cross-node admission ledger into their own plan. |
| R7 | **Extend the existing recovery controller**; do not add a second state machine. |
| R8 | Tell the user plainly about the durability limits of ad-hoc grants, and add an EngineHost-identity-loss runbook. |
| R9 | Cut the executor document to an operative decision tree plus appendices. One status vocabulary. No references to unavailable pasted files. |

---

## 6. Errata after owner review (2026-11-20, rev 2)

These corrections supersede the statements above where they conflict. The plan rev 2 is built on the corrected versions.

| Ref | Original claim | Correction |
|---|---|---|
| C2, R2 | Deleted ad-hoc Homebrew binaries are "the" root cause | **H0 is the leading hypothesis, not a confirmed universal cause.** E7 proves an attribution failure only for the Tailscale SSH context. DEX//REACH, backend, worker and launchd contexts each need their own tccd capture. Four failure classes stay separate: stale executable, changed signing identity, missing/denied grant, unresolvable responsible chain. |
| C10 | "Grants to ad-hoc Homebrew binaries can never last" | Too absolute. Persistence depends on the identity and authorization context staying usable. EngineHost (also ad-hoc) shows that a stable deployment persists. |
| C5 | Fallback "cannot generate by construction" | **Overstated.** Fallback exposes three targets whose weights are internal-SSD exceptions (`flux2-klein-4b` in `~/Library/Caches/DexDiffusion/mflux`; `sdxl-photonic` and `flux-fp8` in `~/sdcpp-staging/models`) and rejects LoRA/VAE/ControlNet (`server.js:82, 3692`). It cannot use **wc2tb** models. Fallback also changes job state, restricts `/api/actions` (`server.js:94`), disables chat, and **keeps publication enabled** through `crossHostPublicationEnabled` (default `127.0.0.1:31338`, `server.js:115-123`), even though `DEX_MACBOOK_IMAGES_URL` is unset. |
| C7 P1-a | Set `HOMEBREW_NO_INSTALL_CLEANUP=1` | **Withdrawn.** Big Mac has about 12 GiB free (95% used). Use selective `HOMEBREW_NO_CLEANUP_FORMULAE` plus controlled upgrade windows. Pinning is evaluated separately. Retention does not authorize replacement executables. |
| C7 P1-b | Option A is a cheap, constraint-compliant fix | **Unproven.** Inheritance through `EngineHost → worker → bash → node → workflow child` must be shown by tccd attribution, including across restarts, login and binary replacement. Option A also widens the effective access surface from the worker's closed protocol to the whole backend (including write access to model folders). That is a security trade-off that needs owner sign-off, and it adds a recovery executor that must be made the *sole* one. |
| — (missed) | — | **Publication crash window.** `local-engine-generate.js` ACKs the worker (which unlinks `output*.png`, `engine-worker.py:404-410`) *before* `publishFiles`, and its `finally` block deletes the transfer staging directory **on any error**. A crash or a thrown publish after ACK can lose the only copy. Nothing reconciles `dex-engine-transfer-*`. This is a blocking gate in plan rev 2 (Gate C). |
| — (missed) | — | The isolated worktrees `Image_Gen-dexdiffusion-20261120` (base `39534f2` = current main) and `DEX-REACH-dexdiffusion-20261120` (base `555befc`) must be exported to patch bundles and preserved; **no rebase** (rev 1 said "rebased onto current main"). Original DEX-REACH also has protected WIP in `src/*`. |
| C6 | Split out the second node | Still split from storage closure, but it **remains a required deliverable** with its own acceptance contract (plan rev 2 §6). |
