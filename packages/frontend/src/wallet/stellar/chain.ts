/**
 * Stellar network configuration — the single place where env vars are mapped
 * to Stellar chain constants.
 *
 * Mirrors `evm/chain.ts`: env → chain config, nothing else.
 *
 * The `Networks` enum from `@creit.tech/stellar-wallets-kit` holds the network
 * passphrase strings directly (e.g. `TESTNET = "Test SDF Network ; September 2015"`),
 * so `kitNetwork` doubles as the network passphrase for Horizon/Soroban calls.
 */
import { Networks } from "@creit.tech/stellar-wallets-kit";
import { ENV } from "@/lib/env";

/**
 * Map the human-readable `VITE_STELLAR_NETWORK` value to the kit's `Networks`
 * enum. Falls back to `TESTNET` for any unrecognised value so the app stays
 * functional during development without requiring an explicit env override.
 */
function resolveKitNetwork(network: string): Networks {
  if (network === "mainnet") return Networks.PUBLIC;
  return Networks.TESTNET;
}

/** Kit `Networks` enum value for the configured network. */
export const kitNetwork: Networks = resolveKitNetwork(ENV.STELLAR_NETWORK);

/**
 * Network passphrase string. In v2.x the kit `Networks` enum values ARE the
 * passphrases, so this is just an alias of `kitNetwork` exposed as a string for
 * Horizon / Soroban calls landing in sub-issue 2.
 */
export const networkPassphrase: string = kitNetwork;

/** Stellar Horizon base URL for the configured network. */
export const horizonUrl: string = ENV.STELLAR_HORIZON_URL;

/** Circle USDC issuer address on the configured Stellar network. */
export const usdcIssuer: string = ENV.STELLAR_USDC_ISSUER;
