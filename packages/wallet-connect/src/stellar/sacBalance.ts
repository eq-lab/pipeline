/**
 * Read-only Soroban SAC (Stellar Asset Contract) `balance(account)` helper —
 * extracted for issue #805 (Trustee Overview: on-chain Capital-Wallet read).
 *
 * Ports the minimal read machinery from the LP frontend's
 * `packages/frontend/src/wallet/stellar/contracts/token.ts` (`TokenClient`),
 * scoped down to the single read this package needs. Lives under
 * `src/stellar/**` — the only place in this package the ESLint
 * `no-restricted-imports` rule permits `@stellar/stellar-sdk` (mirrors
 * `packages/trustee/eslint.config.js`'s TD-33 boundary, which forbids the SDK
 * app-wide in the Trustee — the Trustee has no SDK dependency at all and must
 * go through this package for any Stellar contract read).
 *
 * Deliberately a **plain async function**, not a `useQuery` hook:
 * `@tanstack/react-query` is forbidden outside `src/evm/**` in this package's
 * own ESLint config (mirrors the LP's `wagmi`/AppKit boundary). Callers that
 * want polling/caching (e.g. the Trustee) wrap this in their own `useQuery`,
 * same layering as the LP's `useStellarUsdcCustodyBalance` over `TokenClient`.
 *
 * Per issue #805's Open Question Q1 (resolved): the Soroban RPC URL, network
 * passphrase, and SAC contract id are **explicit function arguments**, not
 * read from `getWalletConnectConfig()` — keeps `WalletConnectConfig` lean and
 * this helper a pure function testable without the config singleton.
 *
 * Scale convention: returns a raw i128 `bigint` at **7-decimal SAC scale**
 * (e.g. `10_000_000n` = 1 USDC). Callers must scale to human units themselves
 * (e.g. via a `raw / 10n**7n` + fraction conversion) before formatting or
 * combining with other sources — do NOT assume 6-decimal EVM scale.
 */
import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  scValToNative,
  rpc as SorobanRpc,
} from "@stellar/stellar-sdk";

/**
 * Null/dummy source account used to simulate a read-only Soroban call. This
 * account need not exist on-chain — `simulateTransaction` never submits the
 * transaction, so no signature or real sequence number is required. Same
 * constant as `packages/frontend/src/wallet/stellar/chain.ts`'s
 * `READ_SIMULATION_SOURCE`.
 */
export const READ_SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/**
 * i64 max value — a SAC `balance()` call on an issuer account returns this
 * sentinel instead of a real balance (the issuer's "balance" is unbounded).
 * Same guard as the LP's `useStellarFinancialPositionReads.ts` — losing it
 * would render a garbage ~$922B figure if a custody id is misconfigured to
 * point at an issuer account.
 */
export const SAC_BALANCE_I64_MAX = 9223372036854775807n;

/** `true` when `raw` is the i64-max issuer sentinel (or above it). */
export function isSacBalanceSentinel(raw: bigint): boolean {
  return raw >= SAC_BALANCE_I64_MAX;
}

export interface GetSacBalanceParams {
  /** Soroban RPC URL (e.g. `https://soroban-testnet.stellar.org`). */
  sorobanRpcUrl: string;
  /** Network passphrase matching the target Stellar network. */
  networkPassphrase: string;
  /** Soroban contract id (`C…`) of the SAC token to read. */
  sacContractId: string;
  /** Stellar account (`G…`/`C…`) whose balance to read. */
  account: string;
}

/**
 * Reads `balance(account)` on the given SAC contract via a read-only Soroban
 * `simulateTransaction` — no signature, no submission, no wallet required.
 *
 * @returns the raw i128 balance as a `bigint`, at 7-decimal SAC scale.
 * @throws if the simulation errors, returns no result, or the balance is the
 *   i64-max issuer sentinel (see `isSacBalanceSentinel`) — callers should
 *   treat a throw as "unavailable" and render `—`, never a fabricated value.
 */
export async function getSacBalance({
  sorobanRpcUrl,
  networkPassphrase,
  sacContractId,
  account,
}: GetSacBalanceParams): Promise<bigint> {
  if (!sacContractId) {
    throw new Error("getSacBalance: sacContractId must not be empty");
  }
  if (!account) {
    throw new Error("getSacBalance: account must not be empty");
  }

  const contract = new Contract(sacContractId);
  const server = new SorobanRpc.Server(sorobanRpcUrl, {
    allowHttp: sorobanRpcUrl.startsWith("http://"),
  });

  const operation = contract.call("balance", new Address(account).toScVal());
  const retval = await simulateReadCall(server, networkPassphrase, operation);
  const raw = scValToNative(retval) as bigint;

  if (isSacBalanceSentinel(raw)) {
    throw new Error(
      "getSacBalance: balance returned i64 max sentinel — the queried " +
        "account may be an issuer account",
    );
  }

  return raw;
}

async function simulateReadCall(
  server: SorobanRpc.Server,
  networkPassphrase: string,
  operation: xdr.Operation,
): Promise<xdr.ScVal> {
  const dummyAccount = new Account(READ_SIMULATION_SOURCE, "0");

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(`getSacBalance simulation error: ${result.error}`);
  }

  if (!result.result) {
    throw new Error("getSacBalance: simulation returned no result");
  }

  return result.result.retval;
}
