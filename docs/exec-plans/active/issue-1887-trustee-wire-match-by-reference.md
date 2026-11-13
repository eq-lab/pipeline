# Issue #1887: Trustee: match incoming wires to the LP by the issued payment reference — lookup, matched chip, default mint chain

Source: https://github.com/eq-lab/pipeline/issues/1887

Frontend flow, sub-issue of epic #1247. Trustee half of #1839 (backend merged in PR #1883). Branch
`feat/1887-trustee-wire-match-by-reference` (draft PR #1911). Spec:
[deposits.md §Wire Matching by Payment Reference](../../product-specs/deposits.md#wire-matching-by-payment-reference).
No Figma: the LP-counterparties pages and the Bank deposits card have no frames (trustee-flows.md
§LP counterparties: "no Figma ... styling is derived from the shipped `/loans` page"; §LP bank
deposits: "No Figma"). Everything below is built from the existing trustee detail primitives
(`DetailCard`, `StatusChip`, `KeyValueRow`, `AddressChip`, the dialog `inputClass`, `Button`).

## Scope

### Backend contract (verified)

Read from `packages/api/src/routes/lp_bank_deposits.rs`, `lps.rs`, the archived plan
`docs/exec-plans/completed/issue-1839-match-wires-by-payment-reference.md`, and the staging OpenAPI
(`https://api.pipeline.stage.eqlab.net/api-docs/openapi.json`, unauthenticated read, 2026-11-13:
`MatchedReference` schema present, `POST /v1/lps/{id}/bank-deposits` documents `422`, `GET /v1/lps`
has `payment_details`). No trustee token was at hand, so no data call was made.

- `GET /v1/lps?payment_details=<raw>` (trustee) → `200 { lps: [owner] }`, `200 { lps: [] }` when never
  issued, `400 { error }` when malformed. A blank value is ignored and lists **every** LP, so the
  client must never send a blank value. Case, whitespace and hyphens are ignored server-side.
- `POST /v1/lps/{id}/bank-deposits` body gains optional `payment_details` (send the trimmed raw value;
  the server canonicalises). New `422 { error }` messages (served text, verbatim):
  - never issued: "payment reference `PL-…` was never issued to any LP; record the wire without it to
    attribute it by hand, or book it to escrow"
  - other LP: "payment reference `PL-…` was issued to LP 12, not LP 7"
  - guard: "`payment_reference` is an issued LP payment reference (`PL-…`); enter the bank's own
    reference for this wire and pass the issued one as `payment_details`"
  - FK race: "the LP or the issued payment reference this deposit links to no longer exists; reload and retry"
  - `400` now also covers a malformed `payment_details` ("`payment_details` …"). `409` is unchanged
    (duplicate bank `payment_reference`).
- Every deposit (list and `POST` response) carries `matched_reference: null | { payment_details,
  chain_id: number | null, receiver_address: string | null, issued_at }`.

### In scope

1. **Lookup box (LP Counterparties list, `/lp-counterparties`).** A card above the table, "Match an
   incoming wire": one input "LP payment reference" (placeholder `PL-XXXX-XXXX-XXXX`) and a
   **Find LP** button (disabled while the trimmed input is blank or a lookup is in flight). On submit
   `GET /v1/lps?payment_details=<trimmed>`:
   - `[owner]` → navigate to `/lp-counterparties/{owner.id}?paymentDetails=<trimmed>`; the detail page
     opens the Record-deposit dialog with the LP payment reference pre-filled.
   - `[]` → inline notice: "No LP was issued this reference. The Cash reporter books the wire to escrow;
     assign it to its lender or return it from Escrowed wires." with an **Escrowed wires** link to
     `/cash-management?tab=escrow`.
   - `400` → `InlineError` "This is not a valid LP payment reference." with the server text as details.
   - `401`/`403`/network → the existing generic copy (`depositError`-style mapping).
   This is the "record-bank-deposit flow" entry that removes picking the LP by hand: the record form
   itself is per-LP, so the lookup sits where the Trustee would otherwise pick the LP.
2. **Record dialog (`-LpBankDepositsSection.tsx`).**
   - New optional field **LP payment reference** (`payment_details`), with the hint "The PL-XXXX-XXXX-XXXX
     reference the LP quoted. Leave blank to attribute the wire by hand." Sent trimmed only when
     non-blank; omitted otherwise. No client-side format check (the server canonicalises and answers
     `400`); no client-side canonicalisation.
   - The existing field is relabelled **Bank reference** with the hint "The bank's own reference for
     this wire (statement line, MT103 field 20 or UETR). Must be unique." — two fields both called
     "payment reference" would invite pasting the `PL-…` code into the wrong one (which the server now
     refuses with the guard `422`). The table column and the mint-confirm row follow (see 3, 4).
   - Pre-fill from the route search param `paymentDetails` (item 1): the dialog opens once on mount
     with the field set, and the param is then cleared with a `replace` navigation so a refresh or
     Back does not reopen it.
   - Errors: `422` → `InlineError` whose **message is the served `error` text**; when the request
     carried `payment_details`, a second line "Wires that cannot be matched to an LP are booked to
     escrow by the Cash reporter." links to `/cash-management?tab=escrow`. `409` keeps "A deposit with
     this payment reference is already recorded." (copy changes to "bank reference", see Step 4). `400`
     keeps the generic message with the server text in details.
3. **Attribution chip on each deposit row.** Inside the Bank reference cell, under the reference:
   - `matched_reference` non-null → `StatusChip band="info" label="Matched by reference"`
     (`lp-deposit-matched`) plus a hint line `{payment_details} · issued {formatIsoDateTimeUtc(issued_at)}`.
   - `null` → `StatusChip band="neutral" label="Attributed by hand"` (`lp-deposit-hand`).
   No new column (the five-column `colgroup` stays); `info` / `neutral` keep it distinct from the
   positive **Minted** chip in the same row.
4. **Mint (record_wire_in) chain default and the shown receiver.** The mint chain stays the session's
   signed-in chain (#1826, trustee chain-scope rule; switching chain = signing in on another network).
   For a deposit with `matched_reference.chain_id` set:
   - **Same chain as the session** → unchanged flow; the confirm dialog adds rows **LP payment
     reference** (`payment_details`) and **Shown to the LP** (`{targetChainLabel(chain_id)}` + the full
     `receiver_address`, `—` when null). When `receiver_address` differs from the receiver resolved
     now, a muted note: "The LP's settlement address changed since this reference was issued. PLUSD
     goes to the current address." (no extra ack — the spec says the mint goes to the current address;
     the existing #1826 changed-since-shown ack is unchanged).
   - **Different chain from the session** → plan default (see Open Questions): `Mint PLUSD` is
     disabled with the reason "This wire was matched to a reference issued for {chain}. Sign in on
     {chain} to mint it." — inserted into `mintDisabledReason` right after the EVM-session reason and
     before the wallet reason.
   - `chain_id` null (pre-#1824 reference) or hand-attributed → today's behaviour (session chain).
   - The capital-wallet fallback receiver is untouched (decision 2026-11-02).
5. **Escrowed wires deep link.** `/cash-management` accepts `?tab=<onofframp|income|withdrawals|escrow|wireouts>`
   (`validateSearch`; unknown values are dropped) and opens on that tab; changing tabs keeps the
   existing local behaviour.
6. **Docs and user stories** (see Docs to Update).

### Out of scope

- The #1763 escrow **assign** picker using the lookup (the backend plan suggests it; not in this issue).
  Note it in trustee-flows as a possible follow-up only.
- Extracting a reference from a whole remittance line; client-side format checks or canonicalisation.
- Any backend change (including the OpenAPI doc bug below, which is logged, not fixed).
- EVM minting (#1501), deposit `chain_id` for hand-attributed wires (TD-117/TD-164 remainder).

## Assumptions and Risks

- **Backend is live on staging** (OpenAPI confirms the shapes). The user stories need a trustee token
  and an LP that has requested payment details (`GET /v1/lps/me/payment-details?chain_id=`), which
  issues a reference only when system bank details are filled (else `503`, #1838).
- **Staging OpenAPI doc bug.** `LpsQuery` lacks `#[into_params(parameter_in = Query)]`, so
  `/api-docs/openapi.json` lists `payment_details` as a required **path** parameter. The handler reads
  it from the query (`Query<LpsQuery>`), so the console is unaffected (types are hand-mirrored,
  TD-42). Log as BUG-37 in `known-bugs.md`; do not fix here (backend).
- **Session chain vs matched chain** — the chosen gating (Scope 4) is a product decision; see Open
  Questions. If the answer is "warn + ack", only Step 3's `mintDisabledReason` branch and the confirm
  dialog change; the rest of the plan stands.
- **422 is distinguished only by served text.** The UI shows it verbatim and never parses it; the
  escrow link is shown for any `422` that carried `payment_details`, so its copy is neutral.
- **Relabel risk.** "Payment reference" → "Bank reference" touches existing tests and docs
  (`-LpBankDepositsSection.test.tsx` label queries, trustee-flows.md column table). Mechanical.
- **File size.** `-useLpBankDeposits.ts` is 569 lines and `cash-management.tsx` 837; keep additions
  small and put the pure helpers (row mapping, matched-chain reason) in the presenter as exported
  functions so they are unit-testable.
- **Overlap.** Open PR #1804 (epic/1795-lp-ui) edits `docs/frontend/bank-transfers.md` (LP side); this
  plan edits one line (~385). Expect a trivial rebase at most. No open PR touches the trustee files.
- **Comment rules.** One 2–3-line `// spec:` header per new file; no JSDoc on new fields (the existing
  hand-mirror JSDoc in `api/useLpBankDeposits.ts` is left as is, nothing new added).

## Open Questions

1. **Matched chain differs from the signed-in chain — block or warn?** The Issue says "default the mint
   to that chain", but in the trustee app the mint chain is the session's chain (#1826, chain-scope
   rule), so a "default" can only be enforced by refusing to mint elsewhere. Plan default: **block**
   `Mint PLUSD` with "This wire was matched to a reference issued for {chain}. Sign in on {chain} to
   mint it." (safest: the LP was shown that chain's receiver; an EVM-quoted wire then waits for #1501).
   Alternative: allow it behind a warning + "Mint on {session chain} anyway" acknowledgement (same
   pattern as the #1826 receiver-changed ack), which lets the Trustee mint an EVM-quoted wire on Stellar
   today. Decided by the user on #1887: **Option A, block** (implemented).

## Implementation Steps

1. **API hooks — `packages/trustee/src/api/useLpBankDeposits.ts`.**
   - Add `export interface MatchedReference { payment_details: string; chain_id: number | null;
     receiver_address: string | null; issued_at: string }` and `matched_reference: MatchedReference | null`
     on `LpBankDeposit`.
   - `RecordBankDepositInput` gains `payment_details?: string`. `useRecordBankDeposit` already
     JSON-serialises the rest of the input, so an `undefined` key is dropped.
2. **API hooks — `packages/trustee/src/api/useLps.ts`.**
   - `export function fetchLpsByPaymentDetails(ref: string, signal?: AbortSignal): Promise<LpsResponse>`
     → `lpFetch<LpsResponse>(`/v1/lps?payment_details=${encodeURIComponent(ref)}`)` (import `lpFetch`
     from `./useLp`; `useLp.ts` only type-imports from `useLps.ts`, so no runtime cycle). Throw if `ref`
     is blank (never send a blank filter).
   - `export function useFindLpByPaymentDetails()` — `useMutation<LpsResponse, Error, string>` over it
     (button-triggered, no cache, does not touch the `["lps"]` list key).
3. **Presenter — `packages/trustee/src/routes/-useLpBankDeposits.ts`.**
   - `DepositRow` gains `matched: { paymentDetails: string; issuedAt: string; chainId: number | null;
     chainLabel: string; receiverAddress: string | null } | null`; `mapDepositToRow` fills it from the
     served object (`formatIsoDateTimeUtc(issued_at)`, `targetChainLabel(chain_id)` which already
     renders `—` for null). No derivation beyond formatting.
   - `export function matchedChainReason(row: DepositRow, sessionChainId: number): string | null` →
     the Scope 4 block copy when `row.matched?.chainId != null && row.matched.chainId !== sessionChainId`,
     else `null`. Call it in `mintDisabledReason` right after the EVM-session check (add `chainId` to the
     `useCallback` deps).
   - `useLpBankDepositsSection(lpId, initialPaymentDetails?: string)`: new `paymentDetails` state +
     setter; `openDialog(prefill?: string)` resets it to `prefill ?? ""`; a mount-once effect opens the
     dialog with `initialPaymentDetails` when it is a non-blank string, then calls an
     `onPrefillConsumed` callback (passed from the route) to clear the search param.
   - `submit()` sends `payment_details: paymentDetails.trim() || undefined`; keep `sentPaymentDetails`
     (boolean, set at submit) so the view knows whether to show the escrow line on `422`.
   - Validation copy: "Enter the bank's payment reference." → "Enter the bank's reference for this wire."
   - `depositError`: add `status === 422 ? error.message` (served text) before the `409` branch; `409`
     copy → "A deposit with this bank reference is already recorded."; `400` copy → "Check the amount,
     references and date, then try again." Details stay `error.message`. Expose
     `mutationEscrowHint: mutation.error instanceof ApiError && mutation.error.status === 422 && sentPaymentDetails`.
4. **View — `packages/trustee/src/routes/-LpBankDepositsSection.tsx`.**
   - Props gain `initialPaymentDetails?: string` and `onPrefillConsumed?: () => void`, forwarded to the hook.
   - Table header "Payment reference" → "Bank reference"; the cell renders the reference, then the
     attribution chip (`lp-deposit-matched` / `lp-deposit-hand`) and, for matched rows, the
     `HINT_CLASS` line `{paymentDetails} · issued {issuedAt}` (`lp-deposit-matched-ref`).
   - Record dialog: relabel the reference input "Bank reference" + hint; add the "LP payment reference"
     input (`id="lp-deposit-payment-details"`, `autoComplete="off"`, placeholder `PL-XXXX-XXXX-XXXX`,
     hint as in Scope 2) right after it; update the dialog description to "Record a wire received from
     this LP. The bank reference must be unique — it identifies the wire when PLUSD is minted. Add the
     LP payment reference the LP quoted to match the wire by reference."
   - Under the mutation `InlineError`, when `mutationEscrowHint`: the escrow sentence with a TanStack
     `Link to="/cash-management" search={{ tab: "escrow" }}` reading "Escrowed wires"
     (`lp-deposit-escrow-link`).
   - Mint confirm dialog (`ready` branch): "Payment reference" row → "Bank reference"; when
     `ready.row.matched` is set, add `KeyValueRow`s "LP payment reference" and "Shown to the LP"
     (`lp-mint-shown-receiver`: chain label + full `receiverAddress` in the existing mono class, `—`
     when null) before Receiver; when `receiverAddress` is non-null and `!== ready.receiver.receiver`,
     the muted note (`lp-mint-shown-differs`).
5. **Detail route — `packages/trustee/src/routes/lp-counterparties.$id.tsx`.**
   - `validateSearch: (s: Record<string, unknown>) => ({ paymentDetails: typeof s.paymentDetails === "string" && s.paymentDetails.trim() ? s.paymentDetails : undefined })`.
   - Read it with `Route.useSearch()` and pass to `LpBankDepositsSection` as `initialPaymentDetails`,
     with `onPrefillConsumed={() => navigate({ search: {}, replace: true })}` (`Route.useNavigate()`
     or `useNavigate({ from: Route.fullPath })`).
6. **Lookup box — `packages/trustee/src/routes/-PaymentReferenceLookup.tsx` (new) + presenter
   `-usePaymentReferenceLookup.ts` (new).**
   - Presenter: `value`/`setValue`, `submit()` (no-op when trimmed blank or pending) → `useFindLpByPaymentDetails`;
     result state `idle | not-found | found | error`; on `found` call `navigate({ to: "/lp-counterparties/$id",
     params: { id: String(lp.id) }, search: { paymentDetails: trimmed } })`. Error mapping: `400` →
     "This is not a valid LP payment reference." + details; `401` → "Your session expired. Sign in
     again."; `403` → "Your trustee account is not authorized to look up LPs."; else the generic
     connection copy. (If more than one LP is ever served, take none and show the generic error —
     the contract says at most one.)
   - View: a `DetailCard` titled "Match an incoming wire" (`CardTitle`), a `<form>` with the label +
     input (`inputClass` from the deposits dialog — move that constant to
     `components/detail/detailTokens.ts` as `DETAIL_INPUT_CLASS` and import it in both places) and a
     `Button variant="primary-blue" size="m"` "Find LP" (`lp-lookup-submit`); `not-found` notice
     (`lp-lookup-not-found`) with the Escrowed wires `Link`; `InlineError` for errors.
   - Mount it in `lp-counterparties.index.tsx` between the `h1` and the table/loading/error block.
     It renders regardless of the list state.
   - Each new file gets a single `// spec: docs/frontend/trustee-flows.md#match-an-incoming-wire-by-reference`
     header line.
7. **Cash management tab param — `packages/trustee/src/routes/cash-management.tsx`.**
   - `validateSearch` → `{ tab?: TabKey }` (only the five known keys); `useState<TabKey>(Route.useSearch().tab ?? "onofframp")`.
   - Run `npx vite build` once (from `packages/trustee`) so `routeTree.gen.ts` picks up the search
     types if it changes, then `yarn build`; commit the generated file if it changed.
8. **Lint/build.** From `packages/trustee`: `npx vitest run`, `npx tsc --noEmit` (or `yarn build`),
   `yarn lint`. From the repo root: `npx tsx scripts/lint-docs.ts`, `npx tsx scripts/lint-comments.ts`.

## Test Strategy

Run vitest from inside `packages/trustee` (`npx vitest run <file>`). Real `apiFetch` paths stubbed
with `vi.fn` fetch mocks as the existing tests do; no localStorage mocks.

- `src/api/-useLpBankDeposits` (extend `routes/-useLpBankDeposits.test.ts` or add
  `api/-useLpBankDeposits.test.tsx`): the record mutation sends `payment_details` only when given;
  the list type carries `matched_reference` through.
- `src/api/-useLps.test.tsx` (new): `fetchLpsByPaymentDetails` URL-encodes the value
  (`pl-7k3m q9tx` → `payment_details=pl-7k3m%20q9tx`), refuses a blank value without calling fetch,
  surfaces a `400` as `ApiError` with the served message.
- `src/routes/-useLpBankDeposits.test.ts`: `mapDepositToRow` for matched (chain label, `—` for null
  chain, formatted `issued_at`, null receiver) and hand rows; `matchedChainReason` (same chain → null,
  other chain → copy, null chain → null, hand row → null); `depositError` for `422` returns the served
  text, `409`/`400` new copy.
- `src/routes/-LpBankDepositsSection.test.tsx`:
  - rows show "Matched by reference" + `PL-… · issued …` and "Attributed by hand";
  - submit with LP payment reference sends trimmed `payment_details`; blank sends no key;
  - `422` shows the served message and the Escrowed wires link (only when `payment_details` was sent);
    `409` still shows the duplicate copy;
  - `initialPaymentDetails` opens the dialog pre-filled once and calls `onPrefillConsumed`;
  - mint: matched same-chain shows "LP payment reference" / "Shown to the LP" rows and the differs
    note when the current receiver differs, and still mints to the re-read current receiver;
    matched other-chain disables `Mint PLUSD` with the chain reason and never reads or mints;
    null-chain matched row behaves like today;
  - update existing label queries for "Bank reference".
- `src/routes/-PaymentReferenceLookup.test.tsx` (new): blank disables Find LP and sends nothing;
  found → navigates to `/lp-counterparties/7` with `search.paymentDetails`; `[]` → not-found notice
  with a link to `/cash-management?tab=escrow`; `400` → invalid-reference error with served details;
  double-submit while pending sends one request.
- `src/routes/-lp-counterparties.index.test.tsx`: the lookup card renders above the table in
  loading, error and ready states.
- `src/routes/-lp-counterparties.$id.test.tsx`: `?paymentDetails=` is passed to the (mocked)
  section and cleared via `onPrefillConsumed`.
- `src/routes/-cash-management-page.test.tsx`: `?tab=escrow` opens the Escrowed wires tab; an unknown
  `tab` falls back to On / Off-ramp.
- Manual (user stories, staging): see the user-stories doc below; check the Network tab shows
  `GET /v1/lps?payment_details=` and the `POST` body carrying `payment_details`.

## Docs to Update

- `docs/frontend/trustee-flows.md`
  - §LP counterparties: replace "No client-side sort, no search, no pagination" with a pointer to the
    lookup; add a subsection **Match an incoming wire by reference** (sources, lookup states and copy,
    navigation with `paymentDetails`, never-blank rule, escrow link).
  - §LP bank deposits: column table ("Bank reference" + attribution chip), Record deposit (two
    fields, pre-fill from the search param, `422` verbatim + escrow line, relabelled copy), a
    **Matched reference and mint chain (#1887)** bullet (the Scope 4 rules and copy, "Shown to the
    LP", capital-wallet fallback unchanged), and the new disabled reason in the ordered list.
  - Cash management: document `?tab=` deep link.
  - Shared detail primitives table: `DETAIL_INPUT_CLASS` in `detailTokens.ts`.
- `docs/product-specs/deposits.md` (179/200 lines; net ≤ +1 line): in §Stellar PLUSD Mint Leg replace
  "The mint chain may default from the deposit's `matched_reference.chain_id`." with the decided rule
  (one sentence), and in §Wire Matching "Lookup" point to the trustee-flows subsection.
- `docs/frontend/bank-transfers.md` ~line 385: "The Trustee console part is a frontend follow-up." →
  "The Trustee console lookup, chip and mint-chain rule shipped in #1887 (see trustee-flows.md)."
- `docs/exec-plans/tech-debt-tracker.md`: TD-164 "Update (#1887)": matched deposits now drive the mint
  chain and show the receiver shown at issue; hand-attributed deposits still carry no chain (keep
  open). No new TD unless the coder takes a shortcut (next free TD-186).
- `docs/exec-plans/known-bugs.md`: BUG-37 — `GET /v1/lps` OpenAPI documents `payment_details` as a
  required path parameter (`packages/api/src/routes/lps.rs` `LpsQuery` lacks
  `#[into_params(parameter_in = Query)]`); handler reads the query correctly; fix in a backend issue.
- New `docs/user-stories/epic-1247/1887-trustee-wire-match-by-reference.md` + a row in
  `docs/user-stories/index.md` under Epic #1247. Stories: (1) paste a reference (lowercase, no
  hyphens) on LP Counterparties → the right LP opens with the dialog pre-filled; (2) record with it →
  row shows "Matched by reference" with the canonical `PL-…` and issue time; (3) record without it →
  "Attributed by hand"; (4) a reference of another LP typed into this LP's dialog → served `422` text,
  nothing recorded; (5) unknown well-formed reference → lookup "No LP was issued this reference" +
  Escrowed wires link opens the Escrowed wires tab; (6) malformed → invalid-reference error; (7) bank
  reference reused → "already recorded"; (8) `PL-…` pasted as Bank reference → served guard `422`;
  (9) matched deposit on the same chain → confirm dialog shows "Shown to the LP" and mints to the
  current address; (10) matched on the other chain → Mint PLUSD disabled with the sign-in reason.
- Plan lifecycle: the coder moves this plan to `docs/exec-plans/completed/` in the implementation PR.
