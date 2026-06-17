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

  // ── Blend mock keys ────────────────────────────────────────────────────────

  /**
   * Mock result for `useBlendDeposit`.
   * JSON-encoded `{ hash: "..." }` — when set, `write()` resolves with that
   * object immediately (no RPC, no signing).
   * Example: `localStorage.setItem("pipeline.mock.wallet.stellar.blend.deposit", '{"hash":"abc123"}')`
   */
  blendDeposit: "pipeline.mock.wallet.stellar.blend.deposit",

  /**
   * Mock result for `useBlendWithdraw`.
   * JSON-encoded `{ hash: "..." }` — same semantics as `blendDeposit`.
   */
  blendWithdraw: "pipeline.mock.wallet.stellar.blend.withdraw",

  /**
   * Mock result for `useBlendPosition`.
   * Raw bigint string (7-decimal fixed-point): e.g. `"10000000"` = 1 XLM.
   * The hook scales this by 1e7 to produce the display string.
   */
  blendPosition: "pipeline.mock.wallet.stellar.blend.position",

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

// ── Blend non-reactive readers ─────────────────────────────────────────────────

/**
 * Read the mock Blend deposit result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash }` or `undefined`.
 */
export function readMockBlendDeposit(): { hash: string } | undefined {
  return readMock(STELLAR_MOCK_KEYS.blendDeposit, parseJson<{ hash: string }>);
}

/**
 * Read the mock Blend withdraw result (non-reactive, for write-hook callbacks).
 * Returns parsed `{ hash }` or `undefined`.
 */
export function readMockBlendWithdraw(): { hash: string } | undefined {
  return readMock(STELLAR_MOCK_KEYS.blendWithdraw, parseJson<{ hash: string }>);
}

/**
 * Read the mock Blend position as a raw bigint string (non-reactive).
 * Returns `bigint` or `undefined`.
 */
export function readMockBlendPosition(): bigint | undefined {
  return readMock(STELLAR_MOCK_KEYS.blendPosition, parseBigInt);
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
