# Issue #1901: LP: Account wallet card — Connect Wallet continues into linking the wallet as the settlement address

Source: https://github.com/LDavti/pipeline/issues/1901 (sub-issue of epic #1247; branch `feat/1901-account-connect-then-link`, draft PR #1902)

## Scope

On `/account`, a click on the wallet card's **Connect Wallet** arms a one-shot "link after connect" intent. When a
wallet connects while the intent is armed, the existing settlement hook continues into the existing signed link for
that wallet's chain (or opens the existing Change confirmation). No new UI, no Figma work, no backend change.

In scope:
- `packages/frontend/src/auth/useSettlementAddressLink.ts`: new `armConnectLink()` + a consuming effect.
- `packages/frontend/src/auth/AuthFlowProvider.tsx`: expose the arm callback on `useAuthFlow().settlement`.
- `packages/frontend/src/components/account/AccountWalletCard.tsx`: Connect Wallet calls `settlement.armConnectLink()` then `connect()`.
- Tests and docs listed below.

Out of scope: Trustee side, the Different-address form, backend contract, any wallet connected outside the Account card.

## Assumptions and Risks

- `useActiveWalletAccount().connect` only opens the shared connect modal and exposes no "closed without connecting"
  signal. An armed intent can therefore outlive a dismissed modal; a later connect from the header while still on
  `/account` would then chain into a link. Mitigation: the intent is cleared on token change, on unmount of the
  provider-side consumer, and once consumed; additionally it expires after a bounded window (see Open Questions).
- The LP may not be loaded (`lpLoaded` false) at the moment the wallet connects; the effect must wait for `lpLoaded`
  rather than drop the intent.
- `AuthFlowProvider` is app-wide, so the intent lives in the hook (a `useRef`), not in the card; only the card arms it,
  which keeps "connected elsewhere never prompts".
- If a wallet is already connected when the card is clicked the card renders the connected frame, so arming only
  happens from the disconnected state.
- The existing reset effect (`[token, connected?.kind, connected?.address]` → IDLE) fires on the same connect transition;
  the consuming effect must run after it (declare it later in the hook) so `link` / `beginChange` state is not wiped.
  Since `link` sets `inFlight` synchronously, the reset effect's guard already protects the running flow; for
  `beginChange` (no inFlight) order of effects matters — test it explicitly.

## Open Questions

- When the LP dismisses the connect modal without connecting, should the armed intent be dropped? The modal exposes no
  close signal today. Proposed default: keep the intent armed only while the Account page is mounted and for at most
  ~2 minutes (or until the next connect), so a later header connect on `/account` within that window would also chain.
  Alternative: add an `onClose`/open-state signal to the shared connect modal (`@pipeline/wallet-connect`) to clear it
  precisely — larger change. Which is acceptable?

## Implementation Steps

1. `useSettlementAddressLink.ts`
   - Add `const pendingConnect = useRef<{ token: string; at: number } | null>(null);`.
   - Add `armConnectLink = useCallback(() => { const t = latest.current.token; if (t && !latest.current.connected) pendingConnect.current = { token: t, at: Date.now() }; }, [])`.
   - Add an effect after the reset effect, deps `[token, lpLoaded, lp, connected?.kind, connected?.address]`:
     - no intent → return; intent token !== current token or expired → clear, return.
     - `!connected` or `!lpLoaded || !lp` → return (keep waiting).
     - clear the intent (one-shot), then `switch (baseAction(lp, connected.kind, connected))`:
       `"link"` → `link(connected.kind)`; `"change"` → `beginChange(connected.kind)`; `null` → nothing
       (covers equal address and `Failed` KYB via `settlementWritable`).
   - Return `armConnectLink` from the hook and add it to `SettlementAddressLink`.
   - Declined / taken / proofFailed / error / stale-abandon behaviour is inherited from `run` unchanged.
2. `AuthFlowProvider.tsx`: destructure `armConnectLink`, add `onArmConnectLink: armConnectLink` (name to match the
   existing `onLink` style) to the `settlement` memo and its type in the context value type.
3. `AccountWalletCard.tsx`: read `useAuthFlow().settlement` (guard for absent provider if the card is rendered in tests
   without one — follow how `AccountProfileCard` reads it); Connect Wallet `onClick` = arm then `connect()`.
   Keep the single `// spec:` header; no other comments.
4. Make sure no other caller (header, home cards, sign-in) calls the arm callback (grep `onArmConnectLink`).

## Test Strategy

Run from `packages/frontend`: `npx vitest run src/auth/useSettlementAddressLink.test.tsx src/components/account`.
- `useSettlementAddressLink.test.tsx`:
  - armed + wallet connects + LP without served address → challenge requested, sign, verify, LP adopted.
  - armed + LP loads after the wallet connects → link starts once loaded.
  - armed + served address equal (and proven) → no challenge request, state idle.
  - armed + served address differs → state `confirming`, no challenge until `beginChange` confirm → `link`.
  - armed + signature rejected → `declined`, wallet still connected.
  - armed + `Failed` KYB → no challenge.
  - not armed + wallet connects → no challenge (connected elsewhere never prompts).
  - armed + token changes before connect → intent dropped, no challenge.
  - intent is one-shot: disconnect + reconnect after a consumed intent → no challenge.
- `AccountWalletCard.test.tsx`: clicking Connect Wallet calls both the arm callback and `connect`.
- `AccountPage.test.tsx` (the `-account` route test if that is where integration lives): click Connect Wallet, simulate
  the wallet connecting, assert the settlement row passes through `signing` and ends showing the proven address.
- Then `yarn lint` and `yarn build` for the frontend package.

## Docs to Update

- `docs/frontend/account-page.md` §Settlement address "Flow (click only)": narrow "connecting a wallet never prompts" to
  "connecting a wallet never prompts, except a connect started from the Account wallet card's Connect Wallet, which
  continues into Link wallet (or the Change confirmation when the served address differs; nothing when equal or
  `Failed`)". §Wallet card (AccountWalletCard): note the arm-then-connect behaviour.
- New user-stories doc `docs/user-stories/epic-1247/1901-account-connect-then-link.md` covering connect-then-link,
  equal no-op, differing → Change confirmation, declined → Try again, Failed KYB, header connect never prompts.

## Implementation status

Done. Open Question resolved as Option B: the LP uses its own `packages/frontend/src/wallet/ConnectModalProvider` (not `@pipeline/wallet-connect`, which already had `onCancel`), so the `onCancel` signal was added there (and to the terms gate dismissal); `@pipeline/wallet-connect` is unchanged.
