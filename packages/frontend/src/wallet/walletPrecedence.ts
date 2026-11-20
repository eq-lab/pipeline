// spec: docs/frontend/wallet-flows.md#single-connected-wallet
export type WalletViewKind = "evm" | "stellar";

export function walletPrecedence(
  evm: { isConnected: boolean },
  stellar: { isConnected: boolean },
): WalletViewKind | null {
  if (evm.isConnected) return "evm";
  if (stellar.isConnected) return "stellar";
  return null;
}
