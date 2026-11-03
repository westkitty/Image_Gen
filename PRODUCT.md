# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary User:** Local creative operator, AI technical artist, and generative media specialist.
- **Situation:** Designing, generating, and curating multi-modal creative assets (images, audio, multi-speaker drama, music, 3D meshes, world splats) on personal workstation hardware without cloud subscription dependencies or data telemetry.
- **Job:** Prompt engineering, parameter optimization, rapid model iteration, batch generation, image-to-image editing/inpainting, voice design, multi-track audio direction, and 3D asset inspection.

## Product Purpose

DexDiffusion exists as a sovereign, local-first professional creative workstation. It unifies local Apple Silicon compute (MFLUX / FLUX.2 Klein 4B) with dedicated LAN cluster compute (SSH to Big Mac `westcat` running stable-diffusion.cpp with Metal LoRAs) into one cohesive, tactile, dark-mode operator console. Success means the operator has complete end-to-end creative control, zero data leakage, deterministic reproducibility, truthful progress telemetry, and instant access to ongoing generation jobs across any device on their secure personal network.

## Positioning

DexDiffusion differs fundamentally from commercial SaaS image generators (Midjourney, Runway, Leonardo) and generic web UIs (standard A1111/ComfyUI forks):
- **Truthful Compute Integrity:** Unlike web wrappers that simulate progress or mask failures, DexDiffusion provides strict, in-band job lease tracking, real cancellation hooks, and honest capability gating (unavailable workers are explicitly labeled rather than faked).
- **Zero Cloud Exposure & Strict Privacy:** Prompt saving is controllable, outputs write to canonical local paths (`/Users/andrew/images_made`), and no user prompts or generated artifacts are transmitted to third-party cloud APIs.
- **Integrated Multi-Modal Workstation:** Bridges 2D image diffusion, multi-character drama scripting, voice design, music generation, 3D assets, and spatial world reconstruction inside a single unified shell.

## Operating Context

- **Host Environment:** MacBook Pro Apple Silicon hosting the primary Node.js server (`operator-console/server.js`) on loopback `127.0.0.1:31337`.
- **Network Routing:** Tailscale Serve (HTTPS :8443, tailnet-only authenticated access for personal laptop, tablet, and mobile browsers); separate DEX//REACH :443 service protected; no public listeners or cloud proxies.
- **Compute Cluster:** Big Mac compute node reached via internal SSH tunnel (`ssh westcat`) and dedicated local engine worker daemon socket.
- **Desktop Application:** Everyday native wrapper `/Applications/DexDiffusion.app` (macOS WebKit wrapper, bundle `local.image-gen.wrapper`, Launch Services registered, Dock item).
- **Storage:** Canonical output repository at `/Users/andrew/images_made`.

## Capabilities and Constraints

- **Image Generation Engines:**
  - Primary: FLUX.2 Klein 4B via MFLUX (local Apple Silicon).
  - Secondary: stable-diffusion.cpp (SD1.5, SDXL, LCM, Lightning, Metal LoRAs, and A1111 prompt syntax parsing via Big Mac).
- **Image Editing & Tools:**
  - Img2Img, inpainting, outpainting, SD upscale, prompt matrix, XYZ plot, attention editing, source resizing, and mask painting.
- **Sound & Drama:**
  - Voice designer with formant filtering and profile management.
  - Multi-speaker Drama production suite across 7 preserved stages: Script, Cast, Direct, Produce, Review, Master, Export.
  - Music generation (Magenta, ACE-Step).
- **3D & Spatial:**
  - Interactive 3D GLB mesh viewer with orbit controls.
  - World reconstruction viewer (PLY Gaussian Splats) with WASD first-person camera movement.
- **Truthful Capability Gating:**
  - Video and Swap are explicitly disabled with declared readiness notices; stems/mastering remain unpromised until backed by real compute.
- **[INFERRED] Intended Studio Workspace Redesign:**
  - 5 Colored Master Navigation Chips: Chat (Teal `#2DD4BF`), Image (Violet `#B197FC`), Audio (Amber `#F5B942`), Video (Coral `#FB7185`), 3D (Electric Sky Blue `#60A5FA`).
  - 4 Secondary Global Utilities: Library, Models, Jobs, System.
  - Contextual sub-navigation per master (e.g., Image: Create, Batch, Edit; Audio: Clips, Script, Long Form, Music, Voices).
  - Cross-workspace state preservation (switching tabs preserves unsaved prompts, selected models, LoRAs, and active jobs).
- **Technical & Security Boundaries:**
  - No Docker, no new TCP listeners, no public exposure.
  - MacBook controls and stores outputs; completed remote compute outputs are ephemeral.

## Brand Commitments

- **Name:** DexDiffusion / Dexter Studio.
- **Visual Identity:** Dark, professional, precise, tactile creative workstation. Deep charcoal (`#071018`, `#080c12`, `#0b0d11`) surfaces with subtle elevation, restrained borders, and vivid functional accent tints.
- **Mascot:** Dexter mascot graphic in brand header, empty states, and desktop app icon.
- **UX Tone:** High-density, scan-friendly, honest engineering chrome. No generic SaaS cards, decorative gradient noise, or fake animations.

## Evidence on Hand

- `OPERATIONAL_STATE.md`: Comprehensive running log of release gates, compute status, and verified parity.
- `docs/operations/pre-redesign-readiness-20261023.md`: Authoritative baseline documentation and limitation audit.
- `docs/operations/v2-functional-parity-20261022.md`: 53-row parity ledger with 51 verified pass rows.
- `docs/operations/v2-runtime-evidence-20261022.json`: Empirical runtime hashes for real Magenta, ACE-Step, GLB, and PLY executions.
- `operator-console/tests/`: 1,027 passing unit tests and 44 passing headless browser suites.

## Product Principles

1. **Truthful Compute & State Transparency:** Never fabricate progress percentages, simulate completions, or mask missing workers. If a backend is absent, gate it honestly.
2. **Local Data Sovereignty:** The user's prompts, models, audio scripts, and generated media remain strictly local and private under `/Users/andrew/images_made`.
3. **Non-Destructive Navigation:** Switching creative modes or tools must never wipe prompt drafts, reset parameter sliders, or interrupt background generation jobs.
4. **Ergonomic Density over Decorative Noise:** Maximize working canvas area for creative output; keep toolbars, inspectors, and status indicators compact, legible, and subordinate to the active art.
5. **Multi-Modal Symmetry:** Treat audio, drama, 3D, and video as first-class creative media rather than second-class add-ons to an image generator.

## Accessibility & Inclusion

- Keyboard navigability for all core workflows (tab order, visible focus rings, Cmd-K search, Escape handling on overlays and drawers).
- High-contrast text readability (target >= 7:1 contrast ratio against dark backgrounds).
- Semantic markup and ARIA live regions for background job status updates.
- Motion sensitivity: respect `prefers-reduced-motion` with functional state transitions instead of total feedback destruction.
- Responsive touch targets (minimum 44x44px) across mobile and tablet viewports down to 375px.
