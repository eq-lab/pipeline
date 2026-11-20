# Trustee flows

Architecture and behavior specs for the Trustee admin panel in `packages/trustee/src/**` —
loan-book data, loan detail, cash movement, and lifecycle actions. This is the home for flow-shape
knowledge that previously lived as inline comments and docblocks — see
[`docs/FRONTEND.md` → Code structure rules, rule 6](../FRONTEND.md#code-structure-rules).

Trustee product intent lives in `docs/product-specs/` (see the Trustee panel note in
[`docs/FRONTEND.md`](../FRONTEND.md#application-structure)); this doc captures the frontend
*implementation* architecture.

> **Status:** migrated (#997, part of epic
> [#991](https://github.com/eq-lab/pipeline/issues/991)). Do not delete a source comment until its
> content lives in a section below. `lib/env.ts` and `routes/-loanDetailStatic.ts` keep their
> definition-site config/field docs by design (rule-6 compliant: short constraints at the
> definition, not flow narration).

## Dates

Every trustee calendar date renders in UTC through `@/utils/formatDate` (`formatMaturityDate`,
`formatEpochDate`, `formatSubmittedDate`, `formatIsoDateUtc`, `formatAuditTimestamp`,
`formatIsoDateTimeUtc`), never in the browser's zone (#1626). Maturity, origination and
next-payment values are entered as UTC midnight, so a US browser must not show `15 Dec` as
`14 Dec`. `formatSubmittedDate` is UTC too, so a "Submitted" day and a maturity day on one row use
the same calendar. The tests force `TZ=America/New_York` (`-formatDate-utc.test.ts`) so they fail
against a local-zone formatter even when CI runs in UTC.

## Audit Log

**Sources:** `packages/trustee/src/routes/audit-log.tsx` (view),
`packages/trustee/src/routes/-useAuditLog.ts` (presenter),
`packages/trustee/src/api/useAuditLog.ts` (data hook).
**Consumer route:** `/audit-log`. **Surface 17** of epic #775; issue #1004; Figma node
`4116:13770`.

Surface 17 is an append-only, reverse-chronological (newest-first) table — Time · Chain · Action ·
Loan / scope · Reference — of on-chain Trustee actions across every configured chain (#1599).

### Architecture

Follows the `loans.index.tsx` design language and the view/logic split of
[`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the `.tsx` view is JSX-only and
reads a single presenter hook, `useAuditLogView`.

- `useAuditLog` (`api/`) — React Query hook over `GET /v1/audit-log` with **no `chain_id`**
  (#1599, backend #1595): the API merges every configured chain newest-first and each item carries
  its `chain_id`; key `["audit-log", "all"]`, 30 s poll. Its DTOs are a self-contained hand-mirror
  of the backend shape (`packages/api/src/routes/audit_log.rs`, #1000) — TD-42 convention, the
  trustee app does not depend on `@pipeline/frontend`.
- `useAuditLogView` (`routes/-useAuditLog.ts`) — presenter. The feed is the **source of truth for
  state**; the loan book (`useLoanBook`, all chains) is **enrichment only**, keyed by
  `loanRowKey(chain_id, loan_id)` because loan ids repeat across chains (#1537): a loan-scoped row
  shows the friendly `"Originator — Commodity"` name for its own `(chain_id, loan_id)`, falling
  back to the server-supplied `scope.label` (`"Loan #<id>"` / `"Protocol"`) until the loan book
  loads or when the pair isn't in it. Each item maps to a display row: `formatAuditTimestamp` time
  (UTC), `targetChainLabel(chain_id)` ("Stellar" / "Hoodi" / `Chain <id>`), resolved scope label,
  and `reference` rendered **in full** — since #1094 it is the server's friendly loan name
  (`"<originator> — <commodity>"`), not a tx hash; `""` renders as `—` (#1599 fixed the
  `first6…last4` truncation that turned "Open Mineral — Copper Concentrate" into "Open M…trate").

### Scope — on-chain only (resolved with the issue author, #1004)

The endpoint serves on-chain events only: loan lifecycle, Minter cash, CollateralRegistry and
DealTokenFactory rows (#1595; no-op syncs filtered server-side), each with its server-rendered
`action` text. **Rows are exactly what the endpoint returns — never fabricated**
([[no-frontend-computed-metrics]]). Two consequences vs. the
Figma mock:

- The mock's off-chain rows ("Batch off-ramp co-signed", "Loan distributions wired (fiat)") and
  non-loan "Batch #B-102" scopes do **not** appear until the backend off-chain-audit follow-up
  lands (see the `audit_log.rs` header).
- The caption is adapted from the Figma copy (which promises fiat wire confirmations + MPC
  co-signatures "all land here") to describe what is actually served today — no over-claiming,
  matching the loans-page "never fabricate" precedent.

### Rendering (unpaginated feed)

`GET /v1/audit-log` returns the **full feed, not paginated**. The page bounds *rendering* — not the
payload:

- Render the newest `AUDIT_PAGE_SIZE` (50) rows; a "Show older (N more)" control reveals another
  page per click. A **visible** cap, never a silent truncation.
- The row is `memo()`-ised so the 30 s background poll does not re-render unchanged rows (TanStack
  Query structural-shares unchanged data → stable row identity).

Trimming the **payload** itself needs server-side `limit`/`cursor` pagination — backend follow-up
#1006. When it lands, "Show older" becomes a real `fetchNextPage` instead of revealing
already-downloaded rows.

### Figma → token / px mapping

Matches the `loans.index.tsx` precedent (raw Figma literals mapped to `--color-pipeline-*` tokens):

- Heading `font-display text-[64px] leading-[64px]`, `rgba(56,55,53,0.3)`.
- Card `bg-[--color-pipeline-surface] rounded-[4px] p-[32px]`.
- Header cells `14px` / ink-muted, `pb-[12px] px-[14px]`; the table draws borders **only** around
  the body box + inter-row separators (`LINE_COLOR` = `rgba(56,55,53,0.18)`, applied via inline
  `style` so it always paints regardless of Tailwind v4 utility ordering); the header row sits
  unbordered above the box.
- Body cells `16px`, `py-[20px] px-[14px]`: Time + Reference ink-muted, Chain + Action + scope
  `#262524` ink. Chain is a fixed 90px track after Time (no Figma — the #1536 Origination-table
  pattern). Reference lost its monospace tx-hash styling in #1599: it is a loan name and wraps
  like Action.
- Action + Loan/scope + Reference **wrap** (a deliberate deviation from the Figma's single-line
  `nowrap` cells): audit actions and loan names run long and must stay fully readable — never
  truncate served data.
- Caption `13px` / ink-muted, `leading-[18.2px]`, `pt-[16px]`.

## Cash Management — On/Off-ramp

**Sources:** `packages/trustee/src/routes/cash-management.tsx` (view — all tabs),
`routes/-cash-management.ts` (On/Off-ramp review-queue presenter), `routes/-cash-management-income.ts`
(Bank income, #1762), `routes/-ConversionsSection.tsx` (conversions block). Issue #943 (shell), #1762
(bank income), #1765 (conversions and bank charges), Figma node `4116-11802` for styling. Source of
truth: the user docs (`docs/user-docs/how-it-works/capital-layer.md`, `governance/fiduciary-trustee.md`,
`security/custody.md`) and `docs/product-specs/trustee-dashboard.md`
(§Type 2, §Type 4); on mismatch the user docs win, Figma is styling only. (No Refunds tab — the working
doc has no such section.)

### On/Off-ramp tab

Two parts:

1. The **conversions block** (#1765): a pool summary, the conversions list and the dialogs that book
   conversions and bank charges on the minter. Detail in
   [Conversions and bank charges](#cash-management--conversions-and-bank-charges). It replaces the old
   "New swap" MPC shell (`SwapDialog`), which is removed.
2. The **"Ramp-event review" queue** below it — the pending ramp-boundary events
   (`GET /v1/ramp/events`, #936) the Trustee Approves/Rejects (`POST …/review`). Events are split by leg
   into **inbound** (`OnRamp`, ramp→custody) and **outbound** (`OffRamp`, custody→ramp), matching the
   Figma's INBOUND/OUTBOUND sections. The DB approval is kept exactly as it was; whether it is retired is
   a separate backend decision.
   Cash Management is per-network (#1669): `useRampEvents` (`GET /v1/ramp/events?chain_id=`, key
   `["ramp-events", chainId]`) reads `useSessionState().chainId`, with `ENV.STELLAR_CHAIN_ID` only as the
   no-session fallback. The scope is explicit in the UI: a chain chip (`cash-management-ramp-chain`)
   beside the heading and the sub-line "{chain} — the network you signed in with. Book conversions between
   USDC and bank dollars, and bank charges, on the minter.". An unconfigured chain returns an empty queue,
   shown as the empty state. Each `RampEvent` carries `chain_id` (#1609); the review
   `POST /v1/ramp/events/{id}/review` takes the chain from the event, so it sends no query string. The body
   is `{decision}` for Approved and `{decision, reason}` for Rejected (a non-empty `reason` is required);
   success is `200` with no JSON body, and `useReviewRampEvent` then invalidates the `["ramp-events"]`
   prefix. Ramp addresses may be Strkeys or 0x hex, both truncated first-4/last-4.

**Data-sourcing:** everything shown in the review queue is real — the served `RampEvent`
(id/chain_id/type/to/from/amount/created_at). The Figma's richer per-loan tagging/batch grouping/progress
is not in the contract (#943) and is deliberately not fabricated.

### T-Bills tab (retired)

Retired by #1765: T-bills / USYC are not part of the documented pool (`capital-layer.md`).

**Tab deep link (#1887).** The route accepts `?tab=onofframp|income|withdrawals|escrow|wireouts`
(unknown values are dropped) and opens on that tab; switching tabs afterwards is local state. The
LP-counterparties lookup links to `?tab=escrow`.

### Bank income tab (#1762)

`routes/-cash-management-income.ts` (`useBankIncome`), `routes/-BankIncomeDialog.tsx`, `api/useRecordIncome.ts`. The tab shows the session chain chip (`useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`), "Bank interest booked by the Cash reporter is minted into the vault." and a **Book income** button. On an EVM session the button is disabled with "Booking bank income on {chain} is not available in the Trustee app yet." (TD-152).

- Dialog fields: Amount (USD, at most 2 decimals), Value date (`type="date"`, default and max today UTC, sent as UTC-midnight Unix seconds), Bank reference.
- Validation copy, in order: "Enter an amount greater than 0 with at most 2 decimal places.", "Enter the bank's reference for this income.", "Enter the value date.", "The value date cannot be in the future."
- Submit reasons, in order: wallet not connected "Connect your trustee wallet to book bank income.", minter not configured, then the Cash reporter reason for `record_income`.
- `ref_hash = sha256(reference.trim())` (same as the wire `reference_hash`). `ref_hash_seen` is read first; a seen hash fails with "This bank reference is already booked on-chain. Each bank record's reference can be used once." and no signature request. Other failures go through `toUserError` with details.
- Success closes the dialog and shows "Booked {amount} income, value date {date}. Transaction {hash}. It appears in the Audit Log once indexed." with a link to `/audit-log`. `["capital-allocation"]` and `["audit-log"]` are invalidated now and after 5 s and 15 s. No client-side "booked" flag is kept; the served `CashRecorded` is the record.

## Cash Management — Withdrawal Queue

**Sources:** `packages/trustee/src/routes/cash-management.tsx` (view — the Withdrawal Queue tab +
`WithdrawalTopUpDialog`), `packages/trustee/src/routes/-cash-management-withdrawals.ts` (presenter),
`packages/trustee/src/api/useWithdrawalQueue.ts` (data hook).
**Behavior source:** the working doc `Cash management.md` §"Withdrawal queue". **Design:** Figma node
`4116-13974` (the top-up MPC dialog). On mismatch the **doc** wins; Figma is styling only.
Issue #945; the third tab of the Cash Management page (shell #943), alongside the On/Off-ramp and
T-Bills swap forms.

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the tab and
dialog are JSX-only and read `useWithdrawalQueueView`.

- `useWithdrawalQueue` (`api/`) — React Query hook over
  `GET /v1/withdrawal-queue?chain_id=<session chain>`, key `["withdrawal-queue", chainId]`, 30 s
  poll. **Scoped to the chain the trustee signed in with (#1600).** Product rule: a page that
  aggregates across networks shows every chain; a per-network page follows the connected chain.
  Cash Management is per-network, so the hook reads `useSessionState().chainId` (the chain picked at
  sign-in, `auth/sessionStore.ts`; `ENV.STELLAR_CHAIN_ID` only as the no-session fallback) rather
  than omitting `chain_id` (since backend #1586 that means every configured chain) or hardcoding
  Stellar. The scope is explicit in the UI — a chain chip beside the tab heading and the sub-line
  "<chain> queue — the network you signed in with." — and items carry `chain_id`. The ramp tab follows
  the same rule (#1669).
  A self-contained hand-mirror of the backend shape
  (TD-42; the trustee app does not depend on `@pipeline/frontend`, whose `useWithdrawalQueue` reads
  the same endpoint). `in_queue_usd` (valued at the queue's recovery rate)/`amount` are base-6 decimal strings in human units — format
  with `@/utils/formatUsd`.
- `useWithdrawalQueueView` (`-cash-management-withdrawals.ts`) — presenter; `chainLabel` =
  `targetChainLabel(chainId)` from the hook's resolved chain.

### Scope — visual-only shell (served vs. `—`)

Same "build the shell now, backend later" decision as the swap forms (#973/#983). Render **exactly
what is served**, never fabricated ([[no-frontend-computed-metrics]]):

- **Total claimable** (`in_queue_usd`, the doc's `totalClaimable`) and **request count**
  (`requests_count`) are served → shown.
- The doc also wants the **WithdrawalQueue wallet balance** (`USDC.balanceOf(WithdrawalQueueWallet)`),
  but the endpoint does not serve it → `walletBalanceDisplay = "—"`.
- **Top-up alert:** the doc shows it when `balance < totalClaimable + reserve`. Because the balance
  is unserved, that comparison can't be made — so `needsTopUp` is always `false` and the alert is
  **never fabricated** from missing data.
- The **top-up transfer** is a Capital-Wallet MPC action (3-of-5, Type 2, flow 9) with no backend
  path yet (#781) — the dialog's signature rows are static "not signed" and `Co-sign in MPC` is
  disabled. Coverage-after / oldest-pending have no served source → `—`.

Deferred backend (not blocking the UI): the WithdrawalQueue-wallet balance read + the Type-2
Capital-Wallet MPC assembly (#781).

### Figma → token / px mapping (top-up dialog, `4116-13974`)

Same design language as the sibling swap dialogs. Card `bg-white rounded-[6px] px-[30px] py-[28px]
w-[640px]`, `shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]`. Title Besley `26px/36.4px` `#262524`;
subtitle `14px` ink-muted. Summary rows `border-b LINE_COLOR pb-[13px] pt-[12px]`, label `15px`
ink-muted / value `16px` `#262524` right-aligned (Amount is a right-aligned input — the doc has the
Trustee specify it). Signature collection header `12px` uppercase `tracking-[0.96px]`; signer rows
a `9px` dot + name `15px` + optional `mandatory` chip + right-aligned "not signed" `13px`. Buttons
`h-[40px]`: Cancel white-bordered, Co-sign `BRAND` (disabled).

## Cash Management — Escrowed wires

**Sources:** `packages/trustee/src/routes/-EscrowedWiresSection.tsx` (view — tab, `AssignWireDialog`,
`ReturnWireDialog`), `-escrowed-wires.ts` (section hook), `lib/wireEscrow.ts` (copy and presenters),
`api/useCashBook.ts`, `api/useEscrowedWires.ts`, and `packages/wallet-connect/src/stellar/contracts/wireInEscrow.ts`.
**Spec:** [deposits.md §Escrowed Wires](../product-specs/deposits.md#escrowed-wires). Issue #1763, the
fourth tab of the Cash Management page. No Figma: it reuses the page's card, table and chip patterns
and the dialog shell of `MintConfirmDialog` (`useLpReviewDialog`).

### Chain scope

Per-network: the chain is `useSessionState().chainId` (`ENV.STELLAR_CHAIN_ID` only with no session), shown
as a chip (`cash-management-escrow-chain`) and the sub-line "Unmatched incoming wires held by the minter
on {chain} — assign each to its lender or return it." An EVM session renders "Escrowed wires on {chain}
are not available in the Trustee app yet." and fetches nothing (the API serves no EVM cash book; the
EVM write client from #1942 has no cash-management bindings yet).

### Data sourcing

- `useCashBook(chainId, { enabled, refetchMs })` — `GET /v1/cash-book?chain_id=`, key
  `["cash-book", chainId]`, the full served response (#1764 and #1765 reuse it); no retry on a 4xx.
  Refetch is 30 s, or 5 s while a row is `*-pending-index`, bounded to 120 s per row.
- Rows are `wire_ins` whose served `status === "Escrowed"`, in served order. Nothing is derived
  client-side. `amount` is shown verbatim with its 6 decimals (`formatUsdExact`).
- Each row is confirmed by `readMinterWireIn` (`wire_in(id)`, key `["minter-wire-in", minterId, id]`,
  stale time 0). The cash book's `minter` must equal `ENV.STELLAR_YIELD_MINTER_ID`, otherwise every action
  is disabled.

### Table

Columns: wire `#id`, amount, value date, bank reference hash (first 8 / last 8, full value in `title`),
recorded at (`formatIsoDateTimeUtc`), on-chain status, actions. States: loading skeleton, `InlineError`
(`404 minter_not_configured` -> "The cash book is not configured for {chain} on this server.", `403`,
`401`), empty "No incoming wires are in escrow."

### Row states and gating

On-chain label: "Escrowed (confirmed on-chain)", "Assigned on-chain — waiting for the indexer",
"Returned on-chain — waiting for the indexer", "On-chain status {s} differs from the cash book",
"Could not confirm on-chain". Actions (`Assign to lender`, `Return`) are disabled with a visible reason
(`escrow-row-{id}-reason`), first match wins: wallet not connected; minter or AccessManager not
configured; minter mismatch; role (`can_call(wallet, minter, fn)` must be `immediate`, via
`useWireEscrowAccess`; a delayed grant gets a reason and no schedule path); on-chain state not
`confirmed`; another action in flight.

### Assign dialog

Wire summary, an LP select (`useLps`, only LPs with `stellar_address` and `address_linked_at`, sorted by
name, "{legal_name} — {truncated address}"), the full receiver address and the authorisation result
(`PLUSD.authorized`; "This lender's address is not authorised to hold PLUSD. It cannot receive this
wire." / "This lender's address has no PLUSD trustline."). Confirm is enabled only when authorised. On
confirm, before signing: re-read `fetchLp` (a changed settlement address returns to the select with a
notice), re-read `wire_in(id)` (not `Escrowed` aborts), re-read the authorisation. Then
`AM.execute(minter, assign_wire_in, [id, receiver])`.

### Return dialog

Wire summary and an "Outgoing bank reference" input (trimmed, non-empty, at most 140 characters); the
computed `ref_hash` shows read-only. On confirm, before signing: `ref_hash_seen` (true shows "This bank
reference is already recorded on-chain. Use the outgoing wire's own reference."), then re-read
`wire_in(id)`. Then `AM.execute(minter, return_wire_in, [id, ref_hash])`.

### Shell, errors and result

Escape and backdrop cancel and never confirm; both are blocked while a step is pending, and the confirm
label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…"). Errors show inline with
"View details". Pre-sign on-chain reads carry the specific copy; `wireEscrowErrorCopy` maps contract codes
only as a fallback (`#7` / `RefHashSeen` on return, `#15` on assign, `#14` not in escrow, `#9` unknown
wire) and keeps the wallet-rejection copy. After the transaction lands the app re-reads `wire_in(id)` and
shows a green notice built from that read: "Wire #{id} assigned on-chain to {legal name} ({receiver}).
Status {status}. Transaction {hash}. It leaves this list once indexed." or "Wire #{id} returned on-chain.
Status {status}, return reference {ref}. Transaction {hash}. It leaves this list once indexed."

### Testnet caveat

No escrowed wire exists on testnet: BUG-32 (logged with #1762) blocks `record_wire_in(receiver = minter)`
because the minter lacks the PLUSD `MINTER` role. `return_wire_in` burns PLUSD and may also fail until
the minter holds the burn role. Both are live-testing risks, covered by unit tests meanwhile. The
capital-wallet fallback of Mint PLUSD is unaffected (decision 2026-11-02).

## Cash Management — Bank wire-outs

**Sources:** `packages/trustee/src/routes/-WireOutsSection.tsx` (view — tab, `SettleWireOutDialog`,
`CancelWireOutDialog`), `-wire-outs.ts` (section hook), `lib/wireOut.ts` (copy and presenters),
`api/useWireOuts.ts`, `api/useCashBook.ts`, `api/useEscrowedWires.ts` (`useMinterPlusdId`,
`ensureMinterPlusdId`), and `packages/wallet-connect/src/stellar/contracts/wireOutSettlement.ts`.
**Spec:** [withdrawals.md §Bank wire withdrawals (Trustee console)](../product-specs/withdrawals.md#bank-wire-withdrawals-trustee-console).
Issue #1764, the fifth tab of the Cash Management page. No Figma: it reuses the Escrowed wires table,
chip and dialog patterns (`useLpReviewDialog`). The `// spec:` pointers of the bindings, hooks and view
files target this section and the withdrawals spec section above.

### Chain scope

Per-network: the chain is `useSessionState().chainId` (`ENV.STELLAR_CHAIN_ID` only with no session),
shown as a chip (`cash-management-wireouts-chain`) and the sub-line "Lender bank withdrawals held in
escrow by the minter on {chain} — settle once the wire is sent, or cancel to return the PLUSD." An EVM
session renders "Bank wire-outs on {chain} are not available in the Trustee app yet." and fetches nothing
(no EVM cash book is served; the EVM write client from #1942 has no cash-management bindings yet).

### Data sourcing

- `useCashBook` (shared with Escrowed wires) — every served `wire_outs[]` row, in served order. Refetch is
  30 s, or 5 s while a row is `*-pending-index`, bounded to 120 s per row.
- The lender name is the served `lp_legal_name` ("—" when absent), resolved server-side from the LP link
  active at `requested_at`; `lp_id` links to `/lp-counterparties/{id}`. The app joins nothing.
- Amounts, dates, statuses and hashes are shown as served (amount grouped with a "PLUSD" suffix, no
  rescaling). Only `Pending` rows are read on-chain: `readWireOutRecord` (`wire_out(id)`, key
  `["minter-wire-out", minterId, id]`, stale time 0). The cash book's `minter` must equal
  `ENV.STELLAR_YIELD_MINTER_ID`, otherwise every action is disabled.
- `bank_account` is served on `Pending` rows that resolved to an LP with an account, and is shown as
  served ([Settlement bank account](#settlement-bank-account), #1886). It is the LP's current account, so
  Settled and Cancelled rows never show it.

### Table

Columns: ID, Lender (name link plus address chip), Amount, Requested at, Status, On-chain, Actions.
`Settled` rows add the served `settled_at`, `value_date` and `ref_hash` (first 8 / last 8, full value in
`title`); `Cancelled` rows add `cancelled_at`. On a `Pending` row with a served account the Lender cell adds
a "Show bank account" / "Hide bank account" toggle (`wireout-row-{id}-bank-toggle`, collapsed by default)
that expands a full-width sub-row (`wireout-row-{id}-bank`) with the account; a resolved lender without one
gets the attention chip "No bank account on file" (`wireout-row-{id}-no-bank-account`). The row carries the
account because the bank wire is sent before settling, when Settle is often disabled. States: loading skeleton, `InlineError` (`404
minter_not_configured`, `403`, `401`, as Escrowed wires), empty "No bank wire-outs on {chain}."

### Row states and gating

On-chain label (Pending rows only): "Pending (confirmed on-chain)", "Settled on-chain — waiting for the
indexer", "Cancelled on-chain — waiting for the indexer", "On-chain status {s} differs from the cash
book", "Could not confirm on-chain". `Settle` and `Cancel` appear only on `Pending` rows and are disabled
with a visible reason (`wireout-row-{id}-reason`), first match wins: wallet not connected; minter or
AccessManager not configured; minter mismatch; role (`can_call(wallet, minter, fn)` must be `immediate`,
via `useWireOutAccess`; a delayed grant gets a reason and no schedule path); on-chain state not
`confirmed`; another action in flight.

### Settle dialog

Summary (wire-out id, lender, address, requested amount, requested at), then "Destination bank account":
the served account (`wireout-settle-bank-*`); or "—" plus the attention warning "No bank account on file for
this lender. Do not send a wire until one is added; cancel the request to return the PLUSD."
(`wireout-settle-no-bank-account`); or, with no resolved lender, "—" plus "This wire-out is not linked to a
lender, so no bank account is served." A missing account warns but never blocks Settle. Inputs:
"Amount wired (PLUSD)" pre-filled with the exact on-chain 7-decimal amount, "Value date" (UTC, not in the
future, defaults to today) and "Outgoing bank reference" (trimmed, 1 to 140 characters); the computed
`ref_hash` shows read-only. The minter settles only the full requested amount, so an amount that differs
is blocked with "The minter settles only the full requested amount ({amount} PLUSD). If a different amount
was wired, cancel this request instead." On confirm, before signing: `ref_hash_seen` (true shows "This bank
reference is already recorded on-chain. Use the outgoing wire's own reference."), then re-read
`wire_out(id)` (not `Pending` aborts; the fresh on-chain amount is checked again). Then
`AM.execute(minter, settle_wire_out, [id, amount_raw, value_date, ref_hash])`, where `amount_raw` is the
on-chain i128 and `value_date` is the UTC midnight in Unix seconds.

### Cancel dialog

Summary and "The escrowed PLUSD returns to the lender's address." On open the app reads
`PLUSD.authorized(lp)`: authorised enables confirm; not authorised shows "This lender's address is not
authorised to hold PLUSD, so the PLUSD cannot be returned. Cancel is blocked until it is authorised
again."; no trustline shows "This lender's address has no PLUSD trustline."; a failed read shows "Could
not check the lender's PLUSD authorisation." with details. On confirm the app re-reads `wire_out(id)` and
the authorisation, then calls `AM.execute(minter, cancel_wire_out, [id])`.

### Shell, errors and result

Escape and backdrop cancel and never confirm; both are blocked while a step is pending, and the confirm
label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…"). Errors show inline with
"View details". Pre-sign on-chain reads carry the specific copy; `wireOutErrorCopy` maps contract codes
only as a fallback (`#7` / `RefHashSeen`, `#17`, `#8` on settle; `#16` on cancel; `#14` not pending; `#10`
unknown id) and keeps the wallet-rejection copy; `details` always holds the raw contract error. After the
transaction lands the app re-reads `wire_out(id)` and shows a green notice built from that read:
"Wire-out #{id} settled on-chain. Status {status}; the escrowed PLUSD was burned. Transaction {hash}. It
updates in this list once indexed." or "Wire-out #{id} cancelled on-chain. Status {status}; the PLUSD was
returned to {lp}. Transaction {hash}. It updates in this list once indexed."

### Testnet caveat

No wire-out exists on testnet (`wire_out(0..6)` answers `#10` on both minters): settle and cancel can be
exercised live only after a lender calls `request_wire_out` (LP UI #1757). `bank_cash` on the API minter
`CD2LPGLX…` is 0, so settling there fails `#8` until wire-ins are booked. When the app's minter
(`VITE_STELLAR_YIELD_MINTER_ID`) differs from the cash book's, every action is disabled (env alignment,
not code). Unit tests cover the flows meanwhile. The bank-account views follow the same rule (#1886).

## Cash Management — Conversions and bank charges

**Sources:** `packages/trustee/src/routes/-ConversionsSection.tsx` (view — pool summary, table,
`OpenConversionDialog`, `CloseConversionDialog`, `RecordExpenseDialog`), `-conversions.ts` (section
hook), `lib/conversions.ts` (copy and presenters), `api/useConversions.ts`, `api/useCashBook.ts`, and
`packages/wallet-connect/src/stellar/contracts/minterRamps.ts`. **Spec:**
[trustee-dashboard.md §Type 2](../product-specs/trustee-dashboard.md) flows 8 and 9, and the user docs
(`capital-layer.md` cash-book rows "USDC to USD or USD to USDC conversion" and "Bank charges", both
Trustee). Issue #1765, inside the On/Off-ramp tab. No Figma: it reuses the #1763/#1764 card, table, chip
and `useLpReviewDialog` patterns. The `// spec:` pointers of the bindings, hooks and view files target
this section. Custody accounts sign their own USDC moves; the console never co-signs, it only books.

### Chain scope

Per-network: the chain is `useSessionState().chainId` (`ENV.STELLAR_CHAIN_ID` only with no session),
shown as a chip (`cash-management-conversions-chain`). An EVM session renders "Conversions and bank
charges on {chain} are not available in the Trustee app yet." and sends no `/v1/cash-book` request and
makes no `pool_state`, `paused` or `ramp` read (no EVM cash book is served; the EVM write client from
#1942 has no cash-management bindings yet).

### Pool summary

Three tiles: "Booked bank cash", "Cash in transit" and "Pool total", from one `pool_state()` read of the
minter the console signs against (`ENV.STELLAR_YIELD_MINTER_ID`, key `["minter-pool-state", minterId]`,
refetch 30 s). The raw 7-decimal `bank_cash`, `in_flight` and `total_assets` are shown exactly as
`formatUsdExact(rawToDecimal7(raw))`, never rescaled or derived. A caption reads "Read on-chain from the
minter {truncated id} (pool_state)."; `read_failed` adds "A custody balance could not be read; the minter
counts it as 0 in the pool total.". The cash book is not the source because `GET /v1/cash-book` serves
`summary.bank_cash` and `in_flight` but not `total_assets`; all three figures come from one ledger and one
minter (TD-180 moves the summary to the API once it serves `total_assets`). A failed read shows "Could not
read the minter's pool state." with details and Retry.

### Data sourcing

- `useCashBook` (shared with Escrowed wires and Bank wire-outs) — every served `ramps[]` row, in served
  order. Refetch is 30 s, or 5 s for 120 s after an open or close.
- Each served `Open` row is confirmed on-chain with `readMinterRamp` (`ramp(id)`, key
  `["minter-ramp", minterId, id]`, stale time 0). `Closed` rows are not read.
- Amounts, dates, statuses and hashes are shown as served (`formatUsdExact`, no rescaling). The shortfall
  is the served `loss`, which the API takes from the contract's `RampClosed` event; it is never computed
  as `amount − received`. A missing `received`, `loss` or `closed_at` renders "—".
- Ramp ids start at 0 (`next_id` returns 0 first); the bindings accept 0.

### Table

Columns: ID, Direction ("USDC → USD" / "USD → USDC"), Amount, Opened at, Reference hash (open and close,
first 8 / last 8, full value in `title`), Status (Open / Closed chip), Received, Shortfall, Closed at,
On-chain, Actions. States: loading skeleton, `InlineError` (`404 minter_not_configured`, `403`, `401`, as
Escrowed wires), empty "No conversions on {chain}.". Test ids are `ramp-row-{id}-…`.

### Row states and gating

On-chain label (Open rows only): "Open (confirmed on-chain)", "Closed on-chain — waiting for the
indexer", "On-chain status differs from the cash book", "Could not confirm on-chain". Every action is
disabled with a visible reason (`conversion-open-reason`, `expense-open-reason`,
`ramp-row-{id}-reason`), first match wins: wallet not connected; minter or AccessManager not configured;
minter mismatch (the cash book's `minter` must equal `ENV.STELLAR_YIELD_MINTER_ID`, so the cash book must
be loaded for every action); role (`can_call(wallet, minter, fn)` must be `immediate` for `open_ramp`,
`close_ramp` and `record_expense`, via `useConversionAccess`; a delayed grant gets a reason and no
schedule path); then, per action, **Open** needs `paused() === false` ("The minter is paused;
conversions cannot be opened.") and **Close** needs the row's on-chain state `confirmed`; last, another
action in flight. Only `open_ramp` is pause-gated on the contract; close and record stay available while
paused.

### Open dialog

Button "Open conversion". Inputs: a direction ("USDC → USD" = `UsdcToBank`, "USD → USDC" = `BankToUsdc`,
radio group), "Amount (USD)" (up to 7 decimals) and "Transfer reference" (trimmed, 1 to 140 characters);
`ref_hash = sha256(reference.trim())` shows read-only. USDC → USD explains "Books USDC sent from custody
to the bank as cash in transit. The custody balance must cover it."; USD → USDC "Takes the amount out of
booked bank cash into cash in transit." On confirm, before signing: `ref_hash_seen` (true shows "This bank
reference is already recorded on-chain. Use the outgoing wire's own reference."), then `paused()` re-read,
then `AM.execute(minter, open_ramp, [direction, amount_raw, ref_hash])`. The direction encodes as
`scvVec([scvSymbol(name)])`. The relay returns only the transaction hash, so the notice says "Conversion
opened on-chain ({direction}, {amount}). Transaction {hash}. It appears in the list once indexed." with no
id.

### Close dialog

Row action "Close" on an `Open` row. Opening the dialog reads `ramp(id)`; confirm is enabled only while
the ramp is open on-chain. It shows the opened amount from the cash book and from the chain. Inputs:
"Amount received" (empty by default, `0` allowed) and "Closing reference". Fixed copy: "Any shortfall
between the opened amount and the amount received is booked by the contract as an expense and absorbed by
the vault." Received above the on-chain opened amount is blocked ("The amount received cannot exceed the
opened amount ({amount})."). On confirm: `ref_hash_seen`, then `ramp(id)` re-read (closed aborts), then
`AM.execute(minter, close_ramp, [id, received_raw, ref_hash])`. The notice is built from a re-read:
"Conversion #{id} closed on-chain. Received {received}; any shortfall is booked as an expense and shows in
this list once indexed. Transaction {hash}." The served `loss` appears in the list once indexed.

### Record bank charge dialog

Button "Record bank charge". Inputs: "Charge amount (USD)", "Value date" (UTC date, not in the future,
defaults to today) and "Bank reference" (trimmed, 1 to 140 characters). On confirm: `ref_hash_seen`, then
`AM.execute(minter, record_expense, [delta_raw, value_date, ref_hash])`, where `value_date` is the UTC
midnight in Unix seconds. The amount is taken out of booked bank cash and burned from the vault. The
notice "Bank charge of {amount} booked on-chain, value date {date}; it was burned from the vault.
Transaction {hash}. It appears in the Audit Log once indexed." links to `/audit-log` (`CashRecorded`);
the cash book lists no cash entries.

### Shell, errors and result

Escape and backdrop cancel and never confirm; both are blocked while a step is pending, and the confirm
label follows the stage ("Awaiting signature…" / "Submitting…" / "Confirming…"). Errors show inline with
"View details". Encoders refuse the all-zero reference hash, because the contract skips it silently.
`conversionErrorCopy` maps contract codes: `#7` / `RefHashSeen` (reused reference), `#1000` /
`EnforcedPause` (open), `#8` (bank cash below the amount), `#18` (open: custody USDC below the amount),
`#19` (received above the opened amount), `#20` (already closed), `#11` (unknown id), `#6` (amount not
positive). `#2` collides with the minter's `SameValue` and is left unmapped, so it shows the generic
message with the raw details; `details` always holds the raw contract error. The wallet-rejection copy is
kept.

### Testnet caveat

No ramp exists on testnet (`ramp(0..8)` answers `#11` on both minters). USDC → USD fails `#18` on both
minters (custody USDC is 0). On the API minter `CD2LPGLX…`, USD → USDC and bank charges fail `#8`
(`bank_cash` is 0). On the app minter `CAPL5WN3…`, USD → USDC opens (id 0), but `record_expense` and a
close with a shortfall fail inside the vault's `pull` with the vault's own `#2`; a full-amount close does
not touch the vault. When the app's minter differs from the cash book's, every action is disabled (env
alignment, not code). Unit tests cover the flows meanwhile.

## Loan book & tables

**Sources:** `packages/trustee/src/api/useLoanBook.ts` (data hook),
`packages/trustee/src/routes/-useLoansTable.ts` (presenter),
`packages/trustee/src/routes/loans.index.tsx` (view).
**Consumer route:** `/loans`. Issue #843, Figma node `4116:9989`; amount scaling fixed by #906;
CCR replaced by the Stellar security LTV in #1906.

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the `.tsx`
route is JSX/styling only; `useLoansTable` owns the `useLoanBook` call, the summary-card
view-model, the per-row mapping, the LTV cell, and the client-side status filter — mirrors
`-useOriginationTable.ts`.

- `useLoanBook(chainId?)` (`api/`) — React Query hook over `GET /v1/loan-book`, 30 s poll. No
  `chain_id` by default (#1537: every configured chain, `summary` server-computed over the union,
  each row carrying its own `chain_id`); the Loans page's **chain filter** ("All chains" plus the
  served `TARGET_CHAINS` from `useServedTargetChains`, #1667 — disabled with only "All chains"
  while loading, env list on request failure) passes a configured id so the narrowing — and the summary tiles —
  stay server-side (no client-side recomputation, [[no-frontend-computed-metrics]]). Query key
  `["loan-book", chainId ?? "all"]`; `invalidateQueries({ queryKey: ["loan-book"] })` prefixes hit
  every variant. Loan ids repeat across chains, so the row key is `` `${chain_id}:${loan_id}` ``
  (`loanRowKey`, `lib/loanRoute.ts`) and the row-click navigation carries
  `search: { chain: row.chainId }`. A **Chain** column (90px, after Originator, no Figma — the
  #1536 Origination-table pattern) shows `targetChainLabel(chain_id)`. A self-contained hand-mirror
  of the backend shape
  (`packages/api/src/routes/loan_book.rs`, post-#833/#834) — TD-42 convention, a fourth
  hand-mirroring pair alongside the existing trustee/LP ones (see
  `docs/exec-plans/tech-debt-tracker.md`); the trustee app deliberately does not depend on
  `@pipeline/frontend` (epic #775 keeps the two apps separate). The LP frontend's own
  `packages/frontend/src/api/useLoanBook.ts` predates the Trustee-only summary fields below and is
  **not** extended with them — only this trustee copy carries them.
- `useLoansTable` (`routes/`) — presenter.

### Data scale — registry-sourced amounts served as-is (#906)

`deployed_senior`, `at_risk_wl_and_default_senior` and per-loan `senior_outstanding`/`principal`
are **registry-sourced** base-6 decimal strings, already in human
units (e.g. `"1200000.000000"` = $1.2M). The former ×1000 workaround
(`scaleRegistryAmount`/`formatRegistryCompactUsd`/`formatRegistryCompact2dpUsd`, issue #840) has
been removed (#906) — render via plain `formatCompactUsd`/`formatCompactUsd2dp`.

`at_risk_wl_and_default_pct` mixes a registry-scaled numerator with a correct-scale NAV
denominator; rendered as served (no frontend correction is defined for it).

### Resolved Open Questions (#843, corrected by #888)

1. **Retired by #1906 — the Trustee no longer reads CCR.** (History: CCR was used AS SERVED, no ÷1000 correction.) #843 originally assumed `collateral` was
   price-feed correct-scale while `senior_outstanding` was registry-sourced (1000× too small,
   #840), which would make the served `ccr_bps` exactly 1000× too big. A live payload (#888)
   disproved that: `collateral` is **also** registry-sourced, on the same scale as
   `senior_outstanding` — so the ×1000 cancels out of the ratio and the served `ccr_bps` is
   already the true CCR. The former `correctCcrBps` ÷1000 helper (which silently rendered CCR
   1000× too small — e.g. 0.21% instead of the true 209.87%) has been removed. The 120%
   maintenance-margin pre-default threshold applied directly to the served `ccr_bps`.
2. **Default & Closed tabs render per Figma.** `/v1/loan-book` serves closed loans in `loans[]`
   with status `Closed` (verified on staging, #1092 — the earlier "excluded backend-side" note is
   outdated for Closed; Default remains unverified), excluded only from the active-set
   aggregates. Client-side status filtering populates the Closed tab as loans close.
3. **The "Payments due" banner + "Record coupon" action are omitted** from this page — no
   `/v1/loan-book` data source (never fabricate).

### Never-fabricate defaults (exec-plan RISK 3)

Figma details with no backend field are dropped, not invented:

- Stage cell: the served `status` label only (`Performing` displays as **Active**, #1119) — no
  "· Risk Council" / "· feed stale" qualifier.
- LTV cell: the served `ltv_bps` only. A Stellar row with no snapshot, or a loan-book that does not
  carry the key yet, shows `—`; an EVM row renders its served value like a Stellar row (#1942).
  Nothing is computed from other columns.

Every field is read defensively → `—`, never fabricated.

### LTV column & tab mapping

- **LTV column** (#1906, replaces the CCR and Collateral columns and the Spot sub-line). Backend
  #1786 phase 1 adds three flat fields to every `loans[]` entry, always present and `null` when not
  served (chains without a SecurityRegistry, no snapshot yet): `ltv_bps`
  (verbatim from the stored snapshot; `4294967295`, the `u32::MAX` sentinel, means debt with no
  counted value and shows as "No security value"), `margin_call_open`
  (`security_terms.margin_call_at != 0`, `false` for a `Closed` loan, #2076) and `price_stale` (the contract's snapshot flag). The
  frontend reads each with `?? null`, so it also works while the keys are absent (this issue
  deploys before #1786). The column is **hidden** unless at least one
  row, Stellar or EVM (#1942), has a non-null `ltv_bps` or `margin_call_open === true`; the footnote
  shows only with the column. The cell value is red when `margin_call_open`; the sub-line shows "Margin call" (red)
  and/or "Price stale" (amber). There are no frontend bands or thresholds and no per-loan ratios in
  the list — the loan-detail Security card shows the ratios from `/security`.
- **Tab → status mapping:** an unfiltered **All** tab is first and the landing default (#1121) —
  it lists every loan in the book, and its count is the total row count. The backend serves
  `"WatchList"` (capital L); the tab reads
  `"Watchlist"` (Figma casing). The served `"Performing"` status displays as **Active** (#1119):
  the **Active** tab holds `"Performing"` plus **`"Disbursing"`** — a backend-derived,
  Performing-family display status (off-ramp not yet complete, #862) — so freshly-drawn loans
  surface there instead of vanishing from every tab. **Watchlist** groups the
  at-risk set: WatchList plus past-maturity loans (served `"Past Due"`, legacy `"Matured"`) —
  otherwise a matured loan would match no tab and disappear from the list (#867).
- **Nearest payment** (#941/#953): `next_payment_timestamp` is the rollover-aware maturity (for
  today's bullet loans this equals the current maturity, but it's a distinct field so the
  schedule can diverge later without a breaking change). Server-computed `days_overdue` non-null
  → "N days late" / "Due today"; otherwise the payment date; missing/zero timestamp → `—`.
- **Top concentration:** `CONCENTRATION_LIMIT_PCT = 10` is a frontend-owned policy limit (per the
  backend doc: "the policy limit is frontend-owned"), paired with the served
  `top_concentration.share`.

### Figma → token / px mapping (Loans page, `4116:9989`)

Follows the Origination-page precedent (raw literals mapped to `--color-pipeline-*` tokens,
one-offs documented):

- Heading `font-display text-[64px] leading-[64px]`, `rgba(56,55,53,0.3)` (ink-subtle, exact) —
  identical to the Origination h1.
- Summary card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]
  px-[21px] py-[19px]`. Label `Inter 12.5px` ink-muted; value `Besley 26px` ink; sub `Inter
  12.5px` ink-muted, `pt-[6px]`.
- Colours: `NEGATIVE_RED` `#b20000` is a documented one-off (**not** `--color-pipeline-negative`
  `#c0392b`) that matches the Figma exactly, same precedent as the Origination pills' alpha
  one-offs; used for the At-risk headline value, an overdue Nearest payment and an open margin call.
  `ATTENTION_AMBER` `#6e6400` marks a stale price.
- Tab-bar `bg rgba(191,189,187,0.12)`, `LINE_COLOR` border, `p-[4px] gap-[2px] rounded-[4px]`;
  buttons `px-[16px] py-[9px] gap-[8px]`; active `bg-white` + ink text, inactive ink-muted; count
  `14px` ink-muted.
- Table card `bg-white pt-[36px] pb-[32px] px-[32px] rounded-[4px]`. Header cells `Inter 14px`
  ink-muted, `pb-[12px] px-[14px]` (reuses the Origination `HEADER_CELL_CLASS` convention); the
  table draws borders **only** around the body box + inter-row separators (`LINE_COLOR`), no
  column dividers — the header row sits unbordered above the box (Origination precedent). Body
  cells `Inter 16px` `#262524`; originator semibold; stage + chevron ink-muted; LTV `Bold 16.5px`
  with a `12.5px` flag sub-line.
- Senior outst. renders two-decimal compact (`formatCompactUsd2dp`), a deliberate deviation from
  the Figma (which shows full dollars `$1,840,000`). Columns: Originator, Chain, Commodity, Senior
  outst., [LTV], Nearest payment, Stage; the grid uses two track templates (with and without LTV).
- Footnote (`loans-footnote`) `Inter 13px` ink-muted, `leading-[18.2px]`, plain text, rendered only
  with the LTV column: "LTV = amount owed (outstanding principal plus accrued interest) / security
  value, from the Stellar security registry. A margin call opens above the loan's margin-call
  ratio. Stellar loans only."

## Loan detail

**Sources:** `packages/trustee/src/routes/-useLoanDetail.ts` (presenter),
`packages/trustee/src/routes/loans.$id.tsx` (view), `routes/-loanDetailStatic.ts` (static action
config), `routes/-loanSecurity.ts` (Security card presenter), `routes/-loanSecurityRecords.ts` +
`routes/-SecurityRecordsCard.tsx` (Security records card presenter and view),
`packages/trustee/src/components/detail/` (hero, chip, card, key/value row, tokens).
**Consumer route:** `/loans/$id`. Issues #845/#847, Figma node `4116:10549`.

Since #1453 the hero, status chip, card shell, card title and key/value row are **not** defined
here — they live in [`components/detail/`](#shared-detail-primitives) and are shared with the LP
counterparty detail page. `loans.$id.tsx` keeps only what is loan-specific (lifecycle stepper,
summary tiles, security, registry, other-actions, dialogs).

### Architecture

View/logic split per rule 2: `useLoanDetail` owns the live fetches, the value→display mapping,
and the composition of live data + static actions, so the builders are unit-testable without a
DOM (mirrors `-useLoansTable.ts`).

**Data sources:**

- **Hero identity** ← the matching `/v1/loan-book` row (originator, commodity, on-chain status),
  keyed by `(chain_id, loan_id)` (`findLoanEntry`, `lib/loanRoute.ts`, #1537). The chain comes
  from the route's validated `chain` search param (`parseLoanRouteSearch`: a positive integer,
  else `DEFAULT_TARGET_CHAIN_ID` = Stellar, so pre-#1537 URLs still resolve); the same param is
  carried by every link into `/loans/$id`, `/loans/$id/record-coupon`,
  `/loans/$id/record-repayment` and `/risk-council/{escalate,reterm,writedown}/$id`, and every
  per-loan hook (`useLoanSecurity`, `useLoanFinancials`, `useLoanWaterfall`,
  `useCompleteDisbursement`) takes it as its first argument and sends it as `chain_id`. The status
  bar carries no dates (maturity is a key number, not a status
  field — design assignment §S5); the chip maps the raw on-chain status via `statusToChip` (§3.2).
- **Security** ← `GET /v1/loan-book/{loan_id}/security?chain_id=` (`useLoanSecurity`, Stellar loans
  only, #1906) — see [Security card](#security-card).
- **Loan-lifecycle stepper** ← derived from the on-chain status (`buildLifecycle`); no longer a
  static fixture (design assignment §3.2).
- **Registry state & derived** ← `GET /v1/loan-book/{loan_id}/financials` (`useLoanFinancials`,
  #852), plus the loan-book row's `protection` for the Protection row (#1014).
- **Summary tiles** ← the matching `/v1/loan-book` row plus `/financials` for unminted
  yield / epoch APY (#874).
- **Documents** ← the matching `/v1/loan-book` row's `documents` array (#1040) — see
  [Documents](#documents).
- **Action availability / explanatory copy** ← static product configuration in
  `-loanDetailStatic.ts`.

### Never-fabricate ([[no-frontend-computed-metrics]])

The Security card shows only what `/security` serves, verbatim; the old Price & collateral fixture
rows are gone:

- no spot line, quantity or collateral value — the removed `/valuations` and `spot_change_7d`
  have no replacement;
- no CCR trend — no LTV time series is served, so none is drawn;
- an absent value is `—`, never a computed one. The one comparison made in the frontend is the
  loan's served LTV against that loan's own served terms (`advance_ratio_bps`,
  `margin_call_ratio_bps`).

### Status chip mapping (design assignment §3.2)

`statusToChip` maps the raw on-chain status to a display chip + colour band:

| on-chain status | chip label | band |
|---|---|---|
| `Performing` | Active (#1119) | positive |
| `Disbursing` | Disbursing | info (brand) |
| `Watchlist` / `WatchList` | Watchlist | attention |
| `Past Due` / `Matured` (legacy) | Matured | attention |
| `Default` | Default | negative |
| `Closed` | Closed | neutral |
| unknown | raw string verbatim | neutral |

`Disbursing` (a Performing loan whose outbound disbursement has not reached "Wired") is a
data-derived divergence that needs movement state not served to this page, so a Performing loan
simply renders "Active" — the `Disbursing` case only fires from the explicit backend status.
Past-maturity loans: the backend serves `Past Due`, but the design renders this state as
**Matured** (chip + dedicated screen + rollover, #866/#867); the legacy `Matured` value maps the
same.

### Loan-lifecycle stepper (design assignment §3.2 status diagram)

`buildLifecycle` builds the stepper's happy-path spine — `Origination → Disbursing → (live) →
Closed` — **not** a linear list of every status. Watchlist / Past Due / Default are branch flows
off the live state, not sequential stages, so they are never shown as "upcoming" steps (#854): a
healthy Performing loan's only forward step is **Closed**.

The middle **live node** reflects where the loan actually is: while live it takes the current
status label (`Active` / `Watchlist` / `Matured` / `Default`, via `statusToChip`); once
`Closed` it reads as the completed `Active` phase (there is no stored prior live status, so a
specific risk state is never fabricated for the label). Step states:

- `Origination` — done for any loan the loan-book returns (it exists on-chain).
- `Disbursing` — **active** when the served status is `Disbursing` (off-ramp not yet complete,
  #862); done once the loan is live/closed; pending when no status. (Now that the backend serves
  `Disbursing` directly, this step can be the current one — closes the #854 data gap.)
- live node — active while the loan is a live non-Disbursing status; done once Closed; pending
  while still Disbursing.
- `Closed` — active when the status is `Closed`, else pending.

An absent status (no loan-book row) leaves every step pending — never fabricated.

### Hero

Rendered by the shared `DetailHero` ([`components/detail/`](#shared-detail-primitives)) with
`backTo="/loans"` and the `loan-detail-status-chip` / `loan-detail-meta` test ids.
Degrades to the loan id only when no matching loan-book row is found (e.g. a direct URL to a
non-active loan) — identity is never fabricated. The meta line prints the loan id, the chain
label (`targetChainLabel(chain_id)`, #1537), the **maturity date** (both layouts, #859; a real served field, `entry.maturity`) plus the
**Nearest payment** clause (#941/#953): "next payment `<date>`" when upcoming, or "payment N days
late" / "payment due today" when overdue — dropped entirely when no next-payment timestamp is
served. The Figma hero corridor (`Colombia → Italy`) has no backend source and is omitted.

### Security card

`useLoanSecurity` — `GET /v1/loan-book/{loan_id}/security?chain_id=<id>` (spec
[loan-security-state.md](../product-specs/loan-security-state.md)), 30 s poll (stopped once the registry is known to be not configured), query key
`["loan-security", chainId, loanId]`. It is enabled for every chain with a numeric loan id (EVM since #1942, served by
[loan-security-state-evm.md](../product-specs/loan-security-state-evm.md)); it hand-mirrors only the fields the Trustee uses, all optional
(`LoanSecurityResponse` subset of `packages/api/src/security_state.rs`, TD-42). `LoanDetail`
invalidation keys use `loan-security` (formerly `loan-valuation`); the Risk Council actions and Record payment invalidate it too.

Its own state, independent of the page-level `state` (`buildSecurityCard`, `routes/-loanSecurity.ts`):

- **hidden** — a `404` whose error code is `security_registry_not_configured`
  (an unknown loan answers `200` with `terms: null`; the code is matched on the error text like
  `minter_not_configured` in `lib/wireEscrow.ts`). No card and no placeholder row. Any other `404`
  is an error.
- **loading** — skeleton rows. **error** — a failure with no data yet: an inline error inside the
  card only (friendly message, raw text behind "View details"); the rest of the page still renders.
  A failed background refresh never replaces loaded data: the card stays **ready** and adds the
  note "Couldn't refresh — showing the last loaded data."
- **no-terms** — `terms: null`: the note "No security terms are set for this loan."
- **ready** — rows: LTV (`valuation.ltv_bps`), Advance ratio, Margin-call ratio, Cure period
  (`terms.cure_period`, "7 d" / "36 h" / `—`), Security value (`valuation.value`), Amount owed
  (`valuation.debt`), Margin call. A "Price stale" chip when `valuation.price_stale` or
  `prices.price_stale` is true; "Updating from chain…" when `refresh_pending` is true.
  Notes, in this order, each only when the served flag is exactly `true`:
  "No valuation yet." (`valuation` is null; LTV, value and owed show `—`);
  `CURE_ENDED_NOTE` "The cure period has ended. Default is not automatic: the Risk Council decides
  whether to declare it." (`margin_call.open` and `cure_overdue`);
  `CURABLE_NOTE` "LTV is back at or below the advance ratio. The registry cures the margin call at
  its next coverage check." (`margin_call.open` and `open_call_curable`);
  `ABOVE_RATIO_NO_CALL_NOTE` "LTV is above the margin-call ratio. The registry has not opened a
  margin call yet." (`ltv_above_ratio_no_onchain_call`);
  `PRICE_STALE_NOTE` "A stale price does not open a margin call; it alerts the Risk Council."
  (either price-stale flag); then "Couldn't refresh — showing the last loaded data." on a failed
  refresh.

Rules:

- **Sentinel.** `ltv_bps === 4294967295` (`u32::MAX`, debt with no counted value) shows "No
  security value", not a percentage. Percentages show one decimal with a trailing `.0` trimmed,
  rounded **up** (`8123` → `81.3%`, `8000` → `80%`, `8001` → `80.1%`) because the contract rounds
  LTV up and the shown figure must never read at or below a ratio it is coloured against.
  `formatLtvBps` deliberately differs from `formatBpsRate` (`utils/formatUsd.ts`, nearest, always
  one decimal, rates) for that reason and for the sentinel and trimmed `.0`.
- **Tone** (LTV colour). Negative (red) when `margin_call.open === true` or
  `margin_call.ltv_above_ratio_no_onchain_call === true`; attention (amber) when the LTV is above
  that loan's own `advance_ratio_bps`; otherwise ink.
- **Margin call row.** "Open since {date}" plus " · cure by {date}" and " · cure period ended" when
  `cure_overdue` is true; "None" when closed; `—` when unknown.
- **Defensive parsing.** Every read goes through optional chaining and a type check, so a partial
  200 (`{}`, `terms: null`, `valuation: null`, `margin_call: null`) renders `—` rows and never
  throws; the removed `/valuations` hook crashed the page on exactly such a response.
- **Test ids.** `loan-detail-security`, `-loading`, `-error`, `-no-terms`, `-ltv`, `-price-stale`,
  `-refresh`, `-note`.
- **Records.** The per-record and per-inspection state is the separate
  [Security records card](#security-records-card) (#1767).

### Security records card

`SecurityRecordsCard` (`routes/-SecurityRecordsCard.tsx`, markup only) renders
`buildSecurityRecords` (`routes/-loanSecurityRecords.ts`, pure) from the same `useLoanSecurity`
result as the summary card, full width below the Security / Registry row in every layout (#1767).
No Figma frame exists: it is built from the loan-detail primitives (`CARD_CLASS`, `CardTitle`,
`KeyValueRow`, `chipStyle`, `AddressText`) with the Loans table tokens.

States: **hidden** whenever the summary card is not ready (registry not configured, loading,
error, `terms: null`), with no placeholder; **empty** for `records: []` or a missing `records`
("No security records are registered for this loan."); **ready** otherwise, records in served
order (no client sort).

Per record (`records[]`), everything verbatim from the served value:

- Title "Record #{record_id} · {protection}", the `status`, and chips: "Flagged" (`flagged_by`
  set or `valuation.flagged`), "Attestation stale", "Inspection stale", "Price stale"
  (`mark_stale` or `valuation.stale`), each only on an exact `true`; "Not counted" on
  `counts_toward_value === false`; "Closed" on `open === false`. `null` stale flags show no chip.
- Rows: Commodity, Document quantity (`reference_quantity` + `unit`), Counted quantity
  (`valuation.counted_quantity`), Value (`valuation.value`, `formatFullUsd`), Price ("{benchmark} ·
  $x per {unit}" from `mark`), Price updated (`mark.at`), Attested (`attested_at`), and Attested by
  (`attested_by`, `AddressText`). `valuation` is `null` for a record that does not count or has no
  snapshot (quantity and value `—`); `mark` is `null` for non-goods records (price `—`).
- **Inspections table** (`inspections[]`, served order; "No inspections." when empty): Inspection
  (`#id`, "latest" when `is_lot_latest`), Inspector (`inspector`, `AddressText`), Certificate
  (`certificate_no`), Kind, Inspected, Quantity (+ record unit), Grade (`formatDecimal7`),
  Entered (address + date), Approved (address + date; "Awaiting approval" when `approved_by` is
  null and `complete !== false`; `—` otherwise), the three variances in bps, a "Flagged" pill, the
  resolution and an action column ([Security inspections (#1857)](#security-inspections-1857)).
- **Latest inspection** row under Counted quantity: "{`lot.latest_quantity`} {unit} · Inspection
  #{`lot.latest_inspection_id`} · {`lot.latest_inspected_at`}", `—` when no latest inspection is
  served, with the static note "Counted quantity is the smaller of the document quantity and the
  latest approved inspection." (`docs/user-docs/risks/credit-policy.md`).
- **Open flag** row when `flagged_by` is set: "Inspection #{flagged_by}. The Risk Council settles
  it." with an "Open" link to `/risk-council/security/$id?chain=` (`loan-detail-open-flag`).
- **Inspector panel** block above the records (`loan-detail-inspector-panel`): the served
  `/security` `inspectors` as `AddressText` rows, "No inspectors are on the panel." when the list
  is empty, `—` when the field is not served, and an "Inspector panel" link to
  `/risk-council/inspectors`.

Formatting is display-only: 7-decimal strings are grouped and trailing zeros trimmed by string
math (`"1250.0000000"` → `1,250`), unix-second strings become dates, and nothing is rescaled or
summed (record values can add up a few raw units above `valuation.value`). Every field is read
with a type check, so a partial 200 renders `—` and never throws.

Test ids: `loan-detail-security-records`, `-records-empty`, `loan-detail-security-record`
(`data-record-id`), `-record-chip`, `loan-detail-security-inspection`.

Mark suggestions, the Set price button and the "Security actions" card are specified in
[Security marks (#1859)](#security-marks-1859); the Enter inspection and Approve buttons in
[Security inspections (#1857)](#security-inspections-1857). Not shown
here: record documents, repayments, agent release, margin-call events and pending operations. Risk
Council writes stay on `/risk-council/security/$id`.

#### Security marks (#1859)

Price marks, extension consent and the coverage check: three SecurityRegistry writes on the loan detail page, Stellar loans only. No Figma frames exist
(no-design exception granted on the Issue): everything is built from the loan-detail primitives and
the `DisburseAction` card and dialog pattern. No copy names a role; each action renders on the
served `can_call` of the connected wallet (`useSecurityRegistryAccess`, `readCanCall` against
`VITE_STELLAR_SECURITY_REGISTRY_ID` through the AccessManager `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`).
The app computes nothing: every mark, move, due flag and consent is the served value, `—` when
missing.

**Records card additions** (`buildSecurityRecords`). A record is revaluable when `open === true`
and it has a `suggestion_status` or an on-chain `mark.value_per_unit`. Such a record gains rows
Suggested price (`{benchmark} · $x per {unit}` from `suggested_mark`; the status text instead when
`suggestion_status` is not `ok`: `unmapped`, `unsupported_unit`, `no_price`, `inputs_missing`,
`unreadable`), Move vs suggestion (`move_bps` as `N bps`), Mark due (the `mark_due_reasons`
`missing` / `age` / `moved` as copy when `mark_due === true`, "No" when `false`) and Mark due at
(`mark_due_at`), a "Mark due" attention chip on `mark_due === true`, and a "Set price" button
(`loan-detail-revalue-button`). The button is hidden for an EVM loan or when the registry or
executor id is unset, disabled with "Connect a Stellar wallet to set a price mark." without a
wallet and with "This wallet is not allowed to set a price mark." when `can_call` is not
`immediate` (`loan-detail-revalue-note`). A USD record's mark is stored on-chain but not used in
the valuation; the contract has no status check on `revalue`.

**Revalue** (`-RevalueDialog.tsx`, `revalue-dialog`). Contract: `revalue(record_id: u32,
value_per_unit: i128, benchmark: Symbol, report_hash: BytesN<32>)`, `#[only_owner]`, reached by
`AM.execute` (`relaySecurityRegistry`, `fn: "revalue"`). The dialog shows Current price, Suggested
price, Move, Mark due and Mark due at (`revalue-context`) and prefills Price per unit with the
served `suggested_mark.value_per_unit` string verbatim and Benchmark with `suggested_mark.benchmark`
(else the current `mark.benchmark`). Validation is input-only: price is a non-negative decimal with
at most 7 dp (zero allowed, negative rejected with "The price can't be negative."), benchmark
matches `[A-Za-z0-9_]{1,32}` (a Soroban `Symbol`). The typed price is encoded to the i128 raw
(`decimal7ToI128`, x 1e7).

- **`report_hash`.** Value and benchmark unchanged from the suggestion: the served
  `suggested_mark.report_hash` is sent verbatim. Changed, or nothing was suggested: "Price evidence"
  text is required and `sha256(trimmed text)` (`securityReasonHash`) is sent. The hash that will be
  sent is always shown (`revalue-hash`). The backend stores it opaquely
  ([loan-security-state.md#mark-suggestions](../product-specs/loan-security-state.md#mark-suggestions)).
- Submit label follows the relay stage (`stageLabel`). Errors go through `securityMarksErrorCopy`
  (`1` "This record does not exist on-chain.", `14` "This loan has no security terms yet. Set them
  first."; other codes keep the generic copy with the raw text behind "View details").
- After success the records card shows the transaction hash (`loan-detail-revalue-result`).

**Security actions card** (`-SecurityActionsCard.tsx`, `loan-detail-security-actions`, under the
records card in every layout). Hidden whenever the summary Security card is not ready, for an EVM
loan, without a numeric loan id, or when neither the registry nor the executor id is set. It holds
the served coverage hints (`CURABLE_NOTE` on `margin_call.open_call_curable === true`,
`ABOVE_RATIO_NO_CALL_NOTE` on `ltv_above_ratio_no_onchain_call === true`) and three parts:

1. **Check coverage** (`check-coverage-button`). `check_coverage(loan_id: u32)` is permissionless and
   invoked directly on the SecurityRegistry (`checkCoverage`, no AccessManager). It needs only a
   connected Stellar wallet and `VITE_STELLAR_SECURITY_REGISTRY_ID`; without a wallet the button is
   disabled with "Connect a Stellar wallet to check coverage." (`check-coverage-connect`). The
   outcome (a margin call opened or cured) is read from the refetched card, not computed.
2. **Extension consents** (`loan-detail-extension-consents`). `extension_consents[]` verbatim:
   position, new maturity date, consent hash (truncated, full in the tooltip) and recorded date.
   "No extension consents are recorded." when empty.
3. **Record buyer consent** (`extension-consent-*`). `record_extension_consent(loan_id: u32,
   new_maturity: u64, consent_hash: BytesN<32>)` via `AM.execute`. New maturity is a UTC date after
   today, sent as 00:00 UTC of that day in unix seconds; the Buyer consent reference text is hashed
   with `securityReasonHash` (as the Release-with-consent form) and the hash is shown
   (`extension-consent-hash`). A wallet whose `can_call` is not `immediate` sees "This wallet is not
   allowed to record an extension consent." and a disabled form. The extension itself stays the
   Risk Council `amend_economics` ([risk-council-actions](#risk-council-actions)).

After each success `loan-security`, `loan-book` and `audit-log` are invalidated immediately and at
5 s and 15 s (`useSecurityMarks.ts`); the served data shows the write within one or two worker
cycles. Config: `VITE_STELLAR_SECURITY_REGISTRY_ID` and `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`
(already wired by #1858). Test ids: `loan-detail-revalue-button`, `-revalue-note`,
`-revalue-result`, `revalue-dialog`, `revalue-value`, `revalue-benchmark`, `revalue-evidence`,
`revalue-hash`, `revalue-validation`, `revalue-error`, `revalue-confirm`,
`loan-detail-security-actions`, `check-coverage-button`, `-result`, `-error`, `-connect`,
`loan-detail-extension-consent(s)`, `extension-consent-date`, `-reference`, `-hash`, `-submit`,
`-result`, `-error`, `-no-role`, `-validation`.

#### Security inspections (#1857)

The two INSPECTION_OPERATOR writes on the loan detail page, Stellar loans only: `record_inspection`
and `approve_inspection` (four-eyes: one operator enters, a second approves). No Figma frames exist
(no-design exception granted on the Issue): everything is built from the loan-detail primitives, the
`-RevalueDialog.tsx` dialog shell and the `-SecurityActionsCard.tsx` form controls. The app computes
nothing: every inspection, variance, flag and panel entry is the served value, `—` when missing.

**Sources.** `pipeline-stellar-contracts@e9881ac` `contracts/security-registry/src/lib.rs`:
`record_inspection(caller: Address, record_id: u32, inspection: NewInspection) -> u32` and
`approve_inspection(caller: Address, inspection_id: u32)`, both `#[when_not_paused]`, guarded by
`ensure_can_inspect` and `ensure_can_call`. Types in `types.rs` (`NewInspection`, `InspectionKind`),
errors in `error.rs`. Roles: `deployments/justfile` `setup-access` maps both functions to
`INSPECTION_OPERATOR` with delay 0 and at least two members; user docs
`governance/multisig-roles.md`, `technical/smart-contracts.md`, `references/glossary.md`.
Reads: `GET /v1/loan-book/{loan_id}/security` ([loan-security-state.md](../product-specs/loan-security-state.md)).
Code: `wallet-connect` `stellar/contracts/securityRegistry.ts` (`encodeNewInspection`,
`recordInspection`, `approveInspection`), `api/useSecurityInspections.ts`,
`lib/securityInspections.ts`, `routes/-InspectionDialog.tsx`, `routes/-ApproveInspectionDialog.tsx`,
`routes/-SecurityRecordsCard.tsx`.

**Direct call, no AccessManager relay.** The contract runs `caller.require_auth()` and then the
AccessManager `can_call(caller, registry, fn).immediate`. The transaction therefore invokes the
SecurityRegistry itself with the wallet as source and `caller` (the `checkCoverage` envelope
pattern, `buildDirectEnvelope` / `submitDirect`), never `AM.execute`, which would make the
AccessManager the invoker and fail the check. The stages are `awaiting-signature`, `submitting`,
`confirming`; `recordInspection` also returns the new `inspection_id` read from the transaction's
`u32` return value (`null` when absent).

**Availability.** The buttons are hidden for an EVM loan or when `VITE_STELLAR_SECURITY_REGISTRY_ID`
or `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` is unset (the executor id is only needed for the
`can_call` read). Enter inspection is shown on a record that is `open`, has a goods protection
(`EndorsedBl`, `WarehousePledge`, `CollateralManagement`) and a `PendingPerfection` or `Active`
status, mirroring `ensure_can_inspect`; the contract stays the authority. Both buttons are
disabled with a note (`loan-detail-inspection-note`) when no wallet is connected, when the served
`paused === true`, or when `can_call` for the function is not `immediate`; Enter is also disabled
when the served panel is empty. No copy names a role.

| Case | Copy |
|---|---|
| Enter, `can_call` not immediate | "This wallet is not allowed to enter inspections." |
| Approve, `can_call` not immediate | "This wallet is not allowed to approve inspections." |
| Row entered by the connected wallet | "Entered by this wallet. A second operator approves it." |
| No wallet (enter / approve) | "Connect a Stellar wallet to enter an inspection." / "Connect a Stellar wallet to approve." |
| Paused | "The SecurityRegistry is paused. Inspections can't be entered or approved until it resumes." |
| Empty panel | "No inspectors are on the panel. The Risk Council sets the panel." |

The pause panic code is not mapped: the UI gates on the served `paused`.

**Four-eyes hide rule.** Approve is offered on a row that awaits approval (`approved_by` null and
`complete !== false`) and has a numeric `inspection_id`, unless the served `entered_by` equals the
connected wallet (exact Strkey); then the row shows the "Entered by this wallet" note instead. When
`entered_by` is not served, Approve is still offered and the contract decides (`SameOperator`, #31).

**Enter inspection** (`-InspectionDialog.tsx`, `inspection-dialog`). Context rows: record title,
Commodity, Document quantity and Reference grade, verbatim. `NewInspection` fields and encoding
(an `scMap` with sorted `Symbol` keys):

| Field | Test id | Input | Encoding |
|---|---|---|---|
| Inspector | `inspection-inspector` | select of the served panel (only entry preselected) | `Address` |
| Kind | `inspection-kind` | `LoadingTally`, `DraftSurvey`, `SamplingAssay`, `DischargeSurvey`, `StockCount` | `Vec[Symbol]` |
| Inspection date (UTC) | `inspection-date` | date, not after today (UTC), sent as 00:00 UTC | `u64` seconds |
| Quantity found ({unit}) | `inspection-quantity` | decimal, at most 7 dp; disabled for `SamplingAssay` (sent as `0`) | `i128` raw x 1e7 |
| Grade | `inspection-grade` | optional decimal, at most 7 dp; empty is sent as `0` (not measured) | `i128` raw x 1e7 |
| Region | `inspection-region` | text, prefilled from the record's served `region` | `String` |
| Site hash | `inspection-site-hash` | 64 hex, prefilled from the record's served `site_hash`, editable | `BytesN<32>` |
| Certificate no | `inspection-certificate-no` | text, required | `String` |
| Certificate hash | `inspection-certificate-hash` | 64 hex pasted by the operator, lowercased | `BytesN<32>` |

The contract stores `certificate_hash` as a salted sha256 of the certificate as received and
`site_hash` as a salted sha256 of the vessel IMO or warehouse. No salting convention exists in the
repo, so the operator computes the hash off-chain and the app never sees the file or the salt. Date
precision is one day: two approved inspections on the same day tie and the later approval becomes
the lot's latest (contract `>=`). Validation is input-only and shows the first failing rule in
`inspection-validation`; errors go to `inspection-error`; the button is `inspection-confirm`
labelled "Enter inspection" with the stage label while pending. Helper text: "An entered
inspection counts for nothing until a second operator approves it."

**Approve inspection** (`-ApproveInspectionDialog.tsx`, `approve-inspection-dialog`). Rows: kind,
inspector, inspected date, quantity, grade, certificate no, entered by and date, and the loan's
served `terms.tolerance_bps` / `grade_tolerance_bps` as "{n} bps". Text: "Approving computes the
variances against the document quantity, the lot's latest inspection and the reference grade. The
record is flagged when a variance is above the loan's tolerance; only the Risk Council clears a
flag." Button `approve-inspection-confirm` "Approve inspection"; errors `approve-inspection-error`.

**Errors by contract name** (`inspectionErrorCopy`). The call is direct, so `Error(Contract, #N)` is
the SecurityRegistry's own code. The message is "{copy} ({Name})". A known code without copy reads
"SecurityRegistry error {Name} (#N)."; an unknown code keeps the generic text with the raw details
behind "View details"; "You cancelled the transaction" passes through.

| Code | Name | Copy |
|---|---|---|
| 1 | NonExistentRecord | "This record does not exist on-chain." |
| 4 | InvalidQuantity | "The quantity found must be greater than zero." |
| 12 | WrongRecordStatus | "This record's status does not allow an inspection." |
| 14 | NoTerms | "This loan has no security terms yet. Set them first." |
| 23 | Unauthorized | "This wallet is not allowed to enter or approve inspections." |
| 25 | NonExistentInspection | "This inspection does not exist on-chain." |
| 26 | NotGoodsRecord | "Only goods records are inspected." |
| 27 | NotInspector | "The inspector is not on the inspector panel. The panel may have changed; reload." |
| 28 | InvalidInspectionDate | "The inspection date can't be in the future." |
| 29 | TooManyInspections | "A record holds at most 64 inspections." |
| 30 | AlreadyApproved | "This inspection has already been approved." |
| 31 | SameOperator | "The operator who entered an inspection can't approve it. A second operator must approve it." |

The full code table 1 to 32 is pinned in `SECURITY_REGISTRY_ERROR_NAMES` from `error.rs`.

**Panel and lag.** The panel is the served `/security` `inspectors` (from `security_registry_state`,
refreshed by the `inspectors_set` event and the hourly view), not the on-chain
`useSecurityInspectors` read of the Inspector panel page. A `set_inspectors` executed seconds ago may
not be listed yet; the contract rejects an off-panel inspector with `NotInspector`.

**After a write.** The result line (`loan-detail-inspection-result`) reads "Inspection #{id} entered
on record #{r}. Transaction {hash}. It counts once a second operator approves it." ("Inspection
entered…" when the id is not returned) or "Inspection #{id} approved. Transaction {hash}. Variances
and any flag show once indexed." `loan-security`, `loan-book` and `audit-log` are invalidated
immediately and at 5 s and 15 s; a new inspection and an approval's variances and flag show after one
or two 30 s fold cycles.

**Served fields used.** `records[].{region, site_hash, flagged_by, lot.{latest_inspection_id,
latest_inspected_at, latest_quantity}, reference_quantity, reference_grade, protection, status,
open}`, `records[].inspections[].{inspection_id, inspector, kind, inspected_at, quantity, grade,
certificate_no, entered_by, entered_at, approved_by, complete}`, top-level `inspectors` and
`paused`, and `terms.{tolerance_bps, grade_tolerance_bps}`.

**Scope.** Stellar only. On an EVM loan the display additions render (`/security` serves EVM) but
Enter and Approve are hidden (`stellarOnlyActionReason`). The EVM `PipelineSecurityRecordNft` pair for
a follow-up is `recordInspection(uint256 recordId, NewInspection newInspection) restricted returns
(uint256)` and `approveInspection(uint256 inspectionId) restricted`, both `_requireDirectCall`
(caller is `msg.sender`), with `NewInspection` the tuple `(address inspector, uint8 kind, uint64
inspectedAt, uint256 quantity, uint256 grade, bytes32 siteHash, bytes32 certificateHash, string
region, string certificateNo)`. Not built: a cross-loan awaiting-approval queue (no aggregated
endpoint) and certificate file upload.

Test ids: `loan-detail-enter-inspection`, `loan-detail-approve-inspection` (`data-inspection-id`),
`loan-detail-inspection-note`, `-inspection-result`, `loan-detail-inspector-panel`,
`loan-detail-open-flag`, `inspection-*`, `approve-inspection-*`.

### Registry state & derived (#852)

`useLoanFinancials` — `GET /v1/loan-book/{loan_id}/financials`, the loan's own `chain_id` (#1537), 30 s poll; a
self-contained port of the backend DTO (`packages/api/src/routes/loan_financials.rs`) — a sixth
TD-42 hand-mirroring pair. Money fields display exactly as served, via plain `formatCompactUsd`
(no rescaling, project-wide since #906). `Epochs` formats as `"1 · 10.0% · 18 Jun 2026 → 19 Aug 2029"`
(number · APY · start → maturity); `—` when no epoch is on record (#857). The first row is
**Status** — the served `status` verbatim; it was `Status / location` until #1441 dropped the
`location` / `LocationView` half, whose backing field left `LoanFinancialsResponse` in
#1432/#1439 (the contract no longer exposes `LocationUpdate` as a read). The origination-side
`initial_location` is unaffected — it is off-chain submission intent, not a contract read.
`Custodian co-sig on
mint` has no field on `/financials` yet, so it renders `—` pending clarification (#852 open
question c) — never fabricated. `Unminted yield` (`not_minted_yield`) is shown as a single figure
(no vault/capital-wallet split — open question b). `Protection` is the deal-level trade-finance
protection instrument (#1014), served on the loan-book row (relayer DB, from the submission
payload — never on-chain). A 404 from `/financials` renders a neutral `"empty"` note, mirroring
Price & Collateral.

### Summary tiles

Three tiles, built entirely from served backend fields (no static fixture):

- **Facility / disbursed** (performing/watchlist/disbursing) — `principal / (disbursed ? principal : 0)`,
  sub "funded" or "drawn, not yet funded".
- **Facility / senior** (matured) — `principal / original_senior_tranche`, sub "—".
- **Repaid to date** — `entry.repaid_to_date`, sub "offtaker received".
- Variant-specific third tile: **watchlist** → "Days on watchlist"; **matured** → "Rate · epochs"
  (from `/financials`); otherwise → "Interest to distribute" (`not_minted_yield`).

### Status-conditional layout (#859/#862/#866)

The page branches on `detail.variant` (derived from the served display status):

- **performing** — lifecycle stepper + Security + Registry state (Security beside Registry; when
  hidden, Registry fills the row).
- **Security records card.** Below the Security row in every variant, full width; absent when
  hidden (see [Security records card](#security-records-card)).
- **watchlist** — no stepper; the Security card (the row is omitted when hidden), a "Days on
  watchlist" tile, and an escalation current-stage card (Figma node `4116:10803`). There is no CCR
  trend.
- **disbursing** — the performing layout, but the current-stage card is the wired
  disbursement-complete action (`POST …/disbursement/complete`, #862); the lifecycle shows the
  Disbursing node active.
- **matured** — no stepper; a rollover card beside Security, the hero shows `<date> —
  passed`, and Roll over is the matured-only fast-path (Figma node `4116:10969`, #866). The served
  `Past Due` status maps here.

A `Closed` status keeps the performing layout (the lifecycle spine reads it as the completed
Performing phase) but is terminal for actions: `selectOtherActions` returns
`CLOSED_OTHER_ACTIONS` — no action buttons, only the "This loan is closed — no further actions
are available." note — whenever the status chip is Closed, regardless of variant (#1092).
Closed loans stay served in `/v1/loan-book`'s `loans[]` (status `Closed`); they are excluded
from the active-set aggregates, not from the row set.

Shared live sections render in every variant: Hero + status chip (loan-book row), Security
(`/security`, Stellar only), Registry (`/financials`, performing only), and Documents
(loan-book row, #1040 — see [Documents](#documents)). Summary tiles are live; action labels and explanatory copy are static product configuration unless a branch opens
a wired flow.

**Current-stage card is hidden for now (#938):** its real behavior is proposal-aware — a plain
"decision pending" title only once a Risk-Council proposal is submitted for the loan, otherwise a
warning + prompt to open an escalation — which needs a per-loan proposal-status feed the backend
doesn't serve yet. The static `WATCHLIST_CURRENT_STAGE` mock is not rendered until that lands; the
Performing "on-ramp in transit" card was removed entirely (#876). `currentStage` is `null` for
every variant today.

### Wired actions

- **Disbursement complete** (Disbursing variant, #862/#864) — `Complete off-ramp` is the one real,
  status-changing action on this card: `POST …/disbursement/complete` flips the loan out of
  `Disbursing` and refetches. Disbursing has no dedicated Figma flow, so the page keeps the
  Performing layout and only this "Next Step" card differs. The confirmation modal mirrors the
  shared dialog shell (`-RejectReasonDialog.tsx`): `role="dialog"`, `aria-modal`, Escape +
  backdrop-click cancel (never a stray confirm), navy confirm button; pending disables both
  buttons and a failure (404 = loan not indexed) surfaces inline. It stays DB-only: the on-chain
  booking is the separate Disbursement card ([Disburse](#disburse-1898)).
- **Roll over** (Matured variant, S9, Figma node `4116:14050`, #870) — collects the new rate as a
  **percent p.a.** (text input, 0.01–100, at most 2 decimals since 1 bp = 0.01%; converted exactly
  to integer bps by `percentToBps` (`@/utils/rateUnits`) and echoed live as `= N bps`; anything
  else shows the inline rate error and keeps Roll over disabled — #1625, which replaced a
  `parseInt` on a "bps" field that turned `14.5` into 14 bps) + new maturity, then submits the
  on-chain `LoanRegistry.rollover` via `useRollover` (bps; both encoders scale ×100). Stellar goes
  through the executor; EVM calls `rollover(uint256,uint32,uint64)` through
  `AccessManager.execute` ([EVM (#1574)](#evm-1574)). The mint-ceiling delta is **not** previewed with a figure — the real ceiling change is computed
  on-chain at rollover, avoiding a fabricated transaction-effect number.
- **Update lifecycle** (S10, Figma node `4116:14087`, #872, #1893) — collects the target status and
  the metadata URI only, then submits the on-chain `LoanRegistry.update_mutable(loan_id: u32,
  status: LoanStatus, metadata_uri: String)` through the executor via `useUpdateLifecycle` (EVM:
  `updateMutable(uint256,uint8,string)` through `AccessManager.execute`, [EVM (#1574)](#evm-1574)). There is
  no CCR or location argument on-chain, so the dialog has no such inputs.
  **Source of truth (#1893, TD-183)** — status and metadata URI come from one on-chain
  `mutable_loan_data` read (`useLoanMutableState` → `readLoanChainState` / `readEvmLoanChainState`), not from the loan-book
  entry: `GET /v1/loan-book` serves neither the current `metadata_uri` (it serves the submission's
  `draw_loan` URI, which a later `update_mutable` replaces) nor a status free of indexer lag. The
  dialog shows a loading line while the read is pending and the mapped read error if it fails;
  **Update loan** stays disabled in both cases.
  **Status options** follow the contract rule (`allowedLifecycleTargets` in `-useLoanDetail.ts`):
  `Performing` / `WatchList` offer both (labels Active / Watchlist); `Approved` and `Default` offer
  only themselves (metadata-only, any other status reverts `WrongCurrentStatus`); `Closed` or an
  unknown status offers none and shows "This loan's on-chain status does not allow a lifecycle
  update." (`AlreadyClosed`). The selector preselects the on-chain status.
  **Metadata URI** — the field is prefilled with the stored value and is sent exactly as shown
  (verbatim, no trimming); the contract replaces the stored URI on every call, it never appends. A
  blank field is blocked while the stored URI is non-blank, so the URI is never wiped by default.
  **Update loan** is also disabled when nothing changed (same status and same URI), which avoids a
  no-op transaction. Only `StatusUpdated` is emitted, and only on a status change.
- **Past-Due attention notice** (#940) — a past-maturity loan renders under the Matured variant;
  its derived `Past Due` status is an attention signal, not a lock — per the backend, it exists
  "to draw the Trustee's attention that they either need to record the payment or escalate."
  The banner body reads "Maturity has passed. If the payment arrived, record it. If it didn't,
  escalate the loan to the Risk Council. Default is never automatic." and offers Record payment /
  Escalate to Risk Council (#1767), wired to the existing actions. Amber (attention) tokens — not red, which is reserved for Default.
- **Chain gate (#1537, #1574)** — Roll over, Update lifecycle, Record coupon and Close loan are
  trustee-wallet signatures (`LoanRegistry.*` through the executor on Stellar and through
  `AccessManager.execute` on EVM; `Minter.repay` for the two Record pages, via
  `@pipeline/wallet-connect`). `loanActionChainReason(chainId)` (`lib/targetChains.ts`) is `null` for
  Stellar (and a missing id) and for `ENV.EVM_CHAIN_ID`; any other chain id gets
  `stellarOnlyActionReason`. `useLoanDetail` returns it as `onChainBlockedReason`: when set, the
  actions card disables those four buttons (`ON_CHAIN_ACTIONS`) and prints the reason
  (`loan-detail-onchain-blocked`), the Matured rollover button is disabled, `onOtherAction` is a
  no-op for them, and the Record Coupon / Record Repayment pages null their
  `recordPaymentInput` / `closureReason` and print the same line. Each mutation input carries the
  loan's `chainId` and the hook picks the arm (`pickChainWallet`). Register debt token uses the same
  gate ([Register debt token](#register-debt-token-1766), #1892). Escalate to Risk Council
  and Disbursement complete (DB-only) stay available. The Disbursement card (#1898) uses the same gate.

### Repayment recovery (#1711)

Procedure, roles and contract facts: [loan-repayment-recovery.md](../product-specs/loan-repayment-recovery.md). No Figma: the card and dialog reuse the loan-detail card and the shared dialog shell (`DisbursementConfirmDialog`).

- **Card** (`loan-detail-repayment-recovery`, `RepaymentRecoveryCard` in `loans.$id.tsx`): "Repayment recovery" with one muted line and an "Open recovery" button, rendered after the Other-actions card in the Performing and Watchlist layouts. States from `recoveryCardState` (`-repayment-recovery.ts`):
  - `eligible`: `/financials.offtaker_outstanding` is `0`, loan-book `senior_outstanding` is `> 0`, and `onchain_status` is `Performing`, `WatchList` or `Default` (string comparisons on the served values, no arithmetic);
  - `awaiting-corrected-repayment`: the latest repayment id (`next_repayment_id - 1`) has `is_repayment_reversed = true`. The card stays after step 1 even though the loan is no longer "eligible" (offtaker outstanding is back above `0`);
  - `blocked-evm`: eligible but the loan's chain is an EVM chain other than `ENV.EVM_CHAIN_ID` (the configured EVM chain is `eligible`, #1943); the button is disabled and shows `riskCouncilChainReason`;
  - `hidden` otherwise. The on-chain reads run only for loans on Stellar or `ENV.EVM_CHAIN_ID` in `Performing..Default`, under one React Query key (`["repayment-recovery", chainId, loanId]`; Stellar `staleTime` 15 s; EVM `staleTime` 60 s, `refetchOnWindowFocus: false` and no interval, so a tab refocus never re-scans the RPC).
- **Dialog** (`-RepaymentRecoveryDialog.tsx`, state in `-useRepaymentRecoveryDialog.ts`, on-chain hooks in `api/useRepaymentRecovery.ts`):
  - Step 1: a radio list of the non-reversed repayments (registry `repayment_data`, formatted from raw units by `chainAmountDecimals`, never rescaled). A repayment with `senior_principal_repaid = 0` and `equity_distributed != 0` is listed first and preselected. For the selection the dialog shows the Minter `repayment(...)` effects verbatim: cash removed from bank, capital wallet fee shares burned (raw share units), and either the vault interest absorbed or, for a carved-out loan, the Pocket principal / interest unrelease. Nothing is summed client-side.
  - Reload behaviour: when the latest repayment is already reversed, it is preselected and step 1 shows "reversed on-chain" so step 2 is reachable without local state.
  - Step 2: the corrected split from `GET /v1/loan-book/{id}/waterfall` at the original `offtaker_received` and the original `value_date` (the `CashRepaid` audit row, `originalValueDate`), mapped by `buildRepaymentInput` (the Record Repayment mapping), then signed through `useRecordPayment` unchanged. On success the dialog shows the transaction hash; the close checklist on Record Repayment then applies.
  - Scheduled operations: before the radio list, a "Scheduled operations" block (`PendingOperationsList`, `repayment-recovery-pending`) lists all of the loan's pending operations from `GET /v1/loan-book` ([Risk Council pending operations](#risk-council-pending-operations)). It is always rendered. `reverse_repay` rows (Minter target `ENV.STELLAR_YIELD_MINTER_ID`) show "Reverse repayment · repayment #N", the repayment and reference hash, "Scheduled by" and the state line, and the scheduling wallet can Execute a ready row with the served `args_xdr` from any session; another wallet sees "Only the scheduling wallet (…) can execute this.", and a row that targets another Minter is disabled with the Minter copy. Rows of other functions show a link ("Open Amend economics" and so on) and never execute. The deterministic "Execute reversal" button below stays: executing through either path makes the other read `get_schedule = 0`, and the reversed registry flag hides the step-1 button. An in-flight row Execute counts as busy: Escape, the backdrop, Close, the radio list and "Execute reversal" are blocked while it signs, and the row Execute buttons are disabled while "Execute reversal" or the corrected-repayment record is in flight. There is no session bridge for a `reverse_repay` just scheduled in the dialog (the role line covers it until the indexer serves the row, about a minute).
- **Gating by on-chain `can_call`** (`useReverseRepayAccess`, connected wallet on the Minter): `reverseAction` yields
  - `execute-now` (`can_call(reverse_repay).immediate`): one "Reverse repayment" click, a single `AM.execute`, with the same stage text as `repay`;
  - `schedule` (`delay > 0`, nothing scheduled): "Schedule reversal" (`AM.schedule`, `when = 0`), the delay shown in hours verbatim;
  - `execute-scheduled` (a schedule exists): "Executable from <UTC date-time>" from the on-chain ready time, button "Execute reversal". The schedule is found after a reload by `hash_operation(caller, minter, "reverse_repay", [loan_id, repayment_id, ref_hash])` then `get_schedule`, with `ref_hash = sha256("pipeline:reverse_repay:{minterId}:{loanId}:{repaymentId}")`; no `localStorage`. Execute stays enabled while a schedule exists; an early attempt fails at simulation;
  - `no-role` (`immediate: false, delay: 0`, for example a Trustee-only wallet): "Only the Risk Council can reverse a repayment." and the button is disabled.
  - Step 2 additionally needs `can_call(repay).immediate` (`CASH_REPORTER`); otherwise "Only the Cash reporter can record the corrected repayment."
- **Step 2 gate** (all required): the repayment is reversed on chain (registry flag), the original `value_date` was found, `/financials.offtaker_outstanding` is above `0` (the backend has indexed the reversal), and the waterfall query resolved. Mutations invalidate `repayment-recovery`, `repayment-recovery-access`, `loan-book`, `loan-financials`, `loan-waterfall` and `audit-log` immediately and again at 5 s and 15 s.
- **Errors:** generic `toUserError` plus dialog-local copy for AccessManager `#6` (not scheduled), `#7` (not ready), `#8` (expired, or the Minter's bank cash below the repayment's cash), `#9` (already scheduled) and Minter `#25` (already reversed). It is local because Soroban codes collide across contracts and the global map stays empty.
- **Config and roles:** `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` (the AccessManager), `VITE_STELLAR_YIELD_MINTER_ID` and `VITE_STELLAR_LOAN_REGISTRY_ID`; a missing one gives the "not configured for this environment" copy. The Risk Council wallet must also be a trustee in the API's `auth_users`, or step 1 cannot run from the app (deployment fact).
- **EVM (#1943).** Step 1 runs on `ENV.EVM_CHAIN_ID` with the same dialog, card and copy. The target is `ENV.EVM_MINTER_ADDRESS` and the AccessManager `ENV.EVM_ACCESS_MANAGER_ADDRESS`; a missing address gives "On-chain repayment recovery is not configured for this environment." Reads and signing go through `useChainWallet` and `pickChainWallet`:
  - Access: `canCall(wallet, minter, selector)` for `reverseRepay(uint256,uint256,bytes32)` and for `repay(...)` (`evmReverseRepaySelector`, `evmRepaySelector`, from the ABI). The UI follows `canCall`; on Hoodi `reverseRepay` shares `MINTER_OPS_ROLE` with the other Minter operations (accepted as deployed) and the copy is unchanged.
  - Reverse: `reverseRepay(loanId, repaymentId, refHash)` through `relayEvmReverseRepay` (`AccessManager.schedule(minter, data, 0)` or `AccessManager.execute(minter, data)`). `refHash = 0x + sha256("pipeline:reverse_repay:{EIP-55 minter}:{loanId}:{repaymentId}")` (`evmReverseRepayRefHash`, the Stellar preimage with the checksummed address), so the schedule is found again after a reload. It is never the zero hash (the Minter keeps single-use hashes, `MinterRefHashSeen`).
  - Candidates (`readEvmRecoveryRepayments`): the head block is read once and pinned: `nextRepaymentId` from `PipelineLoanRegistry.mutableLoanData` and the Minter `repayment` reads (legacy view or `extsload`, below) use `blockNumber: head`, then one chunked `eth_getLogs` pass (`scanEvmLogs`, 50 000 blocks per call, concurrency 4, to the same head; each call retries a transient failure, see wallet-flows) from `ENV.EVM_START_BLOCK` (`VITE_EVM_START_BLOCK`, the LoanRegistry deploy block; default 0) over the LoanRegistry and Minter for `PaymentRecorded`, `PaymentUnrecorded` and `CashRepaid` of the loan. `repayment` is the seven `PaymentRecorded.repayment` fields as decimal strings and `reversed` is true when a `PaymentUnrecorded` exists for the id. Every id below `nextRepaymentId` needs a `PaymentRecorded` and a `CashRepaid` log; a missing one throws "Repayment #N was not found on chain from block {from}; check VITE_EVM_START_BLOCK." and the dialog shows "Failed to load the repayments." with the details, never a fabricated row. A malformed `VITE_EVM_START_BLOCK` (not a non-negative integer) fails at startup in `lib/env.ts` with a config error, and an invalid `VITE_EVM_MINTER_ADDRESS` is refused before any RPC call ("VITE_EVM_MINTER_ADDRESS is not a valid EVM address"). No EVM view holds the full `RepaymentData` or the reversed flag, hence the log scan (TD-190).
  - Effects: `cash`, `interestMinted`, `feeShares` and `saleId` come from the `CashRepaid` log; `carvedOut` and `principal` come from the Minter's own `Repayment` record (`readEvmMinterRepayment`, #2074). It calls the legacy view `repayment(loanId, repaymentId)` first; the Hoodi Minter (source `f92d719`) has it and returns `{ feeShares, fees, released, carvedOut }`, where `released` is the amount `Pocket.unrelease` restores (shown as "principal"). Only on a revert with empty data (a `150631a` Minter, where the view moved to `PipelineMinterReader`) does it read `Minter.extsload` at the record's slot in the ERC-7201 namespace `pipeline.storage.Minter` (base `0x1cb61fb8…5cc100`, field 19 `repayments`, `keccak256(repaymentId . keccak256(loanId . (base + 19)))`): word 2 is `released` and word 3's low byte is `carvedOut`, with `yieldEpoch` packed above it and unread. Any other error propagates and the dialog shows the load error. A non-existent record reads as zeros on both paths. Nothing is summed client-side.
  - Errors by custom-error name (`evmRecoveryErrorCopy`): `AccessManagerNotScheduled` / `NotReady` the `#6` / `#7` copy, `AccessManagerExpired` and `MinterInsufficientBankCash` the `#8` copy, `LoanRegistryRepaymentAlreadyReversed` and `MinterAlreadyReversed` the `#25` copy, `AccessManagerAlreadyScheduled` the `#9` copy. The call's ABI carries the Minter and LoanRegistry errors (`evmRecoveryErrorAbi`), because `reverseRepay` bubbles `unrecordPayment` reverts. `EnforcedPause` (the LoanRegistry's `unrecordPayment` is `whenNotPaused`) "The LoanRegistry is paused. Executing is blocked until it resumes."
  - Step 2 (the corrected `Minter.repay`, #1574) runs on EVM through the `useRecordPayment` EVM arm ([Recording a payment](#recording-a-payment--minterrepay-1712)). `loanActionChainReason(chainId)` sits right after "Reverse the repayment first." and before the other step 2 checks: `null` on Stellar and `ENV.EVM_CHAIN_ID`, the Stellar-only line for any other chain, where the record mutation is never called. `record()` passes `chainId`; the `value_date` comes from the indexed EVM `CashRepaid` row.
- Not in the app: cancelling a scheduled reversal (`AM.cancel`, TD-159).

### Disburse (#1898)

Resolves TD-157. Contract: Minter `disburse(loan_id: u32, amount: i128, value_date: u64, ref_hash: BytesN<32>)` is `#[only_owner]`, so it is reached through `AM.execute(minter, "disburse", args, caller)` by a `TRUSTEE` wallet (`relay`, `disburse` in `@pipeline/wallet-connect`). It books bank cash out, calls `registry.disburse` (the first call opens epoch 0 and moves `Approved` to `Performing`) and `factory.sync_debt`. No Figma: the card and dialog reuse the loan-detail card and the shared dialog shell.

- **Card** (`loan-detail-disburse`, `-DisburseAction.tsx`, mounted after the Debt token card on every layout). Visible for a loan on Stellar or `ENV.EVM_CHAIN_ID` (the [EVM (#1574)](#evm-1574-disburse) block below) whose on-chain status is `Approved`, `Performing` or `WatchList`, that is not carved out, and where `disbursed < original_senior_tranche`; a fully disbursed loan shows nothing. Rows, verbatim from chain: Senior tranche, Disbursed on-chain, Booked bank cash (minter `pool_state().bank_cash`); "—" while loading or on error. Nothing is computed client-side, and no "remaining" figure is shown.
- **Pre-flight order** (`disburseView`, `lib/disburse.ts`; the first failing check is the reason, `loan-detail-disburse-blocked`, and the button stays disabled):
  1. Chain gate (`loanActionChainReason`): another chain gets the Stellar-only line.
  2. A required id is unset (minter, executor, registry, factory): not configured.
  3. Loan read (registry `mutable_loan_data` + `immutable_loan_data`) pending hides the card; an error gives "Could not read this loan on-chain."
  4. `deal(loan_id)`: none gives "Register this loan's debt token first." ([Register debt token](#register-debt-token-1766)).
  5. DEBT trustline of the loan NFT holder (`owner_of`, the capital wallet from `draw_loan`; SAC `authorized(holder)`): `Error(Contract, #13)` means missing, so the reason names the holder and says operations must add the DEBT trustline (`just new-deal <id>` in the contracts repo); `true` and `false` both count as present; any other failure is "Could not verify".
  6. Minter `paused()`.
  7. A connected wallet, then `can_call(caller, minter, "disburse")`: `immediate` is ready, `delay > 0` says the app does not schedule disbursements, otherwise "Only the Trustee role can disburse a loan."
- **Dialog** (`disburse-dialog`): Amount (USD, up to 7 decimals), Value date (UTC, `type="date"`, defaults to today, not in the future) and Bank reference (trimmed, 1 to 140 characters), a read-only `ref_hash` line, and the same three read-only rows. The only client checks are plain comparisons: amount above 0 and not above the on-chain `bank_cash`. The tranche cap is the contract's (`#13`). Escape and backdrop cancel are ignored while pending.
- **`ref_hash` and idempotency.** `ref_hash = sha256(reference.trim())` (`bankReferenceRefHash`), the convention shared with the other cash bookings (the minter's consumed set is shared). The zero hash is rejected by the encoder because the contract skips the replay check for it. Before any signature the mutation reads `ref_hash_seen` and refuses a consumed reference, then re-reads `paused()`; the confirm button is disabled while pending; a retry after an unknown outcome reuses the reference, so `#7` refuses a double booking.
- **Errors** (`disburseErrorCopy`, local because Soroban codes collide across contracts): `1000` paused, `7` reused reference, `8` bank cash below the amount, `6` / `25` amount, `13` senior tranche exceeded (shown with the on-chain disbursed and tranche values verbatim; the trustline was already verified, so the SAC collision is not shown), `3` / `2` status, `21` carved out. `#4` is left generic (minter `Unauthorized` and factory `NotRegistered` collide).
- **After success** the card shows the transaction hash and "The loan book updates once indexed" (the relay returns only the hash). `loan-disbursement`, `loan-mutable`, `loan-book`, `loan-financials`, `loan-security`, `loan-waterfall`, `cash-book`, the minter pool state, `deal-token`, `evm-deal-token`, `debt-trustline` and `audit-log` are invalidated immediately and again at 5 s and 15 s; `CashDisbursed` is already indexed into the cash book and audit log.
- **Complete off-ramp is separate.** Disburse never calls `POST …/disbursement/complete`; the served display status stays `Disbursing` until that DB flag is flipped, while the card itself keys off the on-chain status.
- **Testnet caveat.** Disburse succeeds only after ops deploys the DEBT SAC and adds the capital-wallet trustline (`just new-deal <id>`) and `register_deal` has run; until then the card shows the matching reason. The minter's booked bank cash must cover the amount.
- **Config:** `VITE_STELLAR_YIELD_MINTER_ID`, `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`, `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`.

#### EVM (#1574, Disburse)

Same card, dialog, test ids, copy, form rules and success line; the differences are rows 23 to 33 of the [differences table](#evm-1574).

- **Call:** `AccessManager.execute(minter, disburse(uint256,uint256,uint64,bytes32))`, `value 0`, through `disburseEvmLoan` (`sendEvmContractCallChecked("disburseEvmLoan", …)`). The role is `MINTER_OPS_ROLE`, read with `canCall(wallet, minter, 0x1d492b02)` (`useDisburseAccess(chainId, …)`, `readEvmCanCall`); the copy still says "Trustee role".
- **Pre-flight order** is the Stellar order without step 5: the DEBT trustline is skipped (`trustline: null`), because the EVM `DealToken` is an ERC-20 that only the factory mints, so `syncDebt` has no trustline precondition. Step 3 is `readEvmLoanDisbursementState` (`mutableLoanData` + `immutableLoanData.originalSeniorTranche`); step 4 is `readEvmDeal` (`DealTokenFactory.deal(uint256)`, a `DealTokenFactoryNotRegistered` revert is `null`) through `useEvmDeal`, keyed `["evm-deal-token", chainId, loanId]` (its own cache, so the Stellar `useDeal` observer on the same loan never shares or overwrites its query function); step 6 is `readEvmMinterPaused` (`useEvmMinterPaused`, key `["evm-minter-paused", minter]`). The card's bank cash is `useEvmMinterBankCash` (key `["evm-minter-bank-cash", minter]`, refetch 30 s). `useDeal` keeps the separate `["deal-token", chainId, loanId]` cache; Register debt token and the "Debt token" row read both caches through `useLoanDeal` (#1892).
- **Minter reads (Hoodi vs the frozen source).** `readEvmMinterBankCash` and `readEvmRefHashSeen` call the legacy views (`bankCash()`, `refHashSeen(bytes32)`, present on the Hoodi Minter). On a revert with empty data (the function does not exist, as on a `150631a` Minter) they fall back to `Minter.extsload` at the `PipelineMinterReader` layout: `bankCash` at `MINTER_STORAGE_SLOT + 8`, `refHashesSeen` at `keccak256(refHash . (MINTER_STORAGE_SLOT + 20))`. Any other error propagates. `readEvmMinterRepayment` (`repayment(uint256,uint256)`, #2074) follows the same rule and falls back to words +2 and +3 at `keccak256(repaymentId . keccak256(loanId . (MINTER_STORAGE_SLOT + 19)))`. `paused()` exists on both.
- **Units:** the card, dialog and form use `chainAmountDecimals(chainId)` (6 on EVM): amounts are parsed strictly (`parseExactAmount` in `utils/stellarSacUnits.ts`, no truncation), formatted with `rawToDecimal` (also in `utils/stellarSacUnits.ts`), and the form error reads "Enter the amount disbursed (up to 6 decimals)." Stellar output stays byte-identical at 7 dp.
- **`ref_hash`:** `0x` + `sha256(reference.trim())`; the zero hash is rejected by `encodeEvmDisburseCalldata`. The hook refuses a seen hash (`readEvmRefHashSeen`) and a paused Minter (`readEvmMinterPaused`) before the signature.
- **Errors** (`disburseErrorCopy`, EVM names matched in the details): `EnforcedPause` paused; `MinterRefHashSeen` reused reference; `MinterInsufficientBankCash` bank cash; `MinterInvalidAmount` / `LoanRegistryInvalidAmount` amount; `LoanRegistryDisbursementExceedsTranche` tranche (values at the chain's decimals); `LoanRegistryWrongCurrentStatus` / `LoanRegistryNonExistentLoanId` status; `LoanRegistryCarvedOut`; `DealTokenFactoryNotRegistered` "Register this loan's debt token first."
- **Config:** `VITE_EVM_MINTER_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS` and the new `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` (Hoodi `0xCf54e4d3ffcfFC663058b6966D9B8578d988eCDC`, equal to the worker's `CHAIN_<id>_EVM_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`). Until the factory key is set the card shows "Disbursement isn't configured for this environment."
- **Testnet caveat.** On Hoodi the registry holds no loans yet and `bankCash() = 0`. Disburse needs, in contract order, an unused non-zero `ref_hash`, booked bank cash at least the amount (EVM bank cash rises through `recordWireIn`, #1501, not bookable from the Trustee app on EVM), the loan `Approved..WatchList` within its tranche, and a registered deal: `drawLoan` does not register one, so until the Trustee runs [Register debt token](#register-debt-token-1766) (`registerDeal`, #1892, on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`) the card shows "Register this loan's debt token first."; a successful registration invalidates `evm-deal-token`, which clears it without a reload.

### Figma → token / px mapping (`4116:10549`)

- `‹ Loans` `Besley 18px` `#262524`; title `Besley 44px`; both ink.
- Status chip → colour band (`chipStyle`): positive green (0.08 bg / 0.3 border), attention amber
  `#6e6400`, negative red `#b20000`, info brand navy `#000080`, neutral muted.
- Card `bg-white`, `LINE_COLOR` border (`rgba(56,55,53,0.18)`), `rounded-[4px]`. Card title
  `Besley 26px` ink; row label `Inter 15px` ink-muted; value `Inter 16px` ink.
- Lifecycle stepper (Figma node `4116:10560`): done ✓ green `#208000`
  (`--color-pipeline-positive-primary`) tint fill `rgba(32,128,0,0.08)` + 30%-green border (also
  colours the filled connector line); active filled navy `#000080` (`--color-pipeline-brand`) with
  a 12%-brand ring glow; pending muted ring.
- Primary button `#000080` white text (`--color-pipeline-brand`).
- Sub-line tones: positive green `#208000`; attention amber `#6e6400` (one-off); negative
  `#b20000` (one-off, ≠ `--color-pipeline-negative`); muted ink-muted.

### Documents

**Sources:** `packages/trustee/src/api/useLoanBook.ts` (`LoanBookEntry.documents`),
`packages/trustee/src/routes/-useLoanDetail.ts` (`buildDocuments`, `DocumentDisplay`),
`packages/trustee/src/routes/loans.$id.tsx` (`DocumentsCard`),
`packages/trustee/src/components/DocumentIcon.tsx`. Issue #1039.

The loan detail page renders a Documents section on **every** loan, regardless of lifecycle status.

- **Source.** The matching `GET /v1/loan-book` row's `documents` array —
  indexer-sourced from the loan's on-chain IPFS metadata document
  (`LoanMetadataJson.documents` → `LoanSnapshot.documents`), not the submissions payload. The
  submissions endpoint is deliberately **not** consulted: although a real join key exists
  (`SubmissionView.loan_id` matches `LoanBookEntry.loan_id`), reading `documents` off the
  loan-book row the page already fetches is strictly better — one fetch instead of two, no
  cross-endpoint consistency window, correct for loans whose submission row is absent, and
  sourced from the loan's *live* indexed metadata rather than the frozen submitted payload.
- **Placement.** Directly before the Other-actions section, in every §S5 status variant
  (performing, watchlist, disbursing, matured). The section **always renders**; only its
  contents vary — never hidden, never gated on `documents.length`.
- **Rendering.** Reuses the Origination detail page's documents-list markup verbatim
  (`DealDetailsCard` in `origination.$id.tsx`): a filled navy `DocumentIcon` in a 32px tinted
  square, the document name as a dashed-underline link, opening `uri` in a new tab
  (`target="_blank" rel="noopener noreferrer"`). A document with an empty `uri` renders inert
  (`aria-disabled`, no pointer events, no `href`) rather than a dead link. The zero-document
  empty state reads "No documents provided." The card *chrome* (26px `CardTitle`) follows the
  loan-detail page's own idiom rather than origination's 28px heading — the one deliberate
  divergence from the "reuse verbatim" rule.
- **Never-fabricate.** Served order is preserved; no filtering, sorting, deduping, or synthesized
  names. Loans whose snapshot was indexed before commit `f73d54d` (which introduced the
  `documents` field) legitimately show the empty state until re-indexed — see the known-bugs
  entry for the remedy.
- **Deferral.** The v3 design assignment (`docs/design-docs/trustee-dashboard-v3-design-assignment.md`
  §S5) places Documents in a tab strip (Ledger / Terms / Movements / Documents / Location /
  Activity) that this page does not implement — the card above is the author-approved interim
  until that larger tab-strip migration lands (tracked in the tech-debt tracker).

## Cash movement & lifecycle actions

**Sources:** `packages/trustee/src/routes/-record-coupon.ts` +
`routes/loans.$id_.record-coupon.tsx` (Record Coupon, issue #882, Figma node `4116-11452`);
`routes/-record-repayment.ts` + `routes/loans.$id_.record-repayment.tsx` (Record Repayment —
Principal, issue #884, Figma node `4116-11621`, the principal-repayment sibling of Record Coupon).

### Architecture

View/logic split per rule 2 (mirrors `-useLoanDetail.ts`'s split). `-record-repayment.ts`
**deliberately duplicates** several of `-record-coupon.ts`'s pure helpers (parse/scale
conversions, terminal-repayment detection, the coupon/final period computation) rather than
importing them — each `loans.$id_.*` route is a self-contained presenter (mirrors the project's
existing per-route hand-mirroring convention, e.g. TD-42's trustee/LP pairs), so the two flows can
diverge independently as either evolves.

### Record Coupon — scope (#882, read/UI only at introduction)

Previews the payment waterfall for a trustee-entered offtaker coupon via `useLoanWaterfall` (`GET
/v1/loan-book/{loan_id}/waterfall`). At introduction it did not perform the on-chain
`record_payment` write — that mutation (`useRecordPayment`) was deferred, so there was no
submit/confirm action, only the live preview. The write now exists and signs `Minter.repay`, see below.

### Recording a payment — `Minter.repay` (#1712)

Record Coupon and Record Repayment sign the Minter's `repay`, not the executor's `record_payment`: the registry accepts `record_payment` only from the Minter, so the executor path always failed at simulation with the AccessManager's `Error(Contract, #1)`. The full contract, roles and side effects are in [loan-repay-minter.md](../product-specs/loan-repay-minter.md).

- `useRecordPayment` calls `repay` from `@pipeline/wallet-connect` with `caller` = the connected wallet (also the transaction source), `loan_id`, the `RepaymentData` payload verbatim (`recordPaymentInput`), `value_date`, `ref_hash` and `sale_id = 0`.
- `value_date` is the UTC-midnight Unix seconds of the page date (`dateInputToValueDate`; the date is fixed to today, #916).
- `ref_hash` is `sha256("pipeline:repay:{registryId}:{loanId}:{next_repayment_id}")` as lowercase hex; `next_repayment_id` is read from `LoanRegistry.mutable_loan_data(loan_id)` just before the transaction is built. There is no input field for it. A second submit for the same slot fails at simulation (`RefHashSeen`).
- The hook is gated on `VITE_STELLAR_YIELD_MINTER_ID` and `VITE_STELLAR_LOAN_REGISTRY_ID` (the executor id is no longer used for this action) and keeps the "not configured for this environment" copy.
- The signature also books Minter bank cash and mints PLUSD (interest to sPLUSD, fees staked for the capital wallet). The "Your key · no cash moves" chip and the "Record on the ledger" wording are unchanged: no USDC leaves the trustee wallet.
- The trustee wallet must hold `CASH_REPORTER` with delay 0. The page reads `can_call` first (#1762, [Cash reporter bookings](#cash-reporter-bookings)) and disables the submit with the role reason, so a Trustee-only wallet never reaches simulation or a signature request. A loan not yet disbursed on chain fails with registry `#3`; disburse it from the loan detail ([Disburse](#disburse-1898)).
- Error copy stays the generic `toUserError` mapping; Minter and registry codes collide (a nested registry `#1` surfaces as `Error(Contract, #1)`), so no code-specific copy is added.
- **EVM arm (#1574).** `useRecordPayment` takes the loan's `chainId`. On `ENV.EVM_CHAIN_ID` it reads `readEvmNextRepaymentId({ registry, loanId })`, derives `evmRepaymentRefHash` (`0x` + `sha256("pipeline:repay:{EIP-55 registry}:{loanId}:{next_repayment_id}")`, the Stellar preimage with the checksummed address) and calls `repayEvmLoan`: a direct `PipelineMinter.repay(loanId, repaymentData, valueDate, refHash, 0)` from the wallet, the mirror of Stellar's direct `Minter.repay` (user decision 2026-11-19). The Minter's `restricted` checks `canCall(msg.sender, minter, repay)` (`MINT_CALLER_ROLE`, delay 0), so a wallet without it fails with `AccessManagedUnauthorized`. The repayment id comes from the Minter's `CashRepaid` receipt log (a receipt has no return value). Config: `VITE_EVM_MINTER_ADDRESS` and `VITE_EVM_LOAN_REGISTRY_ADDRESS`, same "not configured" copy. `repay` is `whenNotPaused` and needs the registered deal (`DealTokenFactoryNotRegistered` otherwise); both show in the details under the generic simulate copy. Amounts are the served 6-dp fields, never scaled in the browser. Other chain ids keep the Stellar-only gate.

### Cash reporter bookings

Spec: [cash-reporter-bookings.md](../product-specs/cash-reporter-bookings.md) (#1762). The minter's `record_wire_in`, `repay` and `record_income` are Cash reporter functions, separate from the Trustee role.

- `useCashReporterAccess(fn, enabled, chainId?)` reads `AccessManager.can_call(wallet, minter, fn)` on Stellar (`ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `ENV.STELLAR_YIELD_MINTER_ID`), and `canCall(wallet, minter, selector)` on `ENV.EVM_CHAIN_ID` (`readEvmCanCall`, `ENV.EVM_ACCESS_MANAGER_ADDRESS`, `ENV.EVM_MINTER_ADDRESS`; the selector comes from `EVM_CASH_REPORTER_SELECTORS`, today only `repay` = `0x87d2050a`, `MINT_CALLER_ROLE`). A function with no EVM selector stays unconfigured and callers pass `enabled = false` on EVM. Key `["cash-reporter-access", wallet, fn]`, `staleTime` 30 s, no retry. It returns `reason` from `cashReporterReason` (`lib/cashReporter.ts`); `null` only when `immediate` is true.
- Reasons: pending "Checking this wallet's Cash reporter role…"; read error "Could not verify this wallet's Cash reporter role." (details stay in the console); `immediate: false` with `delay > 0` "This wallet holds the Cash reporter role with a {h} h delay; the minter accepts only immediate calls."; otherwise the per-function copy: `record_wire_in` "Only the Cash reporter can book incoming wires.", `repay` "Only the Cash reporter can book repayments.", `record_income` "Only the Cash reporter can book bank income."
- Mint PLUSD: the role reason sits after the wallet and minter-configured reasons and before the receiver reasons. The capital-wallet fallback receiver is unchanged.
- Record Coupon / Record Repayment: `roleBlockedReason` is rendered as `record-coupon-role-blocked` / `record-repayment-role-blocked` beside the on-chain reason, and `recordPaymentInput` is `null` while it is set. The role read runs for the loan's chain (Stellar and `ENV.EVM_CHAIN_ID`); an unknown chain shows only the Stellar-only reason (no read). Close-loan (Trustee role) is not gated by it.
- Bank income: see [Bank income tab](#bank-income-tab-1762).
- Two-signer (2-of-2) Cash reporter signing is deferred to a follow-up issue; on both testnets the role is held by single accounts.

### EVM (#1574)

Rollover, Update lifecycle, Close loan, Record coupon / repayment (and recovery step 2) and Disburse run on `ENV.EVM_CHAIN_ID` with the same hooks, pages, dialogs, test ids and copy as on Stellar; the human directive is "everything must be the same as on Stellar, the same approach". The arm is picked by the loan's `chain_id` (`pickChainWallet`), each mutation input carries `chainId`, and `loanActionChainReason` is the one gate ([Chain gate](#wired-actions)). EVM-arm guards run before any RPC call, in this order: chain reason, config ("not configured for this environment", unchanged copy), then "EVM wallet not connected." (mapped by `toUserError` to "Connect your trustee wallet to approve on-chain."). The signing chain is `ENV.EVM_CHAIN_ID`; stages, return shape, invalidations and the 5 s / 15 s re-invalidation are unchanged.

- **Lifecycle writes** go through `AccessManager.execute(registry, calldata)`, `value 0`, with `sendEvmContractCallChecked` (`rolloverEvmLoan`, `updateEvmMutable`, `closeEvmLoan`): `rollover(uint256,uint32,uint64)` `0x0971a074` (rate bps × 100), `updateMutable(uint256,uint8,string)` `0x206293ef` (status ordinal from `EVM_LOAN_STATUSES`, URI verbatim), `closeLoan(uint256,uint8)` `0xd0cdfd5a` (`ScheduledMaturity` 1, `EarlyRepayment` 2). Role: `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, delay 0; no `canCall` pre-read and no schedule path, as on Stellar. `useLoanMutableState` reads `readEvmLoanChainState` (same `{ status, metadataUri }`, same key).
- **Simulate before sign.** `sendEvmContractCallChecked(label, params)` rethrows a contract revert raised before `awaiting-signature` as `"<label>: simulation error: <message>"`; wallet rejections, switch-chain rejections, RPC errors and receipt reverts pass through. `toUserError` maps it to the same copy as Stellar's `"<fn> simulation error"`: "Could not verify this action on-chain. No signature was requested — safe to retry."; the details carry the decoded custom-error name.
- **Encoders validate before any RPC call** (`<encoder>: invalid <field> <value>`): safe non-negative ids, `newRateBps` 1 to 10 000, `newMaturity` above 0, status and reason names from the enums (`None` refused), `valueDate` positive, `saleId` non-negative, `RepaymentData` fields digit strings within `uint256`, `refHash` `0x` + 64 hex and not zero.
- **One preflight (#2060).** The EVM arm of Rollover, Update lifecycle, Close loan, Record payment, Disburse and Approve & draw, and of the Risk Council relay and execute, goes through `evmPreflight` (`lib/evmPreflight.ts`): chain gate, then config, then "EVM wallet not connected."; it hands `ENV.EVM_CHAIN_ID` to the writer, whose `sendEvmContractCall` switches the network. Messages and order are unchanged.
- **Hoodi check (2026-11-19, read only, nothing submitted).** The three registry selectors and `repay` are present in the live implementations (LoanRegistry impl `0x5996682A…6bfCE`, Minter impl `0x0DaC8ed8…74eBf`); `AM.execute(registry, …)` from the trustee wallet `0x96ef…c04e4` passes the AccessManager and reaches the registry (`LoanRegistryNonExistentLoanId`, the registry has no loans); `repay` from a wallet without `MINT_CALLER_ROLE` reverts `AccessManagedUnauthorized`; `AM.execute(minter, disburse(...))` reaches `MinterInsufficientBankCash` (`bankCash() = 0`). `0x96ef…c04e4` holds `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, `MINT_CALLER_ROLE` and `MINTER_OPS_ROLE`; `0xd3b9…a57c` holds only the first.

**Differences from Stellar** (everything not listed is identical):

| # | Area | Stellar | EVM (#1574) |
|---|---|---|---|
| 1 | Chain gate | none (Stellar always open) | `loanActionChainReason`: open on `ENV.EVM_CHAIN_ID`; another non-Stellar id keeps the Stellar-only copy |
| 2 | Lifecycle call | `executor.execute(registry, "rollover" \| "update_mutable" \| "close_loan", args, caller)` | `AccessManager.execute(registry, calldata)`, `value 0`, caller = `msg.sender` |
| 3 | Repay call | direct `Minter.repay(caller, …)`; the Minter checks `can_call(caller)` | direct `PipelineMinter.repay(…)`; `restricted` checks `canCall(msg.sender)`; no `caller` arg (user decision 2026-11-19) |
| 4 | Rollover args | `[u32 id, u32 bps×100, u64 maturity]` | `(uint256, uint32 bps×100, uint64)` |
| 5 | Update-mutable args | `[u32, LoanStatus scvVec([symbol]), String]` | `(uint256, uint8 ordinal, string)` |
| 6 | Close-loan args | `[u32, ClosureReason scvVec([symbol])]` | `(uint256, uint8)`; `ScheduledMaturity` 1, `EarlyRepayment` 2 (EVM has `Cancelled` at 3) |
| 7 | Repay args | `[Address caller, u32, RepaymentData map (sorted keys, u128), u64, BytesN<32>, u32 sale_id]` | `(uint256, tuple in struct order 7×uint256, uint64, bytes32, uint256 saleId)` |
| 8 | Money units | `RepaymentData` 7-dp base units | 6-dp base units, both served by `/waterfall` at `chainAmountDecimals`, never scaled in the browser |
| 9 | Input validation | only `encodeRepayArgs` validates | the repay rules plus `uint256` bounds; lifecycle encoders validate id, `rateBps` 1 to 10 000, maturity, enum names |
| 10 | Simulate-failure message | `"<fn> simulation error: <Soroban error>"` | a revert before `awaiting-signature` becomes `"<fnEvm>: simulation error: <viem message>"`; same user copy |
| 11 | Stages / button label | `awaiting-signature` during simulate, then `submitting`, `confirming` | no stage during simulate, then `awaiting-signature`, `confirming`; no `submitting` (one EVM call signs and broadcasts) |
| 12 | Signing | Stellar wallet `signTransaction`, tx source = caller | EVM wallet; wrong network switches to `ENV.EVM_CHAIN_ID` first; mock wallets refused |
| 13 | Next repayment id | Soroban `mutable_loan_data(u32).next_repayment_id` | `readEvmNextRepaymentId` |
| 14 | `ref_hash` | `sha256("pipeline:repay:{registryId}:{loanId}:{next}")`, 64 hex | `0x` + `sha256("pipeline:repay:{EIP-55 registry}:{loanId}:{next}")` |
| 15 | Repayment id result | return value, then the `cash_repaid` event | `CashRepaid` log of the configured Minter in the receipt; `uint256` to `number` if safe, else `null` |
| 16 | Record-page role read | `can_call(wallet, minter, "repay")` (`CASH_REPORTER`) | `canCall(wallet, minter, 0x87d2050a)` (`MINT_CALLER_ROLE`); same copy |
| 17 | Lifecycle role | `TRUSTEE`, immediate | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, delay 0 on Hoodi; no pre-read on either chain |
| 18 | Pause | Stellar `repay` has no pause check | `repay` and the registry functions are `whenNotPaused`; `EnforcedPause` shows in the details |
| 19 | Update-lifecycle chain read | `readLoanChainState` | `readEvmLoanChainState` (ordinals mapped to the same names) |
| 20 | Error decoding | Soroban codes, no code-specific copy for these | custom-error names in the details, no name-specific copy (Disburse is the exception, row 32) |
| 21 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`, `VITE_STELLAR_YIELD_MINTER_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS` |
| 22 | Wallet guard (raw) | "Stellar wallet not connected." | "EVM wallet not connected." (same mapped copy) |
| 23 | Disburse call | `AM.execute(minter, "disburse", [u32, i128, u64, BytesN<32>], caller)` (Minter is `only_owner`) | `AccessManager.execute(minter, disburse(uint256,uint256,uint64,bytes32))`, `value 0` |
| 24 | Disburse role | `TRUSTEE` via `can_call(caller, minter, "disburse")` | `MINTER_OPS_ROLE` via `canCall(wallet, minter, 0x1d492b02)`; copy still says "Trustee role" |
| 25 | Disburse `ref_hash` | `sha256(reference.trim())`, 64 hex; zero rejected | `0x` + the same digest; zero rejected |
| 26 | Disburse amount units | 7 dp | 6 dp via `chainAmountDecimals`; "up to 6 decimals" |
| 27 | Disburse loan read | Soroban `mutable_loan_data` + `immutable_loan_data` | `mutableLoanData` + `immutableLoanData` (ordinal to name) |
| 28 | Deal read | `readDeal`; `useDeal` | `readEvmDeal`; a separate `useEvmDeal` with its own `["evm-deal-token", …]` cache, used by Disburse, Register debt token and the Debt token row (through `useLoanDeal`, #1892) |
| 29 | DEBT trustline step | `owner_of` + SAC `authorized(holder)` | skipped (`trustline: null`) |
| 30 | Bank cash / ref-seen reads | `readMinterPoolState` / `readRefHashSeen` | `readEvmMinterBankCash` / `readEvmRefHashSeen`: legacy views, `extsload` fallback on a `150631a` Minter |
| 31 | Paused read | `readMinterPaused` | `paused()` view on the Minter |
| 32 | Disburse errors | Soroban codes (`1000`, `7`, `8`, `6`/`25`, `13`, `3`/`2`, `21`) | the same copy keyed by custom-error name, plus `DealTokenFactoryNotRegistered` |
| 33 | Disburse config | the four `VITE_STELLAR_*` ids | `VITE_EVM_MINTER_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, new `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` |

Not in the app: booking EVM bank cash (#1501), scheduling a lifecycle write.

### Scale handling (both flows; verified against `-useLoanDetail.ts` / `useLoanWaterfall.ts`)

- The `/waterfall` `amount` param and all response fields (`senior_principal_returned`,
  `senior_coupon_net`, `management_fee`, `performance_fee`, `oet_allocation`) are **raw base units
  at the loan's chain decimals** — 7 for Stellar SAC USDC, 6 for EVM USDC (#1603;
  `chainAmountDecimals(chainId)` in `lib/targetChains.ts`). Both presenters resolve the decimals
  from the route's `chain`: `usdToBaseUnits(input, decimals)` multiplies the entered USD amount by
  10^decimals before calling the endpoint; `baseUnitsToUsd(value, decimals)` divides response
  fields the same way for display. The EVM write signs the same served fields (6 dp), so the browser never rescales. The `Minter.repay` payload uses backend
  raw fields unchanged.
- `senior_outstanding` (`useLoanBook`) / `offtaker_outstanding` (`useLoanFinancials`) are
  displayed **exactly as the backend serves them** — no client-side rescaling (issue #906; the
  former ×1000 `scaleRegistryAmount` workaround has been removed).
- `Gross interest` is derived as `senior_coupon_net + management_fee + performance_fee` (summed in
  base units via `BigInt` — no float drift — then converted once to USD) — the interest before the
  fee carve-outs, not a separately-served field.
- The green summary's `"Components sum to received $<amount>"` prints the **entered** USD amount,
  not a re-derived sum of the five/six components (the waterfall has no equity field, so the
  components alone do not sum to the offtaker amount without the residual — see below).

### Record action gating (#1622, both flows)

- The `RepaymentData` payload (`recordPaymentInput`) is built only from the **settled** amount: the live input must equal the 400 ms-debounced value (`amountSettled`) and the waterfall preview for that value must have resolved. Otherwise it is `null`, so the payload can never carry an amount other than the one the preview was computed for.
- "Record on the ledger" is disabled while the live input differs from the debounced value (including when the input is cleared mid-debounce) or while the preview is recalculating (`waterfall.isCalculating`).
- The green "Components sum to received $X" summary and the Record Coupon principal-block notice are hidden while the amount is unsettled, matching the row skeletons (#1049). The "Offtaker still owed after coupon" row deliberately keeps tracking the live input.
- Record Repayment's amount is a read-only one-shot prefill, so the stale window is unreachable there today (during the prefill debounce the debounced amount is `""`, so the payload is `null`). The same gate is applied for parity, so a future editable input cannot reintroduce the bug.

### Record Coupon — interest-only, context-dependent third row

- The left card's third row is context-dependent (`hasCouponDue`): a simply-performing loan with
  no upcoming/past-due payment shows the backend-served **"Offtaker still owed after coupon"**
  (`offtaker_outstanding − entered`); otherwise it shows the **"Scheduled coupon"** — a
  **client-side projection** (`current_apy_bps × senior_outstanding × (days / 365)`,
  `computeScheduledCoupon`; the backend serves no scheduled-coupon figure), shown for reference
  only and never recorded on the ledger.
- This is the **interest-only coupon** flow: `buildRepaymentInput` always sets
  `senior_principal_repaid = "0"` (principal stays deployed). Interest + fee carve-outs map 1:1;
  `equity_distributed` is the residual after interest + fees so the six components sum exactly to
  `offtaker_received` (clamped at 0 — never negative).
- **Principal-block rule (#1623):** the backend waterfall (`waterfall.rs`, stage 4) cascades
  interest, then OET, then senior principal, then equity, so `senior_principal_returned` is
  non-zero only when the entered amount exceeds interest + OET while senior principal is still
  outstanding. A coupon cannot carry that principal (it would land in `equity_distributed` while
  the screen said it repaid senior), so when the served `senior_principal_returned` is non-zero
  (`coversSeniorPrincipal`, no client-side threshold arithmetic) the coupon is **not recordable**:
  `recordPaymentInput` is `null`, the green summary is hidden, and the page shows the
  `record-coupon-principal-block` notice with the served principal amount and a link to Record
  Repayment (keeping `chain`). Principal is never moved into equity, so Record Repayment can still
  amortise the senior and the loan stays closable. When senior is already fully repaid the
  waterfall returns principal `0` and the residual legitimately goes to equity, so the coupon
  stays recordable. A wire larger than interest + OET but smaller than the full offtaker balance
  cannot be recorded on either page (no partial principal repayments).

### Record Repayment — Principal (#884) — key difference from Record Coupon

This is a **principal repayment**: the waterfall's real `senior_principal_returned` is displayed
AND carried into `senior_principal_repaid` verbatim (the coupon flow forces it to `"0"`). Equity is
the residual after all five carve-outs (principal + interest + fees) — clamped at 0, never
negative — so the six components still sum exactly to `offtaker_received`. The amount input is
prefilled (one-shot, then read-only) to the full remaining `offtaker_outstanding` once financials
load — a principal repayment always pays it all; there are no partial principal repayments.
The prefill (`prefillAmountInput`) is exact to the served 6-dp `offtaker_outstanding` string:
validated, trailing fractional zeros trimmed (`"6150000.000000"` → `6,150,000`), then grouped, with
no float round-trip. Stellar USDC has 7 dp while `/financials` serves a 6-dp truncated value, so a
residue of up to 9 raw units (at most $0.0000009) can remain. This is intended: the served value
then reads `0.000000`, the fully-paid gate opens, and `close_loan` waives the residue (#1626).

Once the loan is fully repaid, the page also exposes a **Close loan** action (`useCloseLoan`) that
moves the loan to `Closed`.

**Offtaker fully paid (#1090):** when the financials' `offtaker_outstanding` is `0` — the offtaker
owes nothing, e.g. the final coupon was recorded in the sibling flow — there is nothing left to
record. The presenter's `offtakerFullyPaid` collapses the entered amount (including a stale
pre-refetch prefill), keeps the waterfall query disabled, and forces `recordPaymentInput` to
`null`; the page replaces the amount/date fields, waterfall, and Record action with a fully-repaid
notice ("nothing left to record"). The state must hold **without a reload** — a refetch that
brings owed to `0` mid-session drops the stale form rather than leaving a recordable amount on
screen. It is suppressed while this page's own repay is pending/settled so the
"Payment recorded" confirmation flow stays intact. Whether Close-loan enables is decided by the
close checklist below, not by this state alone. When the loan-book `senior_outstanding` is still
above `0` in this state (a loan stranded by an earlier over-sized coupon), the notice is followed
by a muted `record-repayment-senior-outstanding` line: "Senior principal of $X is still
outstanding on-chain, so this loan can't be closed from the app." followed by an "Open repayment
recovery" link (`record-repayment-recovery-link`) to the loan detail page, where the Repayment
recovery card lives (#1711). It is informational only and changes no gating; the recovery procedure (Minter reverse then corrected repay, roles, limits) is in [loan-repayment-recovery.md](../product-specs/loan-repayment-recovery.md) (#1655).

### Close-loan gating — the close checklist (#1090, supersedes the #884 gate)

The Close-loan action always renders as the full-width "Next step — close loan" item, above a
three-item checklist (`closeChecklist` on the presenter). The button enables only when **every**
item is green:

1. **Senior principal outstanding is zero** — hard gate. Green only when the refreshed
   loan-book's `senior_outstanding` is `0`. This page's own repay success does **not**
   turn it green: a shortfall repayment succeeds on-chain but leaves senior outstanding, and
   `close_loan` would revert (#1624). The unmet row shows the current outstanding amount until the
   refetch lands.
2. **Nothing left to mint on either leg** — hard gate, **no manual override**. Green when the
   financials' `not_minted_yield` is `0` (the aggregate covers both mint legs — no per-leg field
   is served). Minter repayments mint atomically, so after recording a final payment
   this clears once the repayment is indexed; the unmet row shows the unminted amount.
3. **Remaining offtaker balance acknowledged** — auto-green when the received cash covers the
   contracted price (`offtaker_outstanding` is `0`). Otherwise (early payoff or waiver) the row
   renders a checkbox the trustee ticks manually; the tick is page-local and does not persist a
   reload.

`closureReason` picks `"ScheduledMaturity"` when `now >= maturity` (the loan-book's
rollover-aware `maturity`), else `"EarlyRepayment"`. The former `isTerminalRepayment` /
`alreadyRepaid` / `showCloseLoan` gate (#884) is removed from this flow — the checklist is the
single source of enablement. The full S15 benign close-loan checklist screen remains tracked in
#982; this checklist is its gating core, embedded on the Record Repayment page.

On success, `useCloseLoan` invalidates the loan-book/financials queries immediately and again at
5 s and 15 s (#1092) — the close is indexed asynchronously, so the immediate refetch races the
indexer and the next `refetchInterval` poll is 30 s out; the delayed re-invalidations make the
post-close loan detail converge in seconds instead of appearing stale.

On success, `useRecordPayment` likewise invalidates loan-book/financials immediately and again at
5 s and 15 s (#1624), so a full repayment's zeroed senior outstanding reaches the checklist within
seconds.

### Route registration & page shell

Both flows are full-screen pages, not modals, so each lives at its own route rather than inside
`loans.$id.tsx`: opened from the existing "Record coupon" / "Close loan" other-actions on the loan
detail page. Each is registered as a **non-nested** child of the `/loans` layout (`loans.tsx`'s
`<Outlet/>`) via the `$id_` trailing-underscore file-name escape — `loans.$id.tsx` is a leaf page
with no `<Outlet/>` of its own, so a plain `loans.$id.record-coupon.tsx` would try to nest under it
and fail to register (same class of issue `loans.tsx`'s own doc comment describes for `/loans/$id`
itself). Per `docs/FRONTEND.md` rule 2, each `.tsx` is JSX/styling only; all data wiring lives in
the colocated `-record-*.ts` view-model hook (mirrors `origination.$id.tsx` /
`-origination-detail.ts`). Both routes validate the `chain` search param (`parseLoanRouteSearch`,
#1537) and pass it to `useRecordCoupon(chainId, loanId)` / `useRecordRepayment(chainId, loanId)`;
the back link and the post-success navigation keep it.

The "Close loan" other-action does **not** close the loan directly — it opens the Record Repayment
page, where the trustee records the final principal repayment and only then closes the loan
(`useCloseLoan`, `close_loan`, with the resolved `ClosureReason`), navigating back to the loan
detail page on success.

**Chips (never-fabricate):** only the static "Your key · no cash moves" copy chip renders on
either page. The Figma's "Recorded · 31 Mar" / "Minted · 2 Apr" progress chips are omitted
entirely — no backend source ever marks a coupon/repayment "recorded"/"minted" in this session, so
they would be fabricated.

**Suppressed "Next stage: principal repayment" button** (Record Coupon only): per the issue's
explicit scope note, the Figma's button is never rendered. A coupon that would include senior
principal shows the principal-block notice instead (see Principal-block rule above, #1623); every
other coupon shows no principal-repayment copy at all.

### Waterfall error mapping (#916)

`mapWaterfallError` never surfaces the raw backend message or numbers. The backend's extended
waterfall validates the amount against the loan's terms and returns a client error (4xx) when it
doesn't fit (e.g. an amount too large for the loan's interest rate / outstanding) — mapped to
"This amount is too high for this loan. Enter a smaller amount." A `chain_id` 400 (the loan's
chain is not served by the API) is the one 4xx that is **not** an amount problem: it falls
through to `toUserError`'s "This network isn't enabled on the server…" copy (#1602). Anything else
gets a generic retry message. Two 4xx cases are not plain amount problems (#1661): a 422 (the
loan's indexed event history is incomplete) reads "Loan data is incomplete — the indexer needs a
re-sync. Contact support."; a 400 whose message starts with `loan is in Default` reads "This loan is
in Default: a payment can only cover senior principal and accrued interest. Enter a smaller
amount." Neither message has numbers, and the raw server text sits only under "View details". The date input is fixed to today and not editable (#916) — no
calendar/date picker. The "Date received" field only displays today: both record flows call the
waterfall with `as_of` omitted, so the server uses its own `now` (the endpoint's documented
default). #1626 decided the earlier `T00:00:00Z` midnight `as_of` was unintended: it
under-accrued up to a day of interest and fees (waived at `close_loan`), and the backend returns
400 when `as_of` precedes origination, which midnight did for a loan drawn earlier the same day.

## Mock keys (manual QA)

The trustee `apiFetch` (issue #1306) checks localStorage before fetching, mirroring the LP
client's seam: `pipeline.mock.api.<METHOD>.<path>` (exact, query string included), then
`pipeline.mock.api.<METHOD>.<path-without-query>`. A present key's value is parsed as JSON and
returned with no network call; unparseable or absent keys fall through to the real fetch. Keys
live only in the developer's own browser — production paths are unaffected. Primary use: preview
states the backend cannot serve yet (e.g. LP Counterparties rows across all four Account Status
chips while `kyb_status` is monotone, #1274).

## LP Counterparties

**Sources:** `packages/trustee/src/api/useLps.ts` (data hook),
`packages/trustee/src/routes/-useLpCounterpartiesTable.ts` (presenter),
`packages/trustee/src/routes/lp-counterparties.index.tsx` (list view),
`packages/trustee/src/routes/lp-counterparties.$id.tsx` (live detail view, #1271),
`packages/trustee/src/components/detail/` (shared detail primitives, #1453).
**Consumer route:** `/lp-counterparties` (detail at `/lp-counterparties/$id`). Issues #1270 /
#1453, epic #1269 — **no Figma**: the epic has no LP-counterparties frame, so styling is derived
from the shipped `/loans` page (the design system, not a specific screen, is the source).

### Architecture

View/logic split per [`docs/FRONTEND.md` rule 2](../FRONTEND.md#code-structure-rules): the two
`.tsx` route files are JSX/styling only; `useLpCounterpartiesTable` owns the `useLps` call, the
403 pre-check, and the per-row mapping.

- `useLps` (`api/`) — React Query hook over `GET /v1/lps` (trustee-role-gated), 30 s poll, no query
  params. A hand-mirror of `packages/api/src/routes/lps.rs`'s `LpResponse`/`LpsResponse` (TD-42
  convention — the trustee app does not depend on `@pipeline/frontend`).
- `useLpCounterpartiesTable` (`routes/`) — presenter: `mapKybStatus`, `mapLpToRow`, and the
  `loading | error | empty | ready` state machine.

### Column mapping

| # | Header | Source | Rendering |
|---|---|---|---|
| 1 | Legal Entity Name | `legal_name` | verbatim; non-empty-string guard → `—` |
| 2 | Jurisdiction | `country` (nullable) | **verbatim**, no code→name mapping; `null`/empty → `—` |
| 3 | First Registration Date | `created_at` (ISO-8601 UTC) | `formatIsoDateUtc` → `"18 Jun 2026"` |
| 4 | Account Status | `kyb_status` | chip, mapping below |
| 5 | Blockchain Address Available | `stellar_address`, `address_linked_at`, `stellar_signer_address`, `evm_address`, `evm_address_linked_at`, `evm_signer_address` | `linkedAddressesLabel`: `No`, `Stellar`, `EVM` or `Stellar + EVM`; `(unproven)` after a chain whose signer is null (#1826) |
| 6 | Bank Info Available | *(none)* | always `—` until #1275 lands — **never** `No` |
| 7 | *(unlabeled)* | — | 34px trailing `›` chevron, `aria-hidden`, Loan Book precedent |

Rows are consumed in served order — `lp_repo::list()` is `ORDER BY created_at DESC, id DESC`. No
client-side sort, no search, no pagination, no ledger column (`GET /v1/lps/{id}/bank-deposits` is the detail page's — see
[LP bank deposits](#lp-bank-deposits)).

### Account Status mapping

| served `kyb_status` | chip label | band |
|---|---|---|
| `NotStarted` | New | neutral |
| `InProgress` | KYB Pending | attention |
| `UnderReview` | KYB Pending | info |
| `Passed` | Approved | positive |
| `Failed` | **Rejected** | negative |
| `ChangesRequested` | Changes requested | attention |
| anything else | the raw string, verbatim | neutral |

`Failed → "Rejected"` is a proposed resolution for the epic's open question 1 (not yet
human-confirmed): the requirements enumerate the happy path (New / KYB Pending / Approved) and are
silent on `Failed`; folding a failed KYB into any of those three would misinform the trustee.
"Rejected" already exists in this app's chip vocabulary with a negative band (the Origination
table's `OriginationRowStatus` `rejected` kind). The unknown → verbatim/neutral fallback mirrors
the loan `statusToChip` rule (see "Origination & review" below).

`UnderReview → info` (#1453): the band vocabulary is now the Loan-detail `StatusBand`, where
`info` (brand) means "an action is in flight" — the trustee owns the next move. `InProgress`
stays `attention` (the LP still owes documents). Labels did not change.

Band → colour, matching the Loans/Loan-detail chip literals: neutral
`var(--color-pipeline-ink-muted)`, attention `#6e6400`, positive
`var(--color-pipeline-positive-primary)`, negative `#b20000`, info
`var(--color-pipeline-brand)`.

### Match an incoming wire by reference

**Sources:** `routes/-PaymentReferenceLookup.tsx` (card), `routes/-usePaymentReferenceLookup.ts`
(presenter), `api/useLps.ts` (`fetchLpsByPaymentDetails`, `useFindLpByPaymentDetails`). Issue #1887;
backend rule in [deposits.md](../product-specs/deposits.md#wire-matching-by-payment-reference). No
Figma; built from the detail primitives.

The list page has no client-side sort, pagination or table search. A **Match an incoming wire**
card sits between the title and the table (rendered in the loading, error and ready states): one
input, **LP payment reference** (placeholder `PL-XXXX-XXXX-XXXX`), and **Find LP**
(`lp-lookup-submit`), disabled while the trimmed value is blank or a lookup is in flight. The value
is never sent blank (the server lists every LP for a blank filter) and never canonicalised or
format-checked here; the server ignores case, whitespace and hyphens. Submit calls
`GET /v1/lps?payment_details=<trimmed, encoded>`:

- One LP → navigate to `/lp-counterparties/{id}?paymentDetails=<trimmed>`. The detail route
  validates the param (non-blank string, else dropped), opens the Record-deposit dialog once with
  **LP payment reference** pre-filled, then clears the param with a `replace` navigation so refresh
  or Back does not reopen it. More than one LP (contract says at most one) is shown as the generic
  error and navigates nowhere.
- `[]` → `lp-lookup-not-found`: "No LP was issued this reference. The Cash reporter books the wire
  to escrow; assign it to its lender or return it from Escrowed wires." The last words link to
  `/cash-management?tab=escrow`.
- `400` → "This is not a valid LP payment reference." with the served text in details; `401` "Your
  session expired. Sign in again."; `403` "Your trustee account is not authorized to look up LPs.";
  anything else the generic connection copy.

The #1763 escrow **assign** picker could reuse the lookup; that is a possible follow-up, not part of
#1887.

### Never-fabricate notes

- **Bank Info Available renders `—`, never `No`, until #1275.** No backend field exists yet for
  bank-requisites; `No` would fabricate a fact about the counterparty ("has not supplied bank
  details") that the absence of a field does not establish.
- **`country` is rendered verbatim, never normalised.** The LP app now offers a
  dropdown of common English country names from flagcdn (#1715) but falls back to free text when
  the list cannot load, and the API still accepts any string. Rows may therefore hold common names,
  older codes or free text such as `"CH"`. The column stays verbatim, with no mapping.

### Row click

Rows are fully clickable (pointer cursor, `tabIndex={0}`, Enter/Space, descriptive `aria-label`,
trailing chevron) and navigate to `/lp-counterparties/$id` — a structural copy of `LoanRow` in
`loans.index.tsx`. The detail route fetches `GET /v1/lps/{id}` independently of the list.

### Detail view (#1271, restyled onto the Loan-detail conventions by #1453)

The page is assembled from the [shared detail primitives](#shared-detail-primitives), so
`/lp-counterparties/$id` and `/loans/$id` are one visual system rather than two look-alikes:

- **Shell** — `max-w-[1180px]`, `px-[56px] pt-[39px] pb-[80px]`, `gap-[16px]` column (the loan
  page's `<main>`).
- **Hero** — `DetailHero` with `backTo="/lp-counterparties"`, back label `‹ LP Counterparties`,
  the served `legal_name` as the 44px `h1` (`LP <id>` only while no record is served — never
  fabricated), then the status chip (`lp-detail-status-chip`) and the meta line
  (`lp-detail-meta`). Meta is built by `lpHeroMeta` in `-useLpCounterpartyDetail.ts` as
  `Jurisdiction · Registered <date> · Submitted <date> · Decided <date>`; a clause whose value is
  not served is **dropped entirely**, never printed as `—` (same rule as the loan hero).
- **LP profile** + **KYB review** — two `DetailCard`s in one
  `grid grid-cols-1 gap-[16px] min-[900px]:grid-cols-2` row, so they sit side by side on a desk
  window and stack below 900px (design feedback on #1453: one tall key/value list buried the
  review state). **LP profile** holds the registration record — Legal name, Jurisdiction, Contact
  email, Registered, then one settlement-address row per linked address ([Settlement addresses](#settlement-addresses); a single `Settlement address` row reading `—` when none). **KYB review** holds the review record — Status (a
  `StatusChip`, `lp-kyb-review-chip`, the same band as the hero chip), Submitted for review,
  Latest decision date, Reviewer, Latest decision reason. Absent values render `—`; the decision
  reason keeps `whitespace-pre-wrap`.
- **Reviewer renders `—`, always — it is not served.** `LpResponse` deliberately withholds
  `kyb_decided_by` (`packages/api/src/routes/lps.rs`: it identifies the deciding operator and is
  never returned). The row is kept so the card states the shape of the review record, and follows
  the same never-fabricate rule as Bank Info Available on the list: the value is absent, so it
  prints `—` rather than a guess derived from the documents' `reviewed_by`.
- **Settlement bank account** — a full-width `DetailCard` (`lp-bank-account`) between the profile / KYB
  grid and the documents card, so the reviewer reads it beside the documents. With
  `settlement_bank_account_details` it shows the account ([Settlement bank account](#settlement-bank-account));
  without it, "No settlement bank account on file." (`lp-bank-account-empty`). The masked summary is not
  rendered. The three LP-level verdict dialogs (Confirm KYB passed, Request changes, Reject account) repeat
  the account in a bordered block (`lp-review-bank-*`) and, on Passed, add "Passing KYB also verifies this
  settlement bank account."; with no account they read "No settlement bank account on file." and nothing is
  blocked. Document Verify / Reject dialogs show no account.
- **KYB documents** — `DetailCard` whose title row carries the account verdicts and the refresh
  control, left to right: **Reject account** (`BandButton`, negative), **Request changes**
  (attention), **Confirm KYB passed** (positive, rendered only when `canPass`), then the 40×40
  `@pipeline/ui` `IconButton` labelled **Refresh documents** (`RefreshIcon`; the presigned
  download links expire). When the LP is not UnderReview the three verdicts are replaced in that
  row by the gating note at 13px ink-muted; the "Verify every submitted document before confirming
  KYB passed." note renders under the title row. Each document row is prefixed with the loan
  Documents card's 32px document tile, separated by a `LINE_COLOR` rule, and keeps the filename,
  the bytes/type/status line, the uploaded/reviewed/reviewer line (reviewer key as an
  `AddressChip`) and the rejection reason (negative red). Its right-hand cluster is the 32px
  download `<a>` (`DownloadIcon`, brand, `aria-label="Download <filename>"`, still the real
  presigned link opened in a new tab) — or the "Download unavailable. Refresh to retry." text when
  no URL is served — followed, while the document is reviewable, by the 32px `BandButton`s
  **Verify** (positive) and **Reject** (negative). Each carries its glyph before the label —
  `CheckIcon` on Verify, `CrossIcon` on Reject, 16px, `currentColor` so the glyph inherits the
  band colour, 6px gap (`BandButton`'s `icon` slot, rendered `aria-hidden`) — and is still
  announced as "Verify <filename>" / "Reject <filename>" (#1453 design feedback: the two text
  buttons were indistinguishable at a glance). Empty state: "No documents submitted."
- **There is no KYB decision card.** It held only buttons, so #1453's design feedback moved them
  onto the documents title row — the documents are what the verdict is about.
- **Bank deposits** — see [LP bank deposits](#lp-bank-deposits).
- **Buttons** — three shapes. Page-level `@pipeline/ui` `Button` at `size="m"` (40px, 4px radius)
  for Retry, Record deposit and every dialog action: primary is `variant="primary-blue"`
  (the loan page's brand primary), secondary is `variant="secondary"` plus
  `DETAIL_SECONDARY_BUTTON_CLASS` / `detailSecondaryButtonStyle()`, which add the white ground and
  the `LINE_COLOR` border the borderless shared variant lacks. Row-level actions are `BandButton`s —
  32px tall, the `chipStyle(band)` colours (band-coloured text and border over a light band fill),
  never a solid primary: the account verdicts read as positive / attention / negative at a glance,
  and the document verdicts carry their `CheckIcon` / `CrossIcon`. `BandButton` is for *verdicts*
  only — Mint PLUSD is a plain action, so it is the shared `Button` at `size="compact"` (32px
  brand primary), the same height as a `BandButton` but unmistakably a button (#1453 design
  feedback — the 40px bordered secondary was too heavy for a table row, and a band-coloured one
  read as a chip).
  Icon-only affordances are 40×40 (`IconButton`, page chrome) or 32×32 (`BandIconButton` and the
  download link, row-level), each carrying an explicit `aria-label`.

**Behaviour is unchanged by the restyle.** Document review is available only for Provided files
while the LP is UnderReview. Verify sends `Verified` without a reason; Reject requires a nonblank
reason and sends `Rejected`. Reviewed files cannot be reviewed again. LP verdicts are offered only
while UnderReview: Confirm KYB passed requires a nonempty list of entirely Verified documents;
Request changes reopens the record; Reject account is terminal and suspends the owner's account.
Each verdict confirmation accepts an optional reason up to 2,000 characters and explains the
consequence. Dialogs retain reason drafts on errors, prevent duplicate writes, and reset across LP
route changes.

Mutations invalidate the current LP detail and listing. Conflicts refresh both queries so
stale review actions disappear. Pending, 404, permission, expired session, and network states
have explicit feedback and retry; a session-expiry response clears the trustee session. The
error branch renders inside a `DetailCard` with the Retry action. The list's Bank Info column stays `—`
(not served on `GET /v1/lps`, #1275); bank deposits are below.

### Settlement addresses

Since #1824/#1831 an LP links a Stellar and an EVM settlement address, each with a signer, and may
relink at any time. `-settlementAddresses.ts` holds the pure presenters over the six served fields
(`stellar_address`, `address_linked_at`, `stellar_signer_address`, `evm_address`,
`evm_address_linked_at`, `evm_signer_address`; `GET /v1/lps` and `GET /v1/lps/{id}`).

- **Presence.** An address is linked when it is a non-empty string. The mint receiver additionally
  requires its `*_linked_at` to be non-null (see [LP bank deposits](#lp-bank-deposits)).
- **Unproven.** A null `*_signer_address` marks the address *Unproven*: it was linked before signed
  linking existed. The list suffixes `(unproven)`; the profile shows an attention `StatusChip`
  (`lp-settlement-{stellar|evm}-unproven`) instead of a signer.
- **Profile rows.** One `KeyValueRow` per linked address, Stellar first, labelled
  `{Stellar|EVM} settlement address`: the address as an `AddressChip`
  (`lp-settlement-{kind}`), `Signer` + `AddressChip` (`-signer`), and `Linked <date, UTC>` (`-linked-at`,
  `—` when not served). The signer is shown even when it equals the address: a separate signer
  proves control of the signer only (TD-162), so the Trustee must see which case applies.
- **History not shown.** `lp_settlement_address_history` has no Trustee read endpoint.

### Settlement bank account

Since #1886 the Trustee sees the LP's full account (`settlement_bank_account_details` on `GET /v1/lps/{id}`
and `POST /v1/lps/{id}/kyb`, `bank_account` on Pending `wire_outs[]`). `lib/settlementBankAccount.ts` is the
pure presenter and `BankAccountRows` the shared primitive for the LP detail card, the verdict dialogs, the
wire-out row and the settle dialog.

- **Rows, in order.** Account holder name, Bank name, Bank address, IBAN, Account number, SWIFT/BIC code,
  Routing number (ABA), labelled as in the LP app's #1885 module. Values show as served, `—` when null; no
  formatting, masking or derivation.
- **Copy.** IBAN, account number, SWIFT/BIC and routing number have a 32px copy button
  (`aria-label="Copy {label}"`). It writes the exact value and toasts "{label} copied"; a failed clipboard
  toasts nothing.
- **Privacy.** A value appears only as rendered text and in clipboard writes: never in a log, URL, `title`
  or `data-*` attribute, or toast. The disclosure state is keyed by wire-out id. The app has no analytics.
- **Wire-out states** (`wireOutBankAccountState`): `not-pending` (Settled or Cancelled), `unresolved` (no
  `lp_id`), `served` (`bank_account` present), `missing` (resolved lender, no account).
- **Out of scope.** No write path (changes after Passed are ops SQL, TD-182).

### Shared detail primitives

`packages/trustee/src/components/detail/` is the single definition site for the trustee's detail-page
look. Consumed by `loans.$id.tsx`, `lp-counterparties.$id.tsx`, `-LpBankDepositsSection.tsx`,
`-LpReviewDialog.tsx` and `lp-counterparties.index.tsx` (colour tokens only).

| file | exports |
|---|---|
| `detailTokens.ts` | `StatusBand`; `LINE_COLOR`, `INK`, `INK_MUTED`, `BRAND`, `POSITIVE_GREEN`, `ATTENTION_AMBER`, `NEGATIVE_RED`; `CARD_CLASS`, `cardStyle()`, `chipStyle(band)`; `DETAIL_SECONDARY_BUTTON_CLASS`, `detailSecondaryButtonStyle()`; `DETAIL_INPUT_CLASS` (dialog text input, #1887) |
| `StatusChip.tsx` | `StatusChip` — 4px radius, 1px border, 12px body, band-coloured, `data-band` for tests |
| `DetailCard.tsx` | `DetailCard` (card shell; renders a named `<section>` when given `ariaLabel`/`ariaLabelledBy`, a bare `<div>` otherwise) and `CardTitle` (26px display `h2`, optional `id`) |
| `KeyValueRow.tsx` | `KeyValueRow` — 15px muted label / 16px right-aligned value, `LINE_COLOR` divider unless `isLast` |
| `DetailHero.tsx` | `DetailHero` — back link → 44px `h1` → chip + meta row; `backTo`, `backLabel`, `title`, `status`, `meta`, `statusTestId`, `metaTestId` |
| `AddressChip.tsx` | `AddressChip` — click-to-reveal/copy chip for a `G…` / `C…` / `0x…` key (settlement addresses and signers, documents' reviewer); `shortAddress(value)`, `copyAddress(value)` |
| `AddressText.tsx` | `AddressText` — copy-to-toast plain-text key for table cells (no border, no inline reveal) |
| `BandButton.tsx` | `BandButton` (32px text button, optional leading `icon`) and `BandIconButton` (32×32 icon button), both painted with `chipStyle(band)` and carrying `data-band` for tests |
| `DetailIcons.tsx` | `RefreshIcon`, `DownloadIcon` (path data from `packages/ui/src/assets/icons/arrow-clock.svg` / `arrow-down-circle.svg`, repainted `currentColor`), `CheckIcon`, `CrossIcon`, `CopyIcon` (inline 16px stroked glyphs) |
| `BankAccountRows.tsx` | `BankAccountRows` — the seven settlement-bank-account `KeyValueRow`s with copy buttons ([Settlement bank account](#settlement-bank-account)); `details`, `testIdPrefix` |

**`RefreshIcon` carries no clock hands (#1453).** `arrow-clock.svg` ships two paths — the circular
arrow and a pair of clock hands inside it. Keeping both made the control read as *activity* or
*history*, not *refresh*. Only the circular-arrow path is kept; the hands path was dropped, so the
glyph says "fetch this again" and nothing else. The viewBox is unchanged, so the arrow keeps its
original proportions.

**`AddressChip` (#1453).** Stellar keys are 56 characters and were pushing every row they
appeared in out of shape. The chip renders `…` plus the **last five** characters (`…CQXS4`), keeps
the full value in its `title`, and is a `<button>`: the first click reveals the full value inline
and copies it with `navigator.clipboard.writeText`, flashing a muted "Copied" for 1.6 s; a second
click collapses it. A missing or rejecting clipboard is swallowed — the value still reveals, and
nothing claims a copy that did not happen. Used for settlement addresses, signers and the documents' reviewer
key. `lib/truncateAddress.ts` (head+tail form, sidebar wallet pill) is a different convention and
is deliberately left alone.

**`AddressText` (#1453 design feedback).** Inside a table the chip's inline reveal expands one
cell to 56 characters and tears the row grid apart, and the "Copied" flash shifts every column to
its right. `AddressText` is the table form of the same affordance: a borderless, fill-less
`<button>` rendering `shortAddress(value)` at the 16px body step, the full value in `title`, and a
click that copies through the shared `copyAddress` and reports the result as the
[toast](#toasts) "Address copied" — no inline reveal, no in-row state, so the row never reflows.
A failed or unavailable clipboard raises no toast. Used for the deposits table's `recorded_by`.

`StatusBand` is defined here and re-exported by `-useLoanDetail.ts`; `AccountStatusBand` in
`-useLpCounterpartiesTable.ts` is an alias of it, so both pages and the list share one band
vocabulary (`neutral | attention | positive | negative | info`).

**Why trustee-local and not `@pipeline/ui`.** These primitives are raw literals
(`rgba(56,55,53,0.18)`, `#262524`, the 44/26/15px display+body steps) that encode the trustee
design assignment, not the shared token system. Promoting them to `@pipeline/ui` would export
trustee styling to the LP and borrower apps. `SummaryTiles` and `OtherActionsCard` stay private to
`loans.$id.tsx` — the LP page has neither.

### LP bank deposits

The detail page carries a **Bank deposits** card (`-LpBankDepositsSection.tsx`, presenter
`-useLpBankDeposits.ts`, hooks `api/useLpBankDeposits.ts`) over `GET`/`POST
/v1/lps/{id}/bank-deposits` (#1413). No Figma; since #1453 the card is a
[`DetailCard` + `CardTitle`](#shared-detail-primitives) and the table uses the loan-page
typography (14px ink-muted `font-normal` headers, 16px `#262524` body cells, `LINE_COLOR` row
rules, amounts right-aligned `tabular-nums`, `overflow-x-auto` kept for narrow viewports). The
#1413/#1449 wiring — list, record, mint, disabled hints, pending window, error copy — is
untouched by that restyle. It renders at every KYB status — the endpoint does not gate on one.

**Column plan (#1453 design feedback).** The auto-layout table came out lopsided — Received took
whatever width it wanted and Amount was squeezed against the reference. The table is now
`table-fixed` over a `<colgroup>` with a fixed share per column, so the five columns read evenly
at the card width and keep those proportions as the card grows:

| column | width | cell |
|---|---|---|
| Received | 22% | `occurred_at` via `formatIsoDateTimeUtc` → `5 Oct 2026, 15:41 UTC`, `whitespace-nowrap` |
| Amount | 16% | right-aligned `tabular-nums`, `formatUsdDecimal` (exact, `$1,234,567.89`) |
| Bank reference | 26% | `payment_reference`, `break-all`, `ref_hash` as its `title`; under it the attribution chip (#1887): `Matched by reference` (info, `lp-deposit-matched`) with `{payment_details} · issued {issued_at}` (`lp-deposit-matched-ref`) when `matched_reference` is served, else `Attributed by hand` (neutral, `lp-deposit-hand`) |
| Recorded by | 18% | `recorded_by` as an [`AddressText`](#shared-detail-primitives) |
| PLUSD | 18% | the status cell below |

`min-w-[820px]` holds those shares legible before `overflow-x-auto` takes over.

**Amount is exact (#1626).** `formatUsdDecimal` renders the served 2-dp dollar string as
`$1,234,567.89`, never compact (`$1.23M`), because the trustee reconciles this figure against the
wire before minting. This reverses the #1453 "Amount uses the Loans-table formatter" note. The
column is `whitespace-nowrap`, so 9-digit amounts do not wrap at the 16% share.

- **List** — `GET`, 30 s poll, served order (newest first), no client sort. Columns per the plan
  above. Loading, empty ("No bank deposits recorded."), and error + Retry states.
- **Record deposit** — dialog (shares `useLpReviewDialog`'s focus trap/Escape) with Amount (USD),
  Bank reference (the bank's own reference, unique; relabelled from "Payment reference" by #1887),
  optional **LP payment reference** (`payment_details`, #1887) and Received at (UTC,
  `datetime-local` defaulting to now). Client checks mirror the API: amount > 0 with ≤ 2 decimals
  (grouping commas stripped), nonblank bank reference (sent trimmed), a valid non-future time sent
  as `…:00Z`. The LP payment reference is sent trimmed only when non-blank, never canonicalised or
  format-checked. It can be pre-filled from the lookup's `?paymentDetails=` param (see
  [Match an incoming wire by reference](#match-an-incoming-wire-by-reference)). Validation shows on
  submit; the dialog closes on `201` and keeps drafts on error. `409` reads "A deposit with this
  bank reference is already recorded." `422` shows the served `error` text verbatim; when the
  request carried `payment_details`, a second line "Wires that cannot be matched to an LP are
  booked to escrow by the Cash reporter." links to `/cash-management?tab=escrow`
  (`lp-deposit-escrow-link`). `400` reads "Check the amount, references and date, then try again."
  with the server text in details. Every settle invalidates the deposits query.
- **PLUSD — one status column** (#1449, folded into a single column by #1453). The trailing
  **Action** column is gone: the PLUSD column now carries both the state and the control, because
  a two-column `Not minted` + button pair said the same thing twice. A row with `is_minted: true`
  renders a positive `StatusChip` reading **Minted** (`lp-deposit-minted`) and no control. A row
  inside the pending window renders an attention `StatusChip` reading **Pending**
  (`lp-deposit-pending`) over the `Waiting for the indexer` hint. Otherwise the cell is a
  `@pipeline/ui` `Button`, `variant="primary-blue" size="compact"` (32px, solid brand fill, white
  label, 4px radius), reading **Mint PLUSD** — the design system's own row-scale button, not the
  40px bordered secondary it used to be and deliberately not a `BandButton`, which would read as a
  chip rather than an action (#1453 design feedback). The only local class is the 13px row type
  and `disabled:opacity-[0.32]`, the `secondary` variant's own disabled opacity, because
  `primary-blue` ships no disabled treatment and a disabled mint must look disabled. It calls the
  yield minter's `record_wire_in` directly from the trustee's connected
  Stellar wallet (`api/useRecordWireIn.ts` over `@pipeline/wallet-connect`'s `recordWireIn`;
  see [deposits.md](../product-specs/deposits.md) for the signature, the `CASH_REPORTER`
  requirement and the 7-decimal scale). Arguments come only from served data: `amount` is the
  row's `amount` string, `value_date` is `occurred_at` in Unix seconds, `ref_hash` is the
  served hash.
- **Mint chain and scope line (#1826).** The card is a per-network surface: the mint chain is the
  session's signed-in chain, `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`, mapped to a kind
  by `chainKindOf`. A hand-attributed deposit carries no chain (TD-164), so the Trustee picks the
  network by signing in on it. A line under the title states the scope: `Mints on {chain} to <receiver chip>`,
  plus `· capital wallet — this LP has no {Stellar|EVM} settlement address` for the fallback, or
  `Mints on {chain} — no receiver`.
- **Matched reference and mint chain (#1887).** The mint chain stays the signed-in chain. For a
  deposit whose `matched_reference.chain_id` is set: on the same chain the flow is unchanged and the
  confirm dialog adds **LP payment reference** and **Shown to the LP** (`lp-mint-shown-receiver`:
  chain label plus the full served `receiver_address`, `—` when null); when that address differs from
  the receiver resolved now, a muted note (`lp-mint-shown-differs`) says the settlement address
  changed since the reference was issued and PLUSD goes to the current address (no extra
  acknowledgement; the #1826 changed-since-shown one is unchanged). On another chain `Mint PLUSD` is
  **disabled** (decided on #1887, not a warning): "This wire was matched to a reference issued for
  {chain}. Sign in on {chain} to mint it." A null `chain_id` (reference issued before #1824) or a
  hand-attributed deposit behaves as before. The capital-wallet fallback receiver is unchanged.
- **Receiver rule** — `wireInReceiver(lp, kind, {stellar, evm})`: for the session's kind, the LP's
  address of that kind (`stellar_address` / `evm_address`) when its `*_linked_at` is non-null,
  otherwise that chain's capital wallet (`VITE_STELLAR_CAPITAL_WALLET_ID` /
  `VITE_EVM_CAPITAL_WALLET_ADDRESS`; the fallback stays by decision 2026-11-02, #1763); when
  neither resolves the action is disabled with "This LP has no linked {Stellar|EVM} wallet and no
  capital wallet is configured." A receiver never crosses kinds. The USDC custody account
  (`VITE_STELLAR_USDC_CUSTODY_ID`) is **never** the receiver — it holds no authorized PLUSD
  trustline, so minting to it traps with PLUSD `Error(Contract, #13)`. The trustee's wallet is the
  signer and `caller`, never the receiver.
- **Mint confirm dialog (#1826).** `Mint PLUSD` opens `lp-mint-confirm` (the Record-deposit dialog
  shell) and re-reads `GET /v1/lps/{id}`. It shows Network, Amount, Bank reference and the
  **full** receiver (`lp-mint-receiver`, never truncated), labelled "LP settlement address" or
  "Capital wallet". Confirm re-reads the LP again immediately before building the transaction and
  mints only to that read's receiver, and only if it equals the one shown. On any difference
  (another address, a switch to or from the capital wallet, no receiver) nothing is signed:
  the dialog shows `lp-mint-receiver-changed` with "Previously shown" and "Now minting to" and
  confirm stays disabled until "Mint to the new address" (`lp-mint-ack`) is checked. A failed read
  (network, 401, 403, 404) blocks the mint with a Retry and never falls back to cached data; a read
  that resolves after the dialog was closed is dropped. The dialog is locked while signing. The
  residual window is wallet signing and submission (seconds): nothing on-chain or server-side checks
  the receiver against the LP record.
- **PLUSD authorisation pre-flight (#1889).** After resolving the receiver, the dialog reads
  `PLUSD.authorized(receiver)` (the PLUSD id from the minter's `addresses_config()`, as the
  escrowed-wire assign does) when it opens and again on confirm, before the transaction is built;
  the capital-wallet fallback is checked too. `no-trustline` shows `lp-mint-no-trustline`
  ("This receiver has no PLUSD trustline. The lender must add PLUSD to this wallet before it can
  receive a mint.") and `not-authorized` shows `lp-mint-not-authorized` ("This receiver's PLUSD
  trustline is not authorised yet. The relayer authorises a KYB-passed lender's linked address
  automatically; try again in a few minutes."). Both leave confirm disabled and sign nothing;
  capital-wallet receivers say "capital wallet" instead of "lender". A failed read shows "Could not
  read this receiver's PLUSD authorisation. Try again." with Retry. A flip between open and confirm
  shows the notice and does not mint.
- **EVM sessions until #1501.** The receiver is resolved and shown in the scope line, but
  `Mint PLUSD` is disabled with "PLUSD minting on {chain} is not available in the Trustee app
  yet." as the first reason; `record_wire_in` is never called with an EVM receiver. #1501 replaces
  that gate with the EVM write and inherits the dialog and re-read unchanged.
- **States** — idle (`Mint PLUSD`) → `Awaiting signature…` → `Submitting…` → `Confirming…`
  as the button's own label while in flight, then the `Pending` chip over `Waiting for the
  indexer` until the served `is_minted` flips. The pending set is in-memory only, bounded to ~2 min, and only
  raises the deposits poll to 5 s; it is never persisted and never substitutes for the served
  flag. Each id's window is anchored to its own mint time (the set stores a deadline per id), so
  a later mint never restarts an earlier id's window, and unmounting clears every armed window. Disabled reasons, rendered as the button's `title` and an `aria-describedby` hint, in
  order: EVM session (#1826), matched on another chain (#1887), wallet not connected, minter id unset, Cash reporter role (#1762: checking, could not verify, delay, "Only the Cash reporter can book incoming wires."), no receiver resolvable, already minted,
  waiting for the indexer, another mint in flight. Before the signature request `useRecordWireIn` reads the minter's `ref_hash_seen` and, when true, throws `RefHashSeen…` so the copy below shows without a wallet prompt.
- **Errors** — surfaced through `toUserError` in an `InlineError` inside the mint confirm dialog (a mint can only start there) with the raw contract text in
  the details dialog. A `RefHashSeen` trap gets its own copy: "This deposit's reference has
  already been minted on-chain. Refresh the list." A PLUSD `Error(Contract, #13)` trap reads
  "The receiver has no authorized PLUSD trustline." — the receiver must be authorized by the
  auth-required PLUSD issuer before any mint. A minter `Error(Contract, #15)`
  (`ReceiverNotAuthorized`) reads "This receiver's PLUSD trustline is not authorised yet. The
  relayer authorises a KYB-passed lender's linked address automatically; try again in a few
  minutes."

### States & error copy

Loading (three `animate-pulse` skeleton bars), error (`InlineError` in the negative-bordered
wrapper), and empty ("No registered LP counterparties.") states mirror the Loan Book page exactly,
including `data-testid`s prefixed `lp-counterparties-`.

**403 pre-check (tech debt, see `docs/exec-plans/tech-debt-tracker.md`):** the shared
`toUserError`'s `matchApiStatus` maps every `403` to *"You are not authorized to review
submissions."* — copy hardcoded for the Origination review flow. `useLpCounterpartiesTable` checks
`error instanceof ApiError && error.status === 403` **before** calling `toUserError` and returns
page-specific copy ("Your trustee account is not authorized to view LP counterparties.") instead.

### Sidebar placement

**LP Counterparties** is the last item of the middle operational group — after **Cash
Management**, before the divider that precedes Risk Council / Audit Log — because it is a working
queue like Origination and Loans, and its detail page will host LP bank-transfer recording (#1272).
`DIVIDER_AFTER_PATHS` in `TrusteeSidebar.tsx` moved from `"/cash-management"` to
`"/lp-counterparties"` to keep the two-divider grouping. The nav glyph (`LpCounterpartiesIcon`) is
hand-authored — no Figma export exists for it, unlike the other six nav glyphs — a documented
deviation pending a future Figma delivery.

## Origination & review

**Sources:** `packages/trustee/src/api/useLoanSubmissions.ts` (data hook),
`routes/-useOriginationTable.ts` + `routes/origination.index.tsx` (submissions table, issue #813,
Figma node `4116:9155`), `routes/-origination-detail.ts` + `routes/origination.$id.tsx`
(details/review page, issue #821, Figma node `4116:9292`, supersedes closed #816),
`routes/-useOriginationReview.ts` + `api/useReviewSubmission.ts` (Approve/Reject/Request-changes
orchestration), `routes/-ApproveMintDialog.tsx` / `-RejectReasonDialog.tsx` /
`-RequestChangesDialog.tsx` / `-useRejectReasonDialog.ts` (confirmation dialogs).
`api/useResubmitLoan.ts` + `routes/-origination-edit.ts` + `routes/origination.$id_.edit.tsx` +
`routes/-SubmissionForm.tsx` (Amend and resubmit, #1913).

### Architecture

View/logic split per rule 2, mirrored across both pages: `useLoanSubmissions` (data) →
`useOriginationTable` / `useOriginationDetail` (presenter, value→display mapping) → `.tsx`
(JSX-only). Review actions live in a third layer, `useOriginationReview`, composing
`useReviewSubmission` (DB decision) and `useDrawLoan` (on-chain mint) so the `.tsx` stays a pure
render function.

### Data layer (`useLoanSubmissions`)

`GET /v1/loan-book/submissions` with **no** `chain_id` (#1536: every configured target chain —
each `SubmissionView` carries `target_chain_id`, plus the nullable drawn `chain_id` / `loan_id`,
all declared optional so fixtures and defensive rendering stay honest), 30 s poll — mirrors the LP frontend's
`useLoanSubmissions` conventions and the trustee's own `useCapitalAllocation.ts`. The trustee app
does not depend on `@pipeline/frontend` (epic #775), so the types are a self-contained port
(TD-42). Optional server-side `status` filter (#818) is included in the query key so filtered and
unfiltered variants cache independently.

`loan_data` is the verbatim submitted payload (`serde_json::Value` on the wire — declared as
`SubmitLoanRequest` for convenience but not guaranteed to match at runtime), returned as a nested
JSON object, not a JSON-encoded string. Its four monetary fields (`economics.
original_facility_size` / `original_senior_tranche` / `original_equity_tranche` /
`original_offtaker_price`) are **human-unit USDC decimal strings** (e.g. `"1200000.000000"` =
$1,200,000; at most 6 fractional digits, which both chains represent exactly) — #1620, superseding
the #912 "base-unit" reading that had the trustee form, the API doc and the draw path disagree and
sent $1.2M on-chain as $0.12. Display consumers pass them through `economicsUsdDecimal`
(`@/utils/stellarSacUnits`: validates a non-negative decimal, no scaling) before `formatFullUsd`/
`formatCompactUsd`. Rows submitted under the old reading render 10^7× too large and must be
re-entered. Every nested field access must be defensive — missing/malformed values
render `—`, never fabricated.

**`draw_loan` block (#1805).** The on-chain write does not read `loan_data`. Each `SubmissionView`
carries `draw_loan` (`DrawLoanArgs | null`, optional on stale router-state copies), the API's
contract-ready `draw_loan` / `drawLoan(metadata_uri, economics)` arguments (`loan_book.rs`
`draw_loan_args`): `metadata_uri`, the 8 `ImmutableLoanData` fields (`borrower_ref` = sha256 of the
trimmed `data_room_id` as 64 lowercase hex, the four amounts as base-unit `u128`
strings (7 decimals for a Stellar target, 6 for an EVM target), `senior_interest_rate` as bps × 100 `u32`, two unix-second `u64` dates) and
`missing_inputs`. Each field is `null` when its input is absent or not representable. The block is
`null` once the loan is drawn, on `Rejected` and for an unconfigured target chain. The browser neither scales nor hashes: `@pipeline/wallet-connect` encodes the served values
verbatim (see "Chain-first Approve ordering"). The block shape is hand-mirrored in three places
(API Rust, `useLoanSubmissions.ts`, wallet-connect `DrawLoanArgs`; TD-42).

**Status normalization (#892/#949/#950):** `normalizeOriginationSubmissionStatus` maps the
backend's merged submission/loan-lifecycle status into the Origination UI vocabulary. Once a
submission reports a loan-lifecycle status (`Performing`, `WatchList`, `Past Due`, `Default`,
`Closed`), the origination decision is already complete, so Origination displays it as
`Approved` — Origination keeps only the decision vocabulary. `ChangesRequested` is a genuine
**pre-decision** outcome (backend #949) — non-final, the submission stays open for the originator
to resubmit — so it is preserved, not folded into `Approved` (#950).

### Origination table (`/origination`, issue #813)

Columns: Originator · Chain · Commodity · Facility · Corridor · Rate · Maturity · Submitted ·
Status/action.

- **Chain** (#1536, no Figma — a 90px track after Originator) ← `target_chain_id` via
  `targetChainLabel` (`packages/trustee/src/lib/targetChains.ts`): "Stellar" for
  `ENV.STELLAR_CHAIN_ID`, the EVM chain's registry name for `ENV.EVM_CHAIN_ID` ("Hoodi" on staging,
  "Ethereum" on prod — a two-entry local copy of `@pipeline/wallet-connect`'s `evmChainInfo` names,
  since importing that package pulls the wallet runtime into every test), `Chain <id>` for an
  unconfigured id, `—` when absent.

**Row set (#1056):** the table lists **all** submissions, newest first — `Approved` rows
(including backend merged/lifecycle statuses, which normalize to `Approved` per #892) render
with the green "Approved · `<date>`" chip alongside `InReview` / `ChangesRequested` / `Rejected`.
This reverses the short-lived #1044 in-flight filter: the approval history stays visible on the
origination surface, while the resulting loan also lives on the Loans surfaces.

- **Originator** ← `loan_data.originator` (the name as submitted), **not**
  `SubmissionView.originator` (the authenticated-submitter address) — distinct sources.
- **Commodity** ← `loan_data.commodity`. The Figma's valuation sub-line ("NSR · Net Smelter
  Return" / "Standard · price × quantity") is **omitted entirely** — no field in
  `loan_data`/`SubmissionView` carries a valuation mode for pre-mint submissions (`ValuationMode`
  lives in `loan_collateral_valuations`, keyed by an on-chain `loan_id` submissions don't have
  yet); resolved (human, #813 comment): do not infer it from the commodity name.
- **Facility** ← `economics.original_facility_size`, normalized ÷10^7 then `formatCompactUsd`
  (compact, e.g. `"$3.5M"` — switched from fully-expanded `"$3,500,000"` by #1015 to reclaim
  column width).
- **Corridor** ← `loan_data.corridor`, hyphen rendered as the Figma arrow glyph ("PE-CN" →
  "PE → CN").
- **Rate** ← `economics.senior_interest_rate_bps` via `formatBpsRate`. **Maturity** ←
  `economics.original_maturity_date` via `formatMaturityDate`. **Submitted** ←
  `SubmissionView.created_at` (RFC 3339) via `formatSubmittedDate`.
- **Status/action** (8th column, resolved human #813 comment, copy amended by #829):
  `Approved` → green "Approved · `<date>`" pill (deliberately **not** "Approved & minted" —
  #831's real on-chain mint ships later, and this compact pill stays short; "& minted" is
  restored only on the `/origination/$id` detail banner). `InReview` → a "Review" control
  navigating to `/origination/$id` (#821), passing the row's `SubmissionView` as router state.
  `Rejected` → red pill, `reason` on hover. `ChangesRequested` → sweet-orange "Changes requested"
  pill, `reason` on hover (#949/#950).
- The Figma's static footer note ("The document set adapts to the commodity…") is deliberately
  omitted per human review follow-up, even though present in the Figma reference.

**Row-click navigation (#823):** the entire row (not just the InReview "Review" control)
navigates to `/origination/$id`, for every status. Each row is a `role="row"` `div` with
`onClick`/`onKeyDown` (Enter/Space) — deliberately not an `<a>`/`<Link>` wrapper, since nesting the
row around the InReview cell's own `<Link>` would produce invalid nested anchors. The inner
`Link`'s `onClick` calls `stopPropagation()` so a click on it doesn't also fire the row handler
(both target the same URL — this just avoids a duplicated navigation/history entry).

**Layout:** a full-width CSS grid, not an HTML `<table>` — the Figma frame's fixed pixel widths
sum wider than the card (an export artifact: body cells total ~1038px inside a 945px box), so
seven flexible data tracks (`minmax(0,Nfr)`, ellipsis-truncating) plus a fixed 210px action column
replace them, summing to exactly 100% (no horizontal scroll/clip). The header row and each body
row are separate grid containers, so bounded-content columns (Facility, Rate, Maturity,
Submitted) get fixed pixel tracks sized to their worst case (content-driven `auto`/`max-content`
sizing would compute per-container and misalign columns); Originator/Commodity/Corridor split the
remaining width. Borders: a single rounded box around the body rows + horizontal separators only
(`LINE_COLOR` = `rgba(56,55,53,0.18)`, exact Figma literal, applied via inline `style`) — no
column dividers, header sits unbordered above the box. Approved pill uses
`--color-pipeline-positive-primary` text/icon with one-off alpha bg/border steps (no token match,
same precedent as the Capital Allocation legend colors); the check icon is redrawn inline
(Figma's asset is a localhost dev-server SVG, not fetchable at runtime). Rejected pill has no
Figma reference row — resolved via Open Questions as a token-consistent default, mirroring
Approved's shape with `--color-pipeline-negative`.

### Submit a loan (`/origination/new`, #1100)

The "Submit a loan" action beside the Origination heading opens a full-page form covering the
complete `SubmitLoanRequest` contract of `POST /v1/loan-book/loan` (mirrored field-for-field in
`useSubmitLoan.ts`; the Rust source in `packages/api/src/routes/loan_book.rs` is authoritative).
No Figma exists for this screen (product decision on #1100) — it reuses the Record
Coupon/Repayment field-box pattern, the reason-dialog shell, and `InlineError`.
The form body (fields, Documents rows, error block, submit button) lives in `routes/-SubmissionForm.tsx`, shared with the Amend and resubmit page. Each Documents row removes with an icon-only trash `IconButton` (aria-label "Remove document"); "Add document" carries a leading plus glyph.

- **Target chain (#1536, #1667):** the first field of Loan & metadata is a `<select>` (`FieldDef.options`;
  `FieldInput` renders a select instead of a text input when set). Its options are
  `TARGET_CHAINS ∩ GET /v1/chains` (`useServedTargetChains`, `api/useChains.ts`; query key
  `["chains"]`, `staleTime: Infinity`, `retry: false`, public endpoint — not gated on a session):
  Stellar (`ENV.STELLAR_CHAIN_ID`) and the EVM chain (`ENV.EVM_CHAIN_ID`, labelled by name), kept
  in `TARGET_CHAINS` order, each only when the API serves it. Chains the API serves that are not
  in `TARGET_CHAINS` are not offered (no label source). The default is the served
  `default_chain_id` when it is among the options, else the first option. The select is disabled
  with no options while the request is pending; on request failure it falls back to the env
  `TARGET_CHAINS` with the Stellar default. An empty intersection renders an empty disabled
  select and submit fails client-side with "Required." on `target_chain_id`. The value is **not**
  part of the body: the builder returns `{ chainId, input }` and `useSubmitLoan` posts to
  `POST /v1/loan-book/loan?chain_id=<id>` (`SubmitLoanVariables`). An id the API does not serve is
  a `400`, now reachable only on the fallback path, rendered inline via the #1602 copy.
- **Sections** (`FORM_SECTIONS` in `-origination-new.ts`, dotted request paths as field ids):
  Loan & metadata (`target_chain_id`, `metadata_uri`, optional `secondary_metadata_uri`, `originator`,
  `borrower_id`, `data_room_id` ("Data room ID", required, trimmed — #1805; the API hashes it into the
  on-chain `borrower_ref`), `commodity`, `corridor`, `governing_law`, optional `protection`), Economics
  (four human-unit USDC amount strings with at most 6 decimals, validated by `USDC_AMOUNT_PATTERN`
  and labelled "USDC, up to 6 decimals" — #1620; rate bps + two unix-second dates), Collateral valuation (`collateral_valuation.*`), Fee schedule
  (`fee_schedule.*` bps), and Documents (dynamic name/URI rows).
- **Unique-URI banner:** a standing attention banner states that `metadata_uri` must be unique
  per submission; the API's duplicate rejection additionally surfaces inline on submit.
- **Import from JSON (`-ImportJsonDialog.tsx`):** a dialog with a plain textarea. A successful
  import **replaces the whole form**: scalar fields present in the pasted object fill (numbers
  are stringified into the inputs), fields absent are **cleared** — so the missing-fields
  warning always matches what is on screen (previously-typed values never linger under a
  "missing" warning) — and the document rows are replaced (cleared when the payload has none).
  **Required paths absent from the JSON are listed in a warning banner** while the rest
  autofills (the #1100 example payload warns exactly the `collateral_valuation.*` +
  `fee_schedule.*` paths; an old payload without `data_room_id` also lists it, and legacy `to` /
  `initial_*` keys are ignored). A `target_chain_id` in the JSON sets the selector when it is one of
  the offered (served) ids; otherwise the selector keeps its current value and is never listed as
  missing (#1536). Malformed JSON or a non-object root keeps the dialog open with an
  inline parse error and touches nothing — a single JSON object is required (resolved open
  question: wrapped/array fixture forms are not accepted).
- **Validation split:** client-side checks are shape-only — required fields non-empty, numeric
  fields whole non-negative numbers, document rows complete. Amount strings are sent
  **verbatim** (×1e6 convention, [[frontend-display-backend-values-verbatim]]). Backend
  invariants (facility = senior + equity, date ordering,
  `metadata_uri` uniqueness) are NOT duplicated — the API's rejection renders via
  `InlineError` with the raw response behind View details.
- **Submit:** `useSubmitLoan` POSTs with the session bearer (attached by `apiFetch`, #791) and
  invalidates `loan-submissions` on success; the page then navigates back to `/origination`,
  where the refetched list shows the new submission awaiting review. A rejection does **not**
  navigate — the error renders inline and the trustee stays on the page, with the form intact,
  to fix and resubmit. The route sits behind the app's auth gate like every other trustee
  route — no separate token input.

### Amend and resubmit (`/origination/$id/edit`, #1913)

An Originator whose submission is `ChangesRequested` amends it from the detail footer's "Make changes and
resubmit" link. The route is `routes/origination.$id_.edit.tsx` (non-nested, like
`loans.$id_.record-coupon.tsx`, because `origination.$id.tsx` renders no `<Outlet />`); no Figma
exists, so it reuses the create form's layout and tokens through `routes/-SubmissionForm.tsx`.

- **Endpoint:** `useResubmitLoan` POSTs `SubmitLoanRequest` to `/v1/loan-book/submissions/{id}/resubmit`
  (bearer via `apiFetch`, no `chain_id` query). The backend replaces `loan_data`, sets the status
  back to `InReview` and clears the reason; the target chain is fixed at creation.
- **Target chain:** shown as a disabled select holding only the row's `target_chain_id`
  (`targetChainLabel`) with the hint "Fixed at submission. To target another chain, submit a new
  loan." Changing it would be a backend change.
- **Submit button:** "Resubmit for review" is content-width (`compactSubmit`, `w-auto self-start`),
  not full width like on `/origination/new`; height 48px, padding 28px, same colours.
- **Prefill:** `prefillFromSubmission` reads the served `loan_data` through the same reader as Import
  from JSON (`parseSubmissionObject`): numbers are stringified, strings kept as served (human-unit
  USDC, no rescaling), `documents` rows carried over as editable Name / URI rows (nothing
  re-uploaded). Legacy keys (`to`, `initial_ccr`, `initial_location`) are neither read nor resent.
  Required paths absent from the served payload are listed in `origination-edit-prefill-warning`
  and fail the "Required." check until filled. The form seeds once per mounted row, so the 30 s
  list poll never resets edits.
- **Banners:** `origination-edit-reason` ("Changes requested · `<reviewedDate>` — `<reason>`", the
  detail footer's orange tokens) and `origination-edit-uri-banner` ("You can keep this
  submission's `metadata_uri`. A new one must not be used by another open submission.").
- **Errors** (`mapResubmitError`, raw text behind View details): `400` served text verbatim; `403`
  "Only the originator can resubmit this loan."; `404` "Only the originator who submitted this loan
  can resubmit it."; `409` matching `metadata_uri … already used` "This metadata URI is already used
  by another open submission. Use a unique one."; other `409` "This submission is no longer awaiting
  changes. Refresh to see its latest status."; anything else the shared fallback "Failed to resubmit
  the loan." The action shows for every `ChangesRequested` row; the API decides who may use it.
- **Success:** the hook's `onSuccess` returns the `["loan-submissions"]` invalidation, so
  `mutateAsync` resolves after the refetch, then the page navigates to `/origination/$id`, which
  renders the served `InReview` row. No status is written client-side. A rejection does not
  navigate; the form stays intact.
- **Not editable:** a row that is not `ChangesRequested` renders `origination-edit-not-editable`
  ("This submission isn't awaiting changes.") with a link back to the detail; while a resubmit is
  pending or succeeded the form stays mounted so the refetch does not flash that panel. Unknown ids
  render `origination-edit-not-found`.

### Origination detail (`/origination/$id`, issue #821)

Supersedes closed #816, which included a Collateral Valuation card + `/valuations` wiring —
**explicitly dropped**: the Figma's valuation card is incorrect, since no submission is anchored
on-chain pre-mint, so there is no `loan_id` to call `GET /v1/loan-book/{loan_id}/valuations` with.

**Field mapping (resolved decisions, #821):**

- Heading/breadcrumb/Deal-Details "Originator" → `loan_data.originator` (the human name), **not**
  `SubmissionView.originator` — same distinction as the table.
- Start date → `economics.origination_date`. Maturity → `economics.original_maturity_date`.
  Facility/tranches/offtaker price → `economics.*` (human-unit USDC as served via
  `formatEconomicsUsd`, #1620). Rate →
  `senior_interest_rate_bps` + " p.a." suffix (Figma "14.0% p.a.").
- Corridor → `loan_data.corridor`, arrow-formatted (same regex as the table). Governing law →
  `loan_data.governing_law`. Protection → `loan_data.protection` (optional — `—` when absent).
- Borrower ref → `draw_loan.economics.borrower_ref` (#1805, replaces the #1014 Location row; falls back to `Data room ID <loan_data.data_room_id>` once the served `draw_loan` is null, e.g. drawn or Rejected submissions),
  shortened 6…4 (`ab12cd…9f0e`) with the full hex in a `title` tooltip; "Data room ID missing"
  when the served block lists `data_room_id` in `missing_inputs`. When `draw_loan` is null (drawn or
  Rejected submissions) the row shows `Data room ID <loan_data.data_room_id>`; `—` when neither
  exists. The legacy `to` / `initial_ccr` / `initial_location` keys of
  old submissions are never read.
- Documents → the top-level `submission.documents` (**not** `loan_data.documents` — the backend
  already lifts it); `[]` renders a graceful empty state.
- Status chip → normalized status ("Awaiting your review" for `InReview`; `Approved`/`Rejected`
  for terminal decisions; "Changes requested" for the non-final `ChangesRequested`, #950). This is
  the **only** chip rendered — the Figma's "Your key · one click" static chip and "NSR · Net
  Smelter Return" valuation-mode chip are both dropped (no data source). The "All three mint
  invariants pass" and "Originator signature verified" banners are omitted entirely — not gated
  behind a flag, there is no path to ever showing them.

**Resolution precedence (fixed by #829 — load-bearing for Approve/Reject):** the presenter prefers
the **live** `useLoanSubmissions()` list copy over the router-navigation-state `SubmissionView`
whenever the list already contains a matching `id`; the nav-state copy is used only as an
initial-render fallback (first paint, before the list query resolves — e.g. a direct-URL/refresh
visit). Before #829, the nav-state copy always won when present, so after a successful
Approve/Reject the invalidated list would refetch a fresh (status-flipped) copy, but the memo kept
returning the stale snapshot — the footer would never flip to the Approved/Rejected banner until a
hard refresh dropped the router state.

**State derivation (#1065):** with no resolvable submission, the presenter distinguishes
`loading` (fallback list query in flight) → `error` (the query **failed** — rendered as an
`InlineError` per the #1037 pattern, friendly "Failed to load the submission." with the raw
failure behind View details, plus a back link) → `not-found` (the query resolved and no row
matches the id). Before #1065 a failed fetch fell through to the same "Submission not found."
copy as a genuinely missing id, discarding the failure entirely. A router-state submission still
renders `ready` even when the list query errors.

### Status-conditional footer (#823, Figma node `4116:9656`; copy amended by #829, restored by #831)

The always-shown action-buttons block is replaced by a footer that branches on status:

- **InReview** → the action buttons, wired (#829, extended by #831): Approve now mints on-chain
  first (`useDrawLoan`), then calls the review endpoint; Reject is unchanged (pure DB call).
- **Approved** → a green banner: "Approved & minted · `<reviewedDate>`" (#829 dropped "& minted"
  pending the real mint; #831 restored it — Approve now performs a genuine trustee-wallet-signed
  on-chain `draw_loan` mint before this banner ever renders). The Figma's semibold navy "funded
  from batch #B-102 →" segment is omitted — no `batch` field exists on
  `SubmissionView`/`loan_data`.
- **Rejected** → a red banner: "Rejected · `<reviewedDate>` — `<rejectionReason>`".
- **ChangesRequested** → a sweet-orange banner: "Changes requested · `<reviewedDate>` —
  `<reason>`" (#950). Non-final (waiting on the originator to resubmit) — no review buttons; a
  "Make changes and resubmit" link to `/origination/$id/edit` sits under the banner (#1913).
- Backend merged/lifecycle statuses → the Approved banner (#892).

`reviewedDate` is `formatSubmittedDate(submission.updated_at)` — **not** `formatMaturityDate`
(which takes Unix seconds and adds the year; `updated_at` is RFC 3339) — mirroring the table's
Approved pill. `rejectionReason` is `safeString(submission.reason)`.

When the just-drawn `loanId` is known (#876 — captured from the mint tx in this session), the
Approved banner appends a "View loan →" deep-link to the loan's detail page. On a page reload the
id is gone (the mint mutation's data isn't persisted — same accepted residual as the idempotency
marker), so the link is simply omitted. `RejectedBanner` and the `ChangesRequestedBanner` mirror
`ApprovedBanner`'s container shape in their respective tokens (red / sweet-orange `#c2500a`
one-off, no token) — no Figma reference exists for either state.

**Out of scope (do not reintroduce):** `useCollateralValuation`, the `CollateralValuationResponse`
shape, `ValuationDisplay`/`ValuationInputRow`/`WaterfallRow`, `mapValuation`, `modeLabel`,
`usdOrDash`, `initial_ccr`/`formatInitialCcr`, `freshnessLabel` — see the (completed) exec plan
`docs/exec-plans/completed/issue-821-trustee-origination-details-page.md` for why.

### Approve & mint confirmation dialog (#838, Figma node `4116:13943`)

`transactionPreview` formats the served `draw_loan` block — the values actually signed — as the
dark code block shown inside the confirmation dialog, under `LoanRegistry.draw_loan(` (`LoanRegistry.drawLoan(` for an EVM target): `metadata_uri`,
the shortened `borrower_ref`, and an `economics` summary in base units as served (amounts, raw
`senior_interest_rate`, formatted dates). Fields are read defensively (never fabricate; `—` when
`draw_loan` is null or a field is missing). The four green mint-invariant checklist rows the Figma
frame also shows are deliberately omitted — no backing data (consistent with #821's omission of the
"mint invariants pass"/"signature verified" banners).

Before #838, clicking Approve fired the mint→review orchestration immediately. The dialog
introduces a pre-mint confirmation gate: Approve now **opens** the dialog; the orchestration only
runs when the trustee clicks "Mint loan" — unchanged otherwise. Cancel/Escape/backdrop-click are
**disabled while minting** — once "Mint loan" is clicked the on-chain sequence is in flight and
cannot be un-shown, a deliberately stricter contract than `RejectReasonDialog` (whose Cancel stays
enabled during submission, since a review-only mutation has no on-chain side effect to lose
visibility into). This also protects the idempotency guard below — the dialog cannot be dismissed
mid-mint in a way that would confuse a subsequent Approve click. `cancelApprove()` does **not**
reset the mint mutation once it has already succeeded — doing so would erase the "already minted
this session" marker and risk a second on-chain mint.

### Chain-first Approve ordering (#831)

Approve runs the trustee-wallet-signed on-chain `draw_loan` mint (`useDrawLoan`,
`@pipeline/wallet-connect`) **before** the DB review call (`useReviewSubmission`, `POST
.../review {decision:"Approved"}`):

1. `useDrawLoan().mutateAsync({ args, chainId })`, with `args` built from the live `submission.draw_loan`
   (#1805) — build → simulate (the "verify the loan" step) →
   wallet signature → submit → poll to a terminal status.
2. Only once that resolves does `useReviewSubmission` fire.

A wallet rejection, a failed simulate/send/poll, or an unconfigured registry/disconnected-wallet
guard all reject step 1 — the review call is skipped entirely, the submission stays `InReview`,
and a mapped, retryable error message renders. **No signature is ever requested when the simulate
step fails.** An already-`Approved` submission's `approve()` is a no-op (defensive — the
InReview-only footer shouldn't normally allow this call, but guards a stale render/race).

**Target-chain gate (#1536, opened for EVM by #1573).** `drawChainReason(target_chain_id)`
(`lib/targetChains.ts`, built like `riskCouncilChainReason`) is `null` for Stellar, for a missing id
(the pre-#1529 default) and for `ENV.EVM_CHAIN_ID`. For any other chain id it returns
`approveBlockedReason` — "Approve & draw runs on Stellar only — drawing on `<chain>` from the
Trustee app is not supported yet. Reject or request changes instead." — rendered as a muted line
above the footer buttons (`origination-detail-approve-blocked`); Approve is disabled and both
`openApprove()` and `approve()` are no-ops. `approveBlockedReason = drawChainReason(target) ??
drawLoanBlockedReason(draw_loan)`, bypassed by the review-only state. Reject and Request changes
are unaffected. The Deal Details card shows the target as its first row ("Target chain").

**EVM draw (#1573).** The EVM path mirrors the Stellar one; the dialog, footer, banners, copy,
the draw → review ordering, the idempotency guard (and its accepted reload residual), the
review-only path, the draw-inputs gate and the `mapMintError` table are identical. The
differences:

- `useDrawLoan().mutateAsync({ args, chainId })` picks the arm with `pickChainWallet(chainId,
  useStellarWallet(), useEvmWallet())`; a missing chain id takes the Stellar arm. The EVM arm
  checks, before any RPC call and in order, `drawChainReason(chainId)` (thrown as the error),
  `VITE_EVM_LOAN_REGISTRY_ADDRESS` / `VITE_EVM_ACCESS_MANAGER_ADDRESS` ("On-chain minting is not
  configured for this environment.") and the EVM wallet ("EVM wallet not connected."). The
  signing chain is `ENV.EVM_CHAIN_ID`; there is no `canCall` pre-read, so a missing role surfaces
  as a failed simulate with the decoded error name in the details.
- Call: `drawEvmLoan` (`evm/contracts/loanRegistry.ts`) sends `AccessManager.execute(registry,
  drawLoan calldata)` with `value 0` through `sendEvmContractCall` (switch chain, simulate, gas
  estimate, sign, receipt), as every immediate EVM call. The ABI holds the AccessManager and
  `LoanRegistry*` / `EnforcedPause` errors, so reverts decode by name.
- Encoding: `drawLoan(string metadataURI, (bytes32 borrowerRef, uint256 originalFacilitySize,
  uint256 originalSeniorTranche, uint256 originalEquityTranche, uint256 originalOfftakerPrice,
  uint32 seniorInterestRate, uint64 originationDate, uint64 originalMaturityDate) economics)
  returns (uint256 loanId)` (selector `0x675ebc7d`, `pipeline-contracts@150631a`). The served
  values are encoded verbatim: `borrowerRef` = `0x` + the 64 hex, amounts and dates as `BigInt`,
  the rate as a number. Invalid input throws `drawEvmLoan: invalid draw_loan input <field>` before
  any RPC call.
- Simulate wrap: `sendEvmContractCall` simulates and estimates gas before the wallet prompt. A
  contract revert before the `awaiting-signature` stage is rethrown as `drawEvmLoan: simulation
  error: <original message>`, so the existing copy "Could not verify the loan on-chain. No
  signature was requested — safe to retry." applies and the decoded error (e.g.
  `LoanRegistryInvalidTranches`, `AccessManagerUnauthorizedCall`, `EnforcedPause`) is in the
  details. Other failures (chain switch rejection, RPC failure, receipt revert) propagate unchanged.
- Stages: there is no stage during the simulate (the button reads "Registering on-chain…"), then
  `awaiting-signature` and `confirming`; an EVM wallet signs and broadcasts in one call, so there is
  no `submitting`.
- Loan id (#876): read from the receipt's `LoanDrawn(uint256 indexed loanId, string metadataURI)`
  log emitted by the configured registry (`readEvmDrawnLoanId`). `AccessManager.execute` returns the
  nonce, not the id. A `uint256` above `Number.MAX_SAFE_INTEGER` gives `null` (the draw succeeded,
  there is no deep link); `0` is a valid id.
- Role: the trustee's EVM wallet needs `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` with delay 0 (the role
  that holds `drawLoan`). A delayed role fails the immediate `execute` at simulate
  (`AccessManagerNotScheduled`); scheduling a draw is not supported, as on Stellar.

#### Draw-inputs gate (#1805)

Approve needs a complete served `draw_loan` block
(`lib/drawLoanArgs.ts`: `readyDrawLoanArgs` is non-null only when the block is present,
`missing_inputs` is empty and every field is non-null and well-formed: 64-hex `borrower_ref`, digit-only amounts within `u128`,
`u32` rate, non-negative integer dates, non-blank `metadata_uri` — the same formats
`encodeDrawLoanArgs` enforces). For a Stellar or configured EVM target, `approveBlockedReason`
(checked after the target-chain gate) is `drawLoanBlockedReason(submission.draw_loan)`: a missing
or `null` block reads "On-chain draw inputs are not available for this submission. Reject or
request changes instead."; `data_room_id` in `missing_inputs` reads "Data room ID missing — this
submission can't be drawn on-chain. Request changes so it is resubmitted with a data room ID, or
reject it."; any other missing input lists the names. Approve is then disabled and
`openApprove()` / `approve()` are no-ops; if the gate closes while the dialog is open, the dialog
shows the reason and disables Confirm. The gate does not apply to review-only retries: when the
mint already succeeded this session, or the submission is still `InReview` with a `loan_id` (drawn,
review POST failed, so the API nulled `draw_loan`), Approve is enabled with no blocked reason, the
dialog notes "Already on-chain — confirm to record the review.", and Confirm only POSTs the
`Approved` review — no draw. A submission with a stale router-state copy that lacks
`draw_loan` is treated like `null`; the live list copy drives Approve.

**Encoding (`@pipeline/wallet-connect` `encodeDrawLoanArgs`).** The deployed registry is
`draw_loan(metadata_uri: String, economics: ImmutableLoanData) -> u32`, reached through
`executor.execute(target, "draw_loan", args, caller)` with `caller` = the connected trustee
address = the transaction source, so one source-account signature satisfies `caller.require_auth()`.
The args are exactly `[string metadata_uri, map economics]`; the economics map has the 8 keys
sorted (`borrower_ref`, `original_equity_tranche`, `original_facility_size`,
`original_maturity_date`, `original_offtaker_price`, `original_senior_tranche`, `origination_date`,
`senior_interest_rate`) as symbols: `borrower_ref` as 32 bytes decoded from the 64 hex characters,
the four amounts as `u128` from `BigInt(string)` (never `Number`), the rate as `u32` and the dates
as `u64`, all taken verbatim from the served block. Input is validated strictly and throws
`drawLoan: invalid draw_loan input <field>` **before any RPC call** (`mapMintError` maps it to "This
submission's on-chain inputs are incomplete. No signature was requested."). The contract's own
invariants (tranches, maturity, offtaker price) are not duplicated client-side: they surface
through the simulation ("Could not verify the loan on-chain"). Injected ids
(`STELLAR_LOAN_REGISTRY_EXECUTOR_ID` / `STELLAR_LOAN_REGISTRY_ID`) come from the caller, never
hardcoded.

**Idempotency guard — re-click after a mint-succeeded/review-failed retry:** `useDrawLoan`'s
underlying mutation retains its `isSuccess`/`data` state for as long as the review hook instance
(keyed to one submission id) stays mounted — an in-session "minted" marker. If the mint (step 1)
succeeds but the review call (step 2) then fails, re-clicking Approve checks that marker first:
when already-successful for this submission, `approve()` skips step 1 entirely and re-fires only
the review call — no second on-chain mint is ever attempted on retry. **Accepted residual:** a
hard page reload between mint-success and finalize-failure loses this in-memory marker (React
Query cache is not persisted across reloads) — a subsequent Approve would attempt another on-chain
mint. No backend reconciliation exists to close this gap; a deliberately accepted bound (#831),
not a deferred follow-up.

**Known limitation (#831 Open Question 4, accepted scope):** if the mint succeeds but the
subsequent review call fails, the loan is minted on-chain while the DB submission stays
`InReview` — a distinct message warns against blindly retrying (a retry would attempt another
on-chain mint). Robust reconciliation (the worker already indexes `loan_drawn`) is deferred to a
follow-up backend issue — see `docs/exec-plans/tech-debt-tracker.md`.

### Register debt token (#1766)

A drawn loan has no debt token until `DealTokenFactory.register_deal(loan_id: u32)` runs (Stellar; the EVM arm is [below](#evm-1892)). It is a separate, explicit signature, never chained into Approve. `register_deal` is `#[only_owner]` with the AccessManager as owner, so it is reached through `AM.execute(factory, "register_deal", [loan_id], caller)` by a `TRUSTEE` wallet (`relay`, #1761); the factory id is `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`.

- **Placement.** One shared control, `-RegisterDebtTokenAction.tsx`: a "Debt token" card on every loan-detail layout (performing, watchlist, matured), and an inline block under the "Approved & drawn" banner on the origination detail once the drawn loan id is known. Registered loans render nothing on the loan page; the origination block swaps in "Debt token registered · <address>".
- **Source of truth.** Registered or not is decided by `deal(loan_id)` only (`readDeal`): `Error(Contract, #4)` means not registered, any other failure is a read error and renders no action and "—". `debt_address(loan_id)` is never used for this: it returns a deterministic address even for unregistered loans. `Deal` is `{ debt }` (a legacy `cargo` field is ignored); `loan_id` is u32.
- **Debt token row.** "Registry state & derived" gains `Debt token`, tag `chain`, showing `Deal.debt` verbatim, or "—" when not registered or the read fails.
- **Gating.** `can_call(caller, factory, "register_deal")` mapped by `accessAction`: immediate role signs `execute` in one step; a delayed role schedules, then executes after the ready time (the Risk Council flow, `riskCouncilRoleLine`); no role disables the button with "Only the Trustee role can register a loan's debt token." An unset factory id shows "Debt token registration isn't configured for this environment."
- **Errors** (`lib/dealToken.ts`, codes from `DealTokenFactoryError`): `#2` loan id too large, `#3` already registered, `#5` the issuer has not made the factory the DEBT admin (`set_admin`); `#1` (registry `NonExistentLoanId`, propagated by the factory) reads as "The registry has no loan with this id." AccessManager codes win for schedule/execute (`#6`-`#9`). Factory codes are mapped in execute mode only; anything else gets the generic simulation copy with the raw text behind "View details".
- **After success** the `deal-token`, `evm-deal-token`, `register-deal-access` and `audit-log` queries are invalidated (and again after 5 s); the worker already indexes `DealRegistered` on both chains (EVM since #1892, BUG-39).

#### EVM (#1892)

An EVM loan on `ENV.EVM_CHAIN_ID` uses the same component, mount points, test ids, copy, `accessAction` states and invalidation as Stellar ("everything the same as on Stellar, the same approach"); the arm is picked by the loan's `chain_id`. The gate is `loanActionChainReason`: another non-Stellar chain id keeps the Stellar-only reason and no button.

- **Call.** `AccessManager.execute(factory, registerDeal(uint256))`, `value 0` (or `schedule(factory, data, 0)` for a delayed role), through `relayEvmRegisterDeal` and `sendEvmContractCallChecked`; selector `0x19da0d36`. The caller is `msg.sender`. `registerDeal` is `restricted` on `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` (`0x536b6c688f09d8f7`, the role that holds `drawLoan`); `drawLoan` never calls it. The copy still says "Trustee role" (as Disburse, #1574 row 24).
- **Access read.** `readEvmCanCall(wallet, factory, 0x19da0d36)`, then `readEvmOperationSchedule` (`hashOperation(caller, factory, calldata)` + `getSchedule`) when `!immediate && delay > 0`; key `["register-deal-access", chainId, address, loanId]`.
- **Deal read.** `readEvmDeal` through `useEvmDeal`, key `["evm-deal-token", chainId, loanId]`; `useLoanDeal(chainId, loanId)` calls both `useDeal` and `useEvmDeal` and picks one by chain, so the two caches never share a key (the #1574 shared-key bug). The row and the inline line print the EIP-55 `Deal.debt` verbatim.
- **Errors** (`registerDealError`): custom-error names in the decoded details. `LoanRegistryNonExistentLoanId` reads as the `#1` copy and `DealTokenFactoryAlreadyRegistered` as the `#3` copy, in execute mode only; `AccessManagerNotScheduled` / `NotReady` / `Expired` / `AlreadyScheduled` read as the `#6`-`#9` copy; anything else (including `AccessManagerUnauthorizedCall`) gets the generic simulation copy with the raw text behind "View details". There is no `#2` (uint256 ids) or `#5` (no issuer) analogue.
- **No trustline and no issuer step.** `registerDeal` deploys the per-loan `DealToken` itself (CREATE2, salt = loan id); the token is an ERC-20 that only the factory mints, so its holder needs no trustline (Disburse already skips it, `trustline: null`).
- **Config.** `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS` and `VITE_EVM_ACCESS_MANAGER_ADDRESS`; either unset shows the same not-configured copy.
- **Indexing.** The EVM worker accepts both `DealRegistered(uint256 indexed loanId, address debt)` (topic0 `0xc272178e…`, Hoodi v5 and contracts #51 and later) and the legacy `(…, address cargo)` (`0x32ae7784…`) per log; the DEBT-only row carries `cargo: null` and the DEBT token is tracked alone ([backend](../references/backend.md#evm-dealtokenfactory-1485)).
- **Hoodi check (2026-11-19, read only, nothing submitted).** Factory proxy `0xCf54…eCDC`; `registerDeal(uint256)` and `deal(uint256)` are in the implementation; `getTargetFunctionRole` is `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`; both trustee wallets (`0x96ef…c04e4`, `0xd3b9…a57c`) have `canCall = (true, 0)`, so the schedule path is not reachable there and is covered by unit tests only; `AM.execute(factory, registerDeal(0))` from `0x96ef…c04e4` reaches the factory and reverts `LoanRegistryNonExistentLoanId` (the registry holds no loans), and from a wallet without the role reverts `AccessManagerUnauthorizedCall`.

**Differences from Stellar** (everything not listed is identical):

| # | Area | Stellar (#1766) | EVM (#1892) |
|---|---|---|---|
| 1 | Chain gate | `stellarOnlyActionReason` | `loanActionChainReason`: open on `ENV.EVM_CHAIN_ID`; another non-Stellar id keeps the Stellar-only copy |
| 2 | Call | `AM.execute(factory, "register_deal", [u32], caller)` / `AM.schedule(…)` via `relay` | `AccessManager.execute(factory, registerDeal(uint256))`, `value 0` / `schedule(factory, data, 0)`; caller = `msg.sender` |
| 3 | Selector / encoding | symbol `register_deal`, `u32` arg | `0x19da0d36`, `uint256` arg; ids that are not safe non-negative integers are refused before any RPC call |
| 4 | Role / access read | `TRUSTEE`, `can_call(caller, factory, "register_deal")` | `LOAN_REGISTRY_MANAGER_ADMIN_ROLE`, `canCall(wallet, factory, 0x19da0d36)`; copy still says "Trustee role" |
| 5 | Schedule lookup | `readOperationSchedule` | `readEvmOperationSchedule` (operation id over calldata) |
| 6 | Deal read | `readDeal` via `useDeal`, `["deal-token", …]`, `Error(Contract, #4)` is `null` | `readEvmDeal` via `useEvmDeal`, `["evm-deal-token", …]`, `DealTokenFactoryNotRegistered` is `null`; consumers use `useLoanDeal` |
| 7 | Debt address shown | Soroban `C…` verbatim | EIP-55 `0x…` verbatim |
| 8 | Error mapping | Soroban codes `#1`/`#2`/`#3`/`#5` (execute), AM `#6`-`#9` | error names: `LoanRegistryNonExistentLoanId` is the `#1` copy, `DealTokenFactoryAlreadyRegistered` the `#3` copy (execute only); AM names map to `#6`-`#9`; no `#2` / `#5` analogue |
| 9 | Issuer precondition | the DEBT issuer must `set_admin(factory)` first (`#5`) | none: `registerDeal` deploys the `DealToken` |
| 10 | DEBT trustline | not part of registration (Disburse step 5; ops `just new-deal <id>`) | none anywhere |
| 11 | Simulate failure | `"<mode> simulation error: <Soroban error>"` | `"registerEvmDeal: simulation error: <viem message>"`; same user copy |
| 12 | Stages | `awaiting-signature` during simulate, then `submitting`, `confirming` | no stage during simulate, then `awaiting-signature`, `confirming` |
| 13 | Signing | Stellar wallet `signTransaction` | EVM wallet; a wrong network switches to `ENV.EVM_CHAIN_ID`; mock wallets refused |
| 14 | Wallet guard (raw) | "Stellar wallet not connected." | "EVM wallet not connected." (same mapped copy) |
| 15 | Config | `VITE_STELLAR_DEAL_TOKEN_FACTORY_ID`, `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` | `VITE_EVM_DEAL_TOKEN_FACTORY_ADDRESS`, `VITE_EVM_ACCESS_MANAGER_ADDRESS` |
| 16 | Invalidation | `deal-token`, `register-deal-access`, `audit-log` | the same plus `evm-deal-token` (both arms invalidate all four) |
| 17 | Access key | `["register-deal-access", address, loanId]` | `["register-deal-access", chainId, address, loanId]` (both arms) |
| 18 | Indexed event | `deal_registered` map `{debt}` or legacy `{cargo, debt}`, told apart by map keys (#1788) | `DealRegistered(uint256,address)` or legacy `(…,address)`, told apart per log by topic0 (#1892, BUG-39); same row (`cargo: null`), same audit-log text |

### Review error copy

`useReviewSubmission` contract source of truth: `packages/api/src/routes/loan_book.rs`,
`review_submission` — Approve sends `{decision:"Approved"}` with **no** `reason` key (sending one
→ `400`); Reject/Request-changes send `{decision, reason: "<non-empty>"}` (missing/empty → `400`);
only `InReview`/`ChangesRequested` submissions are reviewable (already-decided → `409`). On
success, every `["loan-submissions", ...]` query is invalidated (key-prefix match) so the table
and detail page both refetch.

Mapped copy (#1041 / #1037): review-mutation errors (`401`/`403`/`409`/`400`/default) come from
the shared trustee `toUserError` status table — raw backend text is never rendered inline, only
via `errorDetails` behind the `InlineError` "View details" dialog. Mint errors (`useDrawLoan`)
run through the same trustee mapping layer (wallet rejection → preflight guard →
simulation-error shape → status table → fallback). Full mapping spec:
[`error-handling.md#trustee-mapping-layer`](./error-handling.md#trustee-mapping-layer).

### Reason-dialog shell & validation

`-RejectReasonDialog.tsx` and `-RequestChangesDialog.tsx` share the same shell (`role="dialog"`,
`aria-modal="true"`, `aria-labelledby` on the title, Escape + Cancel-button close, backdrop click
closes **without** submitting — mirrors Cancel, never a stray submit) and the same validation hook
(`-useRejectReasonDialog.ts`): the reason must be **at least 5 characters after trimming
whitespace** — submit is disabled and an inline error shows until satisfied; this is a
client-side UX guard, the backend also 400s on an invalid reason but is not the source of truth
for the message. Request Changes uses a multi-line `<textarea>`; Reject uses a single-line input
(re-skinned to Figma `4116:14123` by #838, replacing the original 3-row textarea). No Figma
reference exists for the Request-changes dialog — its styling simply follows Reject's.

### Request changes (#1017)

Mirrors Reject exactly: a pure DB review call (`{decision:"ChangesRequested", reason}`, backend
#949) — no on-chain step, non-final (the submission stays open for re-review). Opens
`RequestChangesDialog` (textarea reason, same min-5-trimmed-chars validation as Reject's
`RejectReasonDialog`, re-skinned to Figma `4116:14123` by #838 — "Send to originator" + Cancel).
The inert "Request changes" button and the "Approval mints the loan NFT…" footer note (both
present pre-#838) were removed by #838 — no backend endpoint existed for the former, and the
latter was redundant with the confirmation dialog's copy.

## Risk Council actions

**Sources:** user docs [risk-committee](../user-docs/governance/risk-committee.md), [multisig-roles](../user-docs/governance/multisig-roles.md), [fiduciary-trustee](../user-docs/governance/fiduciary-trustee.md) §"Independence", [protocol-layer](../user-docs/how-it-works/protocol-layer.md) §"Roles", [default-management](../user-docs/risks/default-management.md) (closure table, §"Declaration", §"Write-down", §"Cure"), [emergency-response](../user-docs/security/emergency-response.md). Code: `packages/wallet-connect/src/stellar/contracts/riskCouncil.ts`, EVM (#1943, epic #1937) `packages/wallet-connect/src/evm/contracts/{riskCouncil,minter,logs}.ts` against `pipeline-contracts@150631a` (`PipelineLoanRegistry` `setDefault` / `cure` / `amendEconomics` / `adjustInterest` / `writeDown` / `closeDefaulted`, `PipelineMinter.reverseRepay` / `extsload`); trustee `api/useRiskCouncil.ts`, `lib/targetChains.ts` (`riskCouncilChainReason`, `riskCouncilTargetId`), `lib/accessManagerAction.ts`, `lib/riskCouncilOps.ts`, `routes/-risk-council-shared.ts` (presenter base and action view), `routes/-RiskCouncilParts.tsx`, `routes/-risk-council-pending.ts` (served pending operations, shared by the hub and every per-loan surface), then per page `-risk-council-{escalate,reterm,writedown,hub}.ts` with `risk-council.{escalate,reterm,writedown}.$id.tsx` and `risk-council.index.tsx`. Issues #782 (shells), #1761 (AccessManager model, epic #1795), #1943 (EVM, epic #1937). Product spec: [trustee-dashboard.md](../product-specs/trustee-dashboard.md) §"Type 3"; escalation context: [trustee-risk-watchlist.md](../product-specs/trustee-risk-watchlist.md). User stories: [1761](../user-stories/epic-1795/1761-risk-council-access-manager.md). SecurityRegistry functions: [Risk Council security actions](#risk-council-security-actions).

### Model

A Risk Council wallet calls the AccessManager (AM). When `can_call` returns `immediate` it runs one `execute`. Otherwise it runs `schedule`, waits for the delay, then runs `execute`. There is no Safe, proposal, vote or timer in the app. The Trustee role cannot call any of these functions. The Figma frames are styling only.

LoanRegistry functions, all `RISK_COUNCIL` through the AM (`target = ENV.STELLAR_LOAN_REGISTRY_ID`, AM = `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`; guardian role `GUARDIAN`):

| Page | Function | Arguments |
|---|---|---|
| Escalate | `set_default` | `loan_id: u32` |
| Default resolution | `cure` | `loan_id: u32` |
| Default resolution | `write_down` | `loan_id: u32`, `amount: u128` (7-decimal SAC base units) |
| Default resolution | `close_defaulted` | `loan_id: u32`, `reason: ClosureReason` (`Default` or `OtherWriteDown`, `scvVec([scvSymbol])`) |
| Amend economics | `amend_economics` | `loan_id: u32`, `new_rate: u32` (bps × 100, as `rollover`), `new_maturity_timestamp: u64` |
| Amend economics | `adjust_interest` | `loan_id: u32`, `delta: i128` (negative = waiver), `reason_hash: BytesN<32>` |

Reads: `loan_money(loan_id)` (`accrued_interest, carved_out, disbursed, outstanding, repaid, written_down`) and `mutable_loan_data(loan_id)` (`status, closure_reason, current_rate, current_maturity_timestamp, interest_adjustment, written_down, carved_out, …`). The AM id of a scheduled operation is `hash_operation(caller, target, fn, args)`, so it covers the caller; `get_schedule(id)` is `0` when nothing is scheduled.

The rate scale is pinned by the encoder test: `rateBps 1450` encodes `u32(145000)`; the current-terms card shows `current_rate / 100` bps through `formatBpsRate`. This is the contract's fixed unit, not a derived metric.

### Availability (`can_call`)

`useRiskCouncilAccess(chainId, call | null, fn)` reads `can_call(wallet, registry, fn)`; when `delay > 0` and `call` is set it also reads the schedule. `accessAction` maps it:

- `execute-now` (`immediate`): one click, a single `AM.execute`; the chip reads "Risk Council · executes at once".
- `schedule` (`delay > 0`, nothing scheduled): `AM.schedule` (`when = 0`); chip "Risk Council · {N h} delay".
- `execute-scheduled`: "Scheduled. Executable from {UTC}." from the on-chain ready time, then `AM.execute`.
- `no-role` (`immediate: false, delay: 0`, for example Trustee-only): the page renders read-only with the per-action copy, the button is disabled, chip "Risk Council only".

Chain state is read through `useRiskCouncilLoanState` (`["risk-council-loan", chainId, loanId]`, `staleTime` 15 s) and shown raw through `formatChainAmount`; nothing is computed client-side. Mutations invalidate `risk-council-access`, `risk-council-loan`, `risk-council-inspectors`, `loan-book`, `loan-financials`, `loan-security` and `audit-log` immediately and again at 5 s and 15 s.

### Finding a schedule after a reload

No `localStorage`. Every per-loan page and the hub list the loan's pending operations from `pending_operations` on `GET /v1/loan-book` ([Risk Council pending operations](#risk-council-pending-operations)), so an operation scheduled from another browser or wallet shows after a reload, and its scheduler executes it from the card with the served arguments, with nothing retyped. Re-entering the same values in a form still shows "Scheduled. Executable from …" as a fallback: `set_default` and `cure` are looked up from `[loan_id]` alone, and the forms with arguments run the schedule read on the form's current valid arguments. `adjust_interest` uses `reason_hash = sha256(utf8(reason.trim()))`, shown as hex under the field. Those form lookups use the connected wallet as `caller`, so a Trustee-only wallet never finds a schedule through a form; the served list is not per caller.

The page-local store (`lib/riskCouncilOps.ts`, in memory, `useSyncExternalStore`) records operations this console scheduled in this browser session (`{ chainId, call, scheduledAt, executedHere }`). For every LoanRegistry and SecurityRegistry operation it also keeps `operationId`, `readyAt`, `caller`, `target` and `argsXdr` (`riskCouncilArgsXdr` for LoanRegistry calls) as a bridge until the indexer serves the operation. `get_schedule` reads `0` after execute, cancel and expiry, so the state cannot tell them apart. For a recorded operation that was not executed here and now reads `0` (at least 14 s after it was scheduled), the card shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session." The chain-state card beside it shows what happened.

### Pages

Per-loan pages validate the `chain` search param (`parseLoanRouteSearch`) and reuse the shells, cards and tokens of #782 for styling. Each action card has: role line, button, stage text ("Waiting for wallet signature…", "Submitting on-chain…", "Confirming…"), inline error, and the submitted hash.

- **Escalate to Default** (`/risk-council/escalate/$id`, flow 10). Left: the ledger card (facility / senior, Principal repaid from chain `loan_money.repaid`, then the security rows from `/security` — Security value, LTV line ("{ltv} — margin call open" / "above the {n}% margin-call ratio" / "margin call at {n}%", coloured by the Security card's tone rule), Advance / margin-call ratio and, only when true, Price stale — then days on watchlist, at-risk %, concentration). The security rows are omitted entirely (no "—" placeholder) for a not-configured registry or `terms: null`; while `/security` loads they show "Loading…" and when it fails with no data they show "Couldn't load" (never a bare "—", which would look like EVM). With no valuation the LTV line reads "No valuation yet — margin call at {n}%". There are no CCR or Collateral rows and no CCR trend (#1906). Right, in order: the "Scheduled operations" card (all of the loan's pending operations; `set_default` rows get Execute, other rows a link to the page that owns them), then "Declare default" with the effects text from default-management §"Declaration" and the chain-state rows (Status, Outstanding principal, Written down, Pocket opened). Enabled when chain status is `Performing` or `WatchList`; a `Default` loan shows "This loan is in Default." with a link to the resolution page; `Closed`/`Approved` show "Not available for a {status} loan." Buttons: "Declare default" / "Schedule default" / "Execute default"; the primary button opens a confirm dialog ("Declare default on Loan #{id}? The pocket opens on the first default.", `role="dialog"`, Escape and backdrop cancel). No-role copy: "Declaring a default belongs to the Risk Council."
- **Amend economics** (`/risk-council/reterm/$id`, flow 11). Current terms from chain (coupon from `current_rate`, maturity, accrued interest, interest adjustment, signed) plus an LTV row from `/security` (same line as Escalate; omitted when hidden, not configured or `terms: null`; "Loading…" while `/security` loads and "Couldn't load" when it fails with no data) instead of the former CCR from the loan book. Amend card: new rate % (live "= N bps" echo, same rules as the rollover dialog) and a date input (`dateInputToUnixUtc`, UTC midnight), buttons "Amend economics" / "Schedule amendment" / "Execute amendment". Adjust-interest card: signed USD delta (optional leading `-`) and reason, with the hash; buttons "Adjust interest" / "Schedule adjustment" / "Execute adjustment". Available for any chain status except `Closed` and `Approved`. The first card of the right column is "Scheduled operations" (`amend_economics` and `adjust_interest` rows get Execute, other rows a link). No-role copy: "Changing loan economics belongs to the Risk Council."
- **Default resolution** (`/risk-council/writedown/$id`, flow 12). Left: chain state (Status, Outstanding principal, Disbursed, Repaid, Written down, Pocket opened, Closure reason). Right, in order: **Scheduled operations** (`write_down`, `close_defaulted` and `cure` rows get Execute, other rows a link); **Write down** (USD amount, initial value from chain `outstanding` via `formatChainAmount`, editable, converted with `usdInputToSacBaseUnits`); **Close defaulted loan** (radio `Default` / `OtherWriteDown`, each with "Risk Council only · 24 hours" from the closure table); **Cure** (effects: "The loan returns to WatchList. The pocket stays open; later repayments still go to the pocket holders."). All three need chain status `Default`; otherwise the page shows "This loan is not in Default." with a link back to Escalate. No-role copy: "Writing down, closing a defaulted loan and curing belong to the Risk Council."
- **Close-defaulted split.** Scheduling is not closing, so **Schedule close** is allowed whenever the status is `Default` and can run in parallel with the write-down delay. **Execute close** (immediate or scheduled) is enabled only when chain `loan_money.outstanding` is the string `"0"`; otherwise "Executable once the outstanding principal is zero." A close scheduled too early can expire (7 days after its ready time).
- **Hub** (`/risk-council`, `-risk-council-hub.ts`). Chain: `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID` (chain-scope rule). It shows the docs sentence ("The Risk Council acts through the access manager. Declaring a default executes at once; every other Risk Council action waits 24 hours, and the Guardian or the Admin can cancel it during the wait."), a "Scheduled operations" table and a per-loan action index. Scheduled rows are the `pending_operations` of every `GET /v1/loan-book?chain_id=` row (`useLoanBook(chainId)`, 30 s poll), plus operations this console scheduled in this session whose id the API does not serve yet (the session bridge, merged per loan with `mergePendingOps`; an operation executed here is hidden, and a bridge row whose id the API served and then stopped serving is dropped). Columns: Loan, Action (`pendingActionLabel`), Arguments (the shared `pendingArgRows` joined as "Label: value", for example "New rate: 14.50% (1450 bps) · New maturity: …", "Closure reason: Other write-down"; "Arguments: <raw JSON>" when the shape does not decode; "—" when there are none), Scheduled by (short address, "· this wallet" for the connected wallet), Executable from (UTC), State ("Waiting", "Ready" or "Expired"; expired rows are listed) and a link. There is no Execute on the hub: the link opens the page that owns the function (`set_default` → Escalate, `amend_economics` and `adjust_interest` → Amend economics, `write_down`, `close_defaulted` and `cure` → Default resolution, `set_terms`, `resolve_flag` and `release_with_consent` → Security, `reverse_repay` → the loan detail page, where the Repayment recovery dialog lives). Every wallet sees the rows, with or without the Risk Council role and without a connected wallet, because the API is not per caller. Empty state "No scheduled operations found."; footnote: "Inspector panel changes are not tied to a loan and are not listed here; open the Inspector panel to check one." (`set_inspectors` is not loan-scoped and is not served). A no-role wallet sees "Risk Council actions belong to the Risk Council." Loan index: `Performing`/`WatchList` → Declare default, Amend economics; `Default` → Resolve default, Amend economics; `Closed` → none. Links carry `chain`.

### EVM

The hub and the three per-loan pages run the same model on `ENV.EVM_CHAIN_ID` (#1943), one-to-one with Stellar: `canCall`, then one `AccessManager.execute`, or `schedule`, wait, `execute`. Everything not listed in the table below is identical: routes, page layout and test ids, cards, copy (including "Risk Council only · 24 hours" in the closure table), the `accessAction` model, the session bridge and its dedup by `operation_id`, ownership and link rules of the pending rows, the executed-row behaviour, the status gates, the close-defaulted split, invalidation keys and timings, the confirm dialogs, and the recovery dialog structure ([Repayment recovery](#repayment-recovery-1711)). The write client, stages, wrong-network switch, `canCall` selector, operation id, schedule and execute calls, verbatim `calldata`, camelCase `function`, ABI `args`, address comparison and wallet are the [security page's](#evm-1942) (rows 1 to 9, 15 and 17 of its table).

The one chain gate for the Risk Council is `riskCouncilChainReason(chainId)`: `null` for Stellar and for `ENV.EVM_CHAIN_ID`, otherwise `stellarOnlyActionReason(chainId)`; it delegates to `loanActionChainReason`, so there is one predicate. It replaces the #1942 per-function and per-`target_kind` gates. So an EVM chain id other than the configured one keeps the old behaviour: read-only pages with the Stellar-only reason, and on the hub only the header and the reason line. `stellarOnlyActionReason` stays for every non-Risk-Council caller; recovery step 2 uses `loanActionChainReason` (#1574). The hooks pick the arm by chain (`isStellarTarget`). The logical calls stay chain-neutral (`RiskCouncilCall`, snake_case `fn`, `ReverseRepayCall`); the Solidity names come from `EVM_RISK_COUNCIL_FUNCTION_NAMES` and the selectors from the ABI (`evmRiskCouncilSelector`, never hard-coded).

| Function (`PipelineLoanRegistry`, `restricted`, `whenNotPaused`) | Selector | Logical call | Notes |
|---|---|---|---|
| `setDefault(uint256)` | `0xe0da6b66` | `set_default` | |
| `cure(uint256)` | `0xb7e5262a` | `cure` | |
| `amendEconomics(uint256,uint32,uint64)` | `0x00b14774` | `amend_economics` | `newRate = rateBps * 100` (the `ONE = 1e6` scale, as Stellar), `uint64` maturity |
| `adjustInterest(uint256,int256,bytes32)` | `0x6d10dec4` | `adjust_interest` | signed delta in 6 dp, non-zero, within `int256`; `bytes32` hash sent as `0x` + the 64 hex of `riskCouncilReasonHash` |
| `writeDown(uint256,uint256)` | `0x5bd45aa1` | `write_down` | amount in 6 dp |
| `closeDefaulted(uint256,uint8)` | `0x7892936e` | `close_defaulted` | `ClosureReason` ordinal: `Default` is 4, `OtherWriteDown` is 5 |

The target is `ENV.EVM_LOAN_REGISTRY_ADDRESS` and the AccessManager `ENV.EVM_ACCESS_MANAGER_ADDRESS`; a missing address gives "On-chain Risk Council actions are not configured for this environment." The encoder (`encodeEvmRiskCouncilCalldata`) applies the Stellar encoder's validation rules: a safe non-negative id, `rateBps` an integer from 1 to 10 000, `maturity` above 0, `delta` and `amount` decimal strings, the hash `/^[0-9a-f]{64}$/`, and only `Default` or `OtherWriteDown` as closure reasons. Enums are `uint8` ordinals: `LoanStatus` is `Approved, Performing, WatchList, Default, Closed`, `ClosureReason` is `None, ScheduledMaturity, EarlyRepayment, Cancelled, Default, OtherWriteDown`; the EVM enum has `Cancelled` at 3, the Stellar one does not. Selectors, ordinals and the Minter storage slot are pinned in the wallet-connect tests against `forge inspect` output of the 150631a build.

**Reads.** `useRiskCouncilLoanState` runs `mutableLoanData(loanId)` and `loanMoney(loanId)` on `ENV.EVM_LOAN_REGISTRY_ADDRESS` (`readEvmLoanChainState`, `readEvmLoanMoney`) and maps them to the Stellar shapes: `status` and `closureReason` from ordinals to the enum names (a closure reason can read `Cancelled`), `currentRate` and `currentMaturity` directly, `interestAdjustment` (signed), `writtenDown`, `disbursed`, `repaid`, `outstanding` and `accruedInterest` as decimal strings, `carvedOut`. An out-of-range ordinal throws. Nothing is computed.

**Amounts.** Write-down and adjust-interest inputs convert with `usdInputToSacBaseUnits(input, chainAmountDecimals(chainId))`: 6 dp on EVM, 7 on Stellar. The prefill and every display already format by chain (`formatChainAmount`). The rate and maturity conversions are unchanged.

**Errors.** `evmCouncilErrorCopy(details, kind)` keys by custom-error name: the four AccessManager names (`EVM_AM_ERROR_COPY`) for every target kind; the SecurityRegistry names and the SecurityRegistry `EnforcedPause` (`EVM_SECURITY_ERROR_COPY`) only for `security_registry`. `EnforcedPause` for `loan_registry` and `minter` is `LOAN_REGISTRY_PAUSED_COPY` ("The LoanRegistry is paused. Executing is blocked until it resumes.": all six LoanRegistry Risk Council functions are `whenNotPaused`, and `Minter.reverseRepay` reaches the paused LoanRegistry through `unrecordPayment`). Other LoanRegistry errors have no copy and go through `toUserError`, as on Stellar. `EVM_ERROR_NAME` also matches `LoanRegistry[A-Za-z]+` and `Minter[A-Za-z]+`. The relay's ABI carries `evmRiskCouncilErrorAbi` (the `LoanRegistry*` errors and `EnforcedPause`).

**Differences from Stellar** (#1761, #1924, #1711 versus #1943):

| # | Area | Stellar | EVM |
|---|---|---|---|
| 1 | Chain gate | none (Stellar is the only chain) | `riskCouncilChainReason(chainId)`: open on `ENV.EVM_CHAIN_ID`, another EVM chain id keeps the Stellar-only copy |
| 2 | LoanRegistry args | `u32` id, `u32` rate, `u64` maturity, `i128` delta, `u128` amount, `BytesN<32>` hash, `ClosureReason` as `scvVec([scvSymbol])` | `uint256` id, `uint32` rate (same bps × 100), `uint64` maturity, `int256` delta, `uint256` amount, `bytes32` hash (`0x` + hex), `ClosureReason` ordinal 4 / 5 |
| 3 | Amount input units | 7 dp | 6 dp via `chainAmountDecimals(chainId)` in write-down and adjust-interest |
| 4 | Chain-state reads | `simulateRead` `mutable_loan_data` / `loan_money`, enum tags | `readContract` `mutableLoanData` / `loanMoney`, ordinals mapped to the same names; `closureReason` can read `Cancelled` |
| 5 | Pending `args` decode (LoanRegistry, Minter) | `[u32, …]`, `amend_economics` rate number, maturity string, `close_defaulted` `["Default"]`, `reverse_repay` `[u32, u32, hash]` | ids and `repaymentId` decimal strings within `u32`, rate number, maturity / amount / delta decimal strings, `closeDefaulted` ordinal 4 / 5, hashes lowercase hex without `0x` |
| 6 | Recovery candidates | registry views `repayment_data`, `is_repayment_reversed`, `mutable_loan_data.next_repayment_id` | `mutableLoanData.nextRepaymentId` plus `PaymentRecorded` / `PaymentUnrecorded` / `CashRepaid` logs scanned from `VITE_EVM_START_BLOCK` in 50 000-block chunks (TD-190) |
| 7 | Reversal effects | Minter view `repayment(...)` | `CashRepaid` log plus the Minter `Repayment` record via the legacy `repayment(...)` view, or `extsload` where it is absent (`carvedOut`, `released` shown as the Pocket-unrelease principal) |
| 8 | Reverse `refHash` | `sha256("pipeline:reverse_repay:{minterId}:{loan}:{repayment}")`, 64 hex | the same preimage with the EIP-55 Minter address, sent as `0x` + 64 hex |
| 9 | Recovery role | `RISK_COUNCIL` through the AM (`reverse_repay`) | `MINTER_OPS_ROLE` on Hoodi (shared with other Minter operations, accepted as deployed); the UI follows `canCall`, copy unchanged |
| 10 | Recovery step 2 | `useRecordPayment` (Stellar `repay`) | `useRecordPayment` EVM arm (#1574, [EVM (#1574)](#evm-1574)) |
| 11 | Error copy | Soroban codes per target kind | custom-error names: `evmCouncilErrorCopy(details, kind)`, `evmRecoveryErrorCopy` |
| 12 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_LOAN_REGISTRY_ID`, `VITE_STELLAR_YIELD_MINTER_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_LOAN_REGISTRY_ADDRESS`, `VITE_EVM_MINTER_ADDRESS`, `VITE_EVM_START_BLOCK` (`.env.example`, `docker/trustee/entrypoint.sh`) |
| 13 | Live data | Stage chain 99000001 has Risk Council schedules | none on Hoodi: every role delay is 0, so no schedules occur; a Trustee wallet holding `LOAN_REGISTRY_MANAGER_ADMIN_ROLE` gets `execute-now` for the Risk Council functions (the same role gates the Trustee LoanRegistry functions there, accepted as deployed). Minter reads that need `extsload` fall back as in #1574 |
| 14 | Risk Council delay | separate role with a 24 h execution delay: schedule, wait, Execute | set by the deployment; 0 on Hoodi, so the action runs at once through `AccessManager.execute` and no AccessManager operation is ever scheduled. The hook already takes both paths (execute now, or schedule then Execute when the role has a delay); pending operations show only when the deployment has a delayed role (#1939, #1941). An accepted, documented difference |

Live data: QA runs in #1945 on the stage env. Not in this issue: `default_breach` (TD-189). Rollover, Update lifecycle, Record coupon / repayment, Close loan and Disburse on EVM are [#1574](#evm-1574).

### Errors, config and roles

- Generic `toUserError` plus local AM copy (`RISK_COUNCIL_AM_ERROR_COPY`): `execute:6` nothing scheduled, `execute:7` not ready, `execute:8` expired ("Schedule it again"), `schedule:9` "This operation is already scheduled. It may have been scheduled outside the indexed window; the scheduling wallet can execute it once it is ready." Local because Soroban codes collide across contracts.
- Config: `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID` and `VITE_STELLAR_LOAN_REGISTRY_ID`; a missing one gives "On-chain Risk Council actions are not configured for this environment." The Risk Council wallet must also be a trustee in the API's `auth_users`, or the pages cannot be opened (deployment fact). Until #1756 lands the whole role is delayed on the current deployment, so `set_default` takes the scheduled path there.
- Contract preconditions are not readable from this repo; the UI gates follow the docs (one constant per function) and the contract stays the authority. Simulation errors surface through `toUserError` and the AM copy.
- Not in the app: cancelling a scheduled operation (`AM.cancel`, TD-159).

## Risk Council security actions

**Sources:** contract `pipeline-stellar-contracts@e9881ac`, `contracts/security-registry/src/lib.rs` (`set_terms` 594, `resolve_flag` 518, `release_with_consent` 505, `set_inspectors` 555, `inspectors` 720), `types.rs` (`Terms`, `FlagOutcome`), `error.rs`. Code: `packages/wallet-connect/src/stellar/contracts/securityRegistry.ts` and `scval.ts`; trustee `api/useRiskCouncil.ts` (`CouncilCall`, `useSecurityInspectors`), `lib/riskCouncilOps.ts` (`councilTarget`), `lib/accessManagerAction.ts` (`SECURITY_REGISTRY_ERROR_COPY`), `utils/securityTermsUnits.ts`, `routes/-risk-council-security.ts` with `risk-council.security.$id.tsx`, `routes/-risk-council-terms.ts` (`formatTermsRows`, `PAYMENT_TERM_LABELS`), `routes/-risk-council-inspectors.ts` with `risk-council.inspectors.tsx`. EVM (#1942, epic #1937): contract `pipeline-contracts@150631a` (`SecurityRegistryUpgradeable.setTerms` / `resolveFlag` / `releaseWithConsent`, `PipelineSecurityRecordNft.setInspectors` / `inspectors`, OpenZeppelin `AccessManager`); Hoodi runs `pipeline-contracts@f92d719` (12-field `Terms`, `setTerms` `0x36b14cd2`), handled per build (#2082); `packages/wallet-connect/src/evm/contracts/{write,accessManager,securityRegistry}.ts` (client: [Trustee EVM contract client](wallet-flows.md#trustee-evm-contract-client)); trustee `lib/chainWallet.ts` (`useChainWallet`) and `lib/targetChains.ts` (`riskCouncilChainReason`, `sameChainAddress`). Issue #1858 (epic #1795); pending operations: #1923 (epic #1920). Served state: [loan-security-state.md](../product-specs/loan-security-state.md). User stories: [1858](../user-stories/epic-1795/1858-risk-council-security-actions.md).

The same model as [Risk Council actions](#risk-council-actions): `can_call` then one `execute`, or `schedule`, wait, `execute`. The AccessManager is the same contract (`ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`); the target is the SecurityRegistry (`ENV.STELLAR_SECURITY_REGISTRY_ID`, stored as `collateral_registry` in `addresses.json`). All four functions are `#[only_owner]` and `#[when_not_paused]`; the AM maps them to `RISK_COUNCIL`. The hooks take a `CouncilCall` (`RiskCouncilCall | SecurityRegistryCall`); `councilTarget(call)` picks the target from the function name (the names are disjoint) and the query keys include it.

| Page | Function | Arguments |
|---|---|---|
| Security | `set_terms` | `loan_id: u32`, `terms: Terms` |
| Security | `resolve_flag` | `record_id: u32`, `outcome: FlagOutcome`, `reason_hash: BytesN<32>` |
| Security | `release_with_consent` | `record_id: u32`, `consent_hash: BytesN<32>` |
| Inspector panel | `set_inspectors` | `inspectors: Vec<Address>` |

### Encoding

- `Terms` is a `#[contracttype]` struct, so an `scvMap` with `Symbol` keys sorted lexicographically (`scMap` in `scval.ts`, shared with the loan registry encoder). All 12 fields are sent: `advance_ratio_bps`, `margin_call_ratio_bps`, `default_rate`, `tolerance_bps`, `grade_tolerance_bps` are `u32`; `cure_period`, `price_stale_after`, `grace_period`, `attestation_interval`, `inspection_interval` and `margin_call_at` are `u64`; `payment_term` is `Lc | Dp | Da | OpenAccount`. `margin_call_at` is always `u64(0)`: the contract ignores it and keeps its own. A wrong key or type fails only at simulation, so the encoder test pins the exact map.
- `PaymentTerm` and `FlagOutcome` are unit variants: `scvVec([scvSymbol(name)])`, as `ClosureReason`.
- Hashes are `BytesN<32>` from `/^[0-9a-f]{64}$/`. Both are `sha256(utf8(text.trim()))` of a text field (`securityReasonHash`); there is no paste-a-hash input.
- `inspectors` is `scvVec` of `Address.toScVal()`: each a valid `G…` or `C…` Strkey, no duplicates. An empty list is valid on-chain and the UI warns. The order is part of the op hash.
- `margin_call_ratio_bps >= advance_ratio_bps` is checked before encoding (the contract returns `InvalidRatio #15`).

The AM op id is `hash_operation(caller, target, fn, args)`. After a reload the Security page lists the loan's pending operations from the API ([Risk Council pending operations](#risk-council-pending-operations)) and executes them with the scheduled arguments, so nothing is retyped. Re-entering identical form values still finds a schedule as a fallback; for `set_terms` all 12 fields must reproduce exactly, and prefilling from served terms helps only for unchanged values.

### Security page (`/risk-council/security/$id`)

Validates `chain` with `parseLoanRouteSearch`. Built on `useRiskCouncilLoanBase` and `useLoanSecurity`; nothing is computed client-side.

- **Scheduled operations.** The first card of the right column, above Set terms, lists all of the loan's pending operations: the `/security` rows plus the `GET /v1/loan-book` rows of the loan, de-duplicated by `operation_id` with the `/security` copy kept. `set_terms`, `resolve_flag` and `release_with_consent` rows get Execute; LoanRegistry and Minter rows get a link to the page that owns them. See [Risk Council pending operations](#risk-council-pending-operations). Set terms shows "A terms change is already scheduled — see above. Scheduling again creates a second operation with a new 24 h wait." while a `set_terms` row is `waiting` or `ready`; the form stays usable.
- **Current security terms.** The served terms verbatim (ratios as %, durations as d/h/s, payment term, default rate as %), the LTV line, a paused notice when `paused === true` ("The SecurityRegistry is paused. Executing is blocked until it resumes." — execute is disabled, schedule stays possible) and a refresh note while `refresh_pending`. With `terms: null`: "No security terms are set for this loan." When `/security` fails with no data the page shows the error (friendly message with details) in place of the cards, never the empty-terms state or an enabled form.
- **Set terms.** 10 numeric inputs (12 on an EVM `150631a` registry, 10 on `f92d719`; see [EVM](#evm-1942)) and a payment-term select, prefilled from served terms when present. Units: ratios and tolerances in % (at most 2 decimals, to bps, at most 1000%), `default_rate` in % (at most 4 decimals, times 10 000, the loan registry scale `ONE = 1e6`), `cure_period`, `grace_period`, `attestation_interval`, `inspection_interval` in days and `price_stale_after` in hours (decimals allowed when the result is whole seconds). Each field echoes its raw contract value live ("= 7000 bps", "= 20000 (1e6 scale)", "= 604800 s"). A served duration that is not exactly representable in the unit is left empty. Buttons "Set terms" / "Schedule terms" / "Execute terms". No-role copy: "Setting security terms belongs to the Risk Council."
- **Flagged records.** One row per served record with `flagged_by != null`: protection, lot, commodity, and the flagging inspection (the record's inspection whose `inspection_id` equals `flagged_by`, so it still shows after an `Escalated` resolution: kind, inspector, quantity, grade, the three variances in bps, verbatim). Outcome radio with the contract's effect text (Accepted: "The variance is explained: the flagging inspection's quantity and grade become the record's reference. Clears the flag."; TopUpRequired: "Opens a margin call if LTV is above the advance ratio. Clears the flag."; Escalated: "Suspected fraud or missing goods. The flag stays."), a reason text with its sha256, buttons "Resolve flag" / "Schedule resolution" / "Execute resolution". Empty: "No flagged records." No-role copy: "Settling an inspection flag belongs to the Risk Council."
- **Release with consent.** A select among served records with `open === true` (starts on "Select a record…"; no record is ever auto-selected, so the button stays disabled until one is picked and a consent text is entered; after an executed release the record and the consent text are cleared, a scheduled one keeps them so the operation can be found again), a "Consent reference" text with its sha256, buttons "Release with consent" / "Schedule release" / "Execute release". The primary button opens a confirm dialog ("Release record #{id}? This burns the record NFT and cannot be undone.", `role="dialog"`, Escape and backdrop cancel). Empty: "No open records." No-role copy: "Releasing a record with the lenders' consent belongs to the Risk Council."
- `resolve_flag` and `release_with_consent` are keyed by `record_id`; the loan is carried as context (`ScheduledOp.loanId`) for the session bridge, not derived from the args.
- The loan detail Security card links here ("Security actions", or "Set security terms" when `terms: null`).

### Inspector panel (`/risk-council/inspectors`)

Chain is the session chain. The current list is read on chain with `simulateRead` of the SecurityRegistry `inspectors()` view (`useSecurityInspectors`, key `["risk-council-inspectors", chainId]`, `staleTime` 15 s); this is contract configuration, not a computed metric (TD-186). On EVM the panel is the RecordNft's (see [EVM](#evm-1942)). The page shows the current panel, an add field (Strkey validation, duplicates refused), remove/keep per current entry, the resulting full list, a warning when it is empty, "No changes to the current panel." when it equals the current one, and the note "Applies to inspections entered from now on." After an executed change the pending edits are cleared (a scheduled one keeps them); the resulting list is de-duplicated, so the refetched panel never lists an address twice. Buttons "Set inspectors" / "Schedule inspector panel" / "Execute inspector panel". No-role copy: "Setting the inspector panel belongs to the Risk Council."

### Hub additions

The hub lists the four functions' loan-scoped rows from the API like every other operation ([Risk Council actions](#risk-council-actions), Hub). Labels: "Set security terms", "Resolve flag", "Release with consent". Arguments: "advance {a}% · margin call {m}%", "{outcome} · record #{id}", "record #{id} · consent hash {10 hex}…"; each row links to the Security page. `set_inspectors` is not loan-scoped and not served, so it is not listed, and the footnote points to the Inspector panel. The loan index adds a "Security" link for every loan that is not `Closed`, and the header links to "Inspector panel".

### Errors, config

- `SECURITY_REGISTRY_ERROR_COPY`, applied only when the target is the SecurityRegistry (Soroban codes collide across contracts): `#12` the record's status does not allow this, `#14` no security terms yet, `#15` margin call ratio below advance ratio, `#32` no flag to resolve. Everything else goes through `toUserError`. Served state lags the chain by up to a fold (30 s, `refresh_pending`), so a gate from served state can be stale at execute time and the contract stays the authority.
- Config: `VITE_STELLAR_SECURITY_REGISTRY_ID` (trustee `env.ts`, `docker/trustee/entrypoint.sh`, `.env.example`) plus the existing AM id. A missing one gives "On-chain SecurityRegistry actions are not configured for this environment." The argocd value lives in the separate `argocd` repo (`argocd/pipeline/test.yaml`, then `prod.yaml` once deployed).
- Delay: 24 h on test and prod; until #1756 the whole role may be delayed, so all four take the schedule path there. A scheduled operation expires 7 days after its ready time.
- EVM: enabled for these four functions, see the next section.

### EVM (#1942)

The security page and the inspector panel run the same model on EVM, one-to-one with Stellar: `canCall`, then one `AccessManager.execute`, or `schedule`, wait, `execute`. The routes, page layout, test ids, cards, copy, `accessAction` model, session bridge and its dedup by `operation_id`, ownership and link rules, invalidation keys and timings, and the release confirm dialog are the same. The hooks pick the arm by chain: `isStellarTarget(chainId)` is Stellar, otherwise the EVM arm. The chain gate is `riskCouncilChainReason(chainId)`: `null` for Stellar and for `ENV.EVM_CHAIN_ID`, otherwise `stellarOnlyActionReason` (#1943 replaced the #1942 per-function `riskCouncilBlockedReason` and per-`target_kind` `pendingRowBlockedReason`, so the LoanRegistry functions and rows are open on EVM too). `stellarOnlyActionReason` stays for every non-Risk-Council caller.

| Function | Target (`ENV`) | Logical call |
|---|---|---|
| `setTerms(uint256, Terms)`: `0x45f225f5` (`150631a`) or `0x36b14cd2` (`f92d719`), per the detected build | SecurityRegistry (`EVM_SECURITY_REGISTRY_ADDRESS`) | `set_terms` |
| `resolveFlag(uint256, uint8, bytes32)` | SecurityRegistry | `resolve_flag` |
| `releaseWithConsent(uint256, bytes32)` | SecurityRegistry | `release_with_consent` |
| `setInspectors(address[])` | RecordNft (`EVM_SECURITY_RECORD_NFT_ADDRESS`) | `set_inspectors` |

The AccessManager is `EVM_ACCESS_MANAGER_ADDRESS`. Nothing is read from `authority()` or `recordNft()`; a missing address gives "On-chain SecurityRegistry actions are not configured for this environment." The logical calls stay chain-neutral (`SecurityRegistryCall`, snake_case `fn`), so `CouncilCall`, `councilTarget`, `riskCouncilCallKey`, the session store and the labels are reused. `SecurityTermsInput` gains the optional `defaultRatioBps` and `originatorFeeRate`: the Stellar encoder throws when either is present, the `terms15` EVM encoder throws when either is missing, the `terms12` one when either is present (as Stellar). `set_terms` takes the detected `termsShape`; there is no default. Solidity names come from `EVM_SECURITY_FUNCTION_NAMES`, selectors from the ABI (`evmSecuritySelector`, never hard-coded).

**Encoding** (`encodeEvmSecurityRegistryCalldata`):

- `Terms` is the 15-field tuple in declaration order: `advanceRatioBps`, `marginCallRatioBps`, `defaultRatioBps` (`u32`), `curePeriod`, `priceStaleAfter` (`u64`), `paymentTerm` (`uint8`), `gracePeriod` (`u64`), `defaultRate`, `originatorFeeRate` (`u32`), `attestationInterval`, `inspectionInterval` (`u64`), `toleranceBps`, `gradeToleranceBps` (`u32`), `marginCallAt`, `defaultBreachAt` (`u64`). `marginCallAt` and `defaultBreachAt` are always `0`: the contract keeps its own. Ids are `uint256` encoded from the same safe integer (the API keeps loan ids to `u32`). On `f92d719` (`terms12`) `Terms` is the 12-field tuple `advanceRatioBps, marginCallRatioBps, curePeriod, priceStaleAfter, paymentTerm, gracePeriod, defaultRate, attestationInterval, inspectionInterval, toleranceBps, gradeToleranceBps, marginCallAt` (`evmSecurityRegistryTerms12Abi`), `marginCallAt = 0`: the Stellar field set in Solidity order.
- Enums are `uint8` ordinals in declaration order: `PaymentTerm` is `Lc, Dp, Da, OpenAccount`; `FlagOutcome` is `Accepted, TopUpRequired, Escalated`. Hashes are `bytes32` from `/^[0-9a-f]{64}$/` sent as `0x` + hex (sha256 of the trimmed text, as on Stellar).
- `setInspectors` takes EIP-55 addresses, no duplicates (case-insensitive). The RecordNft stores an `EnumerableSet`: duplicates are dropped silently and `inspectors()` returns insertion order.
- `setTerms` reverts `SecurityRegistryInvalidRatio` unless `advance ≤ margin call ≤ default` (`150631a`; `advance ≤ margin call` on `f92d719`); the form checks both before encoding.

**Deployed build (#2082).** `readEvmSecurityTermsShape` reads the EIP-1967 implementation of `EVM_SECURITY_REGISTRY_ADDRESS` (the address itself when the slot is zero), walks its opcodes and looks for the `setTerms` `PUSH4`: `0x45f225f5` alone is `terms15`, `0x36b14cd2` alone is `terms12`, anything else is an error. While the read loads, the Set terms card shows "Checking the SecurityRegistry build…" instead of the form (so it never grows from 10 to 12 inputs); on error it shows "Could not identify the SecurityRegistry build — Set terms is unavailable." with the details behind the usual details link and a Retry button, and no form. Stellar never reads it. Key `["evm-security-terms-shape", address]`, `staleTime` and `gcTime` infinite, `retry: 2`; fetched only for `set_terms` and shared by the form, `canCall` selector, schedule lookup, relay and the stored calldata. No env key: the chain is the source of truth, and neither `terms()` nor the API can tell the build before the first terms exist.

**Form.** On a `terms15` registry, Set terms adds "Default ratio (%)" (bps, after "Margin call ratio (%)", placeholder "e.g. 90") and "Originator fee rate (%)" (1e6 scale like the default rate, after "Default rate (%)", placeholder "e.g. 1"), each prefilled from `terms.default_ratio_bps` and `terms.originator_fee_rate` and echoed ("= 9000 bps", "= 10000 (1e6 scale)"). The second ratio rule has its own inline error: "The default ratio must be at least the margin call ratio." (the first keeps "The margin call ratio must be at least the advance ratio."; the view shows the first failing one). The current-terms card and the pending rows show the two extra rows when the value is served. `termsFieldsFor(chainId)` gives the field list; the view iterates `view.setTerms.fields`. On `terms12`, and while the build is unknown, the form is the Stellar one: the 10 inputs, the first rule only, and no extras in the call (`termsFieldsFor(chainId, termsShape)`; `buildSetTermsCall` is `null` until the build is known).

**Inspector panel.** Reads `RecordNft.inspectors()` on chain (`readEvmSecurityInspectors`, EIP-55 strings), the EVM counterpart of the Stellar read (TD-186). The add field reads "Add inspector (EVM address)" with placeholder "0x…" and the validation copy "Enter a valid EVM address (0x…)."; an added address is normalised to EIP-55 and duplicates are caught case-insensitively.

**Errors.** viem decodes custom errors when the ABI passed to `simulateContract` holds their `error` entries, so the AccessManager call's ABI also carries the SecurityRegistry and RecordNft errors and `EnforcedPause` (OpenZeppelin `execute` bubbles the target's revert data). `EVM_AM_ERROR_COPY` and `EVM_SECURITY_ERROR_COPY`, keyed by name through `evmCouncilErrorCopy(details, kind)` (the security names and `EnforcedPause` apply to `security_registry` only): `AccessManagerNotScheduled` / `NotReady` / `Expired` use the `execute:6/7/8` copy, `AccessManagerAlreadyScheduled` the `schedule:9` copy, `SecurityRegistryWrongRecordStatus` / `NoTerms` / `NotFlagged` the `#12` / `#14` / `#32` copy, `SecurityRegistryInvalidRatio` "The ratios must be in order: advance ≤ margin call ≤ default.", `EnforcedPause` the paused copy. Anything else goes through `toUserError`. A missing `error` entry degrades to the generic message, never to a wrong one.

**Pending operations and Execute** are in [Risk Council pending operations](#risk-council-pending-operations). Live data: no Risk Council schedules on Hoodi (role delays are 0 there, row 14 of the differences table above); Hoodi's SecurityRegistry is the pre-#55 build (12-field `Terms`), which the backend reads through dual-ABI support (#2070). QA runs in #1945. `default_breach` is served but not shown (TD-189).

**Differences from Stellar.**

| # | Area | Stellar (#1858, #1923) | EVM (#1942) | Reason |
|---|---|---|---|---|
| 1 | Write client | `relay`: Soroban envelope, simulate and assemble, wallet kit `signTransaction`, `sendTransaction`, poll | `sendEvmContractCall`: `simulateContract`, `estimateContractGas` (+20 %, capped), `writeContract({ chainId })`, receipt must be `success` | Different transaction models |
| 2 | Stages | `awaiting-signature`, `submitting`, `confirming` | `awaiting-signature`, `confirming`; no `submitting` | One `eth_sendTransaction` signs and broadcasts |
| 3 | Wrong network | none | `switchChain(ENV.EVM_CHAIN_ID)` first; `chainId` also passed as backstop | EVM wallets can be on any chain |
| 4 | `can_call` input | `fn: Symbol` | `bytes4` selector from the ABI | OpenZeppelin keys roles by selector |
| 5 | Operation id | `hash_operation(caller, target, fn, args)`, sha256 of XDR | `hashOperation(caller, target, data)`, keccak of `abi.encode`; compared as `0x` + the served 64 hex | Different preimage, same stored form |
| 6 | Calls | `schedule(target, fn, args, 0, caller)`, `execute(target, fn, args, caller)` | `schedule(target, data, 0)`, `execute(target, data)` (value 0); caller is `msg.sender` | OpenZeppelin takes the calldata |
| 7 | Native args | `args_xdr`, decoded and re-wrapped | `calldata` sent verbatim; the bridge stores `calldata` | Calldata is the exact `execute` argument |
| 8 | `function` | snake_case | camelCase, mapped to canonical; unknown or `0x<selector>` passes through | Each chain stores its native name |
| 9 | `args` display | XDR shapes | ABI shapes: `uint256` ids and `uint64` decimal strings, `uint32` numbers, enums as ordinals, tuple keyed by camelCase names, hashes as hex without `0x` | Type systems |
| 10 | `Terms` | 12-key map, `margin_call_at = 0` | 15-field tuple, `marginCallAt = defaultBreachAt = 0` (`150631a`); 12-field on `f92d719` (row 22) | #55 added three fields |
| 11 | Terms form | 10 fields | 12 fields, second ratio rule (`150631a`); 10 fields on `f92d719` (row 22) | `defaultRatioBps`, `originatorFeeRate` only exist on EVM |
| 12 | Ids and enums | `u32`, `scvVec([scvSymbol])` | `uint256`, `uint8` ordinals | ABI types |
| 13 | Inspectors | `set_inspectors` and `inspectors()` on the SecurityRegistry, Strkey, exact match | on the RecordNft, `0x` EIP-55, case-insensitive | Address format; `EnumerableSet` |
| 14 | Contract errors | `Error(Contract, #N)`, copy per target kind | custom-error names, one name-keyed map | Soroban codes vs Solidity errors |
| 15 | Address comparison | exact Strkey | case-insensitive (`sameChainAddress`) | Hex is case-insensitive |
| 16 | Config | `VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID`, `VITE_STELLAR_SECURITY_REGISTRY_ID` | `VITE_EVM_ACCESS_MANAGER_ADDRESS`, `VITE_EVM_SECURITY_REGISTRY_ADDRESS`, `VITE_EVM_SECURITY_RECORD_NFT_ADDRESS` (`.env.example`, `docker/trustee/entrypoint.sh`); the loan's chain must be `ENV.EVM_CHAIN_ID` | Separate contracts |
| 17 | Wallet | `useStellarWallet` (`signTransaction`) | `useEvmWallet` address; signing inside the wallet-connect client; the mock wallet cannot sign | Different stacks |
| 18 | Amounts | 7 dp | 6 dp served strings; these pages convert none | PLUSD has 6 decimals |
| 19 | `default_breach` | not served | served, not shown (TD-189) | EVM-only concept |
| 20 | Risk Council delay | 24 h execution delay | deployment-set; 0 on Hoodi, so `execute` runs at once and nothing is scheduled | Accepted difference; both paths handled |
| 21 | Contract build | one build per network, nothing to detect | detected per session from the SR implementation bytecode (`readEvmSecurityTermsShape`): `terms15` (`150631a`) or `terms12` (`f92d719`, Hoodi); unknown is an error: the card shows the reason with a Retry and no form, and the form is held while the build loads | Contracts and deployments are never changed, so the client adapts to the deployed build; Hoodi has no loans or terms, so `terms()` and the API cannot tell, and an env key could drift |
| 22 | Terms on `f92d719` | 10 inputs, `advance ≤ margin call`; `defaultRatioBps` / `originatorFeeRate` refused if present | the same 10 inputs, the same rule and the same refusal; `setTerms` `0x36b14cd2` with the 12-field tuple, `marginCallAt = 0` | `f92d719` `Terms` is the Stellar field set; absent fields are handled as Stellar handles them (binding directive) |
| 23 | Pending `set_terms` args | 12-key snake_case map | 15 camelCase keys (`150631a`) or 12 (`f92d719`: no `defaultRatioBps`, `originatorFeeRate`, `defaultBreachAt`); a 12-key row renders the Stellar rows | The worker decodes both selectors (#2070); Execute sends the served `calldata` either way |

## Risk Council pending operations

**Sources:** [loan-security-state.md](../product-specs/loan-security-state.md#pending-operations) (`pending_operations`, #1922), [access-manager-events.md](../references/access-manager-events.md) (`args` display form). Code: `packages/wallet-connect/src/stellar/contracts/scheduledOperation.ts` and `riskCouncil.ts` (`riskCouncilArgsXdr`), EVM `packages/wallet-connect/src/evm/contracts/accessManager.ts` (#1942; calldata rows: [access-manager-events.md](../references/access-manager-events.md#evm-args-and-operation-id)); trustee `api/pendingOperations.ts`, `api/useLoanBook.ts` (`LoanBookEntry.pending_operations`), `api/useRiskCouncil.ts` (`usePendingOperationExecute`), `lib/riskCouncilOps.ts`, `routes/-risk-council-pending.ts`, `PendingOperationsCard` and `PendingOperationsList` in `routes/-RiskCouncilParts.tsx`. Issues #1923 and #1924 (epic #1920). User stories: [1923](../user-stories/epic-1920/1923-rc-security-pending-ops.md), [1924](../user-stories/epic-1920/1924-rc-hub-pending-ops.md).

The Risk Council hub and five per-loan surfaces list scheduled operations and let the scheduling wallet execute one with the exact arguments that were scheduled. The source is `pending_operations` on every `GET /v1/loan-book` row (always an array, `[]` without the AccessManager indexer key; absent on an older API, read as empty), sorted by `ready_at`, with expired rows included. The Security page also reads `pending_operations` from `GET /v1/loan-book/{id}/security`, de-duplicated by `operation_id`.

Each surface lists all of the loan's operations. A row whose function the surface owns gets Execute. A row owned by another surface shows the state line and a link to that surface instead, and never executes: no wallet, gate or target check runs for it. A function with no owner shows the state line only. A row is owned only when its served `target_kind` also matches the owner's contract.

| Surface | Owns | Target (`ENV`) |
|---|---|---|
| `/risk-council/escalate/$id` | `set_default` | LoanRegistry (`STELLAR_LOAN_REGISTRY_ID` / `EVM_LOAN_REGISTRY_ADDRESS`) |
| `/risk-council/reterm/$id` | `amend_economics`, `adjust_interest` | LoanRegistry |
| `/risk-council/writedown/$id` | `write_down`, `close_defaulted`, `cure` | LoanRegistry |
| `/risk-council/security/$id` | `set_terms`, `resolve_flag`, `release_with_consent` | SecurityRegistry (`STELLAR_SECURITY_REGISTRY_ID` / `EVM_SECURITY_REGISTRY_ADDRESS`) |
| Repayment recovery dialog on `/loans/$id` | `reverse_repay` | Minter (`STELLAR_YIELD_MINTER_ID` / `EVM_MINTER_ADDRESS`) |

Link labels: "Open Escalate to Default", "Open Amend economics", "Open Default resolution", "Open Security", "Open loan · Repayment recovery". The AccessManager is `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` for every Stellar contract and `ENV.EVM_ACCESS_MANAGER_ADDRESS` on EVM. The hub lists the rows without Execute ([Risk Council actions](#risk-council-actions), Hub). A deployment without the field renders the empty card.

### Rows

The card "Scheduled operations" always renders; with no rows it reads "No scheduled operations found." One bordered row per operation:

- Label: "Declare default", "Cure", "Amend economics", "Adjust interest", "Write down", "Close defaulted loan", "Reverse repayment · repayment #N", "Set terms", "Resolve flag · record #N" or "Release with consent · record #N". Any other function shows its raw name.
- Arguments in the form's units, decoded from `args` (the display form) with a strict shape check (integer `u32`, decimal-string `u64` and `i128`, 64-hex hashes, known variants):
  - `amend_economics` `[loan_id, new_rate, "maturity"]`: "New rate" as `formatBpsRate` and bps (`new_rate` is bps × 100, a multiple of 100, 1 to 10 000 bps) and "New maturity" as a date;
  - `adjust_interest` `[loan_id, "delta", reason_hash]`: "Delta" signed and "Reason hash" (10 hex and "…");
  - `write_down` `[loan_id, "amount"]`: "Amount";
  - `close_defaulted` `[loan_id, ["Default"]]` or `["OtherWriteDown"]`: "Closure reason" ("Default" or "Other write-down");
  - `reverse_repay` `[loan_id, repayment_id, ref_hash]`: "Repayment" `#N` and "Reference hash";
  - `set_default` and `cure` `[loan_id]`: no argument rows;
  - `set_terms`, `resolve_flag` and `release_with_consent`: the ratios and tolerances in %, durations as d / h / s (`formatServedDuration`), default rate in %, payment term label, outcome and hashes as before (`margin_call_at = "0"`).
  A shape that does not decode shows the raw `args` JSON under "Arguments" and Execute stays allowed: the on-chain pre-check guarantees the executed bytes are the scheduled ones.
- **EVM rows (#1942).** A served row with `calldata` has `args_xdr: null`. `function` is the Solidity camelCase name, mapped to the canonical name by `canonicalPendingFunction` with the table in [access-manager-events.md](../references/access-manager-events.md#function-names-per-chain) (`EVM_PENDING_FUNCTIONS`; an unknown name or `0x<selector>` passes through raw), so owners, labels and links are the Stellar ones. `args` decodes with `decodeEvmSecurityCall`, strictly, for `set_terms`, `resolve_flag` and `release_with_consent`: ids are decimal strings within `u32`, the `Terms` tuple has exactly the 15 camelCase keys (`150631a`) or the 12 of `f92d719` (#2082) with `u32` numbers and `u64` decimal strings, `paymentTerm` is an ordinal 0 to 3, the outcome an ordinal 0 to 2, hashes are 64 lowercase hex without `0x`, and `marginCallAt` (and `defaultBreachAt` when present) is `"0"`. Anything else is `null` and shows the raw JSON with Execute still allowed. The pending rows of a 15-key `set_terms` add "Default ratio" and "Originator fee rate".
- **EVM LoanRegistry and Minter rows (#1943).** They decode with `decodeEvmLoanRegistryCall` and `decodeEvmReverseRepayCall`, strictly, and the owners, labels and links are the Stellar ones: ids and `repaymentId` are decimal strings within `u32`; `amendEconomics` is `[id, rate, "maturity"]` with `rate` an integer number that is a multiple of 100 from 100 to 1 000 000 and `maturity` a positive decimal string within safe integers; `adjustInterest` is `[id, "delta", hash]` with a signed decimal string; `writeDown` is `[id, "amount"]`; `closeDefaulted` is `[id, 4 | 5]`, shown as `Default` or `Other write-down`; `reverseRepay` is `[id, "repaymentId", hash]`; hashes are 64 lowercase hex without `0x`. Anything else is `null` and shows the raw JSON with Execute still allowed (the label of a raw `reverseRepay` row still reads the repayment number from a decimal-string id when the row has `calldata`). Amounts show at 6 dp.
- "Scheduled by": short address, plus "· this wallet" when it is the connected wallet of the loan's chain (Stellar exact match, EVM case-insensitive).
- Executed rows: after an execute from this console the row stays, with the state line "Executed", a disabled button and "Submitted · {hash}", for as long as the API still serves that schedule. It disappears once a fetch made after the execution no longer serves it.
- State line: "Waiting · executable from {YYYY-MM-DD HH:MM UTC}", "Ready · expires {YYYY-MM-DD HH:MM UTC}" or "Expired — schedule it again". The state is the served one (API clock, refreshed by the 30 s `useLoanBook` poll), so the button can lag a `waiting` to `ready` flip by up to 30 s; the contract stays the authority (`execute:7` / `execute:8` copy).

### Execute

Enabled only for an owned row when all hold: state `ready`, the connected wallet equals `caller`, the row is executable on the chain (`riskCouncilChainReason(chainId)` is `null`: Stellar or `ENV.EVM_CHAIN_ID`), `target` equals the owner's configured id, the page's status gate (below) is clear, the SecurityRegistry is not paused (security rows), and no execute is in flight. `usePendingOperationExecute` repeats the target and paused checks as hard guards before any RPC call or signature (input `expectedTarget`, `paused`; the paused guard applies to SecurityRegistry rows only): a mismatch throws `PendingTargetMismatchError` and a paused registry throws `RegistryPausedError`; the disabled button is the UI half of the same rule. Notices, first match wins: the Stellar-only reason, "Only the scheduling wallet ({short}) can execute this.", "This operation targets another {LoanRegistry|Minter|SecurityRegistry} ({short}) than this console is configured for.", then the gate (ready rows only).

Status gates for `ready` owned rows, as in the forms (an unknown on-chain status, read pending or failed, does not block):

- Escalate: "This loan is in Default." for a `Default` loan, or the not-available note for `Closed` and `Approved`.
- Amend economics: "Not available for a {status} loan." for `Closed` and `Approved`.
- Default resolution: "This loan is not in Default."; a `close_defaulted` row also needs the on-chain outstanding principal to be `"0"` ("Executable once the outstanding principal is zero.").
- Security: the paused note ("The SecurityRegistry is paused. Executing is blocked until it resumes.").
- Repayment recovery dialog: none.

Confirmation, keyed on the function and not on whether the arguments decoded: every `release_with_consent` row ("Release record #{id}? This burns the record NFT and cannot be undone.", or "Release this record? …" when the record is unknown) and every owned `set_default` row on Escalate ("Declare default on Loan #{id}? The pocket opens on the first default."). Nothing is sent before Confirm.

The arguments are never rebuilt from the form. `usePendingOperationExecute` takes the served `args_xdr` (base64 of `ScVal::Vec(args)`), and `decodeOperationArgs` turns it into the vec elements. XDR is canonical, so `relay` wrapping them in `scvVec` reproduces the same bytes and the same operation id; a round-trip test over real SDK encodings pins it for SecurityRegistry and LoanRegistry calls. Before the wallet signs, `readScheduledOperation` runs `hash_operation(caller, target, fn, args)` and `get_schedule`:

- an id different from the row's `operation_id` aborts with "The served arguments do not match this operation on chain. Reload the page."
- `readyAt = 0` aborts and shows "No longer scheduled — cancelled by the Guardian or the Admin, or executed from another session.", with nothing sent
- otherwise `executeScheduledOperation` calls `AM.execute(target, function, args, caller)`

**EVM (#1942, #1943).** The same card runs `usePendingOperationExecute`'s EVM arm and sends the served `calldata` verbatim, with no decode and no re-encode. Pre-checks, in order, before any wallet prompt: the chain gate (`riskCouncilChainReason`); the row target equals the owner's configured EVM address (`riskCouncilTargetId(chainId, kind)`: SecurityRegistry, LoanRegistry or Minter; `PendingTargetMismatchError`, case-insensitive); the served registry is not paused (`RegistryPausedError`); `ENV.EVM_ACCESS_MANAGER_ADDRESS` is set; the EVM wallet is connected and equals `caller` (case-insensitive); the row has `calldata` (else `PendingArgsMismatchError`); `hashOperation(caller, target, calldata)` equals `0x` + the served `operation_id` (`PendingArgsMismatchError`); `getSchedule(id)` is not 0 (`NoLongerScheduledError`, also what an expired row reads). Then `AccessManager.execute(target, calldata)` through `sendEvmContractCall`, with the error ABI chosen by `target_kind` (`evmSecurityErrorAbi`, `evmRiskCouncilErrorAbi` or `evmRecoveryErrorAbi`; `other` gets none) so a revert shows its name. Copy: Minter rows try `evmRecoveryErrorCopy` first, then `evmCouncilErrorCopy(details, kind)`. The immediate path of a form's Execute is also `AccessManager.execute`, never a direct target call, so a matching pending schedule is consumed and the indexer closes it.

The AccessManager id is `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID`; a console and an indexer pointed at different AccessManagers fail the pre-check and never execute anything else. Error copy is chosen by the row's `target_kind` (Soroban codes collide across contracts): Minter rows use the repayment-recovery copy first (`#8` the Minter's bank cash below the repayment's cash, `#25` already reversed) and then `RISK_COUNCIL_AM_ERROR_COPY` (`execute:6/7/8`); SecurityRegistry rows use `RISK_COUNCIL_AM_ERROR_COPY` then `SECURITY_REGISTRY_ERROR_COPY`; LoanRegistry rows use `RISK_COUNCIL_AM_ERROR_COPY` then `toUserError`. Success invalidates `loan-book`, `loan-security` and the other Risk Council keys, plus `repayment-recovery`, `repayment-recovery-access` and `loan-waterfall`, now, at 5 s and at 15 s.

### Session bridge

The page-local store bridges the indexer lag, deduplicated by `operation_id`:

- After a successful `schedule` of a LoanRegistry or SecurityRegistry call, the relay reads the schedule once and stores `operationId`, `readyAt`, `caller`, `target` and `argsXdr` (on EVM, `calldata` in place of `argsXdr`, #1942) on the `ScheduledOp`. A failing read stores the op without an id and it is not listed. LoanRegistry ops carry no `loanId` in the store; the loan comes from the call.
- A stored op for this chain and loan whose id is not yet served is shown as a row (state derived locally from `readyAt`, expiry `readyAt + 604800`) with "Scheduled from this console. The list catches up within a minute." It disappears when the API serves the same id, and it never comes back: once an id has been served in this session (any loan-book or `/security` fetch of the chain; `recordServedOperations`, `useServedOperationIds`), a stored op whose id is no longer served is dropped (cancelled by the Guardian or the Admin, or executed elsewhere), so it cannot become executable again. The hub merges the same rows per loan of the book; `set_inspectors` ops are not listed.
- There is no bridge for `reverse_repay`: its schedule path is outside the store, and the dialog's own role line ("Scheduled. Executable from …") covers the scheduler until the indexer serves the row.
- An operation executed here, from the row or from a form's Execute button, is recorded as executed (`operationId`, tx hash, `readyAt` of the executed schedule) and every stored op with that id is marked `executedHere`, so a form's "No longer scheduled" line does not fire. The row stays visible as "Executed" with its hash while the API serves the same schedule (it is hidden on the hub). The record is dropped once a loan-book (or `/security`) fetch made after the execution no longer serves the id, or serves it with another `ready_at`; a re-scheduled operation with the same arguments (same id, new `ready_at`) therefore shows as a normal row again. A form's Execute (`useRiskCouncilRelay`, `execute` mode) reads the operation's schedule (`get_schedule`) before it sends the transaction and records `{operationId, hash, readyAt}` afterwards, so it hides a served row even when the operation was scheduled from another session; an unreadable or empty (`readyAt = 0`) pre-read records nothing and never blocks the execute. The recovery dialog's "Execute reversal" does the same for the matching `reverse_repay` operation (`readReverseRepaySchedule` before `executeReverseRepay`; the dialog passes the chain id).

### Not covered

Cancelling (TD-159), reconciling served rows with `get_schedule` (TD-187), `set_inspectors` (not loan-scoped, not served), Execute on the hub, a session bridge for `reverse_repay`.

## Overview page

**Sources:** `packages/trustee/src/api/useCapitalAllocation.ts` (data hook),
`api/useUsdcCustodyBalance.ts` (on-chain interim data hook),
`components/useCapitalAllocationCard.ts` + `components/CapitalAllocationCard.tsx` (Capital
Allocation card, issue #797, extended #805/#807/#811/#1020, Figma node `4116:8928`, frame
`4116-8854`), `components/useNeedsAttention.ts` + `components/NeedsAttention.tsx` (Needs
Attention section, issue #818, Figma node `4116:9004`).

### Capital Allocation card — data layer

`useCapitalAllocation` — `GET /v1/capital-allocation?chain_id=<session chain>`, key
`["capital-allocation", chainId]`, 30 s poll. **Scope (#1601): the chain the trustee signed in
with** (`useSessionState().chainId`, `ENV.STELLAR_CHAIN_ID` only as the no-session fallback).
Product rule (#1600): a surface that aggregates across networks shows every chain; a per-network
surface follows the connected chain. The card describes one chain's deployment — Capital Wallet,
Withdrawal Queue wallet, trust-account residuals, deployed senior and T-Bills are per-chain
custody — so summing them across chains (what an omitted `chain_id` means since #1586) would blend
two books into one total and one bar. The Overview therefore mixes scopes on purpose: Needs
Attention and the loan book are cross-network work queues (#1537), this card is per-network, and a
chain chip beside the card title (`capital-allocation-chain`) makes that visible. The earlier
Stellar pin (#765, malformed Hoodi rates) is no longer the reason: readers are LoanRegistry-scoped
since #1543 and an EVM session reads the EVM allocation by choice. Every bucket and `total` is a base-6 decimal string
already in human units, or `null` when the backend has no source for that field yet (today only
`deployed` is indexer-sourced) — render `—` for `null`, never derive a value client-side
([[no-frontend-computed-metrics]]).

**Capital Wallet on-chain fold-in (#805, TD-41, #1684).** `useUsdcCustodyBalance(chainId)` reads
the Deposit Manager's USDC custody account on the session chain — that custody account is the
on-chain source of the **Capital Wallet** balance-sheet bucket, so the hook is named for the
account it reads, not for the bucket it feeds (it is unrelated to `VITE_STELLAR_CAPITAL_WALLET_ID`,
the PLUSD receiver introduced in #1449). It is an interim substitute for the backend
`capital_wallet` bucket (`null` until `capital_allocation.rs` indexes it):

- **Stellar:** `usdc.balance(ENV.STELLAR_USDC_CUSTODY_ID)` on the 7-decimal SAC via `getSacBalance`.
  A misconfigured custody id (pointing at the USDC issuer) surfaces as `error` through its own
  sentinel guard, never a fabricated ~$922B balance.
- **EVM:** ERC-20 `balanceOf(VITE_EVM_USDC_CUSTODY_ADDRESS)` on `VITE_EVM_USDC_ADDRESS` through
  `getErc20Balance` (a read-only viem public client over `VITE_EVM_RPC_URL`), scaled by the token's
  own `decimals()`.

Either raw bigint becomes the same human-decimal string as the backend buckets so it feeds the
existing formatters and summing logic. The chain id is part of the query key, so a chain switch
never serves the other chain's cached value. An unconfigured pair for the session chain, or a chain
id that is neither configured chain, makes no RPC call and returns
`{data: undefined, isLoading: false, error: null}` (row shows `—`). The card passes the chain it
already resolved (`useCapitalAllocation().chainId`) and folds the result in without a chain gate
(#1684, TD-156); a read error degrades only the Capital Wallet row and the total's extra addend.

**Guarded total (human-approved, #805) — a documented exception to
[[no-frontend-computed-metrics]]:**

- **Legend value:** prefer the backend `buckets.capital_wallet` when non-null (avoids stale
  on-chain data once the backend catches up); otherwise the on-chain balance; otherwise `—`.
- **Total:** `data.total` already includes `capital_wallet` once the backend sources it, so the
  on-chain balance is added **only** while `buckets.capital_wallet` is `null` — a double-count
  guard. If the backend total is `null` but the on-chain balance is known, the on-chain value is
  shown as the sole known total (real data, not fabricated); `—` only when neither source has
  anything.
- This is an interim client-side sum of two authoritative real sources, not a derived/estimated
  metric — remove once the backend serves `capital_wallet` (the guard already prefers it).
- A read error/loading/unset-id on the on-chain source degrades **only** the Capital-Wallet legend
  value (and the total's extra addend) to `—`/backend-only; it does not drive the card's overall
  `isError`/`isLoading` — only the backend `useCapitalAllocation` query does that (keeps the card
  resilient to a flaky RPC).

**Per-bucket percentage pills (Figma node `4116:8961`, human-requested scope addition, TD-41):**
each legend row shows `bucket_value ÷ displayed_total` (the same guarded total above), rounded to
the nearest whole percent — a deliberate, explicitly requested reversal of the original "no
client-computed percentages" deferral. A `null`/absent bucket, unknown total, or `<= 0` share
renders no pill (never a fabricated `0%`). A strictly-positive share under 1% renders `"< 1%"`
(human review follow-up, PR #811) — not rounded down to `"0%"` or up to `"1%"`. Percentages are
**not** normalized to sum to 100 — independent per-bucket rounding may total 99% or 101%, matching
the Figma reference.

**Proportional allocation bar (review follow-up on #805, PR #811, TD-41):** each legend row
carries `barFraction`, the exact unrounded share of the displayed total in `[0,1]`, sizing each
bar segment's width — superseding the original inert equal-width placeholder bar. A `null`
`barFraction` renders no segment for that bucket (filtered before mapping), using the raw fraction
(not the rounded/`< 1%` text) so segments sum to ~100% rather than drifting from rounding.

Six legend rows: Capital Wallet, In transit, Trust account, Withdrawal queue, Deployed, T-Bills
(USYC) — the Figma's five buckets plus the `withdrawal_queue` bucket the backend added later
(#933, rendered per #1020).

**Removed static mock chrome (#825):** the green reconciliation header ("RECONCILES TO PLUSD
BACKING · DRIFT < 0.01%") and the four provenance chips below the legend had no backing API field
and were removed per the "no fabricated/frontend-computed metrics" convention. If real
provenance/drift data ever lands, they can be re-added wired to that source.

**Net scope for the Overview page (#797, human-confirmed 2026-07-08)** — everything else in the
Figma frame is deferred/out of scope: no header timestamp (no `as_of`/`generated_at` API field
exists yet); no standalone Cash-in-Transit or Active Deal cards — removed entirely (the
`in_transit` bucket stays in the Capital Allocation legend). The Loans — Payments Due / Cash
Management / Risk Council groups of Needs Attention remain deferred to follow-up issue #799
(blocked on backend endpoints).

**`children` composition (#818, human review follow-up):** the Figma background node `4116:8928`
wraps the entire Overview page content — Capital Allocation **and** Needs Attention — in one
continuous white surface, not two separate stacked cards. Rather than duplicating the `Card`
wrapper in a second component (which would render a visible gap/second white block), the Overview
route passes `<NeedsAttention />` in as `children` to `CapitalAllocationCard`, rendered directly
after the card's own content, inside the same `Card`, separated by 48px (#825). `NeedsAttention`
itself renders plain content with no `Card` of its own, independent of the Capital Allocation
card's own loading/error state (it gates on its own hook).

Figma → token mapping: card white surface `rounded-[4px]` (`--radius-pipeline-card`) `p-[32px]`;
total Besley display `text-[58px]/leading-[81.2px]` ink; bar/legend colors `#000080` →
`--color-pipeline-brand` (exact), `#208000` → `--color-pipeline-positive-primary` (exact);
`#c9a200`, `#6666b3`, `#3d8f8f` (withdrawal_queue, postdates the Figma frame) have no matching
token — scoped one-offs (same precedent as `SignInCard`'s blur effect); the mid-grey segment
(`rgba(56,55,53,0.35)`) is a darker alpha step of the ink token family than any existing
muted/subtle token, likewise a scoped one-off. Percentage pill background `rgba(191,189,187,0.12)`
— same one-off as the nav badge background; percent text `rgba(56,55,53,0.6)`, another ink-family
alpha step with no exact token match.

### Needs Attention section

Two groups, both defensively read (`loan_data` is `serde_json::Value` on the wire):

- **Origination** — in-review + changes-requested submissions (#818, #1046). Title:
  `` `${friendlyOriginator} — ${commodity}: ${statusSuffix}` `` — the suffix is `"new request"`
  for `InReview` and `"changes requested"` for `ChangesRequested` (#1046, origination-table
  vocabulary) — where `friendlyOriginator` is `loan_data.originator` (the friendly name, e.g.
  "Open Mineral") — **not** the top-level `SubmissionView.originator` (the authenticated submitter
  address); the opposite field choice from the Origination table's Originator column, which
  intentionally uses the top-level field — both are correct for their own row shape. Subtitle:
  `"${commodity} · ${corridor} · submitted ${date}"` (backed fields only); the Figma subtitle also
  references the valuation mode and attached documents, neither backed pre-mint — omitted, not
  fabricated. Any missing segment is dropped cleanly rather than rendered as a bare `—` mid-string.
  Action: the Review button navigates to `/origination/$id`, passing the row's `SubmissionView` as
  router state (mirrors the Origination table's InReview cell) — same link for ChangesRequested
  rows, whose detail page renders the reason banner (#950).
  **Sourcing (#1046):** the submissions fetch is deliberately UNFILTERED — the group needs
  `InReview` + `ChangesRequested`, but the backend's `SubmissionsQuery.status` accepts a single
  status per request, so one unfiltered call filtered client-side (via
  `normalizeOriginationSubmissionStatus`, the origination table's #1044 pattern) beats two
  parallel filtered queries — one request, and it shares the
  `["loan-submissions", chainId, "all"]` cache with `useOriginationTable`. The group keeps exactly
  the normalized statuses `InReview` and `ChangesRequested`: merged/lifecycle statuses normalize
  to `Approved` (#892) and belong on the Loans surfaces, and `Rejected` is a terminal decision
  record with nothing left to act on. `ChangesRequested` was originally excluded as
  originator-actionable (#949/#950); #1046 reversed that — an origination awaiting a resubmit
  stays visible on the Overview.
- **Loans** — Watchlist + Matured loans from `useLoanBook` (#867): `WatchList`/`Watchlist` →
  "Watchlist"; past-maturity (`Past Due`, legacy `Matured`) → "Matured". A loan with the served
  `margin_call_open === true` is also listed (#1767): "Margin call open", or "{label} · margin call
  open" when it is Watchlist / Matured; `Closed` and `Default` are skipped and a loan yields one
  row, matching `GET /v1/attention-counts` `loans.margin_call_open`. EVM loans are included by design (#1942, N2): the row agrees with the loans table LTV column, the Security card and the security page, and its subtitle names the chain. Links to `/loans/$id`
  with `search: { chain: row.chainId }`; the subtitle ends with the chain label and the row key is
  `${chain_id}:${loan_id}` (#1537).

**Scope (#818, cross-linked to #799):** the Loans — Payments Due, Cash Management, and Risk
Council groups (Figma nodes `4116:9018`+) are deliberately omitted — no backend endpoints exist
for them yet. Only the Origination and (later, #867) Loans groups render.

**Empty/loading/error handling (resolved, human review):** the section — heading and all —
renders nothing unless there is at least one row in either group. No skeleton on loading, no
error surface — this is a supplementary block, not the page's primary content (unlike
`CapitalAllocationCard`, which does show loading/error states).

Figma → token mapping: section heading "Needs Attention" Besley display `text-[36px]
leading-[46px]` ink (a non-token one-off, same precedent as the card's `58px` total); group header
uppercase `text-[12px] leading-[16.8px] tracking-[0.96px]` ink-muted; row `bg-[rgba(211,235,117,
0.16)]` + `border-[rgba(56,55,53,0.18)]` (scoped one-offs, no matching token), `rounded-[4px]
min-h-[72px] px-[17px] py-[15px]`; icon circle 36px brand bg wrapping the sidebar's
`OriginationIcon` lightbulb glyph (reused rather than redrawing the Figma SVG asset — both are the
lightbulb glyph); Review/Open button brand bg, white text, `rounded-[4px] h-[40px] px-[16px]`
(human review follow-up: an earlier cut wrongly copied the Origination *table*'s disabled Review
button shape, a different Figma component — corrected).

## Session & auth

**Sources:** `packages/trustee/src/auth/**` (`TrusteeSessionProvider.tsx`, `sessionStore.ts`),
`components/TrusteeShell.tsx`, `components/SignInOverlay.tsx`,
`components/SignInCard.tsx`, `routes/__root.tsx`.
Issues: #791 (flow), #793/#794/#795 (modal hardening), #921/#988/#1009 → **#1008** (gating
architecture). Backend contract: `docs/product-specs/api-authorization.md` /
`packages/api/src/routes/auth.rs`.

### Render-level auth gate (#1008, #1749)

Auth is one render-level gate and nothing else. `TrusteeShell` renders `SignInOverlay`
(Figma `4174-31660`) whenever the session is not authenticated, **on any URL**, and never mounts
protected route content (`<Outlet/>`) while signed out, so no authenticated API calls fire either.
No session status change (sign-in, token expiry, unauthorized reset) issues a navigation: the
address bar stays where the user is, no history entries are added, and the content follows the
session status. The one exception is the explicit **Sign out** click in the sidebar Account menu:
its handler issues a single `navigate({ to: "/", replace: true })` (so Back never returns to a
protected URL) and then calls `signOut()`. `signOut()` itself clears the session and disconnects
wallets and never navigates, so the unauthorized "Try a different wallet" reset stays URL-neutral.
There is no `/sign-in` route.

The root route has a `notFoundComponent` that renders `<Navigate to="/" replace />`, so any
unknown path (a stale `/sign-in` bookmark included) lands on `/`. Signed out, the shell renders
the overlay before the outlet, so the redirect mounts only after sign-in. That navigation is
driven by an unmatched path, never by a session status change.

The app-level error boundary ([App bootstrap](#app-bootstrap--providers)) turns any thrown render
error, including a falsy one, into a visible error view instead of a blank page.

**History:** #1008 added the render-level gate plus a `/sign-in` URL convention. Three
URL-synchronization approaches raced in production builds and stranded the URL on `/sign-in`: a
render-phase `<Navigate>` (#921), `beforeLoad` + `router.invalidate()` (#988, `invalidate()` does
not re-run the root guard and `beforeLoad` only runs during navigations), and a reactive navigate
alone (#1009). **#1731** (white screen after sign-in and after logout on staging, console
`Uncaught undefined`, fixed by a refresh): logout fired two overlapping navigations and sign-in
overlapped the hook's navigation with the `beforeLoad` redirect and an address-bar self-heal.
Overlapping loads share the root match's `_nonReactive` state (`@tanstack/react-router` 1.168.x),
so a load could leave the rendered root match `pending` after another load had cleared its
`loadPromise`; `Match` then **throws that `undefined`** during render. TanStack's `CatchBoundary`
renders its error view only `if (error)`, so the falsy throw passes through every router boundary,
reaches the React root and unmounts the whole tree. **#1749** removed the URL layer entirely
(`routes/sign-in.tsx`, `authGate.ts`, `useAuthRedirect.ts`, the root `beforeLoad`): with no
navigation on auth changes there is nothing to overlap. The router upgrade (>= 1.170) is TD-158.

| Scenario | URL | Content |
|---|---|---|
| Visit `/` signed out | `/` (unchanged) | overlay |
| Deep-link `/loans` signed out | `/loans` (unchanged) | overlay; after sign-in the loans page on the same URL |
| Sign in | unchanged | page for the current URL |
| Sign out click (sidebar Account menu) from any page | `/` (one `replace` navigation from the click, no history entry added) | overlay |
| Token expiry mid-session | unchanged | overlay |
| Old `/sign-in` bookmark or any unknown path | `/` via root `notFoundComponent` (signed out: overlay first, redirect after sign-in) | overlay, then dashboard |

### Sign-in flow (#791, hardened #793/#794/#795)

`TrusteeSessionProvider` orchestrates; `SignInCard` is the UI (idle / "Connecting…" /
unauthorized-error states).

1. `signIn()` sets `status = "connecting"` and **always opens the wallet-connect modal** — sign-in
   must be driven by the user's deliberate chain pick, never ambient wallet state (#795: wagmi
   auto-reconnects a persisted EVM session on page load, which used to hijack sign-in and skip the
   modal, so Freighter/Soroban was never offered). The picked chain (`onWalletSelect`) becomes the
   sole driver, with per-chain semantics:
   - **EVM:** already connected → sign-in runs immediately (wagmi treats a same-connector
     reconnect as a no-op, so a watch effect alone would miss this case, #794); not yet connected
     → the watch effect runs it once EVM connects.
   - **Stellar:** there is **no** immediate run from ambient state (#1106): the kit persists the
     last wallet, so the hydrated address may belong to a *different* wallet than the row the
     user just clicked — signing it produced Hana's "Incorrect wallet" rejection for a
     Freighter-addressed challenge. Every Soroban row click re-fetches via
     `useStellarConnectors().connectWallet`, which **clears the shared store address before
     `setWallet`/`fetchAddress`** — so no consumer can sign for the previous wallet mid-switch,
     and even a same-address re-pick produces a store transition (undefined → address) that
     fires the watch effect. Sign-in therefore always uses the freshly fetched address of the
     wallet actually picked.
   A wallet on the *other* chain never triggers sign-in. Dismissing the modal with no pick resets
   to `unauthenticated` (#793 — no stuck "Connecting…"). An `orchestrating` ref makes the
   challenge/verify orchestration single-flight.
   The trustee mounts `ConnectModalProvider` with **`signMessageOnly`** (#1112): the Soroban tab
   offers only wallets whose kit module implements `signMessage` — Freighter, xBull, LOBSTR
   (Albedo/Rabet cannot sign messages and would dead-end after the challenge; they stay available
   in the LP app, which only needs `signTransaction`). Belt-and-braces, `runSignIn` also
   distinguishes the kit's unsupported-wallet rejection (`code: -3`) from a genuine user decline:
   unsupported surfaces an explanatory `unauthorized` error ("This wallet cannot sign
   authentication messages…"), while a true decline stays silent per spec.
2. `GET /v1/auth/challenge?address=&chain_id=` — `401` = address not on the server allow-list →
   `unauthorized` + explanatory error (authorization is entirely server-side); a `400` whose
   message starts with `unknown chain_id` (the Trustee's configured chain is not in the API's
   `CHAINS`, #1568 — e.g. Trustee EVM chain `1` against an API configured for `99000002`) →
   `unauthorized` + "This network isn't supported by the sign-in server. Contact your
   administrator." (`isUnsupportedNetwork`, never the raw API error); other failures →
   "could not reach the sign-in service".
3. The wallet signs the challenge `message` (EVM `personal_sign` hex / Stellar SEP-0053 base64 via
   `@pipeline/wallet-connect`). A rejection returns to `unauthenticated` **silently** — a user
   choice, not an error.
4. `POST /v1/auth/verify` — on success the token is stored (`setSession`) and `status` flips to
   `authenticated`; **no navigation happens anywhere in the flow** (the render-level gate swaps the UI
   on the current URL). A `401` here (nonce race / signature mismatch) surfaces as
   "verification failed"; the `400 unknown chain_id` case maps to the same network-not-supported
   message as step 2.

`signOut()` clears the stored token and disconnects both wallets and does not navigate; the
sidebar Sign out click first replaces the URL with `/`. There is no server logout endpoint (bearer-token transport, per the #791 Decision Log) — sign-out is
purely client-side.

### Session store (`sessionStore.ts`)

Module-level external store (the same pattern as `@pipeline/wallet-connect`'s Stellar
`connectionStore`), single source of truth for the backend-issued JWT:

- Persisted in **`sessionStorage`** (not `localStorage`) under `pipeline.trustee.session` — the JWT
  must not outlive the browser tab (#791 storage-choice rationale). Hydrated once at module load;
  expired stored sessions are dropped on hydrate.
- Exposes the reactive `useSessionState()` (via `useSyncExternalStore`) plus **non-hook accessors**
  (`getSessionToken()`, `getSessionState()`) for `apiFetch` and the router guard, which run outside
  React. `getSessionToken()` is deliberately pure — no writes/notifications, so a fetch reading the
  token never triggers a re-render (#795).
- **Reactive expiry:** a timer armed on every `setSession` (and at hydrate) evicts the session the
  instant its ~24 h token expires, so an idle trustee is re-gated without needing a failed API call
  (#795). Statuses: `unauthenticated | connecting | authenticated | unauthorized`.

### Trustee sidebar (Figma node `4116:8855` "Aside")

`TrusteeSidebar` is the persistent left nav panel, replacing the earlier topbar nav (#786). Full
trace: `docs/exec-plans/completed/issue-786-trustee-app-shell.md` "Decisions" + "Exact layout spec".

- Active state is driven by TanStack Router (`activeProps`), not a hardcoded label. `Link`'s
  `className` and `activeProps`/`inactiveProps` classNames are **concatenated** (not swapped) by
  the router, so putting a `color` utility in both the base className and `activeProps` would
  leave two same-specificity Tailwind classes fighting over `color` at once — fragile, not
  reliably "active wins". Instead the base className carries only layout (no color/background);
  active/inactive surface + text color are mutually exclusive, only one ever present.
- **Count badge slot** is fed by `useNavBadgeCounts` (`components/useNavBadgeCounts.ts`, #1350),
  which maps the response of `useAttentionCounts` (`api/useAttentionCounts.ts`): one
  `GET /v1/attention-counts` with no `chain_id` ([spec](../product-specs/trustee-attention-counts.md)),
  polled every 30 s, no retry on a 4xx. Origination and Loans read the combined `count` (all
  chains); Cash Management reads the `count` of the `chains[]` entry for
  `useSessionState().chainId`, with no Stellar fallback (decision #786-2,
  [[no-frontend-computed-metrics]]). A served integer renders verbatim; a served `0` hides the
  badge, like an absent field. There is no badge while loading, on error (including a failed
  refetch with stale data), when a field is absent, or when the session chain has no entry.
  Overview, LP Counterparties, Risk Council and Audit Log never have a badge.
  On the active item (surface background) the badge switches to the brand token with on-dark
  text so the count stays readable; inactive items keep the translucent badge.
- **Account chip**, pinned to the bottom: avatar circle, truncated address, "Trustee · connected"
  subtitle, and a `⋯` affordance opening a small popover menu with "Sign out" (decision #786-4),
  wired to `useTrusteeSession().signOut`. Renders nothing when `address` is undefined (never the
  string `"undefined"`).
- Desktop-only for this issue (decision #786-5) — no mobile drawer/collapse; responsive behavior
  is tracked in `docs/exec-plans/tech-debt-tracker.md`.
- Two dividers (`rgba(235,233,230,0.25)`, documented one-off — no theme token, same precedent as
  `SignInCard.tsx`): after Overview, and before the Risk Council / Audit Log group.
- **Network switcher (#1032):** a static current-network label sits next to "Trustee ·
  connected"; the `⋯` popover gains switch-network rows above "Sign out" when
  `VITE_NETWORK_LINKS` supplies sibling deployments. Full behavior:
  [`wallet-flows.md#network-switcher-cross-deployment-links`](./wallet-flows.md#network-switcher-cross-deployment-links).

### Sign-in card (Figma node `4174:33891`, frame `4174-31660` "Unauthenticated Overlay")

`SignInCard` renders the "Connect Wallet" prompt inside `SignInOverlay`. "Connect Wallet" wires to
the sign-in flow above; the `unauthorized` status (backend `401` — address not on the allow-list)
renders inline as an error state on the card. There is no client-side on-chain role check —
authorization is entirely server-side.

Figma → token mapping: card white surface, border matches `--color-pipeline-line`, `rounded-[24px]`
(no existing radius token is 24px — `--radius-pipeline-card-lg` is 16px — a documented one-off),
`p-[32px] gap-[24px]`, fixed `w-[520px]`, a subtle `backdrop-blur` (Figma "Blur" effect, radius 32,
no shared token, scoped to this card only). Icon badge: navy circle `size-[56px] rounded-[28px]`
(a perfect circle at this size), `--color-pipeline-brand` fill (exact token match), centered white
`LockIcon`. Heading Besley display serif `36px/46px` ink; subtext body `16px/22px` ink-muted.
Actions: full-width black pill button (`--color-pipeline-cta` fill, `--radius-pipeline-pill`
radius, 48px tall) labelled "Connect Wallet"; the `!` override on its className overrides the
`Button` component's built-in radius/`min-w-12` (Tailwind v4 equal-specificity hazard, #357 — the
same pattern `Button` itself uses for its `compact` size override); caption footer ink-muted,
centered.

## App bootstrap & providers

**Sources:** `packages/trustee/src/main.tsx`, `components/AppErrorBoundary.tsx`,
`lib/diagnostics.ts`, `lib/nav.ts`, `api/auth.ts`. Issues: #786 (nav),
#791 (sign-in flow / provider stack).

The app's favicon is the Pipeline wordmark SVG (`public/pipeline.svg`, sourced from
`https://pipeline.one/pipeline.svg`, a true vector), declared in `index.html` (#1102). The
sidebar account chip's avatar glyph paints white (`text-white` on the wrapper —
`AvatarIcon` fills with `currentColor`), matching its white ring on the dark sidebar (#1102).

`main.tsx` configures the shared `@pipeline/wallet-connect` slice (`setWalletConnectConfig`)
before rendering `EvmWalletProvider`/`StellarWalletProvider` — those providers initialise AppKit /
the Stellar kit lazily on first render (not at module load), so the call only needs to precede
`createRoot(...).render(...)`, not any particular import (#791). The `QueryClient` is a module-
level singleton so React StrictMode's double-mount doesn't create two clients (`EvmWalletProvider`
mounts its own internal `QueryClientProvider` for wagmi; this one is for Trustee-owned fetching).
On a local e2e stack only, `main.tsx` also calls `loadE2EWallet()` (`lib/e2eWallet.ts`), which
registers the Stellar [E2E test wallet](../../packages/frontend/src/wallet/README.md#e2e-test-wallet)
under its guards (#1970); a production build drops it.

Provider order mirrors the LP frontend's `main.tsx`, minus `WalletGateProvider` — the Trustee
omits the LP first-connection terms gate (internal operators; see the #791 exec plan's Decision
Log). Without a `WalletGateContext.Provider` mounted, `@pipeline/wallet-connect`'s gate hooks
default to a no-op (immediate proceed). `TrusteeSessionProvider` is NOT mounted in `main.tsx` —
it mounts inside the root route (`routes/__root.tsx`), below `<RouterProvider>`, next to the shell
it feeds. It no longer needs router context (`signOut()` stopped navigating, #1731).

**Error boundary (#1731).** `RouterProvider` is wrapped in `AppErrorBoundary`
(`components/AppErrorBoundary.tsx`), inside `ConnectModalProvider`. It is a class component that
stores `{ caught: true, error }` and branches on `caught`, never on `error`, so a thrown
`undefined` is caught. This is required because TanStack's `CatchBoundary` renders its error
component only `if (error)` (1.168.x): a router `defaultErrorComponent` alone does not prevent
the white page for a falsy throw. The error view (`AppErrorView`) shows "Something went wrong",
the message (`Non-error value thrown: …` for a non-`Error`), the stack when present, the current
pathname and a **Reload** button (`window.location.reload()`, the same as the manual refresh;
no auto-recovery loop). The same view is the router's `defaultErrorComponent` and does not depend
on router context.

**Diagnostics (`lib/diagnostics.ts`).** `installGlobalErrorReporting(router)` runs before render
and logs to the console only (no external telemetry): `error` and `unhandledrejection` events, and
the boundary's `componentDidCatch`, as `[trustee] <source>` with the value, its `typeof`, the
router pathname / status / pending pathname and `window.location.href`. It also handles
`vite:preloadError` (a lazy chunk that 404s after a deploy): one `window.location.reload()`,
guarded by a `sessionStorage` timestamp (`pipeline.trustee.preloadReloadAt`, 10 s); a repeat
within the window is logged and left to the boundary.

### Toasts

`components/ToastProvider.tsx` is the trustee's one transient-feedback surface, mounted in
`routes/__root.tsx` inside `TrusteeSessionProvider` and around `TrusteeShell`, so every route can
raise one. It exports `ToastProvider` and `useToast()`, which returns `{ showToast(title, tone?) }`
— `tone` defaults to `"success"` and is forwarded to `@pipeline/ui`'s `Toast`, the only renderer.
One toast is live at a time (a second call replaces the first), it auto-dismisses after
`TOAST_TIMEOUT_MS` (2.4 s), and the timer is cleared on unmount. The container is pinned to the
**bottom-right corner** (`fixed right-[24px] bottom-[24px] z-[60]`), not centred — a centred toast
sits over the content the operator just acted on. It is `pointer-events-none` (the toast itself
re-enables them) so it never blocks the page under it, and `max-w-[calc(100vw-48px)]` keeps it on
screen on a narrow window.

`useToast()` outside a provider returns a no-op `showToast` rather than throwing, so component
tests that render a section in isolation need no wrapper. Introduced by #1453 for the deposits
table's [`AddressText`](#shared-detail-primitives) copy confirmation — an inline "Copied" inside a
table cell reflows the row.

### Nav sections (`lib/nav.ts`)

`TRUSTEE_NAV_ITEMS` defines the six nav sections per Figma node `4116:8855` ("Aside") and
`docs/product-specs/trustee-dashboard.md` (spec #453): Overview, Origination, Loans, Cash
Management, Risk Council, Audit Log. This replaced the #777 scaffold's `TRUSTEE_FLOW_TYPES`
(Type-1..4 taxonomy) — the Figma nav is the real product navigation (#786). Badge counts are runtime data supplied by `useNavBadgeCounts` (#1350, see
[Trustee sidebar](#trustee-sidebar-figma-node-41168855-aside)), not a `TrusteeNavItem` field.

### Auth endpoint wrappers (`api/auth.ts`)

Typed wrappers over `GET /v1/auth/challenge` / `POST /v1/auth/verify` (#791). Contract source of
truth: `packages/api/src/routes/auth/wallet.rs` and `docs/product-specs/api-authorization.md`.
Both calls **require a configured `chain_id`** (#1559): `getAuthChallenge(address, chainId)` and
`VerifyRequest.chainId: number` (no optional form, so no caller can omit it, #1568); the value is
the deployment's `ENV.EVM_CHAIN_ID` / `ENV.STELLAR_CHAIN_ID` for the picked chain. A missing id is
a `400 chain_id is required`; an id not in the API's `CHAINS` is a `400 unknown chain_id: <id>
(configured: …)`. A `401` from `challenge` means the address is not on the server allow-list —
the sign-in flow renders it as "not authorized" (see
[Sign-in card](#sign-in-card-figma-node-417433891-frame-4174-31660-unauthenticated-overlay));
a `401` from `verify` means an unknown address, no outstanding challenge, or a bad signature
(usually an expired or already-consumed nonce).
