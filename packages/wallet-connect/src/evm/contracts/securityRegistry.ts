// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import {
  getAddress,
  isAddress,
  toFunctionSelector,
  encodeFunctionData,
  type Abi,
  type AbiFunction,
  type Address,
  type Hex,
} from "viem";
import type {
  OperationSchedule,
  RelayMode,
  RelayResult,
  RelayStage,
} from "../../stellar/contracts/accessManager";
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
  type SecurityRegistryCall,
} from "../../stellar/contracts/securityRegistry";
import { readEvmOperationSchedule, relayEvm } from "./accessManager";
import { requireAddress } from "./args";
import { readEvmContract, readEvmContractCode } from "./write";

export const evmSecurityRegistryAbi = [
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "record",
    inputs: [{ name: "recordId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "recordId", type: "uint256" },
          { name: "loanId", type: "uint256" },
          { name: "lotId", type: "uint256" },
          { name: "protection", type: "uint8" },
          { name: "unit", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "hasMark", type: "bool" },
          { name: "perfectedAt", type: "uint64" },
          { name: "attestedAt", type: "uint64" },
          { name: "attestedBy", type: "address" },
          { name: "flaggedBy", type: "uint256" },
          { name: "referenceQuantity", type: "uint256" },
          { name: "referenceGrade", type: "uint256" },
          { name: "commodityHash", type: "bytes32" },
          {
            name: "mark",
            type: "tuple",
            components: [
              { name: "valuePerUnit", type: "uint256" },
              { name: "at", type: "uint64" },
              { name: "benchmark", type: "bytes32" },
              { name: "reportHash", type: "bytes32" },
            ],
          },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recordIds",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "releaseWithConsent",
    inputs: [
      { name: "recordId", type: "uint256" },
      { name: "consentHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resolveFlag",
    inputs: [
      { name: "recordId", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "reasonHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setTerms",
    inputs: [
      { name: "loanId", type: "uint256" },
      {
        name: "newTerms",
        type: "tuple",
        components: [
          { name: "advanceRatioBps", type: "uint32" },
          { name: "marginCallRatioBps", type: "uint32" },
          { name: "defaultRatioBps", type: "uint32" },
          { name: "curePeriod", type: "uint64" },
          { name: "priceStaleAfter", type: "uint64" },
          { name: "paymentTerm", type: "uint8" },
          { name: "gracePeriod", type: "uint64" },
          { name: "defaultRate", type: "uint32" },
          { name: "originatorFeeRate", type: "uint32" },
          { name: "attestationInterval", type: "uint64" },
          { name: "inspectionInterval", type: "uint64" },
          { name: "toleranceBps", type: "uint32" },
          { name: "gradeToleranceBps", type: "uint32" },
          { name: "marginCallAt", type: "uint64" },
          { name: "defaultBreachAt", type: "uint64" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "terms",
    inputs: [{ name: "loanId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "advanceRatioBps", type: "uint32" },
          { name: "marginCallRatioBps", type: "uint32" },
          { name: "defaultRatioBps", type: "uint32" },
          { name: "curePeriod", type: "uint64" },
          { name: "priceStaleAfter", type: "uint64" },
          { name: "paymentTerm", type: "uint8" },
          { name: "gracePeriod", type: "uint64" },
          { name: "defaultRate", type: "uint32" },
          { name: "originatorFeeRate", type: "uint32" },
          { name: "attestationInterval", type: "uint64" },
          { name: "inspectionInterval", type: "uint64" },
          { name: "toleranceBps", type: "uint32" },
          { name: "gradeToleranceBps", type: "uint32" },
          { name: "marginCallAt", type: "uint64" },
          { name: "defaultBreachAt", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "SecurityRegistryFlagged", inputs: [] },
  { type: "error", name: "SecurityRegistryInvalidCommodity", inputs: [] },
  { type: "error", name: "SecurityRegistryInvalidLocation", inputs: [] },
  { type: "error", name: "SecurityRegistryInvalidQuantity", inputs: [] },
  { type: "error", name: "SecurityRegistryInvalidRatio", inputs: [] },
  { type: "error", name: "SecurityRegistryInvalidUnit", inputs: [] },
  { type: "error", name: "SecurityRegistryLoanClosed", inputs: [] },
  { type: "error", name: "SecurityRegistryLotAlreadyCounted", inputs: [] },
  { type: "error", name: "SecurityRegistryLtvTooHigh", inputs: [] },
  { type: "error", name: "SecurityRegistryNoTerms", inputs: [] },
  { type: "error", name: "SecurityRegistryNonExistentLot", inputs: [] },
  { type: "error", name: "SecurityRegistryNonExistentRecord", inputs: [] },
  { type: "error", name: "SecurityRegistryNotCounting", inputs: [] },
  { type: "error", name: "SecurityRegistryNotFlagged", inputs: [] },
  { type: "error", name: "SecurityRegistryOnlyRecordNft", inputs: [] },
  { type: "error", name: "SecurityRegistrySameValue", inputs: [] },
  { type: "error", name: "SecurityRegistryTooManyRecords", inputs: [] },
  { type: "error", name: "SecurityRegistryUnitMismatch", inputs: [] },
  { type: "error", name: "SecurityRegistryWrongLoanStatus", inputs: [] },
  { type: "error", name: "SecurityRegistryWrongLot", inputs: [] },
  { type: "error", name: "SecurityRegistryWrongRecordStatus", inputs: [] },
  { type: "error", name: "SecurityRegistryZeroAddress", inputs: [] },
] as const;

export type EvmSecurityTermsShape = "terms15" | "terms12";

export const evmSecurityRegistryTerms12Abi = [
  {
    type: "function",
    name: "setTerms",
    inputs: [
      { name: "loanId", type: "uint256" },
      {
        name: "newTerms",
        type: "tuple",
        components: [
          { name: "advanceRatioBps", type: "uint32" },
          { name: "marginCallRatioBps", type: "uint32" },
          { name: "curePeriod", type: "uint64" },
          { name: "priceStaleAfter", type: "uint64" },
          { name: "paymentTerm", type: "uint8" },
          { name: "gracePeriod", type: "uint64" },
          { name: "defaultRate", type: "uint32" },
          { name: "attestationInterval", type: "uint64" },
          { name: "inspectionInterval", type: "uint64" },
          { name: "toleranceBps", type: "uint32" },
          { name: "gradeToleranceBps", type: "uint32" },
          { name: "marginCallAt", type: "uint64" },
        ],
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const evmSecurityRecordNftAbi = [
  {
    type: "function",
    name: "inspectors",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setInspectors",
    inputs: [{ name: "newInspectors", type: "address[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "SecurityRecordNftAlreadyApproved", inputs: [] },
  { type: "error", name: "SecurityRecordNftDirectCallOnly", inputs: [] },
  { type: "error", name: "SecurityRecordNftInvalidInspectionDate", inputs: [] },
  { type: "error", name: "SecurityRecordNftNonExistentInspection", inputs: [] },
  { type: "error", name: "SecurityRecordNftNonTransferable", inputs: [] },
  { type: "error", name: "SecurityRecordNftNotGoodsRecord", inputs: [] },
  { type: "error", name: "SecurityRecordNftNotInspector", inputs: [] },
  { type: "error", name: "SecurityRecordNftOnlySecurityRegistry", inputs: [] },
  { type: "error", name: "SecurityRecordNftSameOperator", inputs: [] },
  { type: "error", name: "SecurityRecordNftSameValue", inputs: [] },
  { type: "error", name: "SecurityRecordNftTooManyDocs", inputs: [] },
  { type: "error", name: "SecurityRecordNftTooManyInspections", inputs: [] },
  { type: "error", name: "SecurityRecordNftWrongRecordStatus", inputs: [] },
  { type: "error", name: "SecurityRecordNftZeroAddress", inputs: [] },
] as const;

const securityErrors = [
  ...evmSecurityRegistryAbi,
  ...evmSecurityRecordNftAbi,
].filter((item) => item.type === "error");

export const evmSecurityErrorAbi: Abi = securityErrors.filter(
  (item, index) =>
    securityErrors.findIndex((other) => other.name === item.name) === index,
);

export type EvmSecurityFn = Exclude<
  SecurityRegistryCall["fn"],
  "revalue" | "record_extension_consent"
>;

export const EVM_SECURITY_FUNCTION_NAMES: Readonly<
  Record<EvmSecurityFn, string>
> = {
  set_terms: "setTerms",
  resolve_flag: "resolveFlag",
  release_with_consent: "releaseWithConsent",
  set_inspectors: "setInspectors",
};

const U32_MAX = 0xffffffff;
const U64_MAX = 2n ** 64n - 1n;
const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]+$/;

function fail(what: string, value: unknown): never {
  throw new Error(
    `encodeEvmSecurityRegistryCalldata: invalid ${what} ${value}`,
  );
}

function idArg(value: number, what: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) fail(what, value);
  return BigInt(value);
}

function u32Arg(value: number | undefined, what: string): number {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > U32_MAX
  ) {
    fail(what, value);
  }
  return value;
}

function u64Arg(value: number | string, what: string): bigint {
  const text = typeof value === "number" ? String(value) : value;
  if (!DECIMAL.test(text) || BigInt(text) > U64_MAX) fail(what, value);
  return BigInt(text);
}

function hashArg(value: string, what: string): Hex {
  if (!HEX32.test(value)) fail(what, value);
  return `0x${value}`;
}

export function isEvmInspectorAddress(value: string): boolean {
  return isAddress(value);
}

export function normalizeEvmAddress(value: string): string {
  return getAddress(value);
}

function setTermsShapeRequired(
  termsShape: EvmSecurityTermsShape | undefined,
  who: string,
): EvmSecurityTermsShape {
  if (termsShape === undefined) {
    throw new Error(`${who}: termsShape is required for set_terms`);
  }
  return termsShape;
}

function evmSecurityItem(
  fn: EvmSecurityFn,
  termsShape?: EvmSecurityTermsShape,
): AbiFunction {
  const abi =
    fn === "set_inspectors"
      ? evmSecurityRecordNftAbi
      : fn === "set_terms" &&
          setTermsShapeRequired(termsShape, "evmSecuritySelector") === "terms12"
        ? evmSecurityRegistryTerms12Abi
        : evmSecurityRegistryAbi;
  const name = EVM_SECURITY_FUNCTION_NAMES[fn];
  const item = (abi as Abi).find(
    (entry): entry is AbiFunction =>
      entry.type === "function" && entry.name === name,
  );
  if (!item) throw new Error(`evmSecuritySelector: unknown function ${fn}`);
  return item;
}

export function evmSecuritySelector(
  fn: EvmSecurityFn,
  termsShape?: EvmSecurityTermsShape,
): Hex {
  return toFunctionSelector(evmSecurityItem(fn, termsShape));
}

export const EVM_SET_TERMS_SELECTORS: Readonly<
  Record<EvmSecurityTermsShape, Hex>
> = {
  terms15: evmSecuritySelector("set_terms", "terms15"),
  terms12: evmSecuritySelector("set_terms", "terms12"),
};

type SetTermsInput = Extract<
  SecurityRegistryCall,
  { fn: "set_terms" }
>["terms"];

function sharedTerms(terms: SetTermsInput) {
  const advanceRatioBps = u32Arg(terms.advanceRatioBps, "advanceRatioBps");
  const marginCallRatioBps = u32Arg(
    terms.marginCallRatioBps,
    "marginCallRatioBps",
  );
  if (marginCallRatioBps < advanceRatioBps) {
    fail("marginCallRatioBps (below advanceRatioBps)", marginCallRatioBps);
  }
  const paymentTerm = SECURITY_PAYMENT_TERMS.indexOf(terms.paymentTerm);
  if (paymentTerm < 0) fail("paymentTerm", terms.paymentTerm);
  return {
    advanceRatioBps,
    marginCallRatioBps,
    curePeriod: u64Arg(terms.curePeriod, "curePeriod"),
    priceStaleAfter: u64Arg(terms.priceStaleAfter, "priceStaleAfter"),
    paymentTerm,
    gracePeriod: u64Arg(terms.gracePeriod, "gracePeriod"),
    defaultRate: u32Arg(terms.defaultRate, "defaultRate"),
    attestationInterval: u64Arg(
      terms.attestationInterval,
      "attestationInterval",
    ),
    inspectionInterval: u64Arg(terms.inspectionInterval, "inspectionInterval"),
    toleranceBps: u32Arg(terms.toleranceBps, "toleranceBps"),
    gradeToleranceBps: u32Arg(terms.gradeToleranceBps, "gradeToleranceBps"),
    marginCallAt: 0n,
  };
}

function encodeTerms15(terms: SetTermsInput) {
  const defaultRatioBps = u32Arg(terms.defaultRatioBps, "defaultRatioBps");
  const originatorFeeRate = u32Arg(
    terms.originatorFeeRate,
    "originatorFeeRate",
  );
  const shared = sharedTerms(terms);
  if (defaultRatioBps < shared.marginCallRatioBps) {
    fail("defaultRatioBps (below marginCallRatioBps)", defaultRatioBps);
  }
  return { ...shared, defaultRatioBps, originatorFeeRate, defaultBreachAt: 0n };
}

function encodeTerms12(terms: SetTermsInput) {
  if (terms.defaultRatioBps !== undefined) {
    fail(
      "defaultRatioBps (absent on this SecurityRegistry build)",
      terms.defaultRatioBps,
    );
  }
  if (terms.originatorFeeRate !== undefined) {
    fail(
      "originatorFeeRate (absent on this SecurityRegistry build)",
      terms.originatorFeeRate,
    );
  }
  return sharedTerms(terms);
}

export function encodeEvmSecurityRegistryCalldata(
  call: SecurityRegistryCall,
  termsShape?: EvmSecurityTermsShape,
): Hex {
  switch (call.fn) {
    case "set_terms": {
      const loanId = idArg(call.loanId, "loanId");
      return setTermsShapeRequired(
        termsShape,
        "encodeEvmSecurityRegistryCalldata",
      ) === "terms12"
        ? encodeFunctionData({
            abi: evmSecurityRegistryTerms12Abi,
            functionName: "setTerms",
            args: [loanId, encodeTerms12(call.terms)],
          })
        : encodeFunctionData({
            abi: evmSecurityRegistryAbi,
            functionName: "setTerms",
            args: [loanId, encodeTerms15(call.terms)],
          });
    }
    case "resolve_flag": {
      const outcome = FLAG_OUTCOMES.indexOf(call.outcome);
      if (outcome < 0) fail("outcome", call.outcome);
      return encodeFunctionData({
        abi: evmSecurityRegistryAbi,
        functionName: "resolveFlag",
        args: [
          idArg(call.recordId, "recordId"),
          outcome,
          hashArg(call.reasonHash, "reasonHash"),
        ],
      });
    }
    case "release_with_consent":
      return encodeFunctionData({
        abi: evmSecurityRegistryAbi,
        functionName: "releaseWithConsent",
        args: [
          idArg(call.recordId, "recordId"),
          hashArg(call.consentHash, "consentHash"),
        ],
      });
    case "set_inspectors": {
      const seen = new Set<string>();
      for (const inspector of call.inspectors) {
        if (!isEvmInspectorAddress(inspector)) fail("inspector", inspector);
        const key = inspector.toLowerCase();
        if (seen.has(key)) fail("duplicate inspector", inspector);
        seen.add(key);
      }
      return encodeFunctionData({
        abi: evmSecurityRecordNftAbi,
        functionName: "setInspectors",
        args: [call.inspectors.map((inspector) => getAddress(inspector))],
      });
    }
    default:
      throw new Error("encodeEvmSecurityRegistryCalldata: unknown function");
  }
}

export interface EvmSecurityAddresses {
  registry: string;
  recordNft: string;
}

export function evmSecurityTarget(
  fn: SecurityRegistryCall["fn"],
  { registry, recordNft }: EvmSecurityAddresses,
): string {
  return fn === "set_inspectors" ? recordNft : registry;
}

export interface EvmSecurityCallParams extends EvmSecurityAddresses {
  call: SecurityRegistryCall;
  termsShape?: EvmSecurityTermsShape;
  accessManager: string;
  caller: string;
}

export interface RelayEvmSecurityRegistryParams extends EvmSecurityCallParams {
  mode: RelayMode;
  chainId: number;
  onStageChange?: (stage: RelayStage) => void;
}

export function relayEvmSecurityRegistry({
  call,
  registry,
  recordNft,
  termsShape,
  ...rest
}: RelayEvmSecurityRegistryParams): Promise<RelayResult> {
  return relayEvm({
    ...rest,
    target: evmSecurityTarget(call.fn, { registry, recordNft }),
    data: encodeEvmSecurityRegistryCalldata(call, termsShape),
    errorAbi: evmSecurityErrorAbi,
  });
}

export function readEvmSecurityRegistrySchedule({
  call,
  registry,
  recordNft,
  termsShape,
  ...rest
}: EvmSecurityCallParams): Promise<OperationSchedule> {
  return readEvmOperationSchedule({
    ...rest,
    target: evmSecurityTarget(call.fn, { registry, recordNft }),
    data: encodeEvmSecurityRegistryCalldata(call, termsShape),
  });
}

export async function readEvmSecurityInspectors({
  recordNft,
}: {
  recordNft: string;
}): Promise<string[]> {
  requireAddress("readEvmSecurityInspectors", "recordNft", recordNft);
  const inspectors = await readEvmContract<readonly string[]>({
    abi: evmSecurityRecordNftAbi,
    address: recordNft as Address,
    functionName: "inspectors",
  });
  return inspectors.map((inspector) => getAddress(inspector));
}

export function evmSecurityTermsShapeFromCode(
  code: Hex,
): EvmSecurityTermsShape {
  const hex = code.startsWith("0x") ? code.slice(2) : code;
  const selectors = new Set<string>();
  let i = 0;
  while (i + 2 <= hex.length) {
    const op = parseInt(hex.slice(i, i + 2), 16);
    i += 2;
    if (op < 0x60 || op > 0x7f) continue;
    const size = op - 0x5f;
    if (op === 0x63 && i + 8 <= hex.length) {
      selectors.add(`0x${hex.slice(i, i + 8).toLowerCase()}`);
    }
    i += size * 2;
  }
  const has15 = selectors.has(EVM_SET_TERMS_SELECTORS.terms15);
  const has12 = selectors.has(EVM_SET_TERMS_SELECTORS.terms12);
  if (has15 === has12) {
    throw new Error(
      `Unrecognised SecurityRegistry build: setTerms selector neither ${EVM_SET_TERMS_SELECTORS.terms15} nor ${EVM_SET_TERMS_SELECTORS.terms12} (or both)`,
    );
  }
  return has15 ? "terms15" : "terms12";
}

export async function readEvmSecurityTermsShape({
  registry,
}: {
  registry: string;
}): Promise<EvmSecurityTermsShape> {
  if (!registry) {
    throw new Error("readEvmSecurityTermsShape: registry must not be empty");
  }
  if (!isAddress(registry)) {
    throw new Error(`readEvmSecurityTermsShape: invalid registry ${registry}`);
  }
  return evmSecurityTermsShapeFromCode(await readEvmContractCode(registry));
}
