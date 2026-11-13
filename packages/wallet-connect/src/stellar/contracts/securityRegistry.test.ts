// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { describe, it, expect, vi, beforeEach } from "vitest";
import { scValToNative, StrKey } from "@stellar/stellar-sdk";

const { mockRelay, mockReadOperationSchedule, mockSimulateRead } = vi.hoisted(
  () => ({
    mockRelay: vi.fn(),
    mockReadOperationSchedule: vi.fn(),
    mockSimulateRead: vi.fn(),
  }),
);

vi.mock("./accessManager", () => ({
  relay: mockRelay,
  readOperationSchedule: mockReadOperationSchedule,
}));
vi.mock("./simulateRead", () => ({ simulateRead: mockSimulateRead }));

import {
  encodeSecurityRegistryArgs,
  readSecurityInspectors,
  readSecurityRegistrySchedule,
  relaySecurityRegistry,
  securityReasonHash,
  type SecurityTermsInput,
} from "./securityRegistry";

const HASH = "cd".repeat(32);
const base = {
  registryId: "CSEC",
  rpcUrl: "https://rpc.test",
  networkPassphrase: "Test SDF Network ; September 2015",
};
const G1 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const G2 = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const C1 = StrKey.encodeContract(Buffer.alloc(32, 7));

const TERMS: SecurityTermsInput = {
  advanceRatioBps: 7000,
  marginCallRatioBps: 8000,
  curePeriod: 604800,
  priceStaleAfter: "86400",
  paymentTerm: "Da",
  gracePeriod: 259200,
  defaultRate: 20000,
  attestationInterval: 2592000,
  inspectionInterval: 2592000,
  toleranceBps: 50,
  gradeToleranceBps: 25,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("encodeSecurityRegistryArgs set_terms", () => {
  it("encodes loan id and a sorted 12-field Terms map", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "set_terms",
      loanId: 9,
      terms: TERMS,
    });
    expect(args.map((a) => a.switch().name)).toEqual(["scvU32", "scvMap"]);
    const entries = args[1]!.map()!;
    const keys = entries.map((e) => e.key().sym().toString());
    expect(keys).toEqual([
      "advance_ratio_bps",
      "attestation_interval",
      "cure_period",
      "default_rate",
      "grace_period",
      "grade_tolerance_bps",
      "inspection_interval",
      "margin_call_at",
      "margin_call_ratio_bps",
      "payment_term",
      "price_stale_after",
      "tolerance_bps",
    ]);
    expect(keys).toEqual([...keys].sort());
    const types = Object.fromEntries(
      entries.map((e) => [e.key().sym().toString(), e.val().switch().name]),
    );
    expect(types).toEqual({
      advance_ratio_bps: "scvU32",
      attestation_interval: "scvU64",
      cure_period: "scvU64",
      default_rate: "scvU32",
      grace_period: "scvU64",
      grade_tolerance_bps: "scvU32",
      inspection_interval: "scvU64",
      margin_call_at: "scvU64",
      margin_call_ratio_bps: "scvU32",
      payment_term: "scvVec",
      price_stale_after: "scvU64",
      tolerance_bps: "scvU32",
    });
  });

  it("sends margin_call_at = 0 and the payment term as vec[symbol]", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "set_terms",
      loanId: 1,
      terms: TERMS,
    });
    const native = scValToNative(args[1]!) as Record<string, unknown>;
    expect(native.margin_call_at).toBe(0n);
    expect(native.payment_term).toEqual(["Da"]);
    expect(native.price_stale_after).toBe(86400n);
    expect(native.default_rate).toBe(20000);
    expect(native.advance_ratio_bps).toBe(7000);
  });

  it("rejects bad terms", () => {
    const bad = (terms: Partial<SecurityTermsInput>, loanId = 1) =>
      expect(() =>
        encodeSecurityRegistryArgs({
          fn: "set_terms",
          loanId,
          terms: { ...TERMS, ...terms },
        }),
      ).toThrow(/encodeSecurityRegistryArgs/);
    bad({ advanceRatioBps: 9000, marginCallRatioBps: 8000 });
    bad({ advanceRatioBps: 1.5 });
    bad({ toleranceBps: -1 });
    bad({ defaultRate: 2 ** 32 });
    bad({ curePeriod: "1.5" });
    bad({ gracePeriod: -5 });
    bad({ inspectionInterval: (2n ** 64n).toString() });
    bad({ paymentTerm: "Cash" as never });
    bad({}, -1);
  });
});

