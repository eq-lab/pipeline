# Issue #1898: Trustee + wallet-connect: on-chain disbursement (Minter.disburse) so a drawn loan moves Approved → Performing

Source: https://github.com/eq-lab/pipeline/issues/1898

Sub-issue of epic #1776. Resolves TD-157. Stellar only. Branch `feat/1898-trustee-disburse` (draft PR #1903), based on `main` after #1884 (`readDeal` / `registerDeal`, `useDealToken.ts`, `lib/dealToken.ts`, `-RegisterDebtTokenAction.tsx`). The plan the backend engineer wrote on 2026-11-11 (`feat/1898-trustee-minter-disburse`) was never pushed, so its decisions are not available. This plan is built from the Issue body, its comments, the epic and the contracts.

## Scope

**In scope**

1. **wallet-connect** bindings:
   - `Minter.disburse` through `AccessManager.execute(minter, "disburse", [loan_id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>], caller)`. It uses the existing `relay` (simulate → sign → send → poll), the same shape as `settleWireOut` and `registerDeal`.
   - The on-chain reads the pre-flight needs: the registry's disbursement state (status, `carved_out`, `disbursed`, `original_senior_tranche`), the loan NFT holder (`owner_of`), and whether the holder has a DEBT trustline.
2. **Trustee** loan detail (`/loans/$id`): a **"Disbursement"** card plus a **Disburse dialog**:
   - Inputs: Amount (USD), Value date (UTC, not in the future, defaults to today) and Bank reference (trimmed, 1 to 140 characters).
   - Read-only values, shown verbatim: the senior tranche, the amount disbursed on-chain and the minter's booked bank cash.
   - Pre-flight gating, each failure with a clear reason, an idempotency guard, and a refresh of the affected queries after confirmation.
3. **Docs**:
   - `docs/frontend/trustee-flows.md` (new `### Disburse (#1898)` section, plus touch-ups to Wired actions and the Stellar-only gate).
   - `docs/product-specs/trustee-dashboard.md` flow 7 and flow note B.
   - `docs/product-specs/loans-data.md` security bullet.
   - `docs/product-specs/loan-repay-minter.md` TD-157 pointer.
   - TD-157 marked resolved.
   - User-stories doc `docs/user-stories/epic-1776/1898-trustee-minter-disburse.md` plus its row in `docs/user-stories/index.md`.

**Out of scope**

