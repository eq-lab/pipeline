import { describe, expect, it } from "vitest";
import {
  isStellarAccountNotFoundError,
  normalizeStellarActionError,
} from "./errors";

const ADDRESS = "GAD7YKWKWLZSDKVL2D5FRGKI7IE3PBGN7XNCJQJJH7XCGYEAWXR5FISM";

describe("stellar error helpers", () => {
  it("detects RPC account-not-found errors", () => {
    expect(
      isStellarAccountNotFoundError(new Error(`Account not found: ${ADDRESS}`)),
    ).toBe(true);
  });

  it("detects Horizon 404 account errors", () => {
    expect(
      isStellarAccountNotFoundError({
        response: {
          status: 404,
          data: { title: "Resource Missing", detail: "Account not found" },
        },
      }),
    ).toBe(true);
  });

  it("normalizes account-not-found into a funding message", () => {
    const error = normalizeStellarActionError(
      new Error(`Account not found: ${ADDRESS}`),
      ADDRESS,
    );

    expect(error.message).toContain("Stellar account is not funded");
    expect(error.message).toContain(ADDRESS);
  });

  it("preserves unrelated errors", () => {
    const original = new Error("User cancelled");

    expect(normalizeStellarActionError(original, ADDRESS)).toBe(original);
  });
});
