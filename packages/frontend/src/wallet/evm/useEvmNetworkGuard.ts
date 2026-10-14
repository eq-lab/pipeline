// spec: docs/frontend/wallet-flows.md#wrong-network
import { useSwitchChain } from "wagmi";
import { evmChainInfo, type EvmChainInfo } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";
import { useActiveChain } from "../useActiveChain";
import { useMock, parseAddress } from "./mock";
import { useEvmWallet } from "./useEvmWallet";

const MOCK_ADDRESS_KEY = "pipeline.mock.wallet.address";

export interface EvmNetworkGuard {
  wrongNetwork: WrongNetworkInfo | undefined;
  expectedChain: EvmChainInfo;
  currentChainId: number | undefined;
  isWrongNetwork: boolean;
  switchNetwork(): void;
  isSwitching: boolean;
  switchError: Error | null;
}

export interface WrongNetworkInfo {
  chainName: string;
  switchNetwork(): void;
  isSwitching: boolean;
  switchError: Error | null;
}

export function useEvmNetworkGuard(): EvmNetworkGuard {
  const { kind } = useActiveChain();
  const { isConnected, chainId } = useEvmWallet();
  const mockAddress = useMock(MOCK_ADDRESS_KEY, parseAddress);
  const { mutate, isPending, error } = useSwitchChain();

  const isWrongNetwork =
    kind === "evm" &&
    isConnected &&
    chainId !== undefined &&
    chainId !== ENV.EVM_CHAIN_ID;

  function switchNetwork() {
    if (mockAddress !== undefined) {
      console.warn(
        "[wallet mock] To change the mock wallet's chain, set the localStorage key:\n" +
          `  localStorage.setItem('pipeline.mock.wallet.chainId', '${ENV.EVM_CHAIN_ID}')`,
      );
      return;
    }
    mutate({ chainId: ENV.EVM_CHAIN_ID });
  }

  const expectedChain = evmChainInfo(ENV.EVM_CHAIN_ID);

  return {
    wrongNetwork: isWrongNetwork
      ? {
          chainName: expectedChain.name,
          switchNetwork,
          isSwitching: isPending,
          switchError: error,
        }
      : undefined,
    expectedChain,
    currentChainId: chainId,
    isWrongNetwork,
    switchNetwork,
    isSwitching: isPending,
    switchError: error,
  };
}
