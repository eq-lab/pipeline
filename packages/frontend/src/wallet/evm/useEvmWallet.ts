/**
 * Public wallet hooks — all blockchain access in the app goes through here.
 *
 * Each hook consults the `pipeline.mock.wallet.*` localStorage layer first.
 * When a mock key is present the real wagmi/viem call is skipped entirely
 * (no network request).
 */
import { useAccount, useChainId, useDisconnect, useReadContract } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import type { Abi } from "viem";
import {
  useMock,
  parseAddress,
  parseBoolean,
  parseNumber,
  parseJson,
} from "./mock";
import { readTermsAcknowledged } from "./useTermsAcknowledgement";
import { useWalletGate } from "./WalletGateContext";

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

    // Check terms acknowledgement synchronously.
    // The gate is address-scoped; before a wallet is connected `realAddress`
    // is undefined, so `readTermsAcknowledged(undefined)` returns false and
    // the gate is shown. Once the user acknowledges and AppKit opens, the
    // real address is known only after connect — at that point the gate flag
    // is written with the address they just connected. On the NEXT connect
    // attempt `realAddress` will be set and the flag will be found.
    //
    // Edge case handled: if `realAddress` is undefined (not yet connected)
    // we use a synthetic "pending" key so the gate fires. After the user
    // acknowledges, the WalletProvider calls open(). The user's actual address
    // is unknown until they complete AppKit — so we write the flag under a
    // special pending key and re-check on the next call.
    //
    // Simplified approach per exec plan: use realAddress (which may be
    // undefined for a first-time visitor). The gate fires when undefined
    // because readTermsAcknowledged(undefined) === false. The acknowledge()
    // call in WalletGateProvider writes the flag under the user's real address
    // once they actually complete the AppKit flow and we know their address.
    //
    // For the gate-then-AppKit flow, the WalletProvider's onContinue calls
    // open() directly — so we just need to call openGate() here.
    if (!readTermsAcknowledged(realAddress)) {
      openGate();
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
