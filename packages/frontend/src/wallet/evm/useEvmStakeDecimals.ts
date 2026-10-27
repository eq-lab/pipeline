// spec: docs/frontend/wallet-flows.md#evm-token-decimals
import { ENV } from "@/lib/env";
import { useStakedPlusdAsset } from "./useStakedPlusd";
import { useEvmToken } from "./useEvmToken";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface EvmStakeDecimals {
  plusd: number | undefined;
  splusd: number | undefined;
}

export function useEvmStakeDecimals(): EvmStakeDecimals {
  const { plusd } = useStakedPlusdAsset();
  const plusdToken = useEvmToken({
    token: (plusd ?? ZERO_ADDRESS) as `0x${string}`,
  });
  const splusdToken = useEvmToken({
    token: ENV.STAKED_PLUSD_ADDRESS as `0x${string}`,
  });
  return { plusd: plusdToken.decimals, splusd: splusdToken.decimals };
}
