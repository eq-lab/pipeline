# Issue #1889: Stellar: a wire-only lender's settlement address is never PLUSD-authorised, so record_wire_in traps

Source: https://github.com/eq-lab/pipeline/issues/1889

Parent epic: #1247 (LP bank-wire funding). Related open decision: #1890 (should KYB `Passed` gate
USDC deposit vouchers and PLUSD whitelisting?). No Figma reference on the Issue or the epic, so
there is no visual verification step.

## Findings from research (read before implementing)

1. **Root cause confirmed in code.** `KycRepo::fetch_profiles_to_allow_stellar`
   (`packages/shared/src/kyc_repo.rs` ~:548-590) only returns `lp_profiles` rows that have an
   indexed `DepositRequested` (`EXISTS (... c.event_name = 'DepositRequested' ...)`), and
   `lp_profiles` rows themselves are only created from `DepositRequested`
   (`populate_profiles_from_deposits_stellar`, ~:682). `lps.stellar_address` (the KYB settlement
   address, `packages/shared/src/lp_repo.rs`) is never read by the relayer. So a wire-only LP's
   address is never a candidate.
2. **The issue mixes two contract errors; they are different failure modes.** At
   `pipeline-stellar-contracts@e9881ac`, `MinterError::ReceiverNotAuthorized` is **#15**
   (`contracts/minter/src/error.rs:29`), not #13. `stake_for` calls the PLUSD SAC's
   `authorized(receiver)`; for a `G…` account **with no PLUSD trustline** the SAC itself traps with
   SAC `TrustlineMissingError` = `Error(Contract, #13)` (already relied on by
   `readPlusdAuthorization` in `packages/wallet-connect/src/stellar/contracts/wireInEscrow.ts:141`
   and `mintError` in `packages/trustee/src/routes/-useLpBankDeposits.ts:66`). So:
   - `#13` = the `G…` receiver has **no PLUSD trustline at all**. The relayer cannot fix this:
     `set_authorized` on a `G…` without a trustline also traps `#13`, and only the account holder
     can create a trustline (`changeTrust`, signed by the LP).
   - `#15` = trustline exists but is not authorised. This is what the relayer fix resolves.
   - A `C…` (contract) settlement address has no trustline; SAC `set_authorized` creates its
     balance entry, so the relayer can authorise it directly. Today the whitelister skips any
     non-`G…` row (`Ed25519Pub::from_string` fails, `whitelist.rs` phase loop).
   The testnet repro in the Issue ("`authorized(addr) == false` and `#13`") is therefore
   internally inconsistent: with a fresh `G…` and no trustline, `authorized()` traps `#13`
   rather than returning `false`. Step 1 below re-verifies this.
3. **The USDC path gets the trustline from the LP app.** The Stellar `/deposit` flow has an
   "Enable PLUSD" (`changeTrust`) step (`packages/frontend/src/wallet/useDepositFlow.ts`). Nothing
   on the bank-wire path (`FundingDetailsModal`, `docs/frontend/bank-transfers.md`) prompts a
   wire-only LP to create one.
4. **Escrow assign already pre-flights** `PLUSD.authorized(receiver)` with `no-trustline` /
   `not-authorized` phases (`packages/trustee/src/routes/-escrowed-wires.ts:335,399`). The direct
   **Mint PLUSD** (`record_wire_in`) dialog does not; it only maps a `#13` trap after the fact and
   does not map `#15` at all.
