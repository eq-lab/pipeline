import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { saveSession, clearSession } from "@/auth/session";

const { mockIsDev } = vi.hoisted(() => ({
  mockIsDev: { value: true },
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/env")>();
  const env = { ...original.ENV };
  Object.defineProperty(env, "IS_DEV", { get: () => mockIsDev.value });
  return { ...original, ENV: env };
});

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...original, useNavigate: () => mockNavigate };
});

const { mockWalletPresenceState } = vi.hoisted(() => ({
  mockWalletPresenceState: { isAnyConnected: false, isSettled: true },
}));

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useWalletPresence: () => ({
      isAnyConnected: mockWalletPresenceState.isAnyConnected,
      isSettled: mockWalletPresenceState.isSettled,
      disconnectAll: vi.fn(),
    }),
    useActiveWalletAccount: () => ({
      kind: "evm" as const,
      setKind: vi.fn(),
      isConnected: mockWalletPresenceState.isAnyConnected,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
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

const mockGet = vi.fn();
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, getMyLp: (...args: unknown[]) => mockGet(...args) };
});

import { Route } from "./account";

function renderAccountRoute() {
  (Route as { useSearch: () => { state: undefined } }).useSearch = () => ({
    state: undefined,
  });
  const AccountRouteComponent = Route.options.component as React.ComponentType;
  return render(<AccountRouteComponent />);
}

type SearchValidator = (raw: { state?: string }) => { state?: string };

describe("/account route — validateSearch dev-only gate", () => {
  afterEach(() => {
    mockIsDev.value = true;
  });

  it("ignores ?state= in production builds", () => {
    mockIsDev.value = false;
    const validateSearch = Route.options.validateSearch as SearchValidator;
    const result = validateSearch({ state: "verified" });
    expect(result).toEqual({ state: undefined });
  });

  it("parses ?state= under the dev server", () => {
    mockIsDev.value = true;
    const validateSearch = Route.options.validateSearch as SearchValidator;
    const result = validateSearch({ state: "verified" });
    expect(result).toEqual({ state: "verified" });
  });
});

describe("/account route — component-level gate (#1284, #1362, #1458)", () => {
  beforeEach(() => {
    mockIsDev.value = false;
    mockWalletPresenceState.isAnyConnected = false;
    mockWalletPresenceState.isSettled = true;
    mockNavigate.mockClear();
    mockGet.mockReset();
  });

  afterEach(() => {
    clearSession();
    mockIsDev.value = true;
  });

  it("navigates to / in production with no session and no wallet, once wallet state has settled", async () => {
    renderAccountRoute();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true }),
    );
  });

  it("does not navigate and renders nothing while wallet state has not settled (hard-refresh guard)", () => {
    mockWalletPresenceState.isSettled = false;
    const { container } = renderAccountRoute();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the page and does not navigate when a wallet is connected but there is no session", async () => {
    mockWalletPresenceState.isAnyConnected = true;
    renderAccountRoute();
    await waitFor(() =>
      expect(screen.getByTestId("account-page")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders the page and does not navigate when a session exists", async () => {
    saveSession({ token: "t", expires_in: 3600 });
    mockGet.mockResolvedValue(null);
    renderAccountRoute();
    await waitFor(() =>
      expect(screen.getByTestId("account-page")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not navigate under the dev server with no session and no wallet", async () => {
    mockIsDev.value = true;
    renderAccountRoute();
    await waitFor(() =>
      expect(screen.getByTestId("account-page")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
