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

// ── Soroban constants ───────────────────────────────────────────────────────────

/**
 * Soroban RPC URL for contract simulation and submission.
 * Distinct from the Horizon REST API — Soroban contract calls go here, not to
 * Horizon.
 */
export const sorobanRpcUrl: string = ENV.STELLAR_RPC_URL;

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

/**
 * PLUSD SAC Soroban contract ID.
 * Empty string means "unconfigured" — the PLUSD total_supply hook
 * short-circuits to `undefined` without making any RPC call.
 *
 * Futurenet: CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI
 */
export const plusdId: string = ENV.STELLAR_PLUSD_ID;

/**
 * USDC SAC Soroban contract ID.
 * Empty string means "unconfigured" — the USDC reserve balance hook
 * short-circuits to `undefined` without making any RPC call.
 *
 * Futurenet: CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI
 */
export const usdcId: string = ENV.STELLAR_USDC_ID;

/**
 * The Stellar account holding the protocol's USDC reserve.
 * Empty string means "unconfirmed" — the USDC reserve balance hook
 * short-circuits to `undefined` (row renders `—`).
 *
 * TODO (reserve-holder): verify which contract holds the reserve on Futurenet.
 * Default assumption: deposit_manager (CCYQKUAZ7BF22OMXNPF7RJ2D3PDUNV66S3O2L54UYHDYQ4CLMTJHLNWU).
 * Set VITE_STELLAR_RESERVE_ACCOUNT_ID in .env once confirmed.
 */
export const reserveAccountId: string = ENV.STELLAR_RESERVE_ACCOUNT_ID;
