import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPage } from "./AccountPage";

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

describe("AccountPage", () => {
  it("composes the heading, wallet, email, and documents sections", () => {
    render(<AccountPage />);
    expect(
      screen.getByRole("heading", { name: "Account" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("account-wallet-card")).toBeInTheDocument();
    expect(screen.getByText("Corporate email")).toBeInTheDocument();
    expect(screen.getByTestId("account-documents-card")).toBeInTheDocument();
  });

  it("Log Out is present, focusable, and clicking it with no handler does not throw", async () => {
    render(<AccountPage />);
    const button = screen.getByRole("button", { name: "Log Out" });
    button.focus();
    expect(button).toHaveFocus();
    await expect(userEvent.click(button)).resolves.not.toThrow();
  });

  it("with no preview state, renders the honest default: — email and the verify documents state", () => {
    render(<AccountPage />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Verify your account")).toBeInTheDocument();
  });

  it("a preview state overrides the documents section", () => {
    render(<AccountPage previewState="verified" />);
    expect(screen.getAllByText("Verified")).toHaveLength(7);
    expect(screen.queryByText("Verify your account")).not.toBeInTheDocument();
  });
});
