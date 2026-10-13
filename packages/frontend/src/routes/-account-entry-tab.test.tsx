import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearSession, saveSession } from "@/auth/session";

const { mockIsDev, presence } = vi.hoisted(() => ({
  mockIsDev: { value: true },
  presence: {
    isAnyConnected: true,
    isSettled: true,
    onlyConnectedKind: undefined as "evm" | "stellar" | undefined,
  },
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  const env = { ...original.ENV };
  Object.defineProperty(env, "IS_DEV", { get: () => mockIsDev.value });
  return { ...original, ENV: env };
});

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, getMyLp: () => new Promise(() => {}) };
});

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useWalletPresence: () => ({ ...presence, disconnectAll: vi.fn() }),
    useActiveWalletAccount: () => {
      const { kind, setKind } = actual.useWalletView();
      return {
        kind,
        setKind,
        isConnected: false,
        address: undefined,
        truncatedAddress: undefined,
        formattedBalance: undefined,
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    },
  };
});

vi.mock("@/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth")>();
  return {
    ...actual,
    useAuthFlow: () => ({
      open: vi.fn(),
      close: vi.fn(),
      lpRead: "unknown" as const,
      openAccountSetup: vi.fn(),
      openAddEmail: vi.fn(),
    }),
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...original, useNavigate: () => vi.fn() };
});

import { WalletViewProvider } from "@/wallet";
import { Route } from "./account";

const KEY = "pipeline.wallet.view.kind";

function Tree() {
  const Component = Route.options.component as React.ComponentType;
  return (
    <WalletViewProvider>
      <Component />
    </WalletViewProvider>
  );
}

function renderRoute(state?: "verified") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useSearch = () => ({ state });
  return render(<Tree />);
}

function selected(name: "Ethereum" | "Stellar") {
  return screen.getByRole("tab", { name }).getAttribute("aria-selected");
}

function setPresence(
  onlyConnectedKind: "evm" | "stellar" | undefined,
  opts: { isSettled?: boolean; isAnyConnected?: boolean } = {},
) {
  presence.onlyConnectedKind = onlyConnectedKind;
  presence.isSettled = opts.isSettled ?? true;
  presence.isAnyConnected =
    opts.isAnyConnected ?? onlyConnectedKind !== undefined;
}

beforeEach(() => {
  localStorage.clear();
  mockIsDev.value = true;
  saveSession({ token: "token", expires_in: 3600, email: "lp@example.com" });
});

afterEach(() => {
  clearSession();
  localStorage.clear();
});

describe("/account entry tab (#1475)", () => {
  it("Stellar only moves a persisted evm view to the Stellar tab", () => {
    localStorage.setItem(KEY, "evm");
    setPresence("stellar");
    renderRoute();
    expect(selected("Stellar")).toBe("true");
    expect(selected("Ethereum")).toBe("false");
    expect(localStorage.getItem(KEY)).toBe("stellar");
  });

  it("EVM only moves a persisted stellar view to the Ethereum tab", () => {
    localStorage.setItem(KEY, "stellar");
    setPresence("evm");
    renderRoute();
    expect(selected("Ethereum")).toBe("true");
    expect(localStorage.getItem(KEY)).toBe("evm");
  });

  it.each(["evm", "stellar"] as const)(
    "both connected keeps the persisted %s view",
    (persisted) => {
      localStorage.setItem(KEY, persisted);
      setPresence(undefined, { isAnyConnected: true });
      renderRoute();
      expect(localStorage.getItem(KEY)).toBe(persisted);
      expect(selected(persisted === "evm" ? "Ethereum" : "Stellar")).toBe(
        "true",
      );
    },
  );

  it("none connected keeps the persisted view", () => {
    localStorage.setItem(KEY, "stellar");
    setPresence(undefined, { isAnyConnected: false });
    renderRoute();
    expect(selected("Stellar")).toBe("true");
    expect(localStorage.getItem(KEY)).toBe("stellar");
  });

  it("waits for settle, then picks once", () => {
    localStorage.setItem(KEY, "evm");
    setPresence(undefined, { isSettled: false, isAnyConnected: false });
    const { rerender } = renderRoute();
    expect(selected("Ethereum")).toBe("true");
    setPresence("stellar", { isSettled: true });
    rerender(<Tree />);
    expect(selected("Stellar")).toBe("true");
  });

  it("stays switchable after entry", async () => {
    localStorage.setItem(KEY, "evm");
    setPresence("stellar");
    const { rerender } = renderRoute();
    await userEvent.click(screen.getByRole("tab", { name: "Ethereum" }));
    rerender(<Tree />);
    expect(selected("Ethereum")).toBe("true");
    expect(localStorage.getItem(KEY)).toBe("evm");
  });

  it("applies to the wallet-only variant", () => {
    clearSession();
    localStorage.setItem(KEY, "evm");
    setPresence("stellar");
    renderRoute();
    expect(screen.getByTestId("account-add-email-row")).toBeInTheDocument();
    expect(selected("Stellar")).toBe("true");
  });

  it("applies to the ?state= preview", () => {
    clearSession();
    localStorage.setItem(KEY, "evm");
    setPresence("stellar");
    renderRoute("verified");
    expect(selected("Stellar")).toBe("true");
  });
});
