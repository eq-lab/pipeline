# Issue #718: Panel A: Balance Sheet & Reconciliation UI

Source: https://github.com/eq-lab/pipeline/issues/718

Parent epic: #712 (Protocol Dashboard). Frontend flow. Backing API (#713 / PR #748)
`GET /v1/financial-position` is merged on `main`.

> **Architecture decision (human, 2026-07-02).** The fields the endpoint serves as
> `null` (Capital-Wallet reserves — USDC / USYC / in-transit — and PLUSD
> outstanding) and the previously-deferred sub-features (liquidity ratio vs 15 %
> target + band indicators, reconciliation invariant status, sPLUSD→PLUSD
> exchange rate) are NOT deferred and NOT rendered as `—`. Wherever a value is
> genuinely readable on-chain, the frontend sources it DIRECTLY FROM THE CONTRACT
> via on-chain reads, blending it with the REST endpoint's populated fields. Only
> values that are fundamentally not on-chain (off-chain / in-transit USD, USYC
> NAV price feed) remain `—` and are raised as Open Questions.

## On-chain read infrastructure (investigated — this is the foundation for the plan)

The frontend is a **dual-namespace** app: EVM (default, via `wagmi`/`viem`) and
Stellar (Soroban). EVM is the active default (`WalletViewContext` default kind is
`"evm"`). Existing contract reads live under `packages/frontend/src/wallet/evm/`
and follow one consistent pattern (see `useStakedPlusd.ts`, `useEvmToken.ts`,
`useWithdrawalQueue.ts`):

- **Read primitive**: wagmi `useReadContract({ address, abi, functionName, args, query })`.
- **Mock layer** (localStorage): named-alias key → generic per-address key
  (`pipeline.mock.wallet.contract.<addr>.<fn>` / `pipeline.mock.wallet.balance.<addr>`)
  → zero-address short-circuit (returns `undefined`, no RPC) → real RPC. Reads
  are reactive via `useMock`/`readMock`.
- **Config**: contract addresses come from `ENV.*_ADDRESS` in
  `packages/frontend/src/lib/env.ts` (each defaults to the zero address; zero ⇒
  hook short-circuits). Existing: `DEPOSIT_MANAGER_ADDRESS`,
  `WITHDRAWAL_QUEUE_ADDRESS`, `STAKED_PLUSD_ADDRESS`. Immutable reads use
  `CACHE_FOREVER` (`staleTime: Infinity`).
- **ABIs**: `packages/frontend/src/wallet/evm/abis/` — `erc20.ts`, `stakedPlusd.ts`, etc.

### What is readable on-chain today, and how

