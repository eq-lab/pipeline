import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveSession,
  readSession,
  clearSession,
  subscribeSession,
  isAccountSetupDismissed,
  markAccountSetupDismissed,
} from "./session";

beforeEach(() => {
  localStorage.clear();
});

describe("saveSession / readSession", () => {
  it("round-trips a token with an expiry derived from expires_in", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    saveSession({ token: "jwt", expires_in: 86400 });

    expect(readSession()).toEqual({
      token: "jwt",
      expiresAt: now + 86400 * 1000,
    });
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(readSession()).toBeNull();
  });

  it("retains a normalized email through storage and clears it on logout", () => {
    saveSession({ token: "jwt", expires_in: 3600, email: "  LP@Example.COM " });
    expect(readSession()?.email).toBe("lp@example.com");
    expect(
      JSON.parse(localStorage.getItem("pipeline.auth.session") ?? "{}").email,
    ).toBe("lp@example.com");
    clearSession();
    expect(readSession()).toBeNull();
  });

  it("reads an old token-only session without guessing an email", () => {
    localStorage.setItem(
      "pipeline.auth.session",
      JSON.stringify({ token: "legacy", expiresAt: Date.now() + 1000 }),
    );
    expect(readSession()?.email).toBeUndefined();
  });

  it("returns null and clears storage once expiresAt has passed", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    saveSession({ token: "jwt", expires_in: 10 });

    vi.spyOn(Date, "now").mockReturnValue(now + 11_000);
    expect(readSession()).toBeNull();
    expect(localStorage.getItem("pipeline.auth.session")).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem("pipeline.auth.session", "{not json");
    expect(readSession()).toBeNull();
  });

  it("returns null when the stored shape is missing fields", () => {
    localStorage.setItem(
      "pipeline.auth.session",
      JSON.stringify({ token: "jwt" }),
    );
    expect(readSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("removes the stored session", () => {
    saveSession({ token: "jwt", expires_in: 86400 });
    clearSession();
    expect(readSession()).toBeNull();
  });
});

describe("subscribeSession", () => {
  it("notifies subscribers on save and clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSession(listener);

    saveSession({ token: "jwt", expires_in: 86400 });
    expect(listener).toHaveBeenCalledTimes(1);

    clearSession();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    saveSession({ token: "jwt2", expires_in: 86400 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("account-setup dismissal (#1429)", () => {
  it("is scoped to the stored token and cleared on sign-out", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    expect(isAccountSetupDismissed("jwt")).toBe(false);

    markAccountSetupDismissed("jwt");
    expect(isAccountSetupDismissed("jwt")).toBe(true);
    expect(isAccountSetupDismissed("other-jwt")).toBe(false);

    clearSession();
    expect(isAccountSetupDismissed("jwt")).toBe(false);
  });

  it("survives storing the same session again", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    markAccountSetupDismissed("jwt");
    saveSession({ token: "jwt", expires_in: 3600 });
    expect(isAccountSetupDismissed("jwt")).toBe(true);
  });

  it("drops a dismissal left over from another token on a new sign-in", () => {
    saveSession({ token: "jwt", expires_in: 3600 });
    markAccountSetupDismissed("jwt");
    saveSession({ token: "next-jwt", expires_in: 3600 });
    expect(isAccountSetupDismissed("jwt")).toBe(false);
    expect(isAccountSetupDismissed("next-jwt")).toBe(false);
  });
});
