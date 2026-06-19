# Issue #675: [FE] [Stellar] Show PLUSD and sPLUSD balances in the header (currently USDC only)

Source: https://github.com/eq-lab/pipeline/issues/675

## Scope

When a **Stellar** wallet is connected, the TopBar header currently renders a single
`WalletPill` showing only USDC (`pillBalance` from `useStellarToken().formattedBalance`).
This issue surfaces the user's **PLUSD** and **sPLUSD** balances in the header as well,
each with its own coin icon and formatted balance.

In scope:

- Add a `"splusd"` token variant to `WalletPill` (the `CoinIcon` `splusd` variant and
  the `coin-splusd.svg` asset already exist — see "Assumptions" — so only `WalletPill`'s
  `token` union needs widening).
- Wire PLUSD and sPLUSD balance reads into `TopBar.tsx` for the Stellar namespace using
  the existing hooks (`useStellarSacToken` for PLUSD, `useStellarStakedPlusdBalance` for
  sPLUSD).
- Render the three Stellar balances in the header per the layout decided in **Open
  Questions** (the chosen layout is gated on a human/design decision — see below).
- Add/extend Storybook stories for the new `splusd` `WalletPill` variant and the
  three-balance header arrangement.

Out of scope (unless the Open Questions resolution says otherwise):

- **EVM header** — stays USDC-only. The request is Stellar-specific.
- Any new balance-read hook or on-chain logic — all three reads use existing hooks.
- The `AccountDropdown` panel content (it already shows the active namespace's USDC
  balance; expanding the dropdown to list all three tokens is a separate concern unless
  the layout decision routes the extra balances into the dropdown — see Open Questions).

## Assumptions and Risks

- **`CoinIcon` already supports `splusd`.** `packages/ui/src/components/CoinIcon/CoinIcon.tsx`
  already accepts `token: "usdc" | "plusd" | "splusd"` and imports `coin-splusd.svg`
  (asset present at `packages/ui/src/assets/icons/coin-splusd.svg`). The issue's note that
  "sPLUSD needs a new token/icon variant added to … `CoinIcon`" is **stale** — only
  `WalletPill` still restricts its `token` prop to `"usdc" | "plusd"`. Confirm by reading
  both files before editing.
- **PLUSD is 1:1 with USDC**, so formatting PLUSD as a USD currency string (`$X.XX`) is
  consistent with existing UI (`StartHereCard.tsx` line ~209 documents this). sPLUSD is a
  **share token, not 1:1** — it should be shown as a token count, not a `$` value.
  `formatBigintNumber` (used in `StakeCard.tsx` for `sPLUSD shares`) is the precedent for
  the count display; the pill currently only renders a single pre-formatted `balance`
  string, so the *caller* (`TopBar`) owns formatting — see step 2.
- **Hook data shapes / param sources** (all confirmed in the codebase):
  - **USDC** — `useStellarToken().formattedBalance` → already a `$X.XX` string. (unchanged)
  - **PLUSD** — `useStellarSacToken({ assetCode: "PLUSD", assetIssuer, contractId })`
    returns `balance` as a **raw Horizon decimal string** (7-dp), NOT pre-formatted.
    The `assetIssuer`/`contractId` params come from
    `useStellarDepositManagerAddresses().addresses` →
    `addresses?.plusdAsset.issuer` and `addresses?.plusd` (this is exactly how
    `useDepositFlow.ts` line ~319 wires it). Format with `formatUsdcDisplay` (exported
    from `useStellarToken.ts`) for a `$X.XX` string, matching the USDC pill.
  - **sPLUSD** — `useStellarStakedPlusdBalance()` returns `balance` as a **raw bigint at
    7-decimal scale** (or `undefined`). Convert to a display string with `sacRawToDisplay`
    (exported from `useStellarSacToken.ts`) and/or `formatBigintNumber`, rendered as a
    token count (e.g. `"1,234.56 sPLUSD"`), NOT a `$` value.
- **Rules-of-hooks**: `TopBar` already calls all wallet hooks unconditionally at the top.
  The two new hooks must be added the same way (unconditional calls), then their results
  gated behind `stellar.isConnected` / `kind === "stellar"` in the render branch. Do not
  call hooks inside conditionals.
