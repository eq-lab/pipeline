// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, toFunctionSelector, getAddress } from "viem";

const { mockRead, mockSend, mockCode } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockSend: vi.fn(),
  mockCode: vi.fn(),
}));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  readEvmContractCode: mockCode,
  sendEvmContractCall: mockSend,
}));

import {
  EVM_SECURITY_FUNCTION_NAMES,
  EVM_SET_TERMS_SELECTORS,
  encodeEvmSecurityRegistryCalldata,
  evmSecurityErrorAbi,
  evmSecurityRecordNftAbi,
  evmSecurityRegistryAbi,
  evmSecurityRegistryTerms12Abi,
  evmSecuritySelector,
  evmSecurityTermsShapeFromCode,
  evmSecurityTarget,
  isEvmInspectorAddress,
  normalizeEvmAddress,
  readEvmSecurityInspectors,
  readEvmSecurityRegistrySchedule,
  readEvmSecurityTermsShape,
  relayEvmSecurityRegistry,
} from "./securityRegistry";
import type {
  SecurityRegistryCall,
  SecurityTermsInput,
} from "../../stellar/contracts/securityRegistry";

const HASH = "cd".repeat(32);
const REGISTRY = "0x00000000000000000000000000000000000000b1";
const NFT = "0x00000000000000000000000000000000000000b2";
const AM = "0x00000000000000000000000000000000000000a1";
const CALLER = "0x00000000000000000000000000000000000000c1";
const INSPECTOR_1 = "0x00000000000000000000000000000000000000e1";
const INSPECTOR_2 = "0x00000000000000000000000000000000000000e2";

const TERMS: SecurityTermsInput = {
  advanceRatioBps: 7000,
  marginCallRatioBps: 8000,
  defaultRatioBps: 9000,
  curePeriod: 86400,
  priceStaleAfter: "172800",
  paymentTerm: "Da",
  gracePeriod: 604800,
  defaultRate: 120000,
  originatorFeeRate: 10000,
  attestationInterval: 2592000,
  inspectionInterval: 7776000,
  toleranceBps: 500,
  gradeToleranceBps: 200,
};

const encode15 = (call: SecurityRegistryCall) =>
  encodeEvmSecurityRegistryCalldata(call, "terms15");

const setTerms = (terms: Partial<SecurityTermsInput> = {}, loanId = 7) =>
  ({
    fn: "set_terms",
    loanId,
    terms: { ...TERMS, ...terms },
  }) as const;

