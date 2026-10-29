// spec: docs/frontend/account-page.md#country-select-1715
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CountriesWrapper,
  settleCountryRetries,
  stubCountriesFetch,
} from "@/test-support/countries";
import { CountryField } from "./CountryField";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({
  initial = "",
  saved = "",
  onChange,
}: {
  initial?: string;
  saved?: string;
  onChange?: (next: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <label htmlFor="country">
      Country
      <CountryField
        id="country"
        value={value}
        savedValue={saved}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
    </label>
  );
}

function renderField(props: React.ComponentProps<typeof Harness> = {}) {
  return render(<Harness {...props} />, { wrapper: CountriesWrapper });
}

describe("CountryField", () => {
  it("is a disabled 'Loading countries…' combobox until the list arrives", async () => {
    stubCountriesFetch();
    renderField({ initial: "Peru" });
    const box = screen.getByRole("combobox");
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute("placeholder", "Loading countries…");
    expect(box).toHaveValue("");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toHaveValue("Peru");
  });

  it("shows the selected flag once ready", async () => {
    stubCountriesFetch();
    const { container } = renderField({ initial: "Peru" });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://flagcdn.com/pe.svg");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("filters by name and by code, and commits plain names only", async () => {
    stubCountriesFetch();
    const onChange = vi.fn();
    renderField({ onChange });
    const user = userEvent.setup();
    const box = screen.getByRole("combobox");
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, "per");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "Peru" })).toBeInTheDocument();
    await user.clear(box);
    await user.type(box, "nl");
    await user.click(screen.getByRole("option", { name: "Netherlands" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Netherlands");
    expect(JSON.stringify(onChange.mock.calls)).not.toMatch(
      /flagcdn|"NL"|"nl"/,
    );
  });

  it("offers the saved off-list value and keeps it after another pick", async () => {
    stubCountriesFetch();
    renderField({ initial: "NL", saved: "NL" });
    const user = userEvent.setup();
    const box = screen.getByRole("combobox");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toHaveValue("NL");
    await user.click(box);
    expect(
      screen.getByRole("option", { name: "NL (as saved)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "France" }));
    await user.click(box);
    expect(
      screen.getByRole("option", { name: "NL (as saved)" }),
    ).toBeInTheDocument();
  });

  it("falls back to a free-text field with a caption when the list fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubCountriesFetch({ fail: true });
    const onChange = vi.fn();
    renderField({ initial: "NL", onChange });
    await settleCountryRetries();
    const field = screen.getByRole("textbox");
    expect(field).toHaveValue("NL");
    expect(
      screen.getByText(
        "Couldn't load the country list. Type your country instead.",
      ),
    ).toBeInTheDocument();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(field, "x");
    expect(onChange).toHaveBeenCalledWith("NLx");
  });
});
