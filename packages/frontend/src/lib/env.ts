/**
 * Typed env accessor — the ONLY place in the codebase that reads
 * `import.meta.env` directly.  All other modules must import from here.
 *
 * ESLint's `no-restricted-syntax` rule already enforces this: direct
 * `import.meta.env` access is forbidden outside this file.
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
  /** Base URL for the Pipeline REST API. Defaults to the API crate's default port. */
  API_BASE_URL: readString("VITE_API_BASE_URL", "http://localhost:8080"),

  /** EVM chain id — defaults to Hoodi testnet (560048). */
  EVM_CHAIN_ID: readNumber("VITE_EVM_CHAIN_ID", 560048),

  /** EVM RPC URL — defaults to the public Hoodi node. */
  EVM_RPC_URL: readString(
    "VITE_EVM_RPC_URL",
    "https://ethereum-hoodi-rpc.publicnode.com",
  ),

  /**
   * DepositManager contract address on the configured chain.
   * Defaults to the zero address; when zero the wallet module short-circuits
   * all DepositManager hooks and returns `undefined` data without making any
   * RPC call.
   */
  DEPOSIT_MANAGER_ADDRESS: readString(
    "VITE_DEPOSIT_MANAGER_ADDRESS",
    "0x0000000000000000000000000000000000000000",
  ) as `0x${string}`,

  /**
   * WithdrawalQueue contract address on the configured chain.
   * Defaults to the zero address; when zero the wallet module short-circuits
   * all WithdrawalQueue hooks and returns `undefined` data without making any
   * RPC call.
   */
  WITHDRAWAL_QUEUE_ADDRESS: readString(
    "VITE_WITHDRAWAL_QUEUE_ADDRESS",
    "0x0000000000000000000000000000000000000000",
  ) as `0x${string}`,

  /**
   * StakedPLUSD (sPLUSD) ERC-4626 vault contract address on the configured chain.
   * Defaults to the zero address; when zero the wallet module short-circuits
   * all StakedPLUSD hooks and returns `undefined` data without making any
   * RPC call.
   */
  STAKED_PLUSD_ADDRESS: readString(
    "VITE_STAKED_PLUSD_ADDRESS",
    "0x0000000000000000000000000000000000000000",
  ) as `0x${string}`,

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
   * Stellar network identifier. Accepts `"testnet"` (default) or `"mainnet"`.
   * Maps to the StellarWalletsKit `Networks` enum value at runtime.
   */
  STELLAR_NETWORK: readString("VITE_STELLAR_NETWORK", "testnet"),

  /**
   * Backend chain id for Stellar API calls. Defaults to the repo's Stellar
   * testnet sentinel; must match the API/worker CHAIN_<id> configuration.
   */
  STELLAR_CHAIN_ID: readNumber("VITE_STELLAR_CHAIN_ID", 99_000_001),

  /**
   * Stellar Horizon server URL used for balance and account queries (sub-issue 2).
   * Defaults to the public Stellar testnet Horizon instance.
   */
  STELLAR_HORIZON_URL: readString(
    "VITE_STELLAR_HORIZON_URL",
    "https://horizon-testnet.stellar.org",
  ),

  /**
   * Soroban RPC URL — distinct from Horizon. Contract invocations (Blend
   * deposit/withdraw) go through the Soroban RPC (simulate → assemble → send),
   * NOT Horizon. Defaults to the public Stellar testnet Soroban RPC.
   */
  STELLAR_RPC_URL: readString(
    "VITE_STELLAR_RPC_URL",
    "https://soroban-testnet.stellar.org",
  ),

  /**
   * Blend lending-pool contract ID used as the testnet deposit/withdraw target.
   * Defaults to Blend's "TestnetV2" pool (reserves: XLM, USDC, wETH, wBTC).
   * Source: github.com/blend-capital/blend-utils → testnet.contracts.json.
   * NOTE: Stellar testnet is periodically reset; if calls start failing with
   * "contract not found", re-pull the current ID from blend-utils.
   */
  STELLAR_BLEND_POOL_ID: readString(
    "VITE_STELLAR_BLEND_POOL_ID",
    "CCEBVDYM32YNYCVNRXQKDFFPISJJCV557CDZEIRBEE4NCV4KHPQ44HGF",
  ),

  /**
   * Blend testnet USDC reserve — a Soroban token contract (NOT the protocol
   * USDC asset derived on-chain from the DepositManager). This is the `address`
   * passed in a Blend supply/withdraw request when depositing USDC.
   */
  STELLAR_BLEND_USDC_ID: readString(
    "VITE_STELLAR_BLEND_USDC_ID",
    "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU",
  ),

  /**
   * Blend testnet XLM reserve (the native-asset Stellar Asset Contract).
   * Easiest asset to test a deposit with: fund the account from Friendbot
   * (https://friendbot.stellar.org/?addr=…) — no token faucet required.
   */
  STELLAR_BLEND_XLM_ID: readString(
    "VITE_STELLAR_BLEND_XLM_ID",
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  ),

  /**
   * Pipeline protocol DepositManager Soroban contract ID on the configured
   * Stellar network.
   * Defaults to the empty string (no sentinel address exists for Soroban).
   * When empty, all DepositManager hooks short-circuit and return `undefined`
   * without making any RPC call — mirrors the EVM zero-address short-circuit
   * semantics.
   */
  STELLAR_DEPOSIT_MANAGER_ID: readString("VITE_STELLAR_DEPOSIT_MANAGER_ID", ""),

  /**
   * Pipeline protocol WithdrawalQueue Soroban contract ID on the configured
   * Stellar network.
   * Defaults to the empty string — same short-circuit semantics as
   * `STELLAR_DEPOSIT_MANAGER_ID` above.
   */
  STELLAR_WITHDRAWAL_QUEUE_ID: readString(
    "VITE_STELLAR_WITHDRAWAL_QUEUE_ID",
    "",
  ),

  /**
   * Pipeline protocol StakedPLUSD (sPLUSD) FungibleVault Soroban contract ID
   * on the configured Stellar network.
   * Defaults to the empty string — same short-circuit semantics as
   * `STELLAR_DEPOSIT_MANAGER_ID` above.
   * When empty, all StakedPLUSD hooks short-circuit and return `undefined`
   * without making any RPC call.
   */
  STELLAR_STAKED_PLUSD_ID: readString("VITE_STELLAR_STAKED_PLUSD_ID", ""),
});

/**
 * Test helper — swaps the exported ENV object for the duration of `fn` and
 * restores it afterwards.  Only modifiable in test environments.
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
