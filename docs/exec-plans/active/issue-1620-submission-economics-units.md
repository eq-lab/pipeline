# Issue #1620: Trustee: loan submission economics truncated and sent in the wrong scale ($1.2M → $0.12 on-chain)

Source: https://github.com/eq-lab/pipeline/issues/1620 — critical (wrong amount on-chain), found
in the 2026-10-22 calculations review. Branch: `fix/1620-submission-economics-units`.

## Root cause

Three readings of the same four strings (`economics.original_facility_size` /
`original_senior_tranche` / `original_equity_tranche` / `original_offtaker_price`):

- the Trustee form and the API's `EconomicsInput` doc say "USDC (6-decimal string)" — a human
  amount such as `1200000.000000` = $1.2M; the API validates them as decimals (`senior + equity =
  facility`, `offtaker >= facility`), scale-agnostic;
- #912 decided the strings were **base units** (because the staging rows of the day had been
  typed that way) and made both displays divide by 10^7 and the draw path
  (`parseUsdcBaseUnitsToU128`) keep only the integer part, unscaled.

So a trustee who types $1.2M draws 1,200,000 raw units = $0.12, and the review screen shows $0.12
back — nothing on the path says which unit is meant.

## Decision — human-unit USDC decimal strings end to end

The submission is chain-agnostic (`target_chain_id` is chosen separately and the draw chain's
decimals differ: 7 on Stellar, 6 on EVM), so the stored strings must be human units and the
**draw** converts to the target chain's base units. One convention, four places:

1. **Form** (`-origination-new.ts`): labels "… (USDC, e.g. 1200000.00)", placeholder `1200000.00`;
   a `decimal` field kind validates a non-negative decimal with at most 6 fractional digits (the
   finest scale both chains represent exactly) — more digits are rejected, never truncated.
2. **API**: already states and validates human decimals; no change (the doc comment is correct).
3. **Draw** (`@pipeline/wallet-connect` `loanRegistry.ts`): `parseUsdcToU128(value, decimals = 7)`
   replaces `parseUsdcBaseUnitsToU128` — exact `BigInt` scaling by 10^decimals, throws on more
   fractional digits than the scale holds or a malformed string. `1200000.000000` →
   `12_000_000_000_000n`.
4. **Displays**: the trustee origination table/detail and the LP In Origination tab stop dividing
   by 10^7 — `economicsUsdDecimal(raw)` (both apps) validates the served string and passes it
   through to the formatters, so `1200000.000000` renders $1,200,000.

**Existing staging rows** submitted under the #912 reading (base-unit strings) will display 10^7×
too large after this; they were wrong on-chain anyway (the `$0.12` draw) and are re-entered in
human units. Noted on the issue and in the user-stories doc.

## Scope

`packages/wallet-connect`, `packages/trustee`, `packages/frontend` (display only). Tests across
the fixtures that encoded base units. Docs: `trustee-flows.md` (data layer, submit form, detail),
`dashboard-components.md` (In Origination Facility row), `utils.md`, user-stories doc + index row.
Memory note on staging submission conventions updated.

## Open Questions

_None._

## Test Strategy

`yarn workspace @pipeline/wallet-connect test`/`lint`; `yarn workspace @pipeline/trustee lint`,
`build`, `test`; `yarn workspace @pipeline/frontend lint`, `build`, `test`;
`npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`.