describe("encodeSecurityRegistryArgs resolve_flag / release_with_consent", () => {
  it("resolve_flag encodes [u32, vec[symbol], bytes32]", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "resolve_flag",
      recordId: 4,
      outcome: "TopUpRequired",
      reasonHash: HASH,
    });
    expect(args.map((a) => a.switch().name)).toEqual([
      "scvU32",
      "scvVec",
      "scvBytes",
    ]);
    expect(scValToNative(args[1]!)).toEqual(["TopUpRequired"]);
    expect(
      Buffer.from(scValToNative(args[2]!) as Uint8Array).toString("hex"),
    ).toBe(HASH);
  });

  it("release_with_consent encodes [u32, bytes32]", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "release_with_consent",
      recordId: 12,
      consentHash: HASH,
    });
    expect(args.map((a) => a.switch().name)).toEqual(["scvU32", "scvBytes"]);
    expect(scValToNative(args[0]!)).toBe(12);
  });

  it("rejects bad hashes, outcomes and ids", () => {
    const bad = (call: Parameters<typeof encodeSecurityRegistryArgs>[0]) =>
      expect(() => encodeSecurityRegistryArgs(call)).toThrow(
        /encodeSecurityRegistryArgs/,
      );
    bad({
      fn: "resolve_flag",
      recordId: 1,
      outcome: "Accepted",
      reasonHash: "zz",
    });
    bad({
      fn: "resolve_flag",
      recordId: 1,
      outcome: "Nope" as never,
      reasonHash: HASH,
    });
    bad({
      fn: "release_with_consent",
      recordId: 1,
      consentHash: HASH.toUpperCase(),
    });
    bad({ fn: "release_with_consent", recordId: -1, consentHash: HASH });
  });
});

describe("encodeSecurityRegistryArgs set_inspectors", () => {
  it("encodes a vec of addresses in the given order", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "set_inspectors",
      inspectors: [G2, C1, G1],
    });
    expect(args).toHaveLength(1);
    expect(args[0]!.switch().name).toBe("scvVec");
    expect(scValToNative(args[0]!)).toEqual([G2, C1, G1]);
  });

  it("allows an empty list", () => {
    const args = encodeSecurityRegistryArgs({
      fn: "set_inspectors",
      inspectors: [],
    });
    expect(scValToNative(args[0]!)).toEqual([]);
  });

  it("rejects a bad Strkey and duplicates", () => {
    expect(() =>
      encodeSecurityRegistryArgs({ fn: "set_inspectors", inspectors: ["x"] }),
    ).toThrow(/invalid inspector/);
    expect(() =>
      encodeSecurityRegistryArgs({
        fn: "set_inspectors",
        inspectors: [G1, G1],
      }),
    ).toThrow(/duplicate inspector/);
  });
});

describe("relaySecurityRegistry / readSecurityRegistrySchedule", () => {
  it("relays with target = registry, fn and encoded args in both modes", async () => {
    mockRelay.mockResolvedValue({ hash: "H" });
    for (const mode of ["schedule", "execute"] as const) {
      await relaySecurityRegistry({
        mode,
        call: { fn: "release_with_consent", recordId: 5, consentHash: HASH },
        accessManagerId: "CAM",
        caller: "GCALLER",
        signTransaction: vi.fn(),
        ...base,
      });
      const arg = mockRelay.mock.calls.at(-1)![0];
      expect(arg.mode).toBe(mode);
      expect(arg.target).toBe("CSEC");
      expect(arg.fn).toBe("release_with_consent");
      expect(scValToNative(arg.args[0])).toBe(5);
      expect(arg.accessManagerId).toBe("CAM");
    }
  });

  it("forwards schedule reads to readOperationSchedule", async () => {
    mockReadOperationSchedule.mockResolvedValue({
      operationId: "x",
      readyAt: 9,
    });
    const out = await readSecurityRegistrySchedule({
      call: { fn: "set_inspectors", inspectors: [G1] },
      accessManagerId: "CAM",
      caller: "GCALLER",
      ...base,
    });
    expect(out).toEqual({ operationId: "x", readyAt: 9 });
    const arg = mockReadOperationSchedule.mock.calls[0]![0];
    expect(arg.target).toBe("CSEC");
    expect(arg.fn).toBe("set_inspectors");
  });
});

describe("securityReasonHash", () => {
  it("is the sha256 of the trimmed UTF-8 text", async () => {
    const known =
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    expect(await securityReasonHash("test")).toBe(known);
    expect(await securityReasonHash("  test \n")).toBe(known);
  });
});

describe("readSecurityInspectors", () => {
  it("reads the inspectors view and returns strings", async () => {
    mockSimulateRead.mockResolvedValue([G1, G2]);
    expect(await readSecurityInspectors(base)).toEqual([G1, G2]);
    expect(mockSimulateRead.mock.calls[0]![0]).toBe("CSEC");
    expect(mockSimulateRead.mock.calls[0]![1]).toBe("inspectors");
    expect(mockSimulateRead.mock.calls[0]![2]).toEqual([]);
  });

  it("treats a missing result as empty and rejects an empty registry id", async () => {
    mockSimulateRead.mockResolvedValue(undefined);
    expect(await readSecurityInspectors(base)).toEqual([]);
    await expect(
      readSecurityInspectors({ ...base, registryId: "" }),
    ).rejects.toThrow(/registryId/);
  });
});
