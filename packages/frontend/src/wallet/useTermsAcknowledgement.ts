/**
 * Terms acknowledgement hook — single chain-agnostic localStorage flag.
 *
 * The terms self-attestation is asked ONCE on the first wallet connect of
 * EITHER chain (EVM or Stellar). A single flat key tracks the acknowledgement
 * so the gate is not re-triggered when the user later connects the other chain.
 *
 * Key: `pipeline.wallet.termsAcknowledged`
 * Value: `"true"` once accepted; absent or any other value = not acknowledged.
 *
 * Migration from legacy address-scoped keys:
 *   The old scheme wrote per-address keys
 *   (`pipeline.wallet.termsAcknowledged.<address>`) and a transient pending key
 *   (`pipeline.wallet.termsAcknowledged.pending`). On first read, if the new flat
 *   key is absent but a legacy key is `"true"`, the user is treated as already
 *   acknowledged and the new flat key is back-filled so subsequent reads are fast.
 *   Legacy keys are left in place (harmless) so a rollback would still work.
 *
 * Cross-tab sync is provided by the browser's native `storage` event.
 * Same-tab updates are applied directly inside `acknowledge()` so the hook
 * re-renders immediately without relying on the `storage` event (which fires
 * only in OTHER tabs).
 *
 * A non-hook helper `readTermsAcknowledged()` is exported for use inside
 * synchronous event handlers (e.g., `useEvmWallet.connect()`).
 */
import { useCallback, useEffect, useState } from "react";

// ── Key constants ──────────────────────────────────────────────────────────────

/** New single chain-agnostic key. */
const TERMS_KEY = "pipeline.wallet.termsAcknowledged";

// ── Non-reactive helper ────────────────────────────────────────────────────────

/**
 * Checks whether any legacy address-scoped or pending key is set to `"true"`.
 * If found, back-fills the new flat key (best-effort) so future reads are cheap.
 */
function checkAndMigrateLegacy(): boolean {
  try {
    // Check the old pending key first.
    if (
      localStorage.getItem("pipeline.wallet.termsAcknowledged.pending") ===
      "true"
    ) {
      try {
        localStorage.setItem(TERMS_KEY, "true");
      } catch {
        /* ignore */
      }
      return true;
    }
    // Scan for any address-scoped legacy key set to "true".
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k !== null &&
        k.startsWith("pipeline.wallet.termsAcknowledged.") &&
        localStorage.getItem(k) === "true"
      ) {
        try {
          localStorage.setItem(TERMS_KEY, "true");
        } catch {
          /* ignore */
        }
        return true;
      }
    }
  } catch {
    // localStorage unavailable or iteration failed.
  }
  return false;
}

/**
 * Synchronous, non-reactive read of the terms acknowledgement flag.
 * Safe to call inside click handlers (no React hook rules apply).
 *
 * Returns `true` when:
 *   - The flat `pipeline.wallet.termsAcknowledged` key is `"true"`, OR
 *   - A legacy address-scoped / pending key is `"true"` (triggers migration).
 */
export function readTermsAcknowledged(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(TERMS_KEY) === "true") return true;
    return checkAndMigrateLegacy();
  } catch {
    return false;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export interface UseTermsAcknowledgementResult {
  /** Whether the terms have already been acknowledged (any chain). */
  acknowledged: boolean;
  /** Persist the acknowledgement and trigger a re-render in this tab. */
  acknowledge: () => void;
}

/**
 * Reactive hook that tracks whether the user has acknowledged the jurisdiction
 * terms. Argument-less — the flag is chain-agnostic.
 *
 * The hook subscribes to the `storage` event so that if another tab persists the
 * acknowledgement, this tab reflects it immediately.
 */
export function useTermsAcknowledgement(): UseTermsAcknowledgementResult {
  const [acknowledged, setAcknowledged] = useState<boolean>(() =>
    readTermsAcknowledged(),
  );

  // Cross-tab sync via the native `storage` event.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === TERMS_KEY) {
        setAcknowledged(e.newValue === "true");
      }
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const acknowledge = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(TERMS_KEY, "true");
      // Apply immediately in this tab — the `storage` event fires only in other tabs.
      setAcknowledged(true);
    } catch {
      // localStorage unavailable (e.g., private browsing with storage blocked).
    }
  }, []);

  return { acknowledged, acknowledge };
}
