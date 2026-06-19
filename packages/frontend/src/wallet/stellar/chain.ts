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
 * Network passphrase for the configured Stellar network, taken directly from
 * `VITE_STELLAR_NETWORK_PASSPHRASE`. The StellarWalletsKit `Networks` enum
 * values ARE the passphrase strings (e.g. `TESTNET = "Test SDF Network ;
 * September 2015"`), so the env passphrase doubles as the kit network value —
 * no hardcoded network-name mapping required, which lets any network (testnet,
 * futurenet, mainnet, standalone) be configured purely via env.
 */
export const kitNetwork: Networks = ENV.STELLAR_NETWORK_PASSPHRASE as Networks;

/**
 * Network passphrase string. In v2.x the kit `Networks` enum values ARE the
 * passphrases, so this is just an alias of `kitNetwork` exposed as a string for
 * Horizon / Soroban calls landing in sub-issue 2.
 */
export const networkPassphrase: string = kitNetwork;

/** Stellar Horizon base URL for the configured network. */
export const horizonUrl: string = ENV.STELLAR_HORIZON_URL;

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

/**
 * Source account for read-only contract simulations.
 *
 * Soroban `simulateTransaction` needs a structurally valid source account on
 * the envelope, but for read-only (view) calls it is never charged or
 * authenticated, so any valid account works. This is the canonical "null"
 * account — the all-zero ed25519 public key.
 *
 * IMPORTANT: do NOT pass a contract ID (`C…`) here. `new Account()` only
 * accepts a classic ed25519 public key (`G…`) and throws `accountId is
 * invalid` for a contract address.
 */
export const READ_SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

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

/**
 * Pipeline StakedPLUSD (sPLUSD) FungibleVault Soroban contract ID.
 * Empty string means "unconfigured" — hooks short-circuit to `undefined`
 * without making any RPC call.
 */
export const stakedPlusdId: string = ENV.STELLAR_STAKED_PLUSD_ID;
