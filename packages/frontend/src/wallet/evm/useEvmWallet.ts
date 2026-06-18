/**
 * Public wallet hooks — all blockchain access in the app goes through here.
 *
 * Each hook consults the `pipeline.mock.wallet.*` localStorage layer first.
 * When a mock key is present the real wagmi/viem call is skipped entirely
 * (no network request).
 */
import {
  useAccount,
  useChainId,
  useDisconnect,
  useReadContract,
  useConnect,
  useConnectors,
} from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import type { Abi } from "viem";
import {
  useMock,
  parseAddress,
  parseBoolean,
  parseNumber,
  parseJson,
} from "./mock";
import { readTermsAcknowledged } from "../useTermsAcknowledgement";
import { useWalletGate } from "../WalletGateContext";

// ── Keys ─────────────────────────────────────────────────────────────────────

const KEYS = {
  address: "pipeline.mock.wallet.address",
  isConnected: "pipeline.mock.wallet.isConnected",
  chainId: "pipeline.mock.wallet.chainId",
  contract: (address: string, fn: string) =>
    `pipeline.mock.wallet.contract.${address.toLowerCase()}.${fn}`,
};

// ── Main hook ─────────────────────────────────────────────────────────────────

export interface WalletState {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  chainId: number | undefined;
  connect(): void;
  disconnect(): void;
}

export function useEvmWallet(): WalletState {
  const { address: realAddress, isConnected: realIsConnected } = useAccount();
  const realChainId = useChainId();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { open } = useAppKit();
  const { openGate } = useWalletGate();

  const mockAddress = useMock(KEYS.address, parseAddress);
  const mockIsConnected = useMock(KEYS.isConnected, parseBoolean);
  const mockChainId = useMock(KEYS.chainId, parseNumber);

  const address = mockAddress ?? realAddress;
  // If the mock address is set but isConnected key is absent → default true.
  const isConnected =
    mockIsConnected !== undefined
      ? mockIsConnected
      : mockAddress !== undefined
        ? true
        : realIsConnected;
  const chainId = mockChainId ?? realChainId;

  function connect() {
    // Mock short-circuit — dev affordance, bypasses the terms gate.
    if (mockAddress !== undefined) {
      return;
    }

    // Check terms acknowledgement synchronously (chain-agnostic, argument-less).
    // If not acknowledged, open the gate and pass AppKit open() as the onProceed
    // callback — the gate will invoke it after the user attests.
    if (!readTermsAcknowledged()) {
      openGate(() => void open());
      return;
    }

    void open();
  }

  function disconnect() {
    if (mockAddress !== undefined) {
      console.warn(
        "[wallet mock] To disconnect the mock wallet, clear the localStorage keys:\n" +
          "  localStorage.removeItem('pipeline.mock.wallet.address')\n" +
          "  localStorage.removeItem('pipeline.mock.wallet.isConnected')",
      );
      return;
    }
    wagmiDisconnect();
  }

  return { address, isConnected, chainId, connect, disconnect };
}

// ── Per-wallet EVM connect hook ───────────────────────────────────────────────

/**
 * A well-known EVM connector id (the subset the app exposes in the Connect modal).
 *
 * These are the ids that wagmi / Reown AppKit registers for the bundled wallets:
 *   - "injected"        — MetaMask (and other injected providers)
 *   - "coinbaseWallet"  — Coinbase Wallet SDK
 *   - "walletConnect"   — WalletConnect v2 (covers Trust and other mobile wallets)
 *
 * Trust Wallet does not have a dedicated AppKit adapter in the current config;
 * it is accessible via WalletConnect or the injected provider path.
 */
export type EvmWalletConnectorId =
  | "injected"
  | "coinbaseWallet"
  | "walletConnect";

export interface UseEvmConnectorsResult {
  /**
   * Connect to a specific EVM wallet by its connector id.
   *
   * - When a mock address is set: no-op (dev affordance).
   * - Otherwise: calls wagmi `connect({ connector })` for the matching connector.
   * - When no matching connector is found: falls back to the generic AppKit modal.
   *
   * The terms gate is no longer triggered here. It is interposed by
   * `ConnectModalProvider.open()` before `ConnectWalletModal` opens, so the
   * gate always precedes the wallet picker (issue #639).
   */
  connectWallet(connectorId: EvmWalletConnectorId): void;
}

export function useEvmConnectors(): UseEvmConnectorsResult {
  const connectors = useConnectors();
  const { connect } = useConnect();
  const { open } = useAppKit();

  const mockAddress = useMock(KEYS.address, parseAddress);

  function connectWallet(connectorId: EvmWalletConnectorId) {
    // Mock short-circuit.
    if (mockAddress !== undefined) {
      return;
    }

    const connector = connectors.find((c) => c.id === connectorId);
    if (connector) {
      connect({ connector });
    } else {
      // No matching connector — fall back to the generic AppKit modal.
      void open();
    }
  }

  return { connectWallet };
}

// ── Contract read hook ────────────────────────────────────────────────────────

export interface UseContractReadArgs<
  TAbi extends Abi,
  TFunctionName extends string,
> {
  address: `0x${string}`;
  abi: TAbi;
  functionName: TFunctionName;
  args?: readonly unknown[];
}

export interface ContractReadResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useContractRead<TAbi extends Abi, TFunctionName extends string>(
  params: UseContractReadArgs<TAbi, TFunctionName>,
): ContractReadResult<unknown> {
  const mockKey = KEYS.contract(params.address, params.functionName);
  const mockValue = useMock(mockKey, parseJson);

  const hasMock = mockValue !== undefined;

  // wagmi's useReadContract has complex generics that don't extend easily
  // when the caller passes a generic TAbi + TFunctionName pair.
  // We widen to `any` at the boundary; the return type is constrained to
  // `ContractReadResult<unknown>` so call sites remain type-safe.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const realRead = useReadContract({
    address: params.address,
    abi: params.abi as any,
    functionName: params.functionName as any,
    args: params.args as any,
    query: { enabled: !hasMock },
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (hasMock) {
    return { data: mockValue, isLoading: false, error: null };
  }

  return {
    data: realRead.data as unknown,
    isLoading: realRead.isLoading,
    error: realRead.error as Error | null,
  };
}
