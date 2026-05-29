/**
 * Unit tests for the scenario registry and helper functions.
 *
 * Assertions:
 *   - Every scenario has a unique id.
 *   - Every key in every scenario starts with `pipeline.mock.`.
 *   - `clearAllMocks()` removes only `pipeline.mock.*` keys and leaves others.
 *   - `enableScenarioKeys(B)` after `enableScenarioKeys(A)` leaves exactly B's keys.
 *   - `enableScenario` and `clearMocksAndReload` call `reloadPage`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SCENARIOS,
  clearAllMocks,
  enableScenarioKeys,
  enableScenario,
  clearMocksAndReload,
  reloadPage,
  _reload,
} from "./-scenarios";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Returns all `pipeline.mock.*` keys currently in localStorage. */
function mockKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k !== null && k.startsWith("pipeline.mock.")) keys.push(k);
  }
  return keys;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
});

// ── Scenario registry contract ────────────────────────────────────────────────

describe("SCENARIOS registry", () => {
  it("has at least one scenario", () => {
    expect(SCENARIOS.length).toBeGreaterThan(0);
  });

  it("every scenario id is unique", () => {
    const ids = SCENARIOS.map((s) => s.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every key in every scenario starts with 'pipeline.mock.'", () => {
    for (const scenario of SCENARIOS) {
      for (const key of Object.keys(scenario.keys)) {
        expect(key).toMatch(/^pipeline\.mock\./);
      }
    }
  });

  it("every scenario has a non-empty title and description", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.description.length).toBeGreaterThan(0);
    }
  });
});

// ── clearAllMocks ─────────────────────────────────────────────────────────────

describe("clearAllMocks()", () => {
  it("removes all pipeline.mock.* keys", () => {
    localStorage.setItem("pipeline.mock.wallet.address", "0x1234");
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    clearAllMocks();
    expect(mockKeys()).toHaveLength(0);
  });

  it("leaves non-mock keys intact", () => {
    localStorage.setItem("pipeline.mock.wallet.address", "0x1234");
    localStorage.setItem("not-a-mock", "keep-me");
    clearAllMocks();
    expect(localStorage.getItem("not-a-mock")).toBe("keep-me");
  });

  it("returns the list of removed keys", () => {
    localStorage.setItem("pipeline.mock.wallet.address", "0x1234");
    localStorage.setItem("pipeline.mock.wallet.isConnected", "true");
    const removed = clearAllMocks();
    expect(removed).toHaveLength(2);
    expect(removed).toContain("pipeline.mock.wallet.address");
    expect(removed).toContain("pipeline.mock.wallet.isConnected");
  });

  it("returns an empty array when no mock keys are set", () => {
    const removed = clearAllMocks();
    expect(removed).toHaveLength(0);
  });
});

// ── enableScenarioKeys ────────────────────────────────────────────────────────

describe("enableScenarioKeys()", () => {
  it("sets exactly the scenario's keys in localStorage", () => {
    const scenario = SCENARIOS.find((s) => s.id === "connected-fresh")!;
    enableScenarioKeys(scenario);
    const active = mockKeys();
    expect(active.sort()).toEqual(Object.keys(scenario.keys).sort());
    for (const [k, v] of Object.entries(scenario.keys)) {
      expect(localStorage.getItem(k)).toBe(v);
    }
  });

  it("clears a previous scenario's keys before applying the new one", () => {
    const scenarioA = SCENARIOS.find((s) => s.id === "connected-fresh")!;
    const scenarioB = SCENARIOS.find((s) => s.id === "connected-allowance-ok")!;

    enableScenarioKeys(scenarioA);
    enableScenarioKeys(scenarioB);

    // Only B's keys should remain under pipeline.mock.*
    const activeAfter = mockKeys().sort();
    expect(activeAfter).toEqual(Object.keys(scenarioB.keys).sort());

    // A's unique keys should no longer be present if not shared with B
    for (const k of Object.keys(scenarioA.keys)) {
      if (!Object.prototype.hasOwnProperty.call(scenarioB.keys, k)) {
        expect(localStorage.getItem(k)).toBeNull();
      }
    }
  });

  it("leaves non-mock keys untouched", () => {
    localStorage.setItem("not-a-mock", "preserve");
    const scenario = SCENARIOS.find((s) => s.id === "connected-fresh")!;
    enableScenarioKeys(scenario);
    expect(localStorage.getItem("not-a-mock")).toBe("preserve");
  });
});

// ── Withdraw + stake scenario contracts ──────────────────────────────────────

