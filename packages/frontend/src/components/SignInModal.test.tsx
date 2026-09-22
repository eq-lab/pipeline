import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInModal } from "./SignInModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof SignInModal>> = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const { rerender, ...rest } = render(
    <SignInModal
      open={overrides.open ?? true}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return {
    onDismiss,
    rerender: (next: Partial<React.ComponentProps<typeof SignInModal>> = {}) =>
      rerender(
        <SignInModal
          open={next.open ?? overrides.open ?? true}
          onDismiss={next.onDismiss ?? onDismiss}
          {...next}
        />,
      ),
    ...rest,
  };
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("Enter corporate email"),
    "lp@example.com",
  );
  await user.type(screen.getByPlaceholderText("Password"), "hunter2");
}

describe("SignInModal (#1248)", () => {
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

  it("role=dialog, aria-modal, and aria-labelledby resolve to the Sign in heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = screen.getByRole("heading", { name: "Sign in" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("submit is disabled with both fields empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();
  });

  it("submit is enabled once both fields are non-empty and email is well-formed", async () => {
    const user = userEvent.setup();
    renderModal();
    await fillValid(user);
    expect(screen.getByRole("button", { name: "Sign In" })).not.toBeDisabled();
  });

  it("submit stays disabled with a malformed email even once password is filled", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "dsfdffs",
    );
    await user.type(screen.getByPlaceholderText("Password"), "hunter2");
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();
  });

  it("both error messages render with the exact Figma copy after an invalid submit, and submit stays disabled", () => {
    renderModal();
    const form = document.querySelector("form") as HTMLFormElement;

    fireEvent.change(screen.getByPlaceholderText("Enter corporate email"), {
      target: { value: "dsfdffs" },
    });
    fireEvent.submit(form);

    expect(
      screen.getByText("Enter the correct email address"),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter the correct password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeDisabled();
  });

  it("blurring an invalid password renders no error (sign-in has no password-complexity rule)", async () => {
    const user = userEvent.setup();
    renderModal();
    const passwordField = screen.getByPlaceholderText("Password");
    await user.type(passwordField, "hunter2");
    fireEvent.blur(passwordField);

    expect(
      screen.queryByText("Enter the correct password"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();
  });

  it("clicking submit with valid input calls onSubmit once with { email, password }", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await fillValid(user);

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      email: "lp@example.com",
      password: "hunter2",
    });
  });

  it("with no onSubmit prop, a valid submit neither throws nor calls fetch", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(undefined as unknown as Response);
    renderModal();
    await fillValid(user);

    await expect(
      user.click(screen.getByRole("button", { name: "Sign In" })),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("no layout shift: the field row keeps its box classes (h-14) with and without error", () => {
    render(<SignInModal open onDismiss={vi.fn()} />);
    const fieldRow = () =>
      screen.getByPlaceholderText("Enter corporate email")
        .parentElement as HTMLElement;
    expect(fieldRow().className).toContain("h-14");

    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.change(screen.getByPlaceholderText("Enter corporate email"), {
      target: { value: "dsfdffs" },
    });
    fireEvent.submit(form);

    expect(fieldRow().className).toContain("h-14");

    const alert = screen.getByText("Enter the correct email address");
    expect(alert.className).toContain("absolute");
    expect(alert.className).toContain("top-full");
  });

  it("state resets when open goes false then true", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    await fillValid(user);
    expect(
      (screen.getByPlaceholderText("Enter corporate email") as HTMLInputElement)
        .value,
    ).toBe("lp@example.com");

    rerender({ open: false });
    rerender({ open: true });

    expect(
      (screen.getByPlaceholderText("Enter corporate email") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (screen.getByPlaceholderText("Password") as HTMLInputElement).value,
    ).toBe("");
  });

  it("Escape calls onDismiss", () => {
    const { onDismiss } = renderModal();
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("the × button calls onDismiss", async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
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

  it('"Forgot password?" is a button and calls onForgotPassword exactly once when clicked', async () => {
    const user = userEvent.setup();
    const onForgotPassword = vi.fn();
    renderModal({ onForgotPassword });
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
  });

  it("with no onForgotPassword prop, clicking it does not throw and does not call onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await expect(
      user.click(screen.getByRole("button", { name: "Forgot password?" })),
    ).resolves.not.toThrow();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('"Create account" is a button and calls onCreateAccount exactly once when clicked', async () => {
    const user = userEvent.setup();
    const onCreateAccount = vi.fn();
    renderModal({ onCreateAccount });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(onCreateAccount).toHaveBeenCalledTimes(1);
  });

  it("with no onCreateAccount prop, clicking it does not throw and does not call onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await expect(
      user.click(screen.getByRole("button", { name: "Create account" })),
    ).resolves.not.toThrow();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
