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

describe("OtpModal (#1250)", () => {
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

  it("default state shows Resend in 00:59, no loader, no alert", () => {
    renderModal();
    expect(screen.getByText("Resend in 00:59")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("countdown ticks down and stops at Resend", () => {
    renderModal();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("Resend in 00:49")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Resend")).toBeInTheDocument();
    expect(screen.queryByText(/Resend in/)).not.toBeInTheDocument();
  });

  it("entering six digits fires onSubmit and shows the loader", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    const onSubmit = vi.fn();
    renderModal({ onSubmit });

    await typeCode(user);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("111111");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/Resend in 00:5\d/)).toBeInTheDocument();
  });

  it("a wrong code shows the error alert and aria-invalid after the mock delay", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    renderModal();

    await typeCode(user);
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the correct code",
    );
    expect(screen.getByLabelText("Verification code")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("the valid code 123456 fires onVerified and shows no error", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    const onVerified = vi.fn();
    renderModal({ onVerified });

    await typeCode(user, "123456");
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith("123456");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("the countdown keeps ticking through the error state", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    renderModal();

    await typeCode(user);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Resend in 00:5\d/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Resend")).toBeInTheDocument();
  });

  it("editing the code from the error state clears the alert and aria-invalid", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    renderModal();

    await typeCode(user);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Verification code"), "{backspace}");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("the back arrow calls onBack; Escape calls onBack; no close button", async () => {
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
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
    const user = userEvent.setup({
      advanceTimers: vi.advanceTimersByTime,
    });
    const { rerender } = renderModal({ open: false });

    rerender(<OtpModal open onBack={vi.fn()} />);
    await typeCode(user);
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(<OtpModal open={false} onBack={vi.fn()} />);
    rerender(<OtpModal open onBack={vi.fn()} />);

    expect(screen.getByLabelText("Verification code")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Resend in 00:59")).toBeInTheDocument();
  });

  it("renders no image pane", () => {
    renderModal();
    expect(document.querySelector("img")).not.toBeInTheDocument();
  });
});
