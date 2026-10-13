import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/api";
import { clearSession, saveSession } from "@/auth/session";
import { AccountPage } from "./AccountPage";

const mockGet = vi.fn();
const mockOpenAddEmail = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return { ...actual, getMyLp: (...args: unknown[]) => mockGet(...args) };
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
      openAddEmail: mockOpenAddEmail,
    }),
  };
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
      disconnect: vi.fn(),
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

describe("AccountPage — wallet-only variant (#1458)", () => {
  afterEach(() => {
    clearSession();
    mockGet.mockReset();
    mockOpenAddEmail.mockReset();
  });

  it("renders the wallet-only composition with no session and no /v1/lps/me request", () => {
    render(<AccountPage />);
    expect(screen.getByTestId("account-wallet-card")).toBeInTheDocument();
    expect(screen.getByTestId("account-add-email-row")).toBeInTheDocument();
    expect(screen.getByTestId("account-documents-card")).toBeInTheDocument();
    expect(screen.getByText("Verify your account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(
      screen.queryByText(/sign in to view your account/i),
    ).not.toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("renders no profile card and no Submit for review", () => {
    render(<AccountPage />);
    expect(screen.queryByText("Legal name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).not.toBeInTheDocument();
  });

  it("clicking the Add email row calls useAuthFlow().openAddEmail", async () => {
    render(<AccountPage />);
    await userEvent.click(screen.getByTestId("account-add-email-row"));
    expect(mockOpenAddEmail).toHaveBeenCalledTimes(1);
  });

  it("clicking Upload calls openAddEmail and does not open the file input", async () => {
    render(<AccountPage />);
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(mockOpenAddEmail).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByTestId("account-upload-input"),
    ).not.toBeInTheDocument();
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
