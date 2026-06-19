/**
 * Stellar localStorage mock layer.
 *
 * Mirrors the EVM mock layer in `../evm/mock.ts`. Reuses the shared primitives
 * (`readMock`, `useMock`, `parseBoolean`) — no duplicated infrastructure.
 *
 * The same-tab mock bridge (`installSameTabMockBridge`) is installed once by
 * `EvmWalletProvider` and covers all `pipeline.mock.*` keys, so Stellar mock
 * key changes fan out to subscribers automatically. Do NOT call
 * `installSameTabMockBridge` again from `StellarWalletProvider`.
 *
 * See `packages/frontend/src/wallet/README.md` for the full Stellar mock key
 * schema and DevTools console snippets.
 */

import {
  readMock,
  useMock,
  parseBoolean,
  parseBigInt,
  parseJson,
} from "../evm/mock";

// ── Key constants ──────────────────────────────────────────────────────────────

export const STELLAR_MOCK_KEYS = {
  /** Stellar public key (`G…` 56-char strkey) for the mock wallet address. */
  address: "pipeline.mock.wallet.stellar.address",
  /** `"true"` / `"false"` — connection state override. */
  isConnected: "pipeline.mock.wallet.stellar.isConnected",
  /**
   * Human-scaled decimal string USDC balance, matching what the Horizon API
   * returns (e.g. `"1.5"` = 1.5 USDC, `"1234.5678900"` = ~1234.57 USDC).
   * Do NOT use a 7-decimal integer string here — the hook passes this value
   * directly to `formatUsdcDisplay` without any scaling math.
   */
  balanceUsdc: "pipeline.mock.wallet.stellar.balance.usdc",

  // ── Protocol contract mock keys ────────────────────────────────────────────

  /**
   * Mock USDC SAC contract ID for `useStellarDepositManagerAddresses`.
   * Must be a valid Soroban contract ID string (starts with "C", 56 chars).
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.contract.usdc", "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7")`
   */
  contractUsdc: "pipeline.mock.wallet.stellar.contract.usdc",

  /**
   * Mock PLUSD SAC contract ID for `useStellarDepositManagerAddresses`.
   * Must be a valid Soroban contract ID string (starts with "C", 56 chars).
   */
  contractPlusd: "pipeline.mock.wallet.stellar.contract.plusd",

  /**
   * Mock USDC SAC balance for `useStellarSacToken` (protocol USDC).
   * Raw bigint string in 7-decimal fixed-point (e.g. `"10000000"` = 1 USDC).
   * The hook returns this raw value; callers scale with `sacRawToDisplay`.
   */
  balanceSacUsdc: "pipeline.mock.wallet.stellar.balance.sac.usdc",

  /**
   * Mock PLUSD SAC balance for `useStellarSacToken` (protocol PLUSD).
   * Raw bigint string in 7-decimal fixed-point (e.g. `"10000000"` = 1 PLUSD).
   */
  balanceSacPlusd: "pipeline.mock.wallet.stellar.balance.sac.plusd",

  // ── DepositManager mock keys ───────────────────────────────────────────────

  /**
   * Mock result for `useStellarRequestDeposit`.
   * JSON-encoded `{ hash: "...", requestId?: "123" }` — when set, `write()` resolves
   * with that object immediately (no RPC, no signing).
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.depositManager.requestDeposit", '{"hash":"abc123","requestId":"42"}')`
   */
  depositManagerRequestDeposit:
    "pipeline.mock.wallet.stellar.depositManager.requestDeposit",

  /**
   * Mock result for `useStellarClaim`.
   * JSON-encoded `{ hash: "..." }` — when set, `write()` resolves with that
   * object immediately (no RPC, no signing).
   */
  depositManagerClaim: "pipeline.mock.wallet.stellar.depositManager.claim",

  /**
   * Mock result for `useChangeTrust` / `useStellarChangeTrustUsdc`.
   * JSON-encoded `{ hash: "..." }` — when set, `submit()` resolves with that
   * object immediately (no Horizon, no signing).
   * Shared between the deposit (PLUSD) and withdraw (USDC) changeTrust hooks.
   */
  changeTrust: "pipeline.mock.wallet.stellar.changeTrust",

  // ── WithdrawalQueue mock keys ──────────────────────────────────────────────

  /**
   * Mock result for `useStellarRequestWithdrawal`.
   * JSON-encoded `{ hash: "...", requestId?: "123" }` — when set, `write()` resolves
   * with that object immediately (no RPC, no signing).
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal", '{"hash":"abc123","requestId":"42"}')`
   */
  withdrawalQueueRequestWithdrawal:
    "pipeline.mock.wallet.stellar.withdrawalQueue.requestWithdrawal",

  /**
   * Mock result for `useStellarClaimWithdrawal`.
   * JSON-encoded `{ hash: "..." }` — when set, `write()` resolves with that
   * object immediately (no RPC, no signing).
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.withdrawalQueue.claimWithdrawal", '{"hash":"abc123"}')`
   */
  withdrawalQueueClaimWithdrawal:
    "pipeline.mock.wallet.stellar.withdrawalQueue.claimWithdrawal",

  // ── StakedPLUSD mock keys ──────────────────────────────────────────────────

  /**
   * Mock result for `useStellarStake` (deposit to FungibleVault).
   * JSON-encoded `{ hash: "...", shares?: "10000000" }` — when set, `write()`
   * resolves with that object immediately (no RPC, no signing).
   * `shares` is optional; if present it is the raw 7-decimal sPLUSD amount returned.
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.stakedPlusd.stake", '{"hash":"abc123","shares":"9600000"}')`
   */
  stakedPlusdStake: "pipeline.mock.wallet.stellar.stakedPlusd.stake",

  /**
   * Mock result for `useStellarUnstake` (redeem from FungibleVault).
   * JSON-encoded `{ hash: "...", assets?: "10400000" }` — when set, `write()`
   * resolves with that object immediately (no RPC, no signing).
   * `assets` is optional; if present it is the raw 7-decimal PLUSD amount returned.
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.stakedPlusd.unstake", '{"hash":"abc123","assets":"10400000"}')`
   */
  stakedPlusdUnstake: "pipeline.mock.wallet.stellar.stakedPlusd.unstake",

  /**
   * Mock result for `useStellarChangeTrustStakedPlusd` (sPLUSD trustline).
   * JSON-encoded `{ hash: "..." }` — when set, `submit()` resolves with that
   * object immediately (no Horizon, no signing).
   * Note: the shared `changeTrust` key also works for this hook.
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.stakedPlusd.changeTrust", '{"hash":"abc123"}')`
   */
  stakedPlusdChangeTrust:
    "pipeline.mock.wallet.stellar.stakedPlusd.changeTrust",

  /**
   * Mock rate for `useStellarStakeConvertToShares`.
   * Raw bigint string at 7-decimal SAC scale representing a rate applied to
   * the input: output = (input * rate) / 1e7.
   * Example: `"9600000"` means 0.96 sPLUSD per PLUSD (96% exchange rate).
   * Convention: uses 1e7 (SAC scale), NOT 1e18 (EVM scale) — do NOT copy from
   * the EVM mock to avoid the #541 off-by-powers-of-ten class of bug.
   */
  stakedPlusdConvertToShares:
    "pipeline.mock.wallet.stellar.stakedPlusd.convertToShares",

  /**
   * Mock rate for `useStellarUnstakeConvertToAssets`.
   * Raw bigint string at 7-decimal SAC scale: output = (input * rate) / 1e7.
   * Example: `"10400000"` means 1.04 PLUSD per sPLUSD.
   */
  stakedPlusdConvertToAssets:
    "pipeline.mock.wallet.stellar.stakedPlusd.convertToAssets",

  /**
   * Mock sPLUSD share balance for `useStellarStakedPlusdBalance`.
   * Raw bigint string in 7-decimal fixed-point (e.g. `"10000000"` = 1 sPLUSD).
   */
  stakedPlusdShareBalance:
    "pipeline.mock.wallet.stellar.stakedPlusd.shareBalance",
} as const;

