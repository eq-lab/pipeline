/**
 * Terms acknowledgement hook — address-scoped localStorage gate.
 *
 * Each wallet address must independently acknowledge the jurisdiction
 * self-attestation before AppKit `open()` is called.
 *
 * Key pattern: `pipeline.wallet.termsAcknowledged.<address>`
 * Value: `"true"` once accepted; absent or any other value = not acknowledged.
 *
 * Cross-tab sync is provided by the browser's native `storage` event.
 * Same-tab updates are applied directly inside `acknowledge()` so the hook
 * re-renders immediately without relying on the `storage` event (which fires
 * only in OTHER tabs).
 *
 * A non-hook helper `readTermsAcknowledged(address)` is exported for use
 * inside synchronous event handlers (e.g., `useWallet.connect()`).
 */
import { useCallback, useEffect, useState } from "react";

// ── Key helpers ────────────────────────────────────────────────────────────────

/** Returns the localStorage key for the given wallet address. */
function termsKey(address: string): string {
  return `pipeline.wallet.termsAcknowledged.${address.toLowerCase()}`;
}

// ── Non-reactive helper ────────────────────────────────────────────────────────

/**
 * The localStorage key used when a user acknowledges before their address is
 * known (i.e., on their very first ever connect). Mirrors the constant in
 * `WalletProvider.tsx`.
 */
const PENDING_ACK_KEY = "pipeline.wallet.termsAcknowledged.pending";

/**
 * Synchronous, non-reactive read.
 * Safe to call inside click handlers (no React hook rules apply).
 *
 * When `address` is defined, checks the address-scoped key.
 * When `address` is undefined, also checks the `pending` key written during a
 * first-ever connect acknowledgement before the address is known.
 */
export function readTermsAcknowledged(
  address: string | undefined,
): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (address) {
      return localStorage.getItem(termsKey(address)) === "true";
    }
    // No address yet — check the pending key (written when user acknowledges
    // before their first-ever wallet connection completes).
    return localStorage.getItem(PENDING_ACK_KEY) === "true";
  } catch {
    return false;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface UseTermsAcknowledgementResult {
  /** Whether this address has already acknowledged the terms. */
  acknowledged: boolean;
  /** Persist the acknowledgement and trigger a re-render in this tab. */
  acknowledge: () => void;
}

/**
 * Reactive hook that tracks whether the given `address` has acknowledged the
 * jurisdiction terms.
 *
 * Pass `undefined` when no wallet is connected — returns `{ acknowledged: false }`.
 *
 * The hook subscribes to the `storage` event so that if another tab persists the
 * acknowledgement for the same address, this tab reflects it immediately.
 */
export function useTermsAcknowledgement(
  address: string | undefined,
): UseTermsAcknowledgementResult {
  const [acknowledged, setAcknowledged] = useState<boolean>(() =>
    readTermsAcknowledged(address),
  );

  // Re-sync when the address changes (e.g., wallet switches accounts).
  useEffect(() => {
    setAcknowledged(readTermsAcknowledged(address));
  }, [address]);

  // Cross-tab sync via the native `storage` event.
  useEffect(() => {
    if (!address) return;

    const key = termsKey(address);

    function onStorage(e: StorageEvent) {
      if (e.key === key) {
        setAcknowledged(e.newValue === "true");
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [address]);

  const acknowledge = useCallback(() => {
    if (!address) return;
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(termsKey(address), "true");
      // Apply immediately in this tab — the `storage` event fires only in other tabs.
      setAcknowledged(true);
    } catch {
      // localStorage unavailable (e.g., private browsing with storage blocked).
    }
  }, [address]);

  return { acknowledged, acknowledge };
}
