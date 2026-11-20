import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiError } from "@/api/client";

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: Record<string, string>;
    children: React.ReactNode;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a>
  ),
}));

const mutateAsync = vi.fn();
const reset = vi.fn();
const hookState = { isPending: false, error: null as Error | null };
vi.mock("@/api/useLps", () => ({
  useFindLpByPaymentDetails: () => ({
    mutateAsync,
    reset,
    isPending: hookState.isPending,
    error: hookState.error,
  }),
}));

import { PaymentReferenceLookup } from "./-PaymentReferenceLookup";

function type(value: string) {
  fireEvent.change(screen.getByLabelText("LP payment reference"), {
    target: { value },
  });
}

async function submit() {
  fireEvent.click(screen.getByTestId("lp-lookup-submit"));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
}

beforeEach(() => {
  mutateAsync.mockReset();
  reset.mockReset();
  mockNavigate.mockReset();
  hookState.isPending = false;
  hookState.error = null;
});

describe("PaymentReferenceLookup", () => {
  it("disables Find LP and sends nothing while blank", () => {
    render(<PaymentReferenceLookup />);
    const button = screen.getByTestId("lp-lookup-submit");
    expect(button).toBeDisabled();
    type("   ");
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("navigates to the LP with the trimmed reference when found", async () => {
    mutateAsync.mockResolvedValue({ lps: [{ id: 7 }] });
    render(<PaymentReferenceLookup />);
    type("  pl-7k3m q9tx ");
    await submit();
    expect(mutateAsync).toHaveBeenCalledWith("pl-7k3m q9tx");
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/lp-counterparties/$id",
        params: { id: "7" },
        search: { paymentDetails: "pl-7k3m q9tx" },
      }),
    );
  });

  it("shows the not-found notice with the Escrowed wires link", async () => {
    mutateAsync.mockResolvedValue({ lps: [] });
    render(<PaymentReferenceLookup />);
    type("PL-AAAA-BBBB-CCCC");
    await submit();
    const notice = await screen.findByTestId("lp-lookup-not-found");
    expect(notice).toHaveTextContent("No LP was issued this reference.");
    expect(
      screen.getByRole("link", { name: "Escrowed wires" }),
    ).toHaveAttribute("href", "/cash-management?tab=escrow");
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the invalid-reference error with the served details on 400", async () => {
    const error = new ApiError("`payment_details` is malformed", 400);
    mutateAsync.mockRejectedValue(error);
    hookState.error = error;
    render(<PaymentReferenceLookup />);
    type("zzz");
    await submit();
    const alert = (await screen.findAllByRole("alert"))[0]!;
    expect(alert).toHaveTextContent(
      "This is not a valid LP payment reference.",
    );
    fireEvent.click(screen.getByRole("button", { name: /details/i }));
    expect(alert).toHaveTextContent("`payment_details` is malformed");
  });

  it("does not submit again while a lookup is in flight", () => {
    hookState.isPending = true;
    render(<PaymentReferenceLookup />);
    type("PL-AAAA");
    const button = screen.getByTestId("lp-lookup-submit");
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