// ── Parse helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a Stellar strkey address (`G…` 56-char base-32 public key).
 * Throws on values that don't look like a Stellar public key so that
 * `readMock`/`useMock` returns `undefined` for clearly-wrong values (e.g. an
 * EVM `0x…` address accidentally written to the wrong key).
 *
 * The check is intentionally loose (starts with "G", 56 chars) — the full
 * base-32 validation is not needed for a dev-only mock layer.
 */
export function parseStellarAddress(raw: string): string {
  if (!raw.startsWith("G") || raw.length !== 56) {
    throw new Error(
      `Not a Stellar public key: "${raw}" (expected a 56-char G… strkey)`,
    );
  }
  return raw;
}

/**
 * Parse a Stellar Soroban contract ID strkey (`C…` 56-char base-32).
 * Throws on values that don't look like a Soroban contract ID so that
 * `readMock`/`useMock` returns `undefined` for clearly-wrong values.
 */
export function parseStellarContractId(raw: string): string {
  if (!raw.startsWith("C") || raw.length !== 56) {
    throw new Error(
      `Not a Soroban contract ID: "${raw}" (expected a 56-char C… strkey)`,
    );
  }
  return raw;
}

// ── Non-reactive reader ────────────────────────────────────────────────────────

/** Read the mock Stellar address without subscribing to changes. */
export function readMockStellarAddress(): string | undefined {
  return readMock(STELLAR_MOCK_KEYS.address, parseStellarAddress);
}

