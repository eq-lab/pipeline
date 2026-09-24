import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { forwardRef, useEffect, useImperativeHandle } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmailAuthFlow } from "./EmailAuthFlow";
import { ApiError } from "@/api";
import { readSession } from "@/auth/session";

const mockSignup = vi.fn();
const mockVerifyOtp = vi.fn();
const mockResendOtp = vi.fn();
const mockLogin = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ApiError: actual.ApiError,
    signup: (...args: unknown[]) => mockSignup(...args),
    verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    resendOtp: (...args: unknown[]) => mockResendOtp(...args),
    login: (...args: unknown[]) => mockLogin(...args),
  };
});

vi.mock("@/components/Turnstile", () => ({
  Turnstile: forwardRef(function MockTurnstile(
    { onToken }: { onToken: (t: string) => void },
    ref,
  ) {
    useEffect(() => {
      onToken("test-captcha-token");
    }, [onToken]);
    useImperativeHandle(ref, () => ({ reset: () => {} }));
    return null;
  }),
}));

async function fillCredentials(
  user: ReturnType<typeof userEvent.setup>,
  email = "lp@example.com",
  password = "P@ssw0rd!",
) {
  await user.type(screen.getByPlaceholderText("Enter corporate email"), email);
  await user.type(screen.getByPlaceholderText("Password"), password);
}

beforeEach(() => {
  localStorage.clear();
  mockSignup.mockReset();
  mockVerifyOtp.mockReset();
  mockResendOtp.mockReset();
  mockLogin.mockReset();
});

afterEach(() => {
  document.body.style.overflow = "";
});

describe("EmailAuthFlow — signup happy path", () => {
  it("signup -> OTP -> verify -> session saved and modal closes", async () => {
    const user = userEvent.setup();
    mockSignup.mockResolvedValue(undefined);
    mockVerifyOtp.mockResolvedValue({ token: "jwt", expires_in: 86400 });
    const onClose = vi.fn();
    const onAuthenticated = vi.fn();

    render(
      <EmailAuthFlow
        open
        initialScreen="create-account"
        onClose={onClose}
        onAuthenticated={onAuthenticated}
      />,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(mockSignup).toHaveBeenCalledWith({
      email: "lp@example.com",
      password: "P@ssw0rd!",
      captchaToken: "test-captcha-token",
    });

    await screen.findByRole("dialog", { name: "Check your inbox" });

    const otpInput = screen.getByLabelText("Verification code");
    await user.click(otpInput);
    await user.paste("123456");

    await waitFor(() =>
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        email: "lp@example.com",
        code: "123456",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(readSession()?.token).toBe("jwt");
  });
});

describe("EmailAuthFlow — sign-in error branches", () => {
  it("401 renders a password-field error and keeps the modal open", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(401, "invalid credentials"));
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText("Incorrect email or password"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("429 renders a form-level lockout error", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(429, "too many sign-in attempts"));
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );
  });

  it("403 email_not_verified triggers a resend and opens the OTP screen", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(403, "email_not_verified"));
    mockResendOtp.mockResolvedValue(undefined);
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await screen.findByRole("dialog", { name: "Check your inbox" });

    await waitFor(() =>
      expect(mockResendOtp).toHaveBeenCalledWith({
        email: "lp@example.com",
        captchaToken: "test-captcha-token",
      }),
    );
  });

  it("403 suspended renders a form-level error, not the OTP screen", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(403, "account is suspended"));
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account is suspended. Contact support.",
    );
    expect(
      screen.queryByRole("dialog", { name: "Check your inbox" }),
    ).not.toBeInTheDocument();
  });

  it("a password-field error clears when navigating away from sign-in and back", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(401, "invalid credentials"));
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(
      await screen.findByText("Incorrect email or password"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      screen.queryByText("Incorrect email or password"),
    ).not.toBeInTheDocument();
  });

  it("a lockout form error clears when the password field is edited", async () => {
    const user = userEvent.setup();
    mockLogin.mockRejectedValue(new ApiError(429, "too many sign-in attempts"));
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a minute.",
    );

    await user.type(screen.getByPlaceholderText("Password"), "!");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a successful login saves the session and closes the modal", async () => {
    const user = userEvent.setup();
    mockLogin.mockResolvedValue({ token: "jwt", expires_in: 86400 });
    const onClose = vi.fn();
    const onAuthenticated = vi.fn();
    render(
      <EmailAuthFlow
        open
        onClose={onClose}
        onAuthenticated={onAuthenticated}
      />,
    );

    await fillCredentials(user);
    await user.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onAuthenticated).toHaveBeenCalledTimes(1);
    expect(readSession()?.token).toBe("jwt");
  });
});

describe("EmailAuthFlow — continue with wallet", () => {
  it("closes the auth modal and calls onConnectWallet", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConnectWallet = vi.fn();
    render(
      <EmailAuthFlow
        open
        onClose={onClose}
        onConnectWallet={onConnectWallet}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Continue with wallet/i }),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConnectWallet).toHaveBeenCalledTimes(1);
  });
});

describe("EmailAuthFlow — cross-link navigation", () => {
  it("Create account -> Sign in -> Forgot password -> back to sign in, only one dialog at a time", async () => {
    const user = userEvent.setup();
    render(<EmailAuthFlow open onClose={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(
      screen.getByRole("heading", { name: "Create account" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(
      screen.getByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("forgot password submit calls onForgotPasswordSubmit and closes the flow", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onForgotPasswordSubmit = vi.fn();
    render(
      <EmailAuthFlow
        open
        initialScreen="forgot-password"
        onClose={onClose}
        onForgotPasswordSubmit={onForgotPasswordSubmit}
      />,
    );

    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));

    expect(onForgotPasswordSubmit).toHaveBeenCalledWith({
      email: "lp@example.com",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
