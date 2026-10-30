// spec: docs/product-specs/withdrawals.md#bank-wire-withdrawals-lp-app
import { ENV } from "@/lib/env";
import { minterId } from "./stellar/chain";
import type { WalletViewKind } from "./WalletViewContext";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isWireOutMinterConfigured(kind: WalletViewKind): boolean {
  if (kind === "stellar") return !!minterId;
  return (
    !!ENV.EVM_MINTER_ADDRESS &&
    ENV.EVM_MINTER_ADDRESS.toLowerCase() !== ZERO_ADDRESS
  );
}
