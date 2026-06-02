/**
 * WalletGateContext — shared context for the first-connection terms gate.
 *
 * The WalletProvider renders the FirstConnectionModal and exposes this context
 * so that `useWallet().connect()` can open the gate without needing to know
 * about the modal component directly.
 *
 * Design:
 *   - `openGate()` — called by `useWallet.connect()` when the ack flag is absent.
 *   - The provider handles modal open/close state and calls AppKit `open()`
 *     once the user completes the attestation.
 */
import { createContext, useContext } from "react";

export interface WalletGateContextValue {
  /** Opens the first-connection terms gate modal. */
  openGate: () => void;
}

export const WalletGateContext = createContext<WalletGateContextValue | null>(
  null,
);

/** No-op fallback used when WalletGateContext is not available (e.g., in tests). */
const NO_OP_GATE: WalletGateContextValue = {
  openGate: () => {},
};

/**
 * Returns the WalletGateContext value.
 *
 * When called outside a `WalletProvider` tree (e.g., in isolated tests that
 * render only a partial provider tree), returns a no-op implementation instead
 * of throwing, so the tests don't break for code paths that don't exercise the
 * gate.
 */
export function useWalletGate(): WalletGateContextValue {
  const ctx = useContext(WalletGateContext);
  return ctx ?? NO_OP_GATE;
}
