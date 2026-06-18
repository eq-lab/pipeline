# User Stories: #633 — [FE] [Stellar] Stake/unstake flow: deposit → redeem vault hooks

Epic: [#531 — Stake/unstake page](https://github.com/eq-lab/pipeline/issues/531)
Issue: [#633](https://github.com/eq-lab/pipeline/issues/633)

These stories cover the Stellar/Soroban wallet-layer hooks that drive the
sPLUSD stake/unstake flow — the Soroban counterpart of the EVM `useStakedPlusd.ts`
hooks. Testing is performed via the mock layer (localStorage keys) since these
are wallet-layer unit tests, not UI tests.

**Interface note:** The live `FungibleVault` WASM (testnet, captured 2026-06-18)
uses `deposit(assets, receiver, from, operator)` and `redeem(shares, receiver, owner, operator)`.
The vault IS the sPLUSD share token — no separate share contract exists.
The underlying PLUSD accessor is `query_asset()` (not `asset()`).

---

## Story 1: Happy-path stake — connected user deposits PLUSD and receives sPLUSD

**Persona:** A Stellar-connected user with PLUSD and an sPLUSD trustline, visiting
`/stake` and clicking Stake.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Stellar wallet is connected (mock: `pipeline.mock.wallet.stellar.address` set).
- `useStellarStake` mock key is set: `localStorage.setItem("pipeline.mock.wallet.stellar.stakedPlusd.stake", '{"hash":"abc123","shares":"9600000"}')`

**Steps:**

1. Open `/stake` (Stellar chain selected).
2. Enter 1 PLUSD in the stake input.
3. Click the Stake button.

**Expected outcomes:**

- `useStellarStake().isPending` transitions to `true` immediately on click.
- `useStellarStake().isSuccess` transitions to `true` after the mock resolves.
- `useStellarStake().data` is `{ hash: "abc123", shares: "9600000" }`.
- `useStellarStake().error` is `null`.

---

## Story 2: Happy-path unstake — connected user redeems sPLUSD and receives PLUSD

**Persona:** A Stellar-connected user with sPLUSD, visiting `/stake` and clicking Unstake.

**Pre-conditions:**

- App is running at `http://localhost:3000/stake`.
- Stellar wallet is connected.
- `useStellarUnstake` mock key is set: `localStorage.setItem("pipeline.mock.wallet.stellar.stakedPlusd.unstake", '{"hash":"xyz789","assets":"10400000"}')`

**Steps:**

1. Open `/stake` (Stellar chain, Unstake tab selected).
2. Enter 0.96 sPLUSD in the unstake input.
3. Click the Unstake button.

**Expected outcomes:**

- `useStellarUnstake().isPending` transitions to `true` immediately.
- `useStellarUnstake().isSuccess` transitions to `true` after mock resolves.
- `useStellarUnstake().data` is `{ hash: "xyz789", assets: "10400000" }`.
- `useStellarUnstake().error` is `null`.

---

## Story 3: Missing sPLUSD trustline — stake is blocked until trustline is added

**Persona:** A connected user who has not yet established an sPLUSD trustline.

**Pre-conditions:**

- Stellar wallet is connected.
- `pipeline.mock.wallet.stellar.stakedPlusd.shareBalance` is NOT set (or set to `"0"`).
- `useStellarSacToken` returns `hasTrustline: false` for sPLUSD.

**Steps:**

1. Open `/stake` (Stellar chain, Stake tab).
2. Observe the trustline guard.

**Expected outcomes:**

- `useStellarChangeTrustStakedPlusd().needsTrustline` is `true` once the share asset identity has been resolved from the vault's `name()` view.
- A "Enable sPLUSD" button (or equivalent) is visible to the user (UI layer).
- Clicking the button calls `useStellarChangeTrustStakedPlusd().submit()`.
- After mock success: `useStellarChangeTrustStakedPlusd().isSuccess` is `true`.

---

## Story 4: Missing PLUSD trustline on unstake delivery — unstake guarded

**Persona:** A connected user whose PLUSD trustline has been removed before unstaking.

**Pre-conditions:**

- Stellar wallet is connected.
- `useStellarSacToken` for PLUSD returns `hasTrustline: false`.

**Steps:**

1. Open `/stake` (Stellar chain, Unstake tab).
2. Observe the trustline guard for PLUSD on the unstake flow.

**Expected outcomes:**

- A PLUSD trustline guard (using the existing `useStellarChangeTrustUsdc` or PLUSD counterpart) is surfaced on the unstake form.
- Unstaking is blocked until the PLUSD trustline is present.
- Note: this story is a forward reference — the UI wiring of the trustline guard is in a future sub-issue of #531.

---

## Story 5: Vault simulation failure (paused or auth failure) surfaces as error state

**Persona:** A connected user attempting to stake while the vault is paused or an auth error occurs.

**Pre-conditions:**

- Stellar wallet is connected.
- No mock key is set (real path exercised in hook tests).
- `StakedPlusdClient.buildDeposit()` throws a simulation error.

**Steps:**

1. Call `useStellarStake().write(10_000_000n)`.

**Expected outcomes:**

- `useStellarStake().isPending` becomes `false` after the error.
- `useStellarStake().error` is non-null and contains "simulation error" in the message.
- `useStellarStake().isSuccess` remains `false`.
- The UI (when wired) shows an error state to the user.

---

## Story 6: Declined signature — write hook surfaces wallet rejection as error state

**Persona:** A connected user who cancels the wallet signing prompt.

**Pre-conditions:**

- Stellar wallet is connected; `signTransaction` rejects with "User cancelled".
- No mock key is set.

**Steps:**

1. Call `useStellarStake().write(10_000_000n)`.
2. Wallet signing modal appears; user presses Cancel.

**Expected outcomes:**

- `useStellarStake().error.message` contains "User cancelled".
- `useStellarStake().isPending` is `false`.
- `useStellarStake().isSuccess` is `false`.
- The state can be cleared by calling `useStellarStake().reset()`.

---

## Story 7: Exchange-rate conversion reads use SAC 1e7 scale, not EVM 1e18

**Persona:** Developer verifying the mock convention for the conversion hooks.

**Pre-conditions:**

- `pipeline.mock.wallet.stellar.stakedPlusd.convertToShares` is set to `"9600000"` (rate = 0.96 at 1e7 scale).
- `pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets` is set to `"10400000"` (rate = 1.04 at 1e7 scale).

**Steps:**

1. Read `useStellarStakeConvertToShares(10_000_000n)`.
2. Read `useStellarUnstakeConvertToAssets(10_000_000n)`.

**Expected outcomes:**

- `useStellarStakeConvertToShares(10_000_000n).data` is `9_600_000n` (= 0.96 sPLUSD, 7-decimal scale).
- `useStellarUnstakeConvertToAssets(10_000_000n).data` is `10_400_000n` (= 1.04 PLUSD, 7-decimal scale).
- If the EVM 1e18 scale were incorrectly used, the output would be approximately `0n` — this must NOT happen.
- The scale guard test in `useStellarStakedPlusd.test.tsx` asserts this explicitly.
