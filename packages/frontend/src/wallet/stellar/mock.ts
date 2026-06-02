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

import { readMock, useMock, parseBoolean } from "../evm/mock";

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
