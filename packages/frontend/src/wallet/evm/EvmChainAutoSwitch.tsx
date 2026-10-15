// spec: docs/frontend/wallet-flows.md#wrong-network
import { useEffect, useRef } from "react";
import { useMock, parseAddress } from "./mock";
import { useEvmNetworkGuard } from "./useEvmNetworkGuard";
import { useEvmWallet } from "./useEvmWallet";

const MOCK_ADDRESS_KEY = "pipeline.mock.wallet.address";

export function EvmChainAutoSwitch(): null {
  const { isWrongNetwork, switchNetwork } = useEvmNetworkGuard();
  const { address } = useEvmWallet();
  const mockAddress = useMock(MOCK_ADDRESS_KEY, parseAddress);
  const promptedFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (mockAddress !== undefined) return;
    if (!address) {
      promptedFor.current = undefined;
      return;
    }
    if (!isWrongNetwork || promptedFor.current === address) return;
    promptedFor.current = address;
    switchNetwork();
  });

  return null;
}
