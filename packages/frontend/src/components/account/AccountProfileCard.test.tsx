// spec: docs/frontend/account-page.md#country-select-1715
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountriesWrapper, stubCountriesFetch } from "@/test-support/countries";
import { AccountProfileCard } from "./AccountProfileCard";

afterEach(() => vi.unstubAllGlobals());

function renderCard(
  props: Partial<React.ComponentProps<typeof AccountProfileCard>> = {},
) {
  stubCountriesFetch();
  return render(
    <AccountProfileCard
      legalName="Acme"
      country="NL"
      savedCountry="NL"
      onLegalNameChange={vi.fn()}
      onCountryChange={vi.fn()}
      onSave={vi.fn()}
      canSave
      disabled={false}
      busy={false}
      {...props}
    />,
    { wrapper: CountriesWrapper },
  );
}

describe("AccountProfileCard country", () => {
  it("renders the country combobox and threads savedCountry as an 'as saved' option", async () => {
    renderCard();
    const box = screen.getByRole("combobox", { name: "Country" });
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toHaveValue("NL");
    await userEvent.click(box);
    expect(
      screen.getByRole("option", { name: "NL (as saved)" }),
    ).toBeInTheDocument();
  });

  it("calls onCountryChange with the plain name", async () => {
    const onCountryChange = vi.fn();
    renderCard({ onCountryChange });
    const box = screen.getByRole("combobox", { name: "Country" });
    await waitFor(() => expect(box).toBeEnabled());
    await userEvent.click(box);
    await userEvent.click(screen.getByRole("option", { name: "Peru" }));
    expect(onCountryChange).toHaveBeenCalledWith("Peru");
  });

  it("disables the field when the card is disabled", async () => {
    renderCard({ disabled: true });
    const box = screen.getByRole("combobox", { name: "Country" });
    await waitFor(() =>
      expect(box).toHaveAttribute("placeholder", "Search country"),
    );
    expect(box).toBeDisabled();
  });
});
