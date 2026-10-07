// spec: docs/product-specs/home-screen-states.md
import { describe, it, expect } from "vitest";
import { deriveHomeState } from "./homeState";

describe("deriveHomeState", () => {
  it("returns zero when there is no session, wallet disconnected", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: false })).toBe(
      "zero",
    );
  });

  it("returns zero when there is no session, even with a wallet connected", () => {
    expect(deriveHomeState({ hasSession: false, isConnected: true })).toBe(
      "zero",
    );
  });

  it("returns legacy when a session is present, wallet disconnected", () => {
    expect(deriveHomeState({ hasSession: true, isConnected: false })).toBe(
      "legacy",
    );
  });

  it("returns legacy when a session is present and wallet connected", () => {
    expect(deriveHomeState({ hasSession: true, isConnected: true })).toBe(
      "legacy",
    );
  });
});
