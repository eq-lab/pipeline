// spec: packages/frontend/src/wallet/README.md#useevmwallet
import {
  useAccount,
  useDisconnect,
  useReadContract,
  useConnect,
  useConnectors,
  useSignMessage,
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
import { useBothWalletMocksConnected } from "../stellar/mock";
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
  isSettled: boolean;
  chainId: number | undefined;
  connect(): void;
  disconnect(): void;
  signMessage(message: string): Promise<{ signature: string }>;
}

export function useEvmWallet(): WalletState {
  const {
    address: realAddress,
    isConnected: realIsConnected,
    status,
    chainId: realChainId,
  } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { open } = useAppKit();
  const { openGate } = useWalletGate();

  const mockAddress = useMock(KEYS.address, parseAddress);
  const mockIsConnected = useMock(KEYS.isConnected, parseBoolean);
  const mockChainId = useMock(KEYS.chainId, parseNumber);
  const bothMocksConnected = useBothWalletMocksConnected();

  const address = mockAddress ?? realAddress;
  const isConnected = bothMocksConnected
    ? false
    : mockIsConnected !== undefined
      ? mockIsConnected
      : mockAddress !== undefined
        ? true
        : realIsConnected;
  const chainId = mockChainId ?? realChainId;
  const isSettled =
    mockAddress !== undefined ||
    (status !== "connecting" && status !== "reconnecting");

  function connect() {
    if (mockAddress !== undefined) {
      return;
    }

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

  async function signMessage(message: string): Promise<{ signature: string }> {
    if (mockAddress !== undefined) {
      throw new Error(
        "[wallet mock] signMessage is not mockable; connect a real wallet",
      );
    }
    return { signature: await signMessageAsync({ message }) };
  }

  return {
    address,
    isConnected,
    isSettled,
    chainId,
    connect,
    disconnect,
    signMessage,
  };
}

// ── Per-wallet EVM connect hook ───────────────────────────────────────────────

export type EvmWalletConnectorId =
  | "injected"
  | "coinbaseWallet"
  | "walletConnect";

export interface UseEvmConnectorsResult {
  connectWallet(connectorId: EvmWalletConnectorId): void;
}

export function useEvmConnectors(): UseEvmConnectorsResult {
  const connectors = useConnectors();
  const { connect } = useConnect();
  const { open } = useAppKit();

  const mockAddress = useMock(KEYS.address, parseAddress);

  function connectWallet(connectorId: EvmWalletConnectorId) {
    if (mockAddress !== undefined) {
      return;
    }

    const connector = connectors.find((c) => c.id === connectorId);
    if (connector) {
      connect({ connector });
    } else {
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
