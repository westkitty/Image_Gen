---
name: DexDiffusion Studio Design System
description: Sovereign local-first multi-modal creative workstation visual language and token architecture
colors:
  bg-canvas: "#0b0d11"
  bg-shell: "#111318"
  bg-panel: "#181b22"
  bg-panel-secondary: "#14171d"
  bg-input: "#0d0f13"
  text-primary: "#f1f3f6"
  text-secondary: "#d6dae0"
  text-muted: "#abb1bd"
  text-subtle: "#7f8793"
  line-default: "#30343e"
  line-subtle: "rgba(148, 163, 184, 0.16)"
  focus-ring: "#38bdf8"
  status-ok: "#65d66e"
  status-warn: "#f59e0b"
  status-error: "#e32636"
  status-info: "#38bdf8"
  # Intended 5 Master Workspace Accent Tokens
  workspace-chat: "#2dd4bf"
  workspace-image: "#b197fc"
  workspace-audio: "#f5b942"
  workspace-video: "#fb7185"
  workspace-3d: "#60a5fa"
  # Incumbent V2 Category Tints
  tint-image: "#7dd3fc"
  tint-sound: "#c4b5fd"
  tint-motion: "#6ee7b7"
  tint-ops: "#fcd34d"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "clamp(20px, 2.5vw, 32px)"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'DM Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "'DM Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
  mono:
    fontFamily: "'IBM Plex Mono', Menlo, Monaco, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "5px"
  md: "8px"
  lg: "11px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.workspace-image}"
    textColor: "#080c12"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.bg-panel}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-field:
    backgroundColor: "{colors.bg-input}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  master-chip:
    backgroundColor: "{colors.bg-shell}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    height: "42px"
---

# Visual Design System: DexDiffusion Studio

## Overview

DexDiffusion Studio is a high-density, dark, tactile creative workstation interface designed for operators directing local generative models (MFLUX, stable-diffusion.cpp, voice synthesizers, multi-track drama audio, and 3D mesh/splat viewports).

The visual language rejects generic SaaS cards, low-density marketing fluff, and distracting animated gradients in favor of an ergonomic, utilitarian cockpit:
- Deep charcoal (`#071018`, `#080c12`, `#0b0d11`) background plates.
- Fine structural hairline borders (`#30343e`, `rgba(148,163,184,0.16)`).
- Distinct workspace color coding to instantly signal active creative discipline.
- Truthful real-time telemetry (engine worker health, memory, compute queues).
- High-contrast, scannable typography optimized for dense control forms and wide preview viewports.

## Colors

### Canvas & Surfaces
- `Canvas (Root)`: `#0b0d11` (darkest void, maximizes preview image contrast).
- `Shell & Navigation`: `#111318` (chrome bars, header strip, status footer).
- `Primary Panel / Inspector`: `#181b22` (control groups, workbench sidecars).
- `Secondary Card / Elevation`: `#14171d` (nested configuration wells, quick cards).
- `Input Surface`: `#0d0f13` (textareas, selects, number steppers).

### Typography & Icons
- `Primary Text`: `#f1f3f6` (headings, high-priority readouts).
- `Secondary Text`: `#d6dae0` (form labels, active option descriptions).
- `Muted Text`: `#abb1bd` (secondary hints, character counts, status timestamps).
- `Subtle / Disabled`: `#7f8793` (inactive shortcuts, placeholders).

### The Five Master Creative Workspaces (Intended Palette)
Each creative discipline is governed by an authoritative semantic accent token:
- **CHAT:** `#2dd4bf` (Mint / Teal) — Conversational, responsive, intelligent.
- **IMAGE:** `#b197fc` (Violet) — Generative visual craft, synthesis, diffusion.
- **AUDIO:** `#f5b942` (Amber / Gold) — Acoustic, musical, expressive, voice.
- **VIDEO:** `#fb7185` (Coral / Rose) — Temporal, cinematic motion.
- **3D:** `#60a5fa` (Electric Sky Blue) — Spatial, dimensional geometry.

*Rule:* Colors identify the creative discipline; they never indicate operational error or status. A failed image job remains violet with an independent error indicator.

### Operational Telemetry
- `Connected / Idle`: `#65d66e` (`rgba(101, 214, 110, 0.32)` border)
- `Busy / Generating`: `#38bdf8` (pulsing indicator or determinate progress bar)
- `Warning / Gated`: `#f59e0b` (`rgba(245, 158, 11, 0.3)` border)
- `Failed / Disconnected`: `#e32636` (`rgba(227, 38, 54, 0.3)` border)

## Typography

The type scale combines **Inter** (for shell structure, headings, and clean numeric readouts), **DM Sans** (for comfortable body copy, form controls, and prompts), and **IBM Plex Mono** (for technical telemetry, seeds, step counts, and hardware diagnostics).

- **Display (`clamp(20px, 2.5vw, 32px)` / 700 / -0.025em letter-spacing):** Workspace hero banners, major milestone headers.
- **Section Headline (`16px` / 700 / -0.01em letter-spacing):** Module titles, workbench headers.
- **Card Title (`12px` - `13px` / 600 / normal):** Panel sub-headers, accordion summaries.
- **Body / Control (`12px` - `13px` / 400 / 1.5 line-height):** Form inputs, prompts, descriptions.
- **Micro Label (`9px` - `10px` / 750 / 0.1em - 0.15em letter-spacing / uppercase):** Eyebrows, field labels, keyboard shortcuts (`Cmd-K`), status pills.
- **Telemetry Monospace (`11px` / 600):** Seeds, step counters, inference speed (`it/s`), token streams.

