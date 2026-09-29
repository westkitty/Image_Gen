# DexDiffusion Extra Networks & Wildcards

## Extra Networks Architecture

DexDiffusion provides an integrated Extra Networks manager for LoRAs, Textual Inversion Embeddings, and VAEs.

### LoRA Management
- **Catalog & Discovery**: Discovered from `/Users/bigmac/sdcpp-staging/models/` and mounted storage pools.
- **Family Compatibility Badges**:
  - Each LoRA is mapped to its underlying family (`SD 1.5`, `SDXL`, `Pony`, `FLUX`).
  - Active target compatibility is visually verified via status badges (`Compatible`, `Cross-Compatible`, or `Incompatible`).
- **Prompt Token Insertion**:
  - Inserts standard tokens: `<lora:name:weight>`.
  - Configurable weight slider (0.1 to 1.5, default 0.8) with step increments.
  - Trigger words display with one-click insertion into the positive prompt.
- **Active Resource Chips**:
  - Rendered dynamically below the prompt area in the Create Workbench.
  - Live weight steppers (`-`, `+`) and single-click remove buttons (`×`).
  - Synced bidirectionally with the prompt textarea.

### Honest Embeddings State
- If no Textual Inversion `.pt` / `.bin` / `.safetensors` embedding files exist locally on Big Mac, DexDiffusion displays an explicit, honest empty state with installation instructions rather than phantom or mocked entries.

### VAE Selector
- Exposes discovered VAE checkpoints (`sdxl_vae.safetensors`, `vae-ft-mse-840000-ema-pruned.safetensors`).
- Automatically filters to models compatible with the active target family.

## Wildcards System

### He-Maker Banks
DexDiffusion vendors 15 high-quality wildcard banks ported directly from the upstream `westkitty/He-Maker` repository:
- `ActionsWildcard`
- `ActivitiesWildcard`
- `BewareTheFey`
- `CasualPosesForMen`
- `ColorPalettes`
- `CreaturesWildcard`
- `EmotionsAndExpressions`
- `HandPosesForMen`
- `IntenseFightsWildcard`
- `NorseMythology`
- `Ragnarok`
- `ScenesFromTheOdyssey`
- `SimpleActions`
- `SittingOnA`
- `TouchOfDivine`

### Provenance Tracking
- Every bank carries complete provenance metadata in `operator-console/wildcards/HE_MAKER_PROVENANCE.json`, recording:
  - Source repository: `westkitty/He-Maker`
  - Upstream commit: `5904d101e1a4a64f0cf477328bd97edfc65d581b`
  - Canonical SHA-256 checksum for immutable verification.

### Generation-Time Expansion
- Syntax: `__bank_name__` (case-insensitive).
- Expanding occurs at runtime before submission to the generation engine:
  - Preserves unrecognized wildcard tokens literally.
  - Recursion limit guard (`maxDepth: 5`) to prevent circular macro expansion loops.
  - Live autocomplete dropdown in the prompt input triggered by `__`.
