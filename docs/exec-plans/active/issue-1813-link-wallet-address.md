# Issue #1813: LP: connecting a wallet never links it to the LP record (POST /v1/lps/me/link-address)

Source: https://github.com/eq-lab/pipeline/issues/1813

Epic: #1247 (KYB login flow). Branch `fix/1813-link-wallet-address`, draft PR #1814.

## Scope

The LP app links the connected **Stellar** wallet to the signed-in LP's record through
`POST /v1/lps/me/link-address { stellar_address }`, so that the Trustee's "Linked wallet" row
(`packages/trustee/src/routes/lp-counterparties.$id.tsx`) and the bank-deposit mint receiver
(`packages/trustee/src/routes/-useLpBankDeposits.ts`, which needs `stellar_address` **and**
`address_linked_at`) have a served address. The KYB surfaces (`CompanyDocsModal` and the Account
page profile card) show the settlement address as a read-only row.

Behaviour sources, in precedence order:

- `docs/user-docs/lenders/onboarding.md` §Entity verification — "To deposit by bank wire, you also
  name a settlement address. It is fixed once the entity passes." Step 2: "The connected address is
  the address that holds your PLUSD and sPLUSD."
- `docs/user-docs/how-it-works/capital-layer.md` — a lender wire in mints PLUSD 1:1 staked for the
  lender.
- `docs/product-specs/kyb-lp-verification.md` §Settlement Address — settable at any status short of
  a terminal verdict, freely replaceable until then; `Passed` fixes an address already held, **and an
  LP that passed before naming one may still name it, once**; `Failed` closes the endpoint. Stellar
  only. Outside the profile freeze (settable while `UnderReview`).
- API (`packages/api/src/routes/lps.rs` `link_address` ~l.933, `KybStatus::allows_address_write` in
  `packages/shared/src/lp_repo.rs` ~l.173): 200 → full `LpResponse`; 400 invalid strkey; 404 no LP
  registered for this account; 409 when Failed, when Passed with an address already held, or when the
  address is already linked to **another LP** (UNIQUE column).