| Balance-sheet field | On-chain source | Status / gap |
|---|---|---|
| **sPLUSD → PLUSD exchange rate** | sPLUSD ERC-4626 vault `convertToAssets(1e18)`; rate = `Number(raw)/1e18`. **Existing precedent:** `HomeStatsStrip.tsx` calls `useStakedPlusdConvertToAssets(10n**18n)`; hook is `useStakedPlusdConvertToAssets` in `wallet/evm/useStakedPlusd.ts`. Protocol-level, no wallet needed. | **READY** — reuse the existing hook. |
| **PLUSD address** | sPLUSD vault `asset()` view → PLUSD token address. **Existing hook:** `useStakedPlusdAsset()` (`wallet/evm/useStakedPlusd.ts`, used by `routes/index.tsx`). | READY as an address source (no `VITE_PLUSD_ADDRESS` env var exists — must derive via `asset()`). |
| **PLUSD outstanding (senior claims)** | PLUSD ERC-20 `totalSupply()` at the address from `asset()`. | **GAP (fixable in this issue):** the shared `erc20Abi` (`abis/erc20.ts`) has NO `totalSupply` entry (only `balanceOf`/`decimals`/`symbol`/`name`/`allowance`/`approve`). Must add a `totalSupply` fragment (own minimal ABI or extend `erc20Abi`). Then read is a standard `useReadContract`. |
| **Capital-Wallet USDC balance** | USDC ERC-20 `balanceOf(capitalWallet)`. | **GAP (config):** there is NO Capital-Wallet address and NO USDC token address in `env.ts`. Requires new `VITE_CAPITAL_WALLET_ADDRESS` + `VITE_USDC_ADDRESS` env vars (default zero → short-circuit). Read pattern = `useEvmToken`/`balanceOf`. |
| **USYC holding (units)** | USYC ERC-20 `balanceOf(capitalWallet)`. | **GAP (config):** no `VITE_USYC_ADDRESS`. Same as above. |
| **USYC USD value (at NAV)** | USYC units × issuer NAV price. | **NOT on-chain / partial:** NAV is an off-chain issuer feed. No price feed is wired in the frontend. Units are on-chain; the USD valuation is not. → Open Question. |
| **USDC deployed on active loans** | Already served by the REST endpoint as `assets.deployed.secured_loans_outstanding`. | READY (REST). Prefer the endpoint over any on-chain recompute. |
| **USDC in transit (on-ramp leg)** | — | **NOT on-chain:** in-transit funds are between custody legs; no contract exposes this. → remains `—`, Open Question. |
| **Off-chain USD (trust company account)** | — | **NOT on-chain:** by definition off-chain. → remains `—`, Open Question. |
| **Junior tranche (subordinated capital)** | Already served by REST as `subordinated_capital.junior_tranche`. | READY (REST). |
| **Liquidity ratio vs 15 % + 10 %/20 % bands** | Derived: `usdc_liquid / (plusd_outstanding or total senior claims)`. Inputs = Capital-Wallet USDC (on-chain) + PLUSD totalSupply (on-chain). | **DERIVED** — computable once the two on-chain inputs above land. Bands (10/15/20 %) are static thresholds. |
| **Reconciliation invariant** (`PLUSD totalSupply == USDC + USYC NAV + USDC on loans + USDC in transit`) | Derived from PLUSD totalSupply, USDC balance, USYC NAV value, deployed (REST), in-transit. | **PARTIAL:** USYC-NAV and in-transit legs are not fully sourceable (see above), so the invariant cannot be computed to the spec's green/amber/red drift precisely. → Open Question on how to present a partial reconciliation. |

**Net:** exchange rate is ready; PLUSD totalSupply needs an ABI fragment; USDC/USYC
reserves need new env config + addresses; USYC NAV, in-transit, off-chain USD are
not on-chain and stay `—`; liquidity ratio is derivable from on-chain inputs;
full reconciliation is only partially computable.

**Stellar note:** these on-chain reads are implemented on the **EVM** side only
for v1 (matching the app default and where PLUSD/sPLUSD/reserves live). The
Stellar namespace is out of scope for this panel; the hooks degrade gracefully
(zero-address short-circuit) when EVM contracts are unconfigured. Flagged in Open
Questions in case the coordinator wants dual-namespace parity.

## Scope

Replace the "Coming soon" placeholder in
`packages/frontend/src/components/dashboard/BalanceSheetPanel.tsx` with the real
**Statement of Financial Position** panel (Panel A). Data is **blended** from two
sources:

1. **REST** `GET /v1/financial-position` — deployed assets, junior tranche, and
   the rolled-up section totals (already populated server-side).
2. **On-chain reads** (EVM/wagmi) — PLUSD outstanding (`totalSupply`), Capital-Wallet
   USDC balance, USYC units, and the sPLUSD→PLUSD exchange rate. Derived on the
   client: liquidity ratio + band status, and a (partial) reconciliation status.

Layout matches the Figma section (desktop node `3283:14275`; mobile node
`3283:72288`) — **layout decisions unchanged from the prior revision**:

- **Assets** (left) with a muted section total, sub-sections:
  - **Liquid** → Cash — stablecoins (USDC, on-chain) / Tokenized T-bills (USYC units, on-chain) / Off-chain USD (trust company account) (`—`)
  - **Deployed** → Secured loans outstanding (REST) / Accrued interest receivable (REST)
