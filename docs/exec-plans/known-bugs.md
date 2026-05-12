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
- **Root cause:** Unused `import React from "react"` in the file; the package's `tsconfig.json` enables `noUnusedLocals`.
- **Workaround:** None applied. Drop the import (or switch to `import type` if a type is needed) when this is addressed.

---

## Resolved

_None yet._
