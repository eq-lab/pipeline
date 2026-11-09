# Issue #1763: Trustee: unmatched incoming wires — escrow list, assign to lender (assign_wire_in) or return (return_wire_in)

Source: https://github.com/eq-lab/pipeline/issues/1763

Epic #1795. Branch `feat/1763-trustee-escrowed-wires`, draft PR #1875. Labels: `frontend`.

## Scope

**In scope** (Trustee console `packages/trustee` + `packages/wallet-connect`, Stellar only):

1. **Escrowed wires list.** A new Cash Management tab, "Escrowed wires". It is scoped to the session's chain (`useSessionState().chainId`, falling back to `ENV.STELLAR_CHAIN_ID` only when there is no session), with the existing chain chip and sub-line pattern. Columns: wire id, amount, value date, bank reference hash, recorded at, on-chain status, actions. Rows come from `GET /v1/cash-book?chain_id=<id>` → `wire_ins[]` where the served `status === "Escrowed"`. Each row is confirmed by an on-chain `wire_in(id)` read.
2. **Assign to lender.** Pick an LP from `GET /v1/lps` that has a linked Stellar settlement address. The app reads that address's PLUSD authorisation on-chain, then the Trustee wallet signs `AccessManager.execute(minter, "assign_wire_in", [id: u32, receiver: Address], caller)`. After it lands, the app re-reads `wire_in(id)` and shows the effect (status `Assigned`, `receiver` = LP).
3. **Return.** The Trustee enters the outgoing wire's bank reference. `ref_hash = sha256(trimmed reference)` is checked with `ref_hash_seen`, then the Trustee signs `AccessManager.execute(minter, "return_wire_in", [id: u32, ref_hash: BytesN<32>], caller)`. It goes through a confirmation dialog in the shared dialog shell. After it lands, the app re-reads `wire_in(id)`: status `Returned`, `return_ref` = the hash.
4. **Role gating** by `can_call(wallet, minter, fn)` on the AccessManager (`TRUSTEE` role), using the same `readCanCall` pattern as #1711 and #1762's `useCashReporterAccess`. Error copy for: a reused reference, an unauthorised receiver, a wire no longer in escrow, an unknown wire, and wallet rejection.
5. **Specs and stories.** An additive `docs/product-specs/deposits.md` subsection, a new `docs/frontend/trustee-flows.md` section, a one-line consumer note in `docs/product-specs/minter-cash-book.md`, and a new `docs/user-stories/epic-1795/1763-trustee-escrowed-wires.md` with its index row.

**Out of scope:**

