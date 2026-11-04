# Issue #1825: LP: link the settlement address by signing a challenge (Stellar + EVM)

Source: https://github.com/eq-lab/pipeline/issues/1825 (epic #1247; frontend pair of #1824 / PR #1828 and #1831 / PR #1834, both merged)

Refreshed 2026-11-04 from the 2026-11-02 draft (Issue comment) against `main` at `234822fc`.

## Scope

In scope (LP app, `packages/frontend` only):

1. **API client** (`packages/frontend/src/api/lps.ts`).
   - `LpResponse` gains the four fields `main` already serves: `stellar_signer_address`, `evm_address`, `evm_signer_address`, `evm_address_linked_at` (all `string | null`).
   - New `getLinkAddressChallenge` (`GET /v1/lps/me/link-address/challenge`) and `verifyLinkAddress` (`POST /v1/lps/me/link-address/verify`).
   - `linkMyAddress` is deleted. Its route is gone on `main`, so today's automatic link answers `404` on every signed-in visit with a connected Stellar wallet.
2. **Wallet signing.** `signMessage(message)` is added to the LP app's own wallet hooks (`@/wallet`): `useStellarWallet` (SEP-0053 via `StellarWalletsKit.signMessage`) and `useEvmWallet` (EIP-191 via wagmi `useSignMessage`), ported from `packages/wallet-connect`.
3. **Link hook.** `useSettlementAddressLink` stops being an on-load effect. It becomes an imperative, click-only flow: challenge, then `signMessage`, then verify, for both chain kinds. It has a confirmation step before a change of an already linked address.
4. **Writability follows #1831.** `settlementWritable(lp)` refuses only `Failed`. A `Passed` LP can link, prove a legacy unproven address, and change its address.
5. **Settlement rows.** The single read-only Stellar row becomes **one row per chain kind**. A row can carry `Link wallet`, `Change wallet` or `Try again`, and an inline change confirmation that names the old and new address. The rows render on the Account page (`AccountProfileCard`) and in `CompanyDocsModal`.
6. **Docs, user stories and tech debt** for the above.

Out of scope:

