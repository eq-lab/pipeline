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
 * G-address of the account that issued the PLUSD classic Stellar asset.
 * Used to read total PLUSD supply via Horizon:
 *   `GET /assets?asset_code=PLUSD&asset_issuer={plusdIssuerId}`
 * → `balances.authorized` gives the total PLUSD in circulation.
 *
 * Futurenet: GB4OHB76JOBQAISRNXU7V5U6KOZGHDKTDDMQRZZS2OLLOCVC7WANZMHH
 * Empty string means "unconfigured" — hook short-circuits to `undefined`.
 */
export const plusdIssuerId: string = ENV.STELLAR_PLUSD_ISSUER_ID;

/**
 * Soroban contract ID for the USDC Stellar Asset Contract (SAC).
 * Used by `useStellarUsdcCustodyBalance` to call `balance(usdcCustodyId)` on-chain.
 *
 * Futurenet: CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI
 * Empty string means "unconfigured" — hook short-circuits to `undefined`.
 */
export const usdcId: string = ENV.STELLAR_USDC_ID;

/**
 * G-address of the account holding Pipeline's USDC in custody.
 * Read via `usdc.balance(usdcCustodyId)` for the "Cash — stablecoins" row on
 * the Balance Sheet panel. This is NOT the total USDC supply — it is only the
 * USDC held in Pipeline's custody account.
 *
 * Futurenet: GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM
 * Empty string means "unconfigured" — hook short-circuits to `undefined`.
 */
export const usdcCustodyId: string = ENV.STELLAR_USDC_CUSTODY_ID;
