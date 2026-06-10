# Issue #541: Stake page: exchange rate renders 959600000000.0000 sPLUSD (formatted with wrong decimals) instead of 0.9596

Source: https://github.com/eq-lab/pipeline/issues/541

Parent epic: #531 (Stake/unstake page). Branch: `fix/541-stake-exchange-rate-decimals`.

## Scope

The Stake page exchange-rate row renders `1 PLUSD = 959600000000.0000 sPLUSD` — too large by a
factor of 1e12 — instead of the Figma value `1 PLUSD = 0.9596 sPLUSD`. The convert hooks return an
18-decimal value (`convertToShares(1e18) = 959600000000000000n`), but the rate row formats it with
the sPLUSD token's *live* decimals, which resolve to 6 in the running app, dividing by 1e6 instead of
1e18.

In scope:

- Fix the exchange-rate row (`exchangeRateText`) on both Stake and Unstake directions so it formats
  the convert output with the correct 18-decimal scale.
- Fix the symmetric preview-output path (`previewOutputValue`) if it shares the same decimals-source
  bug (it does — see Root Cause).
- Add/adjust a regression test that fails on the off-by-1e12 output.

Out of scope:

- Re-pointing `.env`'s `VITE_STAKED_PLUSD_ADDRESS` or fixing the deployed contract. The fix must be
  correct regardless of which sPLUSD contract address is configured.
- Any change to the convert mock convention or the `useEvmToken` / `useStakedPlusd` hook contracts
  beyond what the fix strictly requires.
- The Network fee row, APR header, and other unrelated rows.

## Root Cause

The convert hooks (`useStakedPlusdConvertToShares` / `useStakedPlusdConvertToAssets` in
`packages/frontend/src/wallet/evm/useStakedPlusd.ts`) return a value scaled to **18 decimals**:
`convertToShares(parseUnits("1", 18)) = (1e18 * 0.9596e18) / 1e18 = 959_600_000_000_000_000n`. By the
ERC-4626 convention these functions return *share-token units* (sPLUSD, 18 decimals) for
`convertToShares` and *asset-token units* (PLUSD, 18 decimals) for `convertToAssets`.

In `packages/frontend/src/routes/stake.tsx`:

- `exchangeRateText` (≈ line 259) formats `rateSharesPerPlusd.data` with `splusdToken.decimals`
  (≈ line 266), and `rateAssetsPerSplusd.data` with `plusdToken.decimals` (≈ line 274), via
  `formatUnits4` (≈ line 69 — a viem `formatUnits` wrapper).
- `previewOutputValue` (≈ line 250) formats `sharesPreview.data` with `splusdToken.decimals` and
  `assetsPreview.data` with `plusdToken.decimals` via `formatUsdc` (same decimals source).

`splusdToken` comes from `useEvmToken({ token: splusdAddr })` where
`splusdAddr = ENV.STAKED_PLUSD_ADDRESS` (stake.tsx ≈ line 85, 91). `useEvmToken` resolves decimals
from the mock key `pipeline.mock.wallet.contract.<splusdAddr>.decimals`, falling back to a live
`decimals()` RPC read (`useEvmToken.ts` lines 126–179).

The decimals source and the rate source disagree on which address they key off:

- The convert rate uses the **address-independent named-alias** mock
  `pipeline.mock.wallet.contract.stakedPlusd.convertToShares` (useStakedPlusd.ts line 55), so it
  returns the 18-decimal `959600000000000000n` regardless of the configured contract address.
- The sPLUSD decimals use the **env-address-keyed** mock
  `pipeline.mock.wallet.contract.<ENV.STAKED_PLUSD_ADDRESS>.decimals`.

The `/test` fixture seeds the decimals key under the *hardcoded fixture address*
`0x5555…0005` (`packages/frontend/src/routes/test/-scenarios.ts` lines 60, 81), but the running app's
`.env` sets `VITE_STAKED_PLUSD_ADDRESS = 0x833e31FB8eedB824C3eF32D2d074Be25fBAaf766` (verified in
`/Users/dima/git/pipeline-background/.env`). The two addresses differ, so the fixture's
`…0005.decimals = 18` is never matched. `useEvmToken` falls through to a live `decimals()` RPC against
`0x833e…f766` on Hoodi, which returns **6**. `formatUnits4(959600000000000000n, 6) =
"959600000000.0000"` — exactly the reported bug.

