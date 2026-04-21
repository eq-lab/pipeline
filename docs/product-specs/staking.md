# Staking: sPLUSD Vault

## Overview

sPLUSD is an ERC-4626 yield-bearing vault whose underlying asset is PLUSD. Staking is a pure on-chain interaction between the LP and the vault contract; the bridge service is not involved in deposit or redemption. Yield accretes passively: the bridge service mints fresh PLUSD directly into the vault address as yield events settle, increasing `totalAssets` while `totalSupply` of sPLUSD shares stays constant, which raises the share price for all stakers.

The vault is **open to any PLUSD holder** — there is no whitelist check on sPLUSD deposit, redemption, or transfer. KYC and sanctions screening are enforced upstream at the PLUSD level. On the way out of the vault, the PLUSD transfer reverts if the receiver is not whitelisted, re-engaging the compliance boundary at the point of delivery.

---

## Behavior

### Staking (Deposit)

1. The LP calls `PLUSD.approve(sPLUSDvault, amount)` to authorize the vault to pull PLUSD.
2. The LP calls `sPLUSD.deposit(assets, receiver)`. `receiver` is typically the LP's own address.
3. The vault transfers `assets` PLUSD from the caller into itself, computes the shares to issue, and mints sPLUSD shares to `receiver`.

Share calculation on deposit:

```
shares = assets * totalSupply / totalAssets    (if totalSupply > 0)
shares = assets                                 (on first deposit, 1:1)
```

Standard ERC-4626 rounding direction applies (round down on deposit to protect existing shareholders).

### First-Deposit Attack Mitigation

At vault deployment, a small amount of PLUSD ("dead shares") is minted into the vault by the deployer and the corresponding sPLUSD shares are sent to the zero address. This seeds `totalAssets` and `totalSupply` with non-zero values, preventing the inflation attack on the first real deposit.

### Yield Accretion

Yield is delivered to the vault by the bridge service minting fresh PLUSD directly into the vault contract address:

```
PLUSD.mint(address(sPLUSDvault), yieldAmount)
```

This call increases `PLUSD.balanceOf(address(sPLUSDvault))`, which is exactly what `totalAssets()` returns. Because `totalSupply` of sPLUSD shares does not change, the share price (`totalAssets / totalSupply`) increases. All current stakers benefit proportionally without any action on their part.

Two yield sources feed into the vault this way:
- **Loan repayment yield**: the `senior_coupon_net` component of each settled repayment, minted in response to a trustee-signed RepaymentSettled event.
- **T-bill (USYC) yield**: 70% of weekly accrued USYC NAV appreciation, minted in response to a trustee-signed TreasuryYieldDistributed event.

The bridge service holds the MINTER role on PLUSD and is the only party that can execute these mints. Both categories are subject to the same on-chain rolling rate limit and per-transaction cap as deposit mints.

### Unstaking (Redemption)

1. The LP calls `sPLUSD.redeem(shares, receiver, owner)`. `receiver` and `owner` are typically the LP's own address.
2. The vault burns `shares` sPLUSD from `owner` and transfers the corresponding PLUSD amount — computed at the current exchange rate — to `receiver`.

PLUSD amount on redemption:

```
assets = shares * totalAssets / totalSupply
```

Standard ERC-4626 rounding direction applies (round down on redemption to protect the vault).

Unstaking is always available. There is no lock-up period, no queue, and no minimum hold time.

**WhitelistRegistry re-entry on redemption.** The PLUSD transfer inside `redeem` is subject to the PLUSD contract's `_update` hook. If `receiver` is not currently present on the WhitelistRegistry with a valid Chainalysis freshness timestamp, the PLUSD transfer reverts — and therefore the entire `redeem` call reverts — at the PLUSD contract level, not at the vault level. This is by design: the vault itself does not perform a whitelist check; the PLUSD transfer hook enforces the compliance boundary.

### sPLUSD Is Open — No Whitelist Check

The sPLUSD vault does not consult the WhitelistRegistry on deposit, redemption, or transfer of sPLUSD shares. This is deliberate.

**Architectural principle.** KYC and sanctions screening are enforced at the point where USDC enters the protocol and PLUSD is first minted. PLUSD can only exist in whitelisted addresses (KYCed LP wallets or approved DeFi venues). Any holder of PLUSD has therefore either passed KYC to receive it directly from a mint, or received it from another whitelisted address through a transfer the PLUSD contract permitted. Staking PLUSD into sPLUSD requires only that the caller already holds PLUSD — the compliance check was performed when that PLUSD entered their address. No second KYC is required.

