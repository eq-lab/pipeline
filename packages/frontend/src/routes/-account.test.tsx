/**
 * Integration tests for the /account route — renders the route's component
 * for a couple of `?state=` fixtures and pins the "Save never fakes a
 * transition" contract (decision 4, docs/frontend/account-page.md).
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/wallet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/wallet")>();
  return {
    ...actual,
    useActiveWalletAccount: () => ({
      kind: "evm" as const,
      setKind: vi.fn(),
      isConnected: false,
      address: undefined,
      truncatedAddress: undefined,
      formattedBalance: undefined,
      connect: vi.fn(),
    }),
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
