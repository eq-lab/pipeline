// spec: packages/frontend/src/wallet/README.md#settlement-address-format
import { StrKey } from "@stellar/stellar-sdk";

export function isStellarSettlementAddress(value: string): boolean {
  return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
}
