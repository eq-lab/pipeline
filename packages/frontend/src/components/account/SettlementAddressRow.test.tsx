// spec: docs/frontend/account-page.md#settlement-address
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { truncateAddress } from "@/utils/truncateAddress";
import { SettlementAddressRow } from "./SettlementAddressRow";
import type { SettlementRowView } from "./settlementAddress";

const SERVED = "GA2OA4PKOQKVIOUZFNHMKBMQCCUZRMGRTFZ7LKOZHCCPCBXHN5RNH7YK";
const SIGNER = "GBBM6BKZPEHWYO3E3YKREDPQXMS4VK35YLNU7NFBRI26RAN7GI5POFBB";
const VALID_G = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H";

vi.mock("@/wallet", async () => ({
  isStellarSettlementAddress: (
    await vi.importActual<
      typeof import("@/wallet/stellar/settlementAddressFormat")
    >("@/wallet/stellar/settlementAddressFormat")
  ).isStellarSettlementAddress,
}));

function view(overrides: Partial<SettlementRowView> = {}): SettlementRowView {
  return {
    kind: "stellar",
    label: "Stellar settlement address",
    address: null,
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

function renderRow(overrides: Partial<SettlementRowView> = {}) {
  const handlers = {
    onLink: vi.fn(),
    onChange: vi.fn(),
    onCancel: vi.fn(),
    onOther: vi.fn(),
    onLinkOther: vi.fn(),
  };
  render(<SettlementAddressRow {...view(overrides)} {...handlers} />);
  return handlers;
}

const form = (overrides = {}) => ({
  current: null,
  signer: SIGNER,
  busy: false,
  ...overrides,
});

const input = () =>
  screen.getByRole("textbox", { name: "New settlement address" });

describe("SettlementAddressRow: different address", () => {
  it("renders the entry link and calls onOther with the kind", () => {
    const handlers = renderRow({ other: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Use a different address" }),
    );
    expect(handlers.onOther).toHaveBeenCalledWith("stellar");
  });

  it("renders no entry link when the row is not eligible", () => {
    renderRow({ other: false });
    expect(screen.queryByTestId("settlement-other-entry")).toBeNull();
  });

  it("shows the Current line only when an address is served", () => {
    renderRow({ address: SERVED, form: form({ current: SERVED }) });
    expect(screen.getByTestId("settlement-other-form")).toHaveTextContent(
      `Current ${SERVED}`,
    );
  });

  it("omits the Current line without a served address", () => {
    renderRow({ form: form() });
    expect(screen.getByTestId("settlement-other-form")).not.toHaveTextContent(
      "Current",
    );
  });

  it("shows the connected signer truncated with the full value in title", () => {
    renderRow({ form: form() });
    const signer = screen.getByTestId("settlement-other-signer");
    expect(signer).toHaveTextContent(`Signer ${truncateAddress(SIGNER)}`);
    expect(signer).toHaveAttribute("title", SIGNER);
  });

  it("focuses the input on open", () => {
    renderRow({ form: form() });
    expect(input()).toHaveFocus();
  });

  it("disables Link address while the input is empty", () => {
    renderRow({ form: form() });
    expect(screen.getByRole("button", { name: "Link address" })).toBeDisabled();
    fireEvent.change(input(), { target: { value: "  " } });
    expect(screen.getByRole("button", { name: "Link address" })).toBeDisabled();
  });

  it("shows the Stellar format message on blur and clears it on edit", () => {
    renderRow({ form: form() });
    fireEvent.change(input(), { target: { value: "GABC" } });
    expect(input()).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(input());
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Enter a Stellar address: G… or C…, 56 characters."),
    ).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: "GABCD" } });
    expect(input()).not.toHaveAttribute("aria-invalid");
  });

  it("shows the Ethereum format message on blur for an EVM row", () => {
    renderRow({ kind: "evm", form: form() });
    fireEvent.change(input(), { target: { value: "0x12" } });
    fireEvent.blur(input());
    expect(
      screen.getByText(
        "Enter an Ethereum address: 0x followed by 40 hexadecimal characters.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the format message on submit and sends nothing for invalid input", () => {
    const handlers = renderRow({ form: form() });
    fireEvent.change(input(), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Link address" }));
    expect(
      screen.getByText("Enter a Stellar address: G… or C…, 56 characters."),
    ).toBeInTheDocument();
    expect(handlers.onLinkOther).not.toHaveBeenCalled();
  });

  it("submits the draft on click and on Enter", () => {
    const handlers = renderRow({ form: form() });
    fireEvent.change(input(), { target: { value: VALID_G } });
    fireEvent.click(screen.getByRole("button", { name: "Link address" }));
    expect(handlers.onLinkOther).toHaveBeenCalledWith("stellar", VALID_G);
    fireEvent.submit(screen.getByTestId("settlement-other-form"));
    expect(handlers.onLinkOther).toHaveBeenCalledTimes(2);
  });

  it("calls onCancel from Cancel", () => {
    const handlers = renderRow({ form: form() });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancel).toHaveBeenCalledOnce();
  });

  it("disables the input and hides the buttons while busy", () => {
    renderRow({
      busy: true,
      caption: "Linking this address…",
      form: form({ busy: true }),
    });
    expect(input()).toBeDisabled();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("settlement-address-row")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByText("Linking this address…")).toBeInTheDocument();
  });

  it("marks a negative caption inside the form as an alert", () => {
    renderRow({
      form: form(),
      caption: "This address could not be linked. Try again.",
      tone: "negative",
    });
    expect(
      within(screen.getByTestId("settlement-other-form")).getByRole("alert"),
    ).toHaveTextContent("This address could not be linked. Try again.");
  });

  it("keeps the draft across a busy phase", () => {
    const handlers = {
      onLink: vi.fn(),
      onChange: vi.fn(),
      onCancel: vi.fn(),
      onOther: vi.fn(),
      onLinkOther: vi.fn(),
    };
    const { rerender } = render(
      <SettlementAddressRow {...view({ form: form() })} {...handlers} />,
    );
    fireEvent.change(input(), { target: { value: VALID_G } });
    rerender(
      <SettlementAddressRow
        {...view({ busy: true, form: form({ busy: true }) })}
        {...handlers}
      />,
    );
    expect(input()).toHaveValue(VALID_G);
  });

  it("gives each mounted form its own input id", () => {
    const handlers = {
      onLink: vi.fn(),
      onChange: vi.fn(),
      onCancel: vi.fn(),
      onOther: vi.fn(),
      onLinkOther: vi.fn(),
    };
    render(
      <>
        <SettlementAddressRow {...view({ form: form() })} {...handlers} />
        <SettlementAddressRow {...view({ form: form() })} {...handlers} />
      </>,
    );
    const [a, b] = screen.getAllByRole("textbox");
    expect(a!.id).not.toBe(b!.id);
  });

  it("shows the Signer line on a linked row whose signer differs", () => {
    renderRow({ address: SERVED, signer: SIGNER });
    const line = screen.getByTestId("settlement-signer");
    expect(line).toHaveTextContent(`Signer ${truncateAddress(SIGNER)}`);
    expect(line).toHaveAttribute("title", SIGNER);
  });

  it("renders no Signer line without a distinct signer", () => {
    renderRow({ address: SERVED });
    expect(screen.queryByTestId("settlement-signer")).toBeNull();
  });
});
