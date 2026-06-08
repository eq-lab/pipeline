# Issue #520: Deposit/withdraw page: no wallet-disconnected state — shows disabled step card instead of "Connect your wallet first" banner

Source: https://github.com/eq-lab/pipeline/issues/520

Parent epic: #498 (Deposit/withdraw page).

## Scope

On the deposit/withdraw page (`/deposit`, both `direction=deposit` and `direction=withdraw`), when the wallet is **not connected** the page currently renders the three-step `StepsCard` with every step button disabled (see mobile init / connected reference 1993-7701). The Figma "Wallet not connected" state (desktop node-id 1994-6885) instead replaces the steps with a single yellow banner reading **"Connect your wallet first"** plus a dark **Connect** button that opens the wallet-connect flow.

In scope:

- Add a disconnected-state banner to `packages/frontend/src/routes/deposit.tsx` that renders in place of the `StepsCard` (and in place of the low-balance banner) when `isConnected === false`, for **both** directions.
- Wire the banner's "Connect" button to `connect()` from `useEvmWallet()` (the same connect mechanism the home page uses).
- Update the existing `-deposit.test.tsx` disconnected-state tests, which currently assert the disabled-steps behaviour, to assert the new banner instead.

Out of scope:

- No changes to the connected-state step flow, low-balance banner logic, unreachable-contract banner, or any wallet/connect plumbing (`useEvmWallet.connect()` already exists and is reused as-is).
- No new shared UI component in `@pipeline/ui` — the banner reuses the existing `Card variant="yellow"` pattern already present in this file for the low-balance banner.
- No dedicated mobile-only layout work: the page is a single responsive `max-w-lg` column; the banner stacks responsively the same way the existing low-balance banner does. (See Open Questions re: mobile design reference.)

## Assumptions and Risks

- **Conditional ordering.** The page currently renders, in order: `isManagerUnreachable` banner → (deposit-only) low-balance banner → `StepsCard`. The disconnected banner must take precedence over the low-balance and steps branches but should sit **after** the `isManagerUnreachable` check (which is itself gated on `isConnected`, so it can never trigger while disconnected — meaning practically the disconnected banner can be the first branch). Plan: add `!isConnected` as the first branch of the conditional so it wins for both directions.
- **Both directions.** The Figma reference is the deposit direction, but the disconnected state is wallet-level, not direction-specific. The banner applies identically to `direction=withdraw`. Copy stays "Connect your wallet first" for both (no token name in the string per Figma).
- **Copy/visual fidelity.** Figma node 1994-6885 banner: body text "Connect your wallet first" (Graphik LC Regular, body/16px, `--color-pipeline-ink`), dark button "Connect" (Graphik LC Semi Bold, white text, `--color-pipeline-ink` fill). This maps to the existing `Card variant="yellow"` + `Button variant="primary-dark"` already used by the low-balance banner, so token usage is consistent and no raw hex is introduced.
- **Test churn.** Two existing test blocks assert the OLD (buggy) behaviour and WILL fail after the fix:
  - `Deposit page — disconnected wallet` → `renders all step buttons as disabled when disconnected` (line ~765) and `does NOT show the low-balance banner when disconnected` (~777).
  - `Deposit page — direction=withdraw — disconnected wallet` → `renders all step buttons as disabled when disconnected` (~1744).
  These must be rewritten to assert the banner is shown and the StepsCard is absent. This is intended behaviour change, not a regression.
- Low risk: change is localised to one route file plus its test file; `connect()` is already battle-tested by the home route.

## Open Questions

- Mobile design: the epic lists a desktop "Wallet not connected" frame (1994-6885) but no mobile equivalent. The page renders a single responsive `max-w-lg` column, so the banner will reflow on mobile the same way the existing low-balance banner does. Confirm this is acceptable, or provide a mobile "wallet not connected" Figma frame if a distinct mobile treatment is required.

## Implementation Steps

1. In `packages/frontend/src/routes/deposit.tsx`, destructure `connect` from `useEvmWallet()` (line ~133: `const { address, isConnected, connect } = useEvmWallet();`).
2. In the conditional render block (currently starts at line ~820 with `{isManagerUnreachable ? (...)`), add a new **first** branch for `!isConnected`:
   - Render `<Card variant="yellow" data-testid="connect-wallet-banner" className="flex flex-row items-center justify-between gap-4">`.
   - Left: a `<p>` with body typography reading `Connect your wallet first` (mirror the classes used by the low-balance banner's body text).
   - Right: `<Button variant="primary-dark" className="whitespace-nowrap" onClick={connect}>Connect</Button>`.
   - This branch precedes `isManagerUnreachable`, the low-balance branch, and both `StepsCard` branches, so it wins for both `deposit` and `withdraw` directions when disconnected.
3. Keep all hooks unconditional (no change needed — only the JSX branch order changes; React Rules of Hooks remain satisfied).
4. Verify the connected-state branches are otherwise untouched (low-balance banner, unreachable banner, deposit/withdraw StepsCards).

## Test Strategy

File: `packages/frontend/src/routes/-deposit.test.tsx` (Vitest + Testing Library; disconnected scenarios use `seedBaseMocks({ connected: false })` / `seedWithdrawMocks({ connected: false })`).

- **Rewrite** `Deposit page — disconnected wallet`:
  - Replace `renders all step buttons as disabled when disconnected` with a test asserting the banner is shown: `getByText("Connect your wallet first")` present, and `queryByRole("button", { name: "Approve" })` / `Confirm` / `Claim` are **absent** (StepsCard not rendered).
  - Keep/adjust `does NOT show the low-balance banner when disconnected` (still valid — low-balance banner must not appear).
  - Add: clicking the "Connect" button invokes `connect()`. The wallet mock's `connect` resolves via `useAppKit().open`; assert against the existing AppKit `open` mock (see how `RecentActivityCard.test.tsx` / index tests mock `openConnectModal`/AppKit) — or assert the button is enabled and labelled "Connect". Prefer asserting the click handler fires by spying on the AppKit `open` mock if the test harness already stubs `useAppKit`; otherwise assert presence + enabled state of the Connect button.
- **Rewrite** `Deposit page — direction=withdraw — disconnected wallet`:
  - Replace `renders all step buttons as disabled when disconnected` with a test asserting the same banner ("Connect your wallet first") is shown and the withdraw StepsCard labels (`Allow Pipeline to use PLUSD`) are absent.
- **Regression guards** (verify still pass): connected-state tests for both directions still render the StepsCard; low-balance banner still shows when connected with sub-min balance; unreachable banner unaffected.
- Run `yarn workspace @pipeline/frontend test` (or the repo's `test-fast`) and confirm green. Run `npx tsx scripts/lint-docs.ts` after touching this doc.

## Docs to Update

- No product-spec change: this is a fix aligning the UI to the existing Figma "Wallet not connected" state; deposit/withdraw product behaviour is unchanged.
- Update the JSDoc header in `packages/frontend/src/routes/deposit.tsx` to mention the disconnected-state banner and its Figma node (1994-6885), consistent with the existing Figma-reference comments in that file.
- No new entries in `docs/frontend/utils.md` or `docs/frontend/hooks.md` (no new shared util/hook introduced).
