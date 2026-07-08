/**
 * ConnectModalContext — shared connect-wallet modal open/close state.
 *
 * Ported from `packages/frontend/src/wallet/ConnectModalContext.ts` (#791
 * shared-slice extraction). Centralises the `ConnectWalletModal` open-state
 * so any disconnected-state CTA opens the same styled modal instead of
 * triggering a chain-specific connect() directly.
 *
 * Design:
 *   - A `createContext` with a `null` default.
 *   - A `useConnectModal()` hook that falls back to a no-op when called
 *     outside the provider (safe for isolated tests that don't need the
 *     full provider tree).
 */
import { createContext, useContext } from "react";

export interface ConnectModalContextValue {
  /** Opens the ConnectWalletModal (routing through the injected gate, if any). */
  open(): void;
  /** Closes the ConnectWalletModal. */
  close(): void;
}

export const ConnectModalContext =
  createContext<ConnectModalContextValue | null>(null);

/** No-op fallback used when ConnectModalContext is not available (e.g., in tests). */
const NO_OP_MODAL: ConnectModalContextValue = {
  open: () => {},
  close: () => {},
};

/**
 * Returns the ConnectModalContext value.
 *
 * When called outside a `ConnectModalProvider` tree (e.g., in isolated tests
 * that render only a partial provider tree), returns a no-op implementation
 * instead of throwing, so those tests don't break.
 */
export function useConnectModal(): ConnectModalContextValue {
  const ctx = useContext(ConnectModalContext);
  return ctx ?? NO_OP_MODAL;
}
