// spec: docs/frontend/auth-components.md#emailauthflow
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEmailAuthFlow } from "./useEmailAuthFlow";
import { ApiError } from "@/api";

const mockLogin = vi.fn();

vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  return {
    ...actual,
    login: (...args: unknown[]) => mockLogin(...args),
  };
});

beforeEach(() => {
  mockLogin.mockReset();
});

describe("useEmailAuthFlow — captcha token lifecycle (#1265 review)", () => {
  it("closing the flow clears the signup captcha token and resets the widget", () => {
    const resetSignup = vi.fn();
    const { result, rerender } = renderHook(
      (props: { open: boolean }) =>
        useEmailAuthFlow({ open: props.open, onClose: vi.fn() }),
      { initialProps: { open: true } },
    );

    act(() => {
      result.current.signupTurnstileRef.current = { reset: resetSignup };
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
      result.current.otpTurnstileRef.current = { reset: resetOtp };
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
