// spec: docs/frontend/ui-components.md#combobox
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import { filterOptions, type ComboboxOption } from "./filterOptions";

export interface UseComboboxOptions {
  value: string;
  onChange: (next: string) => void;
  options: readonly ComboboxOption[];
  disabled?: boolean;
}

export function useCombobox({
  value,
  onChange,
  options,
  disabled,
}: UseComboboxOptions) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const committed = selected ? (selected.selectedLabel ?? selected.label) : "";
  const [query, setQuery] = useState(committed);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);

  const filtered = useMemo(
    () => (searching ? filterOptions(options, query) : [...options]),
    [options, query, searching],
  );

  useEffect(() => {
    if (!open) {
      setQuery(committed);
      setSearching(false);
    }
  }, [committed, open]);

  const optionId = (index: number) => `${baseId}-opt-${index}`;
  const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(`${baseId}-opt-${activeIndex}`);
    if (el && typeof el.scrollIntoView === "function")
      el.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, baseId]);

  function close() {
    setOpen(false);
    setSearching(false);
    setQuery(committed);
    setActiveIndex(-1);
  }

  function openList(activeFrom: "selected" | "none" = "selected") {
    if (disabled) return;
    setSearching(false);
    setQuery(committed);
    const idx =
      activeFrom === "selected"
        ? Math.max(
            options.findIndex((o) => o.value === value),
            0,
          )
        : -1;
    setActiveIndex(options.length > 0 ? idx : -1);
    setOpen(true);
  }

  function commit(option: ComboboxOption) {
    onChange(option.value);
    setOpen(false);
    setSearching(false);
    setQuery(option.selectedLabel ?? option.label);
    setActiveIndex(-1);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node))
        close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  });

  function onInputChange(next: string) {
    if (disabled) return;
    setQuery(next);
    setSearching(true);
    setOpen(true);
    setActiveIndex(filterOptions(options, next).length > 0 ? 0 : -1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) {
          openList(e.altKey ? "none" : "selected");
        } else if (filtered.length > 0) {
          setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) {
          openList("selected");
        } else if (filtered.length > 0) {
          setActiveIndex((i) => Math.max(i - 1, 0));
        }
        break;
      case "Enter":
        if (open) {
          e.preventDefault();
          if (activeOption) commit(activeOption);
          else close();
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
    }
  }

  function onBlur(e: React.FocusEvent<HTMLDivElement>) {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    if (open || query !== committed) close();
  }

  function onInputFocus(e: React.FocusEvent<HTMLInputElement>) {
    e.currentTarget.select();
  }

  function onInputClick() {
    if (!open) openList("selected");
  }

  function toggle() {
    if (open) close();
    else openList("selected");
    inputRef.current?.focus();
  }

  function clear() {
    onChange("");
    setOpen(false);
    setSearching(false);
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  return {
    rootRef,
    inputRef,
    listId,
    optionId,
    open,
    query,
    searching,
    filtered,
    activeIndex,
    activeOption,
    selected,
    committed,
    setActiveIndex,
    commit,
    onInputChange,
    onKeyDown,
    onBlur,
    onInputFocus,
    onInputClick,
    toggle,
    clear,
    errorId: `${baseId}-error`,
  };
}
