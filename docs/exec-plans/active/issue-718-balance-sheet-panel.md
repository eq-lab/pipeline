# Issue #718: Panel A: Balance Sheet & Reconciliation UI

Source: https://github.com/eq-lab/pipeline/issues/718

Parent epic: #712 (Protocol Dashboard). Frontend flow. Backing API (#713 / PR #748)
`GET /v1/financial-position` is merged on `main`.

> **Architecture decisions (human, 2026-07-02).**
> 1. Fields the REST endpoint serves as `null` are sourced DIRECTLY FROM THE
>    CONTRACT — **on Stellar / Soroban** (NOT EVM). PLUSD outstanding and the
>    protocol USDC reserve are read on-chain and blended with the REST endpoint's
>    populated fields.
> 2. Keep the PLUSD "1:1 redeemable" caption.
> 3. **No liquidity-ratio / reconciliation / exchange-rate widgets.** Panel A is
>    exactly the Figma "Statement of Financial Position" two-column sheet
>    (`3283:14275`) — nothing more.
> 4. USYC (Tokenized T-bills) is NOT wired now: add a 1:1 identity seam
>    (`convertUsycToUsdc`) so real NAV can be swapped in later; the row shows
>    `—`/0 through the stub for v1.

## On-chain read infrastructure — STELLAR / SOROBAN (re-investigated)

The panel's on-chain reads use the **Stellar/Soroban** stack under
`packages/frontend/src/wallet/stellar/`. (An earlier revision wrongly assumed
EVM/wagmi — that is corrected here; the wagmi/`erc20Abi`/`VITE_*_ADDRESS`
approach is dropped.)

**Read pattern (model to follow):**

- **Typed Soroban client class**, one per contract, hand-written in
  `wallet/stellar/contracts/` — see `contracts/stakedPlusd.ts`
  (`StakedPlusdClient`). Each read view builds a `contract.call("<fn>", ...scVals)`
  op, runs it through a private `simulateReadCall(op)` helper that:
  wraps the op in a `TransactionBuilder` sourced from `READ_SIMULATION_SOURCE`
  (the canonical null `G…` account from `chain.ts`), calls
  `server.simulateTransaction(tx)`, guards `isSimulationError`, and returns
  `scValToNative(result.result.retval)`. The `SorobanRpc.Server` is built from
  `sorobanRpcUrl` (from `chain.ts`). Read views return raw `bigint` (i128) /
  `string`.
- **Factory** `create<Name>Client(contractId): Client | null` — returns `null`
  when the id is empty (unconfigured) so hooks short-circuit cleanly.
- **React-Query read hook** wrapping the client — see
  `useStellarStakedPlusd.ts` (`useStellarStakedPlusdBalance`,
  `useStellarStakeConvertToShares`, etc.):
  `useQuery({ queryKey: ["<name>", contractId, ...args], queryFn: async () => {
  read mock first; else createClient(id); call view; }, enabled: isConfigured &&
  mockUndefined, staleTime, refetchInterval: 30_000, retry: false })`. Protocol-
  level reads (`total_supply`, reserve `balance`) do NOT gate on a connected
  wallet — unlike `useStellarStakedPlusdBalance` which gates on `useStellarWallet()`.
- **Config**: contract IDs come from `ENV.STELLAR_*_ID` and are re-exported as
  `const`s from `wallet/stellar/chain.ts` (e.g. `stakedPlusdId`,
  `depositManagerId`, `withdrawalQueueId`). Empty string ⇒ unconfigured ⇒
  short-circuit to `undefined`, no RPC.
- **Mock layer**: localStorage keys in `wallet/stellar/mock.ts`
  (`STELLAR_MOCK_KEYS` + `readMockStellar*` / `useMock`), e.g.
  `pipeline.mock.wallet.stellar.balance.sac.usdc` already exists (raw 7-decimal
  bigint string). Reactive via `useMock`; re-read at query time via `readMock*`.
