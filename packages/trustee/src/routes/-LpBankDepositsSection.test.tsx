import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/api/client";
import type { LpBankDeposit } from "@/api/useLpBankDeposits";
import {
  formatDepositAmount,
  formatDepositTime,
  normalizeAmount,
  utcInputToIso,
} from "./-useLpBankDeposits";

vi.mock("@/api/useLpBankDeposits", () => ({
  useLpBankDeposits: vi.fn(),
  useRecordBankDeposit: vi.fn(),
}));
import {
  useLpBankDeposits,
  useRecordBankDeposit,
} from "@/api/useLpBankDeposits";
import { LpBankDepositsSection } from "./-LpBankDepositsSection";

const mockList = vi.mocked(useLpBankDeposits);
const mockRecord = vi.mocked(useRecordBankDeposit);
const mutateAsync = vi.fn();
const reset = vi.fn();

const DEPOSIT: LpBankDeposit = {
  id: 3,
  lp_id: 7,
  amount: "1250000.5",
  payment_reference: "WIRE-REF-1",
  ref_hash: "ab".repeat(32),
  occurred_at: "2026-10-05T15:41:00Z",
  is_minted: false,
  recorded_by: "GTRUSTEE",
  created_at: "2026-10-05T16:00:00Z",
};

function list(state: {
  data?: { deposits: LpBankDeposit[] };
  isPending?: boolean;
  error?: Error | null;
}) {
  mockList.mockReturnValue({
    data: state.data,
    isPending: state.isPending ?? false,
    isError: Boolean(state.error),
    isFetching: false,
    error: state.error ?? null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useLpBankDeposits>);
}

function recorder(error: Error | null = null, isPending = false) {
  mockRecord.mockReturnValue({
    mutateAsync,
    reset,
    error,
    isPending,
  } as unknown as ReturnType<typeof useRecordBankDeposit>);
}

function renderSection() {
  return render(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
}

beforeEach(() => {
  mockList.mockReset();
  mockRecord.mockReset();
  mutateAsync.mockReset();
  reset.mockReset();
  recorder();
});

describe("bank deposit helpers", () => {
  it("normalizes amounts", () => {
    expect(normalizeAmount("50,000.00")).toBe("50000.00");
    expect(normalizeAmount(" 12.5 ")).toBe("12.5");
    for (const bad of ["", "0", "0.00", "-1", "1.234", "abc", "1e3"])
      expect(normalizeAmount(bad)).toBeNull();
  });

  it("reads datetime-local as UTC", () => {
    expect(utcInputToIso("2026-10-05T15:41")).toBe("2026-10-05T15:41:00Z");
    expect(utcInputToIso("")).toBeNull();
  });

  it("formats amount and time exactly", () => {
    expect(formatDepositAmount("1250000.5")).toBe("$1,250,000.50");
    expect(formatDepositAmount("999999999999999999.99")).toBe(
      "$999,999,999,999,999,999.99",
    );
    expect(formatDepositTime("2026-10-05T15:41:00Z")).toBe(
      "05 Oct 2026, 15:41 UTC",
    );
  });
});

describe("LpBankDepositsSection — list", () => {
  it("shows loading, empty, and error states", () => {
    list({ isPending: true });
    const { rerender } = renderSection();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading bank deposits",
    );

    list({ data: { deposits: [] } });
    rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
    expect(screen.getByText("No bank deposits recorded.")).toBeInTheDocument();

    list({ error: new ApiError("forbidden", 403) });
    rerender(<LpBankDepositsSection lpId={7} legalName="Acme Ltd" />);
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent(
      "not authorized to record bank deposits",
    );
  });

  it("renders deposit rows", () => {
    list({ data: { deposits: [DEPOSIT] } });
    renderSection();
    const row = screen.getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("05 Oct 2026, 15:41 UTC");
    expect(row).toHaveTextContent("$1,250,000.50");
    expect(row).toHaveTextContent("WIRE-REF-1");
    expect(row).toHaveTextContent("Not minted");
    expect(row).toHaveTextContent("GTRUSTEE");
  });
});

describe("LpBankDepositsSection — record", () => {
  function openDialog() {
    list({ data: { deposits: [] } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Record deposit" }));
    return screen.getByRole("dialog", { name: "Record deposit — Acme Ltd" });
  }

  it("validates before submitting", () => {
    const dialog = openDialog();
    fireEvent.click(
      dialog.querySelector('button[type="submit"]') as HTMLButtonElement,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("submits normalized values and closes on success", async () => {
    mutateAsync.mockResolvedValueOnce(DEPOSIT);
    const dialog = openDialog();
    fireEvent.change(screen.getByLabelText("Amount (USD)"), {
      target: { value: "50,000.00" },
    });
    fireEvent.change(screen.getByLabelText("Payment reference"), {
      target: { value: "  WIRE-REF-2 " },
    });
    fireEvent.change(screen.getByLabelText("Received at (UTC)"), {
      target: { value: "2026-10-01T09:30" },
    });
    fireEvent.click(
      dialog.querySelector('button[type="submit"]') as HTMLButtonElement,
    );

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        lpId: 7,
        amount: "50000.00",
        payment_reference: "WIRE-REF-2",
        occurred_at: "2026-10-01T09:30:00Z",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a duplicate-reference error and stays open", async () => {
    recorder(new ApiError("dup", 409));
    const dialog = openDialog();
    expect(dialog).toHaveTextContent(
      "A deposit with this payment reference is already recorded.",
    );
  });
});
