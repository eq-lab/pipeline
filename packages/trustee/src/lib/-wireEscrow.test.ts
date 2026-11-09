import { describe, it, expect } from "vitest";
import { ApiError } from "@/api/client";
import { formatUsdExact } from "@/utils/formatUsd";
import {
  cashBookError,
  escrowAccessReason,
  onChainRowState,
  onChainStateLabel,
  wireEscrowErrorCopy,
} from "./wireEscrow";

describe("escrowAccessReason", () => {
  const base = { access: undefined, isPending: false, isError: false };

  it("is null for an immediate grant", () => {
    expect(
      escrowAccessReason("assign_wire_in", {
        ...base,
        access: { immediate: true, delay: 0 },
      }),
    ).toBeNull();
  });

  it("covers pending, error, delay and no role", () => {
    expect(
      escrowAccessReason("assign_wire_in", { ...base, isPending: true }),
    ).toBe("Checking this wallet's Trustee role…");
    expect(
      escrowAccessReason("assign_wire_in", { ...base, isError: true }),
    ).toBe("Could not verify this wallet's Trustee role.");
    expect(
      escrowAccessReason("assign_wire_in", {
        ...base,
        access: { immediate: false, delay: 3600 },
      }),
    ).toBe(
      "This wallet holds the Trustee role with a 1 h delay; the app does not schedule wire assignments.",
    );
    expect(
      escrowAccessReason("assign_wire_in", {
        ...base,
        access: { immediate: false, delay: 0 },
      }),
    ).toBe("Only the Trustee role can assign escrowed wires.");
    expect(
      escrowAccessReason("return_wire_in", {
        ...base,
        access: { immediate: false, delay: 0 },
      }),
    ).toBe("Only the Trustee role can return escrowed wires.");
  });
});

describe("onChainRowState", () => {
  const read = (status?: string, over = {}) => ({
    data: status ? ({ status } as never) : undefined,
    isPending: false,
    isError: false,
    ...over,
  });

  it("maps every branch", () => {
    expect(onChainRowState("Escrowed", read("Escrowed"))).toBe("confirmed");
    expect(onChainRowState("Escrowed", read("Assigned"))).toBe(
      "assigned-pending-index",
    );
    expect(onChainRowState("Escrowed", read("Returned"))).toBe(
      "returned-pending-index",
    );
    expect(onChainRowState("Escrowed", read("Direct"))).toBe("mismatch");
    expect(
      onChainRowState("Escrowed", read(undefined, { isPending: true })),
    ).toBe("reading");
    expect(
      onChainRowState("Escrowed", read(undefined, { isError: true })),
    ).toBe("read-error");
  });

  it("labels every state", () => {
    expect(onChainStateLabel("confirmed", "Escrowed")).toBe(
      "Escrowed (confirmed on-chain)",
    );
    expect(onChainStateLabel("assigned-pending-index", "Assigned")).toBe(
      "Assigned on-chain — waiting for the indexer",
    );
    expect(onChainStateLabel("returned-pending-index", "Returned")).toBe(
      "Returned on-chain — waiting for the indexer",
    );
    expect(onChainStateLabel("mismatch", "Direct")).toBe(
      "On-chain status Direct differs from the cash book",
    );
    expect(onChainStateLabel("read-error", undefined)).toBe(
      "Could not confirm on-chain",
    );
  });
});

describe("wireEscrowErrorCopy", () => {
  const sim = (code: number) =>
    new Error(`execute simulation error: Error(Contract, #${code})`);

  it("keeps the wallet rejection copy", () => {
    const e = wireEscrowErrorCopy("assign_wire_in", new Error("User rejected"));
    expect(e.message).toBe("You cancelled the transaction in your wallet.");
    expect(e.details).toBe("User rejected");
  });

  it("maps RefHashSeen text and #7 on return only", () => {
    const reused =
      "This bank reference is already recorded on-chain. Use the outgoing wire's own reference.";
    expect(wireEscrowErrorCopy("return_wire_in", sim(7)).message).toBe(reused);
    expect(
      wireEscrowErrorCopy("return_wire_in", new Error("RefHashSeen")).message,
    ).toBe(reused);
    expect(wireEscrowErrorCopy("assign_wire_in", sim(7)).message).not.toBe(
      reused,
    );
  });

  it("maps #15 on assign, #14 and #9", () => {
    expect(wireEscrowErrorCopy("assign_wire_in", sim(15)).message).toBe(
      "This lender's address is not authorised to hold PLUSD.",
    );
    expect(wireEscrowErrorCopy("return_wire_in", sim(15)).message).toBe(
      "Could not verify this action on-chain. No signature was requested — safe to retry.",
    );
    expect(wireEscrowErrorCopy("assign_wire_in", sim(14)).message).toBe(
      "This wire is no longer in escrow. Refresh the list.",
    );
    expect(wireEscrowErrorCopy("return_wire_in", sim(9)).message).toBe(
      "The minter has no wire with this id.",
    );
  });

  it("keeps the raw text in details and falls back per function", () => {
    expect(wireEscrowErrorCopy("assign_wire_in", sim(14)).details).toContain(
      "#14",
    );
    expect(
      wireEscrowErrorCopy("assign_wire_in", new Error("boom")).message,
    ).toBe("Could not assign this wire. Please try again.");
    expect(
      wireEscrowErrorCopy("return_wire_in", new Error("boom")).message,
    ).toBe("Could not return this wire. Please try again.");
  });
});

describe("cashBookError", () => {
  it("maps 404 minter_not_configured, 403 and 401", () => {
    expect(
      cashBookError(new ApiError("minter_not_configured", 404), "Stellar")
        .message,
    ).toBe("The cash book is not configured for Stellar on this server.");
    expect(
      cashBookError(new ApiError("forbidden", 403), "Stellar").message,
    ).toBe("Your trustee account is not authorized to view the cash book.");
    expect(cashBookError(new ApiError("expired", 401), "Stellar").message).toBe(
      "Your session expired. Sign in again.",
    );
  });
});

describe("formatUsdExact", () => {
  it("prints the served fraction verbatim", () => {
    expect(formatUsdExact("1234567.123456")).toBe("$1,234,567.123456");
    expect(formatUsdExact("0.000000")).toBe("$0.000000");
    expect(formatUsdExact("42")).toBe("$42");
  });
});
