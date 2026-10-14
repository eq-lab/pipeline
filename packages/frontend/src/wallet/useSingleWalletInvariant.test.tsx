// spec: docs/frontend/wallet-flows.md#single-connected-wallet
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSingleWalletInvariant } from "./useSingleWalletInvariant";

const { presence, disconnectAll } = vi.hoisted(() => ({
  presence: {
    isAnyConnected: true,
    isSettled: true,
    onlyConnectedKind: undefined as "evm" | "stellar" | undefined,
  },
  disconnectAll: vi.fn(),
}));

vi.mock("./useWalletPresence", () => ({
  useWalletPresence: () => ({ ...presence, disconnectAll }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  presence.isAnyConnected = true;
  presence.isSettled = true;
  presence.onlyConnectedKind = undefined;
});

describe("useSingleWalletInvariant", () => {
  it("disconnects both wallets when both are connected and settled", () => {
    renderHook(() => useSingleWalletInvariant());
    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });

  it("does nothing before the kits are settled", () => {
    presence.isSettled = false;
    renderHook(() => useSingleWalletInvariant());
    expect(disconnectAll).not.toHaveBeenCalled();
  });

  it.each(["evm", "stellar"] as const)(
    "does nothing when only %s is connected",
    (kind) => {
      presence.onlyConnectedKind = kind;
      renderHook(() => useSingleWalletInvariant());
      expect(disconnectAll).not.toHaveBeenCalled();
    },
  );

  it("does nothing when neither wallet is connected", () => {
    presence.isAnyConnected = false;
    renderHook(() => useSingleWalletInvariant());
    expect(disconnectAll).not.toHaveBeenCalled();
  });

  it("runs once per page load", () => {
    const { rerender } = renderHook(() => useSingleWalletInvariant());
    rerender();
    rerender();
    expect(disconnectAll).toHaveBeenCalledTimes(1);
  });

  it("removes the legacy view-kind key on mount", () => {
    localStorage.setItem("pipeline.wallet.view.kind", "stellar");
    presence.isAnyConnected = false;
    renderHook(() => useSingleWalletInvariant());
    expect(localStorage.getItem("pipeline.wallet.view.kind")).toBeNull();
  });
});
