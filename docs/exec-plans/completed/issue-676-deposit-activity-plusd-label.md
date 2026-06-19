# Issue #676: [FE] Deposit activity row shows "+ USDC" but the user receives PLUSD

Source: https://github.com/eq-lab/pipeline/issues/676

## Scope

The Deposit ("Buy") branch of the shared activity-row renderer labels the received amount `+ xxx USDC`. A deposit burns USDC to mint PLUSD, so the token the user *receives* is PLUSD. This is a pure label flip: change the Deposit branch's received-amount label from `USDC` to `PLUSD`.

In scope:

- `packages/frontend/src/components/activity/renderRequestRow.tsx` — Deposit branch only. Two label sites:
  - Completed: line ~107, `amount={<AmountPill>+{amount} USDC</AmountPill>}` → `PLUSD`.
  - Pending / VerificationFailed: line ~122, `primary={`+${amount} USDC`}` → `PLUSD`.
- The fix is rendered by both consumers automatically (shared helper):
  - `packages/frontend/src/routes/transactions.tsx`
  - `packages/frontend/src/components/RecentActivityCard.tsx`
- Update the unit tests that assert the Deposit label (see Test Strategy). Several tests assert `+1,000.00 USDC` for **both** Deposit and Withdraw rows using `getAllByText(...).toHaveLength(n)`; these must be split so Deposit asserts PLUSD and Withdraw asserts USDC.

Out of scope (must NOT change):