- **Layout risk (primary):** The Figma "Header / Connected" design (node `1497:94752`,
  file `A43rjYYjSwdTmiwwf5cx5n`) shows **a single pill only**, and the header "Buttons"
  slot is a fixed 160px-wide frame (node `1497:94724`, `x=1552 width=160`) holding one
  button. There is **no Figma design for three side-by-side balances**. Three `h-12 px-3`
  pills with currency strings will overflow the 160px slot on desktop and be very tight on
  mobile (the issue flags this). The current right slot also uses a fixed `w-40` (160px)
  container in `TopBar.tsx`. Any multi-pill layout therefore departs from the existing
  design system without a reference — this is the core open question below.
- **Mock/dev paths**: `useStellarSacToken` and `useStellarStakedPlusdBalance` both have
  localStorage mock fast-paths. Manual verification should set the relevant mock keys
  (`STELLAR_MOCK_KEYS.balanceSacPlusd`, `STELLAR_MOCK_KEYS.stakedPlusdShareBalance`) to
  exercise the connected, non-zero state without a live wallet.
- **Dependency**: PLUSD `assetIssuer`/`contractId` resolve asynchronously via
  `useStellarDepositManagerAddresses`. Until resolved, the PLUSD query stays idle and
  `balance` is `undefined` — the UI must render a placeholder (e.g. `"—"`) gracefully,
  exactly as `pillBalance` already falls back to `"—"`.

## Open Questions

1. **Layout for three Stellar balances (BLOCKING — no Figma exists).** The current Figma
   "Header / Connected" frame shows only a single USDC pill and a 160px-wide right slot;
   there is no design covering USDC + PLUSD + sPLUSD together, on desktop or mobile.
   Which arrangement does design want — (a) three pills side-by-side (matches the
   `WalletPill` "Both tokens — side-by-side" story but overflows the 160px slot and is
   tight on mobile), (b) a single summary pill in the header that opens the
   `AccountDropdown`, with all three balances listed inside the dropdown, or (c) a
   compact stacked/collapsed list? A Figma frame (or explicit direction) for the chosen
   layout — including the mobile/`MobileNavMenu` treatment — is needed before
   implementation. **Recommendation if forced to choose without design input:** option
   (b) — keep one header pill (USDC, unchanged) and add PLUSD + sPLUSD rows to the
   existing `AccountDropdown`, which already has a per-token row layout and is not width-
   constrained; this is the lowest-risk, design-consistent path. But this changes the
   issue's stated "header shows three balances" expectation, so confirm with a human.
2. **sPLUSD display unit.** Confirm sPLUSD should be shown as a **token count**
   (`X.XX sPLUSD`, since shares are not 1:1 with USD) rather than a `$` value. The plan
   assumes count display per `StakeCard` precedent; flag if design wants a PLUSD- or
   USD-equivalent instead (which would require a `convert_to_assets` read).
3. **Zero / no-trustline balances.** Show `$0.00` / `0.00 sPLUSD` pills, or hide a token
   row entirely when the balance is zero or there is no trustline? The hooks distinguish
   `hasTrustline`/`isAuthorized`, so either is implementable. Default assumption: show the
   row with a zero value (consistent with current USDC pill, which shows `$0.00` rather
   than hiding). Confirm.

## Implementation Steps

> These steps assume Open Question #1 resolves to a concrete layout. Steps 3–4 are written
> for the issue's literal "three balances in the header" reading; if the resolution is the
> dropdown variant (recommendation b), steps 3–4 move the PLUSD/sPLUSD rows into
> `AccountDropdown.tsx` instead of the header right slot (the data wiring in step 2 is
> unchanged either way).

1. **Widen `WalletPill` to accept `splusd`.**
   - `packages/ui/src/components/WalletPill/WalletPill.tsx`: change the `token` prop type
     from `"usdc" | "plusd"` to `"usdc" | "plusd" | "splusd"`. The component already
     forwards `token` straight to `CoinIcon`, which already handles `splusd`, so no other
     change is needed inside the component.
   - Update the doc comment to mention the third token.

