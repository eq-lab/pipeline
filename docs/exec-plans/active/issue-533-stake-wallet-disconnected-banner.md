# Issue #533: Stake/unstake page: missing wallet-disconnected state (desktop + mobile)

Source: https://github.com/eq-lab/pipeline/issues/533

Parent epic: #531 (Stake/unstake page).

## Scope

On the `/stake` page (both `stake` and `unstake` tabs), when the wallet is **not
connected** the page currently renders the `StepsCard` with every step button
disabled (`disabled: !canApprove`, `!canStake`, `!canUnstake` — all gated on
`isConnected`). The Figma "Wallet not connected" state (desktop node-id
1994-7280) instead **replaces the StepsCard** with a single yellow banner reading
**"Connect your wallet first"** plus a dark **Connect** button that opens the
wallet-connect flow. The input card (tab switcher + token input) and the output
card (preview + exchange rate + network fee) remain rendered above the banner —
see Figma; only the steps card is swapped.

This is the direct stake-page equivalent of the deposit/withdraw fix #520, which
established the pattern. Reuse that pattern; do not invent new components.

In scope:

- Add a disconnected-state banner to `packages/frontend/src/routes/stake.tsx`
  that renders **in place of** the `StepsCard` (the `isStakeTab ? <StepsCard…> :
  <StepsCard…>` block at lines ~329-363) when `isConnected === false`. The
  banner applies to **both** tabs (stake and unstake) — the disconnected state is
  wallet-level, not tab-specific.
- Wire the banner's "Connect" button to `connect()` from `useEvmWallet()` (the
  same mechanism deposit.tsx and the home route use).
- Update the existing disconnected-state tests in
  `packages/frontend/src/routes/-stake.test.tsx` (currently assert the
  disabled-step behaviour) to assert the new banner instead.

Out of scope:

- No changes to the connected-state flow: input card, output card, step gates
  (`canApprove`/`canStake`/`canUnstake`), preview/exchange-rate hooks, tab-switch
  reset, or balance-refetch effects are all untouched.
- No new shared UI component in `@pipeline/ui` — the banner reuses the existing
  `Card variant="yellow"` + `Button variant="primary-dark"` pattern, copied
  verbatim from deposit.tsx (#520).
- No wallet/connect plumbing changes — `useEvmWallet().connect()` already exists.
- No dedicated mobile-only layout: the page is a single responsive `max-w-lg`
  column; the banner reflows on mobile identically to deposit/withdraw, which is
  the resolved pattern from epic #498 / #520 (maintainer confirmed responsive
  reflow is the intended mobile treatment — see Assumptions).

## Assumptions and Risks

- **Banner replaces the StepsCard only, not the whole page.** Unlike deposit.tsx
  — where `!isConnected` is the first branch of a conditional that owns the
  entire lower section (steps OR low-balance OR unreachable banner) — the stake
  page has no low-balance/unreachable banners; the conditional region is exactly
  the `StepsCard` block. So the cleanest change is to wrap the existing
  `isStakeTab ? <StepsCard/> : <StepsCard/>` ternary with an outer
  `!isConnected ? <banner/> : ( …existing ternary… )`. The Figma (node 1994-7280)
  confirms the input and output cards stay visible above the banner.
- **Both tabs, single banner.** The banner copy carries no token name ("Connect
  your wallet first"), so the same banner serves both stake and unstake tabs. No
  per-tab branching needed inside the disconnected branch.
- **Mobile pattern is resolved.** Epic #498 / issue #520 resolved the identical
  open question: maintainer confirmed mobile uses the same yellow banner with
  responsive `max-w-lg` reflow (no distinct mobile frame). #533 explicitly says
  "follow the Deposit/withdraw page mobile disconnected pattern (#520)", so this
  is carried over — not a new open question.
- **Copy/visual fidelity.** Figma node 1994-7280 banner: body text "Connect your
  wallet first" (body/16px, `--color-pipeline-ink`), dark "Connect" button
  (white text, `--color-pipeline-ink` fill). This maps exactly to deposit.tsx's
  existing markup (`Card variant="yellow"` + `<p>` body typography + `Button
  variant="primary-dark"`), so no raw hex / off-token values are introduced.
- **`Button` is not yet imported in stake.tsx.** The current import from
  `@pipeline/ui` (lines 4-12) does not include `Button`; it must be added.
- **Test churn (intended behaviour change).** Two existing tests in the
  `Stake page — disconnected wallet` describe block assert the OLD (buggy)
  behaviour and WILL fail after the fix:
  - `renders all step buttons as disabled when disconnected (Stake tab)` (~line 851)
  - `renders Unstake button as disabled when disconnected` (~line 861)
  Both must be rewritten to assert the banner is present and the StepsCard
  buttons are absent. This is intended, not a regression.
- Low risk: change is localised to one route file plus its test file;
  `connect()` is already exercised by the deposit route and home route.

## Open Questions

_None_ — the desktop Figma (node 1994-7280) is provided, the mobile treatment is
the resolved #520 responsive-reflow pattern (explicitly referenced by the
issue), and the implementation reuses deposit.tsx's existing banner markup
verbatim.