- The Withdraw ("Sell") branch — it correctly shows `+ xxx USDC` (withdraw burns PLUSD, returns USDC).
- The Stake / Unstake branches.
- The `formatTokenAmount(item.amount, 6)` decimal count — see Assumptions; it stays 6.
- The API contract / `RequestItem` shape in `packages/frontend/src/api/useRequests.ts` — no new field is needed (see Open Questions resolution).
- The home page Recent Activity (#463) and `/transactions` page are both fixed transitively by the single helper change; no per-consumer edits beyond their tests.

## Assumptions and Risks

- **Deposit mint is 1:1 USDC→PLUSD** (resolves the issue's open question — see below). `item.amount` for a Deposit is the USDC deposited; because the mint is exactly 1:1, that same numeric magnitude equals the PLUSD minted. Therefore only the label flips; the displayed number is unchanged and no new API field is required.
  - Evidence: `docs/PRODUCT_SENSE.md:10` ("LP deposits USDC → receives PLUSD (1:1)"); `docs/references/backend.md:12,26,51` ("mints PLUSD 1:1", `DepositManager` "pulls USDC … and mints PLUSD 1:1"); `docs/initial_spec.md:35` ("PLUSD minting … 1:1 with received USDC") and `:189` (bridge calls `PLUSD.mint(lpAddress, amount)` with the same `amount`).
- **Decimals stay at 6.** PLUSD is 6-decimal on-chain (`docs/references/backend.md:150`: "minted amount in PLUSD's 6 decimals"), matching USDC's 6 dp. The existing `formatTokenAmount(item.amount, 6)` for the Deposit branch remains correct for the PLUSD label. Do not change the `6` to `18` — that is the Stake/Unstake (PLUSD-18) path on a different field (`assets`/`shares`), unrelated here.
- **Overlap with #674 (PR #678, open, not merged).** PR #678 (`fix/674-stellar-activity-decimals`) edits the same file `renderRequestRow.tsx`. This plan targets current `origin/main` only. Whichever PR merges second will need a trivial conflict resolution in the Deposit branch (label text vs. decimal handling). The two changes are semantically independent (one flips a label, the other adjusts decimals), so the resolution is mechanical. Note this for the coder/reviewer; do not attempt to merge or rebase against #678 in this task. A branch `fix/676-deposit-activity-plusd-label` is already checked out for this work.
- Risk: accidentally flipping the Withdraw branch too. Mitigation: the Withdraw branch is a separate `if (item.type === "Withdraw")` block; touch only the `Deposit` block. Tests assert Withdraw still reads USDC.
- Risk: stale test assertions that conflate Deposit and Withdraw USDC counts. Mitigation: explicitly enumerated in Test Strategy.

## Open Questions

_None_

The issue's open question is resolved from the codebase/specs: the deposit mint is 1:1 USDC→PLUSD, `item.amount` carries the USDC deposited at 6 decimals which equals the PLUSD minted, so this is a pure label flip with unchanged magnitude and no API change.

## Implementation Steps

1. Edit `packages/frontend/src/components/activity/renderRequestRow.tsx`, **Deposit branch only** (`if (item.type === "Deposit")`):
   - Completed row (~line 107): change `<AmountPill>+{amount} USDC</AmountPill>` to `<AmountPill>+{amount} PLUSD</AmountPill>`.
   - Pending / VerificationFailed row (~line 122): change `primary={`+${amount} USDC`}` to `primary={`+${amount} PLUSD`}`.
   - Leave `const amount = formatTokenAmount(item.amount, 6);` unchanged.
   - Leave the entire Withdraw, Stake, and Unstake branches untouched.
   - Optionally update the file's top-of-function doc comment if it characterizes the Deposit row token; keep it accurate (Deposit received = PLUSD).
2. Update unit tests (see Test Strategy) so Deposit rows assert `+…PLUSD` and Withdraw rows still assert `+…USDC`.
3. Run the frontend test + lint gate (Test Strategy) and confirm green.

## Test Strategy

No new behavior — update existing assertions and add a focused guard. Run from `packages/frontend`.

Files and specific assertions to update:

- `packages/frontend/src/components/RecentActivityCard.test.tsx`
  - ~line 225 ("renders the Deposit (Buy) amount string"): expect `+1,000.00 PLUSD` instead of `+1,000.00 USDC`.
  - ~line 234 ("renders the Withdraw (Sell) pending amount string"): currently `getAllByText("+1,000.00 USDC").toHaveLength(2)` assuming both Deposit and Withdraw match. After the fix only the Withdraw row is USDC → assert `getAllByText("+1,000.00 USDC")` `toHaveLength(1)` (Withdraw) and add/keep a `+1,000.00 PLUSD` assertion for the Deposit row. Update the inline comment that says "Both Deposit and Sell rows show +1,000.00 USDC".
  - ~line 292 (MAX_ROWS cap): the 6th row fixture (line ~139) is a Deposit (`amount: "4000000000"`). The assertion `queryByText("+4,000.00 USDC")` must become `queryByText("+4,000.00 PLUSD")` (still `not.toBeInTheDocument()`), since that row is a Deposit.
  - ~line 451 (Stellar Deposit fixture, `amount: "3000000000"`): `getByText("+3,000.00 USDC")` → `+3,000.00 PLUSD` (the Stellar fixture row at line ~420 is `type: "Deposit"`).
- `packages/frontend/src/routes/-transactions.test.tsx`
  - ~line 221 ("Deposit (Buy) row's formatted amount under the default Buy tab"): `+1,000.00 USDC` → `+1,000.00 PLUSD`.
  - ~lines 227-228 ("does not show Withdraw amount under the Buy tab"): the Buy tab shows the Deposit row → assert `+1,000.00 PLUSD` `toBeInTheDocument()` and `getAllByText("+1,000.00 PLUSD")` `toHaveLength(1)`. (Withdraw USDC should not appear on the Buy tab.)
  - ~line 256 ("clicking Sell shows the Withdraw row"): keep `+1,000.00 USDC` (Withdraw, unchanged).
  - ~line 488 ("formats Deposit amount as '+1,000.00 USDC'"): rename + flip to `+1,000.00 PLUSD`.
  - ~line 494 ("formats Withdraw amount as '+1,000.00 USDC' on Sell tab"): keep USDC (unchanged).
  - ~line 545 (Stellar Deposit fixture `amount: "2000000000"` at line ~96): `+2,000.00 USDC` → `+2,000.00 PLUSD` if that assertion targets the Deposit/Buy row; verify against the fixture's row type before flipping.
  - ~line 568 (`queryByText("+2,000.00 USDC") not.toBeInTheDocument`): flip to PLUSD only if it refers to the Deposit row; otherwise leave. Confirm by tracing which tab/row the assertion guards before editing.
  - ~line 631 (renderRequestRow direct unit test, pending Deposit): if it asserts a USDC label, flip to PLUSD; if it only asserts non-null, leave as is.
- Confirm `packages/frontend/src/routes/-index.test.tsx` needs no change: its `USDC` hits are StartHereCard `$X USDC` balance sub-lines (not activity rows), so they stay.

Add one focused regression assertion in the `renderRequestRow` direct unit tests (in `-transactions.test.tsx`, near the existing Stake/Unstake direct tests): a Completed Deposit `RequestItem` renders text containing `PLUSD` and not `USDC`, and a Completed Withdraw renders `USDC` and not `PLUSD` — locking in that the two branches diverge.

Edge cases to cover: Deposit Completed, Deposit Pending, Deposit VerificationFailed all show PLUSD; Withdraw in all states still shows USDC.

Commands (run in `packages/frontend`):

- `yarn test` (or the project's vitest invocation) scoped to the three test files above, then the full frontend unit suite.
- TypeScript change → run `npx tsx scripts/lint-docs.ts` from repo root per AGENTS.md, plus the frontend lint/build the coder normally runs.

## Docs to Update

None. This is a `fix/` change with no product-behavior change (the deposit mint is already documented as 1:1 in `docs/PRODUCT_SENSE.md`, `docs/initial_spec.md`, and `docs/references/backend.md`). No product spec or design doc edit is required.
