# Issue #2074: Trustee: EVM repayment recovery list fails on Hoodi (Minter f92d719 has no extsload) — fall back to the legacy repayment() view

Source: https://github.com/eq-lab/pipeline/issues/2074

Parent epic: #1937. Branch `fix/2074-evm-recovery-legacy-view`, draft PR #2075.

## Scope

The EVM repayment-recovery list (#1943) reads each repayment's stored Minter record through `readEvmMinterRepayment` in `packages/wallet-connect/src/evm/contracts/minter.ts`. That function uses only `Minter.extsload`. The Hoodi Minter runs source `f92d719` and has no `extsload`, so the read reverts with empty data. Contracts and deployments stay as they are (decision of 2026-11-19), so the client adapts. It follows the #1574 pattern already used by `readEvmMinterBankCash` and `readEvmRefHashSeen`:

1. Call the legacy view `repayment(uint256 loanId, uint256 repaymentId) returns (Repayment)` first.
2. Fall back to the existing `extsload` path only when the view reverts with empty data, which is how a `150631a` Minter (no such function) answers. The shared `isMissingFunction` helper detects this.
3. Any other error propagates unchanged.

In scope:

- `readEvmMinterRepayment`: call the legacy view first, then fall back to `extsload`. The return type `EvmMinterRepaymentRecord` (`{ released, carvedOut }`) does not change, so `readEvmRecoveryRepayments` and the Trustee hook (`packages/trustee/src/api/useRepaymentRecovery.ts`) need no changes.
- A new exported ABI constant for the legacy view.
- Vitest coverage for both paths, for the error passthrough, for the pinned block and for the ABI shape.
- Narrow doc edits. The exact lines are listed under "Docs to Update".

Out of scope:

- Any contract or deployment change.
- The Stellar arm. `packages/wallet-connect/src/stellar/**` and the Stellar branch of `useRepaymentRecovery` are not touched.
- The TD-190 log scan itself. `nextRepaymentId`, `PaymentRecorded` / `PaymentUnrecorded` / `CashRepaid` are scanned from `VITE_EVM_START_BLOCK` as before.
- `readEvmMinterBankCash` / `readEvmRefHashSeen`. They already use the legacy view first (#1574).
- The SecurityRegistry reads. Those belong to #2070, which is backend work.
- Backend or Rust changes.

### Contract comparison (`pipeline-contracts`, read-only)

| | `f92d719` (Hoodi) | `150631a` (frozen source of #1943) |
|---|---|---|
| `Repayment` struct (`src/minter/MinterUpgradeable.sol:71` / `:73`) | `uint256 feeShares; uint256 fees; uint256 released; bool carvedOut;` | the same four, plus `uint64 yieldEpoch` appended |
| Storage | word 0 `feeShares`, 1 `fees`, 2 `released`, 3 `carvedOut` (low byte) | the same, plus `yieldEpoch` packed into word 3 above `carvedOut` (`word >> 8`) |
| `MinterStorage.repayments` | field 19 of ERC-7201 `pipeline.storage.Minter` (`0x1cb61fb8…5cc100`) | field 19 (unchanged; `yieldSchedule` appended as field 21) |
| `repayment(uint256,uint256)` view | yes (`:554`), returns `_getMinterStorage().repayments[loanId][repaymentId]` (no existence check) | removed from the Minter; moved to `PipelineMinterReader.repayment`, which runs over `extsload` |
| `extsload(bytes32)` | absent | present (`:535`) |
| Other Minter views removed in `150631a` | n/a | `addressesConfig`, `custodians`, `bankCash`, `inFlight`, `unabsorbedTotal`, `wireIn`, `wireOut`, `ramp`, `disbursement`, `repayment`, `refHashSeen` |
| `CashRepaid` event | unchanged | unchanged |

The recovery list uses only `released` (shown as "principal", the amount `Pocket.unrelease` restores) and `carvedOut`. Both sit at the same positions in both builds:

- **Legacy view:** decode `released` and `carvedOut` by name from the 4-field tuple.
- **Fallback:** keep reading words +2 and +3 (low byte), as now. On `150631a` the `yieldEpoch` bits in word 3 are masked off, as they are today.

`feeShares` and `fees` are not mapped. `feeShares` keeps coming from the `CashRepaid` log, and `fees` is not shown. Neither build is decoded as a 5-field struct. The legacy view's ABI is the 4-field `f92d719` tuple, because that is the only Minter that has the view.

### Hoodi findings (read-only `cast`, RPC `https://ethereum-hoodi-rpc.publicnode.com`, 2026-11-19, head ≈ 4 046 580)

- The Minter proxy `0x621BaAb0ced6b11f88019582183b081A118755f4` has its EIP-1967 implementation slot set to `0x0DaC8ed8dB6C910807435e69c2162B74Cc374eBf`, which matches `hoodi-v5.json`.
- Selectors were checked as PUSH4 in the implementation bytecode:

  | Selector | Function | In bytecode |
  |---|---|---|
  | `0x1ac459b5` | `repayment(uint256,uint256)` | present |
  | `0x1e2eaeaf` | `extsload(bytes32)` | absent |
  | `0xdeea79f0` | `bankCash()` | present |
  | `0x968fe75f` | `refHashSeen(bytes32)` | present |
  | `0x5c975abb` | `paused()` | present |
  | `0x0cff7536` | `reverseRepay(uint256,uint256,bytes32)` | present |
  | `0x87d2050a` | `repay(...)` | present |

- `eth_call extsload(base + 8)` → `execution reverted, data: "0x"`. This is exactly the shape `isMissingFunction` treats as a missing function.
- `eth_call repayment(0,0)` and `repayment(999999,7)` (non-existent ids) succeed and return 128 bytes of zeros: four static words, no tuple offset head. Decoded, that is `{ feeShares: 0, fees: 0, released: 0, carvedOut: false }`. The view never reverts for an unknown id. The `extsload` fallback returns zero words for the same case, so both paths agree.
- The LoanRegistry proxy `0xdF08…0231` (implementation `0x5996…bfCE`) has `mutableLoanData`, `loanMoney` and `immutableLoanData` and no `extsload`.
- **No repayment exists on Hoodi yet.** The scan found:
  - 0 `CashRepaid` logs on the Minter from block 2 846 000 to head. The Minter has 5 logs in total, all deploy/init events at block 3 955 455.
  - 0 `PaymentRecorded` logs on the LoanRegistry.
  - `mutableLoanData(0)` reverts with `0xab6bb082`, so no loan 0 exists.

  Today `readEvmRecoveryRepayments` returns `[]` at `nextRepaymentId === 0`, before it calls `readEvmMinterRepayment`. The bug is therefore latent on Hoodi and appears with the first EVM repayment. It cannot be reproduced or verified live yet; see Assumptions and Risks.

### Audit of the `extsload`-only reads

`git log -S extsload` shows that #1943 (PR #2039) added exactly one `extsload` read, and #1574 (PR #2055) added the other two:

| Read | Added by | Today | `f92d719` view | Action |
|---|---|---|---|---|
| `readEvmMinterRepayment` (`minter.ts:387`) | #1943 | `extsload` only | `repayment(uint256,uint256)` | **covered by this issue**: view first, `extsload` fallback |
| `readEvmMinterBankCash` (`minter.ts:803`) | #1574 | view first, `extsload` fallback | `bankCash()` | none (already done) |
| `readEvmRefHashSeen` (`minter.ts:828`) | #1574 | view first, `extsload` fallback | `refHashSeen(bytes32)` | none (already done) |

The other reads that #1943 added are plain views present on both builds, so they need nothing:

- `readEvmNextRepaymentId` / `readEvmMutableLoanData` → `mutableLoanData`
- `readEvmLoanMoney` → `loanMoney`
- `readEvmLoanDisbursementState` → `immutableLoanData`, which is in the `f92d719` LoanRegistry implementation and only added to the interface in `150631a`
- AccessManager `canCall` / `getSchedule` / `hashOperation`
- the `eth_getLogs` scan

No other `extsload`, `eth_getStorageAt` or raw storage read exists under `packages/` (grep).

## Assumptions and Risks

- **No live verification yet.** Hoodi has no loan with a repayment, so the fixed path cannot run end to end on Hoodi now. Coverage is vitest plus the read-only `cast` shape check above. The live check comes after the first EVM `Minter.repay` on Hoodi (#1574 flow) and runs in QA #1945 (Story 8 of `docs/user-stories/epic-1937/1943-trustee-evm-rc-pages.md`).
- **viem decode.** `readContract` with an output of one named-component `tuple` returns an object keyed by component name, the same as the existing `mutableLoanData` read in `riskCouncil.ts`. A unit test pins this with `decodeFunctionResult` over the exact 128-byte blob Hoodi returned.
- **`150631a` cost.** On a `150631a` Minter, every repayment row makes one extra `eth_call` that reverts with empty data before the two `extsload` words. That is one wasted call per row and is accepted, as in #1574. No per-address caching, to keep the pattern identical to `readEvmMinterBankCash` / `readEvmRefHashSeen`.
- **No Minter code** (wrong address, EOA). Viem throws `ContractFunctionZeroDataError`, `isMissingFunction` returns true, and the fallback `extsload` call also returns zero data and throws. The dialog shows "Failed to load the repayments." with details, the same as today. No fabricated value.
- **Pinned head.** The view call must also pass `blockNumber`, so all reads stay pinned to the head of the log scan. The current test "pins nextRepaymentId and the extsload reads to the same head" is extended to cover the view.
- **Doc conflicts with PR #2072** (`docs/2071-evm-rc-delay`, open). It edits:
  - `tech-debt-tracker.md` lines 2494–2495 (TD-190 Impact and Hoodi caveat)
  - `trustee-flows.md` lines 1024, 2456, 2460, 2462 and 2547, plus an insertion after 2571
  - `FRONTEND.md` line 264
  - `1943-trustee-evm-rc-pages.md` line 13

  This plan avoids those lines and the lines directly next to them, because git treats edits on adjacent lines as a conflict. Exact lines are under "Docs to Update". PR #2072's own line 13 of the user story and row 13 of `trustee-flows.md` already describe the `extsload` fallback correctly once this lands.
- **PR `feat/2070-evm-sr-dual-abi`** (#2073) is backend-only (SecurityRegistry dual ABI). There is no file overlap.

## Implementation Steps

1. `packages/wallet-connect/src/evm/contracts/minter.ts`: add the legacy view ABI next to `minterExtsloadAbi` (around line 351):

   ```ts
   export const minterRepaymentViewAbi = [
     {
       type: "function",
       name: "repayment",
       stateMutability: "view",
       inputs: [
         { name: "loanId", type: "uint256" },
         { name: "repaymentId", type: "uint256" },
       ],
       outputs: [
         {
           name: "",
           type: "tuple",
           components: [
             { name: "feeShares", type: "uint256" },
             { name: "fees", type: "uint256" },
             { name: "released", type: "uint256" },
             { name: "carvedOut", type: "bool" },
           ],
         },
       ],
     },
   ] as const;
   ```

   This is the `f92d719` `Repayment` shape: four fields, no `yieldEpoch`.

2. Same file, `readEvmMinterRepayment` (line 387). Keep the existing empty-address and invalid-address guards, then:
   1. `try { const record = await readEvmContract<{ released: bigint; carvedOut: boolean }>({ abi: minterRepaymentViewAbi, address: minter as Address, functionName: "repayment", args: [BigInt(loanId), BigInt(repaymentId)], blockNumber }); return { released: record.released.toString(), carvedOut: record.carvedOut === true }; } catch (err) { if (!isMissingFunction(err)) throw err; }`
   2. Leave the existing `extsload` body (words +2 and +3 at `evmMinterRepaymentSlot`, `blockNumber` forwarded) in place unchanged as the fallback.

   `isMissingFunction` is a hoisted function declaration (line 769), so it can be used as is. Optionally move it above `readEvmMinterRepayment` for reading order, with no behavior change. Add no comments: AGENTS.md "Comment-less code"; the file already has its spec-pointer header.

3. `packages/wallet-connect/src/index.ts`: no change is required. `readEvmMinterRepayment` and `EvmMinterRepaymentRecord` are already exported, and `minterExtsloadAbi` is not re-exported either. `minterRepaymentViewAbi` stays a module export used by the tests.

4. `packages/wallet-connect/src/evm/contracts/minter.test.ts`: tests (see Test Strategy).

5. Docs: the narrow edits listed under "Docs to Update".

6. Checks:
   - `PATH=/opt/homebrew/opt/node@22/bin:$PATH node .yarn/releases/yarn-4.13.0.cjs workspace @pipeline/wallet-connect test src/evm/contracts/minter.test.ts` (the package `test` script is `vitest run`).
   - The trustee test `packages/trustee/src/api/-useRepaymentRecovery.test.tsx` as a regression check.
   - Typecheck / build of `@pipeline/wallet-connect` and `@pipeline/trustee`.
   - `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`.

   No Rust is touched, so no clippy run.

7. Optional read-only sanity check after the change. Run `cast call 0x621BaAb0ced6b11f88019582183b081A118755f4 "repayment(uint256,uint256)((uint256,uint256,uint256,bool))" 0 0 --rpc-url https://ethereum-hoodi-rpc.publicnode.com`. It should return `(0, 0, 0, false)`. Do not send transactions.

## Test Strategy

All tests are vitest in `packages/wallet-connect/src/evm/contracts/minter.test.ts`, which already mocks `readEvmContract` (`mockRead`). Reuse the existing `emptyRevert()` helper (line 751), plus `ContractFunctionZeroDataError` / `ContractFunctionRevertedError` as in the "Minter disburse reads" block. No DB, no env-var RPC, no network.

`describe("readEvmMinterRepayment")`: rework the existing block.

- **Legacy view (Hoodi `f92d719`) succeeds.** `mockRead` resolves `{ feeShares: 1n, fees: 2n, released: 900n, carvedOut: true }` and the result is `{ released: "900", carvedOut: true }`. Exactly one read is made, matching `{ abi: minterRepaymentViewAbi, address: MINTER, functionName: "repayment", args: [7n, 2n] }`, and `extsload` is never called.
- **Legacy view returns the zero record** (the non-existent id Hoodi answered with). The result is `{ released: "0", carvedOut: false }` with no fallback.
- **View missing → `extsload`** (`150631a`). The first call rejects with `emptyRevert()`, then the words are served. The result is `{ released: "900", carvedOut: true }`. Three calls are made: calls 2 and 3 are `extsload` at `base + 2` and `base + 3`. This replaces today's "reads words +2 and +3 through extsload".
- **Zero-data result → `extsload`.** The first call rejects with `ContractFunctionExecutionError(ContractFunctionZeroDataError)` and the fallback runs.
- **Low byte of word 3 only on the fallback.** The existing `yieldEpoch` packing test (`(7n << 8n) | 0n` → `carvedOut: false`) is kept with a leading `emptyRevert()`.
- **Errors propagate without a fallback.**
  - A `ContractFunctionRevertedError` with data (`0x118f9b3d`) rejects with that same error.
  - A plain `Error("rpc down")` rejects with that same error.
  - In both cases there is only one read call and no `extsload`.
- **`blockNumber` is forwarded** to the view call, and to both `extsload` calls on the fallback path.
- The existing empty or invalid minter guards are kept. No read happens.

ABI shape (new `describe`):

- `toFunctionSelector(minterRepaymentViewAbi[0])` is `"0x1ac459b5"`, the selector found in the Hoodi bytecode.
- `decodeFunctionResult({ abi: minterRepaymentViewAbi, functionName: "repayment", data })`:
  - with `data` = the exact 128-byte zero blob Hoodi returned, it gives `{ feeShares: 0n, fees: 0n, released: 0n, carvedOut: false }`;
  - with `encodeFunctionResult` of `{ feeShares: 1n, fees: 2n, released: 900n, carvedOut: true }`, it round-trips by name.

`describe("readEvmRecoveryRepayments")`: extend `arrange()` with a `mode: "view" | "extsload"`, defaulting to `"view"`. In view mode, `functionName === "repayment"` resolves `{ feeShares: 0n, fees: 0n, released, carvedOut: flags !== 0n }`. In `extsload` mode, `repayment` rejects with `emptyRevert()` and `extsload` serves the words as today.

- "maps a PaymentRecorded and CashRepaid pair into the Stellar row shape" runs in both modes (`it.each`) and expects identical rows.
- "pins nextRepaymentId and the Minter reads to the same head" (renamed from "…extsload reads…") runs in both modes. Every `mockRead` call has `blockNumber: 4_500_000n`, including the `repayment` call.
- "shows principal as the Pocket-unrelease released amount" runs in view mode.
- The other cases (reversed, missing log, other loan, zero repayments → no scan and no Minter read) keep working unchanged with the default mode.

Regression:

- `packages/trustee/src/api/-useRepaymentRecovery.test.tsx` is unchanged and must stay green. It mocks `readEvmRecoveryRepayments`.
- The Stellar tests are untouched.

## Docs to Update

Line numbers are those in this worktree at `97836745`. The edits are narrow and keep away from PR #2072's lines and the lines next to them.

- **`docs/frontend/trustee-flows.md`**
  - **Line 1026** (EVM "Candidates"): change "the Minter `extsload` reads use `blockNumber: head`" to "the Minter `repayment` reads (legacy view or `extsload`, below) use `blockNumber: head`". #2072 edits line 1024, and line 1025 stays unchanged between the two edits.
  - **Line 1027** (EVM "Effects"): rewrite the part after "come from the Minter's own `Repayment` record". New content:
    - `readEvmMinterRepayment` calls the legacy view `repayment(loanId, repaymentId)` first. The Hoodi Minter (source `f92d719`) has it, returning `{ feeShares, fees, released, carvedOut }`.
    - Only on a revert with empty data (a `150631a` Minter, where the view moved to `PipelineMinterReader`) does it read `Minter.extsload` at the existing slot: words 2 and 3, the low byte of word 3 for `carvedOut`, and `yieldEpoch` packed above it and unread.
    - Any other error propagates and shows the load error.
    - A non-existent record reads as zeros on both paths.
    - Drop the sentence "This needs the Minter from contracts PR #54 or later…".
  - **Line 1059** ("Minter reads (Hoodi vs the frozen source)", #1574 section): add `readEvmMinterRepayment` (`repayment(uint256,uint256)`, #2074) to the list of legacy-first reads, with its fallback slot `keccak256(repaymentId . keccak256(loanId . (MINTER_STORAGE_SLOT + 19)))`, words +2 and +3.
  - **Line 2454** (EVM differences table, row 7 "Reversal effects"): change "the Minter `Repayment` record via `extsload`" to "the Minter `Repayment` record via the legacy `repayment(...)` view, or `extsload` where it is absent". #2072 edits rows 9 and 13 (lines 2456 and 2460), and row 8 (line 2455) stays unchanged between.
  - Not touched: lines 1024, 2456, 2460, 2462 and 2547 (#2072), and the Sources line 2373.
- **`docs/frontend/wallet-flows.md`** (not touched by #2072)
  - **Line 522**, the end of "**Minter read surface:**": add that `readEvmMinterRepayment` (#2074) follows the same rule with `repayment(uint256,uint256)`, falling back to words +2 and +3 of the field-19 mapping slot.
  - **Line 523**: change "(`readEvmRecoveryRepayments` reads `nextRepaymentId`, the logs and the `extsload` words at one head)" to "…the logs and the Minter `repayment` record at one head".
- **`docs/product-specs/loan-repayment-recovery.md` line 85** (not touched by #2072): change "the Minter's stored record read through `extsload` (TD-190)" to "the Minter's stored record read through the legacy `repayment` view, falling back to `extsload` where the view is absent (#2074; TD-190)".
- **`docs/exec-plans/tech-debt-tracker.md` TD-190**: insert one new bullet after the `Suggested fix` line (current line 2496), before the next entry. Leave lines 2493–2495 untouched (#2072 edits 2494–2495). Proposed text:
  - `- **Hoodi Minter resolved (#2074, 2026-11-19):** \`readEvmMinterRepayment\` calls the legacy \`repayment(uint256,uint256)\` view first (present on the Hoodi \`f92d719\` Minter) and reads \`extsload\` only when that view reverts with empty data (a \`150631a\` Minter), as \`readEvmMinterBankCash\` / \`readEvmRefHashSeen\` do; the Hoodi caveat above no longer applies. The log scan stays (this entry's gap).`
  - TD-190 stays open: its gap is the log scan.

  See Open Question 1 for the case where #2072 has merged first.
- Not changed:
  - `docs/FRONTEND.md` (#2072 territory, nothing stale for this fix).
  - `docs/user-stories/epic-1937/1943-trustee-evm-rc-pages.md` (#2072's line 13 already reads correctly).
  - `docs/exec-plans/completed/issue-1943-*.md` (historical).
  - `docs/exec-plans/known-bugs.md` (no entry for this bug).
- When done, the coder moves this plan to `docs/exec-plans/completed/` with the usual progress/decision log, per `docs/PLANS.md`.

## Open Questions

1. **TD-190 placement vs PR #2072.** #2072 rewrites the TD-190 Hoodi caveat (line 2495) to "fails on Hoodi; … a fallback in the client is the only route". Should this PR rewrite that line in place, or add a separate resolution bullet?
   - **Recommended default:** add a new bullet after the TD-190 `Suggested fix` line (current line 2496) and leave lines 2493–2495 untouched. The new bullet states that the caveat is resolved by #2074. This merges cleanly in either order. If #2072 has already merged when the coder starts, the coder instead rewrites the merged caveat line in place.
2. **The issue's "Observed" is not reproducible today.** Hoodi has no repayments, and the list short-circuits at `nextRepaymentId === 0`, so nothing reverts yet. Should the issue body be corrected?
   - **Recommended default:** leave the issue body as it is (the planner does not edit issues). State in the PR #2075 description that the bug is latent on Hoodi until the first EVM repayment, and that live verification is part of QA #1945.
