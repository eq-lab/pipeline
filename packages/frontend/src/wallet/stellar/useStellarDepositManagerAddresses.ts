/**
 * Stellar analogue of the EVM `useDepositManagerAddresses` hook.
 *
 * Reads `asset()` and `share()` from the on-chain DepositManager contract
 * to derive the USDC and PLUSD SAC contract IDs (and their classic
 * `code:issuer` metadata for trustline checks).
 *
 * Return shape:
 *   - `usdc`       — USDC SAC Soroban contract ID (e.g. `CCWX3…`)
 *   - `plusd`      — PLUSD SAC Soroban contract ID (e.g. `CAC7J…`)
 *   - `usdcAsset`  — classic asset `{ code, issuer }` for USDC trustline checks
 *   - `plusdAsset` — classic asset `{ code, issuer }` for PLUSD trustline checks
 *   - `isLoading`  — `true` while the first query is in-flight
 *   - `error`      — `Error | null` from the underlying query
 *
 * Short-circuit: when `depositManagerId` is empty (env not configured), the
 * hook immediately returns `undefined` data without constructing a client or
 * making any RPC call.
 *
 * Mock layer (localStorage — dev only):
 *   `pipeline.mock.wallet.stellar.contract.usdc`  → USDC SAC contract ID
 *   `pipeline.mock.wallet.stellar.contract.plusd` → PLUSD SAC contract ID
 *   When both keys are set the hook returns the mock values without any RPC.
 *
 * Caching: results are cached forever (addresses are static per deployment).
 *
 * IMPORTANT: The protocol USDC issuer (`GC5SUAXM…`) is derived from the SAC's
 * `name()` return value. This is the single source of truth for the USDC asset
 * across the app — balance reads, trustline checks, and transfers all use it.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Account,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  rpc as SorobanRpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { readMock, useMock } from "../evm/mock";
import { STELLAR_MOCK_KEYS, parseStellarContractId } from "./mock";
import {
  depositManagerId,
  sorobanRpcUrl,
  networkPassphrase,
  READ_SIMULATION_SOURCE,
} from "./chain";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Parsed classic asset identity extracted from a SAC contract. */
export interface ClassicAsset {
  /** Asset code, e.g. `"USDC"` or `"PLUSD"`. */
  code: string;
  /** Classic issuer public key (`G…`). */
  issuer: string;
}

/** Full result of a SAC address pair. */
export interface StellarDepositManagerAddresses {
  /** USDC SAC Soroban contract ID. */
  usdc: string;
  /** PLUSD SAC Soroban contract ID. */
  plusd: string;
  /** Classic `{ code, issuer }` for USDC (needed for trustline/balance reads via Horizon). */
  usdcAsset: ClassicAsset;
  /** Classic `{ code, issuer }` for PLUSD. */
  plusdAsset: ClassicAsset;
}

export interface UseStellarDepositManagerAddressesResult {
  addresses: StellarDepositManagerAddresses | undefined;
  isLoading: boolean;
  error: Error | null;
}

// ── SAC metadata fetch ────────────────────────────────────────────────────────

/**
 * Calls a view method on a Soroban contract and returns the native JS value.
 */
async function callView(
  server: SorobanRpc.Server,
  contractId: string,
  method: string,
): Promise<unknown> {
  const contract = new Contract(contractId);
  const op = contract.call(method);
  // Read-only simulations need a structurally valid classic source account
  // (`G…`) on the envelope — NOT the contract ID. See READ_SIMULATION_SOURCE.
  const dummyAccount = new Account(READ_SIMULATION_SOURCE, "0");

  const tx = new TransactionBuilder(dummyAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `${contractId}.${method}() simulation error: ${result.error}`,
    );
  }

  if (!result.result) {
    throw new Error(`${contractId}.${method}(): simulation returned no result`);
  }

  return scValToNative(result.result.retval);
}

/**
 * Fetches the SAC metadata (`asset()` and `share()`) from the DepositManager
 * contract and then reads each SAC's `name()` to get the classic
 * `"CODE:ISSUER"` string.
 */
