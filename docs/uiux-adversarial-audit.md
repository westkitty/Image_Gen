# UI/UX Adversarial Audit

Generated: 2026-06-24

Scope: Image_Gen / SDCPP Workbench operator console at `/Users/andrew/Image_Gen/operator-console`.

## 1. Current UI/UX Summary

The app is trying to be a local Automatic1111 (A1111)-style workbench for a stable-diffusion.cpp workflow bridge: prompt generation, controlled model targets, batch and sweep generation, edit flows, enhancement/upscale flows, library/reuse, model staging, and system diagnostics. That is a real product shape, not a toy demo.

Supported workflows:

- Create controlled txt2img runs with prompt, negative prompt, model target, VAE, sampler, scheduler, size, steps, CFG (Classifier-Free Guidance), seed, quantity, tiling, privacy, and command preview.
- Run batch generation and partial X/Y/Z plots.
- Run img2img and inpaint from previous run images.
- Upscale with local Pillow or Real-ESRGAN, and run a partial Hires Fix flow.
- Browse Library, compare controlled runs, inspect metadata, reuse settings, and send images into edit/enhance flows.
- Inventory models, discover assets, run model-stage and smoke proof actions.
- Verify, start, stop, and probe the backend.

What feels unfinished:

- The app already has dense, useful controls, but the visual system still reads like an AI-generated dark dashboard: blue-black gradient background, glowing cyan/green accents, rounded cards everywhere, and little distinction between primary work area, command panel, status surface, and secondary diagnostics.
- Feature truth is present but scattered. A user has to infer which features are working from caveats, gate cards, disabled inputs, and System output.
- The Create screen is strong but visually noisy. Every block has roughly equal panel weight, so the eye does not know whether prompt, preview, or settings is the operational center.
- Labels mix user vocabulary and implementation vocabulary. Some labels are good (`Run Real-ESRGAN Upscale`); others are still raw (`Server API`, `Mode`, `SDAPI`, `Preview JSON`) without enough consequence framing.
- The app is honest about not claiming full A1111 parity. Good. It still needs to make that honesty easier to scan.
- The CSS has a malformed selector: `. section-visibility-controls`. Small, but it is exactly the kind of sloppy residue users notice when the interface is already complex.

## 2. Competitive and Interface Comparison

### Automatic1111

Automatic1111 is blunt, dense, and powerful. It wins on parameter discoverability because almost every common control is present in predictable places: prompt, negative prompt, model, sampler, steps, size, CFG, seed, batch, scripts, img2img, extras, PNG Info. It is ugly by default, but it is legible to power users.

Current Image_Gen comparison:

- Strong: prompt, negative prompt, sampler, scheduler, VAE, seed, size, batch, img2img, inpaint, upscaling, metadata reuse, and X/Y/Z-style sweep all exist.
- Weak: settings are split across collapsible sections without a global capability map; unsupported A1111-adjacent features need a clearer “not connected” status.
- Missing or partial: full latent Hires Fix, arbitrary PNG Info upload, full script ecosystem, outpaint, face restore, embeddings, hypernetworks.

### ComfyUI

ComfyUI exposes a graph, making dependencies visible. It wins on workflow transparency and composability. It loses on approachability unless the user understands nodes.

Current Image_Gen comparison:

- Strong: the command bridge and job log provide a practical version of traceability.
- Weak: users cannot see the chain of prompt → command preview → job → run metadata as one continuous system. It exists, but the UI does not visually encode it.
- Improvement target: use a capability ledger and stronger status surfaces instead of pretending this is a graph editor.

### InvokeAI

InvokeAI feels more like a production creative tool: clearer canvas/results area, polished model and gallery behavior, direct image operations, and better state feedback.

Current Image_Gen comparison:

- Strong: Library reuse and detail views are solid; inpaint mask tools are a meaningful capability.
- Weak: the results area feels like a panel, not a studio surface. Preview needs stronger visual priority.
- Weak: edit/enhance workflows are available but do not feel as cohesive as Create.

### Fooocus

Fooocus wins by hiding complexity until needed. It has a friendly prompt-first path and keeps most advanced concepts out of the way.

Current Image_Gen comparison:

- Strong: advanced controls are collapsible and can be hidden.
- Weak: the app cannot be as simple as Fooocus because its explicit mission is serious parameter control. The answer is not fewer controls; it is better grouping and stronger progressive disclosure.

### Mature adjacent tools: DaVinci Resolve and Lightroom Classic