- **"Drop the capital-wallet fallback" (from the issue body) is NOT implemented.** Decision 2026-11-02 (PR #1814 / #1813 discussion; manager comment 2026-11-09 on #1763): the custodian / capital wallet stays the reserve Mint-PLUSD receiver when the LP has no linked settlement address. So `wireInReceiver` / `noReceiverMessage` in `-useLpBankDeposits.ts`, the Mint-PLUSD path, `VITE_STELLAR_CAPITAL_WALLET_ID`, and the capital-wallet paragraph in `deposits.md` §Stellar PLUSD Mint Leg all stay unchanged. No edit removes or rewords them.
- Recording an escrowed wire, i.e. `record_wire_in` with `receiver` = the minter. That is the Cash reporter's booking (#1762); this issue only consumes escrowed wires.
- EVM. An EVM session shows the existing Stellar-only reason and no list. The API serves no EVM cash book (`404 minter_not_configured` on every EVM chain), and the app has no EVM write client (#1573, TD-151/152). The EVM `assignWireIn` / `returnWireIn` / `wireIn` on hoodi-v5 are not wired.
- A `TRUSTEE` grant with a delay (schedule then execute). The user docs (`governance/multisig-roles.md`, epic #1795 model) give the Trustee no delay, so a delayed wallet gets a reason line and no schedule path.
- Any backend change (this user is frontend-only), and BUG-28's mapping in `mintError` (a separate bug).
- No Figma: the work reuses the Cash Management tab, table and chip patterns and the `MintConfirmDialog` / `-RejectReasonDialog.tsx` dialog shell.

### Key research findings (verified 2026-11-09)

- **Audit log is not a usable source.** `packages/api/src/routes/audit_log.rs` `AUDIT_EVENT_NAMES` contains `WireInReturned` but **not** `WireIn` or `WireInAssigned`, so `GET /v1/audit-log` never serves the receiver, amount, value date or reference of an incoming wire. The source suggested in the 2026-10-29 comment cannot list escrowed wires.
- **A real endpoint already serves the list.** `GET /v1/cash-book?chain_id=` (#1790, merged in `6b568fc2`; spec `docs/product-specs/minter-cash-book.md`) returns `wire_ins[]` built from the indexed `WireIn` / `WireInAssigned` / `WireInReturned` rows. Each row is `{ id, status, receiver, amount, value_date, ref_hash, recorded_at, assigned_at?, returned_at?, return_ref_hash? }`, where `status` is the server's `Escrowed` iff `receiver == minter` (`packages/api/src/minter_cash_book.rs` `build_wire_ins`). It needs a bearer with the `trustee` role, answers `403` otherwise, and answers `404 {"error":"minter_not_configured"}` when `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` is unset. This covers every field the issue asks for, so the plan uses it. No backend API request is needed for the list itself. No trustee code consumes `/v1/cash-book` yet.
- **Deployed testnet minter `CAPL5WN3…AIFK`**, contract spec read via simulation:
  - `wire_in(id: u32) -> WireIn { amount: i128, receiver: Address, ref_hash: BytesN<32>, return_ref: BytesN<32>, status: WireInStatus, value_date: u64 }`
  - `WireInStatus = Direct | Escrowed | Assigned | Returned` (unit enum; `scValToNative` gives `["Escrowed"]`)
  - `assign_wire_in(id: u32, receiver: Address) -> ()`, doc: "Stakes an escrowed wire's PLUSD into the vault for `receiver`."
  - `return_wire_in(id: u32, ref_hash: BytesN<32>) -> ()`, doc: "Returns an escrowed wire: burns its PLUSD and takes the cash back out."
  - `ref_hash_seen(ref_hash: BytesN<32>) -> bool`
  - `addresses_config() -> { plusd, staked_plusd, … }`, where `plusd` = `CDGHLVGY…N6AU`
  - `get_owner()` = the AccessManager `CDP7TUNB…WHTW` (`VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`)
- **Roles.** `get_target_function_role(minter, assign_wire_in)` = `TRUSTEE`, and the same for `return_wire_in`. `can_call(GAZFDDYK…ZH6G, minter, assign_wire_in | return_wire_in)` = `{ immediate: true, delay: 0 }`. Neither function takes a `caller`, and the minter's owner is the AccessManager. The call path is therefore `AccessManager.execute(target, fn, args, caller)`, the existing `relay({ mode: "execute" })` in `stellar/contracts/accessManager.ts`, the same as #1711's immediate `reverse_repay`. A simulated `AM.execute(minter, assign_wire_in, [1, G…], caller)` reaches the minter's logic.
- **Error codes observed by simulation:**
  - `wire_in(8)`, which does not exist: `Error(Contract, #9)`.
  - assign or return of id 999: `#9`.
  - assign or return of the `Direct` wire 1: `#14` (not escrowed).
  - Not observable today: `RefHashSeen` (`#7` per `loan-repay-minter.md`) and `ReceiverNotAuthorized` (`#15` per BUG-28's source reading). The deployed spec ships no `#[contracterror]` enum, so these codes are not machine-checkable.
- **PLUSD authorisation read.** `PLUSD.authorized(G…)` returns `true` for the LP `GA4AIHXK…TFW3`. An address with no trustline traps `Error(Contract, #13)` ("trustline entry is missing").
- **Testnet data.** `wire_in(1..7)` are all `Direct` to `GA4AIHXK…TFW3`, so **no escrowed wire exists on testnet**.

## Assumptions and Risks

- **Merge order with #1873 / #1874.** #1874 (#1762) heavily edits `cash-management.tsx`: it adds an `income` tab to `TabKey` / `TABS` and a tab branch. It also adds `readRefHashSeen` and `bankReferenceRefHash` to `wallet-connect/minter.ts` + `index.ts`, and `useCashReporterAccess`. #1873 (#1761) moves `sha256Hex` into `stellar/contracts/hash.ts`. This plan keeps every edit to the shared files additive:
  - New code goes in new files.
  - `cash-management.tsx` gets one `TabKey` member, one `TABS` entry, one import and one tab branch that renders a component.
  - `index.ts` gets one new export block.
  - `minter.ts` is **not** edited.
  - The coder starts by rebasing onto `main`. If #1874 has merged by then, the coder imports `readRefHashSeen` and `bankReferenceRefHash` from `@pipeline/wallet-connect` instead of the local equivalents in Step 1, and drops those local equivalents. Expect a trivial textual conflict in `TABS` / `TabKey` against #1874; resolve it by keeping both tabs.
- **No escrowed wire on testnet, and BUG-32 blocks making one.** An escrowed wire is created by `record_wire_in(receiver = minter)`, which mints PLUSD. BUG-32 (logged in #1874's `known-bugs.md`) says the testnet minter lacks the PLUSD `MINTER` role (`can_call(minter, PLUSD, mint) = { immediate: false }`), so no escrowed wire can be recorded until ops grants it. Consequences for live testing:
  - The list renders its empty state.
  - Assign and return can only be exercised against a `Direct` wire, where they are refused before signing by the on-chain status check.
  - Unit and component tests carry the behaviour.
  - Correction to the manager's note: per the contract doc, `assign_wire_in` *stakes already-minted* escrow PLUSD and does not mint, so BUG-32 blocks *creating* the escrowed wire rather than the assign step itself.
  - `return_wire_in` burns PLUSD, and `get_target_function_role(PLUSD, burn)` = `ADMIN` with `can_call(minter, PLUSD, burn) = { immediate: false }`. It may fail at the burn step on testnet. This cannot be verified without an escrowed wire; the coder records it in the user story as a live-testing risk. If it reproduces once an escrowed wire exists, it gets a known-bugs entry.
- **Staging config.** Whether staging sets `CHAIN_<id>_STELLAR_API_MINTER_ADDRESS` is unknown. Without it the tab shows its "cash book not configured" state, and that is an ops env change, not an API change. The coder checks the Network tab on staging. If the endpoint answers `404 minter_not_configured`, the coder records it in the PR body as a follow-up for the user (env var, no code).
- **The minter id must match.** The app signs against `ENV.STELLAR_YIELD_MINTER_ID`, and the cash book reports its `minter`. If they differ, actions are disabled with a reason, so the app never acts on wires indexed for another minter.
- **Error-code ambiguity.** AccessManager errors and minter errors both surface as `Error(Contract, #N)`; for example, AM `#7` = "not ready" and minter `#7` = `RefHashSeen`. Pre-sign on-chain reads (status, authorisation, `ref_hash_seen`, `can_call`) therefore carry the specific copy, and code mapping is a second line of defence that applies only to the assign/return simulations. Raw text always goes to the details dialog.
- **Overlap with #1764 / #1765.** Both will also read `/v1/cash-book`. `useCashBook` is written as a generic, typed hook (full response) so they can reuse it.
- **List coverage.** Cash-book lists can be partial before the indexer's coverage starts (spec §Lists). The on-chain confirmation catches stale rows, not missing ones.

## Open Questions

_None_

## Implementation Steps

1. [x] **wallet-connect: escrow bindings.** Create the new file `packages/wallet-connect/src/stellar/contracts/wireInEscrow.ts`, with a header `// spec: docs/product-specs/deposits.md#escrowed-wires` and no other comments. It reuses `hexToBytes32ScVal` from `./minter`, `relay` / `RelayParams` / `RelayResult` from `./accessManager`, and `simulateRead` from `./simulateRead`.
   - `type WireInStatus = "Direct" | "Escrowed" | "Assigned" | "Returned"`.
   - `interface MinterWireIn { id; amount: string /* raw i128 as decimal string */; receiver; refHash: string /* 64 lowercase hex */; returnRef: string; status: WireInStatus; valueDate: number }`.
   - `readMinterWireIn({ minterId, id, rpcUrl, networkPassphrase })`: `simulateRead(minterId, "wire_in", [u32(id)])`. It normalises the `["Escrowed"]`-style enum to the string, bytes to hex, and bigint to string, and throws on an unknown status or missing field (never defaults).
   - `readMinterPlusdId({ minterId, … })`: `addresses_config().plusd`.
   - `readPlusdAuthorization({ plusdId, address, … })` returns `"authorized" | "not-authorized" | "no-trustline"`. It calls `simulateRead(plusdId, "authorized", [Address])`; a simulation error containing `Error(Contract, #13)` maps to `"no-trustline"`, and any other error rethrows.
   - `encodeAssignWireInArgs({ id, receiver })` gives `[u32, Address]`. `encodeReturnWireInArgs({ id, refHash })` gives `[u32, BytesN<32>]`. Both reject a non-integer id or an id below 1. Return also rejects the zero hash.
   - `assignWireIn(params)` / `returnWireIn(params)` are thin wrappers over `relay({ mode: "execute", target: minterId, fn, args })`, mirroring `scheduleReverseRepay` / `executeReverseRepay`.
   - Only if #1874 is not on `main` at coding time: `readWireInRefHashSeen` (`ref_hash_seen`) and `wireInReturnRefHash(reference)` = sha256 of the trimmed reference as lowercase hex, via `crypto.subtle`. If #1874 is merged, skip these two and use its `readRefHashSeen` / `bankReferenceRefHash`.
2. [x] **wallet-connect exports.** Append one new `export { … } from "./stellar/contracts/wireInEscrow"` block and one `export type { … }` block at the end of the minter export area in `packages/wallet-connect/src/index.ts`, without touching existing lines. Grep for name collisions with #1761 and #1762 exports.
3. [x] **trustee: cash-book data hook.** Create the new file `packages/trustee/src/api/useCashBook.ts`, with header `// spec: docs/product-specs/minter-cash-book.md#api-contract`.
   - It holds the typed `CashBookResponse` (summary, `wire_ins`, `wire_outs`, `ramps`) exactly as served.
   - `useCashBook(chainId, { enabled, refetchMs })` uses key `["cash-book", chainId]` and calls `apiFetch("/v1/cash-book?chain_id=…")`.
   - It is enabled only for a Stellar session chain and runs with `retry: false` on 4xx.
4. [x] **trustee: on-chain confirmations and access.** Create the new file `packages/trustee/src/api/useEscrowedWires.ts`.
   - `useMinterWireIns(ids)`: `useQueries`, each with key `["minter-wire-in", minterId, id]` and `staleTime` 0, calling `readMinterWireIn`.
   - `useMinterPlusdId()`: key `["minter-plusd", minterId]` and `staleTime: Infinity`.
   - `useWireEscrowAccess(fn: "assign_wire_in" | "return_wire_in", enabled)`: a copy of #1762's `useCashReporterAccess` shape. It calls `readCanCall({ accessManagerId: ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID, caller: address, target: ENV.STELLAR_YIELD_MINTER_ID, fn })` under key `["wire-escrow-access", address, fn]`, with `staleTime` 30 s and `retry: false`.
   - `useAssignWireIn()` / `useReturnWireIn()` are mutations patterned on `useRecordWireIn`: a stage state, preflight guards ("not configured for this environment" when either the minter id or the executor id is empty, "Stellar wallet not connected"), and the call to `assignWireIn` / `returnWireIn`. `onSuccess` invalidates `["cash-book"]` and `["minter-wire-in", minterId, id]`.
5. [x] **trustee: presenter and copy.** Create the new file `packages/trustee/src/lib/wireEscrow.ts` (pure functions, unit-tested).
   - `escrowAccessReason(fn, { access, isPending, isError })` returns:
     - `null` when `access.immediate`.
     - "Checking this wallet's Trustee role…" while pending.
     - "Could not verify this wallet's Trustee role." on error.
     - When `delay > 0`: "This wallet holds the Trustee role with a {delay/3600} h delay; the app does not schedule wire assignments."
     - Otherwise "Only the Trustee role can assign escrowed wires." or "Only the Trustee role can return escrowed wires."
   - `onChainRowState(served, chain)`:
     - `"confirmed"` when the chain status is `Escrowed`.
     - `"assigned-pending-index"` / `"returned-pending-index"` when the chain shows `Assigned` / `Returned` and the served row is still `Escrowed`.
     - `"mismatch"` for `Direct`.
     - `"reading"` while the read is in flight, `"read-error"` when it failed.
   - Labels: "Escrowed (confirmed on-chain)", "Assigned on-chain — waiting for the indexer", "Returned on-chain — waiting for the indexer", "On-chain status {s} differs from the cash book", "Could not confirm on-chain".
   - `wireEscrowErrorCopy(fn, err)` builds on `toUserError(err, fallback)`, then applies these rules in order:
     - `RefHashSeen` text or `#7` on return: "This bank reference is already recorded on-chain. Use the outgoing wire's own reference."
     - `#15` on assign: "This lender's address is not authorised to hold PLUSD."
     - `#14`: "This wire is no longer in escrow. Refresh the list."
     - `#9`: "The minter has no wire with this id."
     - The fallback strings are "Could not assign this wire. Please try again." and "Could not return this wire. Please try again."
   - `cashBookError(error)`:
     - `404` with `minter_not_configured`: "The cash book is not configured for {chain} on this server."
     - `403`: "Your trustee account is not authorized to view the cash book."
     - `401`: "Your session expired. Sign in again."
     - Anything else: `toUserError`.
   - `formatUsdExact(amount)`: add it to `packages/trustee/src/utils/formatUsd.ts`. It prints `$` + the grouped whole part + `.` + the served fraction, verbatim with no truncation (cash-book amounts carry 6 decimals; `formatUsdDecimal` would cut them to 2).
6. [x] **trustee: section hook.** Create the new file `packages/trustee/src/routes/-escrowed-wires.ts`, `useEscrowedWiresSection()`.
   - It reads `chainId` from the session, `kind = chainKindOf(chainId)` and `chainLabel = targetChainLabel(chainId)`.
   - EVM: state `"unsupported"` with reason "Escrowed wires on {chainLabel} are not available in the Trustee app yet." No fetch.
   - Stellar: it runs `useCashBook` and builds `rows` = `wire_ins.filter(w => w.status === "Escrowed")`, newest id first as served. Each row carries `useMinterWireIns(rows.map(r => r.id))`.
   - `minterMismatch`: true when `cashBook.minter !== ENV.STELLAR_YIELD_MINTER_ID`. It disables every action with "The app's minter differs from the server's cash-book minter."
   - Refetch: every 30 s by default, and every 5 s while any row is `*-pending-index` (bounded to 120 s per row, the `MINT_PENDING_WINDOW_MS` pattern).
   - Per-row `actionReason(row, fn)`, in this order: not connected → "Connect your trustee wallet to act on escrowed wires."; minter not configured; `minterMismatch`; access reason; on-chain state ≠ `confirmed`; another action in flight.
   - **Assign flow** (state machine like `MintConfirm`):
     - `openAssign(row)` loads the LP options. These are `useLps().data.lps` with `stellar_address && address_linked_at`, sorted by `legal_name`.
     - On LP select, the hook reads `readPlusdAuthorization(plusdId, lp.stellar_address)`. The phases are "reading" → "authorized" | "not-authorized" | "no-trustline" | "read-error". Confirm is enabled only on `authorized`.
     - Copy: not-authorized → "This lender's address is not authorised to hold PLUSD. It cannot receive this wire."; no-trustline → "This lender's address has no PLUSD trustline."
     - `confirmAssign()`:
       1. Re-reads `fetchLp(lpId)`. If `stellar_address` changed, it returns to the select phase with a "settlement address changed" notice, as in the #1826 pattern.
       2. Re-reads `readMinterWireIn(id)`. If it is not `Escrowed`, it aborts with the not-in-escrow copy.
       3. Signs `useAssignWireIn`.
       4. On success, re-reads `readMinterWireIn(id)` and sets `lastResult = { kind: "assigned", id, receiver: chain.receiver, status: chain.status, hash, legalName }`.
   - **Return flow:**
     - `openReturn(row)` opens the dialog with a text input "Outgoing bank reference" (trimmed, non-empty, at most 140 chars, matching the deposit reference CHECK).
     - On confirm:
       1. Computes `refHash` and reads `ref_hash_seen`. If it is true, the dialog shows the reused-reference copy inline and nothing is signed.
       2. Re-reads `wire_in(id)`.
       3. Signs `useReturnWireIn`.
       4. On success, re-reads `wire_in(id)` and sets `lastResult = { kind: "returned", id, returnRef: chain.returnRef, status, hash }`.
7. [x] **trustee: UI.** Create the new file `packages/trustee/src/routes/-EscrowedWiresSection.tsx`, with header `// spec: docs/frontend/trustee-flows.md#cash-management--escrowed-wires`.
   - **Header card:** the title "Escrowed wires", a chain chip (`data-testid="cash-management-escrow-chain"`), and the sub-line "Unmatched incoming wires held by the minter on {chain} — assign each to its lender or return it."
   - **States:**
     - Loading: skeleton rows.
     - Error: `InlineError` with details.
     - Unsupported: the reason line.
     - Empty: "No incoming wires are in escrow."
   - **Table** (the ramp/withdrawal table styling already on the page):
     - Wire `#id`.
     - Amount via `formatUsdExact`.
     - Value date via `formatIsoDateTimeUtc`.
     - Reference hash, truncated first 8 / last 8 with the full value in `title` and a copy button if the page already has one; otherwise just `title`.
     - Recorded at via `formatIsoDateTimeUtc`.
     - On-chain status label.
     - Two buttons, "Assign to lender" and "Return", disabled with a visible reason line (`data-testid="escrow-row-{id}-reason"`).
   - **`AssignWireDialog` and `ReturnWireDialog`** use the shared shell copied from `MintConfirmDialog` in `-LpBankDepositsSection.tsx` / `-RejectReasonDialog.tsx`:
     - `role="dialog"` and `aria-modal`.
     - Escape and backdrop click cancel; neither ever confirms.
     - A navy confirm button whose label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…").
     - While a step is pending, both buttons are disabled and cancel is blocked.
     - Errors show inline as `InlineError` with "View details" for the raw text.
     - Assign shows the wire summary (id, amount, value date), an LP `<select>` ("{legal_name} — {truncateAddress(stellar_address)}"), the full receiver address once selected, and the authorisation result.
     - Return shows the wire summary, the reference input, and the computed `ref_hash` (read-only, monospace) once valid. The confirm label is "Return wire".
   - **Success notice** (green, like #1762's `income.lastBooked`):
     - Assigned: "Wire #{id} assigned on-chain to {legalName} ({receiver}). Status {status}. Transaction {hash}."
     - Returned: "Wire #{id} returned on-chain. Status {status}, return reference {returnRef}. Transaction {hash}."
     - Both end with "It leaves this list once indexed." All values come from the post-success chain read.
8. [x] **trustee: wire the tab** in `packages/trustee/src/routes/cash-management.tsx`. These are additive lines only:
   - add `"escrow"` to `TabKey`;
   - add `{ key: "escrow", label: "Escrowed wires" }` to `TABS`, after `onofframp`;
   - import `EscrowedWiresSection`;
   - add an `activeTab === "escrow" ? <EscrowedWiresSection /> :` branch before the final withdrawals fallback;
   - append `#cash-management--escrowed-wires` to the existing spec-pointer header.
   - The section owns its dialogs, so the page's close-all handler needs no change unless the tab switch must close them. In that case, mirror #1762's `income.close()` with a `key` remount.
9. [x] **Lint and build.**
   - `yarn workspace @pipeline/wallet-connect test`, `yarn workspace @pipeline/trustee test`, and lint for both.
   - `yarn workspace @pipeline/trustee build`. No new route, so no `routeTree.gen.ts` regeneration.
   - `npx tsx scripts/lint-docs.ts` and `npx tsx scripts/lint-comments.ts`. New files carry only the one spec header.

## Test Strategy

- **`packages/wallet-connect/src/stellar/contracts/wireInEscrow.test.ts`** (new; mock `simulateRead` and `relay` as `minter.test.ts` does):
  - `readMinterWireIn` normalisation: the enum array becomes a string, bytes become hex, bigints become strings. An unknown status or missing field throws.
  - `readPlusdAuthorization`: `true` → authorized, `false` → not-authorized, an `Error(Contract, #13)` simulation error → no-trustline, any other error rethrows.
  - The encoders' arg order and types (`u32`, `Address`, `BytesN<32>`), with id below 1 and the zero hash rejected.
  - `assignWireIn` / `returnWireIn` call `relay` with `mode: "execute"`, `target` = minter and the right `fn` and args.
  - If added locally, the ref-hash helper: trimming, and a known sha256 vector.
- **`packages/trustee/src/lib/-wireEscrow.test.ts`** (new):
  - Every `escrowAccessReason` branch, including the delay hours.
  - Every `onChainRowState` branch.
  - `wireEscrowErrorCopy`: wallet rejection; the `RefHashSeen` text; `#7` on return but not on assign; `#15`; `#14`; `#9`; the fallback. `details` always carries the raw text.
  - `cashBookError` for 404 / 403 / 401.
  - `formatUsdExact`: `"1234567.123456"` → `"$1,234,567.123456"`, and `"0.000000"`.
- **`packages/trustee/src/api/-useEscrowedWires.test.tsx`** (new):
  - The access hook query key and its disabled-when-unconfigured behaviour.
  - The mutations' preflight guards, the stage progression, and the invalidated keys.
  - `useCashBook` is disabled on an EVM chain and requests the right URL.
- **`packages/trustee/src/routes/-EscrowedWiresSection.test.tsx`** (new; mock the API hooks and the wallet-connect readers and writers):
  - Only `Escrowed` rows render, with served values verbatim: full 6-decimal amount, ISO dates and the hash in `title`.
  - The empty, loading, error (`404 minter_not_configured`, `403`) and EVM-unsupported states, with the chain chip text.
  - A minter mismatch disables the actions.
  - Row gating: wallet not connected; role pending, error, no role and delay; the on-chain read is `Direct`, `Assigned` (shows "waiting for the indexer" and disables the actions) or failed.
  - Assign happy path: open → LP list shows only LPs with a linked Stellar address → select → authorised → confirm → `fetchLp` re-read → `wire_in` re-read → `assignWireIn` called with `{ id, receiver }` → success notice built from the post-success chain read.
  - Assign blocked: not-authorized, no-trustline, a settlement address changed between open and confirm (back to select, nothing signed), and the wire no longer escrowed at confirm (nothing signed).
  - Return happy path: reference input validation → hash shown → `ref_hash_seen` false → sign → success notice with `returnRef`.
  - Return blocked: `ref_hash_seen` true shows the reused-reference copy and nothing is signed.
  - Dialog shell: Escape and backdrop cancel without confirming, and both are blocked while pending. A wallet rejection shows "You cancelled the transaction in your wallet."
- **`packages/trustee/src/routes/-cash-management-page.test.tsx`** (extend, additive): the "Escrowed wires" tab renders and switches to the section, and the existing tabs still render.
- **Live, read-only verification** (simulation only, never submit):
  - Re-run the signature and role probes in the plan's scratchpad scripts (`/private/tmp/claude-501/-Users-luiza-Projects-pipeline/1ace6ff8-7957-4b39-a440-9054a51a5a0a/scratchpad/wirein.cjs`, `wirein2.cjs`, `auth.cjs`).
  - On staging, open Cash Management → Escrowed wires on the Stellar session and confirm in the Network tab that `GET /v1/cash-book?chain_id=99000001` answers 200 (expect the empty state; no escrowed wire exists) or `404 minter_not_configured` (record it as an ops follow-up).
  - Switch to an EVM session and see the unsupported reason. Ask the user to report console/network rather than driving their browser.

## Docs to Update

- **`docs/product-specs/deposits.md`** (104 lines now; about 115 after): add a new subsection, `## Escrowed Wires` (anchor `#escrowed-wires`), **after** §Stellar PLUSD Mint Leg, additively. The existing paragraph, including its capital-wallet sentence and "out of scope here", stays verbatim. The subsection covers:
  - A wire booked with `receiver` = the minter is held in escrow.
  - The Trustee lists escrowed wires from `GET /v1/cash-book` (`status = Escrowed`, session chain), confirmed by `wire_in(id)`.
  - Assign: `AM.execute(minter, assign_wire_in, [id, receiver])` with `TRUSTEE` immediate; the receiver is the LP's linked Stellar settlement address and must be PLUSD-authorised; it stakes the escrowed PLUSD as sPLUSD for the LP; the relayer's Rule B then flips the deposit's `is_minted`.
  - Return: `return_wire_in(id, sha256(outgoing reference))`, single-use reference, burns the PLUSD and takes the cash out.
  - The capital-wallet fallback for Mint PLUSD is unchanged (decision 2026-11-02).
  - The EVM equivalents are not wired in the app.
- **`docs/product-specs/minter-cash-book.md`** (89 → about 90 lines): one sentence under §Overview or §API Contract saying the Trustee console's Escrowed wires tab (#1763) reads `wire_ins` with `status = Escrowed`.
- **`docs/frontend/trustee-flows.md`** (frontend doc, not size-capped): a new section `## Cash Management — Escrowed wires`, placed after "Cash Management — Withdrawal Queue". It covers:
  - sources (files);
  - chain scope;
  - data sourcing (served cash book plus on-chain `wire_in` confirmation, no client derivation);
  - columns and formatting;
  - row states;
  - gating order;
  - the assign and return dialogs and their pre-sign reads;
  - error copy;
  - success notice and refetch;
  - the EVM reason;
  - the testnet caveat (no escrowed wire; BUG-32; the possible burn-role gap on return).
  The existing On/Off-ramp section stays untouched; the new section is additive and below the existing ones, to stay clear of #1761 / #1762 hunks.
- **`docs/user-stories/epic-1795/1763-trustee-escrowed-wires.md`** (new, in the 1760 story format). Stories:
  1. List on a Stellar session: Network `GET /v1/cash-book`, only Escrowed rows, empty state today.
  2. EVM session shows the reason.
  3. A no-role wallet sees the disabled actions and the reason.
  4. Assign to an authorised LP.
  5. Assign blocked by an unauthorised or no-trustline LP.
  6. Return with a fresh reference.
  7. Return blocked by a reused reference.
  8. A stale row (on-chain `Assigned`) shows "waiting for the indexer".
  Prerequisites: an escrowed wire on testnet (none today; blocked by BUG-32), plus the `return_wire_in` burn-role risk.
- **`docs/user-stories/index.md`**: one additive row under the epic-1795 block, next to the #1760 row.
- **`docs/exec-plans/tech-debt-tracker.md`**: append a note to TD-118 that since #1763 the Trustee console lists escrowed wires; the worker-side count and warn are still open. If Step 1 had to add the local ref-hash helpers (#1874 not merged), add a TD entry to fold them into #1874's `readRefHashSeen` / `bankReferenceRefHash` and #1761's `hash.ts`.
- No `ARCHITECTURE.md` change.
