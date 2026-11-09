# Issue #1762: Trustee: Cash reporter role for wire-in, repayment and bank-income bookings — gate by can_call, add record_income

Source: https://github.com/eq-lab/pipeline/issues/1762

Epic #1795 (frontend). Branch `feat/1762-trustee-cash-reporter-gating`, draft PR #1874. Source of truth: `docs/user-docs/how-it-works/capital-layer.md` (cash-book table), `docs/user-docs/governance/fiduciary-trustee.md`, `docs/user-docs/governance/multisig-roles.md`, `docs/user-docs/security/capital-safeguards.md` §"Deposit manager and minter". The 2026-10-29 issue comment splits the work: role gating and the bank-income entry now, the two-signer (2-of-2) flow later.

## Findings (read-only testnet simulation, 2026-11-09, nothing submitted)

Tool: Node and the repo's `@stellar/stellar-sdk` over `https://soroban-testnet.stellar.org`. AccessManager `CDP7TUNBGIKDBGEUZCA6WEDVJ7BTJFXNIPQF6HWEDV7SAAS7VN75WHTW` (`VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`). Minter `CAPL5WN3FAUAD3TTUNU7NTEMKCW24D7GM7UXJMNYRS6BHO3WTAJKAIFK` (`VITE_STELLAR_YIELD_MINTER_ID`).

| Check | Result |
|---|---|
| Deployed minter spec | `record_income(caller: Address, delta: i128, value_date: u64, ref_hash: BytesN<32>) -> ()` |
| Same spec, neighbours | `record_wire_in(caller, receiver, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> u32`; `repay(...) -> u32`; `ref_hash_seen(ref_hash: BytesN<32>) -> bool`; `record_expense(delta, value_date, ref_hash)` (no `caller`, `TRUSTEE`, not in scope) |
| `am.get_target_function_role(minter, fn)` | `record_income`, `record_wire_in`, `repay` → `CASH_REPORTER`; `record_expense` → `TRUSTEE` |
| `am.can_call(w, minter, fn)` for the three functions | `{immediate: true, delay: 0}` for `GAZFDDYK…`, `GCGQVOJHQNDO…`, `GCOBEHPP…` |
| `record_income` path, from the diagnostic events | `can_call(caller, minter, "record_income")` is checked first, then the rate limit, then `am.execute(PLUSD, mint, [sPLUSD, delta], minter)` |
| `record_income` with the zero `ref_hash` | `Error(Contract, #28)` (MissingRef) |
| `record_income` with `delta < 0` | `Error(Contract, #6)` |
| `record_income` with a valid input | `Error(Contract, #1)` raised by the **AccessManager** on the nested `PLUSD.mint`: `get_target_function_role(PLUSD, mint) = MINTER`, `can_call(minter, PLUSD, mint) = {immediate: false}` |
| `record_wire_in` to the capital wallet | The same `Error(Contract, #1)`. Every minter mint path is blocked on testnet right now, which is a deployment fact and not a frontend problem (see Risks). |
| `rate_limit_config` | `tx_limit 10000000000000` (1,000,000 PLUSD at 7 dp), `window_limit 100000000000000`, `window 86400` |
| `ref_hash_seen(0x00…)` | `false` (a plain bool read) |

Wire `ref_hash` derivation (backend `packages/api/src/routes/lp_bank_deposits.rs::reference_hash`): `sha256(payment_reference.trim())` over UTF-8 bytes. The income entry uses the same derivation, so one bank reference can be booked once across wires and income (`consume_mint_ref` / `ref_hash_seen` is one set).

EVM: `@pipeline/wallet-connect` has only pure calldata encoders for the minter (`evm/contracts/minter.ts`: `repay`, `reverseRepay`). It has no EVM write client and no EVM AccessManager read. Signing is blocked on #1573 (TD-152). **So the EVM arm stays read-only with the existing reasons** (see step 7).

## Scope

In scope:

