# Issue #831: Trustee: on-chain `draw_loan` mint on approval (Option B — trustee wallet-signed)

Source: https://github.com/eq-lab/pipeline/issues/831

Epic: #775 (Trustee Admin Panel). Builds on top of #829 (DB-only approve/reject wiring, already merged).

## Scope

**In scope (frontend only, `packages/trustee` + `packages/wallet-connect`):**

- Add a Stellar contract-invoke layer that registers an approved loan on-chain by
  invoking `execute(target, "draw_loan", args, caller)` on the executor/access-control
  contract, **signed by the connected trustee wallet** (Option B — decided on #829).
- Sequence the Approve action **chain-first, then backend**: on Approve, the trustee
  wallet signs + submits `draw_loan` on-chain FIRST; only after the tx confirms does the
  app call the EXISTING `POST /v1/loan-book/submissions/{id}/review {decision:"Approved"}`
  (already wired in #829). A wallet-reject / tx failure leaves the submission `InReview`
  for retry and makes **no** review call.
- A "verify the loan" pre-submit step = the `simulateTransaction` performed while
  building the envelope (a failed simulation aborts before any signature is requested).
- Approve UX: blocking spinner while the wallet signs + the tx confirms; graceful
  wallet-rejection / failure handling.
- Restore the "Approved & minted" banner copy (see #823 / `origination.$id.tsx`) now that
  a real mint happens.
- New runtime env vars for the executor + registry contract IDs, wired into **both**
  `packages/trustee/src/lib/env.ts` **and** `docker/trustee/entrypoint.sh`.
- The `Reject` flow is unchanged (pure DB review call — no on-chain step).

**Out of scope:**

- Any backend/contract change. The executor + `draw_loan` live in the external
  `pipeline-stellar-contracts` repo and are consumed as deployed.
- Backend `loan_drawn`-event → auto-flip-to-Approved reconciliation. Recommended as a
  **separate follow-up backend issue** (see Open Question 4). This issue ships the
  frontend chain-first ordering + a client-side no-double-mint guard only.
- The `/origination` table `Review` button — it already navigates to the detail page
  (`-useOriginationTable.ts` `resolveStatus` → `{ kind: "in-review", label: "Review" }`,
  row-click nav from #823). It does not become an inline approve/reject and needs no
  change here.
- Mainnet rollout — testnet contract IDs are known; mainnet IDs are supplied later by ops
  via ArgoCD env (Open Question 2). Testnet dev is not blocked.

## Assumptions and Risks

- **Architecture / import boundary (decided by planner).** The trustee app's ESLint config
  (`packages/trustee/eslint.config.js`, `no-restricted-imports`) **forbids importing
  `@stellar/stellar-sdk` anywhere in the app** — TD-33/#791 mandates all wallet/on-chain
  plumbing go through the `@pipeline/wallet-connect` package. Unlike the LP frontend, the
  trustee app has **no `src/wallet/**` carve-out**. Therefore the literal "mirror
  `depositManager.ts` inside the trustee app" reading of the issue is **not compatible with
  the current boundary**. Decision: put the ScVal encoding + envelope build + simulate +
  submit/poll flow inside `@pipeline/wallet-connect` (which already depends on
  `@stellar/stellar-sdk` 15.1.0 and is the sanctioned on-chain home), exposed as a **plain
  async function** (mirroring `getSacBalance` — the package forbids `@tanstack/react-query`
  outside `src/evm/**`, so it must not be a hook). The trustee app wraps it in a thin
  React-Query mutation hook that injects `useStellarWallet().signTransaction`. This keeps
  every `@stellar/stellar-sdk` symbol (`Contract`, `TransactionBuilder`, `Address`,
  `nativeToScVal`, `xdr`, `rpc.Server`) inside the package boundary and requires **no**
  ESLint carve-out or second stellar-sdk copy in the trustee app.
  - *Alternative considered (not chosen):* add `@stellar/stellar-sdk` to
    `packages/trustee` and loosen the ESLint boundary to allow a new `src/wallet/**`
    carve-out (literal mirror of the LP frontend). Rejected: duplicates the SDK and
    reverses a deliberate TD-33 boundary decision for one feature.
- **`caller.require_auth()` unknown** (Open Question 1). If `execute` does NOT require the
  caller to sign a separate Soroban auth entry, source-account signing by the trustee
  wallet is sufficient and the depositManager pattern works unchanged. If it DOES,
  `assembleTransaction` still folds the required auth entries into the envelope and — as
  long as `caller == source account == connected trustee address` — the single source
  signature satisfies `require_auth` for that address. The risk (a distinct signer, or
  multi-party auth) is considered low; confirm against the executor source.
- **ScVal encoding scale ambiguity** (Open Question 3). The map/enum/amount transforms
  are inferred from an example, not confirmed against the contract WASM interface. Wrong
  scale or shape will surface as a `simulateTransaction` error before any signature — a
  safe failure mode, but it blocks minting until corrected. Mitigate with a dedicated,
  unit-tested transform module and a live testnet simulate against stage submission `id 4`.
- **Testnet resets** wipe deployed contract IDs (same caveat as `depositManager.ts`); an
  empty/unconfigured ID must short-circuit the hook (render/behave as "mint unavailable"),
  never crash.
- **Runtime-env parity has no CI guard** (the parity check was dropped). Any new `VITE_`
  var MUST be added by hand to BOTH `packages/trustee/src/lib/env.ts` AND
  `docker/trustee/entrypoint.sh`, or it silently falls back to its default in every
  deployed environment. **Note:** on this branch `docker/trustee/entrypoint.sh` currently
  injects only 6 vars and is **missing** `VITE_STELLAR_RPC_URL`,
  `VITE_STELLAR_USDC_ID`, `VITE_STELLAR_USDC_CUSTODY_ID` (the #835 fix is not present on
  `feat/825-remove-ai-slop`). Since `draw_loan` needs `VITE_STELLAR_RPC_URL` to reach
  `window.__ENV__`, the coder MUST reconcile the entrypoint: add the two new contract-ID
  vars AND ensure `VITE_STELLAR_RPC_URL` is injected (re-applying the #835 additions if
  they are absent when this lands).
- **Dependency:** #829 is merged (approve/reject UI + `useReviewSubmission` +
  `useOriginationReview` exist). This issue extends `useOriginationReview.approve`.

## Open Questions

_Not empty — this is the frontend flow's human gate. Each carries the planner's recommendation._

1. **Does the executor's `execute` call `caller.require_auth()`?** Determines whether the
   trustee wallet must contribute a Soroban caller auth entry vs. plain source-account
   signing. **Recommendation:** proceed assuming source-account signing suffices when
   `caller == source == connected trustee address` (build the envelope with the trustee
   address as source, let `assembleTransaction` fold in any auth entries the simulation
   reports, sign once via `useStellarWallet`). Confirm against the executor source in
   `pipeline-stellar-contracts`; if it needs a distinct/extra signer, revisit the signing
   step. Source is external to this repo — needs the contracts team to confirm.

2. **Mainnet executor + target registry IDs, and their env wiring.** Only testnet is known
   (executor `CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF`, registry
   `CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH`). **Recommendation:** add two
   new vars `VITE_STELLAR_LOAN_REGISTRY_ID` (target) and
   `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, defaulting to `""` (empty → hook
   short-circuits, matching the existing `depositManagerId`/`usdcId` convention), and wire
   both through `env.ts` + `entrypoint.sh`. Testnet dev supplies them via `.env`; ops
   supplies mainnet IDs via ArgoCD once the contracts team provides them. Mainnet IDs must
   be obtained before mainnet deploy — not blocking for this issue's testnet delivery.

3. **Exact `loan_data` → ScVal transforms, confirmed against the contract.** Positional
   `draw_loan` args: `[0] address to`, `[1] string metadata_uri`, `[2] map economics`,
   `[3] u32 initial_ccr` (already 1e6-scaled — pass through), `[4] map location`.
   **Recommendations to confirm:**
   - `economics.senior_interest_rate_bps` (bps) → contract `senior_interest_rate` as a
     `u32` **1e6 fraction** (`bps × 100`; 10% = 1000 bps → `100000`).
   - USDC amounts: the API returns 6-decimal human-unit strings
     (e.g. `"1200000.000000"` = $1,200,000). The issue's example invariant
     (`senior 1e9 + equity 2e8 = facility 1.2e9`) is consistent with **6-decimal base
     units** for a $1,200 example loan ($1,200 × 1e6 = 1.2e9). **Recommendation:** encode
     as `u128` base units = parse the 6-decimal string to its integer minor units
     (strip the decimal point → `"1200000.000000"` → `1200000000000n`), i.e. human × 1e6.
     Confirm the contract expects 6-decimal (not 7-decimal SAC) scale.
   - `initial_location.location_type` string → enum unit variant encoded as
     `{"vec":[{"symbol":"<Type>"}]}` (`xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(type)])`),
     for `Vessel | Warehouse | TankFarm | Other`.
   - Confirm the map key names/casing for the `economics` and `location` maps match the
     contract structs. **Fast verification:** run `stellar contract info interface --id
     <executor> --network testnet` (or simulate against stage submission `id 4`) — a wrong
     shape/scale fails the simulate with a decode error, giving concrete feedback before
     any human sign-off. Needs the contracts team / a testnet dry-run to finalize.

4. **Mint ↔ review reconciliation / idempotency scope.** **Recommendation:** in THIS
   frontend issue, do chain-first-then-review ordering plus a client-side no-double-mint
   guard (before invoking, skip if the submission is already `Approved`; rely on the
   pre-submit `simulateTransaction` to reject a re-mint the contract would reject anyway).
   Defer robust backend reconciliation (worker already indexes `loan_drawn`; backend could
   auto-flip to `Approved` on seeing the mint even if the review call is lost) to a
   **separate follow-up backend issue** under Epic #775 / Stellar epic #444. Confirm this
   split is acceptable, or whether the backend reconciliation must ship alongside.

5. **Approve UX during wallet-sign + tx-confirm.** No new Figma exists for a "minting…"
   state (the #821/#823 Figma covers only the static InReview/Approved/Rejected footer).
   **Recommendation:** default to a **blocking** pattern — the Approve button shows a
   spinner / "Registering on-chain…" and both Approve/Reject stay disabled through
   sign → submit → confirm → review-call. On wallet rejection or tx failure, return to the
   actionable InReview footer with a mapped inline error and make no review call. Confirm
   there is no Figma to match; otherwise adopt it.

## Implementation Steps

### A. Contract layer in `@pipeline/wallet-connect` (all `@stellar/stellar-sdk` usage lives here)

1. **`packages/wallet-connect/src/stellar/contracts/loanRegistry.ts` (new).**
   - Type the loan inputs (reuse/port the `SubmitLoanRequest`/`EconomicsInput`/
     `LocationInput` shape; keep the package self-contained — do not import from the
     trustee app).
   - `encodeDrawLoanArgs(loanData)` — pure function returning the 5 positional `xdr.ScVal`s
     per Open Question 3 (address, string, economics map, u32 ccr, location map/enum).
     Keep it isolated and exhaustively unit-testable.
   - `buildDrawLoanEnvelope({ executorId, targetId, caller, loanData, server, networkPassphrase })`
     — `new Contract(executorId).call("execute", <target address>, <"draw_loan" symbol>,
     <vec of encoded args>, <caller address>)`; wrap in `TransactionBuilder` with the
     caller's `Account` (fetched via `server.getAccount(caller)`); `simulateTransaction`
     (this is the "verify" step — throw a typed error on `isSimulationError`);
     `assembleTransaction(...).build().toXDR()`.
   - `drawLoan({ executorId, targetId, caller, loanData, rpcUrl, networkPassphrase, signTransaction })`
     — orchestrates: build → `signTransaction(xdr, { networkPassphrase, address: caller })`
     (injected callback) → `TransactionBuilder.fromXDR` → `server.sendTransaction` → guard
     `ERROR` → `server.pollTransaction` → guard non-`SUCCESS` → return `{ hash }`. Mirror
     `useStellarDepositManager.ts`'s build/sign/send/poll flow exactly.
   - Confirm the exact `execute` argument order/types against the executor interface
     (Open Question 1/3).
2. **Export** `drawLoan` (+ arg/type exports and `encodeDrawLoanArgs` for testing) from
   `packages/wallet-connect/src/index.ts`, in the Stellar namespace next to `getSacBalance`.
3. **Unit tests** `packages/wallet-connect/src/stellar/contracts/loanRegistry.test.ts` —
   cover `encodeDrawLoanArgs` (each field/scale/enum), a successful `drawLoan` (mock
   `rpc.Server` simulate/send/poll + a stub `signTransaction`), a simulation-error abort
   (no signature requested), a `sendTransaction` `ERROR`, and a non-`SUCCESS` poll result.

### B. Trustee app — env + thin mutation hook + Approve orchestration

4. **`packages/trustee/src/lib/env.ts`** — add:
   - `STELLAR_LOAN_REGISTRY_ID: readString("VITE_STELLAR_LOAN_REGISTRY_ID", "")`
   - `STELLAR_LOAN_REGISTRY_EXECUTOR_ID: readString("VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID", "")`
   (empty default = unconfigured → hook short-circuits). `VITE_STELLAR_RPC_URL` and
   `VITE_STELLAR_NETWORK_PASSPHRASE` already exist and are reused.
5. **`docker/trustee/entrypoint.sh`** — add the two new vars (a `--arg` + a JSON key each),
   AND reconcile the missing `VITE_STELLAR_RPC_URL` (+ the other #835 vars if still absent)
   so the RPC URL actually reaches `window.__ENV__`. Manual parity requirement — no CI guard.
6. **`packages/trustee/src/api/useDrawLoan.ts` (new).** A React-Query `useMutation` that:
   - reads `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `ENV.STELLAR_LOAN_REGISTRY_ID`,
     `ENV.STELLAR_RPC_URL`, `ENV.STELLAR_NETWORK_PASSPHRASE`;
   - guards unconfigured IDs and a disconnected wallet with typed errors;
   - takes `{ loanData }`, resolves `caller = useStellarWallet().address`, and calls the
     `drawLoan(...)` package function passing `signTransaction` from `useStellarWallet`;
   - returns `{ hash }`. This hook holds NO `@stellar/stellar-sdk` import (all in the
     package). It is NOT under `src/api/` for network reasons — it makes no `apiFetch`
     call — but colocating with the other trustee hooks is fine; alternatively place under
     a new `src/onchain/` dir (coder's choice, keep consistent with repo conventions).
7. **`packages/trustee/src/routes/-useOriginationReview.ts`** — extend `approve()` to the
   chain-first sequence:
   - set a local `isMinting` state; on Approve: fetch the submission's `loan_data` (already
     available via `useLoanSubmissions` — thread it into `useOriginationReview` from the
     detail view-model, or read it inside the hook), call `useDrawLoan().mutateAsync({
     loanData })`; on success, call the existing `useReviewSubmission` mutation
     (`{ decision: "Approved" }`); on wallet-reject / tx-failure, set an inline error and do
     NOT call review (submission stays `InReview`).
   - Add a no-double-mint guard: if the submission is already `Approved`, skip the mint.
   - Extend `mapReviewError` (or add a sibling mapper) to cover on-chain failure copy
     (user-rejected signature, simulation failed, tx failed) distinctly from the API errors.
   - `isPending` must now reflect mint-in-flight too; `Reject` is unchanged.
8. **`packages/trustee/src/routes/origination.$id.tsx`** — surface the minting state in
   `ActionButtons` (button label e.g. "Registering on-chain…"; keep both actions disabled
   during mint). **Restore the banner copy to "Approved & minted"** in `ApprovedBanner`
   (and update the block comment that says to restore it once #831 ships). Confirm the
   status-chip / row-status copy in `-useOriginationTable.ts` (currently "Approved", not
   "Approved & minted") — align if product wants the table label to match (Open Question 5
   / product copy; default: keep table label short, restore "& minted" only on the detail
   banner).

### C. Docs

9. Update `docs/product-specs/trustee-dashboard.md` (Origination approval flow) to state
   that Approve now performs a trustee-wallet-signed on-chain `draw_loan` mint before the
   DB review flip, chain-first ordering, and the retry-on-failure behavior. Restore any
   "Approved & minted" wording. Cross-check `docs/product-specs/loans.md` and
   `docs/product-specs/smart-contracts-operations.md` for the origination-mint description
   and update if they claim the mint is unimplemented / relayer-signed.
10. Log any shortcut (e.g. the deferred backend reconciliation, or the trustee-hook
    directory choice) in `docs/exec-plans/tech-debt-tracker.md`; note the cross-app
    `SubmitLoanRequest` type duplication (TD-42 already tracks this) if the package needs
    its own copy.

## Test Strategy

- **`loanRegistry.test.ts` (wallet-connect):** as in step 3 — the ScVal transform matrix
  (address, string, economics map fields + amount scale + rate `bps×100`, u32 ccr,
  location enum variants), and the `drawLoan` flow happy path + each failure branch
  (simulation error, send `ERROR`, poll non-`SUCCESS`) with a mocked `rpc.Server` and a
  stub `signTransaction`. Assert **no signature is requested when the simulation fails**.
- **`useDrawLoan` test (trustee):** unconfigured-IDs guard, disconnected-wallet guard,
  success returns `{ hash }`, package-fn error propagates. Mock the wallet-connect
  `drawLoan` export and `useStellarWallet`.
- **`-useOriginationReview.test.ts` (extend existing):** the key ordering assertions —
  (a) Approve calls `drawLoan` BEFORE `useReviewSubmission`; (b) a rejected wallet / failed
  tx does NOT call review and surfaces the mapped on-chain error, leaving state
  actionable; (c) tx success THEN triggers the `{ decision: "Approved" }` review call and
  invalidation; (d) already-`Approved` submission skips the mint; (e) `Reject` is
  unaffected. Mock `useDrawLoan` and `useReviewSubmission`.
- **`origination.$id.tsx` page test (extend `-origination-detail-page.test.tsx`):** the
  Approve button shows the minting label while pending; the Approved banner reads
  "Approved & minted"; on-chain error copy renders inline.
- Run `yarn workspace @pipeline/trustee test`, `yarn workspace @pipeline/wallet-connect
  test`, both apps' `lint`, and `tsc -b` (build). Run `npx tsx scripts/lint-docs.ts` after
  the doc edits.
- **Figma verification:** no new Figma node for the minting state; verify the restored
  "Approved & minted" banner and the disabled/spinner Approve state against the existing
  #823 footer nodes (`4116:9656`) for token/spacing consistency (Open Question 5).

## Docs to Update

- `docs/product-specs/trustee-dashboard.md` — Origination approval now mints on-chain
  (trustee-wallet-signed `draw_loan`), chain-first ordering, retry behavior, restored
  "Approved & minted" copy.
- `docs/product-specs/loans.md` and `docs/product-specs/smart-contracts-operations.md` —
  reconcile any claim that the origination mint is unimplemented / relayer-signed.
- `docs/exec-plans/tech-debt-tracker.md` — deferred backend `loan_drawn` reconciliation
  follow-up; any type-duplication note.
