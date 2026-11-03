# Issue #1826: Trustee: show both LP settlement addresses (Stellar + EVM, with signer) and mint each bank deposit to the address for its chain

Source: https://github.com/eq-lab/pipeline/issues/1826

Parent epic: #1269 (Trustee LP Counterparties). Frontend flow, `packages/trustee` only. Branch
`feat/1826-trustee-settlement-addresses`, PR #1841 → `main`.

Backend contract on `main`: #1824 (PR #1828, signed Stellar + EVM linking, signer fields) and #1831
(PR #1834, relink at any time incl. after `Passed`, `lp_settlement_address_history`).

**No Figma.** Neither the Issue nor epic #1269 links frames. The epic says so explicitly: screens
follow the shipped Trustee design system. `trustee-flows.md` § LP Counterparties records the same
("no Figma … styling is derived from the shipped `/loans` page"). Every element below is built from
existing Trustee primitives: `KeyValueRow`, `AddressChip`, `StatusChip`, `DetailCard`, and the
Record-deposit dialog shell (`useLpReviewDialog`). No new screen is added. The one new surface is
the mint confirm dialog, a copy of the existing Record-deposit dialog shell, so `needs-figma` is
not needed.

## Scope

### Served shapes (read from `main`)

- `GET /v1/lps` → `LpSummary` (`packages/api/src/routes/lps.rs:190`) now serves `stellar_address`,
  `address_linked_at`, `stellar_signer_address`, `evm_address`, `evm_signer_address` and
  `evm_address_linked_at`, all nullable.
- `GET /v1/lps/{id}` → `LpResponse` (`lps.rs:101`) serves the same six fields.
- `GET /v1/lps/{id}/bank-deposits` → `BankDepositResponse` (`lp_bank_deposits.rs:50`) is
  **unchanged**: no `chain_id`, no receiver, no link to an `lp_requested_bank_details` row.
- `lp_requested_bank_details.chain_id` / `receiver_address` (#1824) and
  `lp_settlement_address_history` (#1831) have **no Trustee read endpoint**. The only reader is
  `GET /v1/lps/me/payment-details`, which is LP-session only.

### In scope

1. **Types** (`api/useLps.ts`, `api/useLp.ts`): add the four new fields. Move `address_linked_at`
   from `LpDetail` to `LpSummary`, since the list serves it now.
2. **Counterparties table**: the "Blockchain Address Available" column shows which addresses are
   linked: `No`, `Stellar`, `EVM`, `Stellar + EVM`. An unproven Stellar address gets an
   `(unproven)` suffix.
3. **LP profile**: replace the single "Linked wallet" row with one `KeyValueRow` per linked
   address. Each row shows the chain, the address, the signer (or **Unproven**) and the linked-at
   time.
4. **Per-chain mint receiver**: `wireInReceiver(lp, chainKind, capitalWallets)`.
   - Stellar → `stellar_address`.
   - EVM → `evm_address`.
   - When the LP has no address for that chain kind, fall back to that chain's capital wallet.
     The fallback stays (user decision 2026-11-02 on #1763).
5. **Mint chain = the Trustee session's signed-in chain**, read with
   `useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID`. The Bank deposits card is a per-network
   surface (see the trustee chain-scope rule). The card shows its scope as a line under the title:
   network label plus the resolved receiver.
6. **Fresh re-read before signing (required, PR #1834 review)**:
   - Mint PLUSD opens a confirm dialog that re-reads `GET /v1/lps/{id}`.
   - Confirm re-reads `GET /v1/lps/{id}` again immediately before building the transaction.
   - The mint goes only to the address from that last read, and only if it equals the address
     the dialog showed. Any difference is shown, nothing is signed, and the Trustee must
     re-confirm explicitly.
7. **EVM env**: add `VITE_EVM_CAPITAL_WALLET_ADDRESS` (`ENV.EVM_CAPITAL_WALLET_ADDRESS`, default
   `""`) so the EVM fallback in item 4 resolves now. #1501's plan already names this variable;
   this issue adds it and #1501 reuses it.
8. **Docs**: `docs/frontend/trustee-flows.md`, `docs/product-specs/deposits.md` (receiver sentence),
   a user-stories doc, and a TD entry.

### What ships for EVM deposits until #1501 lands

- On an EVM session, the receiver is resolved (`evm_address`, else
  `ENV.EVM_CAPITAL_WALLET_ADDRESS`) and shown in the card's scope line.
- The **Mint PLUSD** button stays disabled, with the first-priority reason "PLUSD minting on
  {chain label} is not available in the Trustee app yet." The Stellar `record_wire_in` path is
  **never** called with an EVM receiver, and the EVM address is never passed to the Stellar path
  in the other direction.
- #1501 (`PipelineMinter.recordWireIn`) replaces that gate with the EVM write. It inherits the
  confirm dialog and the fresh re-read unchanged, because both are chain-agnostic and act on the
  `WireInReceiver` returned for the session's chain kind.

### Out of scope

- **Issue item 5 (show the chain and receiver recorded on a deposit's payment reference).** The
  Issue says "if available", and it is not available: `BankDepositResponse` carries no
  `payment_details` link, and no Trustee endpoint serves `lp_requested_bank_details`. Rendering it
  would mean fabricating or matching client-side. Logged as TD-164 (backend to serve the matched
  reference's `chain_id` + `receiver_address` on the deposit) for the wire-matching follow-up.
- **Item 6's "when the two differ, show both"** for the *reference* receiver vs. the current
  address depends on item 5, so it is out of scope too. The *page* vs. *fresh read* difference
  (item 7) **is** shown.
- A settlement-address history view (`lp_settlement_address_history` has no read endpoint).
- The EVM mint write itself (#1501), EVM error mapping (#1501), and wire matching by reference.

## Assumptions and Risks

- **Deposit chain = session chain.** A bank deposit row has no chain. The only chain the Trustee
  can mint on is the one its session is signed in to, and the trustee chain-scope rule makes
  per-network pages follow `useSessionState().chainId`. The Trustee picks the network by signing
  in on it. Risk: the LP asked for payment details on chain A, and the Trustee mints on chain B.
  The Trustee sees both of the LP's addresses on the profile and the active network in the card's
  scope line, which reduces this risk but does not remove it. TD-164 records the fix: serve the
  matched reference's `chain_id` on the deposit, then default the mint chain from it.
- **#1501 is not merged** (`planned` + `needs-feedback`). This issue does not block on it. EVM
  receivers are resolved, shown and unit-tested, and the EVM mint stays gated as described above.
  If #1501 lands first, the coder rebases and keeps both the confirm/re-read flow and #1501's EVM
  write. `wireInReceiver`'s new signature is the seam.
- **List signer display.** The acceptance criterion "sees … their signers on the counterparties
  list" is read as: the list states the proof status (`(unproven)` suffix). The signer addresses
  themselves appear on the profile. Putting a 56-char key per chain in a list cell would break the
  grid (the #1453 `AddressChip`/`AddressText` rationale). An EVM address is always signed (only
  the signed flow links one), but the same `null`-signer → unproven rule is applied to both kinds
  in case the data ever says otherwise.
- **Presence rule.**
  - List: an address is "linked" when it is a non-empty string. This is today's rule, kept.
  - Mint receiver: the address must be non-empty **and** its `*_linked_at` non-null. This is
    today's Stellar rule, extended to EVM.
- **Residual race.** After the confirm-time read, the only remaining window is wallet signing and
  submission (seconds). A relink inside that window is not caught client-side. Nothing on-chain or
  server-side checks the receiver against the LP record. This is accepted and recorded in the spec.
  It is far smaller than today's window, which lasts from page load until the click.
- **Fresh read failure** (network, 401, 403, 404) blocks the mint. It never falls back to cached
  data. `lpFetch` already clears the session on a 401 and refuses a result read under a changed
  session token.
- **Address comparison** is exact string equality on served values. EVM is stored lowercase
  server-side, so no client normalisation is needed. "Changed" also counts a switch between LP
  address and capital wallet (`isCapitalWallet` flips) and a change to "no receiver".
- **Comment rule.** Every touched/new file keeps or gets exactly one 2–3-line spec-pointer header,
  with no JSDoc or body comments. `-ApproveMintDialog.tsx` is not reused (Origination-specific copy
  and a narrative docblock).
- `scripts/lint-comments.baseline.json` lists none of the files touched here (checked).

## Open Questions

_None_

## Implementation Steps

1. **Env** (`packages/trustee/src/lib/env.ts`, `.env.example`, `docker/trustee/entrypoint.sh`):
   - Add `EVM_CAPITAL_WALLET_ADDRESS: readString("VITE_EVM_CAPITAL_WALLET_ADDRESS", "")` next to
     `STELLAR_CAPITAL_WALLET_ID`.
   - Add `VITE_EVM_CAPITAL_WALLET_ADDRESS=` under the Stellar line in `.env.example`, with a short
     trailing comment in the same style.
   - Add the `--arg` and the JSON key to `entrypoint.sh`, mirroring `VITE_STELLAR_CAPITAL_WALLET_ID`
     (lines 24 and 41).

2. **Types** (`packages/trustee/src/api/useLps.ts`): add these fields to `LpSummary`:
   ```ts
   address_linked_at: string | null;
   stellar_signer_address: string | null;
   evm_address: string | null;
   evm_signer_address: string | null;
   evm_address_linked_at: string | null;
   ```
   In `packages/trustee/src/api/useLp.ts`, remove `address_linked_at` from `LpDetail`, since it is
   now inherited. Then add and export a plain fetcher, and point `useLp`'s `queryFn` at it:
   ```ts
   export function fetchLp(id: number, signal?: AbortSignal): Promise<LpDetail> {
     return lpFetch<LpDetail>(`/v1/lps/${id}`, { signal });
   }
   ```
   Fix every fixture that builds an `LpSummary` or `LpDetail`. `tsc` lists them. Known fixtures:
   `-useLpCounterpartiesTable.test.ts`, `-lp-counterparties.index.test.tsx`,
   `-lp-counterparties.$id.test.tsx` and `-LpBankDepositsSection.test.tsx`.

3. **Shared settlement-address presenter** (new `packages/trustee/src/routes/-settlementAddresses.ts`,
   header `// spec: docs/frontend/trustee-flows.md#settlement-addresses`). It holds pure functions
   only:
   ```ts
   export type SettlementChainKind = "stellar" | "evm";
   export interface SettlementAddressRow {
     kind: SettlementChainKind;
     chainLabel: "Stellar" | "EVM";
     address: string;
     signer: string | null;       // null => unproven
     isUnproven: boolean;
     linkedAt: string;            // formatIsoDateTimeUtc(..) or "—"
   }
   export function settlementAddressRows(lp: Pick<LpSummary, "stellar_address" | "address_linked_at" | "stellar_signer_address" | "evm_address" | "evm_address_linked_at" | "evm_signer_address">): SettlementAddressRow[];
   export function linkedAddressesLabel(lp: …same pick…): string;
   export function chainKindOf(chainId: number | null | undefined): SettlementChainKind; // isStellarTarget ? "stellar" : "evm"
   ```
   - `settlementAddressRows` returns Stellar first, then EVM. It includes an entry only when that
     address is a non-empty string. `linkedAt` is `—` when the timestamp is null, never invented.
   - `linkedAddressesLabel` returns `"No"`, `"Stellar"`, `"Stellar (unproven)"`, `"EVM"`,
     `"EVM (unproven)"`, or a combination joined with `" + "` (e.g. `"Stellar (unproven) + EVM"`).
   - `chainKindOf` reuses `isStellarTarget` from `lib/targetChains.ts`, so `null` falls back to
     Stellar, matching the `?? ENV.STELLAR_CHAIN_ID` convention.

4. **Counterparties table** (`-useLpCounterpartiesTable.ts`, `lp-counterparties.index.tsx`):
   - Type `blockchainAddress` as `string` and set it to `linkedAddressesLabel(lp)`.
   - Keep the header text "Blockchain Address Available" (epic #1269 requirement wording). Keep
     the column width and cell class. Add `data-testid="lp-counterparties-addresses"` on the cell.
   - No new column, so the grid template is unchanged.

5. **LP profile** (`lp-counterparties.$id.tsx`): replace the `Linked wallet` `KeyValueRow`.
   - When `settlementAddressRows(lp)` is empty, render one `KeyValueRow label="Settlement address" isLast`
     with value `—`.
   - Otherwise render one `KeyValueRow` per row, with label `"{chainLabel} settlement address"` and
     the last row `isLast`. The value is a right-aligned column:
     - line 1: `<AddressChip value={row.address} testId={`lp-settlement-${row.kind}`} />`;
     - line 2 (12.5px `SUB_CLASS`, `INK_MUTED`): either `Signer <AddressChip value={row.signer} testId={`lp-settlement-${row.kind}-signer`} />`,
       or, when unproven, `<StatusChip band="attention" label="Unproven" testId={`lp-settlement-${row.kind}-unproven`} />`;
     - line 3 (same style): `Linked {row.linkedAt}` with `data-testid={`lp-settlement-${row.kind}-linked-at`}`.
   - The signer is shown even when it equals the address. It is a served value, and spec § Settlement
     Address (TD-162) gives a separate signer a weaker meaning, so the Trustee has to see which
     case applies.

6. **Receiver resolution** (`-useLpBankDeposits.ts`):
   ```ts
   export interface CapitalWallets { stellar: string; evm: string }
   export interface WireInReceiver { receiver: string; isCapitalWallet: boolean; kind: SettlementChainKind }
   export function wireInReceiver(
     lp: Pick<LpDetail, "stellar_address" | "address_linked_at" | "evm_address" | "evm_address_linked_at"> | undefined,
     kind: SettlementChainKind,
     capitalWallets: CapitalWallets,
   ): WireInReceiver | null;
   export function sameReceiver(a: WireInReceiver | null, b: WireInReceiver | null): boolean;
   ```
   - Stellar uses `stellar_address` + `address_linked_at`, and EVM uses `evm_address` +
     `evm_address_linked_at`. Otherwise the result is the capital wallet of `kind`, when non-empty.
     Otherwise it is `null`.
   - The receiver never crosses kinds: a Stellar address is never returned for `"evm"`, and the
     reverse also holds.
   - `sameReceiver` compares `receiver`, `isCapitalWallet` and `kind`, and treats two `null`s as
     equal.

7. **Section presenter** (`useLpBankDepositsSection` in `-useLpBankDeposits.ts`):
   - `const chainId = useSessionState().chainId ?? ENV.STELLAR_CHAIN_ID; const kind = chainKindOf(chainId); const chainLabel = targetChainLabel(chainId);`
   - `const capitalWallets = { stellar: ENV.STELLAR_CAPITAL_WALLET_ID, evm: ENV.EVM_CAPITAL_WALLET_ADDRESS };`
   - `const receiver = wireInReceiver(lpQuery.data, kind, capitalWallets);` This is the "page"
     receiver.
   - `mintDisabledReason` puts a new reason **first**: when `kind === "evm"`, return
     `` `PLUSD minting on ${chainLabel} is not available in the Trustee app yet.` ``. The existing
     reasons follow in the existing order. Make the no-receiver copy chain-aware: Stellar keeps
     "This LP has no linked Stellar wallet and no capital wallet is configured."; EVM gets the same
     sentence with "EVM". It is unreachable while EVM is gated, but #1501 will use it.
   - Replace the direct `mintDeposit(row)` with a confirm state machine:
     ```ts
     type MintConfirm =
       | { row: DepositRow; phase: "reading" }
       | { row: DepositRow; phase: "read-error"; error: UserFacingError }
       | { row: DepositRow; phase: "no-receiver" }
       | { row: DepositRow; phase: "ready"; receiver: WireInReceiver; previous: WireInReceiver | null; changed: boolean };
     ```
     The state is held with `const [confirm, setConfirm] = useState<MintConfirm | null>(null)` and
     `const [ack, setAck] = useState(false)`. A `readToken` ref (an incrementing number) drops
     results from a dialog that has been closed or reopened.
     - `openMint(row)`:
       1. Return early when `mintDisabledReason(row) !== null`.
       2. Call `mint.reset()`, set `ack=false`, set `{row, phase:"reading"}`, then
          `await fetchLp(lpId)`.
       3. Resolve `next = wireInReceiver(fresh, kind, capitalWallets)`.
       4. Set `phase:"no-receiver"` when `next` is `null`. Otherwise set `phase:"ready"` with
          `previous = receiver` (the page value) and `changed = !sameReceiver(next, receiver)`.
       5. When `changed`, call `void lpQuery.refetch()` so the page and the scope line catch up.
       6. On a rejected read, set `phase:"read-error"`. The error copy comes from
          `depositError`-style mapping: "Could not re-read this LP's settlement address. Try
          again.", with the raw message in details.
     - `confirmMint()`:
       1. Run only when `phase==="ready"`, `!(changed && !ack)`, and nothing is in flight.
       2. Set `mintingDepositId=row.id`, then `fresh = await fetchLp(lpId)` **immediately** before
          `mint.mutateAsync`.
       3. Compute `next`. If `next` is `null`, set `phase:"no-receiver"` and return without minting.
       4. If `!sameReceiver(next, confirm.receiver)`, return without minting. Set
          `phase:"ready", receiver: next, previous: confirm.receiver, changed: true`, reset
          `ack=false`, and call `lpQuery.refetch()`.
       5. Otherwise call `mint.mutateAsync({ …, receiver: next.receiver })`, arm the pending window
          as today, and close the dialog (`setConfirm(null)`).
       6. On a mint error, keep the dialog open with `mintError` shown. On a read error, use
          `phase:"read-error"`. `finally` clears `mintingDepositId`.
     - `closeMint()` does nothing while `mintingDepositId !== null`, so the dialog stays locked
       while signing, the same as `ApproveMintDialog`. Otherwise it bumps `readToken`, clears
       `confirm`, and calls `mint.reset()`.
   - Return `chainLabel`, `kind`, `receiver`, `confirm`, `ack`, `setAck`, `openMint`, `confirmMint`,
     `closeMint`, plus the existing fields. Drop `mintDeposit`.
   - `useRecordWireIn` is unchanged. It still receives a single resolved `receiver` string.

8. **Section view** (`-LpBankDepositsSection.tsx`):
   - **Scope line** under the title row: a 13px `INK_MUTED` `<p data-testid="lp-deposits-mint-scope">`.
     - LP address: `Mints on {chainLabel} to <AddressChip value testId="lp-deposits-receiver" />`.
     - Capital wallet: the same line plus `· capital wallet — this LP has no {Stellar|EVM} settlement address`.
     - No receiver: `Mints on {chainLabel} — no receiver`.
   - **PlusdCell**: the Mint PLUSD button calls `section.openMint(row)`. The in-flight label logic
     is unchanged.
   - **New `MintConfirmDialog`** (same file, same shell as `RecordBankDepositDialog`:
     `useLpReviewDialog` focus trap/Escape, `role="dialog"`, `aria-modal`, `aria-labelledby`,
     backdrop-click closes, both locked while minting). `data-testid="lp-mint-confirm"`.
     - Title: `Mint PLUSD — {legalName}`.
     - Description: "Check the receiver. PLUSD is minted to the LP's current settlement address,
       re-read now."
     - `phase:"reading"`: `role="status"` "Reading the LP's current settlement address…", and the
       confirm button is disabled.
     - `phase:"read-error"`: `InlineError` + a Retry button (calls `openMint(row)` again). Confirm
       is disabled.
     - `phase:"no-receiver"`: the chain-aware no-receiver copy. Confirm is disabled.
     - `phase:"ready"`: `KeyValueRow`s for Network (`chainLabel`), Amount (`row.amount`), Payment
       reference (`row.reference`) and **Receiver**. The receiver is the **full** address in a
       `break-all` monospace span, `data-testid="lp-mint-receiver"`, not truncated, because the
       Trustee verifies it. A muted second line says "LP settlement address" or "Capital wallet".
     - When `changed`: an attention-bordered block, `role="alert"`, `data-testid="lp-mint-receiver-changed"`:
       - "This LP's settlement address changed since it was last shown."
       - `Previously shown: {previous?.receiver ?? "—"}`
       - `Now minting to: {receiver.receiver}`
       - a checkbox `data-testid="lp-mint-ack"`, label "Mint to the new address". Confirm stays
         disabled until it is checked.
     - `section.mintError` renders inside the dialog (`InlineError`). Move it from under the table,
       since a mint can only start from the dialog now.
     - Buttons: Cancel (secondary, the detail secondary class/style) and the confirm `primary-blue`
       `size="m"` `data-testid="lp-mint-confirm-submit"`, label `mintStageLabel(section.mintStage)`.
       The idle label is "Mint PLUSD".

9. **Spec + docs** (see Docs to Update), then run `npx tsx scripts/lint-docs.ts` and
   `npx tsx scripts/lint-comments.ts`.

10. **Verify**:
    - `yarn workspace @pipeline/trustee test`, `… typecheck` (or `tsc -b`), `… lint` and `… build`.
      No new route, so the routeTree needs no regen.
    - Live check on the user's running dev server. Do not start a server or drive the user's
      browser. Ask the user to hard-refresh `/lp-counterparties` and an LP detail page, then
      compare against the user stories.

## Test Strategy

Vitest + Testing Library, following the existing mocks. In `-LpBankDepositsSection.test.tsx`, extend
the `@/api/useLp` mock to `{ useLp: vi.fn(), fetchLp: vi.fn() }`. Add
`vi.mock("@/auth/sessionStore", () => ({ useSessionState: vi.fn() }))`. Extend `envMock` with
`STELLAR_CHAIN_ID: 99_000_001`, `EVM_CHAIN_ID: 560048` and `EVM_CAPITAL_WALLET_ADDRESS: "0xcap…"`.
Give the `lp()` mock a `refetch: vi.fn()`.

- **`-settlementAddresses.test.ts`** (new):
  - `linkedAddressesLabel`: none (`null`/`""` both) → `No`; Stellar only; Stellar unproven
    (`stellar_signer_address: null`); EVM only; both; both with Stellar unproven.
  - `settlementAddressRows`: order (Stellar first), the unproven flag, a served signer that differs
    from the address (`C…` + `G…` signer), `linkedAt` formatted and `—` when null.
  - `chainKindOf`: Stellar id → stellar, EVM id → evm, `undefined` → stellar.
- **`-useLpCounterpartiesTable.test.ts` / `-lp-counterparties.index.test.tsx`**: replace the Yes/No
  cases with the four table states (none, Stellar only, EVM only, both), plus one unproven case,
  asserted on `lp-counterparties-addresses`.
- **`-lp-counterparties.$id.test.tsx`**: replace the `lp-linked-wallet` cases.
  - No addresses → the single `Settlement address` row reads `—`.
  - Stellar `C…` with a `G…` signer → the address chip, the signer chip, linked-at.
  - Legacy Stellar with a null signer → `lp-settlement-stellar-unproven`.
  - EVM row.
  - Both rows, in order.
  - The copy-on-click assertion moves to `lp-settlement-stellar`.
- **`wireInReceiver` / `sameReceiver`** (pure, in a new `-useLpBankDeposits.test.ts`):
  - Stellar linked → `stellar_address`.
  - Stellar address present but `address_linked_at` null → capital wallet.
  - EVM linked → `evm_address`.
  - EVM kind with only a Stellar address → EVM capital wallet, **not** the Stellar address.
  - Stellar kind with only an EVM address → Stellar capital wallet.
  - No address and empty capital wallet → `null` for each kind.
  - `sameReceiver`: an address change, an `isCapitalWallet` flip, `null` vs `null`.
- **`-LpBankDepositsSection.test.tsx`** (update the existing mint cases to go through the dialog):
  - The scope line shows `Stellar` and the LP receiver. With no Stellar address, it shows the
    capital wallet text.
  - Happy path: click Mint PLUSD → `fetchLp` is called → the dialog shows the full receiver →
    confirm → `fetchLp` is called a second time **before** `mintAsync`. Assert the order with
    `mock.invocationCallOrder`. `mintAsync` receives that receiver, and the dialog closes.
  - **Relinked between page load and mint (required).** The page's `useLp` serves `GA…X`. The
    first `fetchLp` serves `GA…Y`.
    - The dialog shows `lp-mint-receiver-changed` with "Previously shown: GA…X" and "Now minting
      to: GA…Y".
    - The confirm button is disabled until `lp-mint-ack` is checked. After the check, confirm
      calls `mintAsync` with receiver `GA…Y`, never `GA…X`.
    - `lpQuery.refetch` was called.
  - **Relinked while the dialog is open.** The first `fetchLp` serves `X`, the same as the page,
    so there is no notice. The second `fetchLp`, at confirm, serves `Y`.
    - `mintAsync` is **not** called.
    - The dialog now shows `Y` with the changed notice, and the ack is unchecked.
    - Checking the ack and confirming again triggers a third read (`Y`) and mints to `Y`.
  - Relinked to nothing (address present, then the fresh read drops to the capital wallet): shows
    changed + "Capital wallet" and requires the ack.
  - A fresh read rejecting (`ApiError(500)`) → read-error copy + Retry. `mintAsync` is not called
    and there is no fallback to cached data.
  - Closing the dialog while `fetchLp` is pending, then resolving it → no state change and no mint
    (the `readToken` guard).
  - Mint error (`RefHashSeen`, trustline `#13`) renders inside the dialog, keeping the existing
    copy assertions.
  - EVM session (`useSessionState` → `chainId: 560048`): the scope line reads `Hoodi` and the EVM
    address. The button is disabled with "PLUSD minting on Hoodi is not available in the Trustee
    app yet." as the first reason, even with the Stellar wallet connected. `fetchLp` and
    `mintAsync` are never called.
  - The existing pending-window, already-minted, in-flight and wallet-disconnected cases still
    pass.
- Full gate: trustee `test`, `typecheck`, `lint`, `build`; `npx tsx scripts/lint-docs.ts` (0
  errors); `npx tsx scripts/lint-comments.ts`.

## Docs to Update

- **`docs/frontend/trustee-flows.md`**:
  - § LP Counterparties → Column mapping row 5: source is all six address/signer fields, rendering
    is `linkedAddressesLabel`.
  - § Detail view: the LP profile now ends with per-chain settlement-address rows (address chip,
    signer chip or Unproven chip, linked-at) and no longer has "Linked wallet".
  - New `### Settlement addresses` subsection (anchor for the new file header): the presence rule,
    the unproven rule (`*_signer_address` null), signer ≠ address meaning (TD-162 pointer), and
    the note that the history is not shown (no endpoint).
  - § LP bank deposits:
    - rewrite **Receiver rule** per chain kind, with the per-chain capital-wallet fallback;
    - add the mint chain = session chain rule and the scope line;
    - add the **Mint confirm dialog**: re-read on open, re-read immediately before signing, mint
      only to an address equal to the one shown, the changed notice + ack, read-error blocks, and
      the accepted residual window;
    - state the EVM gate until #1501;
    - update the disabled-reason order (EVM gate first);
    - errors now render in the dialog.
  - § Shared detail primitives table: `AddressChip` is used for settlement addresses and signers
    (also `0x…`).
- **`docs/product-specs/deposits.md`**, § Stellar PLUSD Mint Leg and "Receiver vs mint": the
  Trustee re-reads `GET /v1/lps/{id}` right before signing and mints only to that address. The
  chain is the Trustee's signed-in chain, and the deposit carries none yet (TD-164).
- **`docs/user-stories/epic-1269/1826-trustee-settlement-addresses.md`** (new, same format as
  `1449-trustee-mint-bank-deposit.md`). Stories:
  - the list states;
  - the profile rows, including unproven;
  - the Stellar mint receiver and capital-wallet fallback;
  - the relink between load and mint (have the LP relink in another session, then confirm);
  - the relink while the dialog is open;
  - the EVM session gate.
- **`docs/exec-plans/tech-debt-tracker.md`**: add **TD-164**, "Bank deposits carry no chain or
  matched payment reference". The Trustee mints on its signed-in chain, and item 5 of #1826 (show
  the reference's recorded chain/receiver) is blocked on the backend serving the matched
  `lp_requested_bank_details` row on `BankDepositResponse`. Bump "Next free number" to TD-165.
- `docs/user-docs/**`: no change. Lender docs already say minting goes to the address linked when
  the deposit is processed (#1831).