/** Read the mock Stellar `isConnected` flag without subscribing to changes. */
export function readMockStellarIsConnected(): boolean | undefined {
  return readMock(STELLAR_MOCK_KEYS.isConnected, parseBoolean);
}

// ── Reactive hooks ─────────────────────────────────────────────────────────────

/** Reactive hook: re-renders when the mock Stellar address changes. */
export function useMockStellarAddress(): string | undefined {
  return useMock(STELLAR_MOCK_KEYS.address, parseStellarAddress);
}

/** Reactive hook: re-renders when the mock Stellar `isConnected` flag changes. */
export function useMockStellarIsConnected(): boolean | undefined {
  return useMock(STELLAR_MOCK_KEYS.isConnected, parseBoolean);
}

// ── DepositManager non-reactive readers ───────────────────────────────────────

/**
 * Read the mock `useStellarRequestDeposit` result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash, requestId? }` or `undefined`.
 */
export function readMockStellarRequestDeposit():
  | { hash: string; requestId?: string }
  | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.depositManagerRequestDeposit,
    parseJson<{ hash: string; requestId?: string }>,
  );
}

/**
 * Read the mock `useStellarClaim` result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash }` or `undefined`.
 */
export function readMockStellarClaim(): { hash: string } | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.depositManagerClaim,
    parseJson<{ hash: string }>,
  );
}

/**
 * Read the mock `useChangeTrust` / `useStellarChangeTrustUsdc` result (non-reactive).
 * Returns parsed `{ hash }` or `undefined`.
 * Shared by both the deposit (PLUSD) and withdraw (USDC) changeTrust hooks.
 */
export function readMockStellarChangeTrust(): { hash: string } | undefined {
  return readMock(STELLAR_MOCK_KEYS.changeTrust, parseJson<{ hash: string }>);
}

// ── WithdrawalQueue non-reactive readers ───────────────────────────────────────

/**
 * Read the mock `useStellarRequestWithdrawal` result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash, requestId? }` or `undefined`.
 */
export function readMockStellarRequestWithdrawal():
  | { hash: string; requestId?: string }
  | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.withdrawalQueueRequestWithdrawal,
    parseJson<{ hash: string; requestId?: string }>,
  );
}

/**
 * Read the mock `useStellarClaimWithdrawal` result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash }` or `undefined`.
 */
export function readMockStellarClaimWithdrawal(): { hash: string } | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.withdrawalQueueClaimWithdrawal,
    parseJson<{ hash: string }>,
  );
}

// ── StakedPLUSD non-reactive readers ──────────────────────────────────────────

/**
 * Read the mock `useStellarStake` (deposit) result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash, shares? }` or `undefined`.
 */
export function readMockStellarStake():
  | { hash: string; shares?: string }
  | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.stakedPlusdStake,
    parseJson<{ hash: string; shares?: string }>,
  );
}

/**
 * Read the mock `useStellarUnstake` (redeem) result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash, assets? }` or `undefined`.
 */
export function readMockStellarUnstake():
  | { hash: string; assets?: string }
  | undefined {
  return readMock(
    STELLAR_MOCK_KEYS.stakedPlusdUnstake,
    parseJson<{ hash: string; assets?: string }>,
  );
}

/**
 * Read the mock `useStellarChangeTrustStakedPlusd` result (non-reactive).
 * Falls back to the shared `changeTrust` key if the specific key is not set.
 * Returns parsed `{ hash }` or `undefined`.
 */
export function readMockStellarChangeTrustStakedPlusd():
  | { hash: string }
  | undefined {
  return (
    readMock(
      STELLAR_MOCK_KEYS.stakedPlusdChangeTrust,
      parseJson<{ hash: string }>,
    ) ?? readMockStellarChangeTrust()
  );
}

/**
 * Read the mock convertToShares rate (non-reactive).
 * Returns a raw bigint rate at 7-decimal SAC scale, or `undefined`.
 */
export function readMockStellarStakedPlusdConvertToShares():
  | bigint
  | undefined {
  return readMock(STELLAR_MOCK_KEYS.stakedPlusdConvertToShares, parseBigInt);
}

/**
 * Read the mock convertToAssets rate (non-reactive).
 * Returns a raw bigint rate at 7-decimal SAC scale, or `undefined`.
 */
export function readMockStellarStakedPlusdConvertToAssets():
  | bigint
  | undefined {
  return readMock(STELLAR_MOCK_KEYS.stakedPlusdConvertToAssets, parseBigInt);
}

/**
 * Read the mock sPLUSD share balance (non-reactive).
 * Returns a raw bigint at 7-decimal scale, or `undefined`.
 */
export function readMockStellarStakedPlusdShareBalance(): bigint | undefined {
  return readMock(STELLAR_MOCK_KEYS.stakedPlusdShareBalance, parseBigInt);
}