## Implementation Steps

1. In `packages/frontend/src/routes/stake.tsx`, add `Button` to the `@pipeline/ui`
   import block (lines 4-12), e.g. insert `Button,` before `Card,`.
2. Destructure `connect` from `useEvmWallet()` at line 68:
   change `const { isConnected } = useEvmWallet();` to
   `const { isConnected, connect } = useEvmWallet();`.
3. Wrap the existing steps ternary (the `{isStakeTab ? (<StepsCard…/>) : (<StepsCard…/>)}`
   block at lines ~328-363) with an outer `!isConnected` guard:
   - When `!isConnected`, render the disconnected banner (copy verbatim from
     `deposit.tsx` lines 829-846, minus the surrounding conditional):
     ```tsx
     <Card
       variant="yellow"
       data-testid="connect-wallet-banner"
       className="flex flex-row items-center justify-between gap-4"
     >
       <p className="font-[family-name:var(--font-body)] text-[length:var(--text-pipeline-body)]">
         Connect your wallet first
       </p>
       <Button
         variant="primary-dark"
         className="whitespace-nowrap"
         onClick={connect}
       >
         Connect
       </Button>
     </Card>
     ```
     Add a comment noting the Figma node: `/* Wallet-not-connected banner. Figma: node 1994-7280. */`.
   - When connected, render the existing `isStakeTab ? <StepsCard/> : <StepsCard/>`
     ternary unchanged.
4. Keep all hooks unconditional (only JSX branch order changes — Rules of Hooks
   stay satisfied). Do not touch the input card, output card, step gates, preview
   hooks, tab-switch handler, or refetch effects.
5. Update the route's JSDoc header (lines 25-51) to document the
   wallet-disconnected banner state and its Figma node (1994-7280), mirroring the
   "Wallet-disconnected state" JSDoc block already present in deposit.tsx
   (lines 99-111).

## Test Strategy

File: `packages/frontend/src/routes/-stake.test.tsx` (Vitest + Testing Library;
disconnected scenarios use `seedBaseMocks({ connected: false })`).

- **Rewrite** the two tests in `describe("Stake page — disconnected wallet", …)`:
  - Replace `renders all step buttons as disabled when disconnected (Stake tab)`
    with a test asserting the banner is shown and the StepsCard is gone:
    `getByText("Connect your wallet first")` present (or
    `getByTestId("connect-wallet-banner")`), and
    `queryByRole("button", { name: "Approve" })` / `Stake` are **absent**.
  - Replace `renders Unstake button as disabled when disconnected` with a test
    that switches to the Unstake tab and asserts the same banner is shown and
    `queryByRole("button", { name: "Unstake" })` is **absent** (banner is
    tab-agnostic).
- **Add** a test asserting the "Connect" button is enabled and labelled
  "Connect"; optionally assert clicking it invokes `connect()` by spying on the
  AppKit `open` mock — note the test file already stubs
  `useAppKit(() => ({ open: vi.fn() }))` (line ~95) and the terms gate; prefer the
  simpler presence + enabled assertion if wiring the spy through `useWalletGate`
  proves brittle, mirroring how #520's tests handled it.
- **Regression guards** (verify still pass): connected-state tests
  (`approve needed state`, `approved state`, `Unstake tab`, `zero balance`,
  `step labels`, `amount exceeds balance`, `cross-tab reset`) still render the
  StepsCard. The `zero balance` block in particular asserts both step buttons
  render when connected — confirm the new `!isConnected` wrapper does not affect
  the connected path.
- Run `yarn workspace @pipeline/frontend test` (or the repo `test-fast`) and
  confirm green. Run `npx tsx scripts/lint-docs.ts` after editing this doc.

## Docs to Update

- No product-spec change: this aligns the UI to the existing Figma
  "Wallet not connected" state; stake/unstake product behaviour is unchanged.
- Update the JSDoc header in `packages/frontend/src/routes/stake.tsx` to document
  the disconnected-state banner and its Figma node (1994-7280) — covered by
  Implementation Step 5.
- No new entries in `docs/frontend/*` (no new shared util/hook/component).
