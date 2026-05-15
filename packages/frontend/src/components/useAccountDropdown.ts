/**
 * useAccountDropdown — logic hook for the AccountDropdown component.
 *
 * Owns:
 *   - address truncation helper (`truncateAddress`)
 *   - clipboard copy with a 1.5s `copied` affordance
 *   - outside-click, Escape, and route-change dismissal effects
 *
 * Returns `{ rootRef, copied, copy, truncated }`.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Truncates a wallet address to `0xXXXX…XXXX` (6 + 4 chars after `0x`).
 * Input: `0x8493...3b92` (full hex string, 42 chars).
 * Output: `0x8493…3b92`.
 */
export function truncateAddress(address: `0x${string}`): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export interface UseAccountDropdownOptions {
  onClose: () => void;
  address: `0x${string}`;
}

export interface UseAccountDropdownResult {
  rootRef: React.RefObject<HTMLDivElement | null>;
  copied: boolean;
  copy: () => void;
  truncated: string;
}

export function useAccountDropdown({
  onClose,
  address,
}: UseAccountDropdownOptions): UseAccountDropdownResult {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const truncated = truncateAddress(address);

  const copy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(address).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => {
          // Silently no-op if clipboard write fails (e.g. non-secure context).
        },
      );
    }
  }, [address]);

  // Outside-click dismissal (capture phase so it fires before bubbling).
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [onClose]);

  // Escape key dismissal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Route-change dismissal.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      onClose();
    }
  }, [pathname, onClose]);

  return { rootRef, copied, copy, truncated };
}
