# Issue #1196: No-XLM state on conversion: 'Add funds to your XLM balance' banner instead of trustline activation

Source: https://github.com/eq-lab/pipeline/issues/1196
Also closes: https://github.com/eq-lab/pipeline/issues/1130 (human-confirmed the same design covers the unfunded-account case)

Figma (source of truth for styles): full screen `6090-8741` ("No XLM balance to pay fee") — https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=6090-8741&m=dev; banner card node `6093-75787` (`card-horizontal`, yellow, title + caption + dark icon-button "Copy Address").

## Scope

When the connected Stellar wallet has no XLM (zero native balance, or the account does not exist on the ledger — Horizon 404), the trustline-enable / confirm / claim CTAs can never succeed. Instead of offering them:

- **Conversion page** (`routes/deposit.tsx`, both deposit and withdraw directions): render the "Add funds to your XLM balance / You need XLM to pay the network fee / Copy Address" banner in the existing banner-precedence slot, replacing the StepsCard.
- **Stake page** (`routes/stake.tsx`, both tabs): same banner in the StepsCard slot — this is the #1130 scope (its "Where" lists deposit/withdraw/stake). The Figma frame shows the conversion page; the banner component is reused verbatim on stake.
- New Stellar native-balance hook exposing the `accountExists`/zero-XLM discriminator that #1130 asked for (today Horizon 404 is folded into `hasTrustline: false` by `useStellarSacToken`/`useStellarToken`).

Out of scope: EVM (never shows the banner); `useStellarWithdrawalQueue` internals (the flow gate is at the page level); testnet Friendbot hint (#1130's provisional acceptance line — superseded by the final design, which has fixed copy with no testnet variant; human confirmed 2026-08-24); reserve-aware "enough XLM for trustline base reserve" math (see Assumptions).

## Assumptions and Risks

- **Trigger threshold is "zero or unfunded", not "balance < fee estimate".** The design's own top-bar shows a $0.00 wallet; a nonzero-but-below-fee XLM balance (fees are ~0.00001–0.005 XLM) is a negligible edge, and the fee-estimate simulation itself cannot run against an unfunded source account. If a finer reserve-aware check is ever wanted (trustline needs +0.5 XLM base reserve), log it in tech-debt — do not build it here.
- The banner replaces the StepsCard (and outranks the USDC-trustline and low-balance banners): the USDC-trustline banner's own action (`changeTrust`) requires XLM, so no-XLM must be checked first.
- The banner shows in **both** directions on the conversion page and both tabs on stake: the XLM requirement is direction-independent (every CTA in the card is a Stellar transaction). The Figma frame only depicts the deposit direction; the withdraw/stake usage reuses the identical component in the same slot.
- No flicker: the banner must not flash while the XLM query is still loading — the trigger is true only once the query has resolved (`accountExists === false || xlmRaw === 0n` with `xlmRaw !== undefined`), and the XLM query's first load joins the existing initial-data-load gate.
- Risk: an extra Horizon `loadAccount` call per page. Acceptable — same 30 s stale/refetch cadence as the existing token hooks, and react-query dedupes by key.

## Open Questions

_None_

## Implementation Steps

All steps completed 2026-08-24 (coder).

1. ✅ **New hook `packages/frontend/src/wallet/stellar/useStellarXlmBalance.ts`** (+ test file), mirroring `useStellarToken.ts` structure:
   - Horizon `loadAccount(address)`; pick the `asset_type === "native"` balance line.
   - Returns `{ xlmBalance: string | undefined, accountExists: boolean | undefined, isLoading, error, refetchBalance }`. Resolved 404 → `{ xlmBalance: "0", accountExists: false }`; account found → `accountExists: true`. Disconnected → all `undefined`.
   - Mock key `pipeline.mock.wallet.stellar.balance.xlm` (human-decimal string, matching `STELLAR_MOCK_KEYS` conventions in `wallet/stellar/mock.ts`); add the key to `STELLAR_MOCK_KEYS`.
   - `staleTime`/`refetchInterval` 30 s, `retry: false` — same as `useStellarSacToken`.
   - Export from the `@/wallet` barrel (`packages/frontend/src/wallet/index.ts`).
2. ✅ **`packages/frontend/src/wallet/useDepositFlow.ts`**: call `useStellarXlmBalance()` unconditionally; add to `FlowState`:
   - `needsXlmFunding: boolean` — Stellar path: connected && (`accountExists === false` || resolved `xlmBalance` parses to `0`); EVM path: always `false`.
   - Update the `FlowState` contract doc block pointer (spec change in step 7).
3. ✅ **`packages/frontend/src/wallet/useStakeFlow.ts`** (locate via `grep -rn "useStakeFlow" packages/frontend/src`): same `needsXlmFunding` field on its state shape, Stellar-only, same rule.
4. ✅ **Shared banner component `packages/frontend/src/components/XlmFundingBanner.tsx`**: yellow `Card` matching the existing `low-balance-banner` markup in `deposit.tsx` (`Card variant="yellow"`, title body text, caption subtitle, `Button variant="primary-dark"` compact) with copy per Figma node `6093-75787`:
   - Title "Add funds to your XLM balance"; subtitle "You need XLM to pay the network fee".
   - Button: copy icon + "Copy Address" (→ "Copied" for 2 s after click), copies the connected Stellar address via the same clipboard pattern as `deposit.tsx`'s `copyAddress`. Props: `address: string | undefined`; `data-testid="xlm-funding-banner"` (+ `-title`, `-subtitle`, `-action`).
   - Token-exact styling verified against the Figma node (border-b-3/border-r-3 yellow card, radius-xxl, body/caption type tokens) — reuse the existing `Card`/`Button` primitives; only add what they don't already provide.
5. ✅ **`packages/frontend/src/routes/deposit.tsx`**: insert into the banner-precedence chain after the initial-data-load gate and **before** the USDC-trustline banner: `isStellar && flow.needsXlmFunding` → `<XlmFundingBanner address={flow.address} />`. Applies in both directions (no `isDeposit` guard). Fold the XLM query's first load into `isInitialDataLoad` (via `flow.isDataPending` if that's where the gate reads from — keep the existing no-flicker behavior).
6. ✅ **`packages/frontend/src/routes/stake.tsx`**: same banner in the StepsCard slot when `isStellar && stakeFlow.needsXlmFunding` (both tabs), after the connect-wallet banner / initial-load gate.
7. ✅ **Spec updates (docs-first, same PR):**
   - `docs/frontend/dashboard-components.md` — banner precedence list: insert "**No-XLM banner** (Figma node `6090-8741` / card `6093-75787`) — Stellar only, both directions, `flow.needsXlmFunding`; outranks the USDC-trustline banner because adding a trustline itself requires XLM" as item 3; renumber; add the Figma reference link. Stake route section: add the same banner rule.
   - `docs/frontend/wallet-flows.md` — `FlowState` contract: document `needsXlmFunding` and the zero-or-unfunded rule (incl. the Horizon-404 `accountExists` discriminator and why 404 is no longer folded into "no trustline" for this purpose).
