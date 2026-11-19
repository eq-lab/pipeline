# Issue #1573: Trustee: EVM draw_loan path so Approve works for EVM-targeted submissions (TD-151)

Source: https://github.com/eq-lab/pipeline/issues/1573

## Scope

Human directive (EVM parity, epic #1937): the EVM path follows the Stellar approach. This plan mirrors the Stellar Approve → `draw_loan` path (#831, #1805) and deviates only where the EVM forces it. Every deviation is listed in [Differences from Stellar](#differences-from-stellar).

The Stellar path being mirrored:

- `useDrawLoan` (`packages/trustee/src/api/useDrawLoan.ts`);
- `-useOriginationReview.ts`: `approveBlockedReason`, `approve()`, the idempotency guard and `mapMintError`;
- simulate before sign, then the DB-only `POST …/review {decision:"Approved"}` only after the on-chain draw confirms;
- spec: `docs/frontend/trustee-flows.md` "Chain-first Approve ordering (#831)" and "Draw-inputs gate (#1805)".

Issue comments: the blocker (#1503, hoodi-v5 config on stage) is resolved (2026-11-18). The reusable EVM write client from #1942 must be reused, not rebuilt.

### Source of truth (checked by the planner on 2026-11-18, worktree base `781af9e5`)

- **EVM contract** `pipeline-contracts@150631a` (read only, frozen):
  - `PipelineLoanRegistry.drawLoan(string metadataURI, ImmutableLoanData economics) external restricted returns (uint256 loanId)`.
  - `ImmutableLoanData` = `(bytes32 borrowerRef, uint256 originalFacilitySize, uint256 originalSeniorTranche, uint256 originalEquityTranche, uint256 originalOfftakerPrice, uint32 seniorInterestRate, uint64 originationDate, uint64 originalMaturityDate)`. These are the same 8 fields as Stellar, with ABI types.
  - `_drawLoan` is `whenNotPaused`. Its checks, in order: `LoanRegistryInvalidTranches` (senior + equity ≠ facility), `LoanRegistryInvalidMaturityDate`, `LoanRegistryInvalidOfftakerPrice`, `LoanRegistryNotConfigured` (capital wallet unset). It mints the NFT to the capital wallet and emits `LoanDrawn(uint256 indexed loanId, string metadataURI)` and `StatusUpdated(loanId, Approved)`. Nothing prevents a second draw of the same inputs, which is also true on Stellar.
  - Units: `seniorInterestRate` is the 1e6 scale (`ONE = 1_000_000`), so bps × 100, the same as Stellar. Money is PLUSD base units, **6 dp** (`PipelineUSD.decimals() = 6`). Stellar uses 7.
  - Role: `script/roles/SetupLoanRegistryManager.sol` puts `drawLoan` and nine other LoanRegistry selectors on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`. All Hoodi delays are 0. #1944 may split out a Risk Council role; `drawLoan` stays on the immediate role.
- **wallet-connect EVM infrastructure** (#1942/#1943):
  - `evm/contracts/write.ts`: `sendEvmContractCall` (switch chain, `simulateContract`, gas estimate + 20 % capped, `writeContract`, receipt) returns only `{ hash }`. Stages are `awaiting-signature` (after simulate) and `confirming`.
  - `evm/contracts/accessManager.ts`: `accessManagerAbi`, `readEvmCanCall`, `relayEvm` (`execute(target, data)` with `value: 0n`).
  - `evm/contracts/riskCouncil.ts`: the LoanRegistry error ABI (`loanRegistryErrors`, module-private, exported as `evmRiskCouncilErrorAbi`) and `requireEvmRegistry`.
  - Human decision 2026-11-18 (#1943 plan): every immediate EVM call goes through `AccessManager.execute(target, calldata)`.
- **Trustee**:
  - `lib/chainWallet.ts`: `pickChainWallet` / `useChainWallet`.
  - `lib/targetChains.ts`: `isStellarTarget`, `targetChainLabel`, `riskCouncilChainReason` (the pattern for a per-feature chain gate).
  - `lib/env.ts`: `EVM_CHAIN_ID`, `EVM_LOAN_REGISTRY_ADDRESS`, `EVM_ACCESS_MANAGER_ADDRESS`.
  - `routes/origination.$id.tsx`: `ApprovedBanner` already links `/loans/$id?chain=<target>`. `RegisterDebtTokenAction` already shows the Stellar-only reason for EVM (#1892).
- **API**:
  - `routes/loan_book.rs`: `draw_loan_for(kind, loan_data)` returns `None` for `ChainKind::Evm`, so an EVM submission serves `draw_loan: null`.
  - `docs/product-specs/api-authorization-loan-submission.md` says the block is "null for an EVM target until #1573 decides the EVM shape".
  - The worker already indexes the EVM `LoanDrawn` and links the submission by `metadata_uri` (`worker/src/indexer/loan_mapper.rs` → `SubmittedLoanRepo::link_drawn`), as on Stellar. `alreadyDrawn` (InReview + `loan_id`) therefore works unchanged.

### In scope

1. **Backend (small, see Open Question 1):** serve the `draw_loan` block for an EVM target, with money at 6 dp. All other fields are identical to Stellar.
2. **wallet-connect:**
   - an EVM LoanRegistry draw binding (`evm/contracts/loanRegistry.ts`): encode, `AccessManager.execute`, and the loan id from the `LoanDrawn` log;
   - `sendEvmContractCall` additionally returns the receipt.
3. **Trustee:**
   - `useDrawLoan` gets an EVM arm selected by the submission's `target_chain_id`;
   - the Approve gate opens on `ENV.EVM_CHAIN_ID`;
   - the dialog preview names `drawLoan` on EVM.
4. **Docs:** trustee-flows, wallet-flows, the API spec, TD-151/TD-152, and a user story.

### Out of scope

- EVM rollover, `updateMutable`, record payment and close loan: #1574. That issue reuses `evm/contracts/loanRegistry.ts` and the `receipt` added here.
- EVM `registerDeal` after the draw: #1892. The inline "Debt token" block keeps its Stellar-only reason on EVM.
- Any pre-sign role read (`canCall`) for the draw. See Open Question 3; the default is none, as on Stellar.
- Reconciling a draw that succeeded when the review then failed, across a reload. This is the accepted #831 residual, unchanged.
- Contract changes (frozen) and the #1944 role split.

## Decisions (planner; mirror Stellar)

1. **Same served-args model.** The browser neither scales nor hashes, as on Stellar.
   - The API serves the EVM block in the existing `DrawLoanArgs` shape: same keys, same `missing_inputs` order, `borrower_ref` the same sha256 hex, the rate × 100, the same dates.
   - The only change is the money scale: `EVM_LOAN_MONEY_DECIMALS = 6`, a constant like `STELLAR_LOAN_MONEY_DECIMALS = 7`. It is the LoanRegistry/PLUSD unit, which is fixed in the contract and not configurable.
   - Without this, the Trustee would have to scale amounts client-side, which #1620 forbids, or would draw 10× too large.
2. **Call path:** `AccessManager.execute(registry, drawLoanCalldata)` with `value: 0n`.
   - It mirrors Stellar's `executor.execute(target, "draw_loan", args, caller)` and the human decision 2026-11-18 for immediate EVM calls.
   - It is sent through `sendEvmContractCall` directly, not `relayEvm`, because the draw needs the receipt and `RelayResult` (shared with Stellar) stays `{ hash }`.
   - The ABI passed is `[...accessManagerAbi, ...evmLoanRegistryErrorAbi]`, so AccessManager and `LoanRegistry*` / `EnforcedPause` reverts decode by name. `AccessManager.execute` bubbles the target's revert data.
3. **Loan id (#876)** comes from the receipt's `LoanDrawn` log emitted by the configured registry address (case-insensitive), decoded with viem `parseEventLogs`.
   - `AccessManager.execute` returns the nonce, not the id, so the return value is useless here.
   - `uint256` maps to `number` when it is ≤ `Number.MAX_SAFE_INTEGER`, otherwise `null`. The mint still succeeded; there is just no deep link, like Stellar's "not recoverable" case. `0` is a valid id (#1896).
4. **Simulate before sign, no signature on a failed simulate.** `sendEvmContractCall` already simulates and estimates gas before the wallet prompt.
   - `drawEvmLoan` tracks whether `awaiting-signature` fired.
   - A contract revert before that point (a viem `BaseError` whose `walk()` finds a `ContractFunctionRevertedError`) is rethrown as `Error("drawEvmLoan: simulation error: <original message>")`.
   - The existing `mapMintError` `/simulation error/` branch then shows "Could not verify the loan on-chain. No signature was requested — safe to retry.", with the decoded error name in the details.
   - Errors that are not reverts (switch-chain rejection, RPC failure, wallet changed) propagate unchanged.
5. **Input validation** mirrors `encodeDrawLoanArgs`, before any RPC call:
   - non-blank `metadata_uri`;
   - `borrower_ref` 64 hex;
   - amounts as digit strings within `uint256` (the served values are ≤ u128 anyway);
   - rate an integer in `u32`;
   - dates safe non-negative integers.
   - Errors read `drawEvmLoan: invalid draw_loan input <field>`, so the existing `/invalid draw_loan input/` copy applies.
   - Encoding: `borrowerRef` = `0x` + lowercase hex, amounts `BigInt`, dates `BigInt`.
6. **Chain gate:** a new `drawChainReason(chainId)` in `lib/targetChains.ts`, built like `riskCouncilChainReason`.
   - It returns `null` for Stellar (and a missing id) and for `ENV.EVM_CHAIN_ID`.
   - For any other chain it returns the existing Approve copy verbatim ("Approve & draw runs on Stellar only — drawing on `<chain>` from the Trustee app is not supported yet. Reject or request changes instead."). This is the same choice #1943 made for unknown chains.
   - `approveBlockedReason = drawChainReason(target) ?? drawLoanBlockedReason(draw_loan)`, still bypassed by the review-only state.
7. **Hook API:** `useDrawLoan().mutateAsync({ args, chainId })`.
   - `pickChainWallet(chainId, useStellarWallet(), useEvmWallet())` picks the arm. The Stellar arm is byte-for-byte unchanged.
   - EVM arm guards run before any RPC call, in this order:
     1. `drawChainReason(chainId)`, thrown as the error;
     2. `ENV.EVM_LOAN_REGISTRY_ADDRESS` / `ENV.EVM_ACCESS_MANAGER_ADDRESS` unset → "On-chain minting is not configured for this environment.";
     3. wallet not connected → "EVM wallet not connected.".
   - These reuse the existing `mapMintError` branches. The signing chain is `ENV.EVM_CHAIN_ID`.
8. **No other orchestration changes.** The ordering, the idempotency marker (`drawLoanMutation.isSuccess`), `alreadyDrawn`, `cancelApprove`, the "drawn but review failed" copy, `mintingLabel` and the error table are chain-neutral and reused unchanged.

## Differences from Stellar

Identical on both chains:

- the Approve dialog, footer, banners, test ids and every copy string;
- the ordering (draw → review), the idempotency guard and its accepted reload residual, and the review-only path (`alreadyDrawn`);
- the draw-inputs gate (`readyDrawLoanArgs` / `drawLoanBlockedReason`), the served-args contract ("the browser neither scales nor hashes") and the `missing_inputs` order;
- the `mapMintError` table, the `["loan-submissions"]` invalidation by the review, and the worker's link by `metadata_uri`.

| # | Area | Stellar (#831, #1805) | EVM (#1573) | Reason |
|---|---|---|---|---|
| 1 | Served money scale | `original_*` in 7-dp base units | 6-dp base units (`EVM_LOAN_MONEY_DECIMALS`); every other field identical | PLUSD/USDC on EVM has 6 decimals |
| 2 | Call | `executor.execute(registry, "draw_loan", [metadata_uri, economics map], caller)` (Soroban) | `AccessManager.execute(registry, drawLoan calldata)` via `sendEvmContractCall`, `value 0` | ABI vs Soroban; same AM-execute shape (decision 2026-11-18) |
| 3 | Args encoding | `[String, Map]`, 8 sorted symbol keys, `BytesN<32>`, `u128`, `u32`, `u64` | `(string, tuple)` in struct order, `bytes32` (`0x`+hex), `uint256`, `uint32`, `uint64` | ABI types |
| 4 | Signing | Stellar wallet `signTransaction`, tx source = caller | EVM wallet `eth_sendTransaction`; wrong network → `switchChain(ENV.EVM_CHAIN_ID)` first | Wallet model |
| 5 | Simulate failure detection | Soroban simulate error inside `buildDrawLoanEnvelope` ("simulation error") | viem revert before the `awaiting-signature` stage, re-thrown as `drawEvmLoan: simulation error: …` (decoded error name in details) | Different client; the copy is the same |
| 6 | Stages / button label | `awaiting-signature` fires first (label "Waiting for wallet signature…" during simulate), then `submitting`, `confirming` | no stage during simulate (label "Registering on-chain…"), then `awaiting-signature`, `confirming`; no `submitting` | `sendEvmContractCall` contract (#1942): the EVM wallet signs and broadcasts in one call |
| 7 | Loan id (#876) | `draw_loan` return value, then the `loan_drawn` event topic; `u32` | `LoanDrawn` log of the configured registry in the receipt; `uint256` → `number` if safe, else `null` | `AccessManager.execute` returns the nonce, not the id |
| 8 | Chain gate | none (Stellar is always drawable) | `drawChainReason`: open on `ENV.EVM_CHAIN_ID`; any other non-Stellar id keeps today's copy | One EVM chain per deployment (as `riskCouncilChainReason`) |
| 9 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS` (both already exist) | Separate contracts |
| 10 | Wallet guard copy (raw) | "Stellar wallet not connected." | "EVM wallet not connected." (both map to "Connect your trustee wallet to approve on-chain.") | Wallet kind |
| 11 | Dialog preview keyword | `LoanRegistry.draw_loan` | `LoanRegistry.drawLoan`; row labels and values unchanged (base units as served) | Solidity function name |
| 12 | Role | `TRUSTEE` (immediate) on the Stellar AM | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, delay 0 on Hoodi; no pre-read, a missing role surfaces as a simulate revert (`AccessManagerUnauthorizedCall`) | Deployment role model; see Open Question 3 |
| 13 | Debt token after the draw | `RegisterDebtTokenAction` inline block | unchanged: shows the Stellar-only reason until #1892 | Scope split, not EVM-forced |

## Assumptions and Risks

- **Stage config and role.** Stage carries the hoodi-v5 `VITE_EVM_LOAN_REGISTRY_ADDRESS` / `VITE_EVM_ACCESS_MANAGER_ADDRESS` (issue comment 2026-11-18), and the trustee's EVM wallet holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`. The #1943 Risk Council flows need the same role, so this is likely already true. If it is not, the draw fails at simulate with "Could not verify the loan on-chain" and `AccessManagerUnauthorizedCall` in the details. No signature is requested.
- **Capital wallet.** `drawLoan` reverts with `LoanRegistryNotConfigured` if the registry's capital wallet is unset on Hoodi. It surfaces through the same simulate copy.
- **#1944 role split.** If the deploy scripts put a delay on the role that holds `drawLoan`, the immediate `execute` reverts `AccessManagerNotScheduled` at simulate (generic copy). The issue brief says `drawLoan` stays immediate. Scheduling a draw is not supported, as on Stellar.
- **Session chain.** The Trustee session is single-chain. A trustee signed in on Stellar who opens an EVM submission has no connected EVM wallet and gets "Connect your trustee wallet to approve on-chain." after clicking Mint loan, the same post-click behaviour as Stellar. Reject and Request changes are DB-only and still work. The user story documents signing in on the EVM chain.
- **Wallet mock.** `sendEvmContractCall` refuses mock wallets ("[wallet mock] EVM writes are not mockable"), so local or QA runs need a real EVM wallet. This is the #1942 behaviour; it maps to the generic on-chain-failed copy.
- **Backend in a frontend-flow issue.** The issue is labelled `frontend` only. The backend part is small but changes the public `GET /submissions` / `POST /loan` response for EVM targets (`null` → a block). See Open Question 1.
- **Existing EVM submissions.** Rows submitted for an EVM target before this change are served the block at read time; nothing is stored. A row with more than 6 fractional digits cannot exist: submit validation already rejects that.
- **Safe wallets.** `waitForTransactionReceipt` stalls for Safe multisigs (#1942 review finding 5). Unchanged and out of scope.
- **Test mocks.** Every Trustee test that mocks `@pipeline/wallet-connect` for `useDrawLoan` must add `drawEvmLoan` and `useEvmWallet` (mechanical). The `#1536` tests that pin "EVM blocked" flip.

## Decisions (human, 2026-11-18)

All open questions were resolved with the recommended defaults:

1. The API part stays in #1573 as Part A, in the same PR.
2. The EVM draw money scale is a constant 6 (`EVM_LOAN_MONEY_DECIMALS`), mirroring Stellar's 7.
3. No `canCall` pre-check before drawing, as on Stellar. A missing role shows as a failed simulate, with the decoded error name in the details.

## Open Questions

_None_ (resolved 2026-11-18, see Decisions).

## Implementation Steps

### Part A — API: serve the EVM `draw_loan` block (Open Questions 1, 2)

1. `packages/api/src/routes/loan_book.rs`:
   - Add `pub const EVM_LOAN_MONEY_DECIMALS: u32 = 6;` next to `STELLAR_LOAN_MONEY_DECIMALS`.
   - Rename the body of `draw_loan_args` to `pub fn draw_loan_args_at(loan_data: &serde_json::Value, money_decimals: u32) -> DrawLoanArgs`. The `money` closure uses `money_decimals`. Keep `pub fn draw_loan_args(loan_data)` as `draw_loan_args_at(loan_data, STELLAR_LOAN_MONEY_DECIMALS)`, so existing callers and tests are untouched.
   - `draw_loan_for`: `Some(ChainKind::Stellar) => Some(draw_loan_args_at(loan_data, STELLAR_LOAN_MONEY_DECIMALS))`, `Some(ChainKind::Evm) => Some(draw_loan_args_at(loan_data, EVM_LOAN_MONEY_DECIMALS))`, `None => None`.
   - Doc comments:
     - `SubmitLoanResponse.draw_loan` and `SubmissionView.draw_loan`: drop "Stellar … until #1573". They are `null` only for an unconfigured target chain, and in the view also once drawn or `Rejected`.
     - `DrawLoanArgs`: "the loan-registry `draw_loan` / `drawLoan`".
     - `DrawLoanEconomics` money fields: "u128 base units of the target chain's loan money (7 dp Stellar, 6 dp EVM)".
     - The two utoipa `201`/`200` descriptions (around lines 815 and 929): "Carries the `draw_loan` args (`null` for an unconfigured target chain)".
2. `packages/api/tests/draw_loan_args.rs`:
   - Replace `evm_row_gets_null_draw_loan` with `evm_row_gets_draw_loan_at_six_decimals`. For `complete()` it asserts:
     - EVM amounts `"100000000000"`, `"80000000000"`, `"20000000000"`, `"105000000000"`;
     - `borrower_ref == DR_0001`, `senior_interest_rate == 120000`, the dates and `metadata_uri` equal Stellar's;
     - `missing_inputs` is empty;
     - the chain-independent view keys still match.
   - Add `evm_amount_with_seven_fraction_digits_is_missing`: `"1.0000001"` is served on Stellar and `null` + listed on EVM.
   - Keep `unconfigured_chain_gets_null_draw_loan`.
3. Run `cargo clippy --all -- -D warnings` and `cargo test -p pipeline-api --test draw_loan_args --test loan_submission`. Pure unit tests only: no `DATABASE_URL`.

### Part B — wallet-connect: EVM draw binding

4. `packages/wallet-connect/src/evm/contracts/write.ts`: `SendEvmContractCallResult` becomes `{ hash: Hex; receipt: TransactionReceipt }` (viem type), and the function returns `{ hash, receipt }`. This is additive: `relayEvm` keeps its `RelayResult` type. Update the `write.test.ts` success assertion to `{ hash: HASH, receipt: <the mocked receipt> }`.
5. `packages/wallet-connect/src/evm/contracts/riskCouncil.ts`: also export the LoanRegistry error list as `evmLoanRegistryErrorAbi` (the same array; `evmRiskCouncilErrorAbi` stays for the Risk Council callers).
6. New `packages/wallet-connect/src/evm/contracts/loanRegistry.ts`, with a one-line spec header `// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831` and no other comments:
   - `evmLoanRegistryDrawAbi`: the `drawLoan(string metadataURI, (bytes32,uint256,uint256,uint256,uint256,uint32,uint64,uint64) economics) returns (uint256 loanId)` function item, with tuple component names matching the contract, plus the `LoanDrawn(uint256 indexed loanId, string metadataURI)` event.
   - `encodeEvmDrawLoanCalldata(args: DrawLoanArgs): Hex`:
     - validation per Decision 5, throwing `drawEvmLoan: invalid draw_loan input <field>` (field names as the Stellar encoder: `metadata_uri`, `economics`, `economics.borrower_ref`, `economics.<amount>`, `economics.senior_interest_rate`, `economics.<date>`);
     - then `encodeFunctionData({ abi: evmLoanRegistryDrawAbi, functionName: "drawLoan", args: [metadata_uri, { borrowerRef, originalFacilitySize, … }] })`.
   - `readEvmDrawnLoanId(receipt, registry): number | null` per Decision 3.
   - `drawEvmLoan({ accessManager, registry, caller, chainId, args, onStageChange }): Promise<{ hash: Hex; loanId: number | null }>`:
     1. Before any RPC: `isAddress` checks for `accessManager`, `registry` and `caller` (the same messages as `requireAddresses`: `drawEvmLoan: accessManager must not be empty`, `drawEvmLoan: invalid registry …`), then `encodeEvmDrawLoanCalldata(args)`.
     2. `sendEvmContractCall({ abi: [...accessManagerAbi, ...evmLoanRegistryErrorAbi], address: accessManager, functionName: "execute", args: [registry, calldata], value: 0n, account: caller, chainId, onStageChange: wrapped })`, where `wrapped` records `awaiting-signature` and forwards every stage.
     3. On a throw before the prompt that is a contract revert (Decision 4), rethrow `new Error(\`drawEvmLoan: simulation error: ${err.message}\`)`. Otherwise rethrow as is.
     4. Return `{ hash, loanId: readEvmDrawnLoanId(receipt, registry) }`.
   - Reuse `DrawLoanArgs` / `DrawLoanStage` types from `stellar/contracts/loanRegistry` (chain-neutral shapes). Do not duplicate them.
7. `packages/wallet-connect/src/index.ts`: export `drawEvmLoan`, `encodeEvmDrawLoanCalldata`, `evmLoanRegistryDrawAbi`, `readEvmDrawnLoanId`, `evmLoanRegistryErrorAbi`, and the types `DrawEvmLoanParams` and `DrawEvmLoanResult`, in a block next to the Risk Council EVM exports.

### Part C — Trustee

8. `packages/trustee/src/lib/targetChains.ts`: add `drawChainReason(chainId)` per Decision 6. Its non-null copy is the exact string `-useOriginationReview.ts` builds today, moved here.
9. `packages/trustee/src/api/useDrawLoan.ts`:
   - `UseDrawLoanInput` becomes `{ args: DrawLoanArgs; chainId: number | null | undefined }`.
   - Read `useStellarWallet()` and `useEvmWallet()`, then `pickChainWallet(chainId, stellar, evm)`.
   - `wallet.kind === "stellar"`: the current body, unchanged.
   - `wallet.kind === "evm"`: the guards of Decision 7, then `drawEvmLoan({ accessManager: ENV.EVM_ACCESS_MANAGER_ADDRESS, registry: ENV.EVM_LOAN_REGISTRY_ADDRESS, caller: address, chainId: ENV.EVM_CHAIN_ID, args, onStageChange: setStage })`.
   - Return `{ hash, loanId }` with the same `DrawLoanOutcome`.
   - Shrink the JSDoc to the spec-pointer header (comment-less rule) while touching the file.
10. `packages/trustee/src/routes/-useOriginationReview.ts`:
    - `approveBlockedReason`: replace the `!isStellarTarget(...) ? … : drawLoanBlockedReason(...)` branch with `drawChainReason(submission.target_chain_id) ?? drawLoanBlockedReason(submission.draw_loan)`.
    - `approve()`: `drawLoanMutation.mutateAsync({ args, chainId: submission.target_chain_id })`.
    - Drop the now-unused `isStellarTarget` / `targetChainLabel` imports. Nothing else changes (Decision 8).
11. `packages/trustee/src/routes/-origination-detail.ts`: `mapTransactionPreview` keyword is `isStellarTarget(submission.target_chain_id) ? "LoanRegistry.draw_loan" : "LoanRegistry.drawLoan"`. `EMPTY_TRANSACTION_PREVIEW` stays as is.
12. `routes/origination.$id.tsx` and `-ApproveMintDialog.tsx`: no change. The banner deep link already carries `?chain=`.
13. Lint and build:
    - `yarn workspace @pipeline/wallet-connect lint` and `test`;
    - `yarn workspace @pipeline/trustee lint`, `test` and `build`;
    - `npx tsx scripts/lint-comments.ts`, shrinking `scripts/lint-comments.baseline.json` for the touched listed files (`-useDrawLoan.test.tsx`, `-origination-detail.ts`, `-useOriginationReview.test.ts`);
    - `npx tsx scripts/lint-docs.ts`.

## Test Strategy

Vitest in the existing co-located patterns (`*.test.ts` next to wallet-connect modules, `-*.test.ts(x)` in the Trustee). Rust tests in `packages/api/tests/`, with no DB.

- **API (`tests/draw_loan_args.rs`):** Part A step 2: EVM 6-dp block, the 7-fraction-digit amount, and unconfigured `None`. Existing Stellar tests stay green unchanged.
- **wallet-connect `evm/contracts/loanRegistry.test.ts`** (mock `./write`'s `sendEvmContractCall` with `vi.hoisted`, like `riskCouncil.test.ts`):
  - `encodeEvmDrawLoanCalldata` round-trips through `decodeFunctionData`: the selector is `drawLoan`, `borrowerRef` is `0x`+lowercase hex, amounts are bigint, the rate is a number and the dates are bigint.
  - Each invalid field throws `drawEvmLoan: invalid draw_loan input <field>` and `sendEvmContractCall` is never called. The fields: blank `metadata_uri`, 63-hex `borrower_ref`, `"1.5"` amount, amount above `uint256`, rate `2**32`, negative date, non-integer date.
  - Invalid or empty `accessManager` / `registry` / `caller` throw before any call.
  - `drawEvmLoan` calls `sendEvmContractCall` with `address: accessManager`, `functionName: "execute"`, `args: [registry, calldata]`, `value: 0n`, `account: caller`, `chainId`. The ABI contains `execute`, `AccessManagerUnauthorizedCall`, `LoanRegistryInvalidTranches` and `EnforcedPause`. Stages are forwarded.
  - `loanId`:
    - from a `LoanDrawn` log of the registry (mixed-case address);
    - `0` is returned as `0`;
    - a `LoanDrawn` from another address is ignored, giving `null`;
    - no log gives `null`;
    - an id above `MAX_SAFE_INTEGER` gives `null`.
  - Simulation wrap:
    - a `ContractFunctionExecutionError` wrapping `ContractFunctionRevertedError` thrown before `awaiting-signature` becomes `drawEvmLoan: simulation error: …` and keeps the original text;
    - the same revert after `awaiting-signature` (receipt "transaction reverted") passes through unchanged;
    - a `UserRejectedRequestError` before the prompt (switch chain) passes through unchanged.
- **wallet-connect `write.test.ts`:** the success result includes `receipt`. Other cases unchanged.
- **Trustee `api/-useDrawLoan.test.tsx`** (mock adds `drawEvmLoan`, `useEvmWallet`; env adds the EVM keys):
  - Stellar arm: the existing cases pass `{ args, chainId: STELLAR }`, and `chainId` `undefined` still takes the Stellar arm (legacy rows).
  - EVM arm:
    - the registry or AM address unset → "not configured", no `drawEvmLoan` call;
    - EVM disconnected → "EVM wallet not connected.", no call;
    - success passes `accessManager` / `registry` / `caller` / `chainId: ENV.EVM_CHAIN_ID` / `args` and resolves `{ hash, loanId }`;
    - `stage` follows `onStageChange`;
    - a rejection propagates;
    - an unknown chain id throws the `drawChainReason` copy, with no call.
- **Trustee `routes/-useOriginationReview.test.ts`:**
  - Flip the `#1536` block:
    - an `ENV.EVM_CHAIN_ID` target with a complete `draw_loan` has `approveBlockedReason === null`;
    - `approve()` calls `drawLoan.mutateAsync({ args, chainId: EVM })` before `review.mutate`;
    - an unknown chain id (e.g. `1234`) keeps the blocked copy ("drawing on Chain 1234"), and `approve()` / `openApprove()` neither draw, review nor open.
  - EVM idempotency: a draw success followed by a review failure means a re-click only reviews.
  - EVM review-only: InReview with `loan_id` means no draw and no blocked reason.
  - EVM `draw_loan: null` shows the "not available" copy, and missing `data_room_id` shows the data-room copy.
  - `mapMintError` on EVM-shaped messages:
    - `drawEvmLoan: simulation error: … LoanRegistryInvalidTranches()` gives the could-not-verify copy;
    - `User rejected the request.` gives "Signature cancelled";
    - `EVM wallet not connected.` gives the connect copy;
    - `drawEvmLoan: invalid draw_loan input economics.borrower_ref` gives the incomplete-inputs copy;
    - `transaction reverted: 0x…` gives the generic copy.
  - Replace "an EVM target keeps the Stellar-only reason ahead of the draw gate" with the unknown-chain equivalent.
- **Trustee `routes/-origination-detail.test.ts`:** the preview keyword is `LoanRegistry.draw_loan` for a Stellar or legacy target and `LoanRegistry.drawLoan` for `ENV.EVM_CHAIN_ID`.
- **Trustee `routes/-origination-detail-page.test.tsx`:** the "#1536" page test keeps its shape with the unknown-chain copy (`Chain 1234`). Add one EVM InReview render with `approveBlockedReason: null`: Approve is enabled and there is no `origination-detail-approve-blocked`.
- **Trustee `lib/-targetChains.test.ts`**: `drawChainReason` is `null` for Stellar, `null`/`undefined` and `ENV.EVM_CHAIN_ID`, and the copy for another id.
- No Figma is referenced in the issue, so there is no Figma verification step. The UI is unchanged except the preview keyword.

## Docs to Update

- `docs/frontend/trustee-flows.md`:
  - "Chain-first Approve ordering (#831)": rename the "Target-chain gate (#1536)" paragraph to cover `drawChainReason`, and add an **EVM (#1573)** paragraph. It covers the call path, encoding, simulate wrap, stages, loan id from `LoanDrawn`, config keys, guards, and the role note that `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` must be immediate. Remove "An EVM draw from the Trustee app is TD-151."
  - "Draw-inputs gate (#1805)": "For a Stellar or configured EVM target".
  - "`draw_loan` block (#1805)": served for EVM at 6 dp; `null` only once drawn, on `Rejected`, or for an unconfigured target chain.
  - "Approve & mint confirmation dialog (#838)": keyword `LoanRegistry.drawLoan` on EVM.
  - Line ~2322 (#1943 "Not in this issue"): drop "the EVM draw (#1573)".
- `docs/frontend/wallet-flows.md` "Trustee EVM contract client":
  - `sendEvmContractCall` returns `{ hash, receipt }`;
  - add the `evm/contracts/loanRegistry.ts` draw binding (`drawEvmLoan`, `encodeEvmDrawLoanCalldata`, `readEvmDrawnLoanId`) to the reusers list.
- `docs/product-specs/api-authorization-loan-submission.md` "`draw_loan` arguments":
  - the money row becomes "u128 base units: 7 dp on Stellar (USDC-SAC / PLUSD), 6 dp on EVM (PLUSD)";
  - replace "Stellar targets only…" with "Served for Stellar and EVM targets; `null` when `target_chain_id` is not in `CHAINS`";
  - add the EVM call ("`drawLoan(metadataURI, economics)` through `AccessManager.execute`; keys map to the `ImmutableLoanData` struct in camelCase");
  - the amount-format bullet: at most 7 (Stellar) / 6 (EVM) fractional digits to be served.
- `docs/product-specs/api-authorization.md`: the `POST /loan` and `GET /submissions` rows lose "Stellar … `null` for an EVM target until #1573".
- `docs/exec-plans/tech-debt-tracker.md`:
  - mark TD-151 `[RESOLVED <date> / #1573]` with a one-line resolution;
  - TD-152 "Status (#1943)": remove "the EVM draw (#1573)" from what remains;
  - TD-152 "EVM client (#1942)": "#1573 reused it (receipt added); #1574 reuses `evm/contracts/loanRegistry.ts`".
- `docs/product-specs/cash-reporter-bookings.md` line 36: drop the "#1573" pointer for the write client (it exists since #1942), keeping TD-152.
- User story: `docs/user-stories/epic-1521/1573-trustee-evm-draw-loan.md` (the issue body names epic #1521 as the parent follow-up; the issue has no GitHub parent set), plus its row in `docs/user-stories/index.md`. Persona: a trustee signed in on the EVM chain with an EVM wallet that holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`. Stories:
  1. Approve an EVM submission: simulate, sign, confirm, Approved banner, "View loan #N →" with `?chain=`.
  2. A failed simulate requests no signature.
  3. A wallet rejection leaves the submission InReview.
  4. Drawn but review failed: a re-click only records the review.
  5. Stellar regression: unchanged.
