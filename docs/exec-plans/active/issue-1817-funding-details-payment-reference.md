# Issue #1817: LP: Funding details modal — serve bank details and a fresh payment reference from GET /v1/lps/me/payment-details

Source: https://github.com/eq-lab/pipeline/issues/1817

Branch: `feat/1817-funding-details-payment-reference` → PR #1833 (base `main`). Epic #1247.

## Scope

Wire `FundingDetailsModal` on `/` to the post-#1824 `GET /v1/lps/me/payment-details?chain_id=<id>` and remove the scratch bank values from production code.

In scope:

- An authenticated client call `getMyPaymentDetails(chainId)` in `packages/frontend/src/api/lps.ts` and a React Query hook `usePaymentDetails` that fetches **exactly once per modal open** (no retry, no refetch of any kind).
- Chain: the active chain (`useActiveChain()` from `@/wallet`) captured **when the LP clicks Add Funds**; its `chain_id` is sent, and the modal shows the served `chain_id` (as a network name) and served `receiver_address` the funds land on.
- Field mapping of the served payload to the six bank rows (`swift_bic_code` → `SWIFT / BIC code`), a seventh **Payment reference** row with its own copy button, an instruction line, and a "where the funds land" block (Network + Receiving wallet).
- Loading (`—` rows), unavailable-409 (no linked settlement address for that chain kind), and unavailable-other (400/404/5xx/network) states. A refusal never crashes and never shows scratch values.
- `formatFundingDetailsForCopy` includes the reference; copy-all is enabled only when details are ready.
- `FUNDING_DETAILS_PLACEHOLDER` leaves `components/fundingDetails.ts`; it lives only as a `/test` fixture, with obviously fake values.
- Docs: `docs/frontend/bank-transfers.md`, one line of `docs/product-specs/home-screen-states.md`, `docs/frontend/hooks.md`, `packages/frontend/src/api/README.md`, user stories.

Out of scope:

- Linking a settlement address (challenge → sign → verify) and the `evm_address` fields on `LpResponse` — #1825. This plan does **not** read `LpResponse` address fields; the endpoint's 409 is the single source for "no linked address".
- An in-modal Stellar/EVM chain picker. The LP picks the chain by the wallet view (`useActiveChain` already resolves "both connected" to the view kind).
- `onContactSupport` destination (existing tech debt, stays a no-op seam).
- Filling `system_configuration.system_bank_details` (ops prerequisite before release, recorded in `deposits.md`).
- Wire matching by issued reference (backend follow-up).

## Assumptions and Risks

