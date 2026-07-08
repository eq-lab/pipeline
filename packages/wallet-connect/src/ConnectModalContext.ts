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
 *   - `onCancel` (#793): a subscribable signal fired ONLY when the modal is
 *     dismissed with no wallet chosen (Escape / × button) — not when it
 *     closes as a side effect of the user picking a wallet row. Callers that
 *     set a busy/"connecting" state before opening the modal (the Trustee
 *     sign-in flow) subscribe here to reset that state on a true cancel,
 *     without racing an in-flight wallet connection.
 *   - `onWalletSelect` (#794): a subscribable signal fired with the chain tab
 *     ("evm" | "soroban") the user picked a wallet row from. Lets a caller
 *     tell which chain the user just acted on — needed when more than one
 *     wallet is already connected and the caller can't otherwise infer intent
 *     from ambient connection state.
 */
import { createContext, useContext } from "react";
import type { WalletTab } from "./ConnectWalletModal";

export interface ConnectModalContextValue {
  /** Opens the ConnectWalletModal (routing through the injected gate, if any). */
  open(): void;
  /** Closes the ConnectWalletModal. */
  close(): void;
  /**
   * Subscribes to "the modal was cancelled with no wallet selected" events
   * (Escape / × button — never fired for a wallet-row selection). Returns an
   * unsubscribe function.
   */
  onCancel(listener: () => void): () => void;
  /**
   * Subscribes to "the user picked a wallet row" events, receiving the chain
   * tab ("evm" | "soroban") it was picked from. Returns an unsubscribe
   * function.
   */
  onWalletSelect(listener: (chain: WalletTab) => void): () => void;
}

export const ConnectModalContext =
  createContext<ConnectModalContextValue | null>(null);

/** No-op fallback used when ConnectModalContext is not available (e.g., in tests). */
const NO_OP_MODAL: ConnectModalContextValue = {
  open: () => {},
  close: () => {},
  onCancel: () => () => {},
  onWalletSelect: () => () => {},
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
