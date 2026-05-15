# Issue #222: Add /test diagnostic page — show all envs, wallet state, and hook outputs (mocked markers)

Source: https://github.com/eq-lab/pipeline/issues/222

## Scope

Add a new TanStack file route at `/test` that surfaces, in one utilitarian
page, every value the frontend currently "knows" at runtime:

- **Environment** — every field exported from `@/lib/env` (`ENV`).
- **Wallet** — `useWallet()` state plus a Connect/Disconnect control.
- **DepositManager** — `useDepositManagerAddresses()` + `useDepositManagerMinDeposit()`.
- **USDC token** — `useToken({ token: usdc })` (replaces the Issue's
  reference to the now-removed `useUsdcBalance`; per #220 the canonical USDC
  surface is `useToken`).
- **ERC-20 approval (USDC → DepositManager)** — keep using `useApproval`
  directly for now (it remains exported on `main`; its removal is tracked by
  #223 and is out of scope here).
- **Write hooks** — `useRequestDeposit()` + `useClaim()` status fields with
  guarded "Trigger with dummy input" buttons behind a confirm dialog.

Each value that the wallet module is reading from a `pipeline.mock.wallet.*`
localStorage key (instead of doing a real RPC call) is visually flagged with
an inline `MOCKED` badge next to the field label.

New small surface added to `@/wallet`:

- `isMockKeyPresent(key: string): boolean` — thin wrapper around `readMock`
  that the route uses to determine whether a given field is sourced from the
  mock layer. Exposed from the wallet barrel so the route does not reach into
  `localStorage` or import from `./mock` directly. Non-reactive (one-time
  check at render time is sufficient per the Issue).

### Out of scope

- Hiding `/test` in production builds (Issue acknowledges; revisit later).
- Linking `/test` from `TopBar` or any other navigation.
- New wallet hooks — page renders only what is already exported from `@/wallet`.
- Backend API surfacing (`/v1/requests`, KYC, etc.).
- Re-styling — utilitarian only. No new design tokens; reuse `@pipeline/ui`
  primitives where convenient.
- Migrating the approval section to `useToken({ token, spender })`.
  `useApproval` is the explicit choice for now per the user note on this
  Issue. When #223 lands, the page will be updated in that PR.

## Assumptions and Risks

- **`useUsdcBalance` is gone.** Per #220 the hook was removed. The Issue body
  predates that change. We render USDC via `useToken({ token: usdc })` where
  `usdc` comes from `useDepositManagerAddresses().usdc`. When `usdc` is
  `undefined` (DM not configured or still loading) we pass the zero address;
  `useToken` already short-circuits cleanly on that.
- **`useApproval` stays.** Per the user note, we keep using `useApproval`
  directly for the approval section. #223 will later remove it; when that
  lands a one-line swap to `useToken({ token: usdc, spender: DM })` is the
  expected follow-up.
- **`MOCKED` indicator is single-shot at render time.** `isMockKeyPresent`
  reads `localStorage.getItem` once per render. Inside the wallet module the
  hooks themselves react to mock changes via the same-tab bridge, so when a
  mock key is added/removed in DevTools the component re-renders for the
  value change, and the `MOCKED` badge is recomputed in the same cycle.
  Acceptable per Issue ("a one-time check on mount is acceptable").
- **No new tests beyond smoke.** Issue is explicit: diagnostic page, no
  acceptance test coverage required beyond a smoke render.
- **Confirm dialog for write triggers.** `useRequestDeposit` / `useClaim`
  triggers go through a native `window.confirm()`. Without a guard, a careless
  click on a real chain could broadcast a transaction. We pick `window.confirm`
  rather than a new modal component to stay within the "utilitarian, no new
  design" constraint.
- **ESLint boundary.** The route file cannot import `wagmi`/`viem`/AppKit
  directly. Everything must go through `@/wallet`. The new `isMockKeyPresent`
  helper is required precisely because the route would otherwise have to
  reach into `localStorage` to render the `MOCKED` badges.
- **No `routeTree.gen.ts` hand-edit.** TanStack's file-route generator
  rewrites the file on next dev start / build. We add `routes/test.tsx` and
  rely on the generator. If the generated file is checked in, the coder runs
  the generator (typically `yarn workspace @pipeline/frontend dev` or
  `vite build`) so the route tree is updated before commit.

## Open Questions

_None_

## Implementation Steps

1. **Expose `isMockKeyPresent` from the wallet barrel.**
   - In `packages/frontend/src/wallet/mock.ts`, add:
     ```ts
     export function isMockKeyPresent(key: string): boolean {
       return localStorage.getItem(key) !== null;
     }
     ```
     Place it directly under the `readMock` definition with a short JSDoc
     explaining it is a non-reactive check used by the `/test` diagnostic page
     to render `MOCKED` badges.
   - In `packages/frontend/src/wallet/index.ts`, add a line:
     `export { isMockKeyPresent } from "./mock";` (kept in alphabetical order
     near the existing wallet helpers — directly after `useWallet` exports is
     fine).

2. **Create the route file.**
   - Path: `packages/frontend/src/routes/test.tsx`.
   - Use the same `createFileRoute` pattern as `routes/deposit.tsx`:
     ```ts
     export const Route = createFileRoute("/test")({ component: TestPage });
     ```
   - Imports allowed: `@tanstack/react-router`, `@pipeline/ui` primitives,
     `@/lib/env`, and `@/wallet` (everything else is blocked by the ESLint
     `no-restricted-imports` rule).
   - Top-of-file JSDoc explains: diagnostic page, lists each section, flags
     that `MOCKED` badges show when a `pipeline.mock.wallet.*` key is driving
     the value, and notes the page is intentionally not linked from `TopBar`.

3. **Local inline `MockedBadge` component.**
   - Defined inline in `routes/test.tsx` (utilitarian — no new `@pipeline/ui`
     component).
   - Renders the literal text `MOCKED` in a muted style: small uppercase
     text via Tailwind utilities resolving to existing tokens
     (`text-[10px] uppercase tracking-wide text-[color:var(--color-pipeline-ink-muted)] border border-[color:var(--color-pipeline-line)] rounded px-1`
     or similar — match the muted text colors already used in `TopBar`).
   - Signature: `function MockedBadge({ when }: { when: boolean })` returning
     `null` when `when` is `false`.

4. **Local inline `KeyValueRow` component.**
   - Renders `label`, `value`, and an optional trailing `MockedBadge`.
   - Signature:
     ```ts
     function KeyValueRow({
       label,
       value,
       mocked = false,
       extra,
     }: {
       label: string;
       value: React.ReactNode;
       mocked?: boolean;
       extra?: React.ReactNode; // e.g. an action button
     }): JSX.Element
     ```
   - A simple flex row: label on the left, value (monospace where helpful)
     on the right, badge inline next to the value.

5. **Section: Environment.**
   - Render `ENV.EVM_CHAIN_ID`, `ENV.EVM_RPC_URL`, `ENV.DEPOSIT_MANAGER_ADDRESS`,
     `ENV.WALLETCONNECT_PROJECT_ID`.
   - Flag `zero-address` when `DEPOSIT_MANAGER_ADDRESS === "0x000…000"`
     (compare to the literal constant). Render a small inline note —
     `(zero-address — DM hooks short-circuit)` — next to the value.
   - Flag `replace-me` when `WALLETCONNECT_PROJECT_ID === "replace-me"`
     (the documented default in `lib/env.ts`). Render a small inline note.
   - No `MOCKED` badges in this section (env is not mocked via
     `pipeline.mock.*`).

6. **Section: Wallet (`useWallet`).**
   - Call `useWallet()` and render `address`, `isConnected`, `chainId`.
   - For each field, set `mocked = isMockKeyPresent(<key>)`:
     - `address` → `pipeline.mock.wallet.address`
     - `isConnected` → `pipeline.mock.wallet.isConnected`
     - `chainId` → `pipeline.mock.wallet.chainId`
   - Below the rows, render a single `Button` from `@pipeline/ui` that
     calls `connect()` when disconnected and `disconnect()` when connected
     (label switches accordingly). Reuse the same `Button` variant the
     `TopBar` uses for its `Connect Wallet` button (`primary-dark`).

7. **Section: DepositManager (`useDepositManagerAddresses`, `useDepositManagerMinDeposit`).**
   - Show `plusd`, `usdc`, and `minDeposit` (raw bigint + formatted at 6
     decimals via `Number(minDeposit) / 1e6` — acceptable for diagnostic
     readability; no need for `formatUnits` in the route).
   - `MOCKED` is `true` for each field when **any** of these keys is present
     (use the priority order the hooks already implement):
     - For `plusd`: `pipeline.mock.wallet.contract.depositManager.plusd` OR
       `pipeline.mock.wallet.contract.<DM_ADDRESS>.plUsd`
     - For `usdc`: `pipeline.mock.wallet.contract.depositManager.usdc` OR
       `pipeline.mock.wallet.contract.<DM_ADDRESS>.usdc`
     - For `minDeposit`: `pipeline.mock.wallet.contract.depositManager.minDeposit`
       OR `pipeline.mock.wallet.contract.<DM_ADDRESS>.minDeposit`
   - Compute these in the component with `isMockKeyPresent` calls. Use
     `ENV.DEPOSIT_MANAGER_ADDRESS.toLowerCase()` for the per-address key
     suffix (matches how the wallet module hashes the key).

8. **Section: USDC token (`useToken`).**
   - Call `useToken({ token: usdc ?? ZERO_ADDRESS })` where `usdc` is read
     from `useDepositManagerAddresses().usdc` (declare a local
     `ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"` constant).
   - Show `decimals`, `symbol`, `balance` (raw), `formattedBalance`.
   - `MOCKED` markers (resolved against `usdc.toLowerCase()` when `usdc` is
     defined; otherwise `false`):
     - `decimals` → `pipeline.mock.wallet.contract.<usdc>.decimals`
     - `symbol` → `pipeline.mock.wallet.contract.<usdc>.symbol`
     - `balance` / `formattedBalance` → `pipeline.mock.wallet.balance.<usdc>`
   - Render an "—" placeholder when `usdc` is `undefined` (DM not configured
     yet) and skip the `MOCKED` checks in that branch.

9. **Section: ERC-20 approval (USDC → DepositManager) via `useApproval`.**
   - Call `useApproval({ token: usdc ?? ZERO_ADDRESS, spender: ENV.DEPOSIT_MANAGER_ADDRESS })`.
   - Also call `useDepositManagerMinDeposit()` (already done above) so the
     `Approve(minDeposit)` button can pass that amount.
   - Show `allowance` (raw bigint) and `isSufficient(minDeposit)` (boolean —
     `false` when `minDeposit` is `undefined`).
   - Render a small `Button` `Approve(minDeposit)` that calls
     `approve(minDeposit)` when `minDeposit` is defined; disabled otherwise.
   - `MOCKED` markers (only when both `usdc` and DM are known):
     - `allowance` → `pipeline.mock.wallet.allowance.<usdc>.<DM_ADDRESS>`
     - `approve` button → `pipeline.mock.wallet.contract.<usdc>.approve`
   - Also surface `isPending`, `isSuccess`, and `error?.message` as small
     read-only rows so manual QA can observe state transitions.

10. **Section: Write hooks (`useRequestDeposit`, `useClaim`).**
    - For each, render `data` (the full object — `JSON.stringify(data, null, 2)`
      inside a `<pre>` is fine), `isPending`, `isSuccess`, and
      `error?.message`.
    - Buttons:
      - `Trigger requestDeposit(minDeposit ?? 1n)` — calls `useRequestDeposit().write(minDeposit ?? 1n)`.
        Disabled when `isPending` is true.
      - `Trigger claim(0n, "0x00")` — calls `useClaim().write(0n, "0x00")`.
        Disabled when `isPending` is true.
    - Each button is wrapped in a `window.confirm("This will broadcast a real transaction unless a mock key is set. Continue?")` guard before invoking `write(...)`.
    - `MOCKED` flags:
      - `useRequestDeposit` row → `pipeline.mock.wallet.contract.depositManager.requestDeposit`
      - `useClaim` row → `pipeline.mock.wallet.contract.depositManager.claim`

11. **Page layout.**
    - Wrap everything in a `<main>` that mirrors the `routes/deposit.tsx`
      shell (paper background, ink text). Use `max-w-3xl mx-auto px-4 py-12`
      for the column. Inside, a vertical stack (`flex flex-col gap-8`) of
      `<section>` blocks — each section has a short `<h2>` heading and the
      `KeyValueRow`s underneath.
    - Reuse `Card` from `@pipeline/ui` per section if it improves scannability.
      If `Card` adds visual noise for a debug page, plain `<section>` blocks
      with a bottom border line are fine.
    - Include the `TopBar` at the top so wallet state is visible at a glance
      and the user can connect/disconnect from the standard control too.

12. **Smoke render check.**
    - Add a single smoke test at `packages/frontend/src/routes/test.test.tsx`
      that renders `<TestPage />` inside the standard test harness
      (`WalletProvider` + `RouterProvider` if required by other tests, or a
      minimal `QueryClientProvider` only if the existing test files use one).
      The test asserts the page renders without throwing and that the
      `Environment` heading is present.
    - The test should also confirm that setting
      `pipeline.mock.wallet.address` in `localStorage` causes a `MOCKED`
      badge to appear next to the address row. This validates the
      `isMockKeyPresent` plumbing without testing the wallet module itself
      (which already has its own coverage).

13. **Regenerate the route tree.**
    - Run `yarn workspace @pipeline/frontend dev` once (or `yarn workspace @pipeline/frontend build`) so TanStack's generator updates
      `src/routeTree.gen.ts` with the new `/test` route.
    - Commit the regenerated `routeTree.gen.ts` alongside the new route file.

14. **Update `wallet/README.md`.**
    - Add `isMockKeyPresent` to the "Public API" list with a one-liner: "Non-reactive helper that returns `true` when a `pipeline.mock.wallet.*` key is currently set in `localStorage`. Used by the `/test` diagnostic page to render `MOCKED` badges."

15. **Lint & validate.**
    - Run `yarn workspace @pipeline/frontend lint` (or the repo-wide equivalent) — must pass with no ESLint errors. In particular, confirm no `wagmi`/`viem`/AppKit imports leaked into `routes/test.tsx`.
    - Run `npx tsx scripts/lint-docs.ts` since `wallet/README.md` was edited.

## Test Strategy

- **Unit/smoke test (new):** `routes/test.test.tsx` — renders the page,
  asserts the four section headings are present (`Environment`, `Wallet`,
  `DepositManager`, etc.), and verifies that setting a mock key in
  `localStorage` causes a `MOCKED` badge to appear next to the relevant row
  on re-render.
- **`isMockKeyPresent` unit coverage:** add one or two cases to
  `packages/frontend/src/wallet/mock.test.ts` covering present / absent keys
  (cheap; the function is one line but the public surface should be
  exercised).
- **Manual verification (run by the coder before opening the PR):**
  - With no env vars set, `/test` renders, shows the zero-address flag and
    `replace-me` flag, and the DM/USDC sections cleanly show `—`/`undefined`.
  - Paste the README's "Simulate connected wallet with 1,000 USDC" snippet
    into DevTools — all relevant rows flip to mocked, the `MOCKED` badge
    appears next to them, and no console errors are emitted.
  - Click each `Trigger` button while corresponding mock keys are present —
    confirm the row shows `isPending → isSuccess` and `data` contains the
    mocked hash; verify the confirm dialog fires.
  - Click `Trigger requestDeposit` with no mock key set and `DEPOSIT_MANAGER_ADDRESS`
    at zero — confirm the error message surfaces ("DepositManager not configured").
- **No new e2e / ux-tester pass required.** Issue is explicit that this is a
  diagnostic page and no Figma reference exists. `ux-tester` is skipped for
  this Issue.

## Docs to Update

- `packages/frontend/src/wallet/README.md` — add `isMockKeyPresent` to the
  public API list.
- No `docs/product-specs/` change — `/test` is a developer-facing diagnostic
  page, not user-facing product behavior, so the product spec is unaffected.
- No `docs/design-docs/` change — utilitarian page, no design intent.
- `docs/frontend/index.md` / `docs/frontend/hooks.md` — add a short pointer
  to the `/test` route and `isMockKeyPresent` in the existing hooks
  reference. One-paragraph addition only.