describe("withdraw + stake scenario contracts", () => {
  it("withdraw-connected-fresh: zero PLUSD balance and zero WQ allowance", () => {
    const s = SCENARIOS.find((x) => x.id === "withdraw-connected-fresh")!;
    expect(s).toBeDefined();
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x1111000000000000000000000000000000000001"
      ],
    ).toBe("0");
    expect(
      s.keys[
        "pipeline.mock.wallet.allowance.0x1111000000000000000000000000000000000001.0x4444000000000000000000000000000000000004"
      ],
    ).toBe("0");
  });

  it("withdraw-connected-allowance-zero: PLUSD balance present, WQ allowance zero", () => {
    const s = SCENARIOS.find(
      (x) => x.id === "withdraw-connected-allowance-zero",
    )!;
    expect(s).toBeDefined();
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x1111000000000000000000000000000000000001"
      ],
    ).toBe("100000000000000000000");
    expect(
      s.keys[
        "pipeline.mock.wallet.allowance.0x1111000000000000000000000000000000000001.0x4444000000000000000000000000000000000004"
      ],
    ).toBe("0");
  });

  it("withdraw-connected-allowance-ok: PLUSD balance + WQ allowance + requestWithdrawal mock", () => {
    const s = SCENARIOS.find(
      (x) => x.id === "withdraw-connected-allowance-ok",
    )!;
    expect(s).toBeDefined();
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x1111000000000000000000000000000000000001"
      ],
    ).toBe("100000000000000000000");
    expect(
      s.keys[
        "pipeline.mock.wallet.allowance.0x1111000000000000000000000000000000000001.0x4444000000000000000000000000000000000004"
      ],
    ).toBe("1000000000000000000000");
    expect(
      s.keys["pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal"],
    ).toBeDefined();
    const mock = JSON.parse(
      s.keys[
        "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal"
      ]!,
    );
    expect(mock.hash).toMatch(/^0x/);
  });

  it("withdraw-request-pending-verification: API mock has one Withdraw PendingVerification entry", () => {
    const s = SCENARIOS.find(
      (x) => x.id === "withdraw-request-pending-verification",
    )!;
    expect(s).toBeDefined();
    const apiMock = JSON.parse(s.keys["pipeline.mock.api.GET./v1/requests"]!);
    expect(apiMock.requests).toHaveLength(1);
    expect(apiMock.requests[0].type).toBe("Withdraw");
    expect(apiMock.requests[0].status).toBe("PendingVerification");
  });

  it("withdraw-request-verification-failed: API mock has one Withdraw VerificationFailed entry", () => {
    const s = SCENARIOS.find(
      (x) => x.id === "withdraw-request-verification-failed",
    )!;
    expect(s).toBeDefined();
    const apiMock = JSON.parse(s.keys["pipeline.mock.api.GET./v1/requests"]!);
    expect(apiMock.requests).toHaveLength(1);
    expect(apiMock.requests[0].type).toBe("Withdraw");
    expect(apiMock.requests[0].status).toBe("VerificationFailed");
  });

  it("stake-fresh: both PLUSD and sPLUSD balances are zero", () => {
    const s = SCENARIOS.find((x) => x.id === "stake-fresh")!;
    expect(s).toBeDefined();
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x1111000000000000000000000000000000000001"
      ],
    ).toBe("0");
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x5555000000000000000000000000000000000005"
      ],
    ).toBe("0");
    expect(
      s.keys[
        "pipeline.mock.wallet.allowance.0x1111000000000000000000000000000000000001.0x5555000000000000000000000000000000000005"
      ],
    ).toBe("0");
  });

  it("unstake-empty: non-zero PLUSD balance, sPLUSD balance zero", () => {
    const s = SCENARIOS.find((x) => x.id === "unstake-empty")!;
    expect(s).toBeDefined();
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x1111000000000000000000000000000000000001"
      ],
    ).toBe("100000000000000000000");
    expect(
      s.keys[
        "pipeline.mock.wallet.balance.0x5555000000000000000000000000000000000005"
      ],
    ).toBe("0");
  });
});

// ── enableScenario + clearMocksAndReload ──────────────────────────────────────
//
// `enableScenario` and `clearMocksAndReload` call `_reload.fn()` instead of
// `window.location.reload()` directly, because JSDOM marks `window.location`
// as non-configurable — `vi.spyOn(window.location, "reload")` throws.
// Spying on `_reload.fn` works because `_reload` is a plain object whose `fn`
// property is writable.

describe("enableScenario() and clearMocksAndReload()", () => {
  it("reloadPage is exported and is a function", () => {
    expect(typeof reloadPage).toBe("function");
  });

  it("enableScenario calls _reload.fn (reloadPage)", () => {
    const reloadSpy = vi
      .spyOn(_reload, "fn")
      .mockImplementation(() => undefined);

    const scenario = SCENARIOS.find((s) => s.id === "connected-fresh")!;
    enableScenario(scenario);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    reloadSpy.mockRestore();
  });

  it("enableScenario sets the scenario's keys before reloading", () => {
    const reloadSpy = vi
      .spyOn(_reload, "fn")
      .mockImplementation(() => undefined);

    const scenario = SCENARIOS.find((s) => s.id === "connected-fresh")!;
    enableScenario(scenario);

    // Keys should be set
    for (const [k, v] of Object.entries(scenario.keys)) {
      expect(localStorage.getItem(k)).toBe(v);
    }
    reloadSpy.mockRestore();
  });

  it("clearMocksAndReload removes all mock keys and calls _reload.fn", () => {
    const reloadSpy = vi
      .spyOn(_reload, "fn")
      .mockImplementation(() => undefined);

    localStorage.setItem("pipeline.mock.wallet.address", "0x1234");
    localStorage.setItem("not-a-mock", "keep");

    clearMocksAndReload();

    expect(mockKeys()).toHaveLength(0);
    expect(localStorage.getItem("not-a-mock")).toBe("keep");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    reloadSpy.mockRestore();
  });
});
