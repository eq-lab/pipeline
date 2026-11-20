# Issue #1849: LP: link a Stellar C… contract address or a separate signer as the settlement address (TD-166)

Source: https://github.com/eq-lab/pipeline/issues/1849

Part of epic #1247. Follow-up to #1825 (PR #1846, plan `docs/exec-plans/completed/issue-1825-signed-settlement-link-ui.md`, D1–D18). Branch `feat/1849-settlement-address-signer` from `main`, PR #1850.

## Scope

**In scope (LP app, `packages/frontend`):**

- An opt-in **"Use a different address"** path on each settlement row (Account profile card and `CompanyDocsModal`): the LP types a settlement address that is not the connected wallet; the connected wallet signs as `signer_address`.
  - Stellar: a `G…` or `C…` address; the signer is the connected `G…` wallet (required by the backend for `C…`, optional for `G…`).
  - EVM: a `0x…` address (e.g. a Safe); the signer is the connected EOA.
- `getLinkAddressChallenge` / `verifyLinkAddress` send `signer_address` only when it differs from the address.
- Client-side **format-only** validation (Stellar Strkey `G…`/`C…`, EVM `0x` + 40 hex). The backend stays the authority (400 / 409 / 422).
- A **Signer** line on a linked row whose served signer differs from its address, and a correct caption when the connected wallet is the signer of a served address it is not.
- #1825's connected-wallet path (`Link wallet`, `Change wallet`, `Try again`, inline From/To confirmation) is unchanged and remains the default.
- Docs: `account-page.md#settlement-address`, `auth-components.md`, `hooks.md`, wallet README, new user-stories doc, TD-166 resolved.

**Out of scope:**

- A free-form signer input (see D3): the signer is always the connected wallet.
- EIP-1271 / smart-contract-wallet signers: the backend verifies EVM signatures with EIP-191 `ecrecover` only (`shared::signature::verify_personal_sign`), so the signer must be an EOA.
- Proving that the signer controls the address (backend TD-162), unlinking, Trustee UI, backend changes.
- `docs/product-specs/kyb-lp-verification.md` (124 lines): its § Settlement Address already states the rules this UI uses (`C…` needs a `G…` signer; `G…`/`0x…` may name a different signer; EOA signer). The LP-facing rule does not change, so the spec is not edited.

## Decision log

No Figma (user decision, 2026-11-05, on the Issue): every UI decision below is made in development from the existing form fields (`TextField` as used in `CompanyDocsModal`) and LP theme tokens, on both surfaces. No `needs-figma` label.

