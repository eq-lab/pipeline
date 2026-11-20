// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import { isAddress, type Address } from "viem";

export function requireAddress(
  who: string,
  name: string,
  value: string,
): Address {
  if (!value) throw new Error(`${who}: ${name} must not be empty`);
  if (!isAddress(value)) throw new Error(`${who}: invalid ${name} ${value}`);
  return value;
}
