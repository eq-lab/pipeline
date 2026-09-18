import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OtpInput } from "@pipeline/ui";

function Controlled({
  onChange,
  value: initialValue = "",
  ...rest
}: Partial<React.ComponentProps<typeof OtpInput>> & {
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  return (
    <OtpInput
      value={value}
      {...rest}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function getInput() {
  return screen.getByLabelText("Verification code");
}

describe("OtpInput (#1250)", () => {
  it("renders six boxes by default", () => {
    const { container } = render(<Controlled />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(6);
  });

  it("length=4 renders four boxes", () => {
    const { container } = render(<Controlled length={4} />);
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(4);
  });

  it("typing digits fills boxes left to right", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), "12");
    expect(getInput()).toHaveValue("12");
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("non-digits are rejected", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), "a1b2");
    expect(getInput()).toHaveValue("12");
  });

  it("paste of 123456 fills all six", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(getInput());
    await user.paste("123456");
    expect(getInput()).toHaveValue("123456");
  });

  it("paste with spaces or dashes still sanitises to digits", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Controlled />);
    await user.click(getInput());
    await user.paste("12 34 56");
    expect(getInput()).toHaveValue("123456");
    unmount();

    render(<Controlled />);
    await user.click(getInput());
    await user.paste("123-456");
    expect(getInput()).toHaveValue("123456");
  });

  it("input beyond length is truncated", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(getInput());
    await user.paste("1234567");
    expect(getInput()).toHaveValue("123456");
  });

  it("backspace removes the last digit", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(getInput(), "123");
    await user.type(getInput(), "{backspace}");
    expect(getInput()).toHaveValue("12");
  });

  it("clicking any box focuses the single underlying input", async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled />);
    const box = container.querySelectorAll('[aria-hidden="true"]')[3]!;
    await user.click(box);
    expect(getInput()).toHaveFocus();
  });

  it("invalid sets aria-invalid and paints error tokens; no border on active box", async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled value="123456" invalid />);
    expect(getInput()).toHaveAttribute("aria-invalid", "true");
    const boxes = container.querySelectorAll('[aria-hidden="true"]');
    boxes.forEach((box) => {
      expect(box.className).toContain(
        "bg-[var(--color-pipeline-negative-secondary)]",
      );
      expect(box.className).not.toContain("border-solid");
    });
    await user.click(getInput());
  });

  it("caret is present only while focused and only at the box for value.length", async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled value="12" />);
    expect(container.querySelector(".w-px")).not.toBeInTheDocument();

    await user.click(getInput());
    const caret = container.querySelector(".w-px");
    expect(caret).toBeInTheDocument();

    const boxes = container.querySelectorAll('[aria-hidden="true"]');
    expect(boxes[2]?.contains(caret)).toBe(true);
  });
});
