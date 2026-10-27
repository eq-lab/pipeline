// spec: docs/frontend/ui-components.md#combobox
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, filterOptions, type ComboboxOption } from "@pipeline/ui";

const flag = (c: string) => `https://flagcdn.com/${c}.svg`;
const OPTIONS: ComboboxOption[] = [
  { value: "Finland", label: "Finland", iconUrl: flag("fi"), keywords: ["FI"] },
  { value: "France", label: "France", iconUrl: flag("fr"), keywords: ["FR"] },
  { value: "Iceland", label: "Iceland", iconUrl: flag("is"), keywords: ["IS"] },
  {
    value: "Netherlands",
    label: "Netherlands",
    iconUrl: flag("nl"),
    keywords: ["NL"],
  },
  { value: "Peru", label: "Peru", iconUrl: flag("pe"), keywords: ["PE"] },
  {
    value: "Spain",
    label: "Spain",
    iconUrl: flag("es"),
    keywords: ["ES"],
  },
  {
    value: "United Arab Emirates",
    label: "United Arab Emirates",
    iconUrl: flag("ae"),
    keywords: ["AE"],
  },
  {
    value: "United States",
    label: "United States",
    iconUrl: flag("us"),
    keywords: ["US"],
  },
];

function Controlled({
  onChange,
  value: initial = "",
  ...rest
}: Partial<React.ComponentProps<typeof Combobox>> & {
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <div>
      <label htmlFor="c">Country</label>
      <Combobox
        id="c"
        options={OPTIONS}
        emptyText="No countries found"
        clearLabel="Clear country"
        {...rest}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button">after</button>
    </div>
  );
}

const box = () => screen.getByRole("combobox", { name: "Country" });

describe("filterOptions", () => {
  it("matches case-insensitive substrings of the label", () => {
    expect(filterOptions(OPTIONS, "per").map((o) => o.value)).toEqual(["Peru"]);
    expect(filterOptions(OPTIONS, "PER").map((o) => o.value)).toEqual(["Peru"]);
    expect(filterOptions(OPTIONS, "land").map((o) => o.value)).toEqual([
      "Finland",
      "Iceland",
      "Netherlands",
    ]);
  });

  it("matches the keyword exactly in addition to the label", () => {
    expect(filterOptions(OPTIONS, "pe").map((o) => o.value)).toContain("Peru");
    expect(filterOptions(OPTIONS, "ae").map((o) => o.value)).toContain(
      "United Arab Emirates",
    );
  });

  it("returns everything, in order, for an empty or blank query", () => {
    expect(filterOptions(OPTIONS, "")).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, "   ")).toEqual(OPTIONS);
  });
});

describe("Combobox", () => {
  it("is a closed combobox named by its label, opening a listbox with flags on click", async () => {
    const { container } = render(<Controlled />);
    expect(box()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.click(box());
    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(box()).toHaveAttribute(
      "aria-controls",
      screen.getByRole("listbox").id,
    );
    expect(screen.getAllByRole("option")).toHaveLength(OPTIONS.length);
    const img = container.querySelector("li img");
    expect(img).toHaveAttribute("alt", "");
  });

  it("filters while typing without calling onChange, and shows a disabled empty row", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(box(), "neth");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Netherlands");
    await user.clear(box());
    await user.type(box(), "zzz");
    const empty = screen.getByRole("option", { name: "No countries found" });
    expect(empty).toHaveAttribute("aria-disabled", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens with ArrowDown, moves the active option, and commits with Enter", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "after" }));
    await user.tab({ shift: true });
    expect(box()).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(box()).toHaveAttribute("aria-expanded", "true");
    const options = screen.getAllByRole("option");
    expect(box()).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{ArrowDown}");
    expect(box()).toHaveAttribute("aria-activedescendant", options[1]!.id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(box()).toHaveAttribute("aria-activedescendant", options[0]!.id);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("France");
    expect(box()).toHaveAttribute("aria-expanded", "false");
    expect(box()).toHaveValue("France");
  });

  it("selects the second 'United …' match after typing, ArrowDown and Enter", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const user = userEvent.setup();
    await user.type(box(), "united");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("United States");
  });

  it("restores the selected label on Escape without calling onChange", async () => {
    const onChange = vi.fn();
    render(<Controlled value="Peru" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(box());
    await user.keyboard("fra");
    expect(box()).toHaveValue("fra");
    await user.keyboard("{Escape}");
    expect(box()).toHaveValue("Peru");
    expect(box()).toHaveAttribute("aria-expanded", "false");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("never commits free text on blur", async () => {
    const onChange = vi.fn();
    render(<Controlled value="Peru" onChange={onChange} />);
    const user = userEvent.setup();
    await user.clear(box());
    await user.type(box(), "Atlantis");
    await user.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(box()).toHaveValue("Peru");
  });

  it("commits a clicked option and keeps focus on the input", async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(box());
    await user.click(screen.getByRole("option", { name: "Spain" }));
    expect(onChange).toHaveBeenCalledWith("Spain");
    expect(box()).toHaveFocus();
    expect(box()).toHaveValue("Spain");
  });

  it("shows the selected flag and label when closed", () => {
    const { container } = render(<Controlled value="Peru" />);
    expect(box()).toHaveValue("Peru");
    expect(container.querySelector("img")).toHaveAttribute("src", flag("pe"));
  });

  it("shows the raw value of an off-list selection with no flag", () => {
    const { container } = render(
      <Controlled
        value="NL"
        options={[
          ...OPTIONS,
          { value: "NL", label: "NL (as saved)", selectedLabel: "NL" },
        ]}
      />,
    );
    expect(box()).toHaveValue("NL");
    expect(container.querySelector("img")).toBeNull();
  });

  it("clears through the clear button, which is absent when empty or disabled", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Controlled value="Peru" onChange={onChange} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Clear country" }),
    );
    expect(onChange).toHaveBeenCalledWith("");
    expect(box()).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Clear country" }),
    ).not.toBeInTheDocument();
    rerender(<Controlled value="Peru" disabled />);
    expect(
      screen.queryByRole("button", { name: "Clear country" }),
    ).not.toBeInTheDocument();
  });

  it("closes on a pointerdown outside", async () => {
    render(<Controlled />);
    const user = userEvent.setup();
    await user.click(box());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.click(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("does not open when disabled", async () => {
    render(<Controlled disabled />);
    expect(box()).toBeDisabled();
    await userEvent.click(box());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("wires invalid and error to aria attributes", () => {
    render(<Controlled invalid error="Pick one" />);
    expect(box()).toHaveAttribute("aria-invalid", "true");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Pick one");
    expect(box()).toHaveAttribute("aria-describedby", alert.id);
  });

  it("puts className on the outer wrapper and a focus-within border on the row", () => {
    const { container } = render(<Controlled className="custom" />);
    const outer = container.querySelector(".custom") as HTMLElement;
    expect(outer).toBeInTheDocument();
    expect(outer.firstElementChild?.className).toContain("focus-within:border");
    expect(outer.contains(box())).toBe(true);
  });
});