- **Liabilities** (right) with a muted section total, sub-sections:
  - **Senior Claims** → PLUSD outstanding (on-chain `totalSupply`) with the `1:1 redeemable` caption (kept, per decision 2)
  - **Subordinated Capital** → Junior tranche (REST)

Additional widgets required by the #718 body and now IN scope (contract-sourced):

- **sPLUSD → PLUSD exchange rate** line (on-chain `convertToAssets(1e18)`).
- **Liquidity ratio** vs 15 % target with 10 % / 20 % band indicators (derived).
- **Reconciliation invariant status** green/amber/red (partial — see Open Questions).

These extra widgets are NOT in the Figma "Statement of Financial Position" section
(which only shows the two-column sheet). Their exact placement/visual design is an
Open Question; the plan proposes rendering them below the two-column sheet in the
same panel using existing tokens, pending design confirmation.

Money formatting: base-6 REST strings → `formatCompactUsd`. On-chain `bigint`
values are converted with `viem` `formatUnits` at the token's decimals (USDC 6,
PLUSD 18, USYC 6 — confirm decimals via `decimals()` read rather than hardcoding)
then formatted for display. `null`/unavailable values still render `—`.

### In scope

- ABI: add `totalSupply` fragment (extend `erc20Abi` or a small dedicated ABI).
- ENV: add `CAPITAL_WALLET_ADDRESS`, `USDC_ADDRESS`, `USYC_ADDRESS` (default zero
  → short-circuit), documented in `env.ts` like the existing address vars.
- On-chain read hooks under `wallet/evm/` for PLUSD `totalSupply` and Capital-Wallet
  token balances (model on `useEvmToken`/`useStakedPlusd`, full mock-key layer).
- REST hook `useFinancialPosition` (`src/api/`), barrel export, README + mock key.
- Co-located logic hook `useBalanceSheetPanel` that blends REST + on-chain data,
  formats, and derives liquidity ratio / reconciliation status (view = JSX only).
- Rewrite `BalanceSheetPanel.tsx`.
- Component/hook + on-chain-read + REST-hook regression tests.

### Remains `—` (fundamentally not on-chain — see Open Questions)

- Off-chain USD (trust company account).
- USDC in transit.
- USYC USD value at NAV (units are on-chain; the NAV price is an off-chain feed).

## Assumptions and Risks

- **REST endpoint** `GET /v1/financial-position` shape confirmed in
  `packages/api/src/routes/financial_position.rs`: every amount an
  `Option<String>` base-6 decimal; `assets.deployed.*`,
  `subordinated_capital.junior_tranche`, and the two `total`s populated; `liquid.*`
  and `plusd_outstanding` null. The plan OVERRIDES the null REST leaves with
  on-chain reads where possible rather than displaying `—`.
- **Section totals**: the REST `assets.total` / `liabilities.total` roll up only
  the non-null REST leaves and therefore EXCLUDE the on-chain-sourced values. Once
  we add on-chain USDC/USYC/PLUSD, the displayed section total must be
  **recomputed client-side** to include them (REST deployed/junior + on-chain
  liquid/PLUSD), otherwise the total will not match the visible rows. This is a
  change from the prior revision (which used the REST total verbatim). Risk:
  mixed-source summation across decimals — normalize everything to USD-human
  units before summing. USYC-NAV and in-transit/off-chain remain excluded from the
  total while unsourced → the sheet may still not perfectly balance (Open Question 1).
- **PLUSD address discovery adds a dependency chain**: `useStakedPlusdAsset()` →
  PLUSD address → `totalSupply()`. If `STAKED_PLUSD_ADDRESS` is zero (dev default),
  the whole PLUSD branch short-circuits to `—` gracefully. Acceptable.
- **New env vars unset in current environments** → those reads short-circuit to
  `—` until ops configures `VITE_CAPITAL_WALLET_ADDRESS` / `VITE_USDC_ADDRESS` /
  `VITE_USYC_ADDRESS`. The panel must render correctly (no crash, `—` values) in
  that state — same graceful pattern as the existing zero-address short-circuits.
