# DexDiffusion data-root configuration

`DEX_DATA_ROOT` is an opt-in root for a staged host migration. It does not move existing data, change the installed client, start a server, or make the selected volume canonical by itself.

With `DEX_DATA_ROOT=/path/to/DexDiffusion`, the server and its workflow children use:

| Data | Root |
| --- | --- |
| Generated images | `images/` |
| Metadata, settings, library index, project records, job history, and registries | `state/` |
| Workflow runs and their manifests | `runs/` |
| Voice, music, video, and world artifacts | `audio/voice/`, `audio/music/`, `video/`, and `worlds/` |
| Prepared uploads, masks, and large temporary intermediates | `scratch/` (`mask-uploads/` for source images and masks) |
| Workflow logs | `logs/` |

Workflow executables and their configuration remain in `sdcpp-workflow/` (or the explicit `DEX_WORKFLOW_ROOT`). The data root never relocates the code it needs to execute.

For an external volume, set `DEX_DATA_ROOT_MOUNT` to its mount point as well. Startup checks that the data root is inside that path and that the path is a mounted filesystem; if the volume is absent, startup fails before creating the application roots. Example for Big Mac:

```sh
DEX_DATA_ROOT=/Volumes/wc2tb/DexDiffusion
DEX_DATA_ROOT_MOUNT=/Volumes/wc2tb
```

The existing explicit overrides remain available and take precedence for their category: `DEX_IMAGES_ROOT_OVERRIDE`, `DEX_MEDIA_ROOT_OVERRIDE`, `DEX_STATE_DIR`, `DEX_RUNS_DIR`, `DEX_LOGS_DIR`, `DEX_SCRATCH_ROOT`, and `DEX_MASK_UPLOADS_DIR`. Unless an explicit `TMPDIR` is already set, workflow child processes use the configured scratch root for local temporary files. Existing per-category overrides should be recorded in the service configuration; changing an environment value does not migrate or reconcile data.

When `DEX_DATA_ROOT` is unset, the canonical image root remains `/Users/andrew/images_made`, the server retains its existing workflow `runs/` and `state/` roots, and media retains its existing roots. Workflow children keep resolving paths from their existing `sdcpp.env` unless a corresponding explicit override is present.

Image exports are encoded and streamed to the requesting client; the server does not currently retain a second export copy. The browser's download destination is client-controlled. Test output is owned by each test invocation (`TMPDIR`/release-preflight scratch), not by the durable application root.

For release checks, `TMPDIR` controls the release-preflight log directory and its per-step scratch directories. Point it at an already-created task-owned directory on the selected test volume; the preflight still measures and enforces its free-space reserve.

This configuration is only the source-side staging mechanism. Before using an external root for production, separately inventory and hash source data, copy and verify it without deleting the original, test the mounted-volume guard under the real service account, start an isolated server, verify read/write paths and rollback, and validate the actual client. No production cutover is implied by this document or by the path resolver.