- **Contract (verified on this branch).** `packages/api/src/routes/lp_bank_deposits.rs` `PaymentDetailsResponse` = `company_name`, `bank_name`, `bank_address`, `account_number`, `iban`, `swift_bic_code`, `payment_details` (strings), `chain_id` (int), `receiver_address` (string). `chain_id` required (`RequiredChain`): missing/malformed/unknown → 400. No LP → 404. KYB ≠ `Passed` or no settlement address of the chain's kind → 409 (message names the unmet preconditions; nothing minted). Missing bank record → 500. `Cache-Control: no-store`; `HEAD` → 405. Every 200 mints and stores a new reference.
- **Default QueryClient retries 3× and refetches on focus/reconnect** (`wallet/evm/EvmWalletProvider.tsx` builds `new QueryClient()` with defaults). Every one of these must be off per query, including `refetchOnReconnect`, or a hidden request mints a reference the LP never sees.
- **StrictMode / remounts.** Two observers of the same key share one fetch; `gcTime: 0` removal is deferred, so a StrictMode unmount/remount does not refetch. Covered by a test.
- **Linking is broken on main until #1825.** #1824 removed the unsigned `POST /v1/lps/me/link-address` that `useSettlementAddressLink` still calls, so new LPs cannot link an address from the LP app today. Until #1825 ships, most LPs will land in the 409 "link your wallet" state; LPs linked before #1824 (Stellar) get details. Not a blocker for #1817 — the 409 state is designed for exactly this — but the "Go to Account" action leads to a page that offers no link button until #1825.
- **Merge overlap with #1825**: both touch `api/lps.ts` and `api/index.ts`. #1817 only appends a type and a function there; whichever merges second rebases trivially.
- **Gate reachability.** Add Funds renders only in home states `plusd-held`, `passed-empty`, `passed-staked` (all `kyb_status === "Passed"` + session + connected wallet, `components/homeState.ts`), and `/` replaces the cards with `ChainNotServedNotice` when the active chain is not served. So a 409 in practice means "no address of this kind", and 400 is not expected; both are still handled.
- **Ops prerequisite.** Until `system_bank_details` is filled, an eligible LP sees `—` in all six bank rows but a real reference. That is correct behavior (served values only), noted on the Issue.
- **Mint lands as sPLUSD.** `docs/user-docs/lenders/deposit.md` (source of truth since #1747): a wire mints PLUSD and stakes it straight into sPLUSD for the address. The copy says sPLUSD, not PLUSD as the Issue body phrases it.

## Open Questions

_None_

## Decision log

- **D1 No Figma (user, 2026-11-02).** UI built from the existing modal's row pattern and `packages/ui` tokens. No `needs-figma`.
- **D2 Chain = active chain at click time.** `onAddFunds` captures `useActiveChain()` `{ kind, chainId }` into the open state; the modal never re-fetches if the wallet view changes while it is open. No in-modal picker: the wallet view already chooses between Stellar and EVM when both are connected, and a picker would mint a reference per toggle.
- **D3 One fetch per open.** Query key `["lp-payment-details", openId, chainId]`, `openId` incremented on every Add Funds click; `staleTime: Infinity`, `gcTime: 0`, `retry: false`, `refetchOnMount/WindowFocus/Reconnect: false`, `enabled` only while open and authenticated. Re-opening is the only "retry" (a refused call minted nothing).
- **D4 No client-side address gate.** The modal fetches and treats 409 as "not linked"; it does not inspect `LpResponse.stellar_address`/`evm_address` (served-values-only; avoids racing #1825's type changes).
- **D5 Empty → `—`.** A served `""` (or a missing field) renders `—`; non-empty values are verbatim (no trimming, grouping or truncation — addresses wrap with `break-all`).
- **D6 Layout (top → bottom).** Heading → (unavailable notice, only when unavailable) → six bank rows → **Payment reference** row (same label/value row, value followed by a 32×32 icon button with the `copy.svg` mask, `aria-label="Copy payment reference"`; shows caption `Copied` for `COPIED_RESET_MS`) → instruction caption → a 1px `--color-pipeline-line` divider → `Network` row (served `chain_id` via `chainDisplayName(kind, chain_id)`) and `Receiving wallet` row (served `receiver_address`, `break-all`) → destination caption → existing note row → `Copy` button → `Need help? Contact Support`.
- **D7 Copy text (verbatim).**
  - Reference label: `Payment reference`.
  - Instruction (caption, ink-muted): `Add this reference to your transfer’s reference or remittance field. Without it we can’t match your transfer to your account.`
  - Destination rows: `Network`, `Receiving wallet`; caption: `Your transfer is credited to this wallet as sPLUSD.`
  - 409 notice: `Bank details need a {chainName} wallet linked to your account. Link it on your Account page, or switch to a wallet you have already linked.` + `Button variant="secondary" size="m"` `Go to Account` (closes the modal, navigates to `/account`). `{chainName}` = `chainDisplayName` of the requested chain.
  - Other-failure notice: `Bank details are unavailable right now. Close this window and try again, or contact support.`
  - Notice box: `role="alert"`, body 16/22 ink on `--color-pipeline-surface`, `--radius-pipeline-card`, `p-4`.
- **D8 Loading/unavailable rows.** All value cells (bank, reference, network, wallet) render `—`; the rows container gets `aria-busy` while loading; the reference copy button and the `Copy` button are disabled unless ready.
- **D9 Copy-all = the seven wire rows** (`{label}: {value}` lines, six bank + `Payment reference`). Network/wallet are not wire fields and stay out.
- **D10 Placeholder → `/test` fixture with fake values.** `/test` is bundled into production (it redirects at runtime via `beforeLoad`), so the fixture moves to `packages/frontend/src/routes/test/-fundingDetailsFixture.ts` with plainly fake values (`Example Trust LLC`, `Example Bank`, `1 Example Street`, `00000000`, `XX00 TEST 0000 0000 0000 00`, `TESTXXXXXXX`, reference `PL-0000-0000-0000`, a placeholder Stellar `G…` from the existing `/test` scenarios or a literal `G` + 55 `A`s). No real-looking IBAN reaches any bundle.

## Implementation Steps

1. **API client** — `packages/frontend/src/api/lps.ts`:
   - `export interface PaymentDetailsResponse { company_name; bank_name; bank_address; account_number; iban; swift_bic_code; payment_details: string; chain_id: number; receiver_address: string }`.
   - `export function getMyPaymentDetails(chainId: number, signal?: AbortSignal): Promise<PaymentDetailsResponse>` → `apiFetch(\`/v1/lps/me/payment-details?chain_id=${chainId}\`, { headers: authHeaders(), signal })`.
   - Export both from `api/index.ts`.
2. **Query hook** — new `packages/frontend/src/api/usePaymentDetails.ts` (one spec-pointer header to `docs/frontend/bank-transfers.md#fundingdetailsmodal`):
   - `usePaymentDetails(request: { openId: number; chainId: number } | null)` → `{ status: "idle" | "loading" | "ready" | "unavailable"; data?: PaymentDetailsResponse; error?: unknown }`.
   - `useQuery` with D3 options; `enabled: request !== null && isAuthenticated` (`useAuthSession`). `queryFn` passes the React Query `signal`.
   - Export from `api/index.ts`.
3. **View model** — `packages/frontend/src/components/fundingDetails.ts`:
   - Delete `FUNDING_DETAILS_PLACEHOLDER`.
   - `FUNDING_DETAIL_LABELS` stays the six bank labels; add `PAYMENT_REFERENCE_LABEL = "Payment reference"`.
   - `displayValue(v: string | null | undefined): string` → `"—"` when empty/missing, else `v`.
   - `export type FundingDetailsView = { status: "loading" } | { status: "ready"; rows: FundingDetailRow[] /* 7 */; paymentReference: string; network: string; receiverAddress: string } | { status: "unavailable"; reason: "not-linked" | "error"; chainName: string }`.
   - `toFundingDetailsView(response, kind)`: maps the six fields in label order + the reference row (all through `displayValue`), `network = chainDisplayName(kind, response.chain_id)`, `receiverAddress = displayValue(response.receiver_address)`.
   - `toUnavailableView(error, chainName)`: `ApiError` with `status === 409` → `"not-linked"`, anything else → `"error"`.
   - `formatFundingDetailsForCopy` unchanged in shape; callers pass the seven rows (D9).
4. **Container hook** — new `packages/frontend/src/components/useFundingDetails.ts`:
   - Input `request: { openId; chainId; kind } | null`; calls `usePaymentDetails`; returns `FundingDetailsView` (`loading` while idle/loading, `ready` via `toFundingDetailsView`, `unavailable` via `toUnavailableView(error, chainDisplayName(kind, chainId))`).
5. **Modal** — `packages/frontend/src/components/FundingDetailsModal.tsx` (+ `useFundingDetailsModal.ts`):
   - Props become `{ open; onDismiss; view?: FundingDetailsView /* default { status: "loading" } */; onOpenAccount?: () => void; onContactSupport? }`; drop `details`.
   - Render per D6–D8: notice box when `unavailable` (`Go to Account` only for `not-linked`, calls `onOpenAccount`); bank rows from `view.rows` or six `—` rows; reference row with icon button (a second `useCopyToClipboard()` instance, `copy(paymentReference)`); instruction caption; divider; Network/Receiving wallet rows (value `break-all`, `text-right`, `min-w-0`); destination caption; existing note; `Copy` button `disabled={view.status !== "ready"}`.
   - Row `data-testid`s keep the existing slug scheme (`funding-details-row-payment-reference`, `-network`, `-receiving-wallet`); add `funding-details-notice`, `funding-details-copy-reference`.
   - `useFundingDetailsModal` copies `formatFundingDetailsForCopy(rows)` only when ready.
   - Keep exactly one spec-pointer header per file; no other comments.
6. **Home route** — `packages/frontend/src/routes/index.tsx`:
   - Replace `fundingDetailsOpen` boolean with `const [fundingRequest, setFundingRequest] = useState<{ openId; chainId; kind } | null>(null)` and a `useRef` counter; `onAddFunds` sets `{ openId: ++counter, ...useActiveChain() }` (call `useActiveChain()` at the top of `Home`).
   - `const fundingView = useFundingDetails(fundingRequest)`; mount `<FundingDetailsModal open={fundingRequest !== null} view={fundingView} onDismiss={() => setFundingRequest(null)} onOpenAccount={() => { setFundingRequest(null); navigate({ to: "/account", search: { state: undefined } }); }} />`.
7. **`/test` preview** — move the fixture to `packages/frontend/src/routes/test/-fundingDetailsFixture.ts` (D10) exporting one `FundingDetailsView` per state (`ready`, `loading`, `unavailable` not-linked, `unavailable` error). In `routes/test.tsx` → `AuthTab`, replace the single open button with four `Button variant="secondary"` openers (`Open Funding details: ready | loading | not linked | error`). Shrink `scripts/lint-comments.baseline.json` for `routes/test.tsx` if the touched lines carry listed comments.
8. **Lint/build**: `yarn workspace @pipeline/frontend lint`, `npx vite build` then `yarn build` (no new route, but keep the order), `npx tsx scripts/lint-docs.ts` (0 errors), `npx tsx scripts/lint-comments.ts`.

## Test Strategy

Vitest (`packages/frontend`):

- `api/lps.test.ts`: `getMyPaymentDetails(…)` sends `GET /v1/lps/me/payment-details?chain_id=<id>` with `Authorization: Bearer jwt`; a 409 rejects with `ApiError` status 409.
- `api/usePaymentDetails.test.tsx` (fetch spy, real `apiFetch`, `QueryClient` with **default** options so the per-query overrides are what is tested):
  - one request per `openId`; a re-render, window `focus`, `online` event, and a remount under `<React.StrictMode>` add no request;
  - a new `openId` makes exactly one more request; `null` request makes none; unauthenticated makes none;
  - a 409 and a 500 each produce exactly one request (no retry) and `status: "unavailable"`.
- `components/fundingDetails.test.ts`: field mapping order incl. `swift_bic_code` → `SWIFT / BIC code`; `""`/missing → `—` per field and for `receiver_address`; network name from served `chain_id` for both kinds; 409 → `not-linked`, 400/404/500/`TypeError` → `error`; `formatFundingDetailsForCopy` of a ready view = seven lines ending `Payment reference: PL-…`; `FUNDING_DETAILS_PLACEHOLDER` is no longer exported (replace the old fixture tests).
- `components/FundingDetailsModal.test.tsx`: default (`loading`) → all values `—`, Copy and reference-copy disabled, no notice; `ready` → served values, reference row, instruction text verbatim, Network/Receiving wallet rows, Copy writes the seven-line text, reference button copies only the reference; `unavailable/not-linked` → notice copy with chain name, `Go to Account` calls `onOpenAccount`, rows `—`; `unavailable/error` → error copy, no `Go to Account`. Existing dismiss/Escape/scroll-lock/Contact Support tests kept, switched to fixtures from `routes/test/-fundingDetailsFixture.ts` or inline views.
- `routes/-index.test.tsx`: Add Funds in a `Passed` state fetches once with the active chain's id; dismiss + reopen fetches once more; a 409 renders the not-linked notice, not a crash.
- Production-bundle check (manual, recorded in the PR): `grep -r "GB29\|UKBP\|HSBC" packages/frontend/dist` finds nothing after `yarn build`.

Live check (no browser automation; ask the user to report): on staging with a linked Stellar LP, Add Funds shows a `PL-XXXX-XXXX-XXXX` reference and the linked address; the Network tab shows one `payment-details` request per open; an EVM-view LP without an EVM address sees the not-linked notice.

## Docs to Update

- `docs/frontend/bank-transfers.md`: intro ("Presentational only" no longer true for the modal; it is now wired on `/`), § FundingDetailsModal (props, layout D6, states D8, one-fetch rule D3, chain D2), § fundingDetails (view model, `displayValue`, seven-row copy text, fixture moved), § Verbatim copy (D7 strings), § Seams (`details` → `view`, new `onOpenAccount` seam, `FundingDetailsModal.view` wired by #1817), § `/test` preview (four state openers), § Out of scope (drop "Any network call…" and "Real source for trust-account wire details" rows; add #1825 linking). Update the "Update (#1815)" paragraph to say the reference row shipped in #1817.
- `docs/product-specs/home-screen-states.md` line ~191: "opens the `FundingDetailsModal` (#1283) with no `details`, so all six rows render `—`" → "opens the `FundingDetailsModal`, which fetches the served bank details and a payment reference (#1817)". Keep the edit line-neutral (file is at 198/200).
- `docs/frontend/hooks.md`: add `usePaymentDetails` (`@/api`) row, alphabetical.
- `packages/frontend/src/api/README.md`: list `getMyPaymentDetails` / `usePaymentDetails` and state that no mock key should be used for it (real API only).
- User stories: new `docs/user-stories/epic-1247/1817-funding-details-payment-reference.md` (ready, not-linked, error, one-request-per-open, copy-all, reference copy) + row in `docs/user-stories/index.md`; amend `1283-lp-add-funds.md` Story 1 to the new fixture values and the `/test` openers.
- `docs/product-specs/deposits.md`: no change needed ("Client wiring is #1817" stays accurate).
- Move this plan to `docs/exec-plans/completed/` on completion.
