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

---

## Claude Walk Pass UI/UX Audit (2026-06-20)

Performed against the live Operator Console (server on `127.0.0.1:31337`) with a real
runs corpus (68 runs, 5 image runs). UI/UX intelligence was sourced from the
`ui-ux-pro-max` skill (accessibility, reduced-motion, lazy-loading, no-emoji-icons
guidance). Visual QA was done via Playwright DOM/console inspection (pixel screenshots
stayed inside the MCP sandbox and were not retrievable; DOM-state assertions are
recorded below instead).

1. **Current visible UI verdict** — Strong. The redesign already delivers the
   dark navy three-zone console: grouped sidebar (Create / Library / Session /
   System), compact top status strip, split Generate workspace, image-first
   Gallery, technical Run History, opt-in privacy Settings, and a non-blocking
   bottom-right job drawer. This pass refined edges rather than rebuilding.
2. **Primary user goal** — Generate a verified SD 1.5 image from a private prompt.
3. **Primary action** — The full-width `Generate Image` primary button on the
   Generate page (dominant blue, 44px).
4. **Secondary actions** — Batch Explore, View Run Detail / Open in Gallery from
   the preview, Warm Server control, Verify / Seed Test diagnostics.
5. **Core hierarchy** — Sidebar nav → workspace tab → split controls/preview →
   inline metadata + actions. Status strip is always-visible context.
6. **Friction points found** — see severity list below.
7. **Reference-direction alignment** — Matches the intended native desktop console
   direction (rich navy/charcoal panels, 16px card radius, 40–44px controls,
   visible focus rings, image-first gallery). No heavy framework; vanilla only.

### Severity-ranked issues (this pass)

- **blocker — Prompt reconstructable from tokenizer debug.** `sd-cli -v` emits a
  BPE tokenizer line (`split prompt "…" to tokens ["a</w>","dog</w>",…]`) that
  reconstructs the prompt even after the literal string is redacted. The first
  live canary persisted these tokens to `remote-stdout.log`. → user impact: a
  redacted run still leaks the prompt to anyone reading the log. → fix: the
  in-stream redactor in `sdcpp-cli-generate.sh` now also neutralizes the token
  array to `to tokens [REDACTED]` before the line is written to disk (source-level,
  not a post-run scrub). Re-tested with a fresh canary: zero token fragments.
- **major — Batch preview had no grid container.** `.batch-grid` styled only
  `img`, so batch results stacked full-width. → user impact: unusable batch
  review. → fix: added a responsive `repeat(auto-fill, minmax(180px,1fr))` grid.
- **minor — Prompt search active while prompts redacted.** Run History exposed a
  prompt search box that can never match redacted records. → user impact: silent
  dead control, implies prompts are searchable/stored. → fix: the box is now
  disabled with placeholder "Disabled (prompt privacy on)" and an explanatory note
  whenever Save Prompts is OFF; it re-enables only when saving is ON.
- **minor — Check runs shown as amber "UNKNOWN".** Verify/server-status runs have
  no `ui-run-card` status and rendered with the amber PARTIAL badge. → user impact:
  reads like a half-failure. → fix: a neutral `badge-log` style for non-PASS/FAIL/
  PARTIAL states. No literal "undefined" appears anywhere (verified in DOM).
- **polish — Emoji used as dashboard icons / missing reduced-motion / eager
  images / favicon 404 / stray `REVENUE` CSS comment.** → fixes: replaced the four
  dashboard emoji with inline stroke SVG icons; added a `prefers-reduced-motion`
  block that disables transitions/transforms; added `loading="lazy"` to gallery
  thumbnails; added an inline SVG favicon (console now error-free); renamed the
  stray comment.

### DOM-verified outcomes
- Run History search: `disabled=true`, placeholder "Disabled (prompt privacy on)",
  note present; 0 occurrences of "undefined"; check runs use `badge-log`.
- Gallery: 5 cards, all `loading="lazy"`, all thumbnails decoded (naturalWidth
  512/384 — no broken images), all prompts "Prompt redacted", no verify runs.
- Settings: Save Prompts OFF, Auto-open OFF, privacy warning visible.
- Dashboard: 4 inline-SVG icons; page console error-free after favicon fix.

### Remaining open issues (not addressed this pass)
- `/api/runs` reports check-run status as `UNKNOWN` because verify/status runs do
  not emit a `ui-run-card.md`. The UI now renders this neutrally, but a backend
  status surfaced from `verify-report.md` would be cleaner (out of scope; backend
  contract change).
- The remote BigMac-side log (`$REMOTE_LOG`, written by `tee` on the host under
  `/Users/bigmac/...`) still contains verbose output; it is never copied to the
  MacBook and is out of scope for local-repo privacy, but worth noting.
