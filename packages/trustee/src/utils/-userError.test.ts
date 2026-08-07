/**
 * Tests for `toUserError` / `toError` / `parseSorobanContractErrorCode` /
 * `mapWaterfallError` (#1037). `toError`'s cases mirror the LP's own port
 * (`packages/frontend/src/utils/userError.test.ts`, #1034) since this half
 * of the module is chain-generic, not trustee-specific (D1).
 *
 * The `mapWaterfallError` cases are migrated from the two byte-identical
 * copies previously in `-record-coupon.test.ts` / `-record-repayment.test.ts`
 * (D5, consolidation).
 */
import { describe, it, expect } from "vitest";
import { ApiError, ApiUnauthorizedError } from "@/api/client";
import {
  toError,
  toUserError,
  parseSorobanContractErrorCode,
  mapWaterfallError,
} from "./userError";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

describe("toError", () => {
  it("passes real Errors through unchanged", () => {
    const err = new Error("boom");
    expect(toError(err)).toBe(err);
  });

  it("extracts a string message from plain rejection objects", () => {
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
    expect(parseSorobanContractErrorCode("Error(Contract, #13)")).toBe(13);
  });

  it("returns null on no match", () => {
    expect(parseSorobanContractErrorCode("plain failure")).toBeNull();
  });

  it("first occurrence wins when the text contains multiple matches", () => {
    expect(
      parseSorobanContractErrorCode(
        "Error(Contract, #11) ... Error(Contract, #13)",
      ),
    ).toBe(11);
  });

  it("falls through to null for an unlisted code", () => {
    const result = toUserError(new Error("Error(Contract, #999) boom"));
    expect(result.isSpecific).toBe(false);
    expect(result.message).toBe(GENERIC_MESSAGE);
    expect(result.details).toBe("Error(Contract, #999) boom");
  });
});

describe("toUserError — wallet/user rejection", () => {
  it.each([
    "User rejected the request.",
    "user declined",
    "declined by user",
    "User cancelled",
    "User canceled",
    "request rejected",
    "ACTION_REJECTED",
  ])("maps %s to the cancelled-in-wallet copy", (raw) => {
    const result = toUserError(new Error(raw));
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe(raw);
  });

  it("maps the EIP-1193 4001 shape (via toError's JSON stringify)", () => {
    const result = toUserError({ code: 4001 });
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
  });

  it("wins even when wrapped inside a simulation string", () => {
    const raw = "drawLoan simulation error: user rejected the transaction";
    const result = toUserError(new Error(raw));
    expect(result.message).toBe(
      "You cancelled the transaction in your wallet.",
    );
    expect(result.details).toBe(raw);
  });
});

