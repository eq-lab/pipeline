/**
 * AuthFlowProvider — unit tests.
 *
 * Covers:
 *   - `useAuthFlow()` outside the provider throws.
 *   - `open("sign-in")` / `open("create-account")` render EmailAuthFlow on the
 *     matching screen; `open()` with no argument defaults to "sign-in".
 *   - `close()` (via context) and the flow's own `onClose` both hide it.
 *   - "Continue with wallet" (EmailAuthFlow's `onConnectWallet`) is wired to
 *     the shared connect-modal's `open()`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthFlowProvider } from "./AuthFlowProvider";
import { useAuthFlow } from "./AuthFlowContext";

// ── Mock EmailAuthFlow ────────────────────────────────────────────────────────
// Avoid pulling in SignInModal/CreateAccountModal/OtpModal/ForgotPasswordModal/
// Turnstile/api machinery — AuthFlowProvider's own contract is what screen it
// opens and how it wires onConnectWallet, not the modals' own behavior.

vi.mock("@/components/EmailAuthFlow", () => ({
  EmailAuthFlow: ({
    open,
    initialScreen,
    onClose,
    onConnectWallet,
  }: {
    open: boolean;
    initialScreen?: string;
    onClose: () => void;
    onConnectWallet?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Email auth" data-testid="email-auth-flow">
        <span data-testid="email-auth-flow-screen">{initialScreen}</span>
        <button onClick={onClose}>Close</button>
        <button onClick={onConnectWallet}>Continue with wallet</button>
      </div>
    ) : null,
}));

// ── Mock the connect-modal hook ───────────────────────────────────────────────

const mockOpenConnectModal = vi.fn();

vi.mock("@/wallet", () => ({
  useConnectModal: () => ({ open: mockOpenConnectModal, close: vi.fn() }),
}));

// ── Consumer ──────────────────────────────────────────────────────────────────

function ConsumerButtons() {
  const { open, close } = useAuthFlow();
  return (
    <>
      <button onClick={() => open("sign-in")}>Open Sign In</button>
      <button onClick={() => open("create-account")}>Open Sign Up</button>
      <button onClick={() => open()}>Open Default</button>
      <button onClick={close}>Close Via Context</button>
    </>
  );
}

// ── Tests: outside provider ───────────────────────────────────────────────────

describe("useAuthFlow — outside provider", () => {
  it("throws", () => {
    expect(() => renderHook(() => useAuthFlow())).toThrow(
      /useAuthFlow must be used within an AuthFlowProvider/,
    );
  });
});

// ── Tests: open / close ───────────────────────────────────────────────────────

describe("AuthFlowProvider — open / close", () => {
  it("flow is absent initially", () => {
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );
    expect(screen.queryByTestId("email-auth-flow")).not.toBeInTheDocument();
  });

  it('open("sign-in") renders EmailAuthFlow on the sign-in screen', async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Sign In" }));

    await waitFor(() =>
      expect(screen.getByTestId("email-auth-flow")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("email-auth-flow-screen")).toHaveTextContent(
      "sign-in",
    );
  });

  it('open("create-account") renders EmailAuthFlow on the create-account screen', async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Sign Up" }));

    await waitFor(() =>
      expect(screen.getByTestId("email-auth-flow")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("email-auth-flow-screen")).toHaveTextContent(
      "create-account",
    );
  });

  it("open() with no argument defaults to the sign-in screen", async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Default" }));

    await waitFor(() =>
      expect(screen.getByTestId("email-auth-flow-screen")).toHaveTextContent(
        "sign-in",
      ),
    );
  });

  it("close() via context hides the flow", async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Sign In" }));
    await screen.findByTestId("email-auth-flow");

    await user.click(screen.getByRole("button", { name: "Close Via Context" }));

    await waitFor(() =>
      expect(screen.queryByTestId("email-auth-flow")).not.toBeInTheDocument(),
    );
  });

  it("the flow's own onClose hides it", async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Sign In" }));
    await screen.findByTestId("email-auth-flow");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByTestId("email-auth-flow")).not.toBeInTheDocument(),
    );
  });
});

// ── Tests: Continue with wallet ───────────────────────────────────────────────

describe("AuthFlowProvider — Continue with wallet", () => {
  it("onConnectWallet is wired to the shared connect-modal's open()", async () => {
    const user = userEvent.setup();
    render(
      <AuthFlowProvider>
        <ConsumerButtons />
      </AuthFlowProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Open Sign In" }));
    await screen.findByTestId("email-auth-flow");

    await user.click(
      screen.getByRole("button", { name: "Continue with wallet" }),
    );

    expect(mockOpenConnectModal).toHaveBeenCalledOnce();
  });
});