Why the existing unit test (`packages/frontend/src/routes/-stake.test.tsx` line 527) does not catch
it: that test mocks `@/lib/env` with `STAKED_PLUSD_ADDRESS = 0x5555…0005` (lines 144–145) — the same
address it uses to seed the decimals key (lines 134, 209) — so decimals resolve to 18 and the row
renders `0.9596`. The test only passes because the mock env address coincides with the fixture
decimals address; it does not exercise the address-mismatch path the real app hits.

Conclusion: the bug is a **decimals-source mismatch**. The convert hooks already promise an output in
the share/asset token's native 18-decimal units (per the convert-mock convention documented in
useStakedPlusd.ts lines 14–22), so the row must format that output against the *correct* token
decimals. The fix is to stop depending on a live/ambiguous `useEvmToken` decimals read for a value
whose scale is contractually fixed at 18, and instead format the convert output against 18 decimals
directly (matching how convertToShares/convertToAssets are defined). See Implementation Steps for the
chosen approach and the alternative.

## Assumptions and Risks

- Assumption: sPLUSD and PLUSD are both 18-decimal tokens — confirmed by the fixture
  (`…0005.decimals = 18`, `PLUSD.decimals = 18`) and the convert-mock convention (1e18 scale) in
  `useStakedPlusd.ts` (RATE_SCALE = 1e18, lines 18–22, 78). The ERC-4626 `convertToShares` /
  `convertToAssets` return values are in share/asset token base units respectively; both are 18.
- Risk: the same `splusdToken.decimals` / `plusdToken.decimals` source feeds `previewOutputValue`
  (stake.tsx lines 250–256). Under the real app's address-mismatch path the preview output is also
  wrong by 1e12. The fix should cover both rows, not just the rate row, or the page stays broken for
  the user-visible preview number.
- Risk: `parseUnits("1", plusdToken.decimals)` for `oneStake`/`oneUnstake` (lines 150–157) also reads
  token decimals. `plusdToken.decimals` resolves correctly (PLUSD address comes from the vault's
  `asset()` named alias, which is address-independent and seeded), so the stake-direction input is
  fine. But if any direction's decimals are wrong, the `1 unit` input to the convert hook is
  mis-scaled and the rate is wrong even before formatting. Verify both directions after the fix.
- Risk: hard-coding `18` removes the live decimals dependency but assumes the tokens never become
  non-18-decimal. This is safe for sPLUSD/PLUSD but should be expressed as a named constant with a
  comment, not a bare literal, so a future non-18 token surfaces the assumption.
- Risk: the unit test gives false confidence (passes today). The regression test must reproduce the
  *address-mismatch* condition, or at minimum assert the formatted output is `0.9596` while the token
  decimals read resolves to something other than 18 — otherwise the test will keep passing even if the
  bug regresses.

## Open Questions

_None_

## Implementation Steps

1. In `packages/frontend/src/routes/stake.tsx`, introduce a module-level constant documenting the
   share/asset decimals contract, e.g.:
   `// convertToShares/convertToAssets return values in the token's native 18-decimal base units`
   `const CONVERT_DECIMALS = 18;`
   Place it near `formatUnits4` (≈ line 69) with a comment referencing the convert-mock convention in
   `useStakedPlusd.ts` (lines 14–22).

2. Fix `exchangeRateText` (≈ lines 259–276):
   - Stake direction: change `formatUnits4(rateSharesPerPlusd.data, splusdToken.decimals)` (line 266)
     to format against `CONVERT_DECIMALS`.
   - Unstake direction: change `formatUnits4(rateAssetsPerSplusd.data, plusdToken.decimals)` (line
     274) to format against `CONVERT_DECIMALS`.
   - Remove the now-unnecessary `splusdToken.decimals === undefined` / `plusdToken.decimals ===
     undefined` guards from the rate paths *only if* the convert `.data === undefined` guard is
     sufficient to gate rendering. Keep the `.data === undefined` guard returning `"—"`. (The decimals
     guard becomes irrelevant once decimals are a constant — but confirm nothing else in the
     conditional relied on it.)

3. Fix `previewOutputValue` (≈ lines 250–256) for the same root cause:
   - Stake direction: `formatUsdc(sharesPreview.data, splusdToken.decimals)` → format against
     `CONVERT_DECIMALS` (sharesPreview is sPLUSD output, 18-decimal).
   - Unstake direction: `formatUsdc(assetsPreview.data, plusdToken.decimals)` → format against
     `CONVERT_DECIMALS` (assetsPreview is PLUSD output, 18-decimal).
   - Keep the existing `.data !== undefined` guard; drop the decimals-undefined check from these two
     branches once decimals are constant.