## Layout

The application employs a fixed-height, viewport-constrained shell (`100dvh`, `overflow: hidden`) with dedicated internal scroll panes (`[data-scroll-pane]`).

### Desktop (>= 1100px)
- **Top Row (56px):** Brand identity (`DexDiffusion`), the 5 Master Navigation Chips (Chat, Image, Audio, Video, 3D), and right-aligned global utilities (`Library`, `Models`, `Jobs`, `System`).
- **Second Row (44px):** Contextual sub-navigation belonging to the active master (e.g. Image -> `Create`, `Batch`, `Edit`).
- **Main Workspace (1fr):** Multi-column workbench:
  - Left / collapsible rail (300px - 410px): Prompt composer, primary parameters, generation controls.
  - Center Canvas (1fr): Large preview canvas, generation viewport, interactive GLB/splat orbit stage.
  - Right Inspector (280px - 360px): Metadata, LoRA weights, seed history, advanced settings.
- **Bottom Status Rail (44px):** Background job queue, connection heartbeat, active task cancellation.

### Tablet (701px - 1099px)
- Master chips remain horizontally pinned across the top.
- Right inspector collapses into a sliding drawer or tabbed sheet.
- Single-column canvas and stacked parameter groups.

### Mobile Phone (375px - 700px)
- Master navigation adapts to an accessible horizontally scrollable chip track with the active tab auto-scrolled into view.
- 100% width stacked column layout.
- Floating Generate action bar remains anchored above the mobile virtual keyboard.
- Minimum touch targets enforced at 44x44px.

## Elevation & Depth

DexDiffusion relies primarily on tonal layering, subtle luminosity contrasts, and hairline borders rather than heavy drop shadows:
- **Base:** `#0b0d11` (Flat canvas)
- **Layer 1 (Panels):** `#181b22`, border `1px solid #30343e`
- **Layer 2 (Wells / Cards):** `#14171d`, border `1px solid rgba(148,163,184,0.12)`
- **Layer 3 (Modals / Overlays):** `#101b27`, border `1px solid rgba(148,163,184,0.28)`, shadow `0 20px 60px rgba(0,0,0,0.55)`
- **Backdrop:** `rgba(0, 0, 0, 0.68)` with `backdrop-filter: blur(5px)`.

## Shapes

- **Master Navigation Chips:** Refined soft rounded-rectangles (`border-radius: 8px`), desktop height 40px–44px, comfortable 12px–16px horizontal padding.
- **Action Buttons:** `border-radius: 8px` (large primary) or `6px` (compact icon buttons).
- **Form Inputs:** `border-radius: 7px` with inset 1px border.
- **Pills & Status Dots:** Fully rounded (`border-radius: 999px`).

## Components

### 1. Master Workspace Navigation Chips
- **Inactive:** Deep charcoal background lightly tinted with workspace accent (`rgba(accent, 0.08)`), subtle border (`rgba(accent, 0.25)`), readable label and icon.
- **Active:** High-contrast accent fill or strong border, contrast-safe text, visible active underline or elevation.
- **Focus:** 2px high-contrast focus ring (`outline: 2px solid var(--focus)`), `outline-offset: 2px`.

### 2. Contextual Sub-Navigation
- Placed immediately below master chips. Smaller (32px height), neutral background, adopting the parent workspace's accent for active tab indicator.

### 3. Prompt Composer
- Large resizable textarea (`min-height: 120px`), dark slate background (`#0d0f13`), clear character counter, integrated style/wildcard dropdowns.

### 4. Generation Viewport
- Dark background (`#071018`) with 1:1, 16:9, or responsive aspect ratio framing. Supports pan-and-zoom lightbox, metadata inspector, and instant "Send to Edit" handoff buttons.

### 5. Global Utility Overlays
- Library, Models, Jobs, System: Non-modal sidecars or accessible drawer overlays that preserve active workspace draft state upon opening and closing.

## Do's and Don'ts

### Do
- **Preserve Unsaved State:** Switching between Chat, Image, Audio, Video, and 3D must NEVER clear prompt text, reset sliders, or cancel running jobs.
- **Maintain Truthful Telemetry:** Display actual model names, worker connection status, and explicit readiness disclaimers for unconfigured tools.
- **Keep Chrome Subordinate:** The user's visual art, audio script, or 3D viewport must occupy >= 60% of desktop viewport area.
- **Enforce Contrast:** Maintain >= 4.5:1 (ideally >= 7:1) contrast for all text against dark surfaces.

### Don'ts
- **No Decorative Gradients:** Do not use full-page purple/pink neon gradient meshes that wash out image previews.
- **No Global 0.01ms Motion Destruction:** Do not nuke all transitions with `.ca-shell * { animation-duration: 0.01ms !important }`—provide intentional, non-disorienting state feedback.
- **No Color-Only State Communication:** Never use color as the sole indicator of button state, readiness, or errors; always pair with icons and descriptive text.
- **No Deceptive Simulators:** Do not render fake chat streaming or simulated video timelines if the underlying engine is offline.
