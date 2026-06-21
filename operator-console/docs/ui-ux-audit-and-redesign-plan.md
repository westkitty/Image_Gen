# UI/UX Audit and Redesign Plan

## 1. Current Visible UI Verdict
The current Operator Console UI functions correctly in terms of API communication, but it looks like a generic admin panel rather than a polished local image generation workstation. The sidebar nav groups are flat, the main workspace lacks structured zones, the controls for generation are hidden or underspecified, and prompt privacy is nonexistent.

## 2. Mockup/Reference Direction Summary
To align with a native-feeling macOS dark theme desktop console:
- **Aesthetic:** High-tech, dark navy/charcoal styling with subtle border lines, glassmorphism hints, and bright blue/green status chips.
- **Layout:** Three distinct zones: Sidebar (fixed width, grouped nav), Top Strip (status info), and Main Workspace.
- **Generate Screen:** A dedicated, robust split-pane layout: a left column for controls and settings (390px–440px wide) and a right column for the preview panel and immediate run metadata/actions.
- **Privacy:** Prompts must be ephemeral by default and not stored on disk or in the browser local storage without explicit opt-in.

## 3. Severity-Ranked Problems

### Blocker
- **Issue:** No Prompt Privacy by default -> **User Impact:** User prompts are written to markdown run files and logs, compromising privacy. -> **Concrete Fix:** Default prompt saving to OFF. Redact prompts from metadata, reports, manifests, and logs by setting `SDCPP_REDACT_PROMPTS=1` and replacing prompt/negative prompt values with `[REDACTED]` in run folder outputs.
- **Issue:** Generate Single jumps to Run Detail after completion -> **User Impact:** Auto-navigation interrupts generation workflow and forces user to switch tabs to continue. -> **Concrete Fix:** Remain on the Generate page after completion, show the output image in the preview pane, and show "View Run Detail" or "Open in Gallery" buttons.

### Major
- **Issue:** Flat, primitive navigation sidebar -> **User Impact:** Hard to navigate, items are clustered without clear intent. -> **Concrete Fix:** Reorganize sidebar into CREATE, LIBRARY, SESSION, and SYSTEM navigation groups with a minimum sidebar width of 240px.
- **Issue:** No dedicated Gallery view -> **User Impact:** Finding generated images requires digging through a technical log list. -> **Concrete Fix:** Add a dedicated "Gallery" tab showing a grid of image thumbnails with prompt and generation metadata.
- **Issue:** Lack of advanced generation controls -> **User Impact:** Cannot configure steps, sampler, seed, width, height, or CFG scale. -> **Concrete Fix:** Add inputs for steps, cfg, sampler, scheduler, width, height, model, and seed to the Generate screen.

### Minor
- **Issue:** "Prompt: undefined" or "Status: undefined" in run lists -> **User Impact:** Looks buggy and incomplete. -> **Concrete Fix:** Ensure all parsed metadata keys fallback to readable text (like "Prompt redacted" or "n/a") instead of returning JS `undefined`.
- **Issue:** Presets override manual customization or hide controls -> **User Impact:** Frustrating if custom steps are hidden or reset when switching models/presets. -> **Concrete Fix:** Keep all inputs visible; changing a preset updates the inputs, and modifying inputs updates preset to "Custom".

### Polish
- **Issue:** Generic input boxes and buttons -> **User Impact:** Feels like a cheap web form. -> **Concrete Fix:** Implement 14px–18px border-radius, clean focus states with outline offsets, and consistent 40px input/button heights.

---

## 4. Exact Visual Changes Required
- Use CSS variables for background colors (`#071018`, `#0b1520`, `#101b27`, `#132130`, `#172838`, `#0d1823`).
- Set sidebar border-right and panel border-bottom to `var(--border-subtle)`.
- Use Outfit/Inter sans-serif fonts for UI, and ui-monospace for technical labels, paths, and metadata.
- Focus rings: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`.

## 5. Exact Layout Changes Required
- **App Shell:** Flex layout. Sidebar `width: 240px; flex-shrink: 0;`. Main workspace `flex: 1; min-width: 0; overflow-y: auto;`.
- **Generate Screen:** Split flex/grid. Left panel `flex: 0 0 420px;` containing the forms. Right panel `flex: 1;` containing preview container (`object-fit: contain` for images) and metadata dashboard.

## 6. Exact Component Changes Required
- **Sidebar Nav:** Group items under uppercase headings (e.g. `CREATE`, `LIBRARY`).
- **Preview Panel:** Large centered box, dark background, empty state text: "No verified image yet. Generate a fast SD 1.5 image and it will appear here."
- **Job Drawer:** Fixed toast style in bottom-right corner. It should not block interaction with the rest of the page.

## 7. Exact Generation-Control Changes Required
- **Model:** Read-only dropdown displaying the current SD 1.5 model. Helper text: "Only staged model available. SDXL/Flux not enabled."
- **Width/Height:** Select dropdown with options `384` and `512` only.
- **CFG Scale:** Range input or number input with step 0.5 (range 1.0–20.0).
- **Steps:** Number input (range 1–40).
- **Sampler:** Dropdown containing `euler_a`.
- **Scheduler:** Disabled dropdown containing `discrete` (labeled "fixed/API-only").

## 8. Prompt Privacy Risks and Mitigation
- **Risk:** Prompt text saved in `ui-run-card.md`, `cli-run-report.md`, `server-generate-report.md`, `batch-report.md`, `metrics.tsv`, `run-metadata.json`, and manifests.
- **Mitigation:**
  1. Add a global setting `savePrompts` (OFF by default) stored in localStorage.
  2. If `savePrompts` is false, Express sets environment variable `SDCPP_REDACT_PROMPTS=1` for all child processes.
  3. Modify backend scripts (`sdcpp-cli-generate.sh`, `sdcpp-server-generate.sh`, `sdcpp-batch-generate.sh`) to write `[REDACTED]` instead of `$ARG_PROMPT` or `$ARG_NEG` to all report files if `SDCPP_REDACT_PROMPTS=1`.
  4. Use real-time python stream filters to sanitize prompts on-the-fly from stdout/stderr and network response streams before writing them to disk.

## 9. Run History/Gallery Behavior Corrections
- **Gallery Tab:** Shows a grid of card-based thumbnails for image runs only. Omit non-image actions like `verify` and `server-status`.
- **Run History Tab:** Technical table/list displaying all runs including checks. Hides prompt column/text for redacted runs.
- **Legacy Runs:** If a run has prompt text stored, display: `Legacy run may contain stored prompt text.`

## 10. Acceptance Criteria for This Pass
- Pre-work checkpoint was completed cleanly.
- Ephemeral prompt behavior is active by default.
- UI allows fine-tuning steps, cfg, sampler, dimensions, mode, and seed.
- Generation does not jump tabs; image is rendered in right-side pane with action buttons.
- Gallery and Run History are separate views.
- Aesthetic tokens, Outfit-like font, clean dark panels, and focus states are active.
- Verification script passes successfully.
