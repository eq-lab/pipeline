import { useState, useEffect, useCallback } from "react";

/**
 * useMobileNavMenu — local state hook for the mobile hamburger nav panel.
 *
 * Manages open/close state, body-scroll lock, and Escape-to-close. The hook
 * is intentionally narrow: it owns only the boolean toggle and its side
 * effects. The host component (`TopBar`) holds the wallet state and passes
 * action handlers into `MobileNavMenu` as props.
 *
 * Extracted per FRONTEND.md rule 2 (separate view from logic via a
 * co-located hook).
 */
export function useMobileNavMenu() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((o) => !o), []);

  // Body-scroll lock while the menu is open.
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Escape key closes the menu.
  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen]);

  return { isOpen, open, close, toggle };
}
