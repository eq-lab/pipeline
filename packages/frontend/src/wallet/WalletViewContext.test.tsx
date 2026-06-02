/**
 * WalletViewContext — unit tests.
 *
 * Covers:
 *   - `useWalletView` returns safe default `{ kind: 'evm', setKind: no-op }`
 *     when called outside a WalletViewProvider (no throw).
 *   - Inside WalletViewProvider: returns `{ kind: 'evm' }` initially.
 *   - `setKind('stellar')` updates `kind` to `'stellar'`.
 *   - Switching back with `setKind('evm')` restores `kind` to `'evm'`.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { WalletViewProvider, useWalletView } from "./WalletViewContext";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWalletView — outside provider (safe default)", () => {
  it("returns kind: 'evm' without throwing", () => {
    const { result } = renderHook(() => useWalletView());
    expect(result.current.kind).toBe("evm");
  });

  it("setKind is a no-op function (does not throw)", () => {
    const { result } = renderHook(() => useWalletView());
    expect(() => result.current.setKind("stellar")).not.toThrow();
  });
});

describe("useWalletView — inside WalletViewProvider", () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    return <WalletViewProvider>{children}</WalletViewProvider>;
  }

  it("starts with kind: 'evm'", () => {
    const { result } = renderHook(() => useWalletView(), { wrapper });
    expect(result.current.kind).toBe("evm");
  });

  it("setKind('stellar') updates kind to 'stellar'", () => {
    const { result } = renderHook(() => useWalletView(), { wrapper });
    act(() => {
      result.current.setKind("stellar");
    });
    expect(result.current.kind).toBe("stellar");
  });

  it("switching back with setKind('evm') restores kind to 'evm'", () => {
    const { result } = renderHook(() => useWalletView(), { wrapper });
    act(() => {
      result.current.setKind("stellar");
    });
    expect(result.current.kind).toBe("stellar");

    act(() => {
      result.current.setKind("evm");
    });
    expect(result.current.kind).toBe("evm");
  });
});
