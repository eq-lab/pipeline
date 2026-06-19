# User Story #656 — Hide bottom actions block while chain data / API are loading

Issue: https://github.com/eq-lab/pipeline/issues/656
Epic: #498 — Deposit/withdraw page

## Background

The deposit/withdraw page flashed a StepsCard with placeholder `0.00` balances and
default step states before chain balance data and the requests API had resolved.
This story covers the fix that hides the entire bottom actions block during this
loading window.

## Actors

- **Connected EVM user** — wallet connected, token balance query in-flight or just resolved.
- **Connected Stellar user** — Stellar wallet connected, token balance query in-flight or just resolved.
- **Disconnected user** — no wallet connected.

## Stories

### S1 — EVM deposit: bottom block hidden while requests API is loading

**Given** the wallet is connected on EVM
**And** the requests API query (`useRequests`) is still loading
**When** the user opens `/deposit`
**Then** neither the StepsCard, the low-balance banner, nor the connect-wallet banner are rendered
**And** the page does not crash

### S2 — EVM withdraw: bottom block hidden while requests API is loading

**Given** the wallet is connected on EVM
**And** the requests API query is still loading
**When** the user opens `/deposit?direction=withdraw`
**Then** neither the StepsCard, the low-balance banner, nor the connect-wallet banner are rendered

### S3 — EVM deposit: bottom block hidden when connected but balance is still undefined

**Given** the wallet is connected on EVM
**And** the token balance is `undefined` (addresses resolver still loading, so the
token query is not yet enabled)
**And** `useRequests.isLoading` is `false`
**When** the user views `/deposit`
**Then** neither the StepsCard nor the low-balance banner are rendered
**And** the connect-wallet banner is also absent (wallet IS connected)

### S4 — EVM deposit: StepsCard reappears once data resolves

**Given** the wallet is connected on EVM
**And** the requests API was loading but has now resolved with an empty list
**And** the token balance is now defined
**When** the component re-renders with the resolved data
**Then** the StepsCard (`data-testid="deposit-steps-card"`) is rendered

### S5 — Stellar deposit: bottom block hidden while requests API is loading

**Given** the wallet is connected on Stellar
**And** the requests API query is still loading
**When** the user opens `/deposit` with Stellar chain selected
**Then** neither the StepsCard nor the low-balance banner are rendered
**And** the connect-wallet banner is absent (wallet IS connected)

### S6 — Disconnected wallet: connect-wallet banner shown regardless of loading state

**Given** the wallet is NOT connected
**And** the requests API query is loading (`isLoading: true`)
**When** the user views `/deposit`
**Then** the connect-wallet banner (`data-testid="connect-wallet-banner"`) IS rendered
**And** the StepsCard is absent (expected — disconnected)

This ensures the disconnected branch evaluates before the `isDataPending` guard.