- **A Stellar `C…` settlement address, or any signer other than the connected wallet** (multisig, Safe). The LP app links **only the connected wallet**, as both the address and the signer. `signer_address` is never sent, and the backend defaults it to the address. The API supports both cases, so this is a UI gap. It is logged as **TD-165**. TD-163 is now taken by #1831's relink trade-off, so the draft's "TD-163" is renumbered.
- **Unlinking an address.** No endpoint exists.
- **Wallet-only visitors** (no session). They have no LP, so nothing links.
- **Re-pointing `@/wallet` at `@pipeline/wallet-connect`** (TD-35).
- **Filtering wallets without SEP-0053 out of the LP connect modal** (Albedo, Rabet). See Risks.
- **Trustee** display of signer and unproven state (#1826, merged). `packages/trustee` is untouched.
- **Funding details** (#1817). `FundingDetailsModal`'s not-linked notice already says "Link it on your Account page", which this issue makes true. That copy stays unchanged.

## Decision log

| # | Decision | Why |
|---|---|---|
| D1 | **No Figma** (user, 2026-11-04). The rows, buttons, captions and the inline confirmation are built from the existing `SettlementAddressRow` (`AccountListRow variant="plain"` + body-s caption) and LP theme tokens on both surfaces. There is no `needs-figma` label and no design open question. | User decision on the Issue. |
| D2 | Signing lives in `packages/frontend/src/wallet/{stellar,evm}`, not `@pipeline/wallet-connect`. | The LP app mounts its own providers from `@/wallet` (`main.tsx`). The shared package's hooks read their own Stellar store and gate context, so they would report "disconnected" here. TD-35 lint also forbids importing wagmi or the kit outside `src/wallet/**`. |
| D3 | Only the connected wallet is linked, and `signer_address` is never sent. `C…` and separate signers go to TD-165. | The draft's decision. `main` does not contradict it. |
| D4 | A signature prompt opens **only** from a click: `Link wallet`, `Try again` or `Confirm change`. No effect fetches a challenge or calls `signMessage`. Connecting a different wallet never starts a change by itself. | Issue § "No silent signature prompts" and § "Relink at any time". |
| D5 | **One row per chain kind.** The order is Stellar, then EVM. A kind gets a row when its address is served or a wallet of that kind is connected. With neither, there is one generic row. Labels: `Stellar settlement address`, `Ethereum settlement address`, and `Settlement address` (generic). | The LP holds at most one wallet connection (#1512), but can hold both served addresses. `Ethereum` matches the Account wallet card's chain label. |
| D6 | **Connected wallet** = the EVM wallet if connected, else the Stellar wallet, else none. This mirrors `useWalletView().kind`. `chain_id` = `ENV.EVM_CHAIN_ID` or `ENV.STELLAR_CHAIN_ID`. `useActiveChain()` is not used, because `AuthFlowProvider` sits above `WalletViewProvider` in `main.tsx`. | Single-wallet rule. Provider order. |
| D7 | EVM addresses are sent lowercased, and compared case-insensitively. Stellar addresses are compared verbatim. | The backend stores EVM addresses lowercase (`validate_evm_address`). |
| D8 | **"Change wallet"** appears on a row whose served address differs from a connected wallet of the same kind, while the LP is not `Failed`. Clicking it does not prompt the wallet. It opens an **inline confirmation inside the row**: a `From` line with the served address and a `To` line with the connected address, both full and wrapping, plus the caption and the `Confirm change` / `Cancel` buttons. Only `Confirm change` starts the signed flow. The confirmation applies at every status, not only `Passed`. | Issue § "Relink at any time" asks for a confirmation that names the old and new address. An inline step avoids opening a modal on top of `CompanyDocsModal`. Using one rule for every status keeps it simple. |
| D9 | When a served row has no connected wallet of its kind, it shows the address with no caption and no button. A change needs the new wallet connected, and the wallet card's `Disconnect` / `Connect Wallet` is the way there. | A button that cannot act would mislead. |
| D10 | **Legacy unproven** (served address equals the connected one, its signer is `null`, not `Failed`) offers `Link wallet` with an explanatory caption, at any status including `Passed` (#1831 supersedes #1829). There is no confirmation, because the address does not change. | `kyb-lp-verification.md` § Existing unsigned addresses. |
| D11 | **Errors.** <br>• Wallet throw (rejection, wallet without SEP-0053, mock wallet): no verify request, no toast, neutral `declined` caption, and the row's base action is offered again. <br>• `422`: `proofFailed` caption (negative) and `Try again`, no toast. <br>• `409` on challenge or verify: danger toast with the served message, re-read `getMyLp()` and adopt it, then `taken` unless the refreshed LP is `Failed`. <br>• Anything else (400, 404, 5xx, network): toast with the served message or `Your wallet could not be linked.`, then `error` with `Try again`. <br>• `401` and `403` stay on the app-wide session-end path. | Issue § Errors. The backend consumes the challenge before linking, so a 5xx may have spent it. |
| D12 | **Every `Try again`, and every new `Link wallet` click, starts with a new `GET …/challenge`.** The client never caches or reuses a message. `Try again` after a failed change skips the confirmation, because the user already confirmed this pair. Any change of the connected wallet or token resets the row. | The backend reuses a live nonce or issues a fresh one. Either way the client signs exactly what was just served. |
| D13 | **Single flight.** One flow runs at a time, guarded by an `inFlight` ref. The row shows no button while busy. A response that arrives after the session token changed is dropped. | The same guard as today. |
| D14 | **Before the LP exists** (`lpRead === "absent"`), a connected wallet's row shows `—` and a `needsLp` caption, with no button. Once `POST /v1/lps/me` is adopted, it turns into `Link wallet`. | Linking needs an LP (`404` otherwise). The old "Linked when you submit" no longer holds. |
| D15 | The `account-page.md` section is renamed from `## Settlement address (#1813)` to `## Settlement address` (anchor `#settlement-address`), and every pointer is updated. | It is now a multi-issue section. A stable anchor stops the churn. `lint-docs` does not validate anchors, so the coder updates them by grep. |
| D16 | **Copy** (stand-in, exported as `SETTLEMENT_CAPTIONS`; see step 5). | The no-Figma decision makes the copy a development decision. |

## Assumptions and Risks

- **Dependencies are merged.** #1824 (PR #1828) and #1831 (PR #1834) are on `main`. The branch is cut from `main`. Until this ships, the deployed LP app's auto-link hits `404`. It shows the error toast once per `(lp, address)` per token, which is a visible regression today and a reason to ship promptly.
- **User activation.** An `await` on `GET …/challenge` sits between the click and the wallet prompt. Freighter, xBull, LOBSTR and the wagmi injected and WalletConnect connectors do not need a live gesture. Albedo is popup-based but cannot sign messages anyway. If QA sees a blocked popup, the follow-up is to prefetch the challenge. That is not part of this plan.
- **Wallets without SEP-0053** (Albedo, Rabet) are still listed in `packages/frontend/src/components/ConnectWalletModal.tsx`. An LP on one of them sees the neutral `declined` caption and cannot link. This is recorded in the user stories.
- **Mock wallets cannot sign.** `signMessage` rejects on the `pipeline.mock.wallet.*` path. QA needs real Freighter and MetaMask wallets.
- **Lint-comments baseline.** `packages/frontend/src/wallet/evm/useEvmWallet.ts` (header 7) and `packages/frontend/src/wallet/stellar/useStellarWallet.ts` (header 19) are in `scripts/lint-comments.baseline.json`. Touching them means:
  - replacing each header docblock with a one-line `// spec:` pointer to the wallet README section;
  - deleting the field and function JSDoc in both files (the README already holds the substance; add anything missing there);
  - removing both baseline entries with `npx tsx scripts/lint-comments.ts --update-baseline`. Commit the shrunk baseline.
- **Type churn.** The four new `LpResponse` fields are required. Every frontend `LpResponse` fixture must add them:
  - `auth/useSettlementAddressLink.test.tsx`
  - `auth/AuthFlowProvider.setup.test.tsx`
  - `components/CompanyDocsModal.test.tsx`
  - `components/account/useAccountPage.test.tsx`
  - `components/account/settlementAddress.test.ts`
  - `routes/-account.test.tsx`
  - `api/lps.test.ts`

  A `@/wallet` stub typed as `WalletState` or `StellarWalletState` also needs `signMessage`.
- **Security trade-off** (TD-163, accepted by the user): a hijacked session can change the address. The inline confirmation protects only against accidental changes. It is not a security control.

## Open Questions

_None_

## Implementation Steps

Code style follows AGENTS.md. Each new or rewritten file gets one `// spec:` header line and no other comments: no JSDoc, no body or test comments. Tests sit next to their source as `*.test.ts(x)`.

1. **Docs first.** Make the changes listed under "Docs to Update", so the code follows the spec.

2. **`packages/frontend/src/api/lps.ts`.**
   - Add after `address_linked_at`: `stellar_signer_address: string | null; evm_address: string | null; evm_signer_address: string | null; evm_address_linked_at: string | null;`.
   - Add `export interface LinkChallenge { message: string; nonce: string }`.
   - Add `getLinkAddressChallenge(chainId: number, address: string): Promise<LinkChallenge>`:
     - a `GET` on `` `/v1/lps/me/link-address/challenge?${new URLSearchParams({ chain_id: String(chainId), address })}` ``;
     - with `authHeaders()`.
   - Add `verifyLinkAddress(body: { chain_id: number; address: string; signature: string }): Promise<LpResponse>`:
     - a `POST` on `/v1/lps/me/link-address/verify`;
     - with JSON `Content-Type` and `authHeaders()`.
   - Delete `linkMyAddress`.
   - In `packages/frontend/src/api/index.ts`, drop `linkMyAddress` and export the two functions plus `LinkChallenge`. Update `packages/frontend/src/api/README.md` if it lists the calls.

3. **`packages/frontend/src/wallet/stellar/useStellarWallet.ts`.**
   - Add `signMessage(message: string): Promise<{ signature: string }>` to `StellarWalletState`, as a `useCallback` on `[mockAddress, address]`.
   - On the mock path, reject with `Error("[stellar mock] signMessage is not mockable; connect a real wallet")`.
   - Otherwise:

     ```ts
     const { signedMessage } = await StellarWalletsKit.signMessage(message, { networkPassphrase, address });
     return { signature: signedMessage };
     ```

     Here `networkPassphrase` comes from `./chain`. This mirrors `packages/wallet-connect/src/stellar/useStellarWallet.ts` `signMessage`.
   - Replace the header docblock with `// spec: packages/frontend/src/wallet/README.md#usestellarwallet` and delete the interface and function JSDoc.

4. **`packages/frontend/src/wallet/evm/useEvmWallet.ts`.**
   - Add `signMessage(message: string): Promise<{ signature: string }>` to `WalletState`, using `const { signMessageAsync } = useSignMessage()` from `wagmi`.
   - On the mock path, reject with `Error("[wallet mock] signMessage is not mockable; connect a real wallet")`.
   - Otherwise return `{ signature: await signMessageAsync({ message }) }`.
   - Replace the header docblock with `// spec: packages/frontend/src/wallet/README.md#useevmwallet` and delete the remaining JSDoc.
   - Run `npx tsx scripts/lint-comments.ts --update-baseline` and confirm both wallet entries are gone from `scripts/lint-comments.baseline.json`.

5. **`packages/frontend/src/components/account/settlementAddress.ts`** (pure view logic; header `// spec: docs/frontend/account-page.md#settlement-address`).
   - Types:

     ```ts
     export type SettlementKind = "stellar" | "evm";
     export interface ConnectedWallet { kind: SettlementKind; address: string }
     export type SettlementPhase =
       | "idle" | "confirming" | "requesting" | "signing" | "verifying"
       | "declined" | "proofFailed" | "taken" | "error";
     export interface SettlementLinkState { kind: SettlementKind | null; phase: SettlementPhase }
     export type SettlementAction = "link" | "change" | "retry";
     export interface SettlementRowView {
       kind: SettlementKind | null;
       label: string;
       address: string | null;
       caption: string | null;
       tone: "muted" | "negative";
       action: SettlementAction | null;
       confirm: { from: string; to: string } | null;
       busy: boolean;
     }
     ```

   - Helpers:
     - `connectedWallet(evm: { isConnected; address }, stellar: { isConnected; address }): ConnectedWallet | null` returns the EVM wallet first (D6).
     - `servedAddress(lp, kind)`.
     - `servedSigner(lp, kind)`.
     - `sameAddress(kind, a, b)` (D7).
     - `settlementWritable(lp) = lp.kyb_status !== "Failed"`. The per-kind rule from #1813 is removed (#1831).
     - `baseAction(lp, kind, connected): "link" | "change" | null` is the single predicate shared by the hook and the derivation. It returns `null` when `lp` is null, when `!settlementWritable(lp)`, or when `connected?.kind !== kind`. Otherwise, with `s = servedAddress(lp, kind)`:
       - `s === null` gives `"link"`;
       - `!sameAddress(kind, s, connected.address)` gives `"change"`;
       - `servedSigner(lp, kind) === null` (unproven) gives `"link"`;
       - anything else gives `null`.
   - `SETTLEMENT_LABELS`: `stellar` → `Stellar settlement address`, `evm` → `Ethereum settlement address`, `none` → `Settlement address`.
   - `SETTLEMENT_CAPTIONS` (replaces the #1813 set; `pending`, `needsStellar`, `connectStellar`, `fixed` and `fixedNotConnected` are deleted):

     | Key | Text | Tone |
     |---|---|---|
     | `linking` | `Linking your connected wallet…` | muted |
     | `signing` | `Approve the signature request in your wallet.` | muted |
     | `confirm` | `Deposits processed after the change are minted to the new address.` | muted |
     | `declined` | `Your wallet did not sign. Nothing was changed.` | muted |
     | `proofFailed` | `The signature could not be verified. Try again to sign a new request.` | negative |
     | `taken` | `This wallet is already linked to another account. Connect a different wallet.` | negative |
     | `error` | `Your wallet could not be linked. Try again.` | negative |
     | `linked` | `Linked to your connected wallet.` | muted |
     | `unproven` | `Linked without a signature. Sign with this wallet to confirm you control it.` | muted |
     | `different` | `Your connected wallet is not this address.` | muted |
     | `notLinked` | `Link your connected wallet to receive bank deposits to it.` | muted |
     | `needsLp` | `Save your company details first, then link this wallet.` | muted |
     | `connect` | `Connect a wallet to name your settlement address.` | muted |

   - `SETTLEMENT_ACTION_LABELS`: `link` → `Link wallet`, `change` → `Change wallet`, `retry` → `Try again`. The confirmation buttons are `Confirm change` and `Cancel`.
   - `deriveSettlementRows({ lpRead, lp, connected, link }): SettlementRowView[]`.
     - Kinds: those in `["stellar", "evm"]` where `servedAddress(lp, kind) !== null || connected?.kind === kind`.
     - If no kind qualifies, return the single generic row `{ kind: null, label: "Settlement address", address: null, caption: connect, tone: "muted", action: null, confirm: null, busy: false }`.
     - Per row, `s` is the served address, `c` is `connected?.kind === kind ? connected.address : null`, and `base = baseAction(lp, kind, connected)`. The first matching rule wins; unspecified fields are `confirm: null` and `busy: false`.

       | # | Condition | address | caption | tone | action | other |
       |---|---|---|---|---|---|---|
       | 1 | `link.kind === kind`, phase `requesting` / `verifying` | `s` | linking | muted | `null` | `busy: true` |
       | 2 | `link.kind === kind`, phase `signing` | `s` | signing | muted | `null` | `busy: true` |
       | 3 | `link.kind === kind`, phase `confirming`, `base === "change"` | `s` | confirm | muted | `null` | `confirm: { from: s, to: c }` |
       | 4 | `link.kind === kind`, phase `declined` | `s` | declined | muted | `base` | |
       | 5 | `link.kind === kind`, phase `proofFailed` | `s` | proofFailed | negative | `base ? "retry" : null` | |
       | 6 | `link.kind === kind`, phase `taken` | `s` | taken | negative | `null` | |
       | 7 | `link.kind === kind`, phase `error` | `s` | error | negative | `base ? "retry" : null` | |
       | 8 | `s !== null`, `c` same as `s`, `base === "link"` | `s` | unproven | muted | `"link"` | |
       | 9 | `s !== null`, `c` same as `s` | `s` | linked | muted | `null` | |
       | 10 | `s !== null`, `base === "change"` | `s` | different | muted | `"change"` | |
       | 11 | `s !== null` | `s` | `null` | muted | `null` | (D9, and `Failed`) |
       | 12 | `s === null`, `lp === null`, `lpRead === "absent"` | `null` | needsLp | muted | `null` | (D14) |
       | 13 | `s === null`, `base === "link"` | `null` | notLinked | muted | `"link"` | |
       | 14 | otherwise | `null` | `null` | muted | `null` | (`Failed`, LP still loading or read error) |

       `address: null` renders as `—`, as today.

6. **`packages/frontend/src/auth/useSettlementAddressLink.ts`** (rewrite; header `// spec: docs/frontend/account-page.md#settlement-address`).
   - Signature:

     ```ts
     useSettlementAddressLink({ token, lp, lpLoaded, onLp }): {
       state: SettlementLinkState;
       link(kind: SettlementKind): void;
       beginChange(kind: SettlementKind): void;
       cancelChange(): void;
     }
     ```

   - It reads `useStellarWallet()` and `useEvmWallet()` (`address`, `isConnected`, `signMessage`), derives `connected = connectedWallet(evm, stellar)`, and reads `ToastContext` optionally, as today.
   - **The only effect:** reset `state` to `{ kind: null, phase: "idle" }` when `token`, `connected?.kind` or `connected?.address` changes, if nothing is in flight. No effect touches the API or the wallet.
   - **`beginChange(kind)`:** if not in flight and `baseAction(lp, kind, connected) === "change"`, set `{ kind, phase: "confirming" }`.
   - **`cancelChange()`:** if not in flight, set idle.
   - **`link(kind)`** is a `useCallback` that reads current values through a `latest` ref.
     1. Return when any of these holds: `inFlight.current`, `!token`, `!lpLoaded`, `!lp`, or `baseAction(lp, kind, connected) === null`.
     2. Set `inFlight = true` and `{ kind, phase: "requesting" }`. Compute:
        - `chainId`: `ENV.EVM_CHAIN_ID` or `ENV.STELLAR_CHAIN_ID`;
        - `address`: `connected.address`, lowercased for EVM.
     3. `await getLinkAddressChallenge(chainId, address)`. On a throw, go to `fail`.
     4. Token guard: if `readSession()?.token !== token`, finish `idle`.
     5. Set phase `signing`. `await signer.signMessage(challenge.message)`, where `signer` is the wallet hook of `kind`. On a throw, finish `declined`, with no verify request and no toast.
     6. Set phase `verifying`. `await verifyLinkAddress({ chain_id: chainId, address, signature })`. There is no `signer_address` key. On a throw, go to `fail`.
     7. Token guard. Then `onLp(linked)` and finish `idle`.
   - **`fail(error)`:** token guard first, then:
     - `ApiError` 422: finish `proofFailed`.
     - `ApiError` 409: toast the served message. Then `getMyLp()`, token guard, `onLp(refreshed)`, and finish `settlementWritable(refreshed) ? "taken" : "idle"`. If the re-read throws, finish `taken`.
     - Anything else: toast (served message, else `Your wallet could not be linked.`) and finish `error`.
   - **`finish(phase)`** clears `inFlight` and sets `{ kind, phase }`. `idle` sets `kind: null`.
   - Delete the `attempted` key set and the `tick` re-run. There are no automatic attempts left to deduplicate.

7. **`packages/frontend/src/auth/AuthFlowContext.ts` and `AuthFlowProvider.tsx`.**
   - Add `SettlementControls` to `settlementAddress.ts`:

     ```ts
     {
       rows: SettlementRowView[];
       onLink(kind): void;
       onChange(kind): void;
       onCancel(): void;
     }
     ```
   - The context's `settlement: SettlementRowView` becomes `settlement: SettlementControls`.
   - The provider:
     - takes `{ state, link, beginChange, cancelChange }` from the hook;
     - computes `connected = connectedWallet(evm, stellar)` with the hooks it already calls;
     - memoizes `rows = deriveSettlementRows({ lpRead, lp: loadedLp, connected, link: state })`;
     - memoizes `settlement = { rows, onLink: link, onChange: beginChange, onCancel: cancelChange }`;
     - passes `settlement` to `CompanyDocsModal` and the context, as today.

8. **`packages/frontend/src/components/account/SettlementAddressRow.tsx`** (header re-pointed to `#settlement-address`).
   - `SettlementAddressRow` props: `SettlementRowView & Pick<SettlementControls, "onLink" | "onChange" | "onCancel">`.
   - `AccountListRow` gets `caption={label}`. Keep `data-testid="settlement-address-row"` and add `data-kind={kind ?? "none"}`.
   - When `action !== null && kind !== null`, the `trailing` slot gets one `Button variant="secondary" size="compact"`:
     - its label comes from `SETTLEMENT_ACTION_LABELS`;
     - `change` calls `onChange(kind)`, and `link` / `retry` call `onLink(kind)`.
   - The caption line keeps its styling: ink-subtle, or negative-strong with `role="alert"`.
   - When `confirm !== null`, render below the caption a `flex flex-col gap-2 px-2` block:
     - two body-s lines, `From` + `confirm.from` and `To` + `confirm.to`, with `break-all` and the label in `--color-pipeline-ink-muted`;
     - then a `flex gap-2` row with `Button variant="primary-dark" size="compact"` `Confirm change` (calls `onLink(kind)`) and `Button variant="secondary" size="compact"` `Cancel` (calls `onCancel()`).
     - The block has `data-testid="settlement-change-confirm"`, and focus moves to `Confirm change` when it opens.
   - Export `SettlementAddressRows({ settlement }: { settlement: SettlementControls })` from the same file. It renders `settlement.rows.map((row) => <SettlementAddressRow key={row.kind ?? "none"} {...row} onLink=… onChange=… onCancel=… />)` in a `flex flex-col gap-2` wrapper.

9. **`AccountProfileCard.tsx`, `AccountPage.tsx`, `CompanyDocsModal.tsx`.**
   - `settlement?: SettlementControls`. Replace `<SettlementAddressRow {...settlement} />` with `<SettlementAddressRows settlement={settlement} />` in the same slot: below Country, and in the modal's first surface card, still hidden in preview.
   - `AccountPage` passes the context value through, unchanged in shape.

10. **Remove leftovers.** `grep -rn "linkMyAddress\|link-address\"" packages/frontend/src` returns nothing. Only `/challenge` and `/verify` remain.

11. **Run the gates** (Test Strategy). Fix everything before handing back.

## Test Strategy

Vitest, colocated, with all API and wallet calls mocked (`vi.mock("@/api")`, `vi.mock("@/wallet")`, `vi.mock("wagmi")`, and the kit `./config`). No network.

- **`api/lps.test.ts`.** Replace the `linkMyAddress` case:
  - `getLinkAddressChallenge(ENV-like id, "G…")` issues a `GET` on `…/link-address/challenge?chain_id=…&address=G…` with the bearer header and no `signer_address`.
  - `verifyLinkAddress` POSTs the exact JSON body (no `signer_address` key) and returns the LP.
  - A 422 surfaces as `ApiError` 422 and does not publish a session end (same spy as the existing 401 tests).
- **`wallet/stellar/useStellarWallet.test.tsx`.**
  - `signMessage` calls `StellarWalletsKit.signMessage(message, { networkPassphrase, address })` and returns `{ signature }`.
  - On the mock path it rejects without calling the kit.
- **`wallet/evm/useEvmWallet.test.tsx`.**
  - Add `useSignMessage` to the wagmi mock.
  - `signMessage` returns `{ signature }` from `signMessageAsync({ message })`.
  - On the mock path it rejects.
- **`auth/useSettlementAddressLink.test.tsx`** (rewrite). Cases:
  1. **No silent prompt.** Under StrictMode, with a loaded LP and a connected Stellar wallet not linked, there are zero challenge, `signMessage` and verify calls after the effects settle. Same for EVM.
  2. **Stellar happy path.** Challenge with `(ENV.STELLAR_CHAIN_ID, G…)`, then `signMessage(message)`, then verify `{ chain_id, address, signature }` with no `signer_address`, then `onLp`. The phases go `requesting` → `signing` → `verifying` → `idle`.
  3. **EVM happy path.** A checksummed `0xAbC…` is sent lowercased to both calls with `ENV.EVM_CHAIN_ID`.
  4. **Passed LP.** A `Passed` LP can link, prove an unproven address, and change. Only `Failed` makes `link` and `beginChange` no-ops.
  5. **Change.** With a served `G_A` and a connected `G_B`:
     - `beginChange("stellar")` sets `confirming` with no API or wallet call;
     - `cancelChange()` sets `idle`;
     - `beginChange` then `link` runs the flow for `G_B`.
     - `beginChange` is a no-op when the connected wallet equals the served one or is of the other kind.
  6. **Wallet rejection.** No verify call, no toast, phase `declined`. A second `link` makes a new challenge call.
  7. **422 → retry.** Phase `proofFailed`, no toast, no `getMyLp`. The second `link` makes a **second** challenge call. The mock returns a new message, `signMessage` receives that new message, and the phase ends `idle`.
  8. **409 on verify.** Toast with the served message, then `getMyLp` is re-read and adopted, and the phase is `taken`. When the refreshed LP is `Failed`, the phase is `idle`.
  9. **409 on challenge.** Same as 8, and `signMessage` is never called.
  10. **Other errors.** A 500 on verify gives a toast and `error`. The following `link` makes a new challenge call. A network `TypeError` gives the fallback toast text.
  11. **Guards.** A double click makes one challenge call. `link` is a no-op with no token, no LP, a disconnected kind, a linked-and-proven address, or a `Failed` LP.
  12. **Token change mid-flight.** The response is dropped, `onLp` is not called, and the phase is `idle`.
  13. **Reset.** Changing the connected address resets `declined`, `proofFailed` and `confirming` to `idle`.
- **`components/account/settlementAddress.test.ts`.**
  - Table-test `settlementWritable` across all six statuses.
  - Table-test `baseAction` across status × served/unserved × same/different × proven/unproven × kind, including EVM case-insensitive equality.
  - Table-test `connectedWallet` with EVM precedence.
  - Test every `deriveSettlementRows` rule, 1–14, plus:
    - the generic row;
    - two rows when both kinds are served;
    - a phase scoped to `link.kind` leaving the other row unaffected;
    - `confirm` only while `confirming`.
- **`components/account/AccountProfileCard.test.tsx`** and **`components/CompanyDocsModal.test.tsx`.**
  - One row per view, with `label` as the caption.
  - The `Link wallet`, `Change wallet` and `Try again` buttons call the right handler with `kind`.
  - The confirmation shows the `From` and `To` addresses, `Confirm change` calls `onLink(kind)`, and `Cancel` calls `onCancel`.
  - A row without an action has no button, and a busy row has none either.
  - A negative caption has `role="alert"`.
  - The modal hides the rows in preview.
- **`auth/AuthFlowProvider.setup.test.tsx`.** Replace the "#1813" block:
  - Sign-in with a connected Stellar wallet makes no challenge call and shows `Link wallet`.
  - A click runs challenge, sign and verify, and the row then shows the served address with `Linked to your connected wallet.`.
  - With no LP yet, the row shows the `needsLp` caption and no button.
  - Update the fixtures.
- **Fixture updates** for typecheck: every file listed under Type churn.

Gates, run from the repo root. All must pass:

```bash
yarn workspace @pipeline/frontend lint
yarn workspace @pipeline/frontend exec tsc -b
yarn workspace @pipeline/frontend build
yarn workspace @pipeline/frontend test
npx tsx scripts/lint-docs.ts            # 0 errors
npx tsx scripts/lint-comments.ts        # both wallet-hook baseline entries removed
```

Manual QA uses real wallets only: `docs/user-stories/epic-1247/1825-signed-settlement-link-ui.md` against staging.

## Docs to Update

- **`docs/frontend/account-page.md`.**
  - Rename `## Settlement address (#1813)` to `## Settlement address` (D15).
  - Rewrite the section:
    - the sources (user docs onboarding, `kyb-lp-verification.md` § Settlement Address, `routes/lp_settlement_address.rs`);
    - the challenge → sign → verify flow and the click-only trigger (D4);
    - the connected wallet only (D3, D6, D7);
    - the per-kind rows (D5);
    - the row rule table and caption table from step 5;
    - the action labels and inline confirmation (D8);
    - the error handling (D11, D12);
    - legacy unproven (D10);
    - the "No Figma frame; built from the theme (user decision 2026-11-04)" note.
  - Delete the #1813 auto-link "Who links", "Serialization" and "Out of scope: EVM / TD-57" paragraphs.
  - Fix the `## Page composition` line, which says "read-only settlement address row", and the `## Wallet-only variant` sentence. It becomes: "with a session the LP can link it from the settlement row, see [Settlement address](#settlement-address)".
- **`docs/frontend/auth-components.md`.**
  - In § CompanyDocsModal, the "Settlement row (#1813)" paragraph: `settlement` is now `SettlementControls` and renders `SettlementAddressRows` with buttons.
  - In § AuthFlowProvider, the "Settlement address link (#1813)" paragraph: the provider no longer links on its own. It exposes `settlement = { rows, onLink, onChange, onCancel }` from `useSettlementAddressLink`.
  - Re-point both anchors to `account-page.md#settlement-address`.
- **`docs/frontend/hooks.md`.** Update the `useSettlementAddressLink` row: the return shape `{ state, link, beginChange, cancelChange }`, the challenge and verify endpoints, click-only, and the anchor.
- **`packages/frontend/src/wallet/README.md`.**
  - Add `signMessage(message)` to the `useEvmWallet()` (EIP-191 `personal_sign`) and `useStellarWallet()` (SEP-0053) field tables and code snippets.
  - Note that it rejects on the mock path.
  - Absorb any substance from the deleted JSDoc.
- **`docs/user-stories/epic-1247/1825-signed-settlement-link-ui.md`** (new; header `Spec:` → `account-page.md#settlement-address` and `kyb-lp-verification.md#settlement-address`). Stories:
  1. No prompt on sign-in or page load.
  2. Link Stellar by button (Freighter).
  3. Link EVM by button (MetaMask). The row shows the lowercase address.
  4. Decline in the wallet: the neutral caption, and the address is unchanged.
  5. Change wallet: the confirmation shows `From` / `To`, `Cancel` makes no request, and `Confirm change` relinks, at `InProgress` and at `Passed`.
  6. 422: open the Account page in two tabs, click `Link wallet` in both, approve tab B first, then tab A. Tab A shows `proofFailed`, and `Try again` succeeds.
  7. Address taken (409): toast, then the row is re-read.
  8. Legacy unproven address relinked by signing.
  9. LP not yet created: the `needsLp` caption, then `Link wallet` after Save.
  10. `Failed` LP: no buttons.
  11. A wallet without SEP-0053 (Albedo or Rabet) shows the neutral caption.
  12. Both the Stellar and EVM addresses are served: two rows.
- **`docs/user-stories/index.md`.**
  - Add the #1825 row.
  - Change the #1813 row's status to "Superseded by #1825 (auto-link removed; linking is signed and user-initiated)".
- **`docs/user-stories/epic-1247/1813-link-wallet-address.md`.** Add a one-line "Superseded by #1825" note under the header and re-point its `Spec:` anchor.
- **`docs/exec-plans/tech-debt-tracker.md`.** Add **TD-165: the LP app links only the connected wallet**.
  - It cannot name a Stellar `C…` settlement address or a separate signer (multisig, Safe), though the API supports both (#1824). The UI would need address and signer inputs.
  - This issue logs it.
  - Bump "Next free number" to TD-166.
- **No product-spec change.** `docs/product-specs/kyb-lp-verification.md` § Settlement Address and `api-authorization.md` already describe the contract, including #1831. `docs/user-docs/lenders/onboarding.md` ("You can change it at any time by signing with the new wallet") stays accurate.
