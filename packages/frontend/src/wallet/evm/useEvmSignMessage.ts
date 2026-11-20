// spec: packages/frontend/src/wallet/README.md#useevmsignmessage
import { useCallback } from "react";
import { useSignMessage } from "wagmi";
import { useMock, parseAddress } from "./mock";

const MOCK_ADDRESS_KEY = "pipeline.mock.wallet.address";

export interface EvmSignMessage {
  signMessage(
    message: string,
    address?: string,
  ): Promise<{ signature: string }>;
}

export function useEvmSignMessage(): EvmSignMessage {
  const { signMessageAsync } = useSignMessage();
  const mockAddress = useMock(MOCK_ADDRESS_KEY, parseAddress);

  const signMessage = useCallback(
    async (
      message: string,
      signer?: string,
    ): Promise<{ signature: string }> => {
      if (mockAddress !== undefined) {
        throw new Error(
          "[wallet mock] signMessage is not mockable; connect a real wallet",
        );
      }
      return {
        signature: await signMessageAsync({
          message,
          ...(signer ? { account: signer as `0x${string}` } : {}),
        }),
      };
    },
    [mockAddress, signMessageAsync],
  );

  return { signMessage };
}
