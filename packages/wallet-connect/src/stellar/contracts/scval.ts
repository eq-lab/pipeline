// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

export function scMap(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(
    sorted.map(
      ([key, val]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

export function u128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u128" });
}

export function u64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

export function u32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}
