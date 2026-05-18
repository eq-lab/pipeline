# Known Bugs

Bugs discovered during development that are not yet fixed. Log here, don't fix inline.

## Format

```
### BUG-<N>: <short description>
- **Date:** YYYY-MM-DD
- **Location:** file or component
- **Symptom:** what breaks / what you observe
- **Root cause:** why it happens (if known)
- **Workaround:** any temporary mitigation (if any)
```

---

## Open

### BUG-1: `Typography.stories.tsx` fails strict TS check with unused `React` import
- **Date:** 2026-05-12
- **Location:** `packages/ui/src/typography/Typography.stories.tsx:2`
- **Symptom:** `npx tsc --noEmit` from `packages/ui` reports `error TS6133: 'React' is declared but its value is never read.` The Storybook build itself succeeds because Storybook does not run a strict tsc pass, but anyone running the package-level type check hits the error.
- **Root cause:** Unused `import React from "react"` in the file; the package's `tsconfig.json` enables `noUnusedLocals`. React 19 + the new JSX runtime no longer require the explicit import.
- **Workaround:** None applied. Drop the import (or switch to `import type` if a type is needed) when this is addressed.

### BUG-2: `swap-vertical.svg` is an SVG wrapper around a base64 PNG
- **Date:** 2026-05-18
- **Location:** `packages/ui/src/assets/icons/swap-vertical.svg` — imported by `packages/ui/src/components/ConversionCard/ConversionCard.tsx:9`
- **Symptom:** The swap-arrows icon rendered between the two ConversionCard halves uses an SVG file that wraps a rasterised PNG (`<image href="data:image/png;base64,…">`). Same stale-raster pattern as the original `coin-usdc.svg` before Issue #246 fixed it. Detected during UX testing of #246: `grep -c "data:image/png" packages/ui/src/assets/icons/swap-vertical.svg` → `1`.
- **Root cause:** Asset was originally extracted as a rasterised PNG and placed into an SVG wrapper (same historical pattern as `coin-usdc.svg`). Not caught by #246 scope, which was USDC-only.
- **Workaround:** None applied. Replace with a proper vector SVG export from Figma (same procedure as #246 Step 1–2).

---

## Resolved

_None yet._
