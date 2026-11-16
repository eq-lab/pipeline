# Issue #1684 — Trustee: EVM custody balance on the Capital Allocation card

## Story

As a Trustee signed in with an EVM wallet, I need the Overview Capital Allocation card to show the deposit custody USDC balance in the Capital Wallet row, so the balance sheet is not blank on EVM the way it never is on Stellar.

## Test cases

### An EVM session shows the Hoodi custody balance

1. Set `VITE_EVM_USDC_ADDRESS` and `VITE_EVM_USDC_CUSTODY_ADDRESS` and sign in to the Trustee app with an EVM wallet on Hoodi.
2. Open `/` and confirm the Capital Allocation card carries the Hoodi chip.
3. Confirm the Capital Wallet row shows the custody USDC balance (about `$10K` on the Hoodi testnet custody) instead of `—`.
4. Confirm the card total includes that balance when the backend `capital_wallet` bucket is `null`.
5. In the Network tab confirm `eth_call` requests to the EVM RPC URL for `balanceOf` and `decimals` on the USDC token, and no Soroban RPC call.

### A Stellar session is unchanged

1. Sign in with a Stellar wallet and open `/`.
2. Confirm the card carries the Stellar chip and the Capital Wallet row shows the Stellar custody figure.
3. In the Network tab confirm no `eth_call` to the EVM RPC URL is made for the custody balance.

### An unset EVM pair shows a dash

1. Leave `VITE_EVM_USDC_ADDRESS` or `VITE_EVM_USDC_CUSTODY_ADDRESS` empty and sign in with an EVM wallet.
2. Confirm the Capital Wallet row shows `—`, the total is the backend total only and the card still renders without an error.
3. Confirm no `eth_call` for the custody balance is sent.

### Switching chains never shows the other chain's figure

1. Open `/` on a Stellar session and note the Capital Wallet figure.
2. Sign out and sign in with an EVM wallet, then confirm the row shows the EVM custody figure or `—`, never the Stellar number.
3. Repeat in the other direction and confirm the Stellar figure is not replaced by the EVM one.

### An RPC failure degrades only the Capital Wallet row

1. Point `VITE_EVM_RPC_URL` at an unreachable URL and open `/` on an EVM session.
2. Confirm the Capital Wallet row shows `—` and the other buckets, the total and the rest of the page still render with no card-level error.
