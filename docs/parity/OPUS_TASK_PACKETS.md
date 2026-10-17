# Engine-level parity blockers — task packets (2026-10-16)

These rows cannot be closed by UI or wiring work: the installed engines (stable-diffusion.cpp `sd-cli` rev `7f0e728` on Big Mac, MFLUX for FLUX.2 Klein 4B) do not implement the behaviour. Each packet is a self-contained design task. **None is authorised for implementation yet**: each needs a user decision because it changes or adds an inference engine on Big Mac (rebuilding sd.cpp, patching it, or adding a PyTorch sampler runtime). Until then the rows stay BLOCKED, and the UI shows the controls as unavailable with the reason. The server rejects them with that reason too.

Shared constraints for every packet:
- Metal only. No Docker, no cloud inference.
- The FLUX.2 Klein 4B MFLUX runtime and its venv are protected.
- Canonical images live only in `/Users/andrew/images_made`. Remote outputs are ephemeral.
- Prompt-saving defaults to OFF, so no prompt text may appear in logs.
- Any engine change ships as a separately named binary or runtime next to the current `sd-cli`, never replacing it, and is selected per target by `capabilities.js` only after a live proof.

## OP-1A Stepwise conditioning: scheduled prompt edits and alternation (PR-11, PR-12)
- **Need:** A1111's `prompt_parser.get_learned_conditioning_prompt_schedules` produces a per-step conditioning schedule. `[a:b:when]` and `[a|b]` change the conditioning *inside* the sampling loop. `AND` composition is the separate OP-1B packet below.
- **Engine gap:** sd.cpp builds one conditioning per prompt for the whole run (its `parse_prompt_attention` handles weights and BREAK only).
- **Options:**
  - (a) Patch sd.cpp. Make the denoiser callback select the conditioning by step index (schedules). Contribute the patch upstream.
  - (b) A PyTorch k-diffusion sampler process on Big Mac (MPS) for SD1.5/SDXL only.
- **Recommendation:** (a). It keeps one engine, and the step loop is in `src/stable-diffusion.cpp::SD::sample`.
- **Proof needed:** the parser output must match `prompt_parser.py` on a corpus. A live A/B must show that `[red:blue:0.5]` differs from both `red` and `blue` alone, deterministically.
- **Text replacement is not an acceptable substitute.**
- **Pinned extension points (7f0e728):** `src/core/util.cpp::parse_prompt_attention`; `src/conditioning/conditioner.hpp` encoder call sites; `src/stable-diffusion.cpp::sample` conditioning closure and step index; public request fields in `include/stable-diffusion.h`.
- **Packet:** add parsed schedule AST and escaping rules, materialize per-prompt conditioning only at required boundaries, select it from the per-step callback. Dependency: tokenizer/encoder reuse; no new weights. Numerical acceptance: exact parser schedule boundaries vs pinned A1111 over nested/escaped corpus, deterministic embeddings per step. Live: schedule output differs from both endpoint prompts at fixed seed. Memory/perf: cache only unique conditioning segments; report peak and encode overhead. Cancel/cleanup: check cancel at each step as current callback does; free cached conditionings on every exit. Compatibility: absent schedule fields preserve pixel identity. Rollback: sidecar-only patch and opt-in route. Complexity: high.

## OP-1B Weighted composable AND conditioning (PR-13)
- **Need:** Multiple prompt branches contribute weighted denoiser predictions during each sampling step, matching A1111 `AND` composition rather than literal text substitution.
- **Engine gap:** the pinned sd.cpp parser builds one conditioning path and exposes no composable multi-branch denoiser output.
- **Option:** extend the denoiser callback in the pinned sampler loop to evaluate each branch at the current step and combine predictions with validated weights; preserve CFG and schedule semantics.
- **Proof needed:** parser corpus against the pinned A1111 reference; fixed-latent numerical comparison of each branch and weighted result; deterministic live image; cancellation and memory tests.
- **Pinned extension points:** `src/core/util.cpp::parse_prompt_attention`, `src/stable-diffusion.cpp::sample` denoise callback and `sd::guidance::GuiderOutput`; conditioning encoding in `src/conditioning/conditioner.hpp`.
- **Packet:** parse branch separators/weights without confusing escaped literals; encode each branch; combine denoiser predictions at each step using A1111 normalization and CFG order. Dependency: OP-1A parser/escaping primitives, but separate combination semantics. Numerical acceptance: fixed-tensor weighted prediction within declared float tolerance, weight-sum and zero-weight edge cases. Live: deterministic AND output differs from every branch alone. Memory/perf: multiple model evaluations per step; quantify VRAM/RSS and latency before exposure. Cancel/cleanup: cancel checks between branch evaluations; RAII releases branch conditioning. Compatibility: ordinary prompts remain bit-identical. Rollback: sidecar build and feature route only. Complexity: very high.