describe("encodeEvmSecurityRegistryCalldata", () => {
  it("round-trips set_terms with all 15 fields in order", () => {
    const data = encode15(setTerms());
    const decoded = decodeFunctionData({
      abi: evmSecurityRegistryAbi,
      data,
    });
    expect(decoded.functionName).toBe("setTerms");
    const [loanId, terms] = decoded.args as unknown as [
      bigint,
      Record<string, unknown>,
    ];
    expect(loanId).toBe(7n);
    expect(Object.keys(terms)).toEqual([
      "advanceRatioBps",
      "marginCallRatioBps",
      "defaultRatioBps",
      "curePeriod",
      "priceStaleAfter",
      "paymentTerm",
      "gracePeriod",
      "defaultRate",
      "originatorFeeRate",
      "attestationInterval",
      "inspectionInterval",
      "toleranceBps",
      "gradeToleranceBps",
      "marginCallAt",
      "defaultBreachAt",
    ]);
    expect(terms).toEqual({
      advanceRatioBps: 7000,
      marginCallRatioBps: 8000,
      defaultRatioBps: 9000,
      curePeriod: 86400n,
      priceStaleAfter: 172800n,
      paymentTerm: 2,
      gracePeriod: 604800n,
      defaultRate: 120000,
      originatorFeeRate: 10000,
      attestationInterval: 2592000n,
      inspectionInterval: 7776000n,
      toleranceBps: 500,
      gradeToleranceBps: 200,
      marginCallAt: 0n,
      defaultBreachAt: 0n,
    });
  });

  it("encodes every payment term as its enum ordinal", () => {
    for (const [index, term] of (
      ["Lc", "Dp", "Da", "OpenAccount"] as const
    ).entries()) {
      const decoded = decodeFunctionData({
        abi: evmSecurityRegistryAbi,
        data: encode15(setTerms({ paymentTerm: term })),
      });
      expect((decoded.args![1] as { paymentTerm: number }).paymentTerm).toBe(
        index,
      );
    }
  });

  it("round-trips resolve_flag with the outcome ordinal and a 0x hash", () => {
    const data = encode15({
      fn: "resolve_flag",
      recordId: 3,
      outcome: "TopUpRequired",
      reasonHash: HASH,
    });
    const decoded = decodeFunctionData({ abi: evmSecurityRegistryAbi, data });
    expect(decoded.functionName).toBe("resolveFlag");
    expect(decoded.args).toEqual([3n, 1, `0x${HASH}`]);
  });

  it("round-trips release_with_consent", () => {
    const data = encode15({
      fn: "release_with_consent",
      recordId: 3,
      consentHash: HASH,
    });
    const decoded = decodeFunctionData({ abi: evmSecurityRegistryAbi, data });
    expect(decoded.functionName).toBe("releaseWithConsent");
    expect(decoded.args).toEqual([3n, `0x${HASH}`]);
  });

  it("round-trips set_inspectors with checksummed addresses", () => {
    const data = encode15({
      fn: "set_inspectors",
      inspectors: [INSPECTOR_2, INSPECTOR_1],
    });
    const decoded = decodeFunctionData({ abi: evmSecurityRecordNftAbi, data });
    expect(decoded.functionName).toBe("setInspectors");
    expect(decoded.args).toEqual([
      [getAddress(INSPECTOR_2), getAddress(INSPECTOR_1)],
    ]);
  });

  it("accepts an empty inspector list", () => {
    expect(() =>
      encode15({
        fn: "set_inspectors",
        inspectors: [],
      }),
    ).not.toThrow();
  });

  it("rejects both ratio-order violations", () => {
    expect(() => encode15(setTerms({ marginCallRatioBps: 6000 }))).toThrow(
      "marginCallRatioBps",
    );
    expect(() => encode15(setTerms({ defaultRatioBps: 7500 }))).toThrow(
      "defaultRatioBps",
    );
  });

  it("requires the EVM-only fields", () => {
    expect(() => encode15(setTerms({ defaultRatioBps: undefined }))).toThrow(
      "defaultRatioBps",
    );
    expect(() => encode15(setTerms({ originatorFeeRate: undefined }))).toThrow(
      "originatorFeeRate",
    );
  });

  it("rejects out-of-range integers", () => {
    expect(() => encode15(setTerms({ toleranceBps: 2 ** 32 }))).toThrow(
      "toleranceBps",
    );
    expect(() => encode15(setTerms({ curePeriod: -1 }))).toThrow("curePeriod");
    expect(() =>
      encode15(setTerms({ curePeriod: (2n ** 64n).toString() })),
    ).toThrow("curePeriod");
    expect(() => encode15(setTerms({}, -1))).toThrow("loanId");
    expect(() => encode15(setTerms({}, 1.5))).toThrow("loanId");
  });

  it("rejects a bad hash, outcome and payment term", () => {
    for (const reasonHash of [`0x${HASH}`, "ab", HASH.toUpperCase()]) {
      expect(() =>
        encode15({
          fn: "resolve_flag",
          recordId: 1,
          outcome: "Accepted",
          reasonHash,
        }),
      ).toThrow("reasonHash");
    }
    expect(() =>
      encode15({
        fn: "resolve_flag",
        recordId: 1,
        outcome: "Nope" as never,
        reasonHash: HASH,
      }),
    ).toThrow("outcome");
    expect(() => encode15(setTerms({ paymentTerm: "X" as never }))).toThrow(
      "paymentTerm",
    );
  });

  it("rejects bad and case-insensitive duplicate inspectors", () => {
    expect(() =>
      encode15({
        fn: "set_inspectors",
        inspectors: ["GABC"],
      }),
    ).toThrow("inspector");
    expect(() =>
      encode15({
        fn: "set_inspectors",
        inspectors: [INSPECTOR_1, getAddress(INSPECTOR_1)],
      }),
    ).toThrow("duplicate inspector");
  });
});

