import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateAccountModal } from "./CreateAccountModal";

function renderModal(
  overrides: Partial<React.ComponentProps<typeof CreateAccountModal>> = {},
) {
  const onDismiss = overrides.onDismiss ?? vi.fn();
  const { rerender, ...rest } = render(
    <CreateAccountModal
      open={overrides.open ?? true}
      onDismiss={onDismiss}
      {...overrides}
    />,
  );
  return {
    onDismiss,
    rerender: (
      next: Partial<React.ComponentProps<typeof CreateAccountModal>> = {},
    ) =>
      rerender(
        <CreateAccountModal
          open={next.open ?? overrides.open ?? true}
          onDismiss={next.onDismiss ?? onDismiss}
          {...next}
        />,
      ),
    ...rest,
  };
}

const VALID_PASSWORD = "P@ssw0rd!";

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByPlaceholderText("Enter corporate email"),
    "lp@example.com",
  );
  await user.type(screen.getByPlaceholderText("Password"), VALID_PASSWORD);
}

describe("CreateAccountModal (#1249)", () => {
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

  it("role=dialog, aria-modal, and aria-labelledby resolve to the Create account heading", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = screen.getByRole("heading", { name: "Create account" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("submit is disabled with both fields empty", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
  });

  it("submit is enabled once both fields are non-empty and email is well-formed", async () => {
    const user = userEvent.setup();
    renderModal();
    await fillValid(user);
    expect(screen.getByRole("button", { name: "Sign Up" })).not.toBeDisabled();
  });

  it("submit stays disabled with a malformed email even once password is filled", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "dsfdffs",
    );
    await user.type(screen.getByPlaceholderText("Password"), "hunter2");
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
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
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Enter the correct password"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
  });

  it("the old sign-in password copy is never rendered by CreateAccountModal", () => {
    renderModal();
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(screen.queryByText("Enter the correct password")).toBeNull();
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
  });

  it("a submit attempt with a valid email and an empty password renders the policy copy and keeps submit disabled", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(
      screen.getByPlaceholderText("Enter corporate email"),
      "lp@example.com",
    );
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Up" })).toBeDisabled();
  });

  it("renders no password error while the field is empty and has never been blurred", () => {
    renderModal();
    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();
  });

  it("blurring an empty password field shows no error", () => {
    renderModal();
    fireEvent.blur(screen.getByPlaceholderText("Password"));
    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();
  });

  it("a weak password plus blur renders the exact policy copy", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByPlaceholderText("Password"), "weak");
    fireEvent.blur(screen.getByPlaceholderText("Password"));

    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();
  });

  it("the error clears live once the value satisfies the policy after being blurred once", async () => {
    const user = userEvent.setup();
    renderModal();
    const passwordField = screen.getByPlaceholderText("Password");
    await user.type(passwordField, "weak");
    fireEvent.blur(passwordField);
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();

    await user.type(passwordField, VALID_PASSWORD);

    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["P@ssw0r", false],
    ["Password!", false],
    ["Password1", false],
    ["12345678!", true],
    [VALID_PASSWORD, true],
  ])(
    "password %s is valid=%s per the policy (submit disabled state + error presence)",
    async (password, valid) => {
      const user = userEvent.setup();
      renderModal();
      await user.type(
        screen.getByPlaceholderText("Enter corporate email"),
        "lp@example.com",
      );
      const passwordField = screen.getByPlaceholderText("Password");
      await user.type(passwordField, password);
      fireEvent.blur(passwordField);

      const submit = screen.getByRole("button", { name: "Sign Up" });
      const error = screen.queryByText(
        "At least 8 characters, including a number and a special character",
      );
      if (valid) {
        expect(submit).not.toBeDisabled();
        expect(error).not.toBeInTheDocument();
      } else {
        expect(submit).toBeDisabled();
        expect(error).toBeInTheDocument();
      }
    },
  );

  it("clicking submit with valid input calls onSubmit once with { email, password }", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    await fillValid(user);

    await user.click(screen.getByRole("button", { name: "Sign Up" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      email: "lp@example.com",
      password: VALID_PASSWORD,
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
      user.click(screen.getByRole("button", { name: "Sign Up" })),
    ).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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

  it("reopening the modal clears the password error and passwordTouched", async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal();
    const passwordField = screen.getByPlaceholderText("Password");
    await user.type(passwordField, "weak");
    fireEvent.blur(passwordField);
    expect(
      screen.getByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).toBeInTheDocument();

    rerender({ open: false });
    rerender({ open: true });

    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();

    fireEvent.blur(screen.getByPlaceholderText("Password"));
    expect(
      screen.queryByText(
        "At least 8 characters, including a number and a special character",
      ),
    ).not.toBeInTheDocument();
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

  it("the password eye toggle flips the input type and its accessible name", async () => {
    const user = userEvent.setup();
    renderModal();
    const toggle = screen.getByRole("button", { name: "Show password" });
    await user.click(toggle);

    expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
      "type",
      "text",
    );
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toBeInTheDocument();
  });

  it("renders exactly two inputs — no confirm-password, company field, or checkbox", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("input")).toHaveLength(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not render a Forgot password? line", () => {
    renderModal();
    expect(screen.queryByText("Forgot password?")).not.toBeInTheDocument();
  });

  it("does not render a New here? line", () => {
    renderModal();
    expect(screen.queryByText(/New here\?/)).not.toBeInTheDocument();
  });

  it("footer reads 'Already have an account?' + 'Log in' and is not interactive", () => {
    renderModal();
    const footer = screen.getByText(/Already have an account\?/).closest("p");
    expect(footer).not.toBeNull();
    expect(within(footer!).getByText("Log in")).toBeInTheDocument();
    expect(within(footer!).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(footer!).queryByRole("button", { name: "Log in" }),
    ).not.toBeInTheDocument();
  });
});
