import React from "react";
import type { ToastTone, ToastAction } from "@pipeline/ui";

/**
 * useToast — imperative API for emitting transient toast notifications.
 *
 * ## Usage
 *
 * ```ts
 * const toast = useToast();
 *
 * // Show a terminal toast (auto-dismisses after 5 s).
 * toast.show({ tone: "success", title: "Deposit confirmed" });
 *
 * // Show a persistent pending toast; update it when done.
 * toast.show({ id: "deposit-tx", tone: "pending", title: "Sending…" });
 * toast.update("deposit-tx", { tone: "success", title: "Deposit submitted" });
 *
 * // Dismiss manually.
 * toast.dismiss("deposit-tx");
 * ```
 *
 * ## Stack behaviour
 *
 * - Stack is capped at 3 visible toasts. When a 4th arrives, the oldest is dropped.
 * - `show({ id })` upserts: if `id` is already in the stack, the existing entry is
 *   replaced in place (no DOM remount). If `id` is omitted, a `crypto.randomUUID()`
 *   is generated; the caller cannot upgrade that toast.
 * - `pending` toasts are sticky — no auto-dismiss timer is set.
 * - Non-pending toasts auto-dismiss after `durationMs` (default 5 000 ms).
 * - `update(id, patch)` merges the patch; if the resulting tone is non-pending,
 *   it (re)arms the auto-dismiss timer.
 *
 * Must be called inside a `<ToastProvider>`.
 */

export interface ToastInput {
  /** Omit → uuid generated; provide → upsert-by-id. */
  id?: string;
  /** Tone controlling background and icon. Default: "neutral". */
  tone?: ToastTone;
  /** Title text. */
  title: React.ReactNode;
  /** Optional right-aligned action button. */
  action?: ToastAction;
  /** Optional leading icon override. */
  icon?: React.ReactNode;
  /** Auto-dismiss duration in ms. `pending` ignores this. Default: 5000. */
  durationMs?: number;
}

export interface ToastEntry extends Required<Omit<ToastInput, "id" | "action" | "icon">> {
  id: string;
  action?: ToastAction;
  icon?: React.ReactNode;
}

export interface ToastApi {
  /** Show a toast. Returns the id (useful when id was generated). */
  show: (input: ToastInput) => string;
  /** Merge patch into an existing toast. Noop if id not found. */
  update: (id: string, patch: Partial<ToastInput>) => void;
  /** Dismiss immediately. */
  dismiss: (id: string) => void;
}

// Context ─────────────────────────────────────────────────────────────────────

export const ToastContext = React.createContext<ToastApi | null>(null);

ToastContext.displayName = "ToastContext";

/**
 * useToast — returns the imperative toast API.
 *
 * Throws a clear error when called outside `<ToastProvider>`.
 */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      "useToast() must be called inside a <ToastProvider>. " +
        "Make sure <ToastProvider> wraps your component tree in main.tsx.",
    );
  }
  return ctx;
}
