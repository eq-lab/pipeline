/**
 * Public wallet hooks — all blockchain access in the app goes through here.
 *
 * Each hook consults the `pipeline.mock.wallet.*` localStorage layer first.
 * When a mock key is present the real wagmi/viem call is skipped entirely
 * (no network request).
 */
import { useAccount, useChainId, useDisconnect, useReadContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { formatUnits } from "viem";
import type { Abi } from "viem";
import { ENV } from "@/lib/env";
import {
  useMock,
  parseAddress,
  parseBoolean,
  parseNumber,
  parseBigInt,
  parseJson,
} from "./mock";
import { erc20Abi } from "./abis/erc20";

// ── Keys ─────────────────────────────────────────────────────────────────────

const KEYS = {
  address: "pipeline.mock.wallet.address",
  isConnected: "pipeline.mock.wallet.isConnected",
  chainId: "pipeline.mock.wallet.chainId",
  usdcBalance: "pipeline.mock.wallet.balance.usdc",
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

export function useWallet(): WalletState {
  const { address: realAddress, isConnected: realIsConnected } = useAccount();
  const realChainId = useChainId();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { open } = useAppKit();

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
    if (mockAddress !== undefined) {
      // Already "connected" via mock — nothing to do.
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

// ── USDC balance hook ─────────────────────────────────────────────────────────

export interface UsdcBalanceResult {
  data: bigint | undefined;
  formatted: string | undefined;
  isLoading: boolean;
  error: Error | null;
}

export function useUsdcBalance(): UsdcBalanceResult {
  const { address, isConnected } = useWallet();
  const mockBalance = useMock(KEYS.usdcBalance, parseBigInt);

  const USDC_ADDRESS = ENV.USDC_ADDRESS;
  const isZeroAddress =
    USDC_ADDRESS === "0x0000000000000000000000000000000000000000";

  // When mock is set → return immediately, skip real read.
  const shouldSkipReal =
    mockBalance !== undefined || !isConnected || !address || isZeroAddress;

  const realRead = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !shouldSkipReal },
  });

  if (mockBalance !== undefined) {
    return {
      data: mockBalance,
      formatted: formatUsdcBalance(mockBalance),
      isLoading: false,
      error: null,
    };
  }

  if (!isConnected || !address || isZeroAddress) {
    return {
      data: undefined,
      formatted: undefined,
      isLoading: false,
      error: null,
    };
  }

  const rawData = realRead.data as bigint | undefined;
  return {
    data: rawData,
    formatted: rawData !== undefined ? formatUsdcBalance(rawData) : undefined,
    isLoading: realRead.isLoading,
    error: realRead.error as Error | null,
  };
}

function formatUsdcBalance(raw: bigint): string {
  const num = parseFloat(formatUnits(raw, 6));
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
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
