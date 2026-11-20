// spec: docs/frontend/account-page.md#country-select-1715
import { truncateAddress } from "@/utils/truncateAddress";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountriesWrapper, stubCountriesFetch } from "@/test-support/countries";
import {
  AccountProfileCard,
  type AccountProfileBank,
} from "./AccountProfileCard";
import { useSettlementBankAccountDraft } from "./useSettlementBankAccountDraft";
import type { SettlementRowView } from "./settlementAddress";

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
      writable
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

describe("AccountProfileCard save button", () => {
  it("renders no Save profile button when the LP is not writable", () => {
    renderCard({ writable: false, disabled: true });
    expect(
      screen.queryByRole("button", { name: /save profile/i }),
    ).not.toBeInTheDocument();
  });

  it("renders Save profile when writable, gated by canSave", () => {
    const { rerender } = renderCard({ canSave: false });
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    rerender(
      <AccountProfileCard
        legalName="Acme"
        country="NL"
        savedCountry="NL"
        onLegalNameChange={vi.fn()}
        onCountryChange={vi.fn()}
        onSave={vi.fn()}
        canSave
        writable
        disabled={false}
        busy={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Save profile" })).toBeEnabled();
  });
});

function view(overrides: Partial<SettlementRowView> = {}): SettlementRowView {
  return {
    kind: "stellar",
    label: "Stellar settlement address",
    address: "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK",
    caption: null,
    tone: "muted",
    action: null,
    confirm: null,
    busy: false,
    signer: null,
    other: false,
    form: null,
    ...overrides,
  };
}

function controls(rows: SettlementRowView[]) {
  return {
    rows,
    onLink: vi.fn(),
    onChange: vi.fn(),
    onCancel: vi.fn(),
    onOther: vi.fn(),
    onLinkOther: vi.fn(),
  };
}

describe("AccountProfileCard settlement rows", () => {
  const ADDRESS = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";

  it("renders one row per view with its label, full address and caption", async () => {
    renderCard({
      settlement: controls([
        view({ caption: "Linked to your connected wallet." }),
        view({
          kind: "evm",
          label: "Ethereum settlement address",
          address: null,
        }),
      ]),
    });
    const rows = await screen.findAllByTestId("settlement-address-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Stellar settlement address");
    expect(rows[0]).toHaveTextContent(truncateAddress(ADDRESS));
    expect(rows[0]).not.toHaveTextContent(ADDRESS);
    expect(rows[0]!.querySelector("[title]")).toHaveAttribute("title", ADDRESS);
    expect(rows[0]).toHaveTextContent("Linked to your connected wallet.");
    expect(rows[1]).toHaveTextContent("Ethereum settlement address");
    expect(rows[1]).toHaveTextContent("—");
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks a negative caption as an alert", async () => {
    renderCard({
      settlement: controls([
        view({ address: null, caption: "Taken.", tone: "negative" }),
      ]),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Taken.");
  });

  it.each([
    ["link", "Link wallet", "onLink"],
    ["retry", "Try again", "onLink"],
    ["change", "Change wallet", "onChange"],
  ] as const)("%s calls %s with the kind", async (action, name, handler) => {
    const settlement = controls([view({ kind: "evm", action })]);
    renderCard({ settlement });
    fireEvent.click(await screen.findByRole("button", { name }));
    expect(settlement[handler]).toHaveBeenCalledWith("evm");
  });

  it("shows From and To in the confirmation and wires Confirm change and Cancel", async () => {
    const settlement = controls([
      view({ confirm: { from: ADDRESS, to: "GNEWADDRESS" } }),
    ]);
    renderCard({ settlement });
    const confirm = await screen.findByTestId("settlement-change-confirm");
    expect(confirm).toHaveTextContent(`From ${ADDRESS}`);
    expect(confirm).toHaveTextContent("To GNEWADDRESS");
    fireEvent.click(screen.getByRole("button", { name: "Confirm change" }));
    expect(settlement.onLink).toHaveBeenCalledWith("stellar");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(settlement.onCancel).toHaveBeenCalledOnce();
    expect(settlement.onChange).not.toHaveBeenCalled();
  });

  it("shows no button on a busy row", async () => {
    renderCard({
      settlement: controls([view({ busy: true, caption: "Linking…" })]),
    });
    const row = await screen.findByTestId("settlement-address-row");
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("offers Use a different address and calls onOther with the kind", async () => {
    const settlement = controls([view({ other: true })]);
    renderCard({ settlement });
    fireEvent.click(
      await screen.findByRole("button", { name: "Use a different address" }),
    );
    expect(settlement.onOther).toHaveBeenCalledWith("stellar");
  });

  it("renders no row without a settlement view", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Country" });
    expect(screen.queryByTestId("settlement-address-row")).toBeNull();
  });
});

describe("AccountProfileCard settlement bank account", () => {
  function bank(
    overrides: Partial<NonNullable<AccountProfileBank>> = {},
  ): AccountProfileBank {
    return {
      account: null,
      kybStatus: "NotStarted",
      controls: {} as AccountProfileBank["controls"],
      ...overrides,
    };
  }

  function Wrapper({
    writable,
    kybStatus,
  }: {
    writable: boolean;
    kybStatus: string;
  }) {
    const controls = useSettlementBankAccountDraft();
    return (
      <AccountProfileCard
        legalName="Acme"
        country="NL"
        savedCountry="NL"
        onLegalNameChange={vi.fn()}
        onCountryChange={vi.fn()}
        onSave={vi.fn()}
        canSave
        writable={writable}
        disabled={!writable}
        busy={false}
        bank={bank({ kybStatus, controls })}
      />
    );
  }

  it("renders the section before Save profile", async () => {
    stubCountriesFetch();
    render(<Wrapper writable kybStatus="NotStarted" />, {
      wrapper: CountriesWrapper,
    });
    const row = screen.getByTestId("settlement-bank-row");
    const save = screen.getByRole("button", { name: "Save profile" });
    expect(
      row.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is read-only when the LP is not writable", () => {
    stubCountriesFetch();
    render(<Wrapper writable={false} kybStatus="UnderReview" />, {
      wrapper: CountriesWrapper,
    });
    expect(screen.getByTestId("settlement-bank-row")).toBeInTheDocument();
    expect(screen.queryByTestId("settlement-bank-open")).toBeNull();
  });

  it("renders nothing without the bank prop", () => {
    renderCard();
    expect(screen.queryByTestId("settlement-bank-row")).toBeNull();
  });
});
