import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpModal } from "./OtpModal";

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

function pendingVerify() {
  let resolve!: () => void;
  let reject!: () => void;
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
      reject();
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

  it("reopening resets code, status and countdown", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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

    rerender(<OtpModal open={false} onBack={vi.fn()} />);
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
});
