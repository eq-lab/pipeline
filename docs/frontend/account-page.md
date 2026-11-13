# Account page

The LP `/account` route for epic #1247 (V1.0, issue #1284) — wallet connection, the account's
corporate email, and the KYB documents hub. Per the epic's 2026-09-21 flow-semantics decision this
page is the **resume surface** for dismissible onboarding: a returning unverified LP lands here to
continue instead of being pushed back into a linear wizard. A new area doc rather than a section
in `auth-components.md` (whose own scope is "LP-facing email+password authentication **modals**",
not a route) or `dashboard-components.md` (already 1580+ lines) — this surface keeps growing
through #1254, #1265, #1267 and #1282.

The page reads and edits the LP profile and documents through the LP API. The original six visual
fixtures remain development-only previews.

## Production LP data contract (#1373)

The authenticated page reads `GET /v1/lps/me` before displaying profile or document state. It
distinguishes loading, 404 (a new LP), and request error; an error offers retry and never becomes
an empty LP. For a missing LP, the page shows the profile and document controls without an
additional account-setup description (#1401). `AccountEmailCard` displays `contact_email` from a returned LP, or the authenticated
session email on 404. A legacy session without email cannot create an LP until the user signs in
again. The wallet card, logout button, and centered 480px column remain. UnderReview and Passed
use the document status banner without an additional generic freeze paragraph (#1408); Failed
retains its distinct verification-declined message. Edit restrictions still follow the server.

A new profile card sits above the document card with a labelled Name (`legal_name`, shared
`TextField`) and Country (`country`, `CountryField`, see [Country select](#country-select-1715)).
Both controls have a visible one-pixel `--color-pipeline-line` border while unfocused (#1399); the
existing focus border and disabled behavior remain. A targeted child selector styles the control
row, so it does not add a second border to the outer wrapper or change other TextField consumers.
The form preloads returned values, requires a nonblank Name, and sends the complete profile,
including the stored `contact_email` and unchanged country, in JSON to `POST /v1/lps/me`.
Profile-only edits save without another file. Draft text survives a same-LP document upload,
deletion, or refetch; a successful profile save refreshes its baseline. The API's `writable` flag
disables profile and document writes for `UnderReview`, `Passed`, and `Failed`; in that state the
profile card hides the Save profile button instead of showing it disabled.

### Country select (#1715)

Country is a searchable `Combobox` (`@pipeline/ui`, see `ui-components.md#combobox`) wrapped by
`CountryField` (`packages/frontend/src/components/account/CountryField.tsx`), used by this page and
the account-setup modal. There is no Figma for it.

- **Source.** `GET https://flagcdn.com/en/codes.json` (a `{ code: name }` map) through
  `useCountries()` (`lib/useCountries.ts`; the request lives in `src/api/countries.ts`, the only place the lint rule allows a non-API `fetch`; parsing and option building in `lib/countries.ts`). Only two-letter keys are kept, minus `eu` and `un`,
  sorted by name with `en` collation. React Query settings: key `["countries","flagcdn","en"]`,
  `staleTime` and `gcTime` infinite, `retry: 2`, no refetch on window focus, so the list loads once
  per page load and is shared by both surfaces. A payload that is not an object, or has no valid
  entry, counts as a failure.
- **Label.** The "Country" `<label htmlFor>` is a sibling of the field, not a wrapper, so the
  combobox's accessible name is just "Country" (a wrapping label would also absorb the clear and
  chevron button names).
- **Flags.** `https://flagcdn.com/{code}.svg`, 20x15, decorative.
- **Privacy.** Both the JSON request and the flag images are credential-less and send no referrer
  (`credentials: "omit"`, `referrerPolicy: "no-referrer"`).
- **What is sent.** Only the plain-text name (the list's value) goes to `POST /v1/lps/me`, through
  the unchanged `country.trim() || null`. Never a code or a flag URL. The API still accepts any
  nullable string.
- **Search.** Typing filters by case-insensitive substring of the name, or an exact alpha-2 code
  (`nl` finds Netherlands). "aland" does not match "Aland Islands" (no diacritic folding); the code
  `AX` does. Typing never becomes the value: blur, Escape and outside click restore the previous
  selection.
- **Loading.** Until the list settles the field is a disabled combobox reading "Loading
  countries...". A stored value appears once the list is loaded.
- **Failure.** After the retries the field renders the plain `TextField` (same id, label, #1399
  border and disabled gating) holding the current draft, with the caption "Couldn't load the
  country list. Type your country instead." The LP is never blocked. The query is retried on the
  next mount.
- **Clear.** The "Clear country" button empties the field; saving then sends `null`.
- **Stored values not in the list.** Matching is exact and case- and whitespace-sensitive, with no
  normalisation. A value such as `"NL"`, `"peru"` or a long ISO form is added to the options as
  "<value> (as saved)", built from the saved baseline and the current draft together so the LP can
  switch back before saving. When selected, the closed field shows the raw value with no flag and
  no suffix. The existing trim-on-save still applies.

The document card displays all persisted `original_filename` values and Provided/Verified/Rejected
statuses from the LP response after reload. Writable LPs can stage more files and upload them by
multipart `POST /v1/lps/me/documents`. A new LP is created from a valid profile before its first
upload. The returned per-file results are matched by request order, so duplicate filenames do
not confuse partial success; confirmed successes leave the retry batch, failures stay staged with
their reasons. A persisted row uses its server id for `DELETE /v1/lps/me/documents/{doc}` and
stays visible until deletion succeeds. Verified files cannot be removed. A Rejected file on a
writable LP offers deletion followed by replacement upload. After all staged uploads succeed, the page calls `POST /v1/lps/me/submit` and adopts its returned
LP state. Partial or uncertain uploads never submit. Submit for review is also available for
eligible persisted documents with no staged files, rejected documents, or unresolved writes.
Name/Country drafts must be saved first; profile-only Save never submits. Failed submission
retains uploaded files for submit-only retry. Unknown submission requires Check submission
status; a read showing UnderReview or a newer verdict adopts that state without another POST.

The existing `missing` preview contains a synthetic `NotProvided` row and a named required file;
the API supplies neither field. That content remains a development fixture, never production
data. All `?state=` fixtures stay dev-only and do not fetch or mutate LP data.

`6702-104071` ("Error Verification" in the home-frame column) is the **home dashboard**'s failure
card, not an Account frame — despite sharing a name with `6701-97982` below it is
`AddUsdCard variant="declined"` ("We can’t verify your account", #1426,
`docs/frontend/bank-transfers.md#addusdcard`), whose `View` button navigates into this page. A
`ChangesRequested` LP lands on the `invalid` state below; a `Failed` LP lands on the
`under-review` stand-in's declined banner (see "The under review stand-in" below) — in practice
unreachable while a `Failed` verdict suspends the account (tech debt), and since #1465 the LP is
signed out before `/account` renders at all (see "The declined stand-in" below).

## Route gate

`packages/frontend/src/routes/account.tsx`. The access gate lives in the `AccountRoute` component,
not `beforeLoad` (issue #1458) — wallet connection is not synchronously readable at `beforeLoad`
time: EVM reconnects through wagmi after mount, and Stellar hydrates asynchronously via
`StellarWalletsKit.getAddress()` in a mount effect (`wallet/stellar/useStellarWallet.ts`). A
`beforeLoad` check would bounce a connected visitor who hard-refreshes `/account`. Instead,
`blocked = !ENV.IS_DEV && !isAuthenticated && !isAnyConnected` (`useAuthSession` + the
`useWalletPresence()` hook, see [Hooks](./hooks.md)) is computed on every render; the component
renders nothing (`return null`) while `blocked`, and a `useEffect` navigates to `/` (`replace:
true`) **only once `useWalletPresence().isSettled` is also true** — so there is no flash and no
bounce while reconnection is still in flight. An authenticated LP, or a visitor with any wallet
namespace connected, reaches `/account` in any environment; a visitor with neither is redirected to
`/` outside the dev server once wallet state has settled. On a dev deployment the gate never
blocks, same as before.

Access and the `?state=` preview override are not the same guard: an authenticated or
wallet-connected production user can reach the route without `ENV.IS_DEV`, so `validateSearch`
gates `state` behind `ENV.IS_DEV` explicitly (`parseAccountStatePreview` only runs when
`ENV.IS_DEV`) — otherwise a real LP could append `?state=verified` in production and see fixture
data instead of their own documents.

`onLogOut` (passed down from the route) ends everything the visitor is identified by (#1553): an
authenticated LP's session is cleared with `signOut()`, **and** every connected wallet namespace is
disconnected with `useWalletPresence().disconnectAll()` — for a wallet-only visitor only the latter
applies. Either way it navigates to `/`, so the header reverts to Sign In / Sign Up and the home
page shows the zero state. The forced session-end path (expiry, `401`, suspension — see
`auth-components.md#session-module`) is different: it keeps wallets connected.

## Page composition

`AccountPage.tsx` (shell) → `AccountWalletCard.tsx`, `AccountEmailCard.tsx`,
`AccountProfileCard.tsx` (Name, Country, then the [settlement address rows](#settlement-address) and the [settlement bank account](#settlement-bank-account-1885)), `AccountDocumentsCard.tsx`, and a full-width `Log Out` button, in a `max-w-[480px]` centered
column at `gap-8` (32px), below the fixed header. A 72×72 `--color-pipeline-fill-muted` circle with
a user glyph sits above the centered Besley 28/36 `Account` heading.

The page container uses the sibling LP routes' padding rhythm (`px-4 py-8 md:px-8 md:py-16`) —
`dashboard.tsx` / `index.tsx` style — **a deliberate deviation from the Figma frame's `p-[128px]`**
(#1309, user direction 2026-09-22): the 128px page padding the earlier fidelity pass adopted read
as too much wasted space in the real app. The content is a centered `max-w-[480px]` column, so
horizontal padding beyond the gutter is moot; the QA Figma comparison should expect this reduced
padding, not the frame value. `Log Out` is `Button variant="secondary"` with a `!bg-[color:var(--color-pipeline-surface)]`
override — the `!` is required: `secondary`'s own `bg-transparent` and an unprefixed override are
the same Tailwind specificity, so the surface fill is not guaranteed to win without it (the
established precedent is `AccountInReviewModal.tsx`'s `!bg-[...]` override of the same variant).

The page root itself carries `min-h-screen bg-[color:var(--color-pipeline-paper)]
text-[color:var(--color-pipeline-ink)]` — the frame's own root fill (`bg/primary`, `#f8f7f6`) and
the same convention every other route (`dashboard.tsx`, `deposit.tsx`, `stake.tsx`,
`transactions.tsx`, `index.tsx`, `test.tsx`) already applies to its page root; a prior pass left
this off `AccountPage.tsx`, so the page rendered on the default (white) canvas instead of the
paper tone (issue #1291, no `?state=` fixture exercises the root div's own background so this
was invisible to state-scoped snapshots).

## Wallet-only variant (#1458)

Design added a visitor state: a wallet is connected (EVM or Stellar) but there is no auth session.
**The wallet is display-only, not a credential** — connecting it only lets the visitor see it on
this page; without a session nothing links the address to an account (with a session the LP can link it
from the settlement row, see [Settlement address](#settlement-address)). Renders when `useAuthSession().isAuthenticated`
is `false` and the route gate has already admitted the visitor (i.e. a wallet is connected — see
[Route gate](#route-gate)); `AccountPage` branches on `isAuthenticated` alone (not on wallet state
again), since the gate already guarantees one of the two. In that branch `AccountPageContent`
renders with `walletOnly` and **does not call `useAccountPage()`**, so there is no
`GET /v1/lps/me` request for a visitor with no session.

The wallet card shows the single connected wallet ([Wallet card](#wallet-card), #1512).

Composition (frame `6701:98137`, "No Verified Account"): the heading, `AccountWalletCard` (its
connected state — [Wallet card](#wallet-card)), `Corporate email` with an `Add email` row, the
Documents card in its `verify` composition (`{ kybStatus: "NotStarted", documents: [], stagedCount:
0 }` derives to `verify` via `deriveDocumentsState`), and a full-width `Log Out`. **No profile
card** — node `6701:98148` is hidden in the frame, and the card is already gated on a present
`account` object, which is `undefined` here.

`Add email` (`AccountEmailCard`, row `7129:15860`): when `email` is falsy and an `onAddEmail`
handler is supplied, the row renders as a real `<button>` with title `Add email` instead of the
read-only `—` row. `walletOnly` wires `onAddEmail={openAddEmail}`, `openAddEmail` coming from
`useAuthFlow()` (see
[`auth-components.md#authflowprovider`](./auth-components.md#authflowprovider)) — clicking it opens
`AddEmailModal` (#1459), the normal create-account registration (email + password → OTP → session)
with its own chrome; see
[`auth-components.md#addemailmodal`](./auth-components.md#addemailmodal). The authenticated path
never passes `onAddEmail`, so its read-only row is unchanged.

`Upload` (`AccountUploadRow`, via `AccountDocumentsCard`'s `onUploadIntercept`): document writes
need a session (`POST /v1/lps/me/documents`), so in the wallet-only variant `Upload` calls
`openAddEmail()` instead of opening the hidden file input — the input is not even rendered in that
case. `Save` needs no interception: `canSave` is `false` in this variant (nothing can be staged),
so the frame's disabled `Save` renders as-is; `Submit for review` does not render at all
(`AccountDocumentsCard` gates it on `production && documents.length > 0`, and `production` is
`false` here).

`Log Out` disconnects every connected namespace (`useWalletPresence().disconnectAll()`, not just
the connected wallet) and navigates to `/` — so the header reverts to Sign In / Sign Up. Since
#1553 the signed-in variant does the same on top of `signOut()` — a connected wallet no longer
survives a log out (the `Disconnect` row still exists for dropping the wallet while staying signed
in).

No new `?state=` fixture: the variant is fully reachable for real (connect a wallet, no session),
so it is exercised live rather than through a dev-only preview — per the project's no-mocks rule,
nothing about this variant is faked.

## Settlement address

**Review fixes (2026-11-05, PR #1846):** a link in flight is abandoned as `idle` (no caption, no
verify) if the session token or the connected wallet changes before it finishes; `signMessage`
receives the challenged address so the wallet signs with that account (wagmi `account`, kit
`address`); a generic verify failure re-reads `GET /v1/lps/me` best-effort before showing the
error caption; the row carries `aria-busy` while requesting / signing / verifying; the hook also
returns `connected` so the provider reads the wallet once.

The LP links the **connected wallet** (as both address and signer) to its record by signing a challenge, so the Trustee's
settlement rows and the bank-deposit mint receiver have a proven address. Behaviour sources, in precedence order:
`docs/user-docs/lenders/onboarding.md` (§Entity verification), `docs/product-specs/kyb-lp-verification.md`
§Settlement Address, and the API (`routes/lp_settlement_address.rs`; contract in
`docs/product-specs/api-authorization.md` § Settlement-address proof). **No Figma frame exists**; the rows are built from
the existing settlement row and the LP theme (user decision 2026-11-04).

**Flow (click only).** `useSettlementAddressLink` (`packages/frontend/src/auth/useSettlementAddressLink.ts`), owned by
`AuthFlowProvider`, runs `GET /v1/lps/me/link-address/challenge?chain_id&address`, then the wallet's `signMessage`
(Stellar SEP-0053 through `useStellarWallet`, EVM EIP-191 through `useEvmSignMessage`; see
[wallet README](../../packages/frontend/src/wallet/README.md#usestellarwallet) and
[`useEvmSignMessage`](../../packages/frontend/src/wallet/README.md#useevmsignmessage)), then
`POST /v1/lps/me/link-address/verify { chain_id, address, signature }`, and adopts the returned LP. A signature prompt
opens only from a click (`Link wallet`, `Try again`, `Confirm change`): no effect fetches a challenge or signs, so sign-in,
page load, LP creation and connecting a wallet never prompt, with one exception (#1901): a connect started from the
Account wallet card's **Link Wallet** (**Connect Wallet** when linking cannot happen) continues into the link (next paragraph). Every `Try again` and every new `Link wallet` click starts
with a new challenge; the client never reuses a message. One flow runs at a time, and a response that arrives after the
session token changed is dropped. The default connected-wallet path never sends `signer_address` (the backend defaults it to
the address). The opt-in **Different address** path (below) sends it only when the typed address differs
from the connected wallet (#1849, resolves TD-166).

**Connect then link (#1901).** The wallet card's button (labelled `Link Wallet` while an LP session exists and KYB is not `Failed`, else `Connect Wallet`; a deliberate deviation from frame `6701:98104` by user decision 2026-11-12) calls `settlement.onArmConnectLink()` (the hook's
`armConnectLink`) and then opens the shared connect modal. The hook keeps a one-shot intent (a ref holding the session
token) that exists only when armed while no wallet is connected. When a wallet connects with the intent armed and the LP
loaded, the intent is consumed and the hook continues exactly like the click path for that wallet's chain: `link` when no
address is served for the chain (or the served one is unproven for this wallet), `beginChange` (the Change confirmation, no
challenge yet) when the served address differs, nothing when equal and proven or when KYB is `Failed`. A declined
signature, 409, 422 or error then behaves as for a click (`Try again`, `taken`, `proofFailed`, toast) with the wallet still
connected. The intent is dropped when the connect modal (or the terms gate before it) is dismissed without picking a
wallet (`useConnectModal().onCancel` of the LP `ConnectModalProvider`), on a session-token change, and once consumed. A
wallet connected anywhere else (header, home cards, sign-in, auto-reconnect) never arms it and never prompts. Residual
case: if the LP picks a wallet and then rejects the connection inside the wallet, the intent stays armed until the next
connect or token change.

**Connected wallet.** The EVM wallet if connected, else the Stellar wallet, else none, decided by
`walletPrecedence` (the single owner, see [`wallet-flows.md`](./wallet-flows.md#single-connected-wallet));
`connectedWallet` adds the winning wallet's address and is `null` when that wallet has no address. `chain_id` is `ENV.EVM_CHAIN_ID` or `ENV.STELLAR_CHAIN_ID`. EVM addresses are sent lowercased and
compared case-insensitively; Stellar addresses are compared verbatim. The write is refused only for `Failed`
(`settlementWritable`): a `Passed` LP can link, prove a legacy unproven address and change its address (#1831).

**Rows.** `SettlementAddressRows` renders one `SettlementAddressRow` per chain kind (Stellar, then EVM) that has a served
address or a connected wallet of that kind; with neither there is one generic `Settlement address` row. Each row is an
`AccountListRow variant="plain"` (caption = the row label; the title is `truncateAddress(address)`, `GCGQVO…GQ5C`, with the full address as the title span's `title` attribute via the row's `titleAttr` prop so it shows on hover — live review 2026-11-05; the From / To lines of the change confirmation keep the full addresses), a
body-s caption (`--color-pipeline-ink-subtle`, or `--color-pipeline-negative-strong` with `role="alert"`), and at most one
`Button variant="secondary" size="compact"` in the trailing slot. Labels: `Stellar settlement address`,
`Ethereum settlement address`, `Settlement address`. The rows sit below Country in `AccountProfileCard` and in
`CompanyDocsModal`'s first surface card (not in the `/test?tab=auth` preview), both fed by `useAuthFlow().settlement`
(`{ rows, onLink, onChange, onCancel, onOther, onLinkOther }`). A linked row whose served signer differs from its
address shows a body-s `Signer` line (`Signer` in `--color-pipeline-ink-muted`, `truncateAddress(signer)` in
`--color-pipeline-ink`, full value as `title`, testid `settlement-signer`) directly under the `AccountListRow`, before
the caption; the Trustee profile (#1826) uses the same word.

**Change wallet.** A row whose served address differs from a connected wallet of the same kind offers `Change wallet`.
It does not prompt the wallet: it opens an inline confirmation inside the row, `From` (served address) and `To`
(connected address) in full, the `confirm` caption, and `Confirm change` / `Cancel`. Only `Confirm change` starts the
signed flow; `Cancel` makes no request. The confirmation applies at every status. `Try again` after a failed change skips
it. Changing the connected wallet or the token resets the row. A served row with no connected wallet of its kind shows the
address with no caption or button: a change needs the new wallet connected.

**Different address (#1849).** No Figma frame exists (user decision 2026-11-05); the form is built from `TextField`
(with the company-docs modal's `[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]` class), `Button`
(`size="compact"`) and the LP tokens, on both surfaces.

- **Entry.** A text-link button `Use a different address` (body-s, `--color-pipeline-ink`, `hover:underline`,
  focus-visible outline, testid `settlement-other-entry`) under the row's caption. It is shown only when the LP is loaded
  and not `Failed`, a wallet of this row's kind is connected, and the row is idle (not busy, not confirming, form not
  open); never on the generic row. The connected-wallet button stays the single primary action.
- **Signer.** Always the connected wallet, shown read-only; there is no signer input. Only the connected wallet can sign,
  and the pinned-signer rule of #1825 requires the challenge's `signer_address` to equal the wallet passed to
  `signMessage`. To use another signer, connect that wallet.
- **Request shape.** `signer_address` is sent on both challenge and verify only when the typed address differs from the
  connected wallet (`sameAddress`); typing the connected wallet's own address is the default link. The EVM signer is sent
  lowercased. A Stellar `C…` needs a `G…` signer (the backend rejects it otherwise); a `G…` or `0x…` address may name a
  different signer.
- **Normalisation.** Stellar input is trimmed and uppercased. EVM input is trimmed and sent as typed, so the backend's
  EIP-55 check rejects a mistyped mixed-case checksum (`400`); the backend lowercases before storing. The same strings go
  to challenge and verify.
- **Validation** (format only, backend authoritative for `400` / `409` / `422`). Stellar: Strkey `G…` or `C…`
  (`isStellarSettlementAddress` from `@/wallet`, length + alphabet + checksum, no network call). EVM:
  `/^0x[0-9a-fA-F]{40}$/`. The message shows through `TextField`'s `invalid` + `error` on blur and on submit and clears on
  edit; `Link address` is disabled while the input is empty.
- **Form** (inside the row below the caption, a `<form noValidate>`, testid `settlement-other-form`): `Current` line
  with the full served address when one is served; `New settlement address` label + `TextField` (focused on open,
  `autoComplete="off"`, `spellCheck` off, id from `useId()` because both surfaces can be mounted together); the read-only
  `Signer` line (`truncateAddress`, full value in `title`); the caption; `Link address` (`primary-dark`) and `Cancel`
  (`secondary`). Enter submits.
- **Submitting is the confirmation.** There is no second From / To step: the `Current` line and the `confirm` caption sit
  in the form the LP just filled (the confirmation is not a security control, TD-163). Re-linking the same address and
  signer is allowed; the backend records a fresh proof.
- **State.** `SettlementLinkState` has `mode: "wallet" | "other"` and the phase `editing`. The draft text and its
  validation flag are local to the form, so they survive the busy and failure phases and are dropped on success,
  `Cancel`, or a token / connected-wallet change (which resets to `idle`). The hook adds `beginOther(kind)` and
  `linkOther(kind, raw)`; both modes share one `run()`, so the stale-wallet guard, single flight and pinned signer apply to
  both.
- **Phases in the form.** The caption renders inside the form, the input is disabled and the buttons hidden while busy.
  After a failure the form keeps the draft and `Link address` starts a new challenge.
- **EVM signer must be an EOA.** The backend verifies EIP-191 `ecrecover` only. A Safe is linked by typing the Safe
  address with an owner EOA (MetaMask) connected; a smart-wallet signature gets `422` and the `proofFailed` caption.
- **Connected wallet is the signer of a different linked address** (for example a linked `C…` signed by the connected
  `G…`): `base` is none and the row shows `linkedSigner` with no button; the entry link remains. Switching back to the
  wallet address is possible through the form (type the wallet address).

**Legacy unproven.** A served address equal to the connected one whose signer is `null` offers `Link wallet` with the
`unproven` caption at any status but `Failed`, with no confirmation (the address does not change).

**Errors.**

| Failure | Result |
| --- | --- |
| Wallet throws (rejection, no SEP-0053, mock wallet) | No verify request, no toast, `declined` caption, base action offered again |
| `422` on verify | `proofFailed` caption (negative), `Try again` (new challenge), no toast |
| `409` on challenge or verify | Danger toast with the served message, re-read `GET /v1/lps/me` and adopt it, then `taken` (negative, no button) unless the refreshed LP is `Failed` |
| Anything else (400, 404, 5xx, network) | Toast with the served message or `Your wallet could not be linked.`, `error` caption (negative), `Try again` |

In the different-address form the same matrix applies with the address captions below (`linkingAddress`, `addressTaken`,
`addressError`; the toast fallback is `This address could not be linked.`). On `409` the form stays open for an edit; on a
failure the buttons are `Link address` / `Cancel` instead of `Try again`.

`401`/`403` stay on the app-wide session-end path (#1473, #1465). The hook reads the toast context optionally;
`main.tsx` mounts `ToastProvider` above `AuthFlowProvider`.

**Row rules** (per kind, first match wins; `s` served address, `c` connected address of this kind, `base` = `link` when
nothing is served or the served address equals `c` with a `null` signer, `change` when `s` differs from `c` (none instead when
the served signer equals `c`, #1849), else none; always none for `Failed` or without a connected wallet of the kind):

| # | Condition | Caption | Button |
| --- | --- | --- | --- |
| 1 | Phase `requesting` / `verifying` for this kind | `linking` | none (busy) |
| 2 | Phase `signing` | `signing` | none (busy) |
| 3 | Phase `confirming` and `base` is `change` | `confirm` + `From` / `To` + `Confirm change` / `Cancel` | none |
| 4 | Phase `declined` | `declined` | `base` |
| 5 | Phase `proofFailed` | `proofFailed` (negative) | `Try again` when `base` |
| 6 | Phase `taken` | `taken` (negative) | none |
| 7 | Phase `error` | `error` (negative) | `Try again` when `base` |
| 8 | `s` served, `c` equals `s`, `base` is `link` | `unproven` | `Link wallet` |
| 9 | `s` served, `c` equals `s` | `linked` | none |
| 9b | `s` served, `c` differs from `s`, the served signer equals `c` | `linkedSigner` | none |
| 10 | `s` served, `base` is `change` | `different` | `Change wallet` |
| 11 | `s` served | none | none |
| 12 | Nothing served, no LP, LP read `absent` | `needsLp`, title `—` | none |
| 13 | Nothing served, `base` is `link` | `notLinked`, title `—` | `Link wallet` |
| 14 | Otherwise (`Failed`, LP still loading or read error) | none, title `—` | none |

Rows 1-14 apply to `mode: "wallet"`. A row whose kind has `mode: "other"` and a connected wallet of its kind renders the
form instead (the served row, `form` set, no button, `other` false): `editing` shows `otherHint`, or `confirm` when an
address is served; `requesting` / `verifying` show `linkingAddress` (busy); `signing` shows `signing` (busy); `declined`
shows `declined`; `proofFailed` shows `proofFailed` (negative); `taken` shows `addressTaken` (negative); `error` shows
`addressError` (negative). The entry link (`other`) is true when the LP is loaded and not `Failed`, a wallet of the kind is
connected, and the row is not busy, confirming or showing the form.

Captions (`SETTLEMENT_CAPTIONS` in `components/account/settlementAddress.ts`):

| Key | Text |
| --- | --- |
| `linking` | `Linking your connected wallet…` |
| `signing` | `Approve the signature request in your wallet.` |
| `confirm` | `Deposits processed after the change are minted to the new address.` |
| `declined` | `Your wallet did not sign. Nothing was changed.` |
| `proofFailed` | `The signature could not be verified. Try again to sign a new request.` |
| `taken` | `This wallet is already linked to another account. Connect a different wallet.` |
| `error` | `Your wallet could not be linked. Try again.` |
| `linked` | `Linked to your connected wallet.` |
| `unproven` | `Linked without a signature. Sign with this wallet to confirm you control it.` |
| `different` | `Your connected wallet is not this address.` |
| `notLinked` | `Link your connected wallet to receive bank deposits to it.` |
| `needsLp` | `Save your company details first, then link this wallet.` |
| `connect` | `Connect a wallet to name your settlement address.` (generic row only) |
| `linkingAddress` | `Linking this address…` |
| `addressTaken` | `This address is already linked to another account. Enter a different address.` |
| `addressError` | `This address could not be linked. Try again.` |
| `linkedSigner` | `Linked. Your connected wallet is the signer of this address.` |
| `otherHint` | `Your connected wallet signs to link this address.` |

Buttons (`SETTLEMENT_ACTION_LABELS`): `Link wallet`, `Change wallet`, `Try again`; confirmation: `Confirm change`, `Cancel`.

Form copy (`SETTLEMENT_FORM_COPY`):

| Key | Text |
| --- | --- |
| `entry` | `Use a different address` |
| `label` | `New settlement address` |
| `current` | `Current` |
| `signer` | `Signer` |
| `submit` / `cancel` | `Link address` / `Cancel` |
| `placeholder` | `G… or C…` (Stellar), `0x…` (EVM) |
| `invalid.stellar` | `Enter a Stellar address: G… or C…, 56 characters.` |
| `invalid.evm` | `Enter an Ethereum address: 0x followed by 40 hexadecimal characters.` |

**Out of scope.** A signer other than the connected wallet; EIP-1271 / smart-wallet signers (the backend verifies EOA
signatures only); proving that the signer controls the address (backend TD-162); unlinking (no
endpoint); wallet-only visitors (no session, no LP); wallets without SEP-0053 (Albedo, Rabet) are still listed in the
connect modal and end on the `declined` caption. The staging dev mock wallets cannot sign (`signMessage` rejects);
QA uses real Freighter and MetaMask wallets.

## Settlement bank account (#1885)

Capture and masked view of the LP's USD settlement bank account, on the Account profile card and on the
"Finish account setup" modal ([CompanyDocsModal](./auth-components.md#companydocsmodal)). Behaviour sources, in
precedence order: `docs/user-docs/lenders/onboarding.md` and `withdraw.md` (bank wire), then
[kyb-lp-verification.md](../product-specs/kyb-lp-verification.md#settlement-bank-account), then the API
(`UpsertProfile.settlement_bank_account`, the served `SettlementBankAccountSummary`, the 400
`settlement_bank_account.{field}: {reason}`).

**Design source.** No Figma frame exists for this block. Decision on #1885 (2026-11-13): it ships without frames, built
from the shipped Account rows (`AccountListRow variant="plain"`), `TextField` with the unfocused `--color-pipeline-line`
border, `Button size="compact"` and the "Different address" inline form of [Settlement address](#settlement-address).

**Row.** `SettlementBankAccountSection` (shared by both surfaces), below the settlement address rows. Caption
`Settlement bank account`; title is the served holder name, or `Not added`. A body-s line `{bank_name} · ending {last4}`
follows (`{bank_name}` alone when `account_last4` is `null`); served strings are shown verbatim.

| Condition | Caption | Button |
| --- | --- | --- |
| open record, no account | `Optional. Needed only to withdraw to a bank account by wire.` | `Add` |
| open record, account stored | none | `Replace` |
| `UnderReview` | `Locked while your account is under review.` | none |
| `Passed`, no account | `To add a bank account, contact support.` | none |
| `Passed`, account stored | `To change it, contact support.` | none |
| `Failed` | none | none |

"Open record" is the served `writable`. There is no Remove: the API cannot clear the account (`null` means unchanged).

**Form.** Add / Replace opens an inline `<div>` (no nested form) with seven `TextField`s, always empty, in this order and
with these labels: `Account holder name`, `Bank name`, `Bank address (optional)`, `IBAN`, `Account number`,
`SWIFT/BIC code`, `Routing number (ABA)`. Helpers: `Enter an IBAN, an account number, or both.` after the account number
and `Enter a SWIFT/BIC code, a routing number, or both.` after the routing number. A replace adds
`Replacing {bank} · ending {last4}. Enter the full account again.` above the inputs, and the masked row stays visible.
`Cancel` clears the draft and closes. The form has no save button of its own.

**Save path.** On the Account page the draft is sent by **Save profile** (one `POST /v1/lps/me`); a non-blank open draft
counts as unsaved, so it enables Save profile and blocks upload and Submit for review like a Name or Country draft. The
key is added only for a non-blank draft: blank optionals are sent as `null`, blank holder or bank name as `""` (the
server answers `is required`). Notify me and the LP-creating upsert before an upload never send the key. The browser does
no IBAN, BIC or ABA validation.

**Errors.** A 400 `settlement_bank_account.{field}: {reason}` shows on that field and no generic alert; the draft is
kept and the message never contains the value. An unknown reason on a known field reads `{Label} {reason}`. A 409 clears
the draft and refreshes, so a frozen record turns read-only.

| Server reason (field) | Inline copy |
| --- | --- |
| `is required` (holder, bank) | `{Label} is required.` |
| `is too long` (holder, bank) | `{Label} is too long (140 characters max).` |
| `is too long` (address) | `Bank address is too long (280 characters max).` |
| `is not a valid IBAN` | `Enter a valid IBAN.` |
| `is not a valid account number` | `Enter a valid account number (letters and digits only).` |
| `is not a valid SWIFT/BIC code` | `Enter a valid SWIFT/BIC code (8 or 11 characters).` |
| `is not a valid routing number` | `Enter a valid 9-digit ABA routing number.` |
| `or iban is required` (account number) | `Enter an IBAN or an account number.` |
| `or routing_number is required` (SWIFT/BIC) | `Enter a SWIFT/BIC code or a routing number.` |

`{Label}` drops ` (optional)` and ` (ABA)`. Editing `IBAN` clears an account-number "or" error, and editing the routing
number clears a SWIFT/BIC "or" error.

**PII.** The draft lives only in React state (no storage, URL or `console`), is cleared on a successful save, Cancel, 409,
session-token change and LP identity change, and the inputs use `autoComplete="off"` and `spellCheck={false}`.

**Out of scope.** The Bank tab wire-out gating (#1917, blocked on #1757), trustee surfaces, and the `/test` and `?state=`
previews (the section is hidden when there is no LP).

## Wallet card

**Single connected wallet (#1512).** The LP holds at most one wallet connection at a time, and the
card has no `Ethereum`/`Stellar` tabs. It reverses the #444 "both namespaces stay live" decision
and removes #1475's entry-tab selection (the route no longer chooses a tab). `useWalletView().kind`
is derived — `evm` when the EVM wallet is connected, else `stellar` when the Stellar wallet is
connected, else the deployment default (`evm`) — so there is no `setKind` and no persisted
`pipeline.wallet.view.kind`. Rules and the legacy both-connected cleanup live in
[`wallet-flows.md#single-connected-wallet`](./wallet-flows.md#single-connected-wallet).

| Card state | Renders |
|---|---|
| Wallet connected (`6701:98142`) | the chain block (below), then the connected block: icon tile, `Wallet` row, `USDC balance` row, divider, `Disconnect` |
| No wallet connected (`6701:98104`) | the full-width `Link Wallet` CTA (`Connect Wallet` when no LP session or KYB `Failed`) |

**Chain block (`6701:98144`, #1512 follow-up).** The track area where the `Ethereum`/`Stellar`
tabs used to sit is kept, with the same size and style as the former `SegmentedTabs variant="track"`
(`px-2` wrapper, full-width `p-0.5` `rounded-[6px]` `--color-pipeline-fill-muted` track, one
`h-8` `--color-pipeline-surface` pill, caption/medium ink text) but it is a static label, not tabs:
a 16px chain logo (`ChainLogo`, inline SVG in `AccountWalletCard.tsx`; `data-testid="account-wallet-chain-logo"`,
`data-chain`) followed by the chain name (`data-testid="account-wallet-provider-name"`), derived purely
from `useActiveWalletAccount().kind`: `Ethereum` for `evm`, `Stellar` for `stellar` (never the wallet
app's name). The Ethereum logo is the two-tone diamond; the Stellar logo is the official circular mark
(circle with two diagonal bars, no wordmark) redrawn as `currentColor` paths so it takes the ink token.
It renders only while a wallet is connected; the disconnected state is unchanged (no block). No
`tablist` role.

Link Wallet is arm-then-connect (see **Connect then link**, #1901); Disconnect and the connected frame are unchanged.

The card keeps its outer classes and both state blocks unchanged (sizes, paddings, node ids). `AccountWalletCard.tsx` does
**not** own a second wallet system: `packages/frontend/src/wallet/useActiveWalletAccount.ts` is the
extracted derivation (see [Hooks](./hooks.md)): `kind` from `useWalletView()`,
`isConnected`/`address` from `useEvmWallet()`/`useStellarWallet()` per `kind` (all hooks called
unconditionally, branched only in the derivation), `truncatedAddress` via
`@/utils/truncateAddress`, `formattedBalance` from `useEvmToken`/`useStellarToken`, `connect` =
`useConnectModal().open` (routes through the shared first-connection terms gate; a no-op while any
wallet is connected), and `disconnect` (issue #1458) = the connected wallet's own `disconnect()`.
To switch chains the LP disconnects and connects the other wallet through the connect modal, which
keeps its Ethereum / Stellar tabs for that choice.

**`Disconnect` row (issue #1458, closes TD-111).** Every connected state of the card renders a
24px divider (`7127:15564`, a centered 1px `--color-pipeline-line` rule) followed by a full-width
`Disconnect` row (`7127:15570`) after the `Wallet`/`USDC balance` rows — confirmed on every
connected Account frame (`6701:97942`, `6701:97982`, `6701:98022`, `6701:98137`, `6701:98061`,
each with its own divider id). It is a plain `<button>`, not an `AccountListRow` (that primitive
requires `leading`/`caption`) — body-typography text only, no leading tile, no trailing control.
Clicking it calls `useActiveWalletAccount().disconnect` for the connected wallet (not
`disconnectAll`) — with no session left, the header's account icon reverts to Sign In / Sign Up
and the home route falls back to the zero state. This ships for signed-in LPs too, since the row
lives in the card's shared connected branch — there was previously no UI anywhere to disconnect a
wallet (TD-111). The connected-rows container's gap is `gap-0`, not `gap-2` — `get_metadata` on
`6701:98145` places the two rows and the divider+Disconnect block with **no** inter-row gap (`y=0`
h56, `y=56` h56, `y=112` h24, `y=136` h40, total 176px); a prior pass had `gap-2` (8px too much),
corrected in the same pass that added the new rows to this exact container.

`TopBar.tsx` was untouched by #1284 at the time; #1362 later removed all wallet balance/pill UI
from the header entirely, and #1458 added back a presence-only read (`useWalletPresence()`, no
balance, no token reads) for the header icon rule — see
[`dashboard-components.md#topbar`](./dashboard-components.md#topbar).

The frame's `Ethereum`/`Stellar` tabs row (`6701:98144`) is built as the static chain block above (#1512), not as tabs. Connected state shows two
rows (`Wallet` +
truncated address + copy button; `USDC balance` + `CoinIcon token="usdc" size="lg"` + formatted
balance); disconnected shows a 72px `--color-pipeline-fill-muted` circle with a generic wallet
glyph and a full-width 48px `Button variant="primary-dark"` labelled `Link Wallet` (`Connect Wallet` without an LP session or with KYB `Failed`; deviates from the frame by user decision 2026-11-12). A missing
balance renders `—`, never a computed or placeholder number.

**The wallet row's leading icon in the frame is a literal MetaMask fox logo** (`get_design_context`
emits it as an `imgMetamask` asset on node `I6701:98146;8905:4082`) — scratch/placeholder art from
whoever mocked the frame, the same category of design-file artifact as the "Verify your
identity"/"Verify your account" inconsistency below. This row renders for **either** chain's wallet, so a brand-locked browser-extension logo would be product-wrong; the
generic ink-colored `WalletGlyph` (`AccountWalletCard.tsx`) is intentional and unchanged. Logged as
a designer ask, not a defect.

**The wallet card's copy button and the upload row's `Upload` button each sit inside an invisible
40×40 touch-target wrapper, not flush against the row's own padding** — confirmed via
`get_metadata` at `6701:98146` (`ButtonCont` node `I6701:98146;8902:3635`: `x=416 w=40 h=40`,
containing the 32×32 visible control at a 4px inset) and `6701:98157` (`ButtonCont` node
`I6701:98157;8902:3622`: `x=373 w=83 h=40`, containing the 75×32 `Upload` button at the same 4px
inset). Both rows are `p-[8px]` with a `gap-[12px]` between content and this wrapper — matching the
existing `AccountListRow`/`AccountUploadRow` padding — but a prior pass placed the compact control
directly in that gap with no wrapper, landing it 4px closer to the card edge than the frame. Fixed
by wrapping each control in a `p-1` (4px) container (`size-10` for the copy button, matching its
`size-8` control; unsized for the `Upload` button, whose own `size="compact"` height already
matches the wrapper's content height) — issue #1292.

**The staged uploaded-file rows (`6701:98198`–`6701:98203`) carry the same 40×40 touch-target
convention on their remove control, plus their own `p-[8px]` row padding** — confirmed via
`get_metadata` at `6701:98197` (six `list-item` children, each `464×56`, `y` stepping by 60px —
i.e. a 4px gap between 56px-tall rows) and at `6701:98198` (leading tile at `x=8 y=8` 40×40,
`ButtonCont` at `x=416 y=8` 40×40 containing a 32×32 control at a 4px inset — identical geometry to
the `CompanyDocsModal` uploaded frame's own remove button, confirmed at `6486:81826`). `56 = 40
(icon) + 2×8 (row padding)`; the `4px` gap between rows plus each row's own `8px` top/bottom padding
reproduces the frame's 20px dead space between consecutive rows.

`UploadedFileRow.tsx` (shared with `CompanyDocsModal`, #1278) now always wraps its
remove `<button>` in a `flex size-10 shrink-0 items-center justify-center p-1` touch target — safe
for both consumers since `CompanyDocsModal`'s own frame confirms the identical 40×40/4px-inset
geometry, and the row's overall height was already governed by its 40×40 leading tile (removing the
now-redundant `h-10` on the `<li>` changes nothing rendered). The row's own `p-[8px]` padding is
**not** shared — `CompanyDocsModal`'s frame uses a plain `h-[40px]` row with the modal's `<ul
gap-3>` doing the spacing, a genuinely different spec — so `UploadedFileRow` gained an additive
`className` prop instead, and `AccountDocumentsCard`'s staged-rows `<ul>` passes `className="p-2"`
as a local override; the `<ul>`'s own `gap-1` (4px) is unchanged and already matched the frame.

`packages/frontend/src/components/account/accountPageState.ts` — pure data and pure functions, no
React.

```ts
export type AccountDocumentsState =
  | "verify" | "staged" | "under-review" | "missing" | "invalid" | "verified";

export type KybStatus =
  | "NotStarted" | "InProgress" | "ChangesRequested" | "UnderReview" | "Passed" | "Failed";
export type KybDocumentStatus = "NotProvided" | "Provided" | "Verified" | "Rejected";
export interface AccountDocumentRecord { id?: number; name: string; status: KybDocumentStatus }
```

These names mirror the backend vocabulary: `deriveDocumentsState({
kybStatus, documents, stagedCount })` (the `?state=` preview path, unchanged by #1426) maps a
`(KybStatus, AccountDocumentRecord[], stagedCount)` triple onto one `AccountDocumentsState`, with an
explicit precedence — `Passed` → `verified`; any `Rejected` → `invalid`; a `NotProvided` document →
`missing`; `UnderReview` → `under-review`; `stagedCount > 0` → `staged`; otherwise `verify`.

Production uses `deriveProductionDocumentsState` with the server's `kyb_status`, persisted document
statuses, and `writable` flag, in its own precedence order: `Passed` → `verified`; `Failed` →
`under-review` (checked before the `Rejected` check, so a `Failed` LP holding a rejected document
is not mis-routed into the re-upload banner — #1426); `UnderReview` → `under-review`;
`ChangesRequested` → `invalid` (also checked before the `Rejected` check — a `ChangesRequested`
with neither a reason nor a single rejected document is a real case per
[kyb-lp-verification.md](../product-specs/kyb-lp-verification.md), and must still show the
re-upload banner rather than the first-time "Verify your account" banner); any `Rejected` document →
`invalid`; a writable LP → `staged` or `verify`; otherwise `under-review`. Writable LPs retain
upload controls and all persisted rows, including Provided rows. The `missing` state and named
required document remain fixture-only — `deriveProductionDocumentsState` never returns `"missing"`,
since KYB documents are untyped and carry no `NotProvided` status (see
[kyb-lp-verification.md](../product-specs/kyb-lp-verification.md)); frame `6701-98022` stays a
`?state=` preview, unreachable from production data.

There is **no doc-type or subject selector anywhere in this UI** — the epic's 2026-09-21 decision
puts classification in the trustee's review screen (#1267); this page's requirements list
(`kybDocumentRequirements.ts`) is informational text only.

### Per-state presence table

| State | Figma node | Banner | Upload row | Requirements | File rows | Save |
| --- | --- | --- | --- | --- | --- | --- |
| `verify` | `6701-98137` | warning, "Verify your account" | yes | yes | none | disabled |
| `staged` | `6701-98175` | warning, "Verify your identity" | yes | yes | staged (`UploadedFileRow`, removable) | enabled |
| `under-review` | *(no frame — stand-in)* | warning, "Verifying account" | no | no | submitted (`Provided`, "Uploaded" caption, no remove) | absent |
| `missing` | `6701-98022` | negative + tile, "{name} required" | no | no | Verified only (the missing one is in the banner) | absent |
| `invalid` | `6701-97982` | negative, no tile, "Re-upload your document" | no | no | 1 Rejected ("Invalid document" + Re-upload) + Verified | absent |
| `verified` | `6701-98061` | none | no | no | all Verified (decorative chevron) | absent |

Container padding flips with the state (`AccountDocumentsCard.tsx`): `py-4 px-2 gap-4` for the two
upload states (`verify`/`staged` — confirmed uniform top/bottom at the node; a prior pass had this
as asymmetric `pt-4 pb-2`, which was wrong), `pt-4 pb-2 px-2 gap-2` for the banner-over-list states
(`missing`/`invalid`, and the `under-review` stand-in), `p-2 gap-2` for the list-only `verified`
state.

The `<ul>` of `AccountDocumentRow`s (`under-review`/`missing`/`invalid`/`verified`) itself carries
`gap-2` (8px) — confirmed at `6701-98099` (verified frame): each row's own `p-2` plus this 8px gap
reproduces the frame's ~24px dead space between consecutive rows. A prior pass left the `<ul>`
without a gap, which under-spaced rows to 16px (issue #1291).

### The "under review" stand-in (no designed frame)

Confirmed across all six Account frames — there is no designed "under review" state on this panel.
It exists only on the **home** dashboard (`6701-98417`: "Veryfying account…" / "We are reviewing
your documents." / `View Status`), and that card's CTA navigates *into* this page, so a returning
LP under review does land here and must see something. The stand-in is built from designed parts
only: the warning banner chrome from `6701-98137`, title `Verifying account`, caption `We are
reviewing your documents.` (verbatim from the home card, correcting its "Veryfying" typo per the
#1248 design-file-artifact precedent), the submitted files with the `Uploaded` caption and no
remove control, no upload row, no Save. Logged as a designer ask (tech debt).

**The declined stand-in (#1426, also no designed frame).** A `Failed` kyb_status reuses the same
`under-review` banner slot with `failed` set: negative tone, `WarningTriangleIcon`, title
`Account verification declined`, caption `Your account is frozen and cannot be changed.` There is
no designed Account frame for a declined verdict either (decision 5 of the #1426 exec plan) — the
Account column holds only `6701-98137`, `6701-98175`, `6701-97942`, `6701-98061`, `6701-98099`,
`6701-97982`, `6701-98022`. The same situation reaches the page a second way: a `Failed` verdict
suspends the account (`accounts.status = 'Suspended'`), so every bearer request 403s with
`account_suspended` and the read never reaches `readState: "loaded"`. `useAccountPage` keys that
403 on the payload's `account_suspended` string (not the bare status, so an unrelated 403 keeps
today's behaviour) and renders the already-shipped stand-in copy,
`Your account verification was declined. Profile and document changes are unavailable.`, in the
read-error block with its `Retry` button suppressed — retrying a terminal refusal can never
succeed. **Since #1465 this is a defensive fallback, not the realistic path**: the same
`account_suspended` 403 fires the global `subscribeSessionEnded` seam
(`docs/frontend/auth-components.md#session-module`), which signs the LP out and lands them on `/`
before `/account` can render this branch — it stays shipped and tested for a tree mounted without
the root subscriber (today, component tests) or a future authenticated call site the header sniff
does not recognise. The `kyb_status === "Failed"` banner above is unit-testable only, since the
suspension makes the read itself unreachable in a running app (tracked as tech debt alongside the
home-route unobservability note in
[home-screen-states.md](../product-specs/home-screen-states.md)).

## Verbatim copy

Page chrome: `Account` · `Link Wallet` (`Connect Wallet` when linking cannot happen) · `Wallet` · `USDC balance` ·
`Disconnect` · `Corporate email` · `Email` · `Add email` · `Documents` · `Log Out`.

Banners: `Verify your account` · `Verify your identity` (staged state only — a design-file
inconsistency, see below) · `Verifying account` (stand-in) · `Upload your company documents to
unlock bank transfers.` · `{Document name}` + ` required` (two-span composite) · `Please upload
the document.` · `Re-upload your document` · `Some information may be missing or incorrect`.

Settlement bank account: `Settlement bank account` · `Not added` · `Add` · `Replace` · `Cancel` · the captions and field
labels in [Settlement bank account](#settlement-bank-account-1885).

Upload area: `Upload documents` · `pdf, jpg, png files up to 10MB` · `Upload` · `Save`.

Requirements list — lead line `Requirement documents:`, then a disc list of six items, the last
owning a nested lower-alpha list of two:

```
Certificate of Incorporation
Registry of Legal Entities
Certificate of Good Standing
Legal Address
Shareholder Register
Personal KYC for each shareholder / UBO:
    a. Government-issued ID.
    b. Proof of Address (bill, bank or credit card statements)
```

The first five are the five company-document labels inlined directly into
`KYB_DOCUMENT_REQUIREMENTS` (`kybDocumentRequirements.ts`, #1278 — previously imported from the
now-deleted `useCompanyDocsModal.ts`'s `COMPANY_DOCUMENT_SLOTS`). Per-file captions: `Verified` ·
`Uploaded` · `Invalid document` · `Re-upload`.

**`6701-98137` says "Verify your account"; `6701-98175` says "Verify your identity"**, with an
identical caption and identical styling — nothing about the user's situation changes between the
two frames. Treated as a design-file inconsistency (the #1248 artifact precedent) and shipped
verbatim per-frame; logged as a designer ask.

**Preview fixtures never ship the frames' placeholder filenames** (`bill.pdf.pdf`,
`provide_government.pdf.pdf`, `dfvfv.pdf`, the trailing `" · "` on
`certificate_of_good_standing.pdf`) — those are scratch data in the design file. Clean names are
used instead (e.g. `certificate-of-incorporation.pdf`).

## Figma → token mapping

| Figma | Value | Repo token |
| --- | --- | --- |
| `bg/primary` | `#f8f7f6` | `--color-pipeline-paper` |
| `bg/secondary`, `fill-test/on-primary` | `#ffffff` | `--color-pipeline-surface` |
| `fill-test/primary` (circles, tab track) | `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` |
| `fill/warning-secondary` (verify banner) | `rgba(211,235,117,0.16)` | `--color-pipeline-promo` |
| `fill/negative-secondary` (error banners) | `rgba(178,0,0,0.16)` | `--color-pipeline-negative-secondary` |
| `fill-test/primary` (leading tiles: wallet/email/upload) | `rgba(191,189,187,0.12)` | `--color-pipeline-fill-muted` (corrected by #1458 — see below) |
| `border-test/secondary` | `rgba(56,55,53,0.18)` | `--color-pipeline-line` |
| `content-test/primary` | `#262524` | `--color-pipeline-ink` |
| `content-test/secondary` | `rgba(56,55,53,0.6)` | `--color-pipeline-ink-muted` |
| `content-test/positive` ("Verified") | `#208000` | `--color-pipeline-positive-strong` |
| `content-test/negative` ("Invalid document") | `#b20000` | `--color-pipeline-negative-strong` |
| `radius/radius-s` | 4 | `--radius-pipeline-card` |
| `radius/radius-xl` (tab track) | 6 | `--radius-pipeline-card-sm` |
| `radius/radius-full` (72px circles) | 240 | `--radius-pipeline-pill` |
| Heading "Account" | Besley 28/36 | `--text-pipeline-heading-m` |
| Body / row title | 16/22 | `--text-pipeline-body` |
| Caption | 12/16 | `--text-pipeline-caption` |
| Requirements list | 14/18 | `--text-pipeline-body-s` |

**The verify banner fill is the pale olive `promo` tint, not a positive-green** — the Issue body
calls it "green"; `--color-pipeline-promo` (`#f8fce9`, itself documented as "solid equivalent of
`rgb(211 235 117 / 0.16)` on white") matches exactly, since the banner sits on a white card. QA
should not file this as a colour defect.

**The flat upload row's trailing `Upload` button (`AccountUploadRow.tsx`) carries a
`border border-[color:var(--color-pipeline-line)]` override on `Button variant="secondary"
size="compact"`** — confirmed at both `6701:98157` (verify) and `6701:98195` (staged); a prior pass
shipped it borderless. This is the same override `DocumentUploadRow.tsx` already uses for its own
`Upload` button. The banner's own inline `Upload` action (the `missing` state,
`AccountStatusBanner`'s `action` prop) has **no** border — confirmed at `6701:98040` — so that one
stays as `Button variant="secondary" size="compact"` with no extra className. **That same button
does carry the touch-target wrapper** — `get_metadata` at `6701:98040` shows `ButtonCont` (node
`I6701:98040;8926:10405`) at `x=351 w=83 h=40` containing the 75×32 `button` at a 4px inset,
identical geometry to `AccountUploadRow`'s own wrapper — so `AccountStatusBanner` wraps its
`action` button in the same `flex items-center justify-center p-1` container (issue #1294).

**The `invalid` state's per-row `Re-upload` action (`AccountDocumentRow.tsx`) is a borderless,
text-only `Button variant="secondary" size="compact"`, wrapped in the same `p-1` touch-target
convention** — confirmed via `get_metadata` at `6701:98001` (the `dfvfv.pdf` row): `ButtonCont`
(node `I6701:98001;8902:3622`) at `x=349 w=107 h=40` containing the 32-tall `button` at a 4px inset
on every side, and `get_design_context` shows no `bg-*`/`border` class on that `button` node —
`secondary`'s own `bg-transparent` with no border already matches. Text color is
`content-test/secondary` (ink-muted), not `secondary`'s default ink, so the row overrides with
`!text-[color:var(--color-pipeline-ink-muted)]` — the `!` is required for the same specificity
reason as `Log Out`'s `!bg-` override above. A prior pass rendered this as a bare unstyled `<button
px-1>` with no touch-target wrapper (issue #1295). The `invalid` banner itself (`6701:98000`) has
**no** trailing action — confirmed no `ButtonCont`/button node in its subtree, unlike the `missing`
banner's inline `Upload`.

**The 40×40 leading tiles (wallet row, email row, upload row) are `fill-test/primary` =
`rgba(191,189,187,0.12)` → `--color-pipeline-fill-muted`.** `get_design_context`'s codegen emits a
stale `bg-[var(--fill-test/primary,#262524)]` literal for all three tiles (same class as #1251's
`content-test/primary` finding); #1284 read the tile as a pale navy tint from a screenshot sample
and shipped `--color-pipeline-brand-secondary`. #1458 resolved the binding live with
`get_variable_defs` on `7129:15860` and `6701:98112` (both `#bfbdbb1f`) and corrected
`AccountIconTile` to `--color-pipeline-fill-muted` — the same token the circles and the tab track
already use. Only the icon's own color varies — ink for envelope/wallet, solid
`--color-pipeline-brand` navy for the upload glyph (`AccountUploadRow.tsx`'s `FileUploadIcon`,
`currentColor`). The upload icon is a second stale-codegen spot (issue #1292): the raw exported
`file-upload` SVG asset hardcodes `fill="#8FB3A4"` (sage green) with no `currentColor`, but
`get_variable_defs` on this frame resolves a bound `content-test/brand: #000080` variable — exactly
`--color-pipeline-brand` — and the screenshot shows a solid navy icon, not sage; the asset's baked
fill is stale, not the target.

## Reuse verdicts

| Piece | Verdict |
| --- | --- |
| `kybFileValidation.ts` (`isAcceptedFile`, `MAX_FILE_BYTES`) | **Reused verbatim.** `{pdf, jpeg, png}` + 10 MB is exactly the frame's rule. |
| `UploadedFileRow.tsx` | **Reused, with an additive `className` prop** (issue #1293) — 40×40 leading tile, title/caption order, and the 32×32 cross-circle remove control are exactly what the frame shows. The leading element is a glyph tile rather than a rendered PDF thumbnail (TD-63, pre-existing, not new debt here). Second consumer: `CompanyDocsModal` (#1278, no `className`). |
| `SegmentedTabs` (`@pipeline/ui`, `variant="track"`) | **Not used by the wallet card (#1512)** — its track styling is reproduced by the static chain block; the component stays in `@pipeline/ui`. |
| `COMPANY_DOCUMENT_SLOTS` | **Retired (#1278).** The five labels are now inlined directly into `KYB_DOCUMENT_REQUIREMENTS` (`kybDocumentRequirements.ts`); the `{ id, label }` tuple and `CompanyDocumentSlotId` type had no other purpose once the raw-upload model dropped per-slot structure everywhere. |
| `FileDropZone.tsx` | **Deleted (#1278).** There is no dashed drop zone anywhere in V1.0; the "flat upload area" is a plain list-item row (tile + text + bordered secondary `Upload` button), which `AccountUploadRow.tsx` implements directly. No sub-issue of epic #1247 gained a consumer for it. |
| `KybInfoBanner.tsx` | **Deleted (#1278).** It is a neutral white surface with centred single-line text and a tooltip; the frames need a tinted, bordered, 72px two-line banner with a 32px status icon and an optional trailing button (`AccountStatusBanner.tsx`) — a rewrite, not a variant. No sub-issue of epic #1247 gained a consumer for it. |
| `AccountUploadRow.tsx` / `AccountRequirementsList.tsx` | **Second consumer added (#1278).** Both gained additive optional `dataNodeId`/`testId` props (and `AccountRequirementsList` gained `className`, default `"px-2 pb-6"`) whose defaults reproduce this page's DOM byte-for-byte — `AccountDocumentsCard.test.tsx` is the regression guard. `CompanyDocsModal` passes its own node ids and, for the requirements list, `className="px-2"` (no bottom padding — its card supplies the gap instead). |
| `useAccountDocuments` | **Second consumer added (#1278).** `CompanyDocsModal` calls it as `useAccountDocuments({ onSave: onSubmit })` — the same `{ files, rejected, addFiles, removeFile, canSave, handleSave }` surface this page uses. Since #1572 both consumers also share `reconcileUploads.ts` (`reconcileUploadedDocuments` + `reconciliationMessage`), so the uncertain-upload rule below is one implementation. |

## Production actions and remaining seams

`useAccountPage` fetches the LP, keeps the saved profile baseline separate from the input draft,
and coordinates full-replace profile writes, ordered file uploads, and id-based deletion. A
document Save uploads staged files and does not save an existing LP's unsaved profile draft. For a
404 LP it first creates the valid profile using the session email. A failed network upload is
reconciled against newly returned document ids before retry (the pure `reconcileUploadedDocuments`
in `components/account/reconcileUploads.ts`, shared with `CompanyDocsModal` since #1572); if
reconciliation fails, retry is blocked until Check uploads succeeds. During that read, file selection and staged removal are
locked. If new server documents and staged files share a duplicate filename, the page keeps all
ambiguous staged copies and blocks retry. The LP must explicitly discard those staged copies,
review the returned documents, and select any missing files again. Rejected rows use Re-upload to delete the rejected original,
then the visible upload controls accept the correction. Provided rows on writable LPs have a
remove button; Verified and frozen rows do not.

`AccountWalletCard`'s Link Wallet / Disconnect and the route's Log Out remain wired to the
shared wallet and auth flows. `AccountDocumentsCard.onUploadMissingDocument` exists only for the
synthetic `missing` preview. Review submission changes KYB only through the backend endpoint; its
server response determines the displayed status and freezes controls.

## `?state=` preview contract

`routes/account.tsx`'s `validateSearch` parses `state` via `parseAccountStatePreview`, which
accepts only the six `AccountDocumentsState` ids and returns `undefined` for anything else
(missing, empty, unknown, or non-string). When set, it **overrides** `deriveDocumentsState`'s
output and feeds `AccountDocumentsCard` from `ACCOUNT_STATE_PREVIEWS[state]` (a `{ kybStatus,
documents, missingDocumentName? }` fixture with clean filenames); for `state=staged` specifically,
`createPreviewStagedFiles()` also seeds `useAccountDocuments`'s local staging state with a handful
of empty-content `File` objects so the real removable-row / enabled-Save behavior renders exactly
as it would live. With no `state` param the page reads the LP API.
`validateSearch` only calls `parseAccountStatePreview` when `ENV.IS_DEV` (#1362) — the route guard
itself now admits authenticated production LPs too, so the preview override needs its own explicit
`ENV.IS_DEV` check rather than inheriting dev-only-ness from route access.

Preview links live in the existing `/test?tab=auth` block (`routes/test.tsx` → `AuthTab`) — one
link per state, alongside the six existing modal triggers. See [Diagnostics preview
seam](./auth-components.md#diagnostics-preview-seam).

## Out of scope

| Concern | Owner |
| --- | --- |
| Home page KYB orchestration and wallet linking | #1254 |
| Wiring sign-in / create-account / OTP to real auth | #1265 |
| Header auth buttons, the account icon | #1362 (shipped — this doc's [Route gate](#route-gate)), extended to wallet-only visitors by #1458 |
| The Add email screen itself and the OTP hand-off | #1459 (shipped — `AddEmailModal`, see [`auth-components.md#addemailmodal`](./auth-components.md#addemailmodal)) |
| The home grid for a wallet-only visitor (home state 7) | #1460 — `deriveHomeState` is untouched; a wallet-only visitor keeps rendering the zero-state grid on `/` (see [home-screen-states.md](../product-specs/home-screen-states.md)) |
| The home card states, composite Total Balance, merged activity feed | #1282 |
| The redesigned onboarding-time Company Docs modal | #1278 |
| Add Funds wire-transfer modal | #1283 |

`TopBar.tsx`, `MobileNavMenu.tsx`, and `ConnectModalProvider` were not modified by #1284 — #1362
later changed `TopBar.tsx`/`MobileNavMenu.tsx` to add the header auth entry point (see
`dashboard-components.md#topbar`); `ConnectModalProvider` itself is still untouched.
**Update (#1278):** the onboarding-time `CompanyDocsModal` was redesigned to compose
`AccountUploadRow`, `AccountRequirementsList`, and `useAccountDocuments` directly (see
[`auth-components.md#companydocsmodal`](./auth-components.md#companydocsmodal)); `useCompanyDocsModal.ts`
was deleted as part of that redesign.

## Accessibility

The verified-row trailing chevron is `aria-hidden` (decorative, not a button) — no document-detail
frame exists anywhere in V1.0, so it has no destination (tech debt, designer ask). The upload
row's file input is visually hidden (`sr-only`) but reachable via its trailing `Upload` button. The
status banner uses `role="status"`. `Log Out` and `Link Wallet` are real `<button>` elements,
focusable and clickable with no throw even with no handler wired (the inert-seam contract).

`Disconnect` (`AccountWalletCard.tsx`) and `Add email` (`AccountEmailCard.tsx`, issue #1458) are
also real `<button>` elements. `AccountListRow` gained an optional `onActivate` prop (#1458): when
present the root renders as `<button type="button">` instead of a `<div>`, and its inner content
wrapper and the two text nodes render as `<span>` rather than `<div>`/`<p>` so the button's content
model stays valid (a `<button>` cannot contain block-level `<div>`/`<p>` descendants) — no visual
change, since Tailwind preflight already zeroes `<p>` margins. `AccountIconTile` renders a `<span>`
for the same reason (it is used as a `<button>`'s leading icon in the `Add email` row).

## No mobile frames

V1.0 Account frames are desktop-only; the 480px column already behaves as a mobile-friendly single
column. Page padding is `px-4 py-8` below `md`, `md:px-8 md:py-16` above (#1309). Logged as tech debt.