This design enables DeFi composability: third parties who acquire PLUSD through approved DeFi venues (specific Curve pools, Uniswap v4 pools, Aave markets added by the foundation multisig) can stake into sPLUSD and earn yield without undergoing Pipeline's direct onboarding. The protection of LP capital is not weakened, because the only way PLUSD enters circulation is through KYCed deposit mints, and every holder of PLUSD is either whitelisted or an approved venue. sPLUSD inherits this indirect compliance chain without imposing its own additional check.

On the way out, the chain re-engages: `redeem` delivers PLUSD, and PLUSD's transfer hook enforces the whitelist on the receiver. An sPLUSD holder whose redemption address is not whitelisted cannot convert their shares back to PLUSD.

---

## API Contract

### sPLUSD (ERC-4626)

```solidity
function deposit(uint256 assets, address receiver) external returns (uint256 shares);
// Transfers `assets` PLUSD from msg.sender into the vault.
// Mints `shares` sPLUSD to `receiver`.
// shares = assets * totalSupply() / totalAssets()  (1:1 on first deposit)
// No whitelist check. Open to any PLUSD holder.

function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
// Burns `shares` sPLUSD from `owner`.
// Transfers `assets` PLUSD to `receiver`.
// assets = shares * totalAssets() / totalSupply()
// Reverts at the PLUSD level if receiver is not whitelisted (PLUSD._update hook).
// msg.sender must be owner or have sufficient allowance from owner.

function totalAssets() external view returns (uint256);
// Returns PLUSD.balanceOf(address(this)).
// Increases when the bridge mints fresh PLUSD into the vault address.
// Decreases when PLUSD is transferred out on redemption.

function pause() external;   // PAUSER role (foundation multisig via 2-of-5 Risk Council)
function unpause() external;  // PAUSER role
// Pause freezes all deposits and redemptions.
```

All other standard ERC-4626 / ERC-20 view functions (`convertToShares`, `convertToAssets`, `maxDeposit`, `previewDeposit`, `previewRedeem`, `balanceOf`, `totalSupply`, etc.) behave per the OpenZeppelin ERC-4626 implementation without modification.

---

## Data Model

The sPLUSD vault holds no custom on-chain state beyond the standard ERC-4626 / ERC-20 state. The economically relevant quantities are:

| Quantity | Derivation |
|---|---|
| Share price | `totalAssets() / totalSupply()` |
| LP's PLUSD value | `sPLUSD.balanceOf(lp) * totalAssets() / totalSupply()` |
| Yield accrued since stake | `currentValue - costBasis` (tracked per stake lot off-chain by the LP dashboard) |

### Vault deployment parameters

| Parameter | Value | Description |
|---|---|---|
| `asset` | PLUSD contract address | Underlying ERC-20 |
| Dead-shares seed | Small PLUSD amount (TBD at deployment) | Minted to vault, shares sent to `address(0)` to seed `totalAssets` and prevent inflation attack |

---

## Security Considerations

- **No custom vault logic.** sPLUSD is the OpenZeppelin ERC-4626 implementation without modification. Yield accretion requires no custom code; it is a natural consequence of minting PLUSD into the vault address. The audit surface is minimal.
- **Compliance re-entry on redemption.** The whitelist check on PLUSD transfer ensures that sPLUSD holders cannot deliver PLUSD to a non-whitelisted receiver. An attacker who obtains sPLUSD shares through an unrelated exploit cannot extract PLUSD to an unapproved address.
- **Rate limits on yield mints.** Fresh PLUSD minted into the vault is subject to the same on-chain rolling rate limit ($10M/24h) and per-transaction cap ($5M) as deposit mints, bounding the blast radius of a compromised MINTER.
- **Pause capability.** The foundation multisig's 2-of-5 Risk Council fast-pause can freeze all sPLUSD deposits and redemptions immediately, independent of the bridge service state.
- **Dead-shares seed.** Prevents the ERC-4626 inflation attack on the first depositor by ensuring `totalAssets` and `totalSupply` are non-zero at deployment.
- **Open transfer of sPLUSD.** Because sPLUSD has no whitelist check, it can be transferred freely between any addresses. This is intentional for DeFi composability. The risk is accepted because the compliance boundary is enforced at the PLUSD level on any conversion back to the underlying asset.