describe("selectors and targets", () => {
  it("pins the 150631a selectors", () => {
    expect(evmSecuritySelector("set_terms", "terms15")).toBe("0x45f225f5");
    expect(evmSecuritySelector("resolve_flag")).toBe("0xdf84b5b3");
    expect(evmSecuritySelector("release_with_consent")).toBe("0x115f901f");
    expect(evmSecuritySelector("set_inspectors")).toBe("0xa84489a4");
  });

  it("matches the Solidity signatures", () => {
    const tuple =
      "(uint32,uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint32,uint64,uint64,uint32,uint32,uint64,uint64)";
    expect(evmSecuritySelector("set_terms", "terms15")).toBe(
      toFunctionSelector(`setTerms(uint256,${tuple})`),
    );
    expect(evmSecuritySelector("resolve_flag")).toBe(
      toFunctionSelector("resolveFlag(uint256,uint8,bytes32)"),
    );
    expect(evmSecuritySelector("release_with_consent")).toBe(
      toFunctionSelector("releaseWithConsent(uint256,bytes32)"),
    );
    expect(evmSecuritySelector("set_inspectors")).toBe(
      toFunctionSelector("setInspectors(address[])"),
    );
  });

  it("maps every logical function to a Solidity name", () => {
    expect(EVM_SECURITY_FUNCTION_NAMES).toEqual({
      set_terms: "setTerms",
      resolve_flag: "resolveFlag",
      release_with_consent: "releaseWithConsent",
      set_inspectors: "setInspectors",
    });
  });

  it("sends set_inspectors to the RecordNft and the rest to the registry", () => {
    const addresses = { registry: REGISTRY, recordNft: NFT };
    expect(evmSecurityTarget("set_inspectors", addresses)).toBe(NFT);
    expect(evmSecurityTarget("set_terms", addresses)).toBe(REGISTRY);
    expect(evmSecurityTarget("resolve_flag", addresses)).toBe(REGISTRY);
    expect(evmSecurityTarget("release_with_consent", addresses)).toBe(REGISTRY);
  });

  it("collects each error once", () => {
    const names = evmSecurityErrorAbi.map(
      (item) => (item as { name: string }).name,
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("EnforcedPause");
    expect(names).toContain("SecurityRegistryInvalidRatio");
    expect(names).toContain("SecurityRecordNftNotInspector");
  });
});

describe("addresses", () => {
  it("validates and normalises", () => {
    expect(isEvmInspectorAddress(INSPECTOR_1)).toBe(true);
    expect(isEvmInspectorAddress("0x123")).toBe(false);
    expect(isEvmInspectorAddress("GABC")).toBe(false);
    expect(normalizeEvmAddress(INSPECTOR_1)).toBe(getAddress(INSPECTOR_1));
  });
});

describe("relay and reads", () => {
  beforeEach(() => {
    mockRead.mockReset();
    mockSend.mockReset();
  });

  it("relays set_inspectors through the AccessManager to the RecordNft", async () => {
    mockSend.mockResolvedValue({ hash: "0xh" });
    await relayEvmSecurityRegistry({
      mode: "execute",
      call: { fn: "set_inspectors", inspectors: [INSPECTOR_1] },
      accessManager: AM,
      registry: REGISTRY,
      recordNft: NFT,
      caller: CALLER,
      chainId: 560048,
    });
    const sent = mockSend.mock.calls[0]![0];
    expect(sent.functionName).toBe("execute");
    expect(sent.args[0]).toBe(NFT);
    expect(sent.args[1]).toBe(
      encodeEvmSecurityRegistryCalldata({
        fn: "set_inspectors",
        inspectors: [INSPECTOR_1],
      }),
    );
  });

  it("reads the schedule of the encoded calldata", async () => {
    mockRead
      .mockResolvedValueOnce(`0x${"01".repeat(32)}`)
      .mockResolvedValueOnce(0);
    const schedule = await readEvmSecurityRegistrySchedule({
      call: setTerms(),
      termsShape: "terms15",
      accessManager: AM,
      registry: REGISTRY,
      recordNft: NFT,
      caller: CALLER,
    });
    expect(schedule).toEqual({ operationId: "01".repeat(32), readyAt: 0 });
    expect(mockRead.mock.calls[0]![0].args).toEqual([
      CALLER,
      REGISTRY,
      encode15(setTerms()),
    ]);
  });

  it("reads the RecordNft inspectors as EIP-55", async () => {
    mockRead.mockResolvedValue([INSPECTOR_1, INSPECTOR_2]);
    await expect(
      readEvmSecurityInspectors({ recordNft: NFT }),
    ).resolves.toEqual([getAddress(INSPECTOR_1), getAddress(INSPECTOR_2)]);
    expect(mockRead.mock.calls[0]![0]).toMatchObject({
      address: NFT,
      functionName: "inspectors",
    });
    await expect(readEvmSecurityInspectors({ recordNft: "" })).rejects.toThrow(
      "recordNft must not be empty",
    );
  });
});

const TERMS12_LOAN_1_HEX =
  "0x36b14cd2000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000017700000000000000000000000000000000000000000000000000000000000001d4c000000000000000000000000000000000000000000000000000000000003f4800000000000000000000000000000000000000000000000000000000000015180000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000697800000000000000000000000000000000000000000000000000000000000004e200000000000000000000000000000000000000000000000000000000000093a800000000000000000000000000000000000000000000000000000000000278d0000000000000000000000000000000000000000000000000000000000000001f400000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000000";

const HOODI_TERMS: SecurityTermsInput = {
  advanceRatioBps: 6000,
  marginCallRatioBps: 7500,
  curePeriod: 259200,
  priceStaleAfter: 86400,
  paymentTerm: "Dp",
  gracePeriod: 432000,
  defaultRate: 20000,
  attestationInterval: 604800,
  inspectionInterval: 2592000,
  toleranceBps: 500,
  gradeToleranceBps: 200,
};

const setTerms12 = (terms: Partial<SecurityTermsInput> = {}, loanId = 1) =>
  ({
    fn: "set_terms",
    loanId,
    terms: { ...HOODI_TERMS, ...terms },
  }) as const;

const encode12 = (call: SecurityRegistryCall) =>
  encodeEvmSecurityRegistryCalldata(call, "terms12");

describe("f92d719 setTerms (terms12)", () => {
  it("selects 0x36b14cd2 for terms12 and 0x45f225f5 for terms15", () => {
    expect(evmSecuritySelector("set_terms", "terms15")).toBe("0x45f225f5");
    expect(evmSecuritySelector("set_terms", "terms12")).toBe("0x36b14cd2");
    expect(EVM_SET_TERMS_SELECTORS).toEqual({
      terms15: "0x45f225f5",
      terms12: "0x36b14cd2",
    });
  });

  it("requires a shape for set_terms", () => {
    expect(() => evmSecuritySelector("set_terms")).toThrow(
      "termsShape is required for set_terms",
    );
    expect(() => encodeEvmSecurityRegistryCalldata(setTerms())).toThrow(
      "termsShape is required for set_terms",
    );
  });

  it("leaves the other selectors unchanged with or without a shape", () => {
    for (const shape of [undefined, "terms12", "terms15"] as const) {
      expect(evmSecuritySelector("resolve_flag", shape)).toBe("0xdf84b5b3");
      expect(evmSecuritySelector("release_with_consent", shape)).toBe(
        "0x115f901f",
      );
      expect(evmSecuritySelector("set_inspectors", shape)).toBe("0xa84489a4");
    }
  });

  it("matches the 12-field Solidity signature", () => {
    const tuple =
      "(uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint64,uint64,uint32,uint32,uint64)";
    expect(evmSecuritySelector("set_terms", "terms12")).toBe(
      toFunctionSelector(`setTerms(uint256,${tuple})`),
    );
  });

  it("pins the payload simulated on Hoodi", () => {
    const data = encode12(setTerms12());
    expect(data).toBe(TERMS12_LOAN_1_HEX);
    expect((data.length - 2) / 2).toBe(420);
  });

  it("round-trips the 12 fields with marginCallAt 0", () => {
    const decoded = decodeFunctionData({
      abi: evmSecurityRegistryTerms12Abi,
      data: encode12(setTerms12({}, 9)),
    });
    expect(decoded.functionName).toBe("setTerms");
    expect(decoded.args![0]).toBe(9n);
    expect(decoded.args![1]).toEqual({
      advanceRatioBps: 6000,
      marginCallRatioBps: 7500,
      curePeriod: 259200n,
      priceStaleAfter: 86400n,
      paymentTerm: 1,
      gracePeriod: 432000n,
      defaultRate: 20000,
      attestationInterval: 604800n,
      inspectionInterval: 2592000n,
      toleranceBps: 500,
      gradeToleranceBps: 200,
      marginCallAt: 0n,
    });
  });

  it("refuses the fields this build does not have", () => {
    expect(() => encode12(setTerms12({ defaultRatioBps: 9000 }))).toThrow(
      "defaultRatioBps (absent on this SecurityRegistry build)",
    );
    expect(() => encode12(setTerms12({ originatorFeeRate: 10000 }))).toThrow(
      "originatorFeeRate (absent on this SecurityRegistry build)",
    );
  });

  it("applies only the first ratio rule", () => {
    expect(() => encode12(setTerms12({ marginCallRatioBps: 5000 }))).toThrow(
      "marginCallRatioBps",
    );
    expect(() =>
      encode12(setTerms12({ marginCallRatioBps: 6000 })),
    ).not.toThrow();
  });

  it("keeps the range checks", () => {
    expect(() => encode12(setTerms12({ toleranceBps: 2 ** 32 }))).toThrow(
      "toleranceBps",
    );
    expect(() => encode12(setTerms12({ curePeriod: -1 }))).toThrow(
      "curePeriod",
    );
    expect(() => encode12(setTerms12({ paymentTerm: "X" as never }))).toThrow(
      "paymentTerm",
    );
  });

  it("forwards the shape through relay and schedule reads", async () => {
    mockRead.mockReset();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ hash: "0xh" });
    await relayEvmSecurityRegistry({
      mode: "execute",
      call: setTerms12(),
      termsShape: "terms12",
      accessManager: AM,
      registry: REGISTRY,
      recordNft: NFT,
      caller: CALLER,
      chainId: 560048,
    });
    expect(mockSend.mock.calls[0]![0].args[1]).toBe(TERMS12_LOAN_1_HEX);
    mockRead
      .mockResolvedValueOnce(`0x${"01".repeat(32)}`)
      .mockResolvedValueOnce(0);
    await readEvmSecurityRegistrySchedule({
      call: setTerms12(),
      termsShape: "terms12",
      accessManager: AM,
      registry: REGISTRY,
      recordNft: NFT,
      caller: CALLER,
    });
    expect(mockRead.mock.calls[0]![0].args[2]).toBe(TERMS12_LOAN_1_HEX);
  });
});

