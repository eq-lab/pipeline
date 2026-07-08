/**
 * Stellar network configuration — the single place where the injected config
 * is mapped to Stellar chain constants.
 *
 * Ported from `packages/frontend/src/wallet/stellar/chain.ts` (#791
 * shared-slice extraction). Mirrors `evm/chain.ts`: config → chain constants,
 * nothing else, made **lazy** for the same reason `evm/chain.ts` is lazy — a
 * module-scope read of `getWalletConnectConfig()` would throw before the
 * consuming app's `main.tsx` calls `setWalletConnectConfig()` (ES module
 * imports are hoisted and evaluated before the importing module's own body
 * runs).
 *
 * The `Networks` enum from `@creit.tech/stellar-wallets-kit` holds the network
 * passphrase strings directly (e.g. `TESTNET = "Test SDF Network ; September 2015"`),
 * so the resolved network doubles as the network passphrase for Horizon/Soroban calls.
 */
import type { Networks } from "@creit.tech/stellar-wallets-kit";
import { getWalletConnectConfig } from "../config";

/**
 * Network passphrase for the configured Stellar network, taken directly from
 * the injected config. The StellarWalletsKit `Networks` enum values ARE the
 * passphrase strings, so the configured passphrase doubles as the kit network
 * value — no hardcoded network-name mapping required.
 */
export function getKitNetwork(): Networks {
  return getWalletConnectConfig().stellarNetworkPassphrase as Networks;
}

/**
 * Network passphrase string. In v2.x the kit `Networks` enum values ARE the
 * passphrases, so this is just an alias of `getKitNetwork()` for Horizon /
 * Soroban calls.
 */
export function getNetworkPassphrase(): string {
  return getKitNetwork();
}