- Deploying the `DEBT<nnnn>` SAC, handing its admin to the factory, and the capital-wallet trustline (ops: `just new-deal <id>` in the contracts repo). The app only detects these and explains what is missing.
- EVM disbursement (#1573). EVM loans get the existing `stellarOnlyActionReason` line.
- `reverse_disburse` / `undisburse`.
- AccessManager scheduling for a time-locked TRUSTEE role. Like wire-outs, the app executes immediately only; a delayed role gets a reason line.
- Backend changes. `CashDisbursed` is already indexed into the cash book (`docs/product-specs/minter-cash-book.md`) and the audit log.
- Changing what "Complete off-ramp" (`POST …/disbursement/complete`) does. See Open Questions Q1.

## Contract facts (pipeline-stellar-contracts HEAD, read 2026-11-12)

- `minter.disburse(loan_id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>) -> u32` is `#[only_owner]` and `#[when_not_paused]`. It runs these steps in order:
  1. `require_positive` (`#6`).
  2. `consume_ref`: `#7 RefHashSeen`. **The zero hash is skipped silently, with no replay check**, so the app must never send it.
  3. `sub_bank_cash` (`#8 InsufficientBankCash`).
  4. `registry.disburse(loan_id, amount)`.
  5. `factory.sync_debt(loan_id)`.
  6. The cash entry is written and `CashDisbursed { loan_id, entry_id, amount, value_date, ref_hash }` is emitted.
- `registry.disburse`:
  - Status must be in `Approved..WatchList`; otherwise `#3 WrongCurrentStatus`. `Closed` gives `#2`, `carved_out` gives `#21 CarvedOut`, and `disbursed + amount > original_senior_tranche` gives `#13 DisbursementExceedsTranche`.
  - The first call opens epoch 0 and moves the loan `Approved → Performing`.
- `factory.sync_debt(loan_id)`:
  - Reads `deal(loan_id).debt`; `#4 NotRegistered` when there is no deal.
  - Reads `owner_of(loan_id)` on the registry. The loan NFT is minted to `capital_wallet` in `draw_loan`.
  - Calls the DEBT SAC `balance` / `set_authorized` / `mint` on that holder. A missing trustline traps in the SAC with `Error(Contract, #13)`.
- Soroban error codes collide across contracts. `#4` is both minter `Unauthorized` and factory `NotRegistered`. `#13` is both registry `DisbursementExceedsTranche` and the SAC's missing trustline. The pause error is `#1000` (`EnforcedPause`).
- Amounts are raw 7-decimal base units.
- Live testnet state:
  - Loan 0 on registry `CDWN5…` is `Approved` and drawn through minter `CD2LPGLX…`.
  - The minter's `bank_cash` is `100000000000` (10,000 USD).
  - No DEBT asset has been issued for loan 0 yet, so the deal is not registered.

## Decisions taken in this plan

- **`ref_hash` = `sha256(reference.trim())`, through the existing `bankReferenceRefHash`.** The API serves no disbursement record or hash. This is the convention already used for Cash-reporter bookings, settle wire-out, return wire-in, ramps and bank charges (`docs/product-specs/cash-reporter-bookings.md`), and the minter's consumed set is shared across all of them. No new hashing rule is added.
- **Idempotency:**
  1. Before signing, the app reads `ref_hash_seen(ref_hash)` and refuses a consumed reference without prompting the wallet.
  2. The confirm button is disabled while the mutation is pending, so a double click cannot submit twice.
  3. A retry after an unknown outcome (for example a poll timeout) reuses the same reference, and the `ref_hash_seen` read or the simulation `#7` refuses it.
  4. The zero hash is rejected by the encoder.
- **Amount is entered, not prefilled.** No "remaining senior" figure is computed or shown. The dialog shows `original_senior_tranche` and on-chain `disbursed` verbatim, both formatted from raw by `rawToDecimal7` and `formatUsdExact`. The tranche cap is enforced by the contract (`#13`, mapped copy at simulation). The only client-side checks are comparisons, which follow the Close-ramp precedent (received ≤ opened):
  - amount > 0;
  - amount ≤ the on-chain `bank_cash`;
  - the card is hidden when `disbursed >= original_senior_tranche`.
- **Pre-flight reads come from the chain, not the API**, to avoid indexer lag (#1893 rationale):
  - registry `mutable_loan_data` and `immutable_loan_data`;
  - `deal(loan_id)` (the existing `useDeal`);
  - `owner_of(loan_id)` plus the DEBT SAC `authorized(holder)` for the trustline;
  - minter `pool_state().bank_cash` and `paused()` (the existing `useMinterPoolState` / `useMinterPaused`);
  - `can_call(caller, minter, "disburse")`.
- **Card visibility** follows the contract's status range. The card shows for a Stellar loan whose on-chain status is `Approved`, `Performing` or `WatchList`, that is not `carved_out`, and where `disbursed < original_senior_tranche`. A fully disbursed Performing loan therefore shows nothing. For `Approved`, the card is the loan's next step.
- **Placement:** one shared component, `-DisburseAction.tsx`, rendered in every loan-detail layout (performing/disbursing, watchlist, matured) directly after `RegisterDebtTokenAction`. The debt token must be registered first, so the two cards read top to bottom. The Disbursing variant's "Complete off-ramp" card is unchanged (see Q1).

## Assumptions and Risks

- **Testnet acceptance is blocked on ops.** Disburse cannot succeed on loan 0 until `just new-deal 0` deploys the DEBT SAC and adds the capital-wallet trustline, and `register_deal(0)` (#1766 UI) has run. Until then the card shows "Register this loan's debt token first" or the trustline reason, which is correct behaviour. Code, unit tests and build can finish independently. The live acceptance run (Disburse $50,000 → Performing; Record coupon and Update lifecycle → WatchList then work) waits on ops. If ops has not run by PR time, the PR description says so.
- **Bank cash:** testnet `bank_cash` = 10,000 USD, below the Issue's $50,000 acceptance amount. Either more wires must be booked first (Mint PLUSD / Cash reporter), or the acceptance run uses ≤ 10,000 USD. The `#8` / pre-flight copy covers this case.
- **Trustline probe:** the SAC `authorized(holder)` read returns `false` for an existing but frozen trustline (DEBT stays deauthorized between syncs). Only `Error(Contract, #13)` means missing, so both `true` and `false` count as present. Any other failure, such as the SAC not deployed, is a read error: the card shows "Could not verify …" and the button stays disabled.
- **Error-code collisions:** `#13` is mapped to the tranche copy because the pre-flight has already verified the trustline. The raw text stays behind "View details". `#4` is left generic, since minter `Unauthorized` and factory `NotRegistered` collide and the pre-flight covers both.
- **The relay returns only a hash.** The `entry_id` is not surfaced (same as Conversions). The success notice says the loan book updates once indexed.
- **Display status lag:** after a successful disburse the on-chain status is `Performing`, but the served display status stays `Disbursing` until the DB flag is flipped by "Complete off-ramp". The card itself keys off the on-chain read, so it updates immediately (see Q1).
- **File size:** `loans.$id.tsx` is 1516 lines. All new UI lives in new files, and `loans.$id.tsx` gains only three `<DisburseAction … />` mounts and one import.
- **Lint:** `lint-comments` requires one 2–3-line `// spec:` header per new file and nothing else.

## Open Questions

1. **Relationship to "Complete off-ramp" (`POST /v1/loan-book/{id}/disbursement/complete`).** The plan keeps the two actions side by side and independent: Disburse is on-chain, and Complete off-ramp stays the DB flag that clears the `Disbursing` display status. The alternative is to make Disburse also fire `POST …/disbursement/complete` after a confirmed first disbursement (or to replace the off-ramp card), so that one trustee action moves both the on-chain and the display status. Which is wanted? Decided by the user on #1898: Option A, keep them separate.

## Implementation Steps

### wallet-connect (`packages/wallet-connect`)

1. [x] `src/stellar/contracts/minter.ts`: add a `// ── disburse ──` block next to `reverse_repay`:
   - `export interface DisburseArgs { loanId: number; amountRaw: string; valueDate: number; refHash: string }`.
   - `export function encodeDisburseArgs(args): xdr.ScVal[]` → `[u32 loanId, i128 BigInt(amountRaw), u64 BigInt(valueDate), hexToBytes32ScVal(refHash)]`. It throws on:
     - a non-u32 `loanId`;
     - an `amountRaw` that is not `/^\d+$/` or is ≤ 0;
     - a `valueDate` that is not a positive integer;
     - `refHash === ZERO_REF_HASH`.

     Error messages are prefixed `encodeDisburseArgs:`, as in `encodeSettleWireOutArgs`.
   - `export type DisburseParams = Omit<RelayParams, "mode" | "target" | "fn" | "args"> & { minterId: string } & DisburseArgs`.
   - `export function disburse(params): Promise<RelayResult>` → `relay({ ...rest, mode: "execute", target: minterId, fn: "disburse", args: encodeDisburseArgs(...) })`.
2. [x] `src/stellar/contracts/loanRegistry.ts`:
   - `export interface LoanDisbursementState { status: string; carvedOut: boolean; disbursed: string; originalSeniorTranche: string }`.
   - `export async function readLoanDisbursementState({ registryId, loanId, rpcUrl, networkPassphrase })` simulates `mutable_loan_data(loan_id)` and `immutable_loan_data(loan_id)` in parallel through `simulateRead`. It returns the enum tag of `status` (reuse `enumTag` from `riskCouncil.ts`, exported or moved into a small shared helper), `carved_out === true`, and `String(disbursed)` / `String(original_senior_tranche)`. A missing field throws `readLoanDisbursementState: <field> missing`.
   - `export async function readLoanOwner({ registryId, loanId, ... }): Promise<string>` simulates `owner_of(loan_id)` and checks that the result is a G… or C… strkey.
3. [x] `src/stellar/contracts/dealTokenFactory.ts`: add `export async function readDebtTrustline({ debtId, holder, rpcUrl, networkPassphrase }): Promise<"present" | "missing">`. It calls `simulateRead(debtId, "authorized", [Address(holder)])`, maps any boolean to `"present"` and `Error(Contract, #13)` to `"missing"`, and rethrows anything else. This mirrors `readPlusdAuthorization`.
4. [x] `src/index.ts`: export `disburse`, `encodeDisburseArgs`, the `DisburseArgs` / `DisburseParams` types, `readLoanDisbursementState`, `LoanDisbursementState`, `readLoanOwner` and `readDebtTrustline`.

### Trustee (`packages/trustee`)

5. [x] `src/api/useDisburse.ts` (new; header `// spec: docs/frontend/trustee-flows.md#disburse-1898`):
   - `disburseConfigured()` requires `ENV.STELLAR_YIELD_MINTER_ID`, `STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `STELLAR_LOAN_REGISTRY_ID` and `STELLAR_DEAL_TOKEN_FACTORY_ID`.
   - `useLoanDisbursementState(chainId, loanId)` uses key `["loan-disbursement", chainId, loanId]`. It is enabled only when `stellarOnlyActionReason(chainId) === null`, the app is configured and the loan id is valid. `staleTime` 15 s, `retry: false`.
   - `useDebtTrustline(chainId, loanId, debt)` uses key `["debt-trustline", chainId, loanId, debt]` and is enabled when `debt` is known. It runs `readLoanOwner`, then `readDebtTrustline`, and returns `{ holder, trustline }`.
   - `useDisburseAccess(enabled)` uses key `["disburse-access", address]` and runs `readCanCall({ accessManagerId: EXECUTOR, caller, target: MINTER, fn: "disburse" })`.
   - Reuse `useDeal` from `useDealToken.ts` and `useMinterPoolState` / `useMinterPaused` from `useConversions.ts` unchanged.
   - `useDisburse()` is a mutation shaped like `useRegisterDeal` (stage state, `reset`). Its input is `{ chainId, loanId, amountRaw, valueDate, reference }`. It:
     1. checks the Stellar-only reason, the configuration and that a wallet is connected;
     2. computes `refHash = await bankReferenceRefHash(reference)`;
     3. reads `readRefHashSeen`, and if the hash is consumed, throws `REUSED_DISBURSE_REFERENCE` without a signature prompt;
     4. re-reads `fetchMinterPaused()` and throws the paused copy if the minter is paused;
     5. calls `disburse({ accessManagerId, minterId, caller, loanId, amountRaw, valueDate, refHash, signTransaction, onStageChange, ...rpc() })`.

     On success it invalidates `loan-disbursement`, `loan-mutable`, `loan-book`, `loan-financials`, `loan-valuation`, `loan-waterfall`, `cash-book`, the `minterPoolStateKey(...)` key, `deal-token`, `debt-trustline` and `audit-log`. It invalidates them immediately and again at 5 s and 15 s (indexer lag, same as repayment recovery).
6. [x] `src/lib/disburse.ts` (new): pure logic and copy, so the presenter is testable without a DOM.
   - Copy constants: `DISBURSE_NOT_CONFIGURED`, `DISBURSE_CONNECT_WALLET`, `DISBURSE_NO_ROLE` ("Only the Trustee role can disburse a loan."), `DEBT_NOT_REGISTERED` ("Register this loan's debt token first."), `DEBT_TRUSTLINE_MISSING(holder)`, `MINTER_PAUSED`, and `REUSED_DISBURSE_REFERENCE`, which reuses the wire-out wording "This bank reference is already recorded on-chain. …".
   - `disburseView(input)` returns `{ kind: "hidden" } | { kind: "blocked"; reason } | { kind: "ready" }`. Its precedence:
     1. Not Stellar → the stellar-only reason.
     2. Not configured → `DISBURSE_NOT_CONFIGURED`.
     3. Loan state pending → hidden. Loan state error → blocked "Could not read this loan on-chain."
     4. Status not in `Approved | Performing | WatchList`, or `carvedOut`, or `BigInt(disbursed) >= BigInt(originalSeniorTranche)` → hidden.
     5. Deal pending → blocked "Checking the debt token…". Deal error → blocked read error. `null` → `DEBT_NOT_REGISTERED`.
     6. Trustline pending, error or `missing` → the matching reason. The missing reason names the holder and says operations must add the DEBT trustline.
     7. Paused pending, error or `true` → the matching reason.
     8. Wallet not connected → `DISBURSE_CONNECT_WALLET`.
     9. `can_call` pending or error → "Checking / Could not verify this wallet's Trustee role". `immediate` → ready. `delay > 0` → "This wallet holds the Trustee role with a N h delay; the app does not schedule disbursements." Otherwise → `DISBURSE_NO_ROLE`.
   - `disburseFormError({ amountInput, bankCashRaw, valueDateInput, today, reference })`:
     - an amount that `parseUsdDollarsToI128` rejects → "Enter the amount disbursed (up to 7 decimals).";
     - an amount above `bankCashRaw` → "The minter's booked bank cash ({bankCash}) is below this amount. Book the incoming wires first.";
     - the date checks and the 1–140 reference rule, reusing `valueDateSeconds`, `todayUtcDateInput` and `WIRE_OUT_REFERENCE_MAX` from `lib/wireOut.ts`.
   - `disburseErrorCopy(err)`:
     - a wallet rejection or a specific mapped error is passed through as is;
     - otherwise `parseSorobanContractErrorCode` maps: `1000`/`EnforcedPause` → paused; `7`/`RefHashSeen` → reused reference; `8` → bank cash; `6` / `25` → invalid amount; `13` → "This exceeds the loan's senior tranche ({disbursed} of {original} already disbursed)." with the values passed in verbatim; `3` / `2` → "This loan's on-chain status does not allow a disbursement."; `21` → carved out;
     - anything else → the generic "Could not disburse this loan. Please try again." with details.
7. [x] `src/routes/-DisburseAction.tsx` (new): a card plus a dialog, with the same visual system as `-RegisterDebtTokenAction.tsx` and `DisbursementConfirmDialog`: `CARD_CLASS`, `CardTitle`, `BRAND`, `INK_MUTED`, a `role="dialog"` / `aria-modal` shell, Escape and backdrop cancel (blocked while pending), and `InlineError`.
   - **Card** (`data-testid="loan-detail-disburse"`): title "Disbursement". The muted line depends on status:
     - Approved: "This loan is drawn but not disbursed on-chain. Book the wire to the borrower to move it to Performing."
     - Otherwise: "Book a further disbursement against this loan's senior tranche."

     Below it:
     - KeyValue rows: Senior tranche, Disbursed on-chain, Booked bank cash (verbatim, or "—" while loading or on error);
     - the blocked reason (`data-testid="loan-detail-disburse-blocked"`);
     - a "Disburse" button, disabled unless `kind === "ready"`;
     - after success, a notice (`data-testid="loan-detail-disburse-result"`): "Disbursed {amount} on-chain, value date {date}. Transaction {hash}. The loan book updates once indexed." with dismiss.
   - **Dialog** (`data-testid="disburse-dialog"`):
     - inputs: Amount (USD), Value date (`type="date"`, default `todayUtcDateInput()`, max today) and Bank reference;
     - a read-only `ref_hash` line once the reference is non-empty, computed with `bankReferenceRefHash` as in the Conversions dialog;
     - inline form error from `disburseFormError`, and the submit button disabled while there is a form error or a pending mutation;
     - submit label through `stageLabel(stage, "Disburse")`; mutation error through `disburseErrorCopy`;
     - on success, close the dialog and show the card notice.

     Props: `{ chainId, loanId: number | null, loanName }`.
8. [x] `src/routes/loans.$id.tsx`: import `DisburseAction` and render `<DisburseAction chainId={chain} loanId={debtLoanId} loanName={detail.hero.title} />` directly after each of the three `<RegisterDebtTokenAction … variant="card" />` mounts (watchlist, matured, performing/disbursing). Nothing else changes in this file.
9. [x] Run `npx vite build` only if a route file is added. None is planned (the component is a `-` file), so `routeTree.gen.ts` should not change.

### Docs

10. [x] `docs/frontend/trustee-flows.md`:
    - Add `### Disburse (#1898)` under Loan detail, after `### Repayment recovery (#1711)`. It covers: the contract call and role, card visibility, the pre-flight order and copy, form rules, the `ref_hash` convention and idempotency, error mapping (including the `#4` / `#13` collision notes), the invalidations, and the testnet caveat (`just new-deal <id>`).
    - In `### Wired actions`, add one sentence to the Disbursement complete bullet: it remains DB-only, and the on-chain booking is Disburse. Also add Disburse to the Stellar-only gate bullet.
11. [x] `docs/product-specs/trustee-dashboard.md` (199/200 lines; edit in place, no new lines):
    - Flow 7 row: replace "not yet in the console (TD-157)" with "Trustee loan detail → Disburse (#1898)".
    - Lines 85–86: replace "next (`disburse`, TD-157)." with "next (`disburse`, Trustee loan detail, #1898)."
12. [x] `docs/product-specs/loans-data.md` (194 lines): add one security bullet after the `reverse_repay` bullet: "Minter `disburse(loan_id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>)` (Stellar) is `#[only_owner]`, so it is reached through `AM.execute(minter, "disburse", args, caller)` by a `TRUSTEE` wallet; it takes `bank_cash`, calls `registry.disburse` (first call → Performing) and `factory.sync_debt`. UI: trustee-flows.md#disburse-1898."
13. [x] `docs/product-specs/loan-repay-minter.md`: change "(TD-157)" to "(Trustee loan detail → Disburse, #1898)".
14. [x] `docs/exec-plans/tech-debt-tracker.md` TD-157: add "- **Resolved:** #1898 (wallet-connect `disburse` binding, Trustee Disburse card on `/loans/$id`)."
15. [x] `docs/user-stories/epic-1776/1898-trustee-minter-disburse.md` (new) and its row in `docs/user-stories/index.md`. Stories:
    1. Approved loan with no deal → card blocked with "Register this loan's debt token first".
    2. Registered deal, no capital-wallet trustline → trustline reason.
    3. Non-Trustee wallet → no-role reason.
    4. Amount above booked bank cash → form error, no signature.
    5. Reused bank reference → refused before signing.
    6. Happy path on loan 0 after ops (`just new-deal 0`) and `register_deal(0)`:
       - Disburse ≤ bank cash → tx hash notice;
       - registry status `Performing`, `bank_cash` drops by the amount;
       - `CashDisbursed` appears in the audit log and the cash book;
       - Record coupon and Update lifecycle → WatchList then succeed.
    7. A fully disbursed loan shows no card.
    8. An EVM loan shows the Stellar-only line.

## Test Strategy

Run vitest from inside each package.

- **wallet-connect** (`cd packages/wallet-connect && npx vitest run`):
  - `minter.test.ts`: `encodeDisburseArgs`:
    - ScVal types and order (u32, i128, u64, bytes32);
    - rejects a negative or non-integer `loanId`, an `amountRaw` of `"0"`, `"-1"` or `"1.5"`, a `valueDate` of 0 or a non-integer, and the zero hash.
  - `minter.test.ts`: `disburse` calls `relay` with `mode: "execute"`, `target: minterId`, `fn: "disburse"` and the encoded args. Mock `./accessManager` the same way the existing `reverseRepay` / wire-out tests do.
  - `loanRegistry.test.ts`:
    - `readLoanDisbursementState` maps the enum tag, `carved_out`, and bigint → string for `disbursed` / `original_senior_tranche`, and throws on a missing field;
    - `readLoanOwner` returns the strkey and rejects garbage.
  - `dealTokenFactory.test.ts`: `readDebtTrustline` maps `true`/`false` → present, `Error(Contract, #13)` → missing, and rethrows other errors.
- **trustee** (`cd packages/trustee && npx vitest run`):
  - `src/lib/-disburse.test.ts`:
    - every `disburseView` branch in precedence order (EVM, unconfigured, loan read pending/error, hidden statuses `Default`/`Closed`, carved out, fully disbursed, deal null/error, trustline missing/error, paused, no wallet, can_call immediate/delayed/none);
    - `disburseFormError` cases (bad amount, >7 decimals, amount > bank cash, amount == bank cash allowed, future date, empty or >140-character reference);
    - `disburseErrorCopy` for codes 1000, 7, 8, 13 (with verbatim values), 3, 21, a user rejection, and an unknown code.
  - `src/api/-useDisburse.test.tsx`:
    - a consumed `ref_hash` throws before `disburse` is called and no signature is requested;
    - paused throws before signing;
    - the happy path calls `disburse` with `amountRaw`, `valueDate`, `refHash = sha256(trimmed reference)` and the env ids;
    - the success invalidations include `loan-disbursement`, `loan-book`, `cash-book` and `audit-log` (spy on `invalidateQueries`; fake timers for the 5 s / 15 s re-invalidations);
    - not configured → configured-copy error.
  - `src/routes/-DisburseAction.test.tsx`:
    - hidden for a `Performing` loan with `disbursed == original`;
    - blocked line for an unregistered deal;
    - ready state opens the dialog; the form error disables submit; submit calls `mutateAsync` with the parsed raw amount and UTC-midnight seconds;
    - success notice with the hash; the error renders the mapped copy;
    - Escape and backdrop are ignored while pending.
  - `src/routes/-loans.$id.test.tsx`: mock `./-DisburseAction` like `RegisterDebtTokenAction` (if that is mocked) and assert it mounts in the performing, watchlist and matured layouts.
- **Lint / build:**
  - `yarn workspace` lint and `tsc` / build for `@pipeline/wallet-connect` and `@pipeline/trustee`;
  - `npx tsx scripts/lint-docs.ts`, which also checks that `trustee-dashboard.md` stays ≤ 200 lines;
  - `npx tsx scripts/lint-comments.ts`.
- **Manual / live** (after ops): run the user-stories doc against pipeline-test with the trustee wallet. The user runs the browser and reports Network/console output (the app does not drive their session).

## Docs to Update

- `docs/frontend/trustee-flows.md`: new `### Disburse (#1898)`, plus Wired actions and the Stellar-only gate.
- `docs/product-specs/trustee-dashboard.md`: flow 7 row and flow note B (in place, stays ≤ 200 lines).
- `docs/product-specs/loans-data.md`: `disburse` security bullet.
- `docs/product-specs/loan-repay-minter.md`: TD-157 pointer → #1898.
- `docs/exec-plans/tech-debt-tracker.md`: TD-157 resolved.
- `docs/user-stories/epic-1776/1898-trustee-minter-disburse.md` (new) and `docs/user-stories/index.md` row.
