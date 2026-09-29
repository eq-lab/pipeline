// spec: docs/frontend/auth-components.md#emailauthflow
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEmailAuthFlow } from "./useEmailAuthFlow";
import { ApiError } from "@/api";
import { clearSession, readSession } from "@/auth/session";

const mockLogin = vi.fn();
const mockVerifyOtp = vi.fn();
const mockSignup = vi.fn();
const mockResendOtp = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    login: (...args: unknown[]) => mockLogin(...args),
    verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    signup: (...args: unknown[]) => mockSignup(...args),
    resendOtp: (...args: unknown[]) => mockResendOtp(...args),
  };
});

beforeEach(() => {
  mockLogin.mockReset();
  mockVerifyOtp.mockReset();
  mockSignup.mockReset();
  mockResendOtp.mockReset();
  clearSession();
});

describe("useEmailAuthFlow — authenticated identity", () => {
  it("saves the submitted login email with the token", async () => {
    mockLogin.mockResolvedValue({ token: "login-jwt", expires_in: 3600 });
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, onClose: vi.fn() }),
    );
    await act(async () =>
      result.current.handleSignInSubmit({
        email: " LP@Example.COM ",
        password: "password",
      }),
    );
    expect(readSession()?.email).toBe("lp@example.com");
  });

  it("saves the OTP email with the token", async () => {
    mockSignup.mockResolvedValue(undefined);
    mockVerifyOtp.mockResolvedValue({ token: "otp-jwt", expires_in: 3600 });
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, onClose: vi.fn() }),
    );
    act(() => result.current.onSignupToken("captcha"));
    await act(async () =>
      result.current.handleCreateAccountSubmit({
        email: " LP@Example.COM ",
        password: "password",
      }),
    );
    await act(async () => result.current.handleOtpVerify("123456"));
    expect(readSession()?.email).toBe("lp@example.com");
  });
});

describe("useEmailAuthFlow — captcha token lifecycle (#1265 review)", () => {
  it("uses only a new OTP token after returning to Sign In and entering OTP again", async () => {
    mockLogin.mockRejectedValue(new ApiError(403, "email_not_verified"));
    mockResendOtp.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, initialScreen: "otp", onClose: vi.fn() }),
    );
    act(() => result.current.onOtpToken("old-token"));
    act(() => result.current.goToSignIn());
    await act(async () => {
      await result.current
        .handleSignInSubmit({
          email: "lp@example.com",
          password: "Test1234!",
        })
        .catch(() => {});
    });
    expect(result.current.screen).toBe("otp");
    expect(mockResendOtp).not.toHaveBeenCalled();

    act(() => result.current.onOtpToken("new-token"));
    await waitFor(() =>
      expect(mockResendOtp).toHaveBeenCalledWith({
        email: "lp@example.com",
        captchaToken: "new-token",
      }),
    );
    expect(mockResendOtp).toHaveBeenCalledTimes(1);
  });

  it("ignores an old signup success after the flow closes and reopens", async () => {
    let resolveSignup!: () => void;
    mockSignup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSignup = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useEmailAuthFlow({
          open: props.open,
          initialScreen: "create-account",
          onClose: vi.fn(),
        }),
      { initialProps: { open: true } },
    );
    act(() => result.current.onSignupToken("old-token"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleCreateAccountSubmit({
        email: "lp@example.com",
        password: "Test1234!",
      });
    });
    rerender({ open: false });
    rerender({ open: true });
    const newWidgetReset = vi.fn();
    act(() => {
      result.current.signupTurnstileRef.current = {
        reset: newWidgetReset,
        retry: vi.fn(),
      };
      result.current.onSignupToken("new-token");
    });
    await act(async () => {
      resolveSignup();
      await pending;
    });
    expect(result.current.screen).toBe("create-account");
    expect(result.current.signupCaptchaReady).toBe(true);
    expect(newWidgetReset).not.toHaveBeenCalled();
  });

  it("does not submit with an expired signup token", async () => {
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, onClose: vi.fn() }),
    );
    act(() => result.current.onSignupToken("stale-token"));
    expect(result.current.signupCaptchaReady).toBe(true);
    act(() => result.current.onSignupCaptchaStatus("loading"));
    expect(result.current.signupCaptchaReady).toBe(false);
    await act(async () => {
      await result.current.handleCreateAccountSubmit({
        email: "lp@example.com",
        password: "Test1234!",
      });
    });
    expect(mockSignup).not.toHaveBeenCalled();
    expect(result.current.createAccountFormError).toContain(
      "Verification is still loading",
    );
  });

  it("closing the flow clears the signup captcha token and resets the widget", () => {
    const resetSignup = vi.fn();
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useEmailAuthFlow({ open: props.open, onClose: vi.fn() }),
      { initialProps: { open: true } },
    );

    act(() => {
      result.current.signupTurnstileRef.current = {
        reset: resetSignup,
        retry: vi.fn(),
      };
      result.current.onSignupToken("stale-signup-token");
    });
    expect(result.current.signupCaptchaReady).toBe(true);

    rerender({ open: false });

    expect(result.current.signupCaptchaReady).toBe(false);
    expect(resetSignup).toHaveBeenCalledTimes(1);
  });

  it("closing the flow clears the otp captcha token so a stale token can't be resent", async () => {
    const resetOtp = vi.fn();
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useEmailAuthFlow({ open: props.open, onClose: vi.fn() }),
      { initialProps: { open: true } },
    );

    act(() => {
      result.current.otpTurnstileRef.current = {
        reset: resetOtp,
        retry: vi.fn(),
      };
      result.current.onOtpToken("stale-otp-token");
    });

    rerender({ open: false });
    expect(resetOtp).toHaveBeenCalledTimes(1);

    rerender({ open: true });

    await expect(result.current.handleOtpResend()).rejects.toThrow();
  });
});

describe("useEmailAuthFlow — sign-in error lifecycle (#1265 review)", () => {
  it("navigating away from sign-in and back clears a password-field error from a prior attempt", async () => {
    mockLogin.mockRejectedValue(new ApiError(401, "invalid credentials"));
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, onClose: vi.fn() }),
    );

    await act(async () => {
      await result.current
        .handleSignInSubmit({ email: "a@b.com", password: "x" })
        .catch(() => {});
    });
    await waitFor(() =>
      expect(result.current.passwordServerError).toBe(
        "Incorrect email or password",
      ),
    );

    act(() => {
      result.current.goToCreateAccount();
    });
    act(() => {
      result.current.goToSignIn();
    });

    expect(result.current.passwordServerError).toBeUndefined();
  });

  it("clearSignInErrors resets a password-field error from a prior attempt", async () => {
    mockLogin.mockRejectedValue(new ApiError(401, "invalid credentials"));
    const { result } = renderHook(() =>
      useEmailAuthFlow({ open: true, onClose: vi.fn() }),
    );

    await act(async () => {
      await result.current
        .handleSignInSubmit({ email: "a@b.com", password: "x" })
        .catch(() => {});
    });
    await waitFor(() =>
      expect(result.current.passwordServerError).toBe(
        "Incorrect email or password",
      ),
    );

    act(() => {
      result.current.clearSignInErrors();
    });

    expect(result.current.passwordServerError).toBeUndefined();
    expect(result.current.signInFormError).toBeUndefined();
  });
});
