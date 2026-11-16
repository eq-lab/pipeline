// spec: docs/frontend/account-page.md#settlement-bank-account-1885
import { describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { SettlementBankAccountSummary } from "@/api";
import { SettlementBankAccountSection } from "./SettlementBankAccountSection";
import { useSettlementBankAccountDraft } from "./useSettlementBankAccountDraft";
import { ApiError } from "@/api";

const ACCOUNT: SettlementBankAccountSummary = {
  account_holder_name: "Holder",
  bank_name: "Bank",
  account_last4: "5432",
};

function Harness({
  account,
  kybStatus = "NotStarted",
  writable = true,
  expose,
}: {
  account: SettlementBankAccountSummary | null;
  kybStatus?: string;
  writable?: boolean;
  expose?: (controls: ReturnType<typeof useSettlementBankAccountDraft>) => void;
}) {
  const controls = useSettlementBankAccountDraft();
  expose?.(controls);
  return (
    <SettlementBankAccountSection
      account={account}
      kybStatus={kybStatus}
      writable={writable}
      disabled={false}
      controls={controls}
    />
  );
}

describe("SettlementBankAccountSection", () => {
  it("offers Add with the optional caption when no account is stored", () => {
    render(<Harness account={null} />);
    expect(screen.getByText("Not added")).toBeInTheDocument();
    expect(screen.getByTestId("settlement-bank-caption")).toHaveTextContent(
      "Optional. Needed only to withdraw to a bank account by wire.",
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("shows the masked account and Replace", () => {
    render(<Harness account={ACCOUNT} />);
    expect(screen.getByText("Holder")).toBeInTheDocument();
    expect(screen.getByTestId("settlement-bank-detail")).toHaveTextContent(
      "Bank · ending 5432",
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.queryByTestId("settlement-bank-caption")).toBeNull();
  });

  it("shows only the bank name when last4 is null", () => {
    render(<Harness account={{ ...ACCOUNT, account_last4: null }} />);
    expect(screen.getByTestId("settlement-bank-detail")).toHaveTextContent(
      /^Bank$/,
    );
  });

  it("opens seven empty inputs on Replace, keeps the masked row, and Cancel clears them", () => {
    render(<Harness account={ACCOUNT} />);
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(7);
    screen
      .getAllByRole("textbox")
      .forEach((input) => expect(input).toHaveValue(""));
    expect(
      screen.getByText(
        "Replacing Bank · ending 5432. Enter the full account again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("settlement-bank-detail")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "IBAN" }), {
      target: { value: "GB82" },
    });
    fireEvent.click(screen.getByTestId("settlement-bank-cancel"));
    expect(screen.queryByTestId("settlement-bank-form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByRole("textbox", { name: "IBAN" })).toHaveValue("");
  });

  it.each([
    ["UnderReview", ACCOUNT, "Locked while your account is under review."],
    ["Passed", null, "To add a bank account, contact support."],
    ["Passed", ACCOUNT, "To change it, contact support."],
  ])("is read-only at %s", (kybStatus, account, text) => {
    render(
      <Harness account={account} kybStatus={kybStatus} writable={false} />,
    );
    expect(screen.getByTestId("settlement-bank-caption")).toHaveTextContent(
      text,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows no caption at Failed", () => {
    render(<Harness account={ACCOUNT} kybStatus="Failed" writable={false} />);
    expect(screen.queryByTestId("settlement-bank-caption")).toBeNull();
  });

  it("hides the form when the record freezes while it is open", () => {
    const { rerender } = render(<Harness account={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByTestId("settlement-bank-form")).toBeInTheDocument();
    rerender(
      <Harness account={null} kybStatus="UnderReview" writable={false} />,
    );
    expect(screen.queryByTestId("settlement-bank-form")).toBeNull();
  });

  it("renders a field error on the right input and clears it when typing", () => {
    let controls!: ReturnType<typeof useSettlementBankAccountDraft>;
    render(<Harness account={null} expose={(next) => (controls = next)} />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    act(() => {
      controls.applyError(
        new ApiError(400, "settlement_bank_account.iban: is not a valid IBAN"),
      );
    });
    const iban = screen.getByRole("textbox", { name: "IBAN" });
    expect(iban).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a valid IBAN.")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Bank name" }),
    ).not.toHaveAttribute("aria-invalid");
    fireEvent.change(iban, { target: { value: "G" } });
    expect(screen.queryByText("Enter a valid IBAN.")).toBeNull();
  });
});

describe("useSettlementBankAccountDraft", () => {
  it("clears the paired error and omits the payload while blank", () => {
    const { result } = renderHook(() => useSettlementBankAccountDraft());
    act(() => result.current.openForm());
    expect(result.current.payload()).toBeUndefined();
    act(() => {
      result.current.applyError(
        new ApiError(
          400,
          "settlement_bank_account.account_number: or iban is required",
        ),
      );
    });
    expect(result.current.errors.account_number).toBeDefined();
    act(() => result.current.setField("iban", "GB82"));
    expect(result.current.errors.account_number).toBeUndefined();
    expect(result.current.dirty).toBe(true);
    expect(result.current.payload()?.iban).toBe("GB82");
    expect(result.current.applyError(new Error("x"))).toBe(false);
  });
});