- **USDC decimals (6) vs PLUSD (18)**: do not hardcode; read `decimals()` (cached
  forever) or key off the token. Mixing 6- and 18-decimal bigints without
  normalizing is the top correctness risk.
- **Protocol-level, no wallet**: all reads are contract state (`totalSupply`,
  `balanceOf(capitalWallet)`, `convertToAssets`), NOT the connected wallet — the
  dashboard renders with no wallet connected. Do NOT gate on `useEvmWallet().address`.
- **Reconciliation precision**: the spec's drift thresholds (green <0.01 %, amber
  0.01–1 %, red >1 %) require ALL invariant terms; USYC-NAV + in-transit are
  missing, so a faithful status is not computable in v1. Risk of showing a
  misleading "red". → Open Question 3.
- Risk: the extra widgets (exchange rate, liquidity ratio, reconciliation) have no
  Figma reference — visual design is unspecified (Open Question 2).

## Open Questions

**RESOLVED (human, 2026-07-02):**

- **Scope = only Figma `3283-14275`** ("Statement of Financial Position"). No extra
  widgets. This **removes from scope**: the sPLUSD exchange-rate line, the liquidity
  ratio + 10/15/20 % band indicator, and the reconciliation green/amber/red badge
  (former OQ2/OQ3 and the exchange-rate feature). Panel A is exactly the two-column
  Assets/Liabilities balance sheet with these rows:
  - Assets → Liquid: `Cash — stablecoins`, `Tokenized T-bills`, `Off-chain USD (trust
    company account)`; Deployed: `Secured loans outstanding`, `Accrued interest receivable`.
  - Liabilities → Senior Claims: `PLUSD outstanding` (+ `1:1 redeemable` caption, kept
    even when value is `—`); Subordinated Capital: `Junior tranche`.
  - Each side shows a muted rolled-up total; section sub-headers (`Liquid`, `Deployed`,
    `Senior Claims`, `Subordinated Capital`) as designed.
- **PLUSD caption** — keep `1:1 redeemable` regardless of value.

**STILL PENDING human clarification (task parked `needs-feedback` — 2026-07-02):**
_The user is gathering answers and will follow up._

