# User stories — #675: Stellar header PLUSD and sPLUSD balances

Source: https://github.com/eq-lab/pipeline/issues/675
Epic: #556 — Connect page / TopBar header

## Context

When a Stellar wallet is connected, the TopBar header previously showed only the USDC balance
in the `WalletPill`. This issue surfaces the user's PLUSD and sPLUSD balances as well, inside
the `AccountDropdown` panel (per design decision: keep a single USDC pill in the header, add
PLUSD/sPLUSD rows to the existing dropdown).

---

## Story 1: PLUSD balance appears in dropdown when balance is non-zero

**Given** a Stellar wallet is connected with a non-zero PLUSD balance and the `Stellar`
namespace tab is active in the `AccountDropdown`.

**When** the user clicks the `WalletPill` to open the dropdown.

**Then** the dropdown shows a `PLUSD balance` row with a `$X.XX` formatted value below
the USDC balance row.

**And** a PLUSD coin icon is shown to the left of the balance.

**Test IDs:** `topbar-plusd-balance-row`

---

## Story 2: sPLUSD balance appears in dropdown when balance is non-zero

**Given** a Stellar wallet is connected with a non-zero sPLUSD balance and the `Stellar`
namespace tab is active.

**When** the user clicks the `WalletPill` to open the dropdown.

**Then** the dropdown shows a `sPLUSD balance` row with an `X.XX` token count (not a `$` value).

**And** an sPLUSD coin icon is shown to the left of the balance.

**Test IDs:** `topbar-splusd-balance-row`

---

## Story 3: Zero / no-trustline tokens are hidden

**Given** a Stellar wallet is connected and the PLUSD balance is zero or there is no trustline.

**When** the user opens the `AccountDropdown`.

**Then** no `PLUSD balance` row is rendered.

**And** if sPLUSD is also zero, no `sPLUSD balance` row is rendered.

---

## Story 4: EVM namespace shows only USDC

**Given** an EVM wallet is connected (or both EVM and Stellar are connected) and the `EVM`
namespace tab is active.

**When** the user opens the `AccountDropdown`.

**Then** only the `USDC balance` row is visible — no PLUSD or sPLUSD rows.

---

## Story 5: Header pill is unchanged (USDC only)

**Given** a Stellar wallet is connected.

**When** the user views the TopBar header.

**Then** the `WalletPill` still shows the USDC balance only — not three side-by-side pills.

**And** clicking the pill opens `AccountDropdown` where PLUSD/sPLUSD appear.

---

## Story 6: PLUSD shows placeholder when addresses unresolved

**Given** a Stellar wallet is connected but `useStellarDepositManagerAddresses` has not
yet resolved (in-flight RPC call).

**When** the user opens the `AccountDropdown`.

**Then** no PLUSD row is rendered (the hook returns `hasTrustline: false` / `balance: undefined`
until resolution; the row is hidden rather than showing a placeholder).
