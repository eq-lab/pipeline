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

/** Backend chain id used by API routes that dispatch EVM vs Stellar behavior. */
export const stellarChainId: number = ENV.STELLAR_CHAIN_ID;

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

// ── Soroban / Blend constants ──────────────────────────────────────────────────

/**
 * Soroban RPC URL for contract simulation and submission.
 * Distinct from the Horizon REST API — Blend calls go here, not to Horizon.
 */
export const sorobanRpcUrl: string = ENV.STELLAR_RPC_URL;

/** Blend V2 pool contract address on the configured network. */
export const blendPoolId: string = ENV.STELLAR_BLEND_POOL_ID;

/** Blend USDC reserve asset address. */
export const blendUsdcId: string = ENV.STELLAR_BLEND_USDC_ID;

/** Blend XLM reserve asset address. */
export const blendXlmId: string = ENV.STELLAR_BLEND_XLM_ID;

/**
 * Network object the Blend SDK consumes.
 * `passphrase` reuses `networkPassphrase` (the kit Networks enum value IS
 * the passphrase string in v2.x).
 */
export const blendNetwork = {
  rpc: ENV.STELLAR_RPC_URL,
  passphrase: kitNetwork as string,
} as const;

// ── Pipeline protocol contract IDs ─────────────────────────────────────────────

/**
 * Pipeline DepositManager Soroban contract ID.
 * Empty string means "unconfigured" — hooks short-circuit to `undefined`
 * without making any RPC call.
 */
export const depositManagerId: string = ENV.STELLAR_DEPOSIT_MANAGER_ID;

/**
 * Pipeline WithdrawalQueue Soroban contract ID.
 * Empty string means "unconfigured" — hooks short-circuit to `undefined`
 * without making any RPC call.
 */
export const withdrawalQueueId: string = ENV.STELLAR_WITHDRAWAL_QUEUE_ID;
