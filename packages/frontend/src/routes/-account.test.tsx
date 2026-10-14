/**
 * Integration tests for the /account route — renders the route's component
 * for a couple of `?state=` fixtures and pins the "Save never fakes a
 * transition" contract (decision 4, docs/frontend/account-page.md).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LpResponse } from "@/api";
import { clearSession, saveSession } from "@/auth/session";

const mockGet = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, getMyLp: (...args: unknown[]) => mockGet(...args) };
});

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useActiveWalletAccount: () => ({
      kind: "evm" as const,
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    useWalletPresence: () => ({
      isAnyConnected: false,
      isSettled: true,
      disconnectAll: vi.fn(),
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
  };
});

import { Route } from "./account";
import type { AccountDocumentsState } from "@/components/account/accountPageState";

function renderAccountRoute(state: AccountDocumentsState | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Route as any).useSearch = () => ({ state });
  const AccountRouteComponent = Route.options.component as React.ComponentType;
  return render(<AccountRouteComponent />);
}

describe("/account route — section order", () => {
  it("composes heading, wallet, email, and documents in the frame's order", () => {
    renderAccountRoute("verified");
    const page = screen.getByTestId("account-page");
    const headingIndex = Array.from(page.querySelectorAll("*")).findIndex(
      (el) => el.textContent === "Account" && el.tagName === "H1",
    );
    const walletIndex = Array.from(page.querySelectorAll("*")).indexOf(
      screen.getByTestId("account-wallet-card"),
    );
    const emailIndex = Array.from(page.querySelectorAll("*")).indexOf(
      screen.getByText("Corporate email"),
    );
    const documentsIndex = Array.from(page.querySelectorAll("*")).indexOf(
      screen.getByTestId("account-documents-card"),
    );

    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(headingIndex).toBeLessThan(walletIndex);
    expect(walletIndex).toBeLessThan(emailIndex);
    expect(emailIndex).toBeLessThan(documentsIndex);
  });
});

describe("/account route — Save is a pure seam", () => {
  it("clicking Save with staged files calls the seam and leaves the rendered state unchanged", async () => {
    renderAccountRoute("staged");
    expect(screen.getByText("Verify your identity")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);

    // No fabricated transition: the staged banner and rows are still there.
    expect(screen.getByText("Verify your identity")).toBeInTheDocument();
    expect(screen.queryByText("Verifying account")).not.toBeInTheDocument();
  });
});

function lp(overrides: Partial<LpResponse> = {}): LpResponse {
  return {
    id: 1,
    legal_name: "Declined Ltd",
    country: "GB",
    contact_email: "lp@example.com",
    stellar_address: null,
    address_linked_at: null,
    kyb_status: "ChangesRequested",
    writable: true,
    notify_on_review: false,
    owner_account_id: "account",
    owner_chain_id: null,
    owner_address: null,
    created_at: "2026-09-29",
    documents: [],
    ...overrides,
  };
}

describe("/account route — production ChangesRequested routing (#1426)", () => {
  afterEach(() => {
    clearSession();
    mockGet.mockReset();
  });

  it("a ChangesRequested LP with no rejected document lands on invalid, not Verify your account", async () => {
    saveSession({ token: "token", expires_in: 3600, email: "lp@example.com" });
    mockGet.mockResolvedValue(lp());
    renderAccountRoute(undefined);

    await waitFor(() =>
      expect(screen.getByText("Re-upload your document")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Verify your account")).not.toBeInTheDocument();
  });
});
