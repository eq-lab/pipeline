import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TextField } from "@pipeline/ui";

function Controlled({
  onChange,
  value: initialValue = "",
  ...rest
}: Partial<React.ComponentProps<typeof TextField>> & {
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  return (
    <TextField
      value={value}
      {...rest}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("TextField (#1248)", () => {
  it("renders a text input by default", () => {
    render(<Controlled placeholder="Name" />);
    const input = screen.getByPlaceholderText("Name");
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders an email input", () => {
    render(<Controlled type="email" placeholder="Enter corporate email" />);
    expect(
      screen.getByPlaceholderText("Enter corporate email"),
    ).toHaveAttribute("type", "email");
  });

  it("renders a password input with the eye toggle button", () => {
    render(<Controlled type="password" placeholder="Password" />);
    const input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toBeInTheDocument();
  });

  it("the eye toggle flips input type and aria-label", async () => {
    const user = userEvent.setup();
    render(<Controlled type="password" placeholder="Password" />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    await user.click(toggle);

    expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
      "type",
      "text",
    );
    expect(
      screen.getByRole("button", { name: "Hide password" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByPlaceholderText("Password")).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("a non-password field renders no eye toggle button", () => {
    render(<Controlled type="text" placeholder="Name" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("invalid sets aria-invalid; absent invalid leaves it unset", () => {
    const { rerender } = render(
      <Controlled placeholder="Name" invalid={false} />,
    );
    expect(screen.getByPlaceholderText("Name")).not.toHaveAttribute(
      "aria-invalid",
    );

    rerender(<Controlled placeholder="Name" invalid />);
    expect(screen.getByPlaceholderText("Name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("error renders a role=alert message wired via aria-describedby", () => {
    render(
      <Controlled
        placeholder="Enter corporate email"
        invalid
        error="Enter the correct email address"
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Enter the correct email address");

    const input = screen.getByPlaceholderText("Enter corporate email");
    expect(input).toHaveAttribute("aria-describedby", alert.id);
  });

  it("no error prop renders no alert", () => {
    render(<Controlled placeholder="Name" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("onChange receives the next string, not the event", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled placeholder="Name" onChange={onChange} />);

    await user.type(screen.getByPlaceholderText("Name"), "ab");

    expect(onChange).toHaveBeenCalledWith("a");
    expect(onChange).toHaveBeenCalledWith("ab");
  });

  it("token-exactness: field box carries the card radius and h-14 box", () => {
    render(<Controlled placeholder="Name" />);
    const field = screen.getByPlaceholderText("Name").parentElement;
    expect(field?.className).toContain("rounded-[var(--radius-pipeline-card)]");
    expect(field?.className).toContain("h-14");
  });

  it("token-exactness: invalid fill uses the negative-secondary token", () => {
    render(<Controlled placeholder="Name" invalid />);
    const field = screen.getByPlaceholderText("Name").parentElement;
    expect(field?.className).toContain(
      "bg-[var(--color-pipeline-negative-secondary)]",
    );
  });

  it("token-exactness: invalid text uses the negative-strong token", () => {
    render(<Controlled placeholder="Name" invalid />);
    expect(screen.getByPlaceholderText("Name").className).toContain(
      "text-[color:var(--color-pipeline-negative-strong)]",
    );
  });
});
