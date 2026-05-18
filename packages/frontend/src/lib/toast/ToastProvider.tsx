import React, { useCallback, useRef, useState } from "react";
import { Toast } from "@pipeline/ui";
import {
  ToastContext,
  type ToastApi,
  type ToastEntry,
  type ToastInput,
} from "./useToast";

/**
 * ToastProvider — renders the bottom-right toast stack and provides the
 * imperative `useToast()` API to all descendant components.
 *
 * Mount once in `main.tsx` inside `<WalletProvider>`:
 *
 * ```tsx
 * <WalletProvider>
 *   <ToastProvider>
 *     <RouterProvider router={router} />
 *   </ToastProvider>
 * </WalletProvider>
 * ```
 *
 * Stack rules:
 * - Capped at 3 visible toasts. 4th arrival drops the oldest.
 * - `pending` toasts never auto-dismiss; caller must `update` or `dismiss`.
 * - Non-pending toasts auto-dismiss after `durationMs` (default 5 000 ms).
 * - `show({ id })` upserts: replaces in place when `id` already exists.
 *
 * Figma placement: fixed bottom-right, 24 px inset, z-50.
 */

const DEFAULT_DURATION_MS = 5000;
const MAX_STACK = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  // Map<id, NodeJS.Timeout> — cleared on dismiss, update, and unmount.
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Helpers ──────────────────────────────────────────────────────────────

  const clearTimer = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const armTimer = useCallback(
    (id: string, durationMs: number) => {
      clearTimer(id);
      const t = setTimeout(() => {
        setToasts((prev) => prev.filter((e) => e.id !== id));
        timers.current.delete(id);
      }, durationMs);
      timers.current.set(id, t);
    },
    [clearTimer],
  );

  // ── API ───────────────────────────────────────────────────────────────────

  const show = useCallback(
    (input: ToastInput): string => {
      const id = input.id ?? crypto.randomUUID();
      const entry: ToastEntry = {
        id,
        tone: input.tone ?? "neutral",
        title: input.title,
        action: input.action,
        icon: input.icon,
        durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
      };

      setToasts((prev) => {
        const existingIdx = prev.findIndex((e) => e.id === id);
        let next: ToastEntry[];
        if (existingIdx !== -1) {
          // Upsert — replace in place.
          next = prev.map((e, i) => (i === existingIdx ? entry : e));
        } else {
          // Append; drop oldest if > MAX_STACK.
          const appended = [...prev, entry];
          next =
            appended.length > MAX_STACK ? appended.slice(appended.length - MAX_STACK) : appended;
          // Clear timer of the dropped toast (if any).
          if (appended.length > MAX_STACK) {
            const dropped = appended[0];
            if (dropped) clearTimer(dropped.id);
          }
        }
        return next;
      });

      if (entry.tone !== "pending") {
        armTimer(id, entry.durationMs);
      }

      return id;
    },
    [armTimer, clearTimer],
  );

  const update = useCallback(
    (id: string, patch: Partial<ToastInput>) => {
      setToasts((prev) => {
        const existingIdx = prev.findIndex((e) => e.id === id);
        if (existingIdx === -1) return prev;
        const existing = prev[existingIdx]!;
        const merged: ToastEntry = {
          ...existing,
          ...patch,
          id,
          // Resolve defaults for fields that can become undefined via patch.
          tone: patch.tone ?? existing.tone,
          title: patch.title ?? existing.title,
          durationMs: patch.durationMs ?? existing.durationMs,
        };
        // Arm auto-dismiss if the updated tone is no longer pending.
        if (merged.tone !== "pending") {
          armTimer(id, merged.durationMs);
        } else {
          clearTimer(id);
        }
        return prev.map((e, i) => (i === existingIdx ? merged : e));
      });
    },
    [armTimer, clearTimer],
  );

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((e) => e.id !== id));
    },
    [clearTimer],
  );

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────
  const api: ToastApi = React.useMemo(
    () => ({ show, update, dismiss }),
    [show, update, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/* Bottom-right toast stack */}
      <div
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3 items-end"
        aria-label="Notifications"
      >
        {toasts.map((entry) => (
          <div key={entry.id} className="pointer-events-auto">
            <Toast
              tone={entry.tone}
              title={entry.title}
              action={entry.action}
              icon={entry.icon}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
