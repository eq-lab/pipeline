import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/api";
import { clearSession, saveSession } from "@/auth/session";
import { AccountPage } from "./AccountPage";

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
    render(<AccountPage previewState="verify" />);
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
    expect(button).toHaveClass("!bg-[color:var(--color-pipeline-surface)]");
    await expect(userEvent.click(button)).resolves.not.toThrow();
  });

  it("pads the page with the reduced sibling-route rhythm (#1309)", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("account-page")).toHaveClass(
      "px-4",
      "py-8",
      "md:px-8",
      "md:py-16",
    );
  });

  it("paints the page root with the Figma frame's paper fill, matching sibling routes", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("account-page")).toHaveClass(
      "min-h-screen",
      "bg-[color:var(--color-pipeline-paper)]",
      "text-[color:var(--color-pipeline-ink)]",
    );
  });

  it("the verify preview renders the original fixture without an account session", () => {
    render(<AccountPage previewState="verify" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Verify your account")).toBeInTheDocument();
  });

  it("a preview state overrides the documents section", () => {
    render(<AccountPage previewState="verified" />);
    expect(screen.getAllByText("Verified")).toHaveLength(7);
    expect(screen.queryByText("Verify your account")).not.toBeInTheDocument();
  });
});

describe("AccountPage — 403 account_suspended (#1426)", () => {
  afterEach(() => {
    clearSession();
    mockGet.mockReset();
  });

  it("renders the declined copy with no Retry button", async () => {
    saveSession({ token: "token", expires_in: 3600 });
    mockGet.mockRejectedValue(new ApiError(403, "account_suspended"));
    render(<AccountPage />);
    await waitFor(() =>
      expect(
        screen.getByText(
          "Your account verification was declined. Profile and document changes are unavailable.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });
});