4. Review `oneStake`/`oneUnstake` (≈ lines 150–157). These build the "1 unit" input to the convert
   hooks from token decimals. Because the convert mock scales by 1e18 internally, the input must be
   `parseUnits("1", 18)` for the rate to read as "per 1 whole token". Change these to use
   `CONVERT_DECIMALS` as well so the rate computation does not depend on a possibly-wrong live
   `splusdToken.decimals` on the unstake direction (line 156 uses `splusdToken.decimals`, which is the
   broken read). Keep the `decimals !== undefined` loading gate semantics intact — if the intent was
   only to wait for load, gate on the convert hook / connection state instead, or keep gating on the
   token read but pass `CONVERT_DECIMALS` to `parseUnits`. Pick the minimal change that makes the
   input scale independent of the live sPLUSD decimals read.

5. Do NOT change `useEvmToken`, `useStakedPlusd`, the convert-mock convention, or the `/test` fixture
   addresses. The fix is contained to `stake.tsx`. (Optionally note in
   `docs/exec-plans/tech-debt-tracker.md` that the `/test` fixture seeds sPLUSD metadata under
   `0x5555…0005` while `.env` points elsewhere, so live decimals leak into the mocked stake flow — but
   do not fix the fixture in this issue.)

6. Verify no remaining use of `splusdToken.decimals` / `plusdToken.decimals` in stake.tsx feeds a
   convert-hook output through a formatter. `formattedInputBalance` / `formattedOutputBalance` and the
   `amountBig`/`onQuickAmount` paths operate on raw balances and the input field — those legitimately
   need the *token's own* decimals and must NOT be switched to the constant. Only the convert-output
   formatters (rate row + preview output) change.

## Test Strategy

- Update `packages/frontend/src/routes/-stake.test.tsx` so a regression test reproduces the
  address-mismatch path, not the coincidental match:
  - Add a test (or parametrize the existing rate test at line 527) where the mocked
    `@/lib/env`'s `STAKED_PLUSD_ADDRESS` differs from the address used to seed the sPLUSD
    `…decimals` mock key, OR seed `…<splusdAddr>.decimals = "6"` while the convert alias stays
    18-scaled. Assert the rate row still renders `1 PLUSD = 0.9596 sPLUSD` (and Unstake
    `1 sPLUSD = 1.0421 PLUSD`). Without the fix this assertion produces `959600000000.0000` /
    `1042100000000.0000` and fails.
  - Add the symmetric assertion for `previewOutputValue`: with 10 PLUSD entered and sPLUSD decimals
    resolving to 6, the converted output must still show `9.596` (≈ `9.60`), not a 1e12-inflated
    number. Mirror the existing preview test at line 535.
- Keep the existing passing tests (lines 527, 707) green — the fix must not regress the matched-address
  case.
- Run the frontend unit suite for this file (`yarn workspace <frontend> test src/routes/-stake.test.tsx`
  or the project's standard vitest invocation) and confirm both new assertions fail before the fix and
  pass after.
- Manual / Figma verification: run the app, open `http://localhost:3000/test`, select scenario
  "Connected, ready to stake (approved)", navigate to `/stake`, and confirm the exchange-rate row reads
  `1 PLUSD = 0.9596 sPLUSD` and the Unstake tab reads `1 sPLUSD = 1.0421 PLUSD`, matching Figma
  node-id `1500-102009` / approved frame `1498-101158`
  (https://www.figma.com/design/A43rjYYjSwdTmiwwf5cx5n/Pipeline?node-id=1500-102009&m=dev). Also
  confirm the preview output number is sane (e.g. ~9.596 sPLUSD for 10 PLUSD), not 1e12-inflated.

## Docs to Update

- No product-spec or design-doc change required — this is a `fix/` with no behavior contract change;
  the corrected behavior already matches the Figma reference and the documented convert-mock
  convention.
- Optional: add a one-line note to `docs/exec-plans/tech-debt-tracker.md` recording that the `/test`
  stake fixture seeds sPLUSD token metadata under the hardcoded fixture address while `.env` points
  `VITE_STAKED_PLUSD_ADDRESS` elsewhere, causing live RPC decimals reads to leak into an otherwise
  mocked flow (the latent condition that produced this bug). Not a blocker for the fix.
