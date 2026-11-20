// spec: docs/frontend/trustee-flows.md#shared-detail-primitives
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SettlementBankAccountDetails } from "@/api/useLp";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

import { BankAccountRows } from "./BankAccountRows";

const IBAN = "CH9300762011623852957";
const DETAILS: SettlementBankAccountDetails = {
  account_holder_name: "Acme Capital LP",
  bank_name: "Example Bank AG",
  bank_address: null,
  iban: IBAN,
  account_number: "0012345678",
  swift_bic_code: null,
  routing_number: null,
};
const writeText = vi.fn();

function withClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  showToast.mockReset();
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  withClipboard({ writeText });
});

afterEach(() => {
  withClipboard(undefined);
});

describe("BankAccountRows", () => {
  it("renders seven rows with a dash for null values", () => {
    render(<BankAccountRows details={DETAILS} testIdPrefix="bank" />);
    expect(screen.getByTestId("bank-account_holder_name")).toHaveTextContent(
      "Acme Capital LP",
    );
    expect(screen.getByTestId("bank-iban")).toHaveTextContent(IBAN);
    expect(screen.getByTestId("bank-bank_address")).toHaveTextContent("—");
    expect(screen.getByTestId("bank-swift_bic_code")).toHaveTextContent("—");
    expect(screen.getByTestId("bank-routing_number")).toHaveTextContent("—");
    expect(screen.getAllByTestId(/^bank-[a-z_]+$/)).toHaveLength(7);
  });

  it("offers a copy button only for non-null identifiers", () => {
    render(<BankAccountRows details={DETAILS} testIdPrefix="bank" />);
    expect(screen.getByTestId("bank-iban-copy")).toHaveAttribute(
      "aria-label",
      "Copy IBAN",
    );
    expect(screen.getByTestId("bank-account_number-copy")).toBeInTheDocument();
    expect(screen.queryByTestId("bank-swift_bic_code-copy")).toBeNull();
    expect(screen.queryByTestId("bank-routing_number-copy")).toBeNull();
    expect(screen.queryByTestId("bank-bank_name-copy")).toBeNull();
  });

  it("copies the exact value and toasts the label only", async () => {
    render(<BankAccountRows details={DETAILS} testIdPrefix="bank" />);
    fireEvent.click(screen.getByTestId("bank-iban-copy"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("IBAN copied"));
    expect(writeText).toHaveBeenCalledWith(IBAN);
    expect(showToast.mock.calls.flat().join(" ")).not.toContain(IBAN);
  });

  it("raises no toast when the clipboard rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<BankAccountRows details={DETAILS} testIdPrefix="bank" />);
    fireEvent.click(screen.getByTestId("bank-iban-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    await Promise.resolve();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("keeps values out of every attribute", () => {
    const { container } = render(
      <BankAccountRows details={DETAILS} testIdPrefix="bank" />,
    );
    for (const element of container.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toContain(IBAN);
        expect(attribute.value).not.toContain("0012345678");
      }
    }
  });
});
