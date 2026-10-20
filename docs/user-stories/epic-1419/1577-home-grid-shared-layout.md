# User Stories: #1577 — Home: collapse the desktop home-grid branches into one shared layout

Epic: [#1419 — LP home screen states](https://github.com/eq-lab/pipeline/issues/1419)
Issue: [#1577](https://github.com/eq-lab/pipeline/issues/1577) (TD-122)
Spec: [docs/frontend/dashboard-components.md#home-route](../../frontend/dashboard-components.md#home-route)

Pure refactor: **no visible change is expected on any screen.** These are regression stories — each
state must look and behave exactly as its own user-stories doc under this folder already describes.
Desktop width (≥ 768px); the mobile stack is untouched.

---

## Story 1: Every home state still renders its own composition

**Persona:** QA walking the seven desktop states.

**Pre-conditions:** The seven states reachable as in their own docs: zero (#1421), unverified
(#1422), kyb-pending (#1423), plusd-held (#1424), kyb-problem (#1426), wallet-only (#1460), and
the legacy grid (signed in, wallet connected, KYB passed, sPLUSD > 0).

**Steps:**

1. Visit `/` in each state and compare against that state's Figma frame / stories doc.

**Expected outcomes:**

- Each state shows its own top-left card, Balances stack, third-slot card and the Recent activity + FAQ slots exactly as before; the `data-node-id` of the Balances and Add-USD stacks is unchanged per state.
- No state falls through to another state's layout.

---

## Story 2: Handlers still fire per state

**Persona:** LP interacting with the cards.

**Pre-conditions:** Story 1 states.

**Steps:**

1. In the zero state click Buy, Sell, Stake and Get Started — each opens the sign-up flow.
2. In wallet-only click Start Verification — the Add-email screen opens; in unverified it opens Account setup instead.
3. In kyb-pending / kyb-problem click View (Status) — `/account` opens.
4. In plusd-held click Add USD — the funding-details modal opens; the Start-here card shows the PLUSD balance.

**Expected outcomes:**

- Each action behaves as its own stories doc describes; Sell / Stake disabled states follow the served balances as before.