2. **Wire the PLUSD + sPLUSD reads in `TopBar.tsx`.**
   - `packages/frontend/src/components/TopBar.tsx`: add unconditional hook calls near the
     existing wallet hooks (after `const stellarToken = useStellarToken();`):
     - `const { addresses: stellarAddresses } = useStellarDepositManagerAddresses();`
       (import from `@/wallet`).
     - `const stellarPlusd = useStellarSacToken({ assetCode: "PLUSD", assetIssuer: stellarAddresses?.plusdAsset.issuer ?? "", contractId: stellarAddresses?.plusd ?? "" });`
     - `const stellarSplusd = useStellarStakedPlusdBalance();`
   - Derive formatted display strings (import `formatUsdcDisplay` from
     `@/wallet`/`useStellarToken` and `sacRawToDisplay` from `@/wallet`/`useStellarSacToken`,
     plus the `formatBigintNumber` helper used by `StakeCard`):
     - `plusdFormatted = stellarPlusd.balance != null ? formatUsdcDisplay(stellarPlusd.balance) : "—"`
     - `splusdFormatted = stellarSplusd.balance != null ? \`${formatBigintNumber(sacRawToDisplay-derived value)} sPLUSD\` : "—"`
       (decide the exact helper: `sacRawToDisplay` yields a decimal string; format it for
       grouping/precision consistent with `StakeCard`).
   - Confirm `useStellarSacToken`, `useStellarStakedPlusdBalance`,
     `useStellarDepositManagerAddresses`, `sacRawToDisplay`, and `formatUsdcDisplay` are all
     exported from `@/wallet` (`packages/frontend/src/wallet/index.ts` — they are, per
     current exports) and add any missing import.

3. **Render the Stellar balances (header path — per resolved layout).**
   - In the connected (`anyConnected`) desktop right slot, when the active namespace is
     Stellar (`kind === "stellar"` and `stellar.isConnected`), render the additional
     PLUSD and sPLUSD pills/rows alongside the existing USDC pill, using
     `<WalletPill token="plusd" balance={plusdFormatted} />` and
     `<WalletPill token="splusd" balance={splusdFormatted} />`.
   - The EVM path is unchanged (single USDC pill).
   - Adjust the right-slot container width/layout per the resolved design (the current
     `w-40` fixed width will need to change for a side-by-side three-pill layout).

4. **Mobile treatment.**
   - Apply the resolved layout to the mobile surface (`MobileNavMenu.tsx`, which already
     receives `formattedBalance` and renders connected wallet info). Pass the PLUSD/sPLUSD
     formatted strings through and render them per the design decision.

5. **Lint & typecheck.**
   - Run the frontend typecheck/lint and `npx tsx scripts/lint-docs.ts` (per AGENTS.md
     TypeScript rule). Fix all errors before completion.

## Test Strategy

- **Unit (UI package):** Extend `packages/ui/src/components/WalletPill/WalletPill.test.tsx`
  to assert the `splusd` variant renders the sPLUSD `CoinIcon` (the test file exists today).
  Add a `CoinIcon` assertion only if not already covered (`CoinIcon.test.tsx` exists).
- **Storybook:** Add an `sPLUSD` `WalletPill` story and extend the existing
  "Both tokens — side-by-side" story (`WalletPill.stories.tsx`) into a three-balance
  header simulation reflecting the resolved layout.
- **Component (frontend):** Add/extend a `TopBar` test
  (`packages/frontend/src/components/TopBar.test.tsx` if present, else create one) that, with
  a connected Stellar wallet and the mock localStorage keys set
  (`STELLAR_MOCK_KEYS.balanceSacPlusd`, `STELLAR_MOCK_KEYS.stakedPlusdShareBalance`, plus the
  USDC mock), asserts all three formatted balances are rendered. Cover edge cases:
  - Disconnected Stellar → no PLUSD/sPLUSD pills.
  - EVM active → header stays USDC-only (no regression).
  - Zero / no-trustline → behavior matches the Open Question #3 resolution.
  - `useStellarDepositManagerAddresses` not yet resolved → PLUSD renders `"—"` placeholder.
- **Manual / Figma verification:** Once design provides a layout reference for Open
  Question #1, verify the rendered header (desktop + mobile) against it using mock balances
  in the dev app. Until then, the Figma "Header / Connected" frame (`1497:94752`) only
  documents the single-pill state and cannot serve as the acceptance reference for three
  balances — this is the gating dependency.

## Docs to Update

- No product-spec behavior change beyond what the issue states; the header surfacing more
  balances is a UI enhancement. If a `docs/frontend/` or `docs/product-specs/` entry
  documents the TopBar/header balance behavior, update it to note PLUSD + sPLUSD are shown
  for the Stellar namespace (search `docs/frontend/index.md` and `docs/FRONTEND.md` for an
  existing TopBar section; add a line there rather than a new doc).
- Update the `WalletPill` component doc comment (done in step 1) to reflect the third token.
- No `docs/exec-plans/known-bugs.md` or tech-debt entries anticipated; if the stale issue
  note about `CoinIcon` needing a new variant misleads the coder, no action — it is already
  implemented.