## OP-2 Latent-noise compatibility: variation seed/strength, resize-from (SD-04…SD-10, SC-04 var axes)
- **Need:** A1111 `create_random_tensors` slerps the main-seed noise with subseed noise by `subseed_strength`. `seed_resize_from_w/h` generates noise at the old size and pastes it centred.
- **Engine gap:** sd-cli creates its noise internally from `--seed` and `--rng`.
- **Option:** add `--subseed`, `--subseed-strength` and `--seed-resize-from WxH` to sd.cpp, implementing the slerp in latent space on the same RNG stream (`cuda` RNG is sd-webui compatible per the sd.cpp docs).
- **Proof needed:**
  - subseed_strength 0 must give pixels identical to the plain seed;
  - strength 1 must equal the subseed run;
  - 0.5 must differ from both and be deterministic.
- **Pinned extension points:** `src/stable-diffusion.cpp::generate_image` latent noise creation (`sd::randn_like` around the generation request path), `SD::sample` initial `noise`/`init_latent`, and `include/stable-diffusion.h::sd_image_gen_params_t`; RNG lives in the SD context.
- **Packet:** add validated subseed/strength/resize-from request fields and CLI/API plumbing; implement A1111-compatible RNG stream, spherical interpolation, latent resize and centered placement. Dependency: preserve current RNG implementation and define supported model families. Numerical acceptance: strength endpoints, slerp norm/angle, resized-noise placement and deterministic tensors on fixed shapes. Live: endpoint pixel equality plus intermediate variation; dimensions and seed receipt verified. Memory/perf: hold two noise tensors only for the operation; report overhead. Cancel/cleanup: no new process boundary; preserve the sampler cancellation callback and release scratch tensors on error. Compatibility: unset fields keep current pixels. Rollback: new flags default off in sidecar. Complexity: high.

## OP-3 Sampler and noise knobs (SD-16…SD-29, GN-02 remaining samplers, GN-03 remaining schedulers, SC-09)
- **Gap:**
  - Samplers: LMS, DPM2 a, DPM++ SDE/2M SDE/3M SDE/2M SDE Heun, DPM fast/adaptive, DDIM, PLMS, UniPC, Restart.
  - Schedulers: Polyexponential, Beta, Align Your Steps.
  - Knobs: s_churn/tmin/tmax/noise, sigma min/max/rho, eta noise seed delta, initial/extra noise multipliers, SGM noise, discard penultimate sigma, NGMS/skip early cond, zero-terminal-SNR.
- **Option:** port the k-diffusion formulas into sd.cpp's `denoiser.hpp`. Each sampler must be validated against k-diffusion reference sigmas and steps on a fixed latent, with a numerical tolerance stated per sampler.
- **Risk:** large surface. Split it into one packet per sampler family.
- **Pinned extension points:** `src/runtime/denoiser.hpp::Denoiser::get_sigmas` implementations and `sample_k_diffusion`; `src/stable-diffusion.cpp::SD::sample` supplies step callbacks, RNG and sigma vector.
- **Packet:** implement one sampler/scheduler family per patch with explicit enum/CLI/API routing, never a broad “A1111 sampler” switch. Dependencies: pinned numerical oracle and stable fixed-latent fixtures. Numerical acceptance: sigma arrays, every step output, eta/noise stream, and tolerances versus pinned k-diffusion/A1111 references. Live: each exposed family renders a nonconstant image and logs its actual method/schedule. Memory/perf: measure eval count, allocations and peak RSS; no hidden extra evaluations. Cancel/cleanup: check cancellation each iteration and release history tensors. Compatibility: existing method ids and defaults unchanged. Rollback: separately named sidecar + per-feature capability route. Complexity: very high; estimate separately by family.

