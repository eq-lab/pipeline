/**
 * ConnectModalContext — shared connect-wallet modal open/close state.
 *
 * Centralises the `ConnectWalletModal` open-state so every disconnected-state
 * CTA across the app (TopBar, home promo card, deposit banner, stake banner,
 * mobile nav menu) opens the same styled modal instead of triggering a
 * chain-specific connect() directly.
 *
 * Gate ordering (issue #639): `open()` in `ConnectModalProvider` routes
 * through the first-connection terms gate before opening `ConnectWalletModal`.
 * The gate fires only when `pipeline.wallet.termsAcknowledged` is absent; it
 * is skipped when terms have already been acknowledged. This ensures the
 * "Before you continue" attestation always precedes the wallet picker,
 * regardless of which CTA calls `open()`.
 *
 * Design mirrors `WalletGateContext.ts`:
 *   - A `createContext` with a `null` default.
 *   - A `useConnectModal()` hook that falls back to a no-op when called
 *     outside the provider (safe for isolated tests that don't need the
 *     full provider tree).
 */
import { createContext, useContext } from "react";

export interface ConnectModalContextValue {
  /**
   * Opens the ConnectWalletModal, routing through the first-connection terms
   * gate first when terms have not yet been acknowledged (issue #639).
   */
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