describe("evmSecurityTermsShapeFromCode", () => {
  const dispatcher = (selector: string) =>
    `0x80632c16cd8a14613485578063${selector}14612ea9578063378a189914612e6657` as const;

  it("reads the Hoodi dispatcher excerpt as terms12", () => {
    expect(evmSecurityTermsShapeFromCode(dispatcher("36b14cd2"))).toBe(
      "terms12",
    );
  });

  it("reads the 150631a selector as terms15", () => {
    expect(evmSecurityTermsShapeFromCode(dispatcher("45f225f5"))).toBe(
      "terms15",
    );
  });

  it("throws when both or neither selector is present", () => {
    const both = `0x6336b14cd26345f225f5`;
    expect(() => evmSecurityTermsShapeFromCode(both)).toThrow(
      /0x45f225f5 nor 0x36b14cd2/,
    );
    expect(() => evmSecurityTermsShapeFromCode("0x6000600055")).toThrow(
      /0x45f225f5 nor 0x36b14cd2/,
    );
  });

  it("skips push data", () => {
    const code = `0x7f${"00".repeat(20)}6345f225f5${"00".repeat(7)}6336b14cd2`;
    expect(evmSecurityTermsShapeFromCode(code as never)).toBe("terms12");
  });

  it("does not throw a range error on a truncated trailing PUSH4", () => {
    expect(() => evmSecurityTermsShapeFromCode("0x6336b1")).toThrow(
      /Unrecognised SecurityRegistry build/,
    );
    expect(evmSecurityTermsShapeFromCode("0x6336b14cd26345f2")).toBe("terms12");
  });
});

describe("readEvmSecurityTermsShape", () => {
  beforeEach(() => {
    mockCode.mockReset();
  });

  it("refuses an empty or invalid address before any read", async () => {
    await expect(readEvmSecurityTermsShape({ registry: "" })).rejects.toThrow(
      "registry must not be empty",
    );
    await expect(
      readEvmSecurityTermsShape({ registry: "0x123" }),
    ).rejects.toThrow("invalid registry");
    expect(mockCode).not.toHaveBeenCalled();
  });

  it("returns the shape of the registry code", async () => {
    mockCode.mockResolvedValue("0x6336b14cd2");
    await expect(
      readEvmSecurityTermsShape({ registry: REGISTRY }),
    ).resolves.toBe("terms12");
    expect(mockCode).toHaveBeenCalledWith(REGISTRY);
  });
});
