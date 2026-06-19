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

### BUG-4: `-deposit.test.tsx` — "step 2 shows loading affordance" test fails
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-deposit.test.tsx` > "Deposit page — three-step flow" > "step 2 shows loading affordance (not greyed) when request status is PendingVerification"
- **Symptom:** `npx vitest run src/routes/-deposit.test.tsx` reports 1 failure for the PendingVerification spinner affordance test. Reproduces on a clean checkout of `main` before any 672 changes, confirming it is pre-existing.
- **Root cause:** Not investigated. The test expects `null` not to be null (i.e., a spinner element to be present), but the element is not found in the rendered output.
- **Workaround:** None applied.

### BUG-5: `-index.test.tsx` — "clicking Connect calls useWallet().connect()" test fails
- **Date:** 2026-06-19
- **Location:** `packages/frontend/src/routes/-index.test.tsx` > "Home page — disconnected state" > "clicking Connect calls useWallet().connect() → opens AppKit modal (when ack flag is pre-set)"
- **Symptom:** `npx vitest run src/routes/-index.test.tsx` reports 1 failure for the Connect button test. The test expects `mockOpen` (from `useAppKit`) to be called once, but it is called 0 times. Reproduces on `main` before any #684 changes, confirming it is pre-existing.
- **Root cause:** The `ConnectWalletPromoCard.onConnect` is wired to `useConnectModal().open` which is a no-op in the test context (no `ConnectModalProvider` in the wrapper). The `mockOpen` from `useAppKit` is never called. The test was written assuming the Connect button invokes `useAppKit().open` directly, but the indirection through `ConnectModalProvider` was introduced later.
- **Workaround:** None applied. Fix: wrap `renderHome()` with `ConnectModalProvider` (backed by a mocked `WalletGateProvider`) so `useConnectModal().open` delegates to `useAppKit().open`.

### BUG-3: `useStellarWithdrawalQueue.test.tsx` — 8 failing tests
- **Date:** 2026-06-17
- **Location:** `packages/frontend/src/wallet/stellar/useStellarWithdrawalQueue.test.tsx`
- **Symptom:** `npx vitest run src/wallet/stellar/useStellarWithdrawalQueue.test.tsx` reports 8 failures (16 pass). Example: the "declined signature sets error" case expects `error.message` to match `/Declined/` but receives `"WithdrawalQueue not configured"`. Reproduces on a clean `main` checkout, so unrelated to any in-flight change.
- **Root cause:** Not investigated. The mocked test setup appears to leave the WithdrawalQueue contract unconfigured, so the hook short-circuits with a "not configured" error before reaching the signature-decline / submission paths the tests assert on.
- **Workaround:** None applied.

---

## Resolved

_None yet._
