# Protocol Dashboard — Balance Sheet on-chain sources

Split out of [dashboards.md](./dashboards.md) (size limit). The REST `GET /v1/financial-position`
leaves `plusd_outstanding` and `liquid.cash_stablecoins` as `null`; the frontend fills them with
direct on-chain reads of the dashboard chain (the connected wallet's chain, else Stellar — see
[Chain scope](./dashboards.md#protocol-dashboard--header)).

## Balance sheet sources

**EVM sources (#1498).** Both are protocol reads, not wallet-gated, polled every 30 s, and
formatted with the token's live `decimals()` (never a hard-coded scale):

- **PLUSD outstanding** = `PLUSD.totalSupply()`, PLUSD resolved via `DepositManager.plUsd()`.
- **Cash — stablecoins (USDC)** = `USDC.balanceOf(DepositManager.custodian())`, USDC resolved via
  `DepositManager.usdc()`.

A read that is unavailable (zero-address config, a reverted `custodian()`, RPC error) renders `—`
for that row and never fails the panel; the row then counts as unsourced for the totals footnote.

**Stellar sources:**

- **PLUSD outstanding** (LIABILITY) — total PLUSD in circulation, read from Horizon:
  `GET /assets?asset_code=PLUSD&asset_issuer={plusdIssuerId}` → `balances.authorized`.
  The PLUSD SAC has no Soroban `total_supply()` method; Horizon `/assets` is the only
  source. Returns a Horizon human-decimal string (no SAC bigint scaling). The `1:1
redeemable` caption is displayed on the PLUSD row. Configured via
  `VITE_STELLAR_PLUSD_ISSUER_ID`.
- **Cash — stablecoins (USDC)** (ASSET) — ONLY the USDC in Pipeline's custody
  account, read via a direct Soroban contract call: `usdc_SAC.balance(usdcCustodyId)`.
  Returns a raw i128 bigint at 7-decimal SAC scale; `sacRawToDisplay` converts to
  a human number before formatting. Sentinel guard: if the call returns i64 max
  (~9.2e18), the row renders `—` (issuer account guard). Configured via
  `VITE_STELLAR_USDC_ID` (SAC contract) and `VITE_STELLAR_USDC_CUSTODY_ID`
  (custody G-account); both must be set for a real value to display.
- **USYC (Tokenized T-bills)** — the identity seam `convertUsycToUsdc` (1:1 stub)
  is in place; with no USYC holding configured, the row renders `—`.
- **Off-chain USD** — renders `—` (off-chain, no source).

Section totals are client-recomputed from sourced rows only (REST deployed/junior +
on-chain USDC/PLUSD). A muted footnote "Excludes assets pending a data source" is
shown while USYC and off-chain USD remain unsourced.
