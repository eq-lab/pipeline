// spec: docs/frontend/utils.md
import { formatUnits } from "@/wallet/evm/units";

export function formatUnits4(value: bigint, decimals: number): string {
  const full = formatUnits(value, decimals);
  const [integer, fraction = ""] = full.split(".");
  const truncated = (fraction + "0000").slice(0, 4);
  return `${integer}.${truncated}`;
}