1. **Contract addresses.** Are `VITE_CAPITAL_WALLET_ADDRESS` / `VITE_USDC_ADDRESS` /
   `VITE_USYC_ADDRESS` known for the target environment, or do they stay unset (→ `—`)
   for now? (PLUSD outstanding is readable regardless — its address derives from the
   staking contract's `asset()`.)
2. **USYC USD value** needs an off-chain NAV price. Is there a source to read (API
   field / oracle address / constant), or does `Tokenized T-bills` render `—` in v1?
3. **Unbalanced totals.** With USYC-NAV value, in-transit, and off-chain USD unsourced,
   Assets will under-count vs Liabilities. Footnote + best-effort total, or hide the
   total until fully sourceable? (Recommend footnote.)
4. **EVM-only** for Panel A v1 (no Stellar parity)? (Recommend yes — app defaults to EVM.)

> Note: which specific Liquid rows show real values vs `—` depends on OQ1/OQ2.
> `Off-chain USD (trust company account)` is off-chain by definition and stays `—`
> unless a source is named. Deployed rows + Junior tranche come from the REST endpoint
> and render regardless.

## Implementation Steps

1. **ABI — `totalSupply`.** In `packages/frontend/src/wallet/evm/abis/erc20.ts`
   add a `totalSupply()` view fragment (`inputs: []`, `outputs: [{ type: "uint256" }]`,
   `stateMutability: "view"`). Keep `as const`.
2. **ENV config.** In `packages/frontend/src/lib/env.ts` add
   `CAPITAL_WALLET_ADDRESS` (`VITE_CAPITAL_WALLET_ADDRESS`), `USDC_ADDRESS`
   (`VITE_USDC_ADDRESS`), `USYC_ADDRESS` (`VITE_USYC_ADDRESS`) — each
   `readString(..., ZERO_ADDRESS) as 0x${string}`, with the same short-circuit
   doc-comment as the existing address vars.
3. **On-chain read hooks** (`packages/frontend/src/wallet/evm/`), each modeled on
   `useStakedPlusd.ts`/`useEvmToken.ts` with the full mock-key precedence
   (named alias → per-address → zero-address short-circuit → real RPC) and
   `CACHE_FOREVER` where the value is effectively static within a page:
   - `usePlusdTotalSupply()` — depends on `useStakedPlusdAsset()` for the PLUSD
     address, then `useReadContract({ address: plusd, abi: erc20Abi,
     functionName: "totalSupply" })`; also read `decimals()` (expect 18) to format.
     Zero/undefined address ⇒ `undefined`.
   - `useCapitalWalletBalance(token: 0x${string})` — `balanceOf(CAPITAL_WALLET_ADDRESS)`
     for a given token address (used for USDC and USYC); read `decimals()` per token.
     Or reuse `useEvmToken` semantics generalized to an arbitrary `owner`
     (currently `useEvmToken` fixes owner = connected wallet — needs a variant that
     takes an explicit owner = Capital Wallet; add `useTokenBalanceOf({ token, owner })`
     rather than overloading the wallet-scoped hook).
   - Reuse existing `useStakedPlusdConvertToAssets(10n ** 18n)` for the exchange rate.
4. **REST hook** — `packages/frontend/src/api/useFinancialPosition.ts`, modeled on
   `useWithdrawalQueue.ts`: types for the response tree, `useQuery` with
   `queryKey: ["financial-position"]`, `queryFn: apiFetch("/v1/financial-position")`,
   `refetchInterval: 30_000`, always enabled. Barrel-export from `src/api/index.ts`;
   add README section + `pipeline.mock.api.GET./v1/financial-position` mock key.
5. **Logic hook** — `packages/frontend/src/components/dashboard/useBalanceSheetPanel.ts`
   (co-located, view = JSX only). Responsibilities:
   - Call `useFinancialPosition()` + the on-chain hooks from step 3 + the exchange-rate hook.
   - Normalize every value to USD-human units (REST base-6 strings via `parseFloat`;
     on-chain bigints via `viem formatUnits` at the token decimals). Format for
     display with `formatCompactUsd` (or a compact formatter for the already-numeric
     on-chain values); unavailable → `—`.
   - Build the view model: assets/liabilities section totals (client-recomputed to
     include on-chain leaves — see Assumptions/OQ1), each leaf row string, the
     exchange-rate string, the liquidity ratio + band status (derive: USDC ÷ PLUSD
     totalSupply; classify vs 10/15/20 %), and the reconciliation status
     (partial — see OQ3).
   - `state`: `loading` while REST is loading; `error` on REST error (retry via
     `refetch`); otherwise `ready`. On-chain reads that are still loading or
     unconfigured surface as per-row `—`, not a whole-panel error.
6. **Panel view** — rewrite `BalanceSheetPanel.tsx` to consume the logic hook and
   render via `PanelContainer` (`borderless`, `title="Balance Sheet"`, keep
   `data-testid="dashboard-panel-balance-sheet"` + `data-node-id="3283:14275"`).
   **Layout unchanged from the prior revision:**
   - Responsive two-column body: `flex flex-col md:flex-row gap-8`, each column
     `md:flex-1`; desktop-only 1px vertical divider (`--color-pipeline-line`);
     mobile stacks Assets over Liabilities.
   - Column heading row: `Assets`/`Liabilities` (`heading-m`, display) + muted
     section total (`heading-m`, `--color-pipeline-ink-muted`), `items-baseline justify-between`.
   - Card Body per column: white surface, asymmetric depth border
     (`border-t border-l border-b-[3px] border-r-[3px]`, `--color-pipeline-line`),
     `rounded-[var(--radius-pipeline-card,4px)]`, `p-4`, `flex flex-col gap-8`.
   - Sub-section: Heading-20 title (display, 20px/28px) + `flex flex-col gap-4` rows.
   - Extract a presentational `BalanceSheetRow` (label + optional caption +
     right-aligned value; top border, `pt-4`, label muted, value ink). Keep the
     `1:1 redeemable` caption on the PLUSD row (decision 2).
   - Below the two-column sheet, render the extra widgets block (exchange rate,
     liquidity ratio + band, reconciliation badge) using existing tokens — layout
     provisional pending OQ2.
   - Token discipline: no raw hex/font/size literals (layout pixel hints only);
     stable `data-testid`s per row/widget.
7. **Lint/build** — `npx tsc --noEmit` (frontend), frontend ESLint, and
   `npx tsx scripts/lint-docs.ts` for doc edits. Fix all warnings.

## Test Strategy

Regression/component coverage is required (DoD). Vitest + RTL, mocking the hooks;
follow `useWithdrawalQueuePanel.test.tsx`, `useYieldHistoryPanel.test.tsx`, and the
existing `wallet/evm/*.test.tsx` (mock-key-driven) patterns.

1. **REST hook** — `src/api/useFinancialPosition.test.tsx` (mirror
   `useWithdrawalQueue.test.tsx`): mock-key path parses JSON; real path calls
   `apiFetch("/v1/financial-position")`; loading→data; error surfaces.
2. **On-chain hooks** — tests for `usePlusdTotalSupply` and the Capital-Wallet
   balance hook using the localStorage mock keys and the zero-address
   short-circuit (assert NO RPC when address is zero → `undefined`). Assert
   decimals-correct formatting (USDC 6 vs PLUSD 18) via mock decimals.
3. **Logic hook / panel** — `useBalanceSheetPanel.test.tsx` (mock all data hooks):
   - **Loading / error / retry** panel states.
   - **Blended ready state**: REST provides deployed + junior + totals; on-chain
     mocks provide PLUSD totalSupply, USDC, USYC units, exchange rate. Assert:
     Deployed & Junior render from REST; Cash—stablecoins renders the on-chain USDC
     value; PLUSD outstanding renders the on-chain `totalSupply` (NOT `—`); the
     exchange-rate line renders `1 sPLUSD = X.XXXX PLUSD`; section totals are the
     client-recomputed blended sums.
   - **Unconfigured on-chain (zero addresses)**: PLUSD, USDC, USYC rows render `—`
     while REST rows still render — proves graceful degradation.
   - **Liquidity ratio band classification**: given USDC and PLUSD inputs, assert
     the ratio value and that <10 % / 10–20 % / >20 % map to the correct band state.
   - **Reconciliation partial state**: with USYC-NAV/in-transit unavailable, assert
     the chosen OQ3 behavior (e.g. "insufficient data" neutral state), not a
     misleading red.
   - **Always-`—` fields**: Off-chain USD, USDC in transit, USYC USD value render `—`.
   - **Formatter edge**: on-chain `0n` → `$0`; unavailable → `—`.

## Docs to Update

- `packages/frontend/src/api/README.md` — `useFinancialPosition()` + mock-key entry.
- `packages/frontend/src/wallet/README.md` — document the new on-chain read hooks
  (`usePlusdTotalSupply`, Capital-Wallet balance hook) and their mock keys,
  matching the existing `useStakedPlusd*` / `useEvmToken` entries.
- `docs/frontend/hooks.md` — add rows for the shared hooks: `useFinancialPosition`
  (API) and the new on-chain reads. The component-local `useBalanceSheetPanel`
  stays OUT per FRONTEND.md rule 5.
- `packages/frontend/src/lib/env.ts` doc-comments cover the three new env vars;
  if there is an `.env.example` / env doc, add `VITE_CAPITAL_WALLET_ADDRESS`,
  `VITE_USDC_ADDRESS`, `VITE_USYC_ADDRESS` there too.
- `docs/product-specs/dashboards.md` Panel A — note that the frontend now sources
  PLUSD outstanding + Capital-Wallet reserves + sPLUSD exchange rate + liquidity
  ratio directly on-chain (the REST endpoint's nulls are a fallback), and record
  which invariant terms remain unsourceable (USYC NAV, in-transit, off-chain USD).
  Only finalize once OQ1–OQ4 are resolved.
