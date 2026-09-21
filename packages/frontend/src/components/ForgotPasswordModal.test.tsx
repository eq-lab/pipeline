import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForgotPasswordModal } from "./ForgotPasswordModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof ForgotPasswordModal>> = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const { rerender, ...rest } = render(
    <ForgotPasswordModal
      open={overrides.open ?? true}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return {
    onDismiss,
    rerender: (
      next: Partial<React.ComponentProps<typeof ForgotPasswordModal>> = {},
    ) =>
      rerender(
        <ForgotPasswordModal
          open={next.open ?? overrides.open ?? true}
          onDismiss={next.onDismiss ?? onDismiss}
          {...next}
        />,
      ),
    ...rest,
  };
}

describe("ForgotPasswordModal (#1280)", () => {
  afterEach(() => {
    document.body.style.overflow = "";
  });

  it("renders nothing when open=false", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("portals into document.body when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("role=dialog, aria-modal, and aria-labelledby resolve to the Reset your password heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = screen.getByRole("heading", {
      name: "Reset your password",
    });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("has exactly one email input and no password field, wallet button, or OR divider", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const inputs = dialog.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("type", "email");
    expect(
      screen.getByPlaceholderText("Enter corporate email"),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with wallet/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("OR")).not.toBeInTheDocument();
  });

  it("submit is disabled with the field empty", () => {
    renderModal();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeDisabled();
  });

  it("submit becomes enabled once a well-formed email is typed", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).not.toBeDisabled();
  });

  it("a malformed email shows the error on blur and keeps submit disabled", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByPlaceholderText("Enter corporate email");
    await user.type(input, "dsfdffs");
    fireEvent.blur(input);
    expect(
      screen.getByText("Enter the correct email address"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeDisabled();
  });

  it("a submit attempt with an empty field shows no error and leaves submit disabled", () => {
    renderModal();
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    expect(
      screen.queryByText("Enter the correct email address"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeDisabled();
  });

  it("a valid submit calls onSubmit exactly once with { email }", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send Reset Link" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ email: "lp@example.com" });
  });

  it("with no onSubmit prop, a valid submit neither throws nor calls fetch", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(undefined as unknown as Response);
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    await expect(
      user.click(screen.getByRole("button", { name: "Send Reset Link" })),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("state resets when open goes false then true", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    const input = screen.getByPlaceholderText("Enter corporate email");
    await user.type(input, "dsfdffs");
    fireEvent.blur(input);
    expect(
      screen.getByText("Enter the correct email address"),
    ).toBeInTheDocument();

    rerender({ open: false });
    rerender({ open: true });

    expect(
      (screen.getByPlaceholderText("Enter corporate email") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      screen.queryByText("Enter the correct email address"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeDisabled();
  });

  it("shell composition: image panel present, close button present, no Back button, no Step badge, column centered", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^Step /)).not.toBeInTheDocument();
    const column = dialog.querySelector(".max-w-\\[400px\\]");
    expect(column?.className).toContain("my-auto");
  });

  it("Escape calls onDismiss once", () => {
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("the × button calls onDismiss once", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('"Back to sign in" is a real button, calls onBackToSignIn exactly once, and does not throw when omitted', async () => {
    const user = userEvent.setup();
    const onBackToSignIn = vi.fn();
    renderModal({ onBackToSignIn });
    await user.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(onBackToSignIn).toHaveBeenCalledTimes(1);
  });

  it('"Back to sign in" does not throw when onBackToSignIn is omitted, and "Remembered it?" prefix renders', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByText(/Remembered it\?/)).toBeInTheDocument();
    await expect(
      user.click(screen.getByRole("button", { name: "Back to sign in" })),
    ).resolves.not.toThrow();
  });

  it("copy is verbatim, including the trailing space on the muted span", () => {
    renderModal();
    expect(
      screen.getByRole("heading", { name: "Reset your password" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send Reset Link" }),
    ).toBeInTheDocument();
    const mutedSpan = screen.getByText((_, el) =>
      el?.tagName.toLowerCase() === "span"
        ? el.textContent === "Remembered it? "
        : false,
    );
    expect(mutedSpan.textContent).toBe("Remembered it? ");
    expect(
      screen.getByRole("button", { name: "Back to sign in" }),
    ).toBeInTheDocument();
  });

  it("Tab from the last focusable element wraps to the first (focus trap)", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    const focusable = dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled])",
    );
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });
});
