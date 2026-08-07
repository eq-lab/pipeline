/**
 * Tests for `toUserError` / `toError` / `parseSorobanContractErrorCode`
 * (#1034). `toError`'s cases are migrated unchanged from
 * `wallet/stellar/useStellarWithdrawalQueue.test.tsx` (#1024) — see
 * `docs/frontend/wallet-flows.md#error-normalization`.
 */
import { describe, it, expect } from "vitest";
import {
  toError,
  toUserError,
  parseSorobanContractErrorCode,
} from "./userError";

// The real reported string from issue #1034, pasted verbatim (amounts >5M on
// `/deposit` trip DepositManager's contract error #3).
const SOROBAN_ERROR_3_FIXTURE =
  'DepositManager.request_deposit simulation error: HostError: Error(Contract, #3) Event log (newest first): 0: [Diagnostic Event] contract:CB3CW55RXOQ5VUY7GJF5SOKSPFVHW7DZO3DE4664TGLBK25MZYEAANHG, topics:[error, Error(Contract, #3)], data:"escalating error to VM trap from failed host function call: fail_with_error" …';

const GENERIC_MESSAGE = "The transaction could not be completed.";

describe("toError (#1024, migrated)", () => {
  it("passes real Errors through unchanged", () => {
    const err = new Error("boom");
    expect(toError(err)).toBe(err);
  });

  it("extracts a string message from plain rejection objects (no more [object Object])", () => {
    expect(toError({ message: "user declined access" }).message).toBe(
      "user declined access",
    );
  });

  it("falls back to JSON for message-less objects and to the string itself for strings", () => {
    expect(toError({ code: -4001 }).message).toBe('{"code":-4001}');
    expect(toError("plain failure").message).toBe("plain failure");
  });
});

describe("parseSorobanContractErrorCode", () => {
  it("matches Error(Contract, #N)", () => {
    expect(parseSorobanContractErrorCode("Error(Contract, #3)")).toBe(3);
    expect(parseSorobanContractErrorCode(SOROBAN_ERROR_3_FIXTURE)).toBe(3);
  });

  it("returns null on no match", () => {
    expect(parseSorobanContractErrorCode("plain failure")).toBeNull();
  });

  it("first occurrence wins when the text contains multiple matches", () => {
    expect(
      parseSorobanContractErrorCode(
        "Error(Contract, #11) ... later ... Error(Contract, #13)",
      ),
    ).toBe(11);
  });

  it("returns null on a malformed code (no digits)", () => {
    expect(parseSorobanContractErrorCode("Error(Contract, #)")).toBeNull();
  });
});

describe("toUserError — Soroban contract error mapping", () => {
  it("#3 (real reported fixture, verbatim) → the amount-limit copy, isSpecific true, details preserved byte-for-byte", () => {
    const result = toUserError(new Error(SOROBAN_ERROR_3_FIXTURE));
    expect(result.message).toBe("Amount exceeds the deposit limit.");
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe(SOROBAN_ERROR_3_FIXTURE);
    expect(result.details).toContain("Diagnostic Event");
  });

  it("#11 → balance-not-authorized copy", () => {
    const result = toUserError(new Error("Error(Contract, #11)"));
    expect(result.message).toBe(
      "Your PLUSD balance is not authorized yet. Try again shortly.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("#13 → missing-trustline copy", () => {
    const result = toUserError(new Error("Error(Contract, #13)"));
    expect(result.message).toBe(
      "A required trustline is missing. Enable the asset and try again.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("an unlisted contract error code falls through to the generic line but keeps details", () => {
    const result = toUserError(new Error("Error(Contract, #99)"));
    expect(result.message).toBe(GENERIC_MESSAGE);
    expect(result.isSpecific).toBe(false);
    expect(result.details).toBe("Error(Contract, #99)");
  });
});

describe("toUserError — wallet / user rejection (checked first)", () => {
  it.each([
    "User rejected the request",
    "User cancelled",
    "User canceled",
    "Declined by user",
    "Request rejected by user",
    "MetaMask Tx Signature: ACTION_REJECTED",
  ])("%s → the cancelled-in-wallet copy", (raw) => {
    const result = toUserError(new Error(raw));
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("EIP-1193 { code: 4001 } → the cancelled-in-wallet copy", () => {
    const result = toUserError({ code: 4001 });
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe('{"code":4001}');
  });

  it("EIP-1193 { code: -4001 } → the cancelled-in-wallet copy", () => {
    const result = toUserError({ code: -4001 });
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("a rejection wrapped inside a simulation string still wins over the Soroban mapping", () => {
    const wrapped =
      "DepositManager.request_deposit simulation error: User rejected the request Error(Contract, #3)";
    const result = toUserError(new Error(wrapped));
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe(wrapped);
  });
});

describe("toUserError — HTTP / API failure", () => {
  it("Not Found → the not-found copy", () => {
    const result = toUserError(new Error("Not Found"));
    expect(result.message).toBe(
      "That request could not be found. It may have already been processed.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("Forbidden / Unauthorized → the not-authorized copy", () => {
    expect(toUserError(new Error("Forbidden")).message).toBe(
      "You are not authorized for this action.",
    );
    expect(toUserError(new Error("Unauthorized")).message).toBe(
      "You are not authorized for this action.",
    );
  });

  it("Internal Server Error → the service-unavailable copy", () => {
    const result = toUserError(new Error("Internal Server Error"));
    expect(result.message).toBe(
      "The service is temporarily unavailable. Please try again.",
    );
    expect(result.isSpecific).toBe(true);
  });
});

describe("toUserError — EVM revert / network", () => {
  it("execution reverted → the contract-rejected copy", () => {
    const result = toUserError(new Error("execution reverted"));
    expect(result.message).toBe(
      "The transaction was rejected by the contract.",
    );
    expect(result.isSpecific).toBe(true);
  });

  it("insufficient funds → the insufficient-balance copy", () => {
    expect(toUserError(new Error("insufficient funds for gas")).message).toBe(
      "Insufficient balance for this transaction.",
    );
  });
});

describe("toUserError — generic fallback", () => {
  it("an unrecognised shape maps to the generic line, isSpecific false, details preserved", () => {
    const result = toUserError(new Error("something unexpected happened"));
    expect(result.message).toBe(GENERIC_MESSAGE);
    expect(result.isSpecific).toBe(false);
    expect(result.details).toBe("something unexpected happened");
  });

  it("a plain string throw is normalized and mapped the same way", () => {
    const result = toUserError("boom");
    expect(result.message).toBe(GENERIC_MESSAGE);
    expect(result.isSpecific).toBe(false);
    expect(result.details).toBe("boom");
  });
});

describe("toUserError — 'network' keyword maps to the EVM network-problem copy (not the generic line)", () => {
  it("a message containing 'network' → the network-problem copy, isSpecific true", () => {
    const result = toUserError(new Error("network failure"));
    expect(result.message).toBe("Network problem. Please try again.");
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe("network failure");
  });
});