describe("toUserError — trustee preflight guards", () => {
  it.each([
    "On-chain minting is not configured for this environment.",
    "On-chain rollover is not configured for this environment.",
    "On-chain lifecycle updates are not configured for this environment.",
    "On-chain payment recording is not configured for this environment.",
    "On-chain loan closing is not configured for this environment.",
  ])("renders the hook's own %s sentence verbatim", (raw) => {
    const result = toUserError(new Error(raw));
    expect(result.message).toBe(raw);
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe(raw);
  });

  it("translates 'Stellar wallet not connected.' to the connect-wallet copy", () => {
    const result = toUserError(new Error("Stellar wallet not connected."));
    expect(result.message).toBe(
      "Connect your trustee wallet to approve on-chain.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe("Stellar wallet not connected.");
  });
});

describe("toUserError — simulation-error shape", () => {
  it.each([
    "drawLoan simulation error: HostError: Error(Contract, #999)",
    "rollover simulation error: some RPC failure",
    "updateMutable simulation error: some RPC failure",
    "recordPayment simulation error: some RPC failure",
    "closeLoan simulation error: some RPC failure",
  ])("maps %s to the generic could-not-verify copy", (raw) => {
    const result = toUserError(new Error(raw));
    expect(result.message).toBe(
      "Could not verify this action on-chain. No signature was requested — safe to retry.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe(raw);
  });
});

describe("toUserError — ApiError.status", () => {
  it("401 via ApiUnauthorizedError resolves through instanceof ApiError to the session-expired copy, not the generic", () => {
    const result = toUserError(new ApiUnauthorizedError("nope"));
    expect(result.message).toBe(
      "Your session has expired or is not authorized. Please sign in again.",
    );
    expect(result.isSpecific).toBe(true);
    expect(result.details).toBe("nope");
  });

  it("409 → already-reviewed copy", () => {
    const result = toUserError(new ApiError("conflict", 409));
    expect(result.message).toBe(
      "This submission has already been reviewed. Refresh to see the latest status.",
    );
  });

  it("403 → not-authorized copy", () => {
    const result = toUserError(new ApiError("forbidden", 403));
    expect(result.message).toBe(
      "You are not authorized to review submissions.",
    );
  });

  it("400 → curated 'invalid request' copy, never the raw backend text", () => {
    const result = toUserError(
      new ApiError("some raw backend validation text", 400),
    );
    expect(result.message).toBe("This request was invalid.");
    expect(result.details).toBe("some raw backend validation text");
  });

  it("404 → not-found copy", () => {
    const result = toUserError(new ApiError("missing", 404));
    expect(result.message).toBe(
      "That request could not be found. It may have already been processed.",
    );
  });

  it("500 → service-unavailable copy", () => {
    const result = toUserError(new ApiError("boom", 500));
    expect(result.message).toBe(
      "The service is temporarily unavailable. Please try again.",
    );
  });

  it("an unmapped status (e.g. 418) falls through to the fallback", () => {
    const result = toUserError(new ApiError("teapot", 418), "Custom fallback.");
    expect(result.message).toBe("Custom fallback.");
    expect(result.isSpecific).toBe(false);
  });
});

describe("toUserError — per-surface fallback override", () => {
  it("uses the caller-supplied fallback instead of the generic default", () => {
    const result = toUserError(
      new Error("unrecognized"),
      "Failed to load the loan book.",
    );
    expect(result.message).toBe("Failed to load the loan book.");
    expect(result.isSpecific).toBe(false);
  });

  it("defaults to the generic fallback when none is supplied", () => {
    const result = toUserError(new Error("unrecognized"));
    expect(result.message).toBe(GENERIC_MESSAGE);
  });
});

describe("toUserError — details invariant", () => {
  it("details is always the full untruncated normalized text, matched or not", () => {
    const raw = "x".repeat(500) + " Error(Contract, #999) " + "y".repeat(500);
    const result = toUserError(new Error(raw));
    expect(result.details).toBe(raw);
    expect(result.details.length).toBe(raw.length);
  });

  it("a non-Error thrown bare string still yields full details", () => {
    const result = toUserError("plain string failure");
    expect(result.details).toBe("plain string failure");
  });

  it("a non-Error thrown object with a code still yields full details", () => {
    const result = toUserError({ code: 4001 });
    expect(result.details).toBe('{"code":4001}');
  });

  it("an empty-string message still yields an empty details, not a fabricated one", () => {
    const result = toUserError(new Error(""));
    expect(result.details).toBe("");
    expect(result.isSpecific).toBe(false);
  });
});

describe("mapWaterfallError (consolidated, D5)", () => {
  it("maps a client error (4xx, e.g. 404) to the friendly 'amount too big' copy (#916), no details", () => {
    const result = mapWaterfallError(
      new ApiError("amount 999 exceeds 15", 404),
    );
    expect(result?.message).toBe(
      "This amount is too high for this loan. Enter a smaller amount.",
    );
    // Never the raw backend text, and no digits.
    expect(result?.message).not.toMatch(/\d/);
    // Expected-input case (D5) — no "View details" trigger.
    expect(result?.details).toBe("");
  });

  it("uses a generic friendly message for server/other errors — never the backend text — and keeps full details", () => {
    const serverResult = mapWaterfallError(new ApiError("boom 500", 500));
    expect(serverResult?.message).toBe(
      "Couldn't preview this payment. Please try again.",
    );
    expect(serverResult?.details).toBe("boom 500");

    const genericResult = mapWaterfallError(new Error("network 12"));
    expect(genericResult?.message).toBe(
      "Couldn't preview this payment. Please try again.",
    );
    expect(genericResult?.details).toBe("network 12");
  });

  it("returns null when there is no error", () => {
    expect(mapWaterfallError(null)).toBeNull();
  });
});
