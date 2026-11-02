// spec: docs/product-specs/staking.md#default-pockets
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useStellarPocketClaim,
  type UsePocketClaimResult,
} from "./stellar/useStellarPocketClaim";
import { useEvmPocketClaim } from "./evm/useEvmPocketClaim";
import type { WalletViewKind } from "./WalletViewContext";

const REFRESH_KEYS = [
  ["pocket"],
  ["stellarSacToken"],
  ["readContract"],
  ["readContracts"],
] as const;

export function usePocketClaim(kind: WalletViewKind): UsePocketClaimResult {
  const stellar = useStellarPocketClaim();
  const evm = useEvmPocketClaim();
  const active = kind === "stellar" ? stellar : evm;
  const queryClient = useQueryClient();
  const { isSuccess, hash } = active;

  useEffect(() => {
    if (!isSuccess) return;
    for (const queryKey of REFRESH_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }, [isSuccess, hash, queryClient]);

  return active;
}
