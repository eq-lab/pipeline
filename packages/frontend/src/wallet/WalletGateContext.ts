/**
 * WalletGateContext — chain-agnostic context for the first-connection terms gate.
 *
 * The WalletGateProvider renders the FirstConnectionModal and exposes this
 * context so that `useEvmWallet().connect()` and `useStellarWallet().connect()`
 * can open the gate without knowing about the modal component directly.
 *
 * The gate is shared: it fires once on the FIRST wallet connect of EITHER chain
 * (EVM or Stellar) and is not re-asked when the user later connects the other chain.
 *
 * Design:
 *   - `openGate(onProceed)` — called by a wallet hook's `connect()` when the
 *     acknowledgement flag is absent. The caller supplies an `onProceed` callback
 *     that the gate invokes after the user completes the attestation.
 *   - The provider handles modal open/close state and invokes `onProceed` (which
 *     performs the actual wallet-specific connect flow) after the user continues.
 */
import { createContext, useContext } from "react";

export interface WalletGateContextValue {
  /**
   * Opens the first-connection terms gate modal.
   *
   * `onProceed` is called (after acknowledgement is written) when the user
   * clicks Continue. EVM passes `() => void open()` (AppKit); Stellar passes
   * `() => void runConnect()`.
   */
  openGate: (onProceed: () => void) => void;
}

export const WalletGateContext = createContext<WalletGateContextValue | null>(
  null,
);

/** No-op fallback used when WalletGateContext is not available (e.g., in tests). */
const NO_OP_GATE: WalletGateContextValue = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  openGate: (_onProceed: () => void) => {},
};

/**
 * Returns the WalletGateContext value.
 *
 * When called outside a `WalletGateProvider` tree (e.g., in isolated tests that
 * render only a partial provider tree), returns a no-op implementation instead
 * of throwing, so the tests don't break for code paths that don't exercise the gate.
 */
export function useWalletGate(): WalletGateContextValue {
  const ctx = useContext(WalletGateContext);
  return ctx ?? NO_OP_GATE;
}