8. ✅ **Lint/build**: `npx tsx scripts/lint-docs.ts`, frontend lint + typecheck + unit tests + build per package scripts.

## Test Strategy

- `useStellarXlmBalance.test.tsx` (new): native line parsed from `loadAccount` balances; 404 → `{ xlmBalance: "0", accountExists: false }`; non-404 error propagates; disconnected → undefined; mock-key fast path.
- `useDepositFlow.test.tsx`: `needsXlmFunding` — true on zero XLM, true on unfunded (404), false when funded, false while loading (undefined balance), always false on EVM.
- `-deposit.test.tsx`: precedence — no-XLM banner renders instead of StepsCard *and* instead of the USDC-trustline/low-balance banners when both conditions hold; renders in withdraw direction too; Copy Address writes the address to the clipboard and flips to "Copied"; banner absent when XLM funded.
- `-stake.test.tsx`: banner renders on both tabs when unfunded; absent when funded.
- Figma verification (frontend flow, ux-tester): dev server against a **fresh unfunded testnet account** (no localStorage mocks per project convention — memory: verify real data), compare rendered banner to Figma node `6090-8741` token-for-token; verify the trustline Enable CTAs are absent and Copy Address copies the real connected address.

## Docs to Update

- `docs/frontend/dashboard-components.md` (banner precedence — conversion + stake routes, Figma refs)
- `docs/frontend/wallet-flows.md` (`FlowState.needsXlmFunding`, zero-or-unfunded rule, 404 discriminator)
- `docs/product-specs/deposits.md` — no change needed (does not describe page banners; verified 2026-08-24)
- On close of #1130: its provisional Friendbot-hint acceptance line is superseded by the final design (note already in issue comments)
