// spec: docs/product-specs/staking.md#default-pockets
import { ENV } from "@/lib/env";
import { pocketId } from "./stellar/chain";
import type { WalletViewKind } from "./WalletViewContext";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isPocketConfigured(kind: WalletViewKind): boolean {
  if (kind === "stellar") return !!pocketId;
  return (
    !!ENV.EVM_POCKET_ADDRESS &&
    ENV.EVM_POCKET_ADDRESS.toLowerCase() !== ZERO_ADDRESS
  );
}