Resolve separates Media, Cut/Edit, Fusion, Color, Fairlight, Deliver. Lightroom separates Library and Develop with persistent filmstrip/history concepts. Both are parameter-heavy but survive because their navigation maps to workflow phases.

Current Image_Gen comparison:

- Strong: Create, Batch, Edit, Enhance, Library, Models, System is the right kind of workflow split.
- Weak: the screens do not yet feel like a coherent production pipeline. The same card styling is used for commands, forms, status, warnings, and galleries.
- Improvement target: visually separate command, inspection, output, and system truth surfaces.

## 3. Excessive Critique

The app has too much “default AI dashboard” residue:

- Blue-black gradient background with cyan/green gradient brand mark. It is technically polished and still generic.
- Nearly every surface is a rounded card. Cards are being used as layout glue instead of information objects.
- Radius is too high for a tool this dense. Eighteen-pixel radius makes the UI look softer than the workflow deserves.
- Panel shadows create fake depth without improving scanability.
- The preview area is central but visually timid. It should feel like the actual output bench, not another card.
- Too many controls use the same weight. Primary generation, preview command, copy params, and cross-workflow buttons need a clearer command hierarchy.
- Disabled/planned features are present, but the difference between “blocked,” “partial,” “planned,” “proofed,” and “staged” is too distributed.
- The current System screen is useful but not executive-readable. Capability gates need to become a live matrix, not a pile of cards.
- The Models screen is close to good, but proof actions and inventory actions are crammed into one row, which turns serious maintenance actions into toolbar confetti.
- The Create prompt toolbar has too many small buttons near the char count. It works, but it is crowded.
- Inline styles in `index.html` weaken consistency and make future design passes harder.
- The malformed CSS selector is a small quality smell. Not fatal. Still ugly.
- The current palette is a one-note dark-blue/slate theme, exactly the kind of thing a generated interface reaches for when it wants to look “technical.”

## 4. Improvement Plan

### Layout

- Keep the current workflow navigation; it is structurally correct.
- Flatten the shell and reduce radius to 8px so the interface reads as a tool, not a glossy landing-page dashboard.
- Make the preview/output area feel more deliberate through stronger borders, less glow, and clearer empty/running/done states.

### Navigation

- Preserve Create, Batch, Edit, Enhance, Library, Models, System.
- Strengthen System as the truth surface by adding a live capability matrix with supported, partial, blocked, and internal categories.

### Prompting Workflow

- Keep prompt, negative prompt, model, style, wildcards, local prompt draft, Ollama enhancement, and settings import.
- Reduce visual noise around prompt helpers; make them tool buttons in a quieter visual style.

### Parameter Controls

- Preserve existing parameter exposure: model target, VAE, sampler, scheduler, steps, CFG, size, quantity, seed, variation placeholders, Hires/faces/tiling, backend routing.
- Keep unwired controls disabled/read-only with direct explanations.

### Gallery/Results

- Preserve Library filters, comparison, run details, manifest view, replay, copy settings, and send-to actions.
- Make output images and comparison cards visually less decorative and easier to inspect.

### Presets/Settings

- Preserve presets and local styles.
- Make the distinction between preset, model default, and custom state clearer through copy and hierarchy.

### Feedback States

- Keep status pills, progress bars, logs, first failed gate, and retry.
- Reduce color-only status meaning by keeping text labels and badges.

### Visual Polish

- Replace the generic dark-blue gradient theme with a graphite/ink/amber/cyan tool palette.
- Use one signature element: a left-edge “capability rail” visual language that treats supported/partial/blocked states as instrument readings.
- Reduce large shadows, reduce radius, and remove decorative gradients that do not carry workflow meaning.

### Accessibility

- Preserve labels, focus states, `aria-live`, status roles, dialogs, and disabled states.
- Improve focus contrast and avoid relying on color alone in the capability ledger.
- Keep responsive sidebar behavior.

### Responsiveness

- Maintain single-column mobile behavior.
- Prevent status pills and prompt tools from crowding beyond their containers.

### Code Maintainability

- Keep changes scoped to `index.html`, `app.js`, `styles.css`, and docs.
- Do not introduce dependencies.
- Centralize capability ledger rendering in one client function fed from `/api/capabilities`.

### Feature/Function Exposure

- Working features stay usable in their current workflow screens.
- Partial features remain visible with explicit caveats.
- Unwired features stay disabled or appear in the capability ledger as unavailable.
- Internal/destructive commands remain documented but not exposed as casual buttons unless confirmation is added later.
