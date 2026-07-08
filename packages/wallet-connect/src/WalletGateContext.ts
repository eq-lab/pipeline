/**
 * WalletGateContext — optional, injectable pre-connect gate.
 *
 * Ported from `packages/frontend/src/wallet/WalletGateContext.ts` as part of
 * the #791 shared-slice extraction, with one change: the no-op fallback is
 * the ONLY behaviour by default. The LP app provides a real
 * `WalletGateProvider` (its first-connection terms gate, unchanged, still
 * owned by `packages/frontend`) above the EVM/Stellar providers from this
 * package; apps that don't need a gate (the Trustee) simply never mount a
 * provider for this context, so `useWalletGate()` resolves to the no-op and
 * `connect()` proceeds directly. This is the decoupling the #791 exec plan
 * calls for: the gate is injectable, not hard-wired into this package.
 */
import { createContext, useContext } from "react";

export interface WalletGateContextValue {
  /**
   * Opens a pre-connect gate. `onProceed` is invoked once the gate condition
   * is satisfied (e.g. terms acknowledged). The default (no provider mounted)
   * calls `onProceed` immediately — i.e. no gate at all.
   */
  openGate: (onProceed: () => void) => void;
}

export const WalletGateContext = createContext<WalletGateContextValue | null>(
  null,
);

/**
 * Default gate behaviour when no `WalletGateContext.Provider` is mounted:
 * proceed immediately. This is what makes the gate "optional" — apps that
 * don't render a gate provider get direct connect.
 */
const NO_OP_GATE: WalletGateContextValue = {
  openGate: (onProceed: () => void) => onProceed(),
};

/**
 * Returns the WalletGateContext value, falling back to the no-op (immediate
 * proceed) gate when no provider is mounted above the caller.
 */
export function useWalletGate(): WalletGateContextValue {
  const ctx = useContext(WalletGateContext);
  return ctx ?? NO_OP_GATE;
}
