/**
 * Typed env accessor — the ONLY place in the codebase that reads
 * `import.meta.env` directly. All other modules must import from here.
 *
 * ESLint's `no-restricted-syntax` rule already enforces this: direct
 * `import.meta.env` access is forbidden outside this file.
 *
 * The trustee app's env surface grew with #791 (sign-in flow): beyond the API
 * base URL, it now needs the chain / RPC / WalletConnect vars the
 * `@pipeline/wallet-connect` slice requires, mirroring the LP frontend's
 * `src/lib/env.ts` names (`packages/frontend/src/lib/env.ts`).
 */

function readString(key: string, defaultValue?: string): string {
  // vite-plugin-runtime-env exposes values via window.__ENV__ at runtime,
  // falling back to import.meta.env at build time.
  const raw: unknown =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof window !== "undefined" && (window as any).__ENV__?.[key]) ||
    import.meta.env[key];

  if (raw !== undefined && raw !== "") return String(raw);
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(
    `Missing required env variable "${key}". Set it in .env or provide it at runtime.`,
  );
}

function readNumber(key: string, defaultValue?: number): number {
  const raw =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof window !== "undefined" && (window as any).__ENV__?.[key]) ||
    import.meta.env[key];

  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isNaN(n)) return n;
    throw new Error(
      `Env variable "${key}" is not a valid number: "${String(raw)}"`,
    );
  }
  if (defaultValue !== undefined) return defaultValue;
  throw new Error(`Missing required env variable "${key}".`);
}

export const ENV = Object.freeze({
  /** Base URL for the Pipeline Relayer REST API. Defaults to the API crate's default port. */
  API_BASE_URL: readString("VITE_API_BASE_URL", "http://localhost:8080"),

  /** EVM chain id — defaults to Hoodi testnet (560048). */
  EVM_CHAIN_ID: readNumber("VITE_EVM_CHAIN_ID", 560048),

  /** EVM RPC URL — defaults to the public Hoodi node. */
  EVM_RPC_URL: readString(
    "VITE_EVM_RPC_URL",
    "https://ethereum-hoodi-rpc.publicnode.com",
  ),

  /**
   * Reown Cloud / WalletConnect v2 project id.
   * Defaults to a placeholder; the AppKit modal will construct successfully
   * but will fail to relay to real wallets until a real id is provided.
   */
  WALLETCONNECT_PROJECT_ID: readString(
    "VITE_WALLETCONNECT_PROJECT_ID",
    "replace-me",
  ),

  /**
   * Stellar network passphrase — identifies the network for wallet signing.
   * Defaults to the Stellar testnet passphrase.
   */
  STELLAR_NETWORK_PASSPHRASE: readString(
    "VITE_STELLAR_NETWORK_PASSPHRASE",
    "Test SDF Network ; September 2015",
  ),

  /**
   * Backend chain id for Stellar auth/API calls. Defaults to the repo's
   * Stellar testnet sentinel; must match the API/worker CHAIN_<id> configuration.
   */
  STELLAR_CHAIN_ID: readNumber("VITE_STELLAR_CHAIN_ID", 99_000_001),
});

/**
 * Test helper — swaps the exported ENV object for the duration of `fn` and
 * restores it afterwards. Only modifiable in test environments.
 */
export function withEnvOverride(
  overrides: Partial<typeof ENV>,
  fn: () => void,
): void {
  const original = { ...ENV };
  Object.assign(ENV, overrides);
  try {
    fn();
  } finally {
    Object.assign(ENV, original);
  }
}
