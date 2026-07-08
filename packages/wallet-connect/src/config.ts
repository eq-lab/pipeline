/**
 * Shared wallet-connect config — the values each consuming app (LP frontend,
 * Trustee) must supply before the EVM/Stellar modules initialise.
 *
 * This package has no `@/lib/env` of its own (unlike `packages/frontend` and
 * `packages/trustee`, each of which owns its env accessor) — each app reads
 * its own env vars and calls `setWalletConnectConfig` once, before rendering
 * `EvmWalletProvider` / `StellarWalletProvider`. This keeps the package
 * decoupled from any particular app's Vite env plumbing.
 */
export interface WalletConnectConfig {
  /** EVM chain id (e.g. 560048 for Hoodi). */
  evmChainId: number;
  /** EVM RPC URL for the configured chain. */
  evmRpcUrl: string;
  /** Reown Cloud / WalletConnect v2 project id. */
  walletConnectProjectId: string;
  /** Stellar network passphrase (also used as the StellarWalletsKit network). */
  stellarNetworkPassphrase: string;
  /** App display metadata surfaced by the AppKit connect modal. */
  appName: string;
  appDescription: string;
}

let config: WalletConnectConfig | null = null;

/**
 * Set the active config. Call once at the very start of the consuming app's
 * bootstrap (e.g. the top of `main.tsx`), before rendering `EvmWalletProvider`
 * / `StellarWalletProvider`. Those providers — and everything they lazily
 * construct (AppKit, the wagmi adapter, the Stellar kit) — read this config
 * only inside functions called at render/init time, never at module scope,
 * specifically so that import order does not matter and this call does not
 * need to precede any particular import.
 */
export function setWalletConnectConfig(next: WalletConnectConfig): void {
  config = next;
}

/** Read the active config. Throws if `setWalletConnectConfig` was not called. */
export function getWalletConnectConfig(): WalletConnectConfig {
  if (!config) {
    throw new Error(
      "@pipeline/wallet-connect: setWalletConnectConfig() must be called " +
        "before any wallet-connect module is used.",
    );
  }
  return config;
}

/** Test helper — resets the config so tests can set their own. */
export function _resetWalletConnectConfigForTests(): void {
  config = null;
}
