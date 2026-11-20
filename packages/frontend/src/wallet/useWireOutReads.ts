// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { isWireOutMinterConfigured } from "./wireOutConfig";
import {
  useStellarMinterPaused,
  useStellarWireOuts,
} from "./stellar/useStellarMinterReads";
import { useEvmMinterPaused, useEvmWireOuts } from "./evm/useEvmMinterReads";
import type { WalletViewKind } from "./WalletViewContext";

export type WireOutStatus = "Pending" | "Settled" | "Cancelled";

export interface WireOutRead {
  amountRaw?: string;
  status?: WireOutStatus;
  error?: Error;
}

export function useWireOuts(
  kind: WalletViewKind,
  ids: string[],
): Record<string, WireOutRead> {
  const enabled = isWireOutMinterConfigured(kind);
  const stellar = useStellarWireOuts(ids, {
    enabled: enabled && kind === "stellar",
  });
  const evm = useEvmWireOuts(ids, { enabled: enabled && kind === "evm" });

  const out: Record<string, WireOutRead> = {};
  for (const id of ids) {
    if (kind === "stellar") {
      const read = stellar[id];
      out[id] = {
        amountRaw: read?.data?.amount,
        status: read?.data?.status,
        error: read?.error ?? undefined,
      };
    } else {
      const read = evm[id];
      out[id] = {
        amountRaw: read?.amountRaw,
        status: read?.status,
        error: read?.error ?? undefined,
      };
    }
  }
  return out;
}

export function useMinterPaused(kind: WalletViewKind): boolean | undefined {
  const enabled = isWireOutMinterConfigured(kind);
  const stellar = useStellarMinterPaused({
    enabled: enabled && kind === "stellar",
  });
  const evm = useEvmMinterPaused({ enabled: enabled && kind === "evm" });
  return kind === "stellar" ? stellar : evm;
}