| # | Decision | Why |
|---|---|---|
| D1 | **No Figma.** Inputs, validation captions, the form block and the Signer line are built from `@pipeline/ui` `TextField` (with the company-docs modal's `[&>div:not(:focus-within)]:border-[color:var(--color-pipeline-line)]` class), `Button` (`primary-dark` / `secondary`, `size="compact"`), the row's body-s caption styles and LP tokens. | User decision on the Issue. |
| D2 | **Entry point: a text-link button `Use a different address`** under the row's caption (body-s, `--color-pipeline-ink`, `hover:underline`, focus-visible outline — the `Log in` button in `CreateAccountModal.tsx` is the precedent), left-aligned at the row's `px-2`. Shown when the LP is loaded and writable (not `Failed`), a wallet of this row's kind is connected, and the row is not busy, confirming or already showing the form. Never on the generic `Settlement address` row and never on `needsLp`. | Keeps the connected-wallet button as the single primary action (default path unchanged); the override is visibly secondary and opt-in. |
| D3 | **The signer is always the connected wallet, shown read-only.** No signer input. The form shows `Signer` + `truncateAddress(connected)` (full value in `title`). To use another signer the LP connects that wallet. | Only the connected wallet can sign here (#1825 pinned-signer rule: the challenge's `signer_address` must equal the wallet passed to `signMessage`). An editable signer that is not connected could never produce a valid signature. Satisfies the Issue's "the connected wallet by default". |
| D4 | **`signer_address` is sent only when the typed address differs from the connected wallet** (`sameAddress(kind, …)`). Typing the connected wallet's own address is the default link (no `signer_address`). | Matches the backend default (signer = address) and keeps the default-path request shape byte-identical. |
| D5 | **Normalization.** Stellar input: `trim()` + `toUpperCase()` (the backend does the same). EVM input: `trim()` only, sent **as typed**, so the backend's EIP-55 check rejects a mistyped mixed-case checksum (400). The EVM signer (connected wallet) is sent lowercased as in #1825 D7. The same strings go to challenge and verify. | Lowercasing typed EVM input would silently disable the checksum protection. The backend lowercases before storing and comparing, so challenge/verify still match. |
| D6 | **Format-only client validation.** Stellar: `StrKey.isValidEd25519PublicKey(v) \|\| StrKey.isValidContract(v)` (Strkey length + alphabet + checksum, no network call). EVM: `/^0x[0-9a-fA-F]{40}$/`. Shown on blur and on submit (the #1346 blur pattern), cleared on edit. `Link address` is disabled while the input is empty. Copy: Stellar `Enter a Stellar address: G… or C…, 56 characters.`; EVM `Enter an Ethereum address: 0x followed by 40 hexadecimal characters.` Rendered through `TextField`'s `invalid` + `error` props. | Issue + manager: format only, backend authoritative. `@stellar/stellar-sdk` is import-restricted to `src/wallet/stellar/**` (eslint), so the Strkey check lives there and is exported from `@/wallet`. |
| D7 | **Form layout (inside the row, below the caption; `flex flex-col gap-2 px-2 pt-2`, testid `settlement-other-form`), a `<form noValidate>` (neither surface is itself a form):** 1) when an address is served, a `Current` line with the full served address (break-all, `Current` in `--color-pipeline-ink-muted`, as the From/To lines); 2) a `<label>` `New settlement address` + `TextField` (placeholder `G… or C…` / `0x…`, `autoComplete="off"`, `spellCheck={false}`, id from `useId()` because both surfaces can be mounted at once); 3) the `Signer` line (D3); 4) a muted hint `Your connected wallet signs to link this address.`; when an address is served, the `confirm` caption `Deposits processed after the change are minted to the new address.` instead; 5) the phase caption (below); 6) `Link address` (`primary-dark`, compact) + `Cancel` (`secondary`, compact). Enter submits. The input is focused on open. | Mirrors #1825's inline From/To confirmation block so both inline steps look alike. |
| D8 | **Submitting the form is the change confirmation.** No second From/To step: the `Current` line and the `confirm` caption are in the form the LP just filled. | The LP typed the new address deliberately; a second step would repeat what is on screen. The confirmation is not a security control (TD-163). |
| D9 | **State lives in the hook, the draft text in the row.** `SettlementLinkState` gains `mode: "wallet" \| "other"` and the phase `editing`. The draft string and its blur-validation flag are local `useState` in the form component, so they survive the busy/error phases (the form stays mounted) and are dropped on success, `Cancel`, or any reset. A token or connected-wallet change resets to `IDLE` (existing effect), closing the form. | One source for phase/mode across both surfaces; the draft is purely presentational. |
| D10 | **Other-mode phases render in the form**, input disabled and buttons hidden while busy (`aria-busy` on the row as today). Captions: `requesting`/`verifying` → `linkingAddress` `Linking this address…`; `signing` → `signing`; `declined` → `declined`; `proofFailed` → `proofFailed` (negative); `taken` → `addressTaken` `This address is already linked to another account. Enter a different address.` (negative, form stays open so the LP can edit and resubmit); `error` → `addressError` `This address could not be linked. Try again.` (negative). After a failure the form keeps the draft and `Link address` starts a **new** challenge (#1825 D12). | Same error matrix as #1825 D11 (toast rules, 409 re-read, 422 no toast, 401/403 app-wide); only the caption text names "this address" instead of "your wallet". |
| D11 | **Signer line on a linked row.** The row view gains `signer: string \| null` = the served signer when it is non-null and differs from the served address. Rendered as a body-s line `Signer GABC…WXYZ` (`Signer` in `--color-pipeline-ink-muted`, address in `--color-pipeline-ink`, `truncateAddress`, full value as `title`) directly under the `AccountListRow`, before the caption. | The Trustee profile (#1826, `lp-counterparties.$id.tsx`) labels it `Signer`; same word on both apps. |
| D12 | **Connected wallet is the served signer of a different address** (e.g. a linked `C…` signed by the connected `G…`): `baseAction` returns `null` instead of `change`, and a new row rule shows caption `linkedSigner` `Linked. Your connected wallet is the signer of this address.` with no button (the D2 entry point remains). | Without this, #1825's rules would show `Your connected wallet is not this address.` + `Change wallet` on a correctly linked contract row and invite replacing it with the wallet itself. Switching back to the wallet address is still possible through the form (type the wallet address, D4). |
| D13 | **Hook API.** `useSettlementAddressLink` adds `beginOther(kind)` (guarded like `beginChange`: not in flight, `otherAllowed`) and `linkOther(kind, raw)` (re-validates with the pure parser; invalid input is a no-op). `link(kind)` keeps its signature and behaviour. Both run through one internal `run(kind, mode, { address, signer })`. `cancelChange()` also closes the form. `SettlementControls` gains `onOther(kind)` and `onLinkOther(kind, raw)`; `AuthFlowProvider` maps them. | Keeps #1825's call sites and tests valid; the stale guard (token + connected `kind`/`address`), single flight and pinned signer (`signMessage(message, wallet.address)`) apply to both modes unchanged. |
| D14 | **EVM signer must be an EOA.** A Safe/smart wallet connected through WalletConnect produces an EIP-1271-style signature the backend cannot verify → `422` → `proofFailed`. The user stories tell QA to connect an owner EOA (MetaMask) and type the Safe address. | `verify_personal_sign` is `ecrecover` only (settled by backend code, not an open question). |
| D15 | **Re-linking the same address and signer is allowed** (the backend records a fresh proof). The form does not block it. | `kyb-lp-verification.md` § Link history. Avoids a client rule the backend does not have. |
| D16 | **User docs not edited.** `docs/user-docs/lenders/onboarding.md` ("change it at any time by signing with the new wallet") stays true: the LP signs with the connected wallet in both paths. | Source-of-truth user docs (#1747) need no change for an opt-in UI path. |

## Assumptions and Risks

- **Backend contract is on `main`** (#1824): challenge `?chain_id&address&signer_address`, verify `{ chain_id, address, signer_address?, signature }`, `resolve_link_target` in `packages/api/src/routes/lp_settlement_address.rs`. One live challenge per `(lp, chain)`; a new challenge for a different target is issued by `issue_or_reuse_challenge`. A target mismatch on verify is `422`.
- **Test fixtures need a valid `C…` Strkey.** Generate it in tests with `StrKey.encodeContract(new Uint8Array(32))` inside `src/wallet/stellar/**` tests, or hard-code a known-valid constant in other tests (eslint forbids importing `@stellar/stellar-sdk` outside `src/wallet/stellar/**`; test files are not exempt — confirm with `yarn lint`).
- **Lint-comments baseline.** `packages/frontend/src/wallet/index.ts` is in `scripts/lint-comments.baseline.json` (header docblock). Adding an export there means replacing the docblock with a one-line `// spec:` pointer to the wallet README, moving any missing substance into the README, and shrinking the baseline with `npx tsx scripts/lint-comments.ts --update-baseline`.
- **Two mounted surfaces.** If the Account page and `CompanyDocsModal` render the rows at the same time, both show the form; each has its own draft. Input ids come from `useId()` to stay unique.
- **No real Safe on staging may exist.** EVM QA can use any second EOA address as the "settlement address" with MetaMask as signer; the backend accepts a `0x…` address with a different EOA signer.
- **Security** (TD-162, TD-163, accepted): a separate signer proves control of the signer only; a hijacked session can redirect mints. The UI does not claim more: copy says "signer", never "owner".

## Open Questions

_None_

## Implementation Steps

Code style per AGENTS.md: each new or rewritten file has one `// spec:` header line, no other comments (no JSDoc, no body or test comments). Tests sit next to their source.

1. **Docs first.** Make the changes under "Docs to Update" so the code follows the spec.

2. **API — `packages/frontend/src/api/lps.ts`.**
   - `getLinkAddressChallenge(chainId: number, address: string, signerAddress?: string | null)`: append `signer_address` to the `URLSearchParams` only when `signerAddress` is truthy.
   - `verifyLinkAddress(body: { chain_id: number; address: string; signer_address?: string; signature: string })`: unchanged otherwise; the caller omits the key (not `null`) on the default path so the JSON body stays `{ chain_id, address, signature }`.
   - Update `api/README.md` if it documents these signatures.

3. **Stellar format check — new `packages/frontend/src/wallet/stellar/settlementAddressFormat.ts`.**
   - `export function isStellarSettlementAddress(value: string): boolean` → `StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)`.
   - Export it from `packages/frontend/src/wallet/index.ts` (handle the lint-comments baseline as in Risks). Document it in `packages/frontend/src/wallet/README.md`.

4. **Pure model — `packages/frontend/src/components/account/settlementAddress.ts`.**
   - `SettlementPhase` += `"editing"`. `SettlementLinkState` += `mode: "wallet" | "other"`. Update `IDLE` users.
   - `export type SettlementTarget = { address: string; signer: string | null }`.
   - `export function parseSettlementInput(kind, raw): { ok: true; address: string } | { ok: false; error: string | null }` — D5 normalization, D6 checks; empty → `{ ok: false, error: null }`.
   - `export function otherTarget(kind, address, connected): SettlementTarget` — `signer` = `null` when `sameAddress(kind, address, connected.address)`, else the connected address (lowercased for EVM).
   - `export function otherAllowed(lp, kind, connected): boolean` — `lp !== null && settlementWritable(lp) && connected?.kind === kind`.
   - `baseAction`: when `served !== null` and it differs from `connected.address`, return `null` if `servedSigner(lp, kind)` equals the connected address (`sameAddress`), else `"change"` (D12).
   - `SETTLEMENT_CAPTIONS` += `linkingAddress`, `addressTaken`, `addressError`, `linkedSigner`, `otherHint`, plus `SETTLEMENT_FORM_COPY` (`entry: "Use a different address"`, `label: "New settlement address"`, `current: "Current"`, `signer: "Signer"`, `submit: "Link address"`, `cancel: "Cancel"`, placeholders, the two D6 validation messages). Exact strings per D2/D6/D7/D10/D12.
   - `SettlementRowView` += `signer: string | null` (D11), `other: boolean` (D2), `form: { current: string | null; signer: string; busy: boolean } | null`. `SettlementControls` += `onOther(kind)`, `onLinkOther(kind, raw)`.
   - `deriveSettlementRows`:
     - `signer` on every kind row per D11 (`null` on the generic row).
     - When `link.kind === kind && link.mode === "other"`: return the served row with `form` set (`current` = served address, `signer` = connected address, `busy` for `requesting`/`signing`/`verifying`), the D10 caption/tone for the phase (`editing` → `otherHint`, or `confirm` when an address is served), `action: null`, `other: false`.
     - New rule before #1825 rule 10: served `s`, `c` differs from `s`, served signer equals `c` → `linkedSigner`, no button.
     - `other` = `otherAllowed(...)` and the row is not busy, not `confirming`, not in other mode.
     - Every existing #1825 rule (1–14) keeps its output for `mode === "wallet"`.

5. **Hook — `packages/frontend/src/auth/useSettlementAddressLink.ts`.**
   - `IDLE = { kind: null, phase: "idle", mode: "wallet" }`.
   - Extract the async body of `link` into `run(kind, mode, target, wallet, sessionToken)`; `finish` keeps `mode` on non-idle phases. Calls: `getLinkAddressChallenge(chainId, target.address, target.signer)`, `signMessage(message, wallet.address)` (unchanged pin), `verifyLinkAddress({ chain_id, address: target.address, ...(target.signer ? { signer_address: target.signer } : {}), signature })`. Error handling exactly as today (D10/D11 of #1825).
   - `link(kind)`: existing guards, target `{ address: wallet address (lowercased for EVM), signer: null }`, `mode: "wallet"`.
   - `beginOther(kind)`: no-op when in flight or `!otherAllowed`; else `setState({ kind, phase: "editing", mode: "other" })`.
   - `linkOther(kind, raw)`: guards (token, loaded LP, `otherAllowed`, not in flight); `parseSettlementInput`; invalid → no-op; else `run(kind, "other", otherTarget(...))`.
   - `cancelChange()` resets to `IDLE` from `confirming` or other-mode non-busy phases.
   - Return `{ state, connected, link, beginChange, cancelChange, beginOther, linkOther }`.

6. **Provider — `packages/frontend/src/auth/AuthFlowProvider.tsx`.** Destructure the two new members; `settlement = { rows, onLink, onChange, onCancel, onOther: beginOther, onLinkOther: linkOther }` (memo deps updated). `AuthFlowContext.ts` needs no change beyond the `SettlementControls` type.

7. **Row — `packages/frontend/src/components/account/SettlementAddressRow.tsx`.**
   - Signer line (D11, testid `settlement-signer`).
   - Entry link (D2, testid `settlement-other-entry`) calling `onOther(kind)`.
   - New `SettlementOtherForm` component in the same file (D7): local `draft` + `touched` state; validation via `parseSettlementInput` on blur/submit (`TextField invalid/error`); `onSubmit` → `preventDefault`, validate, `onLinkOther(kind, draft)`; `Cancel` → `onCancel()`; input focused on mount; disabled while `form.busy`; buttons hidden while busy. The phase caption (`role="alert"` when negative) renders inside the form block instead of the row caption slot.
   - `SettlementAddressRows` passes `onOther` / `onLinkOther`.

8. **Surfaces.** `AccountProfileCard.tsx` and `CompanyDocsModal.tsx` already pass `settlement` through; verify no change is needed beyond types (and that the `/test?tab=auth` preview still omits the rows).

9. **Fixtures.** Add `mode: "wallet"` (or rely on `IDLE`) and the new `SettlementControls` members to every typed stub (`AccountProfileCard.test.tsx`, `CompanyDocsModal.test.tsx`, `AccountPage.test.tsx`, `routes/-account.test.tsx`, `AuthFlowProvider*.test.tsx` — grep `onCancel:`).

10. **Verify.** `yarn workspace` lint + `tsc` + build for `packages/frontend`, full frontend vitest, `npx tsx scripts/lint-docs.ts` (0 errors), `npx tsx scripts/lint-comments.ts` (baseline shrunk if touched).

## Test Strategy

- **`wallet/stellar/settlementAddressFormat.test.ts`**: valid `G…`, valid `C…` (`StrKey.encodeContract`), bad checksum, `M…`/`S…` strkeys, wrong length, lowercase input (false; normalization happens in the parser).
- **`components/account/settlementAddress.test.ts`**:
  - `parseSettlementInput`: empty, whitespace-trimmed, Stellar lowercase → uppercased valid, invalid Strkey message, EVM mixed-case kept as typed, EVM short/long/non-hex message.
  - `otherTarget`: same-as-connected → `signer: null` (both kinds, EVM case-insensitive); different → connected as signer, EVM lowercased.
  - `baseAction`: served `C…` signed by connected `G…` → `null`; served by another signer → `change`; all #1825 cases unchanged.
  - `deriveSettlementRows`: Signer line present only when signer ≠ address; `linkedSigner` rule; `other` true/false matrix (Failed, no wallet, other kind, generic row, needsLp, busy, confirming, editing); other-mode `form` and caption for each phase incl. `current` when served; existing table rows 1–14 unchanged (keep the current tests green).
- **`auth/useSettlementAddressLink.test.tsx`** (new cases; all existing cases stay):
  - Stellar `C…` + connected `G…`: challenge called with `(STELLAR_CHAIN_ID, C…, G…)`, `signMessage(message, G…)`, verify body has `signer_address: G…`, LP adopted, state `IDLE`.
  - EVM other address typed mixed-case: challenge/verify `address` exactly as typed (trimmed), `signer_address` = lowercased connected.
  - Typing the connected wallet address → no `signer_address` on either call.
  - Invalid input → no request. `beginOther` no-op for `Failed`, no wallet, other kind, in flight. `cancelChange` closes editing.
  - Other-mode `declined`, `422` → `proofFailed` (no toast), `409` → toast + re-read + `taken` (mode stays `other`), generic → toast + `error`; a resubmit fetches a new challenge.
  - Wallet switched mid-flight in other mode → `IDLE`, no verify. Token change resets an open form.
  - Default path regression: "links a Stellar wallet … without signer_address" still passes and asserts the verify body has no `signer_address` key.
- **`api/lps.test.ts`**: challenge URL with and without `signer_address`; verify body with and without the key.
- **New `components/account/SettlementAddressRow.test.tsx`**: entry link calls `onOther`; form renders `Current` only when served, `Signer` with the truncated connected address and full `title`; blur on invalid shows the D6 message with `aria-invalid`; `Link address` disabled when empty; Enter and click call `onLinkOther(kind, draft)`; `Cancel` calls `onCancel`; busy disables input and hides buttons; negative caption has `role="alert"`; linked row with differing signer shows the Signer line.
- **`AccountProfileCard.test.tsx` / `CompanyDocsModal.test.tsx`**: the entry link renders on both surfaces for a connected writable LP; absent in the modal preview.
- Full frontend suite, lint, typecheck, build.
- **Manual QA (user stories doc):** Freighter linking a `C…` contract address; Freighter linking another `G…` (multisig) with itself as signer; MetaMask linking a Safe/other `0x…` address; invalid inputs; `409` with an address held by another LP; default path unchanged. Real wallets only (mock wallets cannot sign).

## Docs to Update

- **`docs/frontend/account-page.md#settlement-address`**:
  - Flow paragraph: replace "`signer_address` is never sent … (TD-166)" with the D4 rule.
  - New sub-block **Different address (#1849)** with D2, D3, D5–D10, D14, D15 (entry point, form layout, normalization, validation copy, submit = confirmation, other-mode phases/captions).
  - Rows: Signer line (D11); row-rules table gains the `linkedSigner` rule before rule 10 and the other-mode rule; `base` definition notes D12.
  - Captions table: `linkingAddress`, `addressTaken`, `addressError`, `linkedSigner`, `otherHint`; form copy table.
  - Errors table: note the other-mode captions.
  - Out of scope: drop the TD-166 item; add "EIP-1271 / smart-wallet signers (backend verifies EOA only)" and "a signer other than the connected wallet".
- **`docs/frontend/auth-components.md`** (lines ~718 and ~1025): `settlement` now includes `onOther` / `onLinkOther` and the `Use a different address` form.
- **`docs/frontend/hooks.md`** (`useSettlementAddressLink` row): add `beginOther(kind)`, `linkOther(kind, address)`, `state.mode`.
- **`packages/frontend/src/wallet/README.md`**: `isStellarSettlementAddress`.
- **New `docs/user-stories/epic-1247/1849-settlement-address-signer.md`** (format of `1825-signed-settlement-link-ui.md`): stories for Stellar `C…` + `G…` signer, Stellar `G…` multisig, EVM Safe with owner EOA, invalid input captions, `409` held address, Signer line after linking, `linkedSigner` row, default path unchanged, Cancel makes no request.
- **`docs/exec-plans/tech-debt-tracker.md`**: mark TD-166 resolved by #1849 (date, PR #1850).
- `docs/product-specs/kyb-lp-verification.md`, `api-authorization.md`, user docs: no change (D16, Scope).
- On completion, move this plan to `docs/exec-plans/completed/`.
