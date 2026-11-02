// spec: docs/product-specs/staking.md#default-pockets
import { isPocketConfigured } from "./pocketConfig";
import { useStellarPocketReads } from "./stellar/useStellarPocketReads";
import { useEvmPocketReads } from "./evm/useEvmPocketReads";
import type { WalletViewKind } from "./WalletViewContext";

export interface PocketRead {
  exists?: boolean;
  balanceRaw?: string;
  claimableRaw?: string;
  claimedRaw?: string;
  error?: Error;
}

export function usePocketReads(
  kind: WalletViewKind,
  loanIds: string[],
  holder: string | undefined,
): Record<string, PocketRead> {
  const enabled = isPocketConfigured(kind);
  const stellar = useStellarPocketReads(loanIds, holder, {
    enabled: enabled && kind === "stellar",
  });
  const evm = useEvmPocketReads(loanIds, holder, {
    enabled: enabled && kind === "evm",
  });
  const active = kind === "stellar" ? stellar : evm;

  const out: Record<string, PocketRead> = {};
  for (const id of loanIds) {
    const read = active[id];
    out[id] = {
      exists: read?.exists,
      balanceRaw: read?.balanceRaw,
      claimableRaw: read?.claimableRaw,
      claimedRaw: read?.claimedRaw,
      error: read?.error ?? undefined,
    };
  }
  return out;
}
