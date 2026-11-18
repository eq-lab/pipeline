# User story: #1329 — Foundation/Tokens Storybook story for design-token visual review

**Epic:** #2029
**Issue:** https://github.com/eq-lab/pipeline/issues/1329
**Status:** Initial

---

## Overview

Storybook gets a `Foundation/Tokens` page that lists every `--color-pipeline-*`, `--text-pipeline-*` and `--radius-pipeline-*` token declared in `packages/ui/src/styles/theme.css`, so a reviewer can compare values with Figma without DevTools. Spec: `docs/FRONTEND.md#design-tokens`.

Persona: designer or frontend reviewer with Storybook running (`yarn workspace @pipeline/ui storybook`, http://localhost:6006).

---

## Story 1 — Colors lists every colour token

**Given** Storybook is open on `Foundation/Tokens` → `Colors`

**When** the page renders

**Then:**

- The header count equals the number of `--color-pipeline-*` declarations in the `@theme` block of `theme.css`
- Each row shows a swatch, the token name and its declared value
- Translucent tokens (for example `--color-pipeline-ink-muted`) show the checkerboard through the swatch
- `--color-pipeline-positive-strong` shows `var(--color-pipeline-positive-primary)` followed by its resolved colour `rgb(32, 128, 0)`

---

## Story 2 — TypeRamp lists every type-ramp token

**Given** Storybook is open on `Foundation/Tokens` → `TypeRamp`

**When** the page renders

**Then:**

- There is one row per `--text-pipeline-*` size token (the `--line-height` companions are not listed separately)
- Each row shows the token name, `size / line-height` and a sample line rendered at that size and line-height

---

## Story 3 — Radii lists every radius token

**Given** Storybook is open on `Foundation/Tokens` → `Radii`

**When** the page renders

**Then:**

- There is one row per `--radius-pipeline-*` token
- Each row shows a bordered box with that radius applied, the token name and its value (`--radius-pipeline-pill` renders fully rounded ends)

---

## Story 4 — A new token appears without editing the story

**Given** a new `--color-pipeline-*` declaration is added to the `@theme` block of `theme.css`

**When** Storybook reloads `Foundation/Tokens` → `Colors`

**Then** the new token has a row and the header count goes up by one
