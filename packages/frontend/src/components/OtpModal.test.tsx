import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpModal } from "./OtpModal";
import { OTP_ERROR_VISIBLE_MS } from "./useOtpModal";
import { ApiError } from "@/api";

function renderModal(
  props: Partial<React.ComponentProps<typeof OtpModal>> = {},
) {
  const onBack = props.onBack ?? vi.fn();
  return {
    onBack,
    ...render(
      <OtpModal open={props.open ?? true} onBack={onBack} {...props} />,
    ),
  };
}

async function typeCode(
  user: ReturnType<typeof userEvent.setup>,
  code = "111111",
) {
  const input = screen.getByLabelText("Verification code");
  await user.click(input);
  await user.paste(code);
}

function boxTexts() {
  const row = screen.getByLabelText("Verification code").parentElement!;
  return Array.from(row.querySelectorAll(':scope > [aria-hidden="true"]')).map(
    (box) => box.textContent,
  );
}

function pendingVerify() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("OtpModal (#1250, #1265)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = "";
  });

  it("closed by default; open renders the dialog with accessible name", () => {
    const { rerender } = render(<OtpModal open={false} onBack={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<OtpModal open onBack={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: "Check your inbox" }),
    ).toBeInTheDocument();
  });

  it("renders the description verbatim with the default email", () => {
    renderModal();
    expect(
      screen.getByText("We’ve sent a passcode to user@email.io"),
    ).toBeInTheDocument();
  });

  it("an email prop replaces the address", () => {
    renderModal({ email: "kyb@acme.com" });
    expect(
      screen.getByText("We’ve sent a passcode to kyb@acme.com"),
    ).toBeInTheDocument();
  });

  it("default state shows Resend in 00:59 as plain text (not a button), no loader, no alert", () => {
    renderModal();
    const resend = screen.getByText("Resend in 00:59");
    expect(resend.tagName).toBe("P");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("countdown ticks down and becomes a clickable Resend button at zero", () => {
    renderModal();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("Resend in 00:49")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
    expect(screen.queryByText(/Resend in/)).not.toBeInTheDocument();
  });

  it("entering six digits calls verify and shows the loader", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const verify = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    renderModal({ verify });

    await typeCode(user);

    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith("111111");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("a rejected verify shows the error alert and aria-invalid", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Code is incorrect or expired. Request a new one.",
    );
    expect(screen.getByLabelText("Verification code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it.each([new Error("offline"), new ApiError(503, "unavailable")])(
    "shows a network error for a non-401 verification failure",
    async (error) => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const verify = vi.fn().mockRejectedValue(error);
      renderModal({ verify });
      await typeCode(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Network error",
      );
      expect(screen.getByLabelText("Verification code")).toHaveValue("111111");
    },
  );

  it("auto-resend failure unlocks Resend during the countdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resend = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderModal({ resend });
    rerender(
      <OtpModal
        open
        onBack={vi.fn()}
        resend={resend}
        autoResendResult={{ id: 1, status: "error" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The code was not sent",
    );
    await user.click(screen.getByRole("button", { name: "Resend" }));
    expect(resend).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Resend in 00:59")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Request accepted. If no code arrives, retry after the countdown.",
    );
  });

  it("a resolved verify fires onVerified and shows no error", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, resolve } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    const onVerified = vi.fn();
    renderModal({ verify, onVerified });

    await typeCode(user, "123456");
    await act(async () => {
      resolve();
      await promise;
    });

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith("123456");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("with no verify prop, entering a code rejects silently into the error state", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderModal();

    await typeCode(user);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not call verify again while a verify is already in flight (no double-submit)", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const verify = vi.fn().mockReturnValue(new Promise<void>(() => {}));
    renderModal({ verify });

    await typeCode(user);
    await typeCode(user);

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("editing the code from the error state clears the alert and aria-invalid", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject();
      await promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Verification code"), "{backspace}");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("editing the code while a verify is in flight discards the stale result", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, resolve } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    const onVerified = vi.fn();
    renderModal({ verify, onVerified });

    await typeCode(user, "111111");
    expect(screen.getByRole("status")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Verification code"), "{backspace}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      resolve();
      await promise;
    });

    expect(onVerified).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a rejected resend shows an alert and does not restart the countdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resend = vi.fn().mockRejectedValue(new Error("boom"));
    renderModal({ resend });

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    const resendButton = screen.getByRole("button", { name: "Resend" });
    await user.click(resendButton);

    expect(resend).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't resend the code. Try again.",
    );
    expect(screen.queryByText(/Resend in/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
  });

  it("clicking Resend once enabled calls resend and restarts the countdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resend = vi.fn().mockResolvedValue(undefined);
    renderModal({ resend });

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    const resendButton = screen.getByRole("button", { name: "Resend" });
    await user.click(resendButton);

    expect(resend).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Resend in 00:59")).toBeInTheDocument();
  });

  it("the back arrow calls onBack; Escape calls onBack; no close button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onBack = vi.fn();
    renderModal({ onBack });

    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("focus lands on the OTP input on open, not the back button", () => {
    renderModal();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByLabelText("Verification code")).toHaveFocus();
  });

  it("reopening resets code, status and countdown, and closing mid-window cancels it cleanly", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    const { rerender } = renderModal({ open: false, verify });

    rerender(<OtpModal open onBack={vi.fn()} verify={verify} />);
    await typeCode(user);
    await act(async () => {
      reject();
      await promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    rerender(<OtpModal open={false} onBack={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS * 2);
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();

    rerender(<OtpModal open onBack={vi.fn()} />);

    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Resend in 00:59")).toBeInTheDocument();
  });

  it("renders a turnstileSlot when provided", () => {
    renderModal({ turnstileSlot: <div data-testid="turnstile-stub" /> });
    expect(screen.getByTestId("turnstile-stub")).toBeInTheDocument();
  });

  it("renders no image pane", () => {
    renderModal();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });

  it("the error clears itself after OTP_ERROR_VISIBLE_MS, leaving six empty boxes and focus on the input", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS);
    });

    const input = screen.getByLabelText("Verification code");
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(boxTexts()).toEqual(["", "", "", "", "", ""]);
    expect(input).toHaveFocus();
  });

  it("the error is held for the whole window and not a moment less", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS - 100);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Code is incorrect or expired. Request a new one.",
    );
    const input = screen.getByLabelText("Verification code");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveValue("111111");
  });

  it("typing during the window pre-empts the clear and cancels it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await user.type(screen.getByLabelText("Verification code"), "{backspace}");

    const input = screen.getByLabelText("Verification code");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveValue("11111");

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS);
    });

    expect(screen.getByLabelText("Verification code")).toHaveValue("11111");
  });

  it("a second rejection restarts the window instead of stacking timers", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const verify = vi.fn().mockRejectedValue(new ApiError(401, "invalid code"));
    renderModal({ verify });

    await typeCode(user);
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Verification code"), "{backspace}2");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveValue("");
  });

  it("a successful verify schedules no window and nothing clears later", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, resolve } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    const onVerified = vi.fn();
    renderModal({ verify, onVerified });

    await typeCode(user, "123456");
    await act(async () => {
      resolve();
      await promise;
    });

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS * 5);
    });

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveValue("123456");
  });

  it("a stale rejection never schedules a window and leaves the edited code alone", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await user.type(screen.getByLabelText("Verification code"), "{backspace}");

    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS * 2);
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveValue("11111");
  });

  it("clicking Resend clears the code and the error, cancels the window and restarts the countdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const resend = vi.fn().mockResolvedValue(undefined);
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify, resend });

    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resend" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(resend).toHaveBeenCalledTimes(1);
    const input = screen.getByLabelText("Verification code");
    expect(input).toHaveValue("");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(screen.getByText("Resend in 00:59")).toBeInTheDocument();
  });

  it("focus is reclaimed the moment the rejection lands, even if the input was blurred", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    const input = screen.getByLabelText("Verification code");
    act(() => {
      fireEvent.blur(input);
      input.blur();
    });
    expect(input).not.toHaveFocus();

    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveFocus();
  });

  it("focus is restored by the auto-clear after the input was blurred during the window", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    const input = screen.getByLabelText("Verification code");
    act(() => {
      fireEvent.blur(input);
      input.blur();
    });
    expect(input).not.toHaveFocus();

    act(() => {
      vi.advanceTimersByTime(OTP_ERROR_VISIBLE_MS);
    });

    expect(screen.getByLabelText("Verification code")).toHaveFocus();
  });

  it("the reclaim leaves focus alone when the user has deliberately moved it to a button", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { promise, reject } = pendingVerify();
    const verify = vi.fn().mockReturnValue(promise);
    renderModal({ verify });

    await typeCode(user);
    const back = screen.getByRole("button", { name: "Back" });
    act(() => back.focus());

    await act(async () => {
      reject(new ApiError(401, "invalid code"));
      await promise.catch(() => {});
    });

    expect(back).toHaveFocus();
  });
});
