// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, toFunctionSelector, getAddress } from "viem";

const { mockRead, mockSend } = vi.hoisted(() => ({
  mockRead: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("./write", () => ({
  readEvmContract: mockRead,
  sendEvmContractCall: mockSend,
}));

import {
  EVM_SECURITY_FUNCTION_NAMES,
  encodeEvmSecurityRegistryCalldata,
  evmSecurityErrorAbi,
  evmSecurityRecordNftAbi,
  evmSecurityRegistryAbi,
  evmSecuritySelector,
  evmSecurityTarget,
  isEvmInspectorAddress,
  normalizeEvmAddress,
  readEvmSecurityInspectors,
  readEvmSecurityRegistrySchedule,
  relayEvmSecurityRegistry,
} from "./securityRegistry";
import type { SecurityTermsInput } from "../../stellar/contracts/securityRegistry";

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

const setTerms = (terms: Partial<SecurityTermsInput> = {}, loanId = 7) =>
  ({
    fn: "set_terms",
    loanId,
    terms: { ...TERMS, ...terms },
  }) as const;

describe("encodeEvmSecurityRegistryCalldata", () => {
  it("round-trips set_terms with all 15 fields in order", () => {
    const data = encodeEvmSecurityRegistryCalldata(setTerms());
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
        data: encodeEvmSecurityRegistryCalldata(
          setTerms({ paymentTerm: term }),
        ),
      });
      expect((decoded.args![1] as { paymentTerm: number }).paymentTerm).toBe(
        index,
      );
    }
  });

  it("round-trips resolve_flag with the outcome ordinal and a 0x hash", () => {
    const data = encodeEvmSecurityRegistryCalldata({
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
    const data = encodeEvmSecurityRegistryCalldata({
      fn: "release_with_consent",
      recordId: 3,
      consentHash: HASH,
    });
    const decoded = decodeFunctionData({ abi: evmSecurityRegistryAbi, data });
    expect(decoded.functionName).toBe("releaseWithConsent");
    expect(decoded.args).toEqual([3n, `0x${HASH}`]);
  });

  it("round-trips set_inspectors with checksummed addresses", () => {
    const data = encodeEvmSecurityRegistryCalldata({
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
      encodeEvmSecurityRegistryCalldata({
        fn: "set_inspectors",
        inspectors: [],
      }),
    ).not.toThrow();
  });

  it("rejects both ratio-order violations", () => {
    expect(() =>
      encodeEvmSecurityRegistryCalldata(setTerms({ marginCallRatioBps: 6000 })),
    ).toThrow("marginCallRatioBps");
    expect(() =>
      encodeEvmSecurityRegistryCalldata(setTerms({ defaultRatioBps: 7500 })),
    ).toThrow("defaultRatioBps");
  });

  it("requires the EVM-only fields", () => {
    expect(() =>
      encodeEvmSecurityRegistryCalldata(
        setTerms({ defaultRatioBps: undefined }),
      ),
    ).toThrow("defaultRatioBps");
    expect(() =>
      encodeEvmSecurityRegistryCalldata(
        setTerms({ originatorFeeRate: undefined }),
      ),
    ).toThrow("originatorFeeRate");
  });

  it("rejects out-of-range integers", () => {
    expect(() =>
      encodeEvmSecurityRegistryCalldata(setTerms({ toleranceBps: 2 ** 32 })),
    ).toThrow("toleranceBps");
    expect(() =>
      encodeEvmSecurityRegistryCalldata(setTerms({ curePeriod: -1 })),
    ).toThrow("curePeriod");
    expect(() =>
      encodeEvmSecurityRegistryCalldata(
        setTerms({ curePeriod: (2n ** 64n).toString() }),
      ),
    ).toThrow("curePeriod");
    expect(() => encodeEvmSecurityRegistryCalldata(setTerms({}, -1))).toThrow(
      "loanId",
    );
    expect(() => encodeEvmSecurityRegistryCalldata(setTerms({}, 1.5))).toThrow(
      "loanId",
    );
  });

  it("rejects a bad hash, outcome and payment term", () => {
    for (const reasonHash of [`0x${HASH}`, "ab", HASH.toUpperCase()]) {
      expect(() =>
        encodeEvmSecurityRegistryCalldata({
          fn: "resolve_flag",
          recordId: 1,
          outcome: "Accepted",
          reasonHash,
        }),
      ).toThrow("reasonHash");
    }
    expect(() =>
      encodeEvmSecurityRegistryCalldata({
        fn: "resolve_flag",
        recordId: 1,
        outcome: "Nope" as never,
        reasonHash: HASH,
      }),
    ).toThrow("outcome");
    expect(() =>
      encodeEvmSecurityRegistryCalldata(
        setTerms({ paymentTerm: "X" as never }),
      ),
    ).toThrow("paymentTerm");
  });

  it("rejects bad and case-insensitive duplicate inspectors", () => {
    expect(() =>
      encodeEvmSecurityRegistryCalldata({
        fn: "set_inspectors",
        inspectors: ["GABC"],
      }),
    ).toThrow("inspector");
    expect(() =>
      encodeEvmSecurityRegistryCalldata({
        fn: "set_inspectors",
        inspectors: [INSPECTOR_1, getAddress(INSPECTOR_1)],
      }),
    ).toThrow("duplicate inspector");
  });
});

describe("selectors and targets", () => {
  it("pins the 150631a selectors", () => {
    expect(evmSecuritySelector("set_terms")).toBe("0x45f225f5");
    expect(evmSecuritySelector("resolve_flag")).toBe("0xdf84b5b3");
    expect(evmSecuritySelector("release_with_consent")).toBe("0x115f901f");
    expect(evmSecuritySelector("set_inspectors")).toBe("0xa84489a4");
  });

  it("matches the Solidity signatures", () => {
    const tuple =
      "(uint32,uint32,uint32,uint64,uint64,uint8,uint64,uint32,uint32,uint64,uint64,uint32,uint32,uint64,uint64)";
    expect(evmSecuritySelector("set_terms")).toBe(
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
      accessManager: AM,
      registry: REGISTRY,
      recordNft: NFT,
      caller: CALLER,
    });
    expect(schedule).toEqual({ operationId: "01".repeat(32), readyAt: 0 });
    expect(mockRead.mock.calls[0]![0].args).toEqual([
      CALLER,
      REGISTRY,
      encodeEvmSecurityRegistryCalldata(setTerms()),
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