- Decision record: connected wallet = active account (#1570, 2026-10-21) — no verification CTA is
  added for a connected wallet without an LP profile; this issue adds none.

### Decisions (asked for by the manager)

1. **When the link call fires.** One owner: `AuthFlowProvider` (the single app-wide LP reader). The
   call fires whenever all of these hold, re-evaluated on every change of any input:
   - a session token is present (`useAuthSession().token`);
   - the provider's LP read is `loaded` (a 404/`absent` LP cannot be linked — the API would 404);
   - a Stellar wallet is connected (`useStellarWallet().isConnected && address`);
   - the served `lp.stellar_address` differs from the connected address (idempotency);
   - the served state still allows the write: `lp.kyb_status !== "Failed"` and not
     (`lp.kyb_status === "Passed"` and `lp.stellar_address !== null`) — a direct mirror of
     `allows_address_write` over served fields, so the known-fixed case makes **no request at all**;
   - no link request is in flight, and this `(token, lp.id, address)` key has not already been
     attempted in this provider mount.

   This covers every trigger in the brief without a separate call site: wallet connect while signed
   in (address input changes); sign-in or session restore while a wallet is connected (token → LP
   read → `loaded`); and LP creation (the first `POST /v1/lps/me` on KYB form submit flips the
   provider to `loaded` — via the existing `CompanyDocsModal.onLpChange`, and via a new `adoptLp`
   seam from the Account page, step 4). No extra "link on KYB submit" call: the LP-creation path
   already reaches the provider, and a second call site would race the first. Existing LPs created
   before this fix are back-filled on their next signed-in visit with a Stellar wallet connected.
2. **Idempotency.** Skip when served `stellar_address === connected address` (byte-equal, verbatim).
   Requests are serialized: while one is in flight a newer address waits; when it settles the
   provider adopts the response and the effect re-evaluates (so a quick A→C reconnect yields A then C,
   never out-of-order writes). A per-mount `Set` of attempted keys prevents retry loops on failures
   (only an address, LP or token change makes a new key). React StrictMode's double effect must not
   double-post (the in-flight ref guards it). Nothing is persisted — no localStorage.
3. **409 handling** (decided 2026-10-30 by the user: show an error message). On 409 the hook surfaces the
   API's message through the app's existing error toast (`useToast`, same pattern as other failed API
   calls) — "LP … has passed KYB; its settlement address is fixed" / "already linked to another account"
   verbatim from the server — and re-reads `GET /v1/lps/me` so the settlement row shows the served
   state. No automatic retry. 400/404/5xx/network → the same toast path with the served message;
   401/403 are already handled app-wide by `apiFetch`'s session-end path (#1473/#1465).
4. **How the KYB form shows the settlement address.** A read-only row — never an input — labelled
   `Settlement address`, in the `CompanyDocsModal` profile surface card (below Country) and in
   `AccountProfileCard` (below Country). Title = served `lp.stellar_address` verbatim (full G-address,
   wrapping with `break-all`); when nothing is served yet and a Stellar wallet is connected, the
   connected address verbatim with a pending caption; `—` when neither exists. Caption per state (step
   2 table). Read-only in every state, which satisfies both "connected address pre-filled before
   submission" and "read-only after Passed".

### Out of scope

- EVM wallets: the endpoint validates a Stellar strkey and the LP record models no EVM settlement
  address. An EVM-connected LP gets no link call; the row says a Stellar wallet is needed. The
  chain-aware address is a backend change under epic #1494 — not planned here (frontend-only).
- Trustee app: no code change; it already reads `stellar_address`/`address_linked_at`. The
  capital-wallet fallback in `-useLpBankDeposits.ts` and the `deposits.md` §Stellar wire-in paragraph
  belong to #1763/#1768.
- Wallet-only visitors (no session): the wallet stays display-only (`account-page.md` §Wallet-only
  variant); no link without a session.
- Proof of key control (TD-57) — unchanged; linking the *connected* wallet narrows but does not close
  it (no signature is sent).
- Unlinking on disconnect: no endpoint exists; disconnecting leaves the record as served.

## Assumptions and Risks

- **No Figma frame** for a settlement-address row exists in the V1.0 KYB frames. The row reuses
  `AccountListRow` (`variant="plain"`, caption + title, the wallet card's row) inside the existing
  profile surface cards — no new tokens, no new component styling. See Open Questions.
- **Two LP readers.** `useAccountPage` keeps its own `GET /v1/lps/me` state, separate from the
  provider. The settlement row on both surfaces reads the **provider's** LP and link state (one
  source), and the Account page pushes every LP it adopts to the provider (`adoptLp`) so LP creation
  and refreshes there reach the linker. Risk: a stale provider LP (e.g. trustee passed the LP since
  the last read) produces one request that 409s; handled by the 409 re-read.
- **Stellar dev mock** (`pipeline.mock.wallet.stellar.address` in `useStellarWallet`) would be
  linked for real on a dev server. QA must use a real Stellar wallet; do not add a guard for it.
- **UNIQUE address across LPs**: a staging wallet already linked to another test LP returns 409
  "taken". QA needs a fresh wallet or LP.
- **Mint acceptance** depends on the receiver holding an authorized PLUSD trustline and on the
  trustee wallet holding `CASH_REPORTER` (`deposits.md`); a mint failure for those reasons is not a
  regression of this fix.
- `AuthFlowProvider.test.tsx` mocks `@/wallet` with only `useConnectModal`; adding
  `useStellarWallet` to the provider requires widening that mock.
- No dependency on unmerged work. #1763 (fallback removal) is independent: this fix is what makes
  that removal safe.

## Open Questions

_None_ — answered 2026-10-30 by the user: no Figma needed; build the settlement-address row from the
existing theme (`AccountListRow` in the existing profile cards). On 409 show the error message (toast),
not a silent re-read.

## Implementation Steps

1. **API client** — `packages/frontend/src/api/lps.ts`: add
   `linkMyAddress(stellarAddress: string): Promise<LpResponse>` →
   `apiFetch("/v1/lps/me/link-address", { method: "POST", headers: { ...authHeaders(),
   "Content-Type": "application/json" }, body: JSON.stringify({ stellar_address }) })`. Export it from
   `packages/frontend/src/api/index.ts`.

2. **Pure derivation** — new `packages/frontend/src/components/account/settlementAddress.ts`
   (header `// spec: docs/frontend/account-page.md#settlement-address-1813`):
   - `settlementWritable(lp: LpResponse): boolean` — `kyb_status !== "Failed" && !(kyb_status ===
     "Passed" && stellar_address !== null)`.
   - `type SettlementLinkState = "idle" | "linking" | "taken" | "error"`.
   - `deriveSettlementRow({ lpRead, lp, stellarAddress, evmConnected, link }) → { address: string |
     null; caption: string | null; tone: "muted" | "negative" }` with verbatim copy:

   | Condition (first match wins) | `address` | Caption |
   |---|---|---|
   | `link === "linking"` | connected | `Linking your connected wallet…` |
   | `link === "taken"` | served ?? null | `This wallet is already linked to another account. Connect a different Stellar wallet.` (negative) |
   | `link === "error"` | served ?? null | `Your wallet could not be linked. Reconnect it to try again.` (negative) |
   | LP `Passed`, served set, connected set and ≠ served | served | `Your settlement address is fixed. The connected wallet is not linked.` |
   | LP `Passed`, served set | served | `Fixed once your entity passed verification.` |
   | served set | served | `Linked to your connected wallet.` when connected === served, else null |
   | no served, `lpRead !== "loaded"`, Stellar connected | connected | `Linked when you submit your company details.` |
   | no served, EVM connected | null (`—`) | `Bank-wire settlement needs a Stellar wallet. Connect one to name your settlement address.` |
   | no served, nothing connected | null (`—`) | `Connect a Stellar wallet to name your settlement address.` |

   Strings live in this module as exported constants (single source for tests and spec).

3. **Linker hook** — new `packages/frontend/src/auth/useSettlementAddressLink.ts`
   (header `// spec: docs/frontend/auth-components.md#authflowprovider`):
   `useSettlementAddressLink({ token, lp, lpLoaded, onLp }) → SettlementLinkState`.
   - Reads `useStellarWallet()` from `@/wallet` (address only while `isConnected`).
   - Effect implements the decision-1 predicate; refs: `inFlight` (boolean), `attempted`
     (`Set<string>` of `${token}:${lp.id}:${address}`, cleared when `token` changes).
   - On fire: set `linking`, `await linkMyAddress(address)`; if `readSession()?.token !== token`
     drop the result; on 200 `onLp(response)` and state `idle`; on `ApiError` 409 → `getMyLp()` →
     `onLp(refreshed)`; state `idle` when `!settlementWritable(refreshed)` (the row's Passed captions
     explain "fixed"), else `taken`; on any other error → `error`. Always clear `inFlight` and bump a
     tick state so the effect re-evaluates (serialization, decision 2).
   - No toast, no console noise, no comments beyond the header.

4. **Provider and context** — `packages/frontend/src/auth/AuthFlowProvider.tsx` and
   `AuthFlowContext.ts`:
   - Call `useSettlementAddressLink({ token, lp: setup?.lp ?? null, lpLoaded: setup?.status ===
     "loaded" && setup.token === token, onLp })`, where `onLp` does the existing
     `setSetup(prev => prev?.token === token ? { ...prev, status: "loaded", lp } : prev)` (same shape
     as the `CompanyDocsModal.onLpChange` handler — extract one `adoptLp` callback and use it for both).
   - Widen `AuthFlowContextValue` with `adoptLp(lp: LpResponse): void` and
     `settlement: { address: string | null; caption: string | null; tone: "muted" | "negative" }`
     (computed with `deriveSettlementRow` from the provider's LP, `useStellarWallet()`,
     `useEvmWallet().isConnected`, and the link state). Add both to the `useMemo` deps.
   - Pass `settlement` into `CompanyDocsModal` as a new prop (below).

5. **Account page sync** — `packages/frontend/src/components/account/useAccountPage.ts`: add an
   optional second parameter `onLpAdopted?: (lp: LpResponse) => void`, called inside `adopt()` when
   `next` is non-null (after the token check). `AccountPage.tsx` passes `useAuthFlow().adoptLp`
   (it already calls `useAuthFlow()`). The wallet-only branch stays untouched (no `useAccountPage`).

6. **Settlement row UI** — new `packages/frontend/src/components/account/SettlementAddressRow.tsx`
   (header `// spec: docs/frontend/account-page.md#settlement-address-1813`): renders
   `AccountListRow variant="plain"` with `caption="Settlement address"`, `title={address ?? "—"}`
   (title text `break-all`), and the caption line below in body-small ink-subtle, or
   `--color-pipeline-negative-strong` with `role="alert"` for the negative tone; `data-testid=
   "settlement-address-row"`. No input, no button, no copy action.
   - `CompanyDocsModal.tsx`: new optional prop `settlement?: SettlementRowView`; render the row
     inside the first surface card after Country, only when not `preview` and `settlement` is given
     (`/test?tab=auth` preview unchanged).
   - `AccountProfileCard.tsx`: new optional prop `settlement?`; render the row after Country, above
     the Save button. `AccountPage.tsx` passes `useAuthFlow().settlement`.

7. **User stories** — new `docs/user-stories/epic-1247/1813-link-wallet-address.md` (Epic #1247,
   Issue #1813, Spec links to the two spec sections). Stories:
   1. Signed-in LP (NotStarted/UnderReview, LP exists) connects a Stellar wallet → one
      `POST /v1/lps/me/link-address` 200 with the connected address; `/v1/lps/me` returns it with
      `address_linked_at`; settlement row shows it; Trustee LP profile "Linked wallet" shows it.
   2. Wallet already connected, then sign in → link fires after the LP read; reload → no second call.
   3. New account (no LP) with a Stellar wallet: row shows the connected address + "Linked when you
      submit…"; Submit in Finish account setup → `POST /v1/lps/me` then the link call.
   4. Before Passed, disconnect and connect a different Stellar wallet → the record follows it.
   5. After Passed with an address, connect a different wallet → no link call (or a 409 if the app
      read was stale) and no error toast; row shows the served address + "fixed" caption.
   6. Passed LP with no address yet → first connect links once.
   7. Wallet already linked to another LP → row shows the "already linked to another account" alert;
      no toast.
   8. EVM-connected signed-in LP → no link call; row explains a Stellar wallet is needed.
   9. Trustee records a bank deposit for the linked LP and mints → PLUSD lands in the linked wallet.
   Add the row to `docs/user-stories/index.md` under epic #1247.

8. **Lint/build** — `yarn workspace @pipeline/frontend test`, `yarn workspace @pipeline/frontend
   lint`, `yarn workspace @pipeline/frontend build`, `npx tsx scripts/lint-docs.ts`,
   `npx tsx scripts/lint-comments.ts`; sweep `git diff origin/main...HEAD --unified=0 -- packages |
   grep -E '^\+ *(//|/\*| \*)'` — only bare `// spec:` headers allowed.

## Test Strategy

Unit/integration (vitest + Testing Library, real module boundaries, `fetch`/API functions mocked):

- `api/lps.test.ts`: `linkMyAddress` POSTs to `/v1/lps/me/link-address` with bearer + JSON
  content type and body `{ stellar_address }`, returns the parsed LP.
- `components/account/settlementAddress.test.ts`: every row of the step-2 table, including
  first-match precedence (`linking` over Passed), verbatim address output (no truncation), and
  `settlementWritable` for all six statuses × address present/absent.
- `auth/useSettlementAddressLink.test.tsx` (mock `@/api` `linkMyAddress`/`getMyLp`, mock
  `useStellarWallet`):
  - loaded NotStarted, no address, connected A → exactly one call with A; `onLp` gets the response.
  - served === connected → no call; UnderReview with a different served address → call (outside
    the freeze).
  - Passed + served B, connected A → no call. Passed + no address → one call. Failed → no call.
  - `lpLoaded` false (absent/loading/error) → no call; flipping to loaded → call.
  - not connected / EVM only → no call.
  - A→C while the A request is pending → C is sent only after A settles; final `onLp` is C's response.
  - 409 → error toast with the served message, then `getMyLp` re-read adopted; no throw.
  - network error → `error`, no second call for the same key; a new address retries.
  - token changes mid-flight → late response not adopted; StrictMode render → single call.
- `auth/AuthFlowProvider.test.tsx`: widen the `@/wallet` mock (`useStellarWallet`, `useEvmWallet`);
  add a case that a connected Stellar wallet + loaded LP links and `useAuthFlow().settlement`
  reflects the served address; `CompanyDocsModal` `onLpChange` from absent → loaded triggers the link.
- `components/account/useAccountPage.test.tsx`: `onLpAdopted` receives the server LP on load and
  after a profile save; not called on 404.
- `CompanyDocsModal.test.tsx` and `AccountProfileCard.test.tsx`: the row renders `Settlement
  address`, the full address text, the caption, `role="alert"` only for negative tone, and there is
  no textbox/button inside the row; preview mode renders no row.

Live verification (staging, real wallet, real API — no localStorage mocks; the human or ux-tester
runs it, agents do not drive the user's browser): the issue's three acceptance checks via the
Network tab and the Trustee LP profile, plus story 5's "no toast" check.

## Docs to Update

- `docs/frontend/account-page.md`: new `## Settlement address (#1813)` section (sources, the
  trigger predicate, serialization/idempotency, 409 handling, the state → caption table, the
  no-Figma stand-in note, Stellar-only); amend §Wallet-only variant — "nothing links the address to
  an account" stays true **without a session**, with a pointer to the new section; add
  `AccountProfileCard`'s settlement row to §Page composition.
- `docs/frontend/auth-components.md` §AuthFlowProvider: context widened with `adoptLp` and
  `settlement`; the provider owns the link call. §CompanyDocsModal: the settlement row and the
  `settlement` prop; drop "wallet linking" from the "Out of scope for #1371" sentence's implication
  by noting #1813 adds it.
- `docs/frontend/hooks.md`: row for `useSettlementAddressLink`.
- `docs/product-specs/kyb-lp-verification.md` §Settlement Address: one sentence that the LP app
  names the connected Stellar wallet automatically (no free-text entry) — keeps TD-57 open.
- `docs/user-stories/epic-1247/1813-link-wallet-address.md` + `docs/user-stories/index.md` row.
- `docs/exec-plans/tech-debt-tracker.md`: note the EVM settlement-address gap points at epic #1494
  if no entry exists yet.