async function fetchAddresses(
  contractId: string,
): Promise<StellarDepositManagerAddresses> {
  const server = new SorobanRpc.Server(sorobanRpcUrl, {
    allowHttp: sorobanRpcUrl.startsWith("http://"),
  });

  // `asset()` → USDC SAC contract ID; `share()` → PLUSD SAC contract ID.
  const usdcContractId = (await callView(
    server,
    contractId,
    "asset",
  )) as string;
  const plusdContractId = (await callView(
    server,
    contractId,
    "share",
  )) as string;

  // Each SAC's `name()` view returns the classic asset string: `"CODE:ISSUER"`.
  // (Stellar Asset Contracts expose the classic identity via `name()`; they
  // have no `asset()` view — calling it errors with `Error(Value, InvalidInput)`.)
  const usdcSacAssetStr = (await callView(
    server,
    usdcContractId,
    "name",
  )) as string;
  const plusdSacAssetStr = (await callView(
    server,
    plusdContractId,
    "name",
  )) as string;

  return {
    usdc: usdcContractId,
    plusd: plusdContractId,
    usdcAsset: parseClassicAsset(usdcSacAssetStr, "USDC"),
    plusdAsset: parseClassicAsset(plusdSacAssetStr, "PLUSD"),
  };
}

/**
 * Parses a classic asset string `"CODE:ISSUER"` into `{ code, issuer }`.
 */
function parseClassicAsset(raw: string, fallbackCode: string): ClassicAsset {
  const parts = raw.split(":");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { code: parts[0], issuer: parts[1] };
  }
  console.warn(
    `useStellarDepositManagerAddresses: unexpected SAC asset string "${raw}", expected "CODE:ISSUER"`,
  );
  return { code: fallbackCode, issuer: raw };
}

// ── Known protocol issuer (for mock fast-path) ────────────────────────────────

/**
 * Known protocol classic USDC/PLUSD issuer on testnet (as of 2026-06-10).
 * Used only for the mock fast-path — the real path derives this from the SAC.
 */
const PROTOCOL_ISSUER =
  "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns the USDC and PLUSD SAC contract IDs and their classic asset metadata
 * by reading `asset()` and `share()` from the DepositManager contract.
 *
 * Results are cached forever (addresses are static per deployment).
 * Sits inside the shared `QueryClientProvider` — no second provider needed.
 */
export function useStellarDepositManagerAddresses(): UseStellarDepositManagerAddressesResult {
  // ── Mock read (reactive) ────────────────────────────────────────────────
  const mockUsdc = useMock(
    STELLAR_MOCK_KEYS.contractUsdc,
    parseStellarContractId,
  );
  const mockPlusd = useMock(
    STELLAR_MOCK_KEYS.contractPlusd,
    parseStellarContractId,
  );

  const hasMock = mockUsdc !== undefined && mockPlusd !== undefined;

  // ── Query ─────────────────────────────────────────────────────────────
  const isConfigured = !!depositManagerId;

  const query = useQuery({
    queryKey: ["stellarDepositManagerAddresses", depositManagerId],
    queryFn: async () => {
      // Re-read mock at query-time (covers non-reactive re-runs).
      const mv = readMock(
        STELLAR_MOCK_KEYS.contractUsdc,
        parseStellarContractId,
      );
      const mp = readMock(
        STELLAR_MOCK_KEYS.contractPlusd,
        parseStellarContractId,
      );
      if (mv !== undefined && mp !== undefined) {
        return {
          usdc: mv,
          plusd: mp,
          usdcAsset: { code: "USDC", issuer: PROTOCOL_ISSUER },
          plusdAsset: { code: "PLUSD", issuer: PROTOCOL_ISSUER },
        };
      }
      return fetchAddresses(depositManagerId);
    },
    enabled: !hasMock && isConfigured,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  // ── Mock fast-path ────────────────────────────────────────────────────
  if (hasMock) {
    return {
      addresses: {
        usdc: mockUsdc,
        plusd: mockPlusd,
        usdcAsset: { code: "USDC", issuer: PROTOCOL_ISSUER },
        plusdAsset: { code: "PLUSD", issuer: PROTOCOL_ISSUER },
      },
      isLoading: false,
      error: null,
    };
  }

  // ── Unconfigured short-circuit ────────────────────────────────────────
  if (!isConfigured) {
    return { addresses: undefined, isLoading: false, error: null };
  }

  // ── Real path ─────────────────────────────────────────────────────────
  return {
    addresses: query.data,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}
