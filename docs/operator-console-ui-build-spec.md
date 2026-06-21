# Operator Console UI Build Specification

## Core Theme

The UI implements a "dark native macOS app" feeling. It is built as a technical operator console, distinct from generic, bright SaaS interfaces.

- **Background:** Dark navy/charcoal.
- **Layout:** Left sidebar navigation, compact top status strip, clean content cards.
- **Accents:** Blue/green status indicators.
- **Typography:** Clean technical sans-serif for UI elements. Monospace strictly reserved for paths, run IDs, logs, hashes, and command strings.
- **Focus:** Prominent image preview, isolated diagnostic tools, and Automatic1111-like practical generation controls. No giant repeated backend panels on creative screens.

## Color Tokens

```css
:root {
  --color-bg-app: #071018;
  --color-bg-shell: #0b1520;
  --color-bg-panel: #101b27;
  --color-bg-card: #132130;
  --color-bg-card-elevated: #172838;
  --color-bg-input: #0d1823;

  --color-border-subtle: rgba(148, 163, 184, 0.18);
  --color-border-focus: #38bdf8;

  --color-text-primary: #e5edf5;
  --color-text-secondary: #a8b3c2;

  --color-accent-blue: #38bdf8;
  --color-accent-green: #65d66e;

  --color-status-pass: #65d66e;
  --color-status-partial: #fbbf24;
  --color-status-fail: #ef4444;
}
```

## Required Accessibility

- **Keyboard navigation:** Full support with visible focus states.
- **Semantics:** Proper headings and labels for all controls.
- **Buttons:** Accessible names for icon-only buttons.
- **Status:** No color-only status indicators (use icons/text + color).
- **Live Regions:** ARIA live regions for generation and status updates.
- **Contrast:** Safe contrast ratios.
- **Motion:** Reduced motion support where appropriate.
- **Images:** Useful `alt` text for generated images.
