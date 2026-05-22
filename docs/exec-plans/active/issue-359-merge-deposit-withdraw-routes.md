# Issue #359: /deposit ↔ /withdraw — merge into one route, switch via URL param + the swap button between inputs

Source: https://github.com/eq-lab/pipeline/issues/359

Figma reference (swap button styling): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100157&m=dev
Figma reference (deposit page): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100812&m=dev
Figma reference (withdraw page): https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100351&m=dev

## Scope

Merge the near-identical `/deposit` (560 lines) and `/withdraw` (490 lines) three-step conversion routes into a single `/deposit` route whose direction is driven by a `?direction=deposit|withdraw` search param. Promote the existing swap-vertical icon between the two `TokenInput`s in `ConversionCard` from a decorative element into an interactive button that flips the direction and rewrites the URL.

### In scope

- `packages/frontend/src/routes/deposit.tsx` — generalize to handle both directions via TanStack Router `validateSearch`. Pick hooks/contracts/copy/quick-amounts conditionally on direction. Keep all hooks called unconditionally (Rules of Hooks); gate writes/effects/voucher fetches on direction.
- `packages/frontend/src/routes/withdraw.tsx` — convert to a redirect-only file route. Use `beforeLoad` returning `redirect({ to: "/deposit", search: (prev) => ({ ...prev, direction: "withdraw" }), replace: true })`. Preserve any incoming non-`direction` search params.
- `packages/frontend/src/routes/-withdraw.test.tsx` — fold representative cases into `-deposit.test.tsx` under a `describe("Deposit page — direction=withdraw")` block; delete the file. Add a new `describe` covering the direction toggle and the redirect contract.
- `packages/frontend/src/components/TopBar.tsx` — drop the `pathname === "/withdraw"` branch in `derivedActive`; only `/deposit` is needed.
- `packages/frontend/src/components/TopBar.test.tsx` — update / delete the `/withdraw` highlight test (line 220 area). A new test asserts `/deposit?direction=withdraw` still highlights Convert.
- `packages/ui/src/components/ConversionCard/ConversionCard.tsx` — add `onSwap?: () => void` to `ConversionCardProps`; wrap the swap-vertical glyph in a real `<button type="button" aria-label="Switch direction" onClick={onSwap}>`. Remove `aria-hidden="true"` from the button wrapper (the inner `<img>` stays `aria-hidden`). When `onSwap` is undefined or either side's `disabled` is true, render the button with the HTML `disabled` attribute so it cannot fire mid-tx.
- `packages/ui/src/components/ConversionCard/ConversionCard.stories.tsx` — add a `Interactive` story showing the swap button with a wired `onSwap` handler.
- `packages/frontend/src/routeTree.gen.ts` — regenerated automatically by the TanStack Router plugin on the next `vite dev` / `vite build`. Commit the regenerated file.

### URL contract

```
/deposit                          → direction = "deposit"
/deposit?direction=deposit        → direction = "deposit"
/deposit?direction=withdraw       → direction = "withdraw"
/deposit?direction=<anything>     → falls back to "deposit"
/withdraw                         → redirect to /deposit?direction=withdraw   (replace, not push)
/withdraw?foo=bar                 → redirect to /deposit?direction=withdraw&foo=bar
```

### Out of scope