## OP-4B Latent hires handoff and SDXL mid-loop refiner (HR-14…HR-18, RS-17)
- **Delivered separately:** OP-4A is application orchestration in `operator-console/hires-2pass.js`: txt2img, pixel-space resize/crop, then a separately configured img2img pass. The base and refined results are separately canonical and lineage-linked. It is not latent handoff or a mid-loop refiner; see `docs/parity/evidence/op4a-ab-20261017.json`.
- **Need:** latent upscalers require a latent handoff; the SDXL refiner swaps the UNet at a switch point measured in model timesteps, with `refiner_switch_by_sample_steps` compatibility. Base and final artifacts remain separately recorded.
- **Engine gap:** the pinned `sd-cli` `--hires*` path does not expose reusable latents; `--high-noise-*` is Wan-style and not equivalent.
- **Pinned extension points:** `src/stable-diffusion.cpp::sample` (latent creation and sampler call), `src/stable-diffusion.cpp::generate_image` and `generate_image_sd` (generation orchestration), plus `runtime/denoiser.hpp::sample_k_diffusion` (per-step denoiser path). Confirm exact signatures against Big Mac checkout commit `7f0e728b7d42f2490dfa5dd9539082d904f2f6b2` before implementation.
- **Required changes:** expose an owned latent result and validated latent input contract; add a mid-loop model-runner switch at the requested sigma/timestep boundary; keep pixel-space OP-4A distinct in API and metadata.
- **Proof needed:** numerical latent round trip; deterministic switch-boundary tests at 0, interior and 1; live base/refiner outputs with separate lineage; memory peak, cancel during both sides, remote cleanup and rollback to production binary.
- **Dependencies and acceptance:** compatible SDXL base/refiner assets and an approved sidecar build; compare latent shape/dtype/scale, switch timestep and both denoiser outputs numerically. Live generation must prove a selected alternate refiner actually contributes after the boundary and preserve base/final canonical artifacts. Record two model footprints, peak memory and switch overhead. Cancellation is required before/after the switch and must pass OP-7 run identity and cleanup. Existing API calls remain unchanged. Rollback removes only opt-in routing; complexity: very high.

## OP-5 Masked latent modes and soft inpainting (IP-07 latent noise/nothing, IP-10, IP-13, ED-13, SC-23)
- **Need:**
  - latent noise and latent nothing initialise the masked latent;
  - inpainting_mask_weight scales the conditioning mask;
  - soft inpainting blends latents per step;
  - img2img alternative inverts the Euler noise.
- **Engine gap:** these all require access inside the sampling loop that sd-cli does not expose.
- **Option:** an sd.cpp patch adding a masked-latent init mode and a per-step latent blend hook.
- **Pinned extension points:** `src/stable-diffusion.cpp::SD::sample` initializes `x_t`, applies `denoise_mask` around denoised outputs, and checks `get_cancel_flag()` in its per-step closure; image/mask request structs are in `include/stable-diffusion.h`.
- **Packet:** define latent-noise/nothing initialization and soft-mask blend order from pinned A1111 source; add explicit modes/strength fields and validate mask geometry. Dependency: existing image-to-mask preprocessing and inpaint model support. Numerical acceptance: mask 0/1 endpoints, feathered boundary tensors, inversion and fixed-latent reference comparisons. Live: asymmetric mask fixture demonstrates outside preservation and inside change, with canonical image validation. Memory/perf: quantify extra latent buffers and per-step blend cost. Cancel/cleanup: step-level stop; RAII for masks/noise. Compatibility: current mask mode remains default and unchanged. Rollback: sidecar-only; complexity: high.

## OP-6 ControlNet timing and multiple units (CN-05, CN-09)
- **Gap:** after the weights in `APPROVAL_PACKET_MODELS.md` are installed, `--control-net` and `--control-strength` work for SD1.5. Start/end fractions and multiple control units still need an sd.cpp patch: per-step gating of the control residuals, and a list of (model, image, strength) entries.
- **Pinned extension points:** `src/stable-diffusion.cpp::SD::sample` computes per-step conditions and builds `UNetDiffusionExtra`; `src/model/diffusion/unet.hpp::build_graph` consumes `controls` and `control_strength`; `ControlNet` is owned by the SD context. Public fields are in `include/stable-diffusion.h`.
- **Packet:** add a validated vector of control units (model/image/strength/start/end), gate each unit's residual at the exact normalized step, and retain one-unit legacy behavior. Dependencies: separately approved ControlNet weights and preprocessor models; model-file approval packet applies. Numerical acceptance: start/end boundary gating and sum/scale tests against fixed residual tensors. Live: two units produce deterministic, measurably distinct output from each single-unit control. Memory/perf: account for simultaneous ControlNet models and preprocessors; may require sequential resident limits. Cancel/cleanup: worker tree cleanup and per-run ID; free units on all exits. Compatibility: old one-unit API maps to one vector entry. Rollback: sidecar and explicit capability. Complexity: very high.

## OP-7 Safety-critical cancellation of shared sd-server paths (JO-02 remainder)
- **Gap:**
  - `batch-generate` and the legacy `/api/actions/xyz-plot` use the shared sd-server tunnel.
  - Their remote work cannot be stopped by run id, so Cancel reports the Big Mac side as **unverified**.
- **Design task:**
  - Tag each sd-server request with a request id.
  - Add a server-side abort, or route these paths through per-run sd-cli like controlled generation.
  - Hold the heavy lease until the stop is verified.
- No engine change is needed if those paths move to the per-run sd-cli path. **This one can be done without approval.**
