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
   * Stellar network passphrase — identifies the network for wallet signing and
   * Horizon/Soroban calls. The StellarWalletsKit `Networks` enum values ARE the
   * passphrase strings, so this value is consumed directly as the kit network.
   * Defaults to the Stellar testnet passphrase.
   *
   * Examples:
   *   - testnet:   "Test SDF Network ; September 2015"
   *   - futurenet: "Test SDF Future Network ; October 2022"
   *   - mainnet:   "Public Global Stellar Network ; September 2015"
   */
  STELLAR_NETWORK_PASSPHRASE: readString(
    "VITE_STELLAR_NETWORK_PASSPHRASE",
    "Test SDF Network ; September 2015",
  ),

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
   * Soroban RPC URL — distinct from Horizon. Contract invocations (Pipeline
   * DepositManager / WithdrawalQueue / sPLUSD) go through the Soroban RPC
   * (simulate → assemble → send), NOT Horizon. Defaults to the public Stellar
   * testnet Soroban RPC.
   */
  STELLAR_RPC_URL: readString(
    "VITE_STELLAR_RPC_URL",
    "https://soroban-testnet.stellar.org",
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

  /**
   * PLUSD SAC Soroban contract ID on the configured Stellar network.
   * Futurenet: CBVAYH66RIGA5PKSGHKKGOOQDUPKNVFYBW6P7CGMDX4SD7BI7TXUXSKI
   * Defaults to the empty string — when empty the PLUSD total_supply hook
   * short-circuits to `undefined` without making any RPC call.
   */
  STELLAR_PLUSD_ID: readString("VITE_STELLAR_PLUSD_ID", ""),

  /**
   * USDC SAC Soroban contract ID on the configured Stellar network.
   * Futurenet: CBSUIUCCJKYOAMDYDJHQUJRVOGZIMBBTHWQDOEOZOM4KAMCBKYBP7PLI
   * Defaults to the empty string — when empty the USDC reserve balance hook
   * short-circuits to `undefined` without making any RPC call.
   */
  STELLAR_USDC_ID: readString("VITE_STELLAR_USDC_ID", ""),

  /**
   * The Stellar account (G-address) that holds the protocol's USDC reserve —
   * the "Cash — stablecoins" balance-sheet row reads `usdc.balance(this)`.
   *
   * Confirmed holder (2026-07-02): `GB4OHB76JOBQAISRNXU7V5U6KOZGHDKTDDMQRZZS2OLLOCVC7WANZMHH`
   * (a G-account, not a contract — there is no `capital_wallet` contract in the
   * deployment). Set via `VITE_STELLAR_RESERVE_ACCOUNT_ID`; empty string ⇒
   * unconfigured ⇒ the reserve row short-circuits to `—`.
   */
  STELLAR_RESERVE_ACCOUNT_ID: readString("VITE_STELLAR_RESERVE_ACCOUNT_ID", ""),
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