- **Decimals**: Stellar SAC tokens use **7 decimals** (`SAC_DECIMALS = 7`, NOT
  EVM's 6). Scaling helpers `sacRawToDisplay` / `sacDisplayToRaw` are exported
  from `wallet/stellar/useStellarSacToken.ts`. PLUSD and USDC SAC amounts are
  raw i128 `bigint` at 7-decimal scale (`1 token = 10_000_000n`).

**Futurenet contract addresses** (from `eq-lab/pipeline-stellar-contracts`,
`deployments/networks/futurenet/addresses.json`):

| contract | address |
|---|---|
| `plusd` | `CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI` |
| `usdc` | `CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI` |
| `staked_pl_usd` | `CDSWAVNSVURETMQ7VPMF3XXADDUZLJNJQ4YBUTV65QZEBF5RVOPGW5M4` |
| `withdrawal_queue` | `CBNZF5QAFJSYDZKU7G7VTV2G3NQ4BM54FI72O2SXVZTXURHGZ262L4KH` |
| `deposit_manager` | `CCYQKUAZ7BF22OMXNPF7RJ2D3PDUNV66S3O2L54UYHDYQ4CLMTJHLNWU` |
| `loan_registry` | `CDVO2BDGXMGP6PJ5ZQRU6PI4BYQO4VVYPL27QTLMZ5RNCC4Z6TXLV5K3` |
| `yield_minter` | `CAPPCX2IB5YWJNCHZQ64WF2NH4RZXX6KLOK5LBFPD5GU5P2CSARRTHSS` |

**No USYC address and no explicit `capital_wallet` address exist** in the set.

### Per-row data sourcing (baked into the plan)

| Row | Source | Method |
|---|---|---|
| **Liabilities → Senior Claims → PLUSD outstanding** | on-chain | `plusd.total_supply()` on the `plusd` SAC/token contract. Keep the `1:1 redeemable` caption. |
| **Liabilities → Subordinated Capital → Junior tranche** | REST | `liabilities.subordinated_capital.junior_tranche`. |
| **Assets → Deployed → Secured loans outstanding** | REST | `assets.deployed.secured_loans_outstanding`. |
| **Assets → Deployed → Accrued interest receivable** | REST | `assets.deployed.accrued_interest_receivable`. |
| **Assets → Liquid → Cash — stablecoins (USDC)** | on-chain | `usdc.balance(reserveAccount)` — the protocol reserve's USDC balance. **The reserve holder is NOT explicit** (no `capital_wallet`) — see "Reserve holder" below. |
| **Assets → Liquid → Tokenized T-bills (USYC)** | stub | `convertUsycToUsdc(usycAmount)` seam (1:1 identity). No USYC holding/address yet → renders `—`/0 in v1. |
| **Assets → Liquid → Off-chain USD (trust company account)** | none | Off-chain → stays `—`. |

**Reserve holder for the USDC balance read.** There is no `capital_wallet`
address in the deployment. The reserve USDC is most plausibly custodied by one of
the protocol contracts — candidate holders: `deposit_manager`
(`CCYQKUAZ…`) or `withdrawal_queue` (`CBNZF5QA…`). This is an
**implementation-time determination**, not a design blocker: the coder verifies
which account holds the reserve (query `usdc.balance(...)` against each candidate
on Futurenet, and/or confirm against the contracts repo), wires that id via a new
env var, and leaves a clear `TODO` if it cannot be confirmed (defaulting to
`deposit_manager` as the working assumption, short-circuiting to `—` if the id is
empty/unconfirmed). This is captured as a bounded TODO, not an Open Question that
gates the plan.

## Scope

Replace the "Coming soon" placeholder in
`packages/frontend/src/components/dashboard/BalanceSheetPanel.tsx` with the real
**Statement of Financial Position** panel (Panel A). Data is **blended** from:

1. **REST** `GET /v1/financial-position` — deployed assets + junior tranche.
2. **On-chain Soroban reads** — PLUSD `total_supply()`, protocol USDC reserve
   `balance()`.
3. **Stub seam** — `convertUsycToUsdc` (1:1 identity) for the USYC row.

Layout matches Figma `3283:14275` (desktop) / `3283:72288` (mobile) — **layout
locked, unchanged**:

- **Assets** (left), muted section total, sub-sections:
  - **Liquid** → Cash — stablecoins (USDC on-chain) / Tokenized T-bills (USYC stub `—`) / Off-chain USD (trust company account) (`—`)
  - **Deployed** → Secured loans outstanding (REST) / Accrued interest receivable (REST)
- **Liabilities** (right), muted section total, sub-sections:
  - **Senior Claims** → PLUSD outstanding (on-chain `total_supply`) + `1:1 redeemable` caption
  - **Subordinated Capital** → Junior tranche (REST)

No liquidity-ratio, reconciliation, or exchange-rate widgets.

Money formatting: REST amounts are base-6 decimal strings → `formatCompactUsd`.
On-chain Soroban values are raw i128 `bigint` at **7-decimal** scale → convert to
human units with `sacRawToDisplay` (or divide by `10n**7n`) then format compact.
Unavailable/unconfigured values render `—`.

### In scope

- New Soroban token client `wallet/stellar/contracts/token.ts` (or extend an
  existing client) exposing `total_supply()` and `balance(account)` for a SAC
  token, modeled on `StakedPlusdClient` + `createStakedPlusdClient`.
- New `STELLAR_PLUSD_ID` + `STELLAR_USDC_ID` env vars (and a reserve-holder id —
  see TODO) in `lib/env.ts`, re-exported as `plusdId` / `usdcId` from
  `wallet/stellar/chain.ts`.
- Stellar read hooks: `useStellarPlusdTotalSupply()` and
  `useStellarUsdcReserveBalance()` (protocol-level, no wallet gate), with the
  full mock-key layer.
- `convertUsycToUsdc` seam module (small, easy to swap).
- REST hook `useFinancialPosition` (`src/api/`), barrel export, README + mock key.
- Co-located logic hook `useBalanceSheetPanel` blending REST + Soroban + stub,
  formatting, computing the client-recomputed section totals (view = JSX only).
- Rewrite `BalanceSheetPanel.tsx`.
- Tests for the Soroban client, the read hooks, the REST hook, and the panel/logic hook.

### Remains `—`

- Off-chain USD (trust company account) — off-chain.
- Tokenized T-bills (USYC) — no holding/address yet; flows through the 1:1 stub → `—`/0.

## Assumptions and Risks

- **REST shape** confirmed in `packages/api/src/routes/financial_position.rs`:
  every amount an `Option<String>` base-6 decimal; deployed + junior + the two
  `total`s populated; `liquid.*` and `plusd_outstanding` null. The plan overrides
  the null REST leaves with Soroban reads where possible.
- **Section totals are client-recomputed**, not the REST `total` verbatim: the
  REST roll-up excludes the on-chain USDC and PLUSD, so the displayed
  `Assets`/`Liabilities` totals must be summed client-side across REST +
  on-chain leaves. Normalize everything to USD-human units before summing (REST
  base-6 vs Soroban 7-decimal). USYC (`—`), in-transit, off-chain USD are excluded
  while unsourced → the sheet may not perfectly balance (Open Question 1).
- **7 vs 6 decimals** is the top correctness risk: REST strings are base-6;
  Soroban i128 are 7-decimal. Do not cross the scales without normalizing. Use
  `sacRawToDisplay(raw, 7)` for on-chain values.
- **Protocol-level, no wallet**: `total_supply()` and reserve `balance(account)`
  are contract state, not the connected wallet — the panel renders with no wallet
  connected. Do NOT gate these hooks on `useStellarWallet()` (unlike
  `useStellarStakedPlusdBalance`, which is LP-scoped and does gate).
- **Unconfigured ids short-circuit to `—`**: if `STELLAR_PLUSD_ID` /
  `STELLAR_USDC_ID` / reserve id are empty in an environment, the hooks return
  `undefined` and those rows show `—` — no crash. The panel must render correctly
  in that state (same pattern as the existing `stakedPlusdId === ""` short-circuit).
- **Reserve holder is unconfirmed** (no `capital_wallet`): handled as a bounded
  implementation TODO (default `deposit_manager`, verify on-chain), not a plan blocker.
- **Futurenet reset risk**: like the sPLUSD client comment warns, Futurenet is
  periodically reset; ids are env-driven so a redeploy just updates env.
- Risk: the new Soroban token client must correctly `scValToNative` an i128 into
  a JS `bigint` — mirror `StakedPlusdClient.totalSupply()` / `.balance()` exactly.

## Open Questions

1. **Unbalanced section totals.** With USYC (`—`), USDC-in-transit, and off-chain
   USD unsourced, Assets will under-count vs PLUSD-driven Liabilities, so the two
   muted totals won't match the Figma mock's equal `$43.14M`. Recommend shipping a
   small muted footnote under the sheet — "Excludes assets pending a data source"
   — and rendering best-effort client-recomputed totals rather than hiding them.
   Confirm this presentation.

_(All prior design/sourcing questions are resolved per the coordinator's
direction; this is the only remaining soft question, with a recommendation.)_

## Implementation Steps

1. **Soroban token client** — add
   `packages/frontend/src/wallet/stellar/contracts/token.ts` modeled on
   `contracts/stakedPlusd.ts`:
   - `class TokenClient` with `constructor(contractId)`, private
     `simulateReadCall(op)` (identical helper to `StakedPlusdClient`), and read
     views `totalSupply(): Promise<bigint>` (`contract.call("total_supply")`) and
     `balance(account: string): Promise<bigint>`
     (`contract.call("balance", new Address(account).toScVal())`), each returning
     `scValToNative(retval) as bigint`.
   - `createTokenClient(contractId): TokenClient | null` factory (null on empty id).
2. **ENV + chain re-export** — in `lib/env.ts` add
   `STELLAR_PLUSD_ID` (`VITE_STELLAR_PLUSD_ID`, default `""`) and
   `STELLAR_USDC_ID` (`VITE_STELLAR_USDC_ID`, default `""`), plus a reserve-holder
   id `STELLAR_RESERVE_ACCOUNT_ID` (`VITE_STELLAR_RESERVE_ACCOUNT_ID`, default `""`
   — see reserve-holder TODO; the coder may default this to the deposit_manager id
   at wiring time). In `wallet/stellar/chain.ts` re-export `plusdId`, `usdcId`,
   `reserveAccountId` as `const`s with the same short-circuit doc-comment as
   `stakedPlusdId`. Document the Futurenet addresses in the doc-comments.
3. **Mock keys** — in `wallet/stellar/mock.ts` add keys + reader helpers for
   PLUSD total supply and the USDC reserve balance (reuse the existing
   `balance.sac.usdc` convention; add e.g.
   `pipeline.mock.wallet.stellar.plusd.totalSupply` and
   `pipeline.mock.wallet.stellar.usdc.reserveBalance`, raw 7-decimal bigint
   strings), following the `stakedPlusdShareBalance` pattern.
4. **Stellar read hooks** — add
   `wallet/stellar/useStellarFinancialPositionReads.ts` (or co-locate near the
   token client), modeled on `useStellarStakedPlusd.ts` read hooks:
   - `useStellarPlusdTotalSupply(): { data?: bigint; isLoading; error }` —
     `useQuery({ queryKey: ["stellarPlusdTotalSupply", plusdId], queryFn: mock →
     createTokenClient(plusdId).totalSupply(), enabled: !!plusdId &&
     mockUndefined, staleTime: 30_000, refetchInterval: 30_000, retry: false })`.
     No wallet gate.
   - `useStellarUsdcReserveBalance(): { data?: bigint; isLoading; error }` —
     same shape, `queryKey: ["stellarUsdcReserveBalance", usdcId, reserveAccountId]`,
     `queryFn` → `createTokenClient(usdcId).balance(reserveAccountId)`, enabled
     when both ids present. No wallet gate.
5. **USYC seam** — add `components/dashboard/usycNav.ts` (small, swappable):
   `export function convertUsycToUsdc(usycAmount: bigint): bigint { return usycAmount; }`
   (1:1 identity placeholder; real `convert_to_assets`-style NAV wired later).
   The panel hook calls this; with no USYC holding, input is `0n`/absent → row `—`.
6. **REST hook** — `src/api/useFinancialPosition.ts`, modeled on
   `useWithdrawalQueue.ts`: response types, `useQuery({ queryKey:
   ["financial-position"], queryFn: apiFetch("/v1/financial-position"),
   refetchInterval: 30_000 })`, always enabled. Barrel-export from
   `src/api/index.ts`; README section + `pipeline.mock.api.GET./v1/financial-position`
   mock key.
7. **Logic hook** — `components/dashboard/useBalanceSheetPanel.ts` (view = JSX only):
   - Call `useFinancialPosition()` + `useStellarPlusdTotalSupply()` +
     `useStellarUsdcReserveBalance()` + the USYC stub.
   - Normalize to USD-human units: REST base-6 via `parseFloat`; Soroban bigints
     via `sacRawToDisplay(raw, 7)` → number/string. Format with `formatCompactUsd`;
     unavailable → `—`.
   - Build the view model: per-row display strings; client-recomputed section
     totals (REST deployed/junior + on-chain USDC/PLUSD, in human units); the
     `1:1 redeemable` caption on PLUSD.
   - `state`: `loading` while REST loads; `error` on REST error (retry via
     `refetch`); else `ready`. Soroban reads still loading/unconfigured surface
     as per-row `—`, never a whole-panel error.
8. **Panel view** — rewrite `BalanceSheetPanel.tsx` to consume the logic hook via
   `PanelContainer` (`borderless`, `title="Balance Sheet"`, keep
   `data-testid="dashboard-panel-balance-sheet"` + `data-node-id="3283:14275"`).
   **Layout unchanged (locked):**
   - Responsive two-column body `flex flex-col md:flex-row gap-8`, each column
     `md:flex-1`; desktop-only 1px vertical divider (`--color-pipeline-line`);
     mobile stacks Assets over Liabilities.
   - Column heading row: `Assets`/`Liabilities` (`heading-m`, display) + muted
     rolled-up total (`heading-m`, `--color-pipeline-ink-muted`),
     `items-baseline justify-between`.
   - Card Body per column: white surface, asymmetric depth border
     (`border-t border-l border-b-[3px] border-r-[3px]`, `--color-pipeline-line`),
     `rounded-[var(--radius-pipeline-card,4px)]`, `p-4`, `flex flex-col gap-8`.
   - Sub-section: Heading-20 title (display, 20px/28px) + `flex flex-col gap-4` rows.
   - Presentational `BalanceSheetRow` (label + optional caption + right-aligned
     value; top border, `pt-4`, label muted, value ink). Keep `1:1 redeemable`
     on the PLUSD row.
   - Optional muted footnote under the sheet per Open Question 1.
   - Token discipline: no raw hex/font/size literals (layout pixel hints only);
     stable `data-testid`s per row.
9. **Lint/build** — `npx tsc --noEmit` (frontend), frontend ESLint, and
   `npx tsx scripts/lint-docs.ts` for doc edits. Fix all warnings.

## Test Strategy

Regression/component coverage required (DoD). Vitest + RTL; follow
`wallet/stellar/*.test.ts(x)` (mock-key + simulate-mocked) and
`components/dashboard/useWithdrawalQueuePanel.test.tsx` patterns.

1. **Soroban token client** — `wallet/stellar/contracts/token.test.ts` mirroring
   `contracts/stakedPlusd.test.ts`: assert `totalSupply()` and `balance(account)`
   build the correct `total_supply` / `balance` ops and decode i128 → `bigint`
   (mock `simulateTransaction`); `createTokenClient("")` returns `null`.
2. **Stellar read hooks** — tests for `useStellarPlusdTotalSupply` and
   `useStellarUsdcReserveBalance`: mock-key fast-path returns the raw bigint
   without RPC; unconfigured id (empty) short-circuits to `undefined` with NO
   client construction / RPC; loading→data; error surfaces. Assert NO wallet-gate
   (returns data with no connected wallet).
3. **USYC seam** — `usycNav.test.ts`: `convertUsycToUsdc(n) === n` (locks the 1:1
   identity so a future NAV change is a deliberate, tested edit).
4. **REST hook** — `src/api/useFinancialPosition.test.tsx` (mirror
   `useWithdrawalQueue.test.tsx`): mock-key path parses JSON; real path calls
   `apiFetch("/v1/financial-position")`; loading→data; error surfaces.
5. **Logic hook / panel** — `useBalanceSheetPanel.test.tsx` (mock all data hooks):
   - **Loading / error / retry** panel states (driven by REST).
   - **Blended ready state**: REST gives deployed + junior; Soroban mocks give
     PLUSD `total_supply` + USDC reserve balance. Assert Deployed & Junior render
     from REST; Cash — stablecoins renders the on-chain USDC (7-decimal → human);
     PLUSD outstanding renders the on-chain `total_supply` (NOT `—`) with the
     `1:1 redeemable` caption; section totals are the client-recomputed blended sums.
   - **Unconfigured Soroban (empty ids)**: PLUSD + USDC rows render `—` while REST
     rows still render — proves graceful degradation.
   - **USYC row** renders `—`/0 through the stub.
   - **Off-chain USD** renders `—`.
   - **Decimals correctness**: a 7-decimal on-chain bigint formats to the right
     human USD figure (guards the 7-vs-6 scale bug).
   - **Formatter edge**: on-chain `0n` → `$0`; unavailable → `—`.

## Docs to Update

- `packages/frontend/src/api/README.md` — `useFinancialPosition()` + mock-key entry.
- `packages/frontend/src/wallet/README.md` — document the new Soroban token client
  (`TokenClient` / `createTokenClient`) and the read hooks
  (`useStellarPlusdTotalSupply`, `useStellarUsdcReserveBalance`) + their mock keys,
  matching the existing `StakedPlusdClient` / `useStellarStakedPlusd*` entries.
- `docs/frontend/hooks.md` — add rows for the shared hooks:
  `useFinancialPosition` (API), `useStellarPlusdTotalSupply`,
  `useStellarUsdcReserveBalance`. Component-local `useBalanceSheetPanel` stays OUT
  (FRONTEND.md rule 5).
- `lib/env.ts` doc-comments cover `VITE_STELLAR_PLUSD_ID`, `VITE_STELLAR_USDC_ID`,
  `VITE_STELLAR_RESERVE_ACCOUNT_ID`; add them to any `.env.example` / env doc with
  the Futurenet values above.
- `docs/product-specs/dashboards.md` Panel A — note that the frontend now sources
  PLUSD outstanding + the USDC reserve directly on Stellar/Soroban (the REST
  nulls are a fallback), and that USYC/off-chain/in-transit remain `—` pending a
  data source. Finalize the totals-presentation note once Open Question 1 is resolved.