1. **Role gating by `can_call`** for the three Cash reporter bookings, with the connected Stellar wallet as `caller` and the minter as `target`. A booking is enabled only when `can_call(...).immediate === true`, which means delay 0. A Trustee-only wallet sees it disabled, with copy built from the docs' wording ("Repayments, incoming wires and bank income are booked by a separate role, the Cash reporter"):
   - LP detail → Bank deposits → **Mint PLUSD** (`record_wire_in`, #1449/#1826): "Only the Cash reporter can book incoming wires."
   - **Record Coupon** / **Record Repayment** (`repay`, #1712): "Only the Cash reporter can book repayments." Close-loan (`close_loan`, Trustee role) is **not** gated by this.
   - **Bank income** (`record_income`, new): "Only the Cash reporter can book bank income."
2. **Bank income entry** in Cash Management: a new "Bank income" tab with a "Book income" dialog. It takes an amount, a value date and a bank reference. `ref_hash = sha256(reference.trim())` and `ref_hash_seen` is checked before the signature request. On success it shows the tx hash, and the booking appears in the Audit Log as the served "Cash recorded — Income $X".
3. The same `ref_hash_seen` pre-check is added to the existing Mint PLUSD flow, so a reused wire reference is refused before signing. Today the `RefHashSeen` copy in `mintError` can never match, because the deployed minter ships no named error enum.
4. Specs, plus a user-stories doc under `docs/user-stories/epic-1795/`.

Out of scope:

- **The two-signer (2-of-2) Cash reporter flow.** Build once, collect signature 1, hand the envelope over (XDR export/import or a shared draft), collect signature 2, submit, and show "awaiting second signature". This is deferred until ops/contracts confirm how the 2-of-2 is realised per chain: a Stellar multi-signer account with thresholds, a contract multisig, or a Safe / two-key account on EVM. On both testnets the role is held by single EOAs today. **Follow-up issue to file (by the manager/user, not here): "Trustee: two-signer (2-of-2) Cash reporter signing for wire-in, repayment and bank-income bookings".** It should also cover whether a Cash-reporter-only wallet (not a Trustee account) may sign in to the console.
- EVM signing of any of the three bookings (TD-152, #1573).
- Any backend work: no endpoint, no income list API. The income record lives on-chain plus the indexed `CashRecorded` in the audit log.
- Escrow assign/return (#1763), wire-out (#1764), ramps/expenses (#1765).
- The repayment-recovery dialog (#1711) already gates "Record corrected repayment" on `canRepay.immediate`. It stays unchanged.

## Assumptions and Risks

- **Testnet cannot complete any minter mint right now.** The minter lacks the PLUSD `MINTER` role on the AccessManager, so `record_wire_in`, `record_income` and the interest/fee leg of `repay` fail at simulation with the AccessManager's `Error(Contract, #1)` after the role check passes. The gating and the pre-checks are fully verifiable. A successful booking end-to-end waits on ops granting `MINTER` to the minter on PLUSD. Log this in `docs/exec-plans/known-bugs.md` (step 10), not in code. The UI surfaces it through the generic `toUserError` copy with the raw details.
- The AccessManager id is `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, the same one #1711 uses for minter `reverse_repay`. The minter's own `can_call` hits the same contract (seen in the diagnostic events). `.env.example` carries a different executor id (`CAGCWDZ…`) from the deployed `.env` (`CDP7TUNB…`). A stale id makes the read fail, and the UI fails closed (disabled, "could not verify"). It never enables a booking.
- Gating fails closed. While the read is pending the action is disabled with "Checking this wallet's Cash reporter role…". A read error disables it with "Could not verify this wallet's Cash reporter role." plus details. `immediate === false && delay > 0` disables it with "This wallet holds the Cash reporter role with a {h} h delay; the minter accepts only immediate calls." (`formatDelayHours`).
- On testnet both configured trustee wallets (`GAZFDDYK…`, `GCGQVOJHQNDO…`) hold `CASH_REPORTER`, so they see the actions enabled. The "Trustee-only" story needs a wallet without the role (#1712 recorded `GC72TZ…`; any trustee-allowlisted wallet without the grant works).
- **Dependency: PR #1873 (#1761) is open** and touches `packages/wallet-connect/src/stellar/contracts/minter.ts` (moves `sha256Hex` to a new `hash.ts`), `wallet-connect/src/index.ts`, `docs/frontend/trustee-flows.md`, `docs/user-stories/index.md` and `scripts/lint-comments.baseline.json`. If #1873 has merged when work starts, rebase onto `origin/main` first and import `sha256Hex` from `./hash`. Otherwise use the in-file helper, and expect a small rebase conflict on these files.
- Per-tx limit: 1,000,000 PLUSD, per-window: 10,000,000 (user docs and the served config). No client-side cap check. The contract rejects it and the error shows verbatim. No code-specific copy is added for minter codes: nested PLUSD/SAC/AccessManager codes collide with minter codes (#1712 decision). The two expected refusals (no role, reused reference) are instead caught before signing by the `can_call` and `ref_hash_seen` reads.
- `record_income` returns `()`, so there is no entry id to show. Success shows the tx hash, and the indexed `CashRecorded` appears in the Audit Log after the indexer catches up. No client-side "booked" flag is kept.

## Open Questions

_None_

## Implementation Steps

0. If PR #1873 has merged: `git fetch origin && git rebase origin/main`, then `yarn install`.

1. **`packages/wallet-connect/src/stellar/contracts/minter.ts`** (keep the existing two `// spec:` lines and add `// spec: docs/product-specs/cash-reporter-bookings.md`):
   - `export interface RecordIncomeArgs { caller: string; amount: string; valueDate: number; refHash: string }`
   - `export function encodeRecordIncomeArgs(args): xdr.ScVal[]` → `[Address(caller), i128(parseUsdDollarsToI128(amount)), u64(valueDate), hexToBytes32ScVal(refHash)]`. Throw on a non-positive-integer `valueDate` and on the zero hash (same messages as `encodeRepayArgs`).
   - `export async function buildRecordIncomeEnvelope({ minterId, rpcUrl, networkPassphrase, ...args })` follows `buildRepayEnvelope`: `contract.call("record_income", ...)`, source = `caller`, and a simulation error is rethrown as `recordIncome simulation error: …`.
   - `export async function recordIncome({ signTransaction, onStageChange, ...build }): Promise<{ hash: string }>` uses the same stage sequence and send/poll error handling as `repay`. Type `RecordIncomeStage = RelayStage`.
   - `export async function readRefHashSeen({ minterId, refHash, rpcUrl, networkPassphrase }): Promise<boolean>` via `simulateRead(minterId, "ref_hash_seen", [hexToBytes32ScVal(refHash)])`, returning `=== true`.
   - `export function bankReferenceRefHash(reference: string): Promise<string>` returns `sha256Hex(reference.trim())`. It throws on an empty trimmed reference. Byte-identical to the backend `reference_hash`.
2. **`packages/wallet-connect/src/index.ts`**: export the five functions above and their types next to the existing minter exports.
3. **`packages/trustee/src/lib/cashReporter.ts`** (new, one `// spec: docs/frontend/trustee-flows.md#cash-reporter-bookings` header):
   - `export type CashReporterFn = "record_wire_in" | "repay" | "record_income";`
   - `export const CASH_REPORTER_NO_ROLE: Record<CashReporterFn, string>` holds the three sentences in Scope §1.
   - `export function cashReporterReason(fn, state: { access?: CanCall; isPending: boolean; isError: boolean }): string | null`. It returns null only when `access.immediate`. Otherwise it returns the checking / could-not-verify / delay / no-role copy from Risks.
4. **`packages/trustee/src/api/useCashReporterAccess.ts`** (new): `useCashReporterAccess(fn: CashReporterFn, enabled: boolean)` uses `useStellarWallet().address` and `useQuery` with key `["cash-reporter-access", address, fn]`. It is enabled when `enabled && address && ENV.STELLAR_YIELD_MINTER_ID && ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, with `staleTime 30_000` and `retry false`. It calls `readCanCall({ accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID, caller: address, target: ENV.STELLAR_YIELD_MINTER_ID, fn, rpcUrl, networkPassphrase })`. It returns `{ reason: cashReporterReason(fn, …) }` plus the raw query. Pass `enabled = false` on EVM sessions.
5. **Mint PLUSD gating**, in `packages/trustee/src/routes/-useLpBankDeposits.ts`:
   - Call `useCashReporterAccess("record_wire_in", kind === "stellar")`.
   - In `mintDisabledReason`, insert the role reason after the "Connect your trustee wallet" and "not configured" checks and before the receiver/minted/pending checks. Add it to the `useCallback` deps.
   - In `packages/trustee/src/api/useRecordWireIn.ts`, before `recordWireIn`, `await readRefHashSeen({ minterId, refHash, … })`. When true, throw `new Error("RefHashSeen: this deposit's ref_hash is already consumed on the minter.")` so the existing `mintError` `/RefHashSeen/` branch renders "This deposit's reference has already been minted on-chain. Refresh the list."
   - Keep `wireInReceiver` and the capital-wallet fallback unchanged (decision 2026-11-02).
6. **Record Coupon / Record Repayment gating**:
   - `routes/-record-coupon.ts` `useRecordCoupon` and `routes/-record-repayment.ts` `useRecordRepayment` call `useCashReporterAccess("repay", entry != null && stellarOnlyActionReason(entry.chain_id) === null)`. Expose a new view field `roleBlockedReason: string | null`. It is `null` when `onChainBlockedReason` is set, so the EVM reason wins.
   - `recordPaymentInput` becomes `null` when `roleBlockedReason !== null`. In Record Repayment, `closureReason` keeps depending on `onChainBlockedReason` only, so close-loan is not gated by the Cash reporter role.
   - In `loans.$id_.record-coupon.tsx` / `loans.$id_.record-repayment.tsx`, render `view.roleBlockedReason` in the same muted `<p>` style as the on-chain reason, with `data-testid="record-coupon-role-blocked"` / `"record-repayment-role-blocked"`.
7. **EVM arm (read-only, existing reasons)**:
   - Mint PLUSD keeps "PLUSD minting on {chain} is not available in the Trustee app yet."
   - Record Coupon/Repayment keep `stellarOnlyActionReason`.
   - Bank income on an EVM session renders the tab, with the "Book income" button disabled and the line "Booking bank income on {chain} is not available in the Trustee app yet." (same shape as the Mint PLUSD reason). No `can_call` read on EVM.
8. **Bank income**:
   - `packages/trustee/src/api/useRecordIncome.ts` (new) follows the `useRecordWireIn` shape. Input `{ amount: string; valueDate: number; reference: string }`. It short-circuits with "On-chain bank income booking is not configured for this environment." when `ENV.STELLAR_YIELD_MINTER_ID` is empty, and with "Stellar wallet not connected." when no wallet is connected. Then `refHash = await bankReferenceRefHash(reference)`. If `await readRefHashSeen(...)` is true, it throws an `Error` whose message starts with `RefHashSeen`. Then it calls `recordIncome({... caller: address, onStageChange: setStage })`. `onSuccess` invalidates `["capital-allocation"]` and `["audit-log"]` immediately and again after 5 s and 15 s (the `useRecordPayment` pattern).
   - `packages/trustee/src/routes/-cash-management-income.ts` (new presenter): `useBankIncome()` holds the dialog state (`amount`, `valueDateInput` defaulting to today's UTC date, `reference`, `touched`) and the chain from `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`, plus `kind` and `chainLabel`.
     - Validation messages: "Enter an amount greater than 0 with at most 2 decimal places." (`parseUsdCentsInput`), "Enter the bank's reference for this income.", "Enter the value date." and "The value date cannot be in the future."
     - `valueDate` is UTC midnight Unix seconds. Reuse `todayDateInput` / `dateInputToValueDate` by moving them to `utils/formatDate.ts` and re-importing them in both record presenters.
     - `openReason`: the EVM reason or `null`. `submitReason`: wallet not connected → "Connect your trustee wallet to book bank income.", then the not-configured copy, then `useCashReporterAccess("record_income", kind === "stellar").reason`.
     - `incomeError(error)` maps `/RefHashSeen/` to "This bank reference is already booked on-chain. Each bank record's reference can be used once." Everything else goes through `toUserError(error, "Could not book this income. Please try again.")` with details.
     - On success: close the dialog and keep `lastBooked = { hash, amount, valueDate }` in memory for a success line.
   - `packages/trustee/src/routes/-BankIncomeDialog.tsx` (new, JSX only) copies the `WithdrawalTopUpDialog` / Bank-deposits "Record deposit" dialog shell: backdrop, Escape closes, no close while pending. It has three fields (Amount (USD), Value date (`type="date"`, max today UTC), Bank reference), the role/EVM reason line, `InlineError` with details, and a submit button labelled from `stageLabel(stage, "Book income")`. Testids use the `cash-management-income-*` prefix.
   - `packages/trustee/src/routes/cash-management.tsx`: add `{ key: "income", label: "Bank income" }` to `TABS` and an `income` branch. The branch renders a header card in the same layout as the T-Bills card: title "Bank income", the session chain chip, the sub-line "Bank interest booked by the Cash reporter is minted into the vault.", and a "Book income" button disabled with `openReason`. It also renders the success line "Booked {amount} income, value date {date}. Transaction {hash}. It appears in the Audit Log once indexed." with a link to `/audit-log`. Close the income dialog on tab change, like the other dialogs. Shrink this file's `scripts/lint-comments.baseline.json` entry if its comment count drops. Add no new comments.
9. **Lint/build**: `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`, then `yarn workspace @pipeline/wallet-connect test`, `yarn workspace @pipeline/trustee test`, and the typecheck/build for both packages. No new route, so no `routeTree.gen.ts` regeneration.
10. **Docs**: see Docs to Update.

## Test Strategy

Vitest, colocated with the existing suites. No localStorage mocks. Hooks are mocked at the `@/api/*` / `@pipeline/wallet-connect` boundary as the current tests do.

- `wallet-connect/src/stellar/contracts/minter.test.ts`:
  - `encodeRecordIncomeArgs` returns exactly four args with types `Address`, `i128` (`"1250.50"` → `12505000000n`), `u64` and `bytes(32)`. It rejects a zero/negative amount, a bad `valueDate` and the zero hash.
  - `buildRecordIncomeEnvelope` targets the minter with `record_income` (no `execute` wrapper) and propagates a simulation error with its text.
  - `recordIncome` runs the stage sequence and throws on a send ERROR and on a non-SUCCESS poll.
  - `readRefHashSeen` maps a `true`/`false` retval.
  - `bankReferenceRefHash("  ABC-123 ")` equals the sha256 of `"ABC-123"`. Pin it against a known vector, the same hex the backend's `reference_hash` produces. An empty reference throws.
- `trustee/src/lib/-cashReporter.test.ts` covers each branch of `cashReporterReason` (pending, error, immediate, delay > 0, no role) for the three functions.
- `trustee/src/api/-useCashReporterAccess.test.tsx` (`readCanCall` mocked): it calls `readCanCall` with AccessManager = executor id, target = minter id, `caller` = wallet and the given `fn`. It does not run when disabled (EVM), with no wallet, or with ids unset.
- `trustee/src/api/-useRecordIncome.test.tsx`:
  - Not-configured and no-wallet short-circuits.
  - `ref_hash_seen = true` throws `RefHashSeen…` and never calls `recordIncome`.
  - The happy path passes `valueDate`, `refHash` and the amount through, and invalidates `capital-allocation` and `audit-log`.
- `trustee/src/api/-useRecordWireIn.test.tsx` (extend): a seen ref throws before `recordWireIn` is called.
- `trustee/src/routes/-LpBankDepositsSection.test.tsx` (extend):
  - A no-role wallet shows Mint PLUSD disabled with "Only the Cash reporter can book incoming wires."
  - The pending read shows the checking copy, and a read error shows "Could not verify…".
  - A Cash reporter wallet behaves as before.
  - The EVM session keeps its reason, and no access read runs.
- `-record-coupon-page.test.tsx`, `-record-repayment-page.test.tsx` and the presenter tests: a no-role wallet disables the submit, shows `*-role-blocked` with "Only the Cash reporter can book repayments.", and `recordPaymentInput` is null. On Record Repayment, close-loan stays enabled when the checklist passes. On an EVM loan only the Stellar-only reason shows.
- `-cash-management-page.test.tsx` (extend):
  - The "Bank income" tab renders the chain chip and the "Book income" button.
  - The button is disabled with the EVM reason on an EVM session.
  - The dialog validation messages appear and the future date is refused.
  - A no-role wallet sees the role reason with submit disabled.
  - A `RefHashSeen` failure shows the reference copy.
  - A success closes the dialog and shows the hash line with the Audit Log link.
- `-cash-management-income.test.ts` covers the presenter's validation, `valueDate` = UTC midnight and the reason ordering.
- Manual QA, through the user-stories doc against staging (Stellar testnet), with the real RPC visible in the Network tab: the Cash reporter wallet enabled, a wallet without the role disabled, a reused reference refused before signing. A successful booking is expected to fail at simulation with AccessManager `#1` until ops grants the minter `MINTER` on PLUSD. The story doc states this.

## Docs to Update

- **New** `docs/product-specs/cash-reporter-bookings.md` (target ≤ 80 lines, cap 200), with a row in `docs/product-specs/index.md`. Contents:
  - The role per the user docs, and the three minter functions with signatures.
  - The `can_call` gating rule: `immediate` = delay 0, fail closed.
  - `record_income` semantics: `delta` > 0 at 7 dp, `value_date` UTC midnight, `ref_hash = sha256(reference.trim())` shared with wires, `ref_hash_seen` pre-check, zero hash `#28`, negative `#6`, mint caps.
  - The EVM read-only state, and the 2026-11-09 testnet verification table above, including the PLUSD `MINTER` grant gap.
  - "Two-signer 2-of-2: deferred, follow-up issue".
- `docs/product-specs/loan-repay-minter.md` (19 lines): add one bullet saying the Trustee app gates Record Coupon/Repayment on `can_call(wallet, minter, repay).immediate` (link the new spec), and change "Deployment requirement" to say the wallet must hold `CASH_REPORTER` with delay 0.
- `docs/product-specs/deposits.md` §Stellar PLUSD Mint Leg (104 lines): one sentence on the `can_call` gate and the `ref_hash_seen` pre-check, linking the new spec.
- Do **not** add to `docs/product-specs/loans-data.md` (197 lines, at the cap). The signatures live in the new spec.
- `docs/frontend/trustee-flows.md`:
  - New `### Cash reporter bookings` section (anchor `#cash-reporter-bookings`) under "Cash movement & lifecycle actions". It covers the hook, copy table, reason ordering, the EVM reasons and the deferred 2-of-2.
  - Amend `### Recording a payment — Minter.repay (#1712)`: the "must hold `CASH_REPORTER`" bullet now says the page disables the submit before simulation.
  - Amend `### LP bank deposits`: add the role and `ref_hash_seen` reasons to the disabled-reason list.
  - Add a `### Bank income tab` under "Cash Management — On/Off-ramp & T-Bills" (or rename that heading's scope line to list the new tab).
- **New** `docs/user-stories/epic-1795/1762-cash-reporter-bookings.md` (shape of `1760-fresh-voucher-after-deadline.md`), with a row under "Epic #1795" in `docs/user-stories/index.md`. Stories:
  1. A Cash reporter wallet sees Mint PLUSD enabled. Network shows the `simulateTransaction` `can_call`.
  2. A Trustee-only wallet sees Mint PLUSD disabled with the copy and gets no signature prompt.
  3. Record Coupon disabled for a Trustee-only wallet.
  4. Record Repayment disabled for a Trustee-only wallet, with close-loan unaffected.
  5. Book bank income: validation, then the signature prompt, then success, then the Audit Log shows "Cash recorded — Income $X". Expected to fail at simulation with AccessManager `#1` until the PLUSD `MINTER` grant.
  6. A reused bank reference is refused before signing.
  7. An EVM session shows the read-only reasons.
- `docs/exec-plans/tech-debt-tracker.md` TD-152: add that the EVM arms of `record_wire_in` and `record_income` are also unbuilt (no EVM minter write client or AccessManager read).
- `docs/exec-plans/known-bugs.md`: add a 2026-11-09 entry. Location: testnet deployment, AccessManager `CDP7TUNB…`. Symptom: every minter mint (`record_wire_in`, `record_income`, `repay` interest) fails at simulation with AccessManager `Error(Contract, #1)`. Root cause: the minter lacks the `MINTER` role for `PLUSD.mint` (`can_call(minter, PLUSD, mint).immediate = false`). Workaround: none in the app, an ops grant is needed.
