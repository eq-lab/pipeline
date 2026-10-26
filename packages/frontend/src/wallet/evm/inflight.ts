// spec: docs/frontend/wallet-flows.md#request-state-model

export type InflightEvmKind = "deposit" | "withdraw";

export interface InflightEvmRequest {
  requestId: string;
  amount: string;
  txHash: string;
  createdAt: number;
}

function key(kind: InflightEvmKind, chainId: number, address: string): string {
  return `pipeline.evm.${kind}.inflight.${chainId}.${address.toLowerCase()}`;
}

export function readInflightEvmRequest(
  kind: InflightEvmKind,
  chainId: number,
  address: string,
): InflightEvmRequest | undefined {
  try {
    const raw = localStorage.getItem(key(kind, chainId, address));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<InflightEvmRequest> | null;
    if (
      parsed !== null &&
      typeof parsed.requestId === "string" &&
      typeof parsed.amount === "string" &&
      typeof parsed.txHash === "string" &&
      typeof parsed.createdAt === "number"
    ) {
      return parsed as InflightEvmRequest;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeInflightEvmRequest(
  kind: InflightEvmKind,
  chainId: number,
  address: string,
  entry: InflightEvmRequest,
): void {
  try {
    localStorage.setItem(key(kind, chainId, address), JSON.stringify(entry));
  } catch {
    return;
  }
}

export function clearInflightEvmRequest(
  kind: InflightEvmKind,
  chainId: number,
  address: string,
): void {
  try {
    localStorage.removeItem(key(kind, chainId, address));
  } catch {
    return;
  }
}