5. **EVM has the same shape** (`MinterUpgradeable._stakeFor` reverts `MinterReceiverNotAllowed`
   when `!plUsd.hasAccess(receiver)`), but EVM Mint PLUSD is not wired in the Trustee app yet
   (#1501), so it is out of scope here (see Open Questions).

## Scope

Decision on the Issue's options: **option 3** — option 1 is the fix, option 2 is the pre-flight
guard. Option 1 is correct under either answer to #1890: the new path is gated on KYB `Passed`
itself, independently of how the USDC-deposit path is gated.

### In scope

**A. Relayer (backend, the fix).**
- New Stellar Phase 0b: seed `lp_profiles` rows (on every Stellar relayer chain) for the linked
  `lps.stellar_address` of every LP with `kyb_status = 'Passed'`, so the existing Elliptic Phase 2
  address screen (`screen_addresses`, keyed on `kyt_screened_at IS NULL`) screens them — this is
  the "screened by KYT on link" requirement, reusing the existing machinery.
- `fetch_profiles_to_allow_stellar`: a profile becomes a candidate when it has a qualifying
  `DepositRequested` (unchanged branch) **or** its address is the `stellar_address` of a KYB
  `Passed` LP (new branch). Elliptic `p.kyt_status = 1` applies to both branches when enabled; the
  Sumsub individual-KYC clause applies to the deposit branch only (KYB `Passed` is the identity
  check for the linked branch — see Open Questions).
- Whitelister handles `C…` settlement addresses (`address_contract`) as well as `G…`
  (`address_account`).
- Whitelister distinguishes "no trustline" (`G…` whose `authorized` simulate traps `#13`) from
  "not authorised": it skips such a candidate without submitting, logs at `debug`, and does not
  count it against `batch_size`, so wire-only LPs who have not added a trustline cannot starve
  deposit-path candidates or spam `error` logs every cycle.

**B. Trustee console (pre-flight guard).**
- Mint PLUSD confirm dialog reads `PLUSD.authorized(receiver)` (reusing `readPlusdAuthorization`
  and `ensureMinterPlusdId`) when it opens and again on confirm, and blocks signing with a clear
  message for `no-trustline` and `not-authorized` (applies to the capital-wallet fallback receiver
  too).
- `mintError` maps minter `#15` (`ReceiverNotAuthorized`) to its own copy, alongside `#13`.

**C. Docs** (see Docs to Update).

### Out of scope

- LP-app UX to create a PLUSD trustline on the bank-wire path (a frontend change in
  `packages/frontend`); proposed as a follow-up issue (Open Questions).
- On-chain de-authorisation (relink, KYT fail): the existing Stellar disallow pass is DB-only; not
  changed here, logged as tech debt.
- EVM relayer / EVM Mint PLUSD (#1501).
- Any contract change (contracts are frozen).
- The KYB gate on the USDC-deposit branch and vouchers (that is #1890's decision).

## Assumptions and Risks

- **The fix does not by itself unblock a `G…` LP without a PLUSD trustline.** After this change
  such an LP is still trapped (`#13`) until they add the trustline; the Trustee guard turns the
  trap into a clear pre-signing message. Full "Expected" behaviour for `G…` addresses needs the
  LP-side trustline step (Open Questions).
- **Relinks widen the authorised set.** A `Passed` LP may relink at any time with no Trustee
  approval (`kyb-lp-verification.md` § Settlement Address), and for `C…` or a different signer the
  signature does not prove control of the settlement address (TD-162). Each relink can therefore
  get one more address PLUSD-authorised, and nothing de-authorises the old one on-chain. Bounded
  by Elliptic KYT when enabled; with screening off (allowed per environment, see #1890) there is no
  check beyond KYB `Passed`. Log as tech debt.
- **Unproven legacy addresses** (`stellar_signer_address IS NULL`) are included by default because
  they already serve payment details and receive mints today (Open Questions).
- **Chain scoping.** `lps.stellar_address` is per chain kind, not per `chain_id`; every Stellar
  relayer chain authorises it. This matches `GET /v1/lps/me/payment-details`, which serves the
  same address for any Stellar chain.
- **RPC cost.** Untrustlined linked `G…` candidates cost one `simulateTransaction` each per cycle
  (60 s default). KYB-`Passed` LPs are few (institutional), so acceptable.
- **Elliptic and `C…` addresses.** Whether Elliptic `wallet_exposure` screens a Soroban contract
  address is unverified. If it errors, `screen_addresses` retries forever and the `C…` profile is
  never `kyt_status = 1`, i.e. never authorised when Elliptic is on (fails closed). Note it in the
  PR; not a blocker.
- **Capital wallet** must itself be PLUSD-authorised; that is an ops task, not the relayer's. The
  new Trustee guard will surface it if it is not.
- **Dependency on #1890** (open): see Open Questions. The plan is correct under either answer.
- No migration: `lps.stellar_address` is `UNIQUE` (indexed), `kyb_status` exists.

## Open Questions

1. **#1890 (unanswered).** If the answer is "Yes", the USDC-deposit branch of
   `fetch_profiles_to_allow_stellar` (and vouchers) gains a KYB gate in #1890's own change; this
   plan's linked-address branch is unaffected. If "No", nothing here changes. Confirm this issue
   may ship before #1890 is decided.
2. **Sumsub on the linked branch.** With `JOB_RELAYER_SUMSUB_ENABLED=true` (the default), should the
   linked-address branch also require the wallet's Sumsub individual-KYC statuses? Plan default:
   **no** — KYB `Passed` (Trustee-reviewed entity verification) replaces it; requiring Sumsub
   would leave wire-only LPs blocked under the default config.
3. **Unproven addresses.** Authorise linked addresses with `stellar_signer_address IS NULL`
   (legacy, unproven)? Plan default: **yes**, consistent with payment details and Mint PLUSD
   already using them. Alternative: require `stellar_signer_address IS NOT NULL`.
4. **LP-side PLUSD trustline for `G…` wire-only lenders.** The relayer cannot create a trustline.
   Proposal: a follow-up `frontend` issue under #1247 to add an "Enable PLUSD" step on the
   bank-wire path (e.g. in or before `FundingDetailsModal`), plus interim user-doc wording in this
   issue telling the LP to add PLUSD to their settlement wallet before the first wire. Confirm the
   split, and the interim wording.
5. **EVM parity.** EVM has the same gap (`MinterReceiverNotAllowed`). File a follow-up for the EVM
   relayer to allow linked `evm_address` of `Passed` LPs, to land with #1501? Plan default: yes,
   follow-up only.

## Implementation Steps

1. **Verify on testnet first (no signing needed, record the output in the PR).** Using the testnet
   ids in `.env.example` (PLUSD SAC from `CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID`), simulate
   `authorized(<fresh funded G… with no PLUSD trustline>)` and confirm `Error(Contract, #13)`;
   simulate it for a `G…` with an unauthorised PLUSD trustline and confirm `false`; if an LP fixture
   is available, simulate `record_wire_in` to that second address and confirm minter `#15`. Any
   simulate path works (e.g. `stellar contract invoke --send=no`, or a throwaway call through
   `StellarRpc::simulate_transaction`). If results differ from Finding 2, stop and report.

2. **`packages/shared/src/kyc_repo.rs` — candidate SQL as a pure builder.**
   - Add `pub fn stellar_allow_candidates_sql(sumsub_enabled: bool, elliptic_enabled: bool) -> String`
     returning:
     ```sql
     SELECT p.wallet_address FROM lp_profiles p
     WHERE p.chain_id = $1
       AND p.on_chain_allowed = FALSE
       [AND p.kyt_status = 1]                                   -- elliptic_enabled
       AND (
         (EXISTS (SELECT 1 FROM contract_logs c
                  WHERE c.chain_id = $1
                    AND c.event_name = 'DepositRequested'
                    AND c.params->>'user' = p.wallet_address
                    [AND c.kyt_status = 1])                     -- elliptic_enabled
          [AND p.sumsub_kyc_status = 2 AND p.sumsub_review_status = 2
               AND p.sumsub_aml_status = 2])                    -- sumsub_enabled
         OR EXISTS (SELECT 1 FROM lps l
                    WHERE l.stellar_address = p.wallet_address
                      AND l.kyb_status = 'Passed')
       )
     ```
     Keep the Stellar case-sensitive match (no `LOWER`).
   - `fetch_profiles_to_allow_stellar` uses it; its signature is unchanged.
   - Add `pub const POPULATE_PROFILES_FROM_LINKED_STELLAR_SQL: &str`:
     ```sql
     INSERT INTO lp_profiles (chain_id, wallet_address)
     SELECT $1, l.stellar_address FROM lps l
     WHERE l.kyb_status = 'Passed' AND l.stellar_address IS NOT NULL
     ON CONFLICT (chain_id, wallet_address) DO NOTHING
     ```
     and `pub async fn populate_profiles_from_linked_settlement_addresses_stellar(&self, chain_id: i64) -> anyhow::Result<u64>`.
   - If Open Question 3 is answered "proven only", add `AND l.stellar_signer_address IS NOT NULL`
     to both the populate SQL and the `lps` branch of the candidate SQL.
   - Update the doc comment on `fetch_profiles_to_allow_stellar` (one short spec pointer only, per
     the comment rule).

3. **`packages/worker/src/relayer/stellar/job.rs` — Phase 0b.** Right after Phase 0, call
   `populate_profiles_from_linked_settlement_addresses_stellar(chain_id)` with the same
   info/error logging shape as Phase 0. Update the module header's phase list.

4. **`packages/worker/src/relayer/stellar/whitelist.rs` — G/C addresses and trustline state.**
   - Add a pure `pub fn holder_scval(strkey: &str) -> Option<ScVal>`: `G…` →
     `address_account(&Ed25519Pub)`, `C…` → `address_contract(&ContractStrkey)`, else `None`.
   - Change `is_already_authorized(&Ed25519Pub)` to `plusd_authorization(&ScVal) -> Result<PlusdAuth>`
     with `pub enum PlusdAuth { Authorized, NotAuthorized, NoTrustline, Unknown }`, classified by a
     pure `pub fn classify_authorized_simulate(error: Option<&str>, return_value: Option<&ScVal>) -> PlusdAuth`:
     error containing `Error(Contract, #13)` → `NoTrustline`; any other error, missing or
     non-bool result → `Unknown` (keeps today's "proceed with submit"); `Bool(true)` →
     `Authorized`; `Bool(false)` → `NotAuthorized`. Reuse the `Error(Contract, #N)` matching style
     of `indexer/stellar/security_registry_views.rs::is_contract_error` (move that helper to a
     shared spot such as `crate::stellar` if reusing it directly, otherwise mirror it).
   - `submit_set_authorized` takes the holder `ScVal` instead of `&Ed25519Pub`.
   - Phase loop: parse each candidate with `holder_scval` (warn + skip when `None`); on
     `Authorized` sync the DB flag as today; on `NoTrustline` `debug!` and `continue` without
     submitting; on `NotAuthorized` / `Unknown` submit. Replace `.take(batch_size)` on candidates
     with a counter of submits, breaking once `batch_size` submits were attempted.
   - Update the module and phase doc comments to the minimal spec-pointer form if touched.

5. **`packages/trustee` — Mint PLUSD pre-flight (option 2).**
   - `packages/trustee/src/routes/-useLpBankDeposits.ts`: extend `MintConfirm` with
     `{ phase: "no-trustline" | "not-authorized"; receiver: WireInReceiver }`. In `openMint`, after
     resolving `next`, call `readPlusdAuthorization({ plusdId: await ensureMinterPlusdId(queryClient), address: next.receiver, rpcUrl, networkPassphrase })`
     (as `-escrowed-wires.ts` does) and set the phase; a read failure goes to `read-error` with
     "Could not read this receiver's PLUSD authorisation. Try again.". In `confirmMint`, after the
     receiver re-read and before `mint.mutateAsync`, re-read the authorisation and stop on anything
     but `"authorized"`. Respect the existing `readToken` staleness guard.
   - `mintError`: add `parseSorobanContractErrorCode(...) === 15` → "This receiver's PLUSD trustline
     is not authorised yet. The relayer authorises a KYB-passed lender's linked address
     automatically; try again in a few minutes." (keep the #13 copy).
   - `packages/trustee/src/routes/-LpBankDepositsSection.tsx` (`MintConfirmDialog`): render the
     two new phases with confirm disabled — `no-trustline`: "This receiver has no PLUSD trustline.
     The lender must add PLUSD to this wallet before it can receive a mint."; `not-authorized`:
     "This receiver's PLUSD trustline is not authorised yet. The relayer authorises a KYB-passed
     lender's linked address automatically; try again in a few minutes." Capital-wallet receiver
     variants say "capital wallet" instead of "lender". Stable `data-testid`s
     (`lp-mint-no-trustline`, `lp-mint-not-authorized`).
   - No new spec-style comments (run `npx tsx scripts/lint-comments.ts`; shrink the baseline if a
     listed file is touched).

6. **Docs** — update every file in Docs to Update, and add the two tech-debt entries.

7. **Lint and test**: `cargo clippy --all -- -D warnings`, `cargo test -p shared -p pipeline-worker`,
   `yarn workspace @pipeline/trustee test` and its typecheck, `npx tsx scripts/lint-docs.ts`,
   `npx tsx scripts/lint-comments.ts`.

## Test Strategy

Pure unit tests only. No test reads `DATABASE_URL` / `POSTGRES_URL` or connects to Postgres; Rust
tests live in `packages/<pkg>/tests/<topic>.rs`, never inline in `src/`.

- **`packages/shared/tests/stellar_whitelist_candidates_sql.rs`** (new), over
  `stellar_allow_candidates_sql` with a whitespace-flattening helper (pattern of
  `lp_bank_deposit_pending_sql.rs`), for all four `(sumsub, elliptic)` combinations:
  - always contains the `lps l` branch with `l.stellar_address = p.wallet_address` and
    `l.kyb_status = 'Passed'`, joined by `OR` to the `DepositRequested` branch;
  - `elliptic=true` adds `p.kyt_status = 1` outside the `OR` (applies to both branches) and
    `c.kyt_status = 1` inside the deposit `EXISTS`; `elliptic=false` has neither;
  - `sumsub=true` puts the three `sumsub_* = 2` clauses inside the deposit branch only (assert they
    appear before the `OR EXISTS (SELECT 1 FROM lps` substring and not after it);
  - no `LOWER(` anywhere (case-sensitive Strkeys);
  - `on_chain_allowed = FALSE` and `chain_id = $1` present.
  Same file: `POPULATE_PROFILES_FROM_LINKED_STELLAR_SQL` inserts into `lp_profiles`, selects
  `l.stellar_address` from `lps` with `kyb_status = 'Passed'` and `stellar_address IS NOT NULL`,
  and has `ON CONFLICT (chain_id, wallet_address) DO NOTHING`.
- **`packages/worker/tests/stellar_whitelist.rs`** (new):
  - `holder_scval`: a valid `G…` → `ScVal::Address(ScAddress::Account(..))` with the right key
    bytes; a valid `C…` → `ScAddress::Contract`; garbage, `M…`, empty → `None`.
  - `classify_authorized_simulate`: `#13` error → `NoTrustline`; other contract error (e.g.
    `#4`) and plain RPC error text → `Unknown`; no result → `Unknown`; `Bool(true)` →
    `Authorized`; `Bool(false)` → `NotAuthorized`; non-bool → `Unknown`; `#130`-style text
    must not match `#13` (assert the matcher is exact on the closing paren).
- **Trustee (vitest, colocated as the package already does)**:
  `packages/trustee/src/routes/-LpBankDepositsSection.test.tsx` (and/or a hook test next to
  `-useLpBankDeposits.ts`), mocking `readPlusdAuthorization` / `ensureMinterPlusdId`:
  - open → `"authorized"` → `ready`, confirm enabled; `"no-trustline"` and `"not-authorized"` →
    the new notices, confirm disabled, `record_wire_in` never called;
  - read throws → `read-error` with Retry, no mint;
  - authorisation flips to `"not-authorized"` between open and confirm → no mint, dialog shows
    the notice;
  - capital-wallet receiver is checked too;
  - `mintError` maps `Error(Contract, #15)` to the new copy and keeps the `#13` copy.
- **Manual (PR description):** Step 1 testnet simulate output; after deploy, a KYB-`Passed` LP
  with a linked `G…` that has a PLUSD trustline becomes `authorized == true` within one relayer
  cycle without any USDC deposit, and Mint PLUSD then succeeds.

## Docs to Update

- `docs/design-docs/multi-chain-kyc-sharding.md` § Stellar Relayer Whitelist: Phase 0b (linked
  settlement addresses of `Passed` LPs), the two-branch candidate rule (Sumsub on the deposit
  branch only, KYT on both), `C…` support, the `#13` no-trustline skip and submit-only batch
  counting; update § Idempotency for the tri-state pre-check.
- `docs/product-specs/deposits.md` § Stellar PLUSD Mint Leg: how a linked LP receiver becomes
  PLUSD-authorised (relayer, KYB `Passed`, KYT when enabled), the `#13` (no trustline, LP must add
  it) vs minter `#15` (not authorised yet) distinction, and the Trustee pre-flight.
- `docs/product-specs/lp-onboarding.md` § LP Entity Registration and KYB Documents: KYB `Passed`
  now also makes the linked Stellar settlement address eligible for PLUSD authorisation; the
  "gates nothing but…" sentence changes. Do not touch the USDC-deposit gating wording (#1890).
- `docs/product-specs/relayer-service.md` (~:97, whitelist current-implementation note): add the
  KYB-linked Stellar path.
- `docs/frontend/trustee-flows.md` Mint PLUSD (~:1520-1545): the authorisation read on open and on
  confirm, the two new blocking notices, the `#15` error copy, order among disabled reasons.
- `docs/user-docs/lenders/deposit.md` § Bank wire deposits: before the first wire, the settlement
  wallet must hold PLUSD (a `G…` wallet adds a PLUSD trustline); Pipeline authorises it after KYB.
  Wording per Open Question 4.
- `docs/exec-plans/tech-debt-tracker.md`: (a) relinked / KYT-failed Stellar addresses stay
  PLUSD-authorised on-chain (no de-authorise path); (b) EVM wire-in receivers have the same gap
  (`MinterReceiverNotAllowed`), pending #1501.
- `.env.example` Stellar relayer comment block (~:181-184): mention Phase 0b seeds linked
  addresses of `Passed` LPs.
