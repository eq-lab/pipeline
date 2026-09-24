import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveSession,
  readSession,
  clearSession,
  subscribeSession,
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