- Visual redesign — this is a refactor + behavior change. No Figma changes expected for the page layout. The swap button styling stays exactly as designed (Figma 1498-100157).
- The `/withdraw` balance/input dead-state issue — already fixed and closed (#354).
- Persisting the user's last-used direction beyond the URL (no localStorage, no cookies).
- Adding a Deposit↔Withdraw nav entry-point — the TopBar still has a single "Convert" icon.
- Changing the underlying wallet/api hooks (`useDepositManagerAddresses`, `useWithdrawalQueueAddresses`, `useRequestDeposit`, `useRequestWithdrawal`, `useClaim`, `useClaimWithdrawal`, `useDepositVoucher`, `useWithdrawalVoucher`). They are composed differently — never changed.
- Sharing the toast `id` namespace across directions. Each direction keeps its existing scoped ids (`approve-tx`, `deposit-tx`, `claim-tx` for deposit; `withdraw-approve-tx`, `withdraw-tx`, `withdraw-claim-tx` for withdraw) so a stale toast from a prior direction does not collide with a new one after a swap.

## Assumptions and Risks

- **Assumption**: TanStack Router's `validateSearch` + `redirect()` API surface available in this repo is the one used at `packages/frontend/src/routes/test.tsx:55` (`validateSearch: (raw) => { … }`). The redirect form `redirect({ to, search, replace: true })` from `beforeLoad` is the canonical pattern in `@tanstack/react-router` v1.
- **Assumption**: All eight per-direction hooks may be called unconditionally per render (React's Rules of Hooks). Each hook either no-ops gracefully when its inputs are gated to `undefined` / zero-address (already true for `useToken`, `useDepositVoucher`, `useWithdrawalVoucher` — they accept `undefined` request ids and bail) **or** must be guarded so the inactive direction does not issue contract reads/polls. **Verify per hook during implementation** — for any hook that polls/reads unconditionally even when its primary arg is undefined, gate it by passing a sentinel (zero-address) **and** ignore its returned data when the direction is inactive. The plan calls this out explicitly in the implementation steps.
- **Risk — toast-id collision after swap**: if the user fires step 2 on deposit, sees the pending toast, then swaps to withdraw, the deposit toast must not be replaced by a withdraw toast under the same id. Mitigation: keep the existing scoped ids (different per direction) and additionally clear/reset both react-query writeContract state slices (`requestDeposit.reset()` / `requestWithdrawal.reset()`) is **out of scope** — the issue specifies "reset the amount input to empty"; tx state on the inactive direction is allowed to persist and will surface again if the user swaps back. Document this in the file's docstring.
- **Risk — voucher fetch on the wrong direction**: a stale `requestId` from the previous direction must not feed `useDepositVoucher` after a swap to withdraw (and vice versa). Mitigation: `voucherRequestId` is computed only from the active-direction `activeRequest`/`requestId` chain. Inactive direction passes `undefined` → the hook is disabled.
- **Risk — `requests.filter(r.type === …)`**: the `useRequests` poll returns *all* request types; the active-direction selector must filter on `r.type === "Deposit"` xor `"Withdraw"` driven by the param. A bug here would surface another direction's request in the wrong UI.
- **Risk — TopBar test churn**: `TopBar.test.tsx:220` asserts `/withdraw` highlights Convert. Once `/withdraw` redirects, the router-state for that pathname will be `/deposit` (because the redirect lands there before the component renders). The replacement test must mount the router at `/deposit?direction=withdraw` and assert the Convert highlight.
- **Risk — generated routeTree drift**: `routeTree.gen.ts` is auto-generated. Coder must run `yarn workspace @pipeline/frontend dev` (or `build`) once to regenerate and commit the result. The generated file must keep `/withdraw` listed (because the redirect route still exists as a file route), only its body changes from a component to a `beforeLoad` redirect.
- **Risk — `requests.filter` selector reads `r.type` literally**. Confirm the discriminated-union field name is `type` not `request_type` by reading `packages/frontend/src/api/useRequests.ts` (the existing routes both use `r.type === "Deposit"|"Withdraw"`, so this is safe).
- **Risk — search-param "any value" normalization**. `validateSearch` runs before `beforeLoad`. Setting `validateSearch: (raw) => ({ direction: raw?.direction === "withdraw" ? "withdraw" : "deposit" })` discards all other search params unless we explicitly spread them. Mitigation: validate **only** `direction` and treat unknown keys as `unknown` to preserve them (or explicitly drop everything else — the issue only mentions `direction`, so dropping is acceptable for `/deposit`). For the `/withdraw` redirect, the issue's URL contract says `/withdraw?...` should "preserve any other params" — implement that with `redirect({ to: "/deposit", search: (prev) => ({ ...prev, direction: "withdraw" }), replace: true })` so unknown params survive the hop. After the redirect, `validateSearch` on `/deposit` will drop unknowns; **call this out**: preserved cross-hop, dropped on landing. Acceptable, since today's `/withdraw` has no other meaningful search params anyway.

## Open Questions

- **Q1**: Should `requestDeposit`/`requestWithdrawal` (wagmi write state) and their toast trackers (refs that detect edge transitions) be reset when the user swaps direction with an in-flight or recently-resolved tx on the other side? The issue requires resetting **the amount input**, but is silent on tx/toast state. Default below: **no** (preserve state — swapping back recovers the in-flight view). Flagging because the alternate stance (reset both sides on swap to avoid stale toasts ever rendering on the wrong page) is also defensible. The manager / human reviewer should decide.
- **Q2**: When `/withdraw` redirects to `/deposit?direction=withdraw`, should the redirect use HTTP-style `replace: true` (no history entry — issue says yes) **even when** the user landed on `/withdraw` from an external link (so back-button leaves the site)? The issue says `replace: true` for the swap-button-triggered URL change; the `/withdraw` redirect on initial load is a separate scenario. Default below: **also `replace: true`** so a stale bookmark/link doesn't pollute history with an unreachable `/withdraw` entry. Confirm.
- **Q3**: Should the swap button be disabled during *any* in-flight on-chain action on the active side (`isApprovePending`, `requestDeposit.isPending`, `claim.isPending`, `isPendingVerification`, etc.) or only on the narrower "input disabled" condition the issue specifies (`disabled` is true on either `TokenInput` / `TokenAmountDisplay`)? Default below: **mirror the issue spec verbatim** — disable when either side's `disabled` is true. The active in-flight state already disables `TokenInput` via `isAmountLocked`, so the practical outcome covers the common cases.

## Implementation Steps

The numbering reflects a dependency-friendly order; tests are added alongside their implementation step.

### 1. Promote the ConversionCard swap button to interactive

File: `packages/ui/src/components/ConversionCard/ConversionCard.tsx`.

- Extend `ConversionCardProps` with `onSwap?: () => void`.
- Replace the existing `<div … aria-hidden="true">…<img/></div>` (lines 108–123) with `<button type="button" aria-label="Switch direction" onClick={onSwap} disabled={!onSwap || input.disabled || output.disabled} className={…}>` containing the existing gradient `<div>` styling on the button itself (or keep the `<div>` as a child of the button — whichever preserves the Figma look). Keep the inner `<img>` `aria-hidden="true"` (decorative).
- Preserve the gradient + positioning classes verbatim — Figma node 1498-100157 spec.
- Add `cursor-pointer` and a focus ring (`focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-pipeline-ink)]`) consistent with the TopBar pill trigger. Tokenised — no raw colors.
- Update the JSDoc block (lines 11–40) to mention the new `onSwap` prop and the disabled-when-either-side-disabled behaviour.
- Update `packages/ui/src/components/ConversionCard/ConversionCard.stories.tsx`: add an `Interactive` story with an in-story `useState` to flip a label and demonstrate the click.

**Unit test:** new `packages/ui/src/components/ConversionCard/ConversionCard.test.tsx` (or extend an existing test if one exists — see `ls packages/ui/src/components/ConversionCard/` first). Cases:
- Renders the swap button with the `Switch direction` accessible name.
- Click fires `onSwap`.
- `disabled` on either side disables the button (click does not fire).
- Omitting `onSwap` disables the button.

### 2. `validateSearch` on `/deposit`

File: `packages/frontend/src/routes/deposit.tsx`.

- Replace `export const Route = createFileRoute("/deposit")({ component: Deposit });` (lines 558–560) with:
  ```ts
  type Direction = "deposit" | "withdraw";
  export const Route = createFileRoute("/deposit")({
    validateSearch: (raw): { direction: Direction } => ({
      direction: raw?.direction === "withdraw" ? "withdraw" : "deposit",
    }),
    component: Deposit,
  });
  ```
  Pattern matches the existing precedent in `packages/frontend/src/routes/test.tsx:55`.
- Inside `Deposit()`, read the direction via `Route.useSearch().direction` (TanStack Router hook). Bind to a local `direction` const.

### 3. Generalize the Deposit component to handle both directions

Still in `packages/frontend/src/routes/deposit.tsx`. The component must call **all** hooks unconditionally; behaviour branches on `direction`.

- **Imports** — add `useRequestWithdrawal`, `useClaimWithdrawal`, `useWithdrawalQueueAddresses`, `useWithdrawalVoucher`, and `useNavigate` is already there.
- **Hook calls** — call **both** `useDepositManagerAddresses()` and `useWithdrawalQueueAddresses()` every render. Similarly call **both** `useRequestDeposit()`/`useRequestWithdrawal()` and **both** `useClaim()`/`useClaimWithdrawal()`. Verify each hook is safe to call when its inputs/data are unused (smoke-check by reading the hook source).
- **`useToken` is called twice with different `token` + `spender`** — call both, but only render with the active one. Both hooks return safe `undefined`s when their `token` is the zero address (verified in deposit.tsx today). Compute the active `{ decimals, balance, formattedBalance, allowance, approve, isApprovePending, isApproveSuccess, refetchBalance }` via a ternary on `direction`.
- **Voucher** — compute two `voucherRequestId` candidates, one per direction, but only the active one is non-undefined; pass that to the relevant voucher hook. Pass `undefined` to the inactive voucher hook (which already disables internally).
- **`activeRequest` selector** — replace the literal `r.type === "Deposit"` with `r.type === (direction === "deposit" ? "Deposit" : "Withdraw")`.
- **Derived state** — per-direction differences to preserve:
  - **`hasBalance` / `meetsMin` / low-balance banner**: deposit-only (issue specifies no low-balance banner on withdraw). Gate the entire low-balance branch on `direction === "deposit"`.
  - **`needsApproval`**: same formula for both directions.
  - **`hasSufficientAllowance`** (the positive predicate from #312): keep using it for the **withdraw** step 1/2 derivation; use the existing `!needsApproval && amountBig > 0n && isConnected` form for **deposit**. The asymmetry is intentional and tracked in #312's plan — preserve it.
  - **`canDeposit`** (withdraw-only, "amount ≤ balance"): keep this gate when `direction === "withdraw"`.
  - **Quick-amount chips**: a `direction === "deposit"` value yields `["Min", "$5,000", "$10,000", "Max"]` with the Min chip wired to `minDeposit`. A `direction === "withdraw"` value yields `["25%", "50%", "75%", "Max"]`. Pull the existing logic verbatim from each route.
  - **Token labels and `exchangeRate` copy**: `direction === "deposit"` → `input.tokenLabel="USDC"`, `output.tokenLabel="PLUSD"`, `"1 USDC = 1 PLUSD"`. Withdraw flips both labels and uses `"1 PLUSD = 1 USDC"`.
  - **Step labels**: deposit uses "Allow Pipeline to use USDC" / "Confirm USDC transfer" / "Claim your PLUSD". Withdraw uses "Allow Pipeline to use PLUSD" / "Confirm PLUSD burn" / "Claim your USDC".
  - **Toast ids**: keep the existing per-direction scoping verbatim — no shared ids across directions.
- **Unreachable-contract banner**: render the deposit-direction banner (`isManagerUnreachable`) only when `direction === "deposit"`, and the withdraw-direction banner (`isQueueUnreachable`) only when `direction === "withdraw"`. Both already exist; gate them on direction.
- **`useEffect` blocks**: every existing effect (toast emission, balance refetch, amount-lock sync) must short-circuit when the direction's `requestDeposit` / `requestWithdrawal` / `claim` / `claimWithdrawal` state is not the active one. Easiest pattern: wrap the per-direction effects in `if (direction !== "deposit") return;` (or `withdraw`) early returns. Hooks are still called unconditionally.

### 4. Wire the swap button

Still in `packages/frontend/src/routes/deposit.tsx`.

- Inside `Deposit()`, get `const navigate = useNavigate()` (already imported).
- Build `onSwap`:
  ```ts
  const onSwap = useCallback(() => {
    const next: Direction = direction === "deposit" ? "withdraw" : "deposit";
    setAmountInput("");
    void navigate({
      to: "/deposit",
      search: { direction: next },
      replace: true,
    });
  }, [direction, navigate]);
  ```
  - Reset the amount input to empty (issue spec). Do **not** clear toast state or write-contract state — see Open Question Q1; defaulting to "preserve" per assumption above.
- Pass `onSwap` into `<ConversionCard … onSwap={onSwap} />`.

### 5. Convert `/withdraw` to a redirect-only route

File: `packages/frontend/src/routes/withdraw.tsx`.

Replace the entire 490-line file with:

```ts
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /withdraw is now a one-time redirect to /deposit?direction=withdraw.
 * Direction is driven by the search param on /deposit; the route file is kept
 * so external links / bookmarks to /withdraw continue to work.
 *
 * `replace: true` keeps the redirect out of the back-button history so users
 * who reload do not see /withdraw flash before /deposit, and back-button does
 * not accumulate redirect hops. Any incoming search params are preserved.
 */
export const Route = createFileRoute("/withdraw")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/deposit",
      search: { ...(search as Record<string, unknown>), direction: "withdraw" },
      replace: true,
    });
  },
});
```

Verify the exact `redirect` import and signature against `@tanstack/react-router` types — adjust if the search shape needs an explicit cast for `validateSearch` compatibility.

### 6. TopBar simplification

File: `packages/frontend/src/components/TopBar.tsx`.

- In `derivedActive` (line 71), drop `|| pathname === "/withdraw"`. The remaining `pathname === "/deposit"` branch is sufficient because the redirect lands there.
- Update the docstring (lines 27–34) to match — remove the `/withdraw → "deposit"` line and replace with `/deposit?direction=withdraw → "deposit"` (still via `pathname` only — direction is implicit).

### 7. Tests — fold withdraw cases into deposit test

File: `packages/frontend/src/routes/-deposit.test.tsx`.

- Mock the `useSearch` hook from `@tanstack/react-router` so each test can choose the direction. The existing `vi.mock("@tanstack/react-router", …)` already overrides `useNavigate`/`useRouterState`/`createFileRoute`. Add a per-test override for `Route.useSearch()` — easiest pattern: export a mutable mock from the test setup and have the deposit route call `Route.useSearch()` which the mock returns `{ direction }` from.
- Wrap existing tests in `describe("Deposit page — direction=deposit", …)` (or leave at the top level — those tests stay green with `direction=deposit` as default).
- Add a new top-level `describe("Deposit page — direction=withdraw", …)` block. Port the relevant tests from `-withdraw.test.tsx`:
  - Connected, balance > 0, allowance 0 → step 1 Approve enabled.
  - Allowance ≥ amount → step 2 Confirm enabled.
  - PendingVerification mock → step 2 loading state.
  - PendingClaim + voucher mock → step 3 enabled; click triggers `useClaimWithdrawal.write`.
  - Disconnected → step buttons disabled.
  - Quick-amount chips — 25% / 50% / 75% / Max.
  - Step labels render in order: "Allow Pipeline to use PLUSD" / "Confirm PLUSD burn" / "Claim your USDC".
- Add a new `describe("Deposit page — swap button", …)` block:
  - Renders ConversionCard with a Switch-direction button (querying by `aria-label`).
  - Clicking the swap button calls `navigate` with `{ to: "/deposit", search: { direction: "withdraw" }, replace: true }` (using a `vi.fn()` on the `useNavigate` mock).
  - Clicking the swap button clears the amount input (assert via the input's `value` going to `""`).
  - Swap button is disabled when `TokenInput` `disabled` is set (e.g. mock `isAmountLocked` true by seeding an active request) — assert the button has `disabled` attribute.

File: `packages/frontend/src/routes/-withdraw.test.tsx` — **delete** the file. Whatever residual coverage is unique (none expected — all behaviour is folded above) goes into the merged file.

### 8. Tests — redirect contract

Add a new test file `packages/frontend/src/routes/-withdraw-redirect.test.tsx` (or a top-level `describe` in `-deposit.test.tsx`). Cases:

- Mounting at `/withdraw` redirects to `/deposit?direction=withdraw` with `replace: true`.
- Mounting at `/withdraw?foo=bar` redirects to `/deposit?direction=withdraw&foo=bar`.

Use TanStack Router's `createMemoryHistory` + `createRouter` pattern (or, if the existing tests don't bootstrap the full router, an in-test `beforeLoad` invocation is acceptable). Read `packages/frontend/src/routes/-*.test.tsx` to find an existing pattern; if none exist, the simplest test imports `Route.options.beforeLoad` and asserts it throws a `redirect(...)` with the expected payload.

### 9. Tests — TopBar

File: `packages/frontend/src/components/TopBar.test.tsx`.

- Delete the existing "highlights Convert on /withdraw" test (line 220).
- Add a new test: mount the TopBar at `/deposit?direction=withdraw` (the test currently controls `pathname` via mocked `useRouterState`; pass `"/deposit"` since that is what TanStack Router exposes after the redirect — search params don't affect pathname-based highlight). Assert Convert is highlighted. This restores symmetry without re-introducing the `/withdraw` branch.

### 10. Regenerate routeTree + lint + test

- Run `yarn workspace @pipeline/frontend dev` once (or `yarn workspace @pipeline/frontend build`) to regenerate `packages/frontend/src/routeTree.gen.ts`. The file should still list `/withdraw` (the route file still exists, just as a redirect). Commit the regenerated file with the rest of the change.
- Run `yarn workspace @pipeline/frontend lint`.
- Run `yarn workspace @pipeline/frontend test` — must be green.
- Run `npx tsx scripts/lint-docs.ts` per AGENTS §Lint.

### 11. Docs

- `docs/STORIES.md` — update `TC-186-4: Same two-card layout on /withdraw` (line 552) to navigate via `/deposit?direction=withdraw` instead of `/withdraw`. Add a new test case under the same section asserting the swap button toggles direction and clears the input. Update the regression sweeps at lines 673 and 682 to `/`, `/deposit`, `/deposit?direction=withdraw`, `/stake`, `/transactions`.
- `docs/FRONTEND.md` — no change required; the deposit-page docstring inside `deposit.tsx` already documents the three-step flow. Update the file's JSDoc block to explain the new direction param. The wallet README reference at `packages/frontend/src/wallet/README.md:577` ("/withdraw page composes …") should be edited to say "the merged /deposit?direction=withdraw view composes …" — the underlying hooks are unchanged.
- `docs/product-specs/withdrawals.md` and `docs/product-specs/deposits.md` — verify whether either spec references the URL. Update any "navigate to /withdraw" copy to "navigate to /deposit?direction=withdraw" or to the symmetric phrasing "use the swap button on /deposit". (Read both files during implementation; if no URL strings are present, no change is needed.)
- `docs/exec-plans/active/issue-359-merge-deposit-withdraw-routes.md` — this plan. The manager archives it to `completed/` post-merge.

## Test Strategy

### Unit / integration (Vitest)

- **ConversionCard** (`packages/ui/src/components/ConversionCard/ConversionCard.test.tsx`) — covered in step 1.
- **Deposit page, direction=deposit** — existing `-deposit.test.tsx` cases continue to pass (14 scenarios already there).
- **Deposit page, direction=withdraw** — 10 ported scenarios in the new `describe` block (step 7).
- **Swap button** — 3 scenarios in the new `describe` block (step 7).
- **Withdraw redirect** — 2 scenarios in step 8.
- **TopBar** — Convert highlight on `/deposit` covers both directions (step 9).

### Manual (ux-tester)

Figma reference: https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1498-100157&m=dev

The ux-tester runs these in addition to the existing deposit / withdraw flows:

1. **Direct nav to `/withdraw`** redirects to `/deposit?direction=withdraw`. Address bar updates to the new URL. Browser back-button does not return to `/withdraw` (replace, not push).
2. **Direct nav to `/deposit`** lands on the deposit flow (USDC → PLUSD).
3. **Direct nav to `/deposit?direction=withdraw`** lands on the withdraw flow (PLUSD → USDC).
4. **Garbage direction param**: `/deposit?direction=hodor` falls back to deposit.
5. **Swap button click — deposit → withdraw**: amount input clears; URL becomes `/deposit?direction=withdraw`; token labels flip; quick-amount chips switch from `Min / $5k / $10k / Max` to `25 / 50 / 75 / Max`; exchange-rate copy flips; step labels flip. Browser back-button (after one swap) does **not** return to `/deposit` (replace).
6. **Swap button click — withdraw → deposit**: mirror of above.
7. **Swap button disabled mid-tx**: seed a `PendingVerification` request via `pipeline.mock.wallet.*` and `useRequests` mock, navigate to `/deposit`, verify the swap button is disabled and click does nothing.
8. **TopBar Convert icon stays highlighted** on both `/deposit` and `/deposit?direction=withdraw`.
9. **Existing flows regression**: walk the three-step deposit and three-step withdraw flows end-to-end (Approve → Confirm → Claim) per S-227 / S-307 in `docs/STORIES.md`. Both must still succeed against the mock layer.

### Regression sweep

- `yarn workspace @pipeline/frontend test` — full unit suite green.
- `yarn workspace @pipeline/frontend lint` — clean.
- `yarn workspace @pipeline/frontend build` — clean (regenerates `routeTree.gen.ts`).
- `npx tsx scripts/lint-docs.ts` — clean.

## Docs to Update

- `docs/STORIES.md` — TC-186-4 + regression sweep paths (step 11). Add a new TC for the swap-button toggle.
- `packages/frontend/src/wallet/README.md` — line 577 ("/withdraw page composes …") → rephrase to reflect the merged route (step 11).
- `packages/frontend/src/routes/deposit.tsx` — top-of-file JSDoc (lines 22–79) is significantly extended to describe the direction param, the swap button, and the per-direction hook split.
- `packages/frontend/src/components/TopBar.tsx` — JSDoc lines 27–34 (step 6).
- `packages/ui/src/components/ConversionCard/ConversionCard.tsx` — JSDoc lines 11–40 (step 1).
- `packages/ui/src/components/ConversionCard/ConversionCard.stories.tsx` — new Interactive story (step 1).
- `docs/product-specs/deposits.md` and `docs/product-specs/withdrawals.md` — verify and update URL references if present (step 11).
- `docs/exec-plans/active/issue-359-merge-deposit-withdraw-routes.md` — this plan. Manager archives on completion.
