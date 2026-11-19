// spec: docs/frontend/trustee-flows.md#risk-council-security-actions
import { useState } from "react";
import {
  FLAG_OUTCOMES,
  SECURITY_PAYMENT_TERMS,
  securityReasonHash,
  type EvmSecurityTermsShape,
  type FlagOutcome,
  type SecurityPaymentTerm,
  type SecurityRegistryCall,
  type SecurityTermsInput,
} from "@pipeline/wallet-connect";
import { useEvmSecurityTermsShape } from "@/api/useRiskCouncil";
import {
  useLoanSecurity,
  type LoanSecurityInspection,
  type LoanSecurityRecord,
  type LoanSecurityTerms,
} from "@/api/useLoanSecurity";
import {
  bpsToPercentText,
  defaultRateToPercentText,
  durationToSeconds,
  percentToBpsStrict,
  percentToDefaultRate,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  secondsToUnitText,
} from "@/utils/securityTermsUnits";
import { isStellarTarget, riskCouncilTargetId } from "@/lib/targetChains";
import { toUserError, type UserFacingError } from "@/utils/userError";
import { buildSecurityCard, ltvRowText } from "./-loanSecurity";
import {
  PENDING_PAUSED,
  recordNumberOf,
  SET_TERMS_PENDING_NOTICE,
  useLoanPendingOps,
  type PendingOpItem,
} from "./-risk-council-pending";
import { formatTermsRows, PAYMENT_TERM_LABELS } from "./-risk-council-terms";
import {
  formatLoanLabel,
  useRiskCouncilActionView,
  useRiskCouncilLoanBase,
  useTextHash,
  type ActionView,
  type LabelValue,
  type PageState,
} from "./-risk-council-shared";

export const SECURITY_TERMS_NO_ROLE =
  "Setting security terms belongs to the Risk Council.";
export const SECURITY_FLAG_NO_ROLE =
  "Settling an inspection flag belongs to the Risk Council.";
export const SECURITY_RELEASE_NO_ROLE =
  "Releasing a record with the lenders' consent belongs to the Risk Council.";
export const NO_SECURITY_TERMS = "No security terms are set for this loan.";
export const NO_FLAGGED_RECORDS = "No flagged records.";
export const NO_OPEN_RECORDS = "No open records.";
export const SECURITY_PAUSED_NOTE = PENDING_PAUSED;
export const REFRESH_PENDING_NOTE =
  "Served state is refreshing after a recent change. It can lag by up to a minute.";
export const RELEASE_WARNING =
  "Releasing burns the record NFT. This cannot be undone.";

export const OUTCOME_EFFECTS: Record<FlagOutcome, string> = {
  Accepted:
    "The variance is explained: the flagging inspection's quantity and grade become the record's reference. Clears the flag.",
  TopUpRequired:
    "Opens a margin call if LTV is above the advance ratio. Clears the flag.",
  Escalated: "Suspected fraud or missing goods. The flag stays.",
};

export { formatTermsRows, PAYMENT_TERM_LABELS };

export function releaseConfirmText(recordId: string): string {
  return `Release record #${recordId}? This burns the record NFT and cannot be undone.`;
}

export const RELEASE_CONFIRM_GENERIC =
  "Release this record? This burns the record NFT and cannot be undone.";

export function pendingConfirmText(item: PendingOpItem): string | undefined {
  if (item.fn !== "release_with_consent") return undefined;
  const record = recordNumberOf(item);
  return record === null
    ? RELEASE_CONFIRM_GENERIC
    : releaseConfirmText(String(record));
}

export type TermsFieldKey =
  | "advanceRatio"
  | "marginCallRatio"
  | "defaultRatio"
  | "curePeriod"
  | "priceStaleAfter"
  | "gracePeriod"
  | "defaultRate"
  | "originatorFeeRate"
  | "attestationInterval"
  | "inspectionInterval"
  | "tolerance"
  | "gradeTolerance";

export interface TermsFormValues extends Record<TermsFieldKey, string> {
  paymentTerm: SecurityPaymentTerm | "";
}

export interface TermsFieldSpec {
  key: TermsFieldKey;
  label: string;
  placeholder: string;
}

const STELLAR_TERMS_FIELDS: ReadonlyArray<TermsFieldSpec> = [
  { key: "advanceRatio", label: "Advance ratio (%)", placeholder: "e.g. 70" },
  {
    key: "marginCallRatio",
    label: "Margin call ratio (%)",
    placeholder: "e.g. 80",
  },
  { key: "curePeriod", label: "Cure period (days)", placeholder: "e.g. 7" },
  {
    key: "priceStaleAfter",
    label: "Price stale after (hours, 0 = no limit)",
    placeholder: "e.g. 24",
  },
  { key: "gracePeriod", label: "Grace period (days)", placeholder: "e.g. 3" },
  {
    key: "defaultRate",
    label: "Default rate (%)",
    placeholder: "e.g. 2",
  },
  {
    key: "attestationInterval",
    label: "Attestation interval (days, 0 = off)",
    placeholder: "e.g. 30",
  },
  {
    key: "inspectionInterval",
    label: "Inspection interval (days, 0 = off)",
    placeholder: "e.g. 30",
  },
  {
    key: "tolerance",
    label: "Quantity tolerance (%)",
    placeholder: "e.g. 0.5",
  },
  {
    key: "gradeTolerance",
    label: "Grade tolerance (%)",
    placeholder: "e.g. 0.25",
  },
];

const DEFAULT_RATIO_FIELD: TermsFieldSpec = {
  key: "defaultRatio",
  label: "Default ratio (%)",
  placeholder: "e.g. 90",
};

const ORIGINATOR_FEE_FIELD: TermsFieldSpec = {
  key: "originatorFeeRate",
  label: "Originator fee rate (%)",
  placeholder: "e.g. 1",
};

function evmTermsExtras(
  chainId: number | null | undefined,
  termsShape: EvmSecurityTermsShape | null,
): boolean {
  return !isStellarTarget(chainId) && termsShape === "terms15";
}

export function termsFieldsFor(
  chainId: number | null | undefined,
  termsShape: EvmSecurityTermsShape | null,
): ReadonlyArray<TermsFieldSpec> {
  if (!evmTermsExtras(chainId, termsShape)) return STELLAR_TERMS_FIELDS;
  return STELLAR_TERMS_FIELDS.flatMap((field) =>
    field.key === "marginCallRatio"
      ? [field, DEFAULT_RATIO_FIELD]
      : field.key === "defaultRate"
        ? [field, ORIGINATOR_FEE_FIELD]
        : [field],
  );
}

const EMPTY_TERMS_FORM: TermsFormValues = {
  advanceRatio: "",
  marginCallRatio: "",
  defaultRatio: "",
  curePeriod: "",
  priceStaleAfter: "",
  gracePeriod: "",
  defaultRate: "",
  originatorFeeRate: "",
  attestationInterval: "",
  inspectionInterval: "",
  tolerance: "",
  gradeTolerance: "",
  paymentTerm: "",
};

function durationPrefill(
  seconds: string | undefined,
  unitSeconds: number,
): string {
  return seconds == null ? "" : (secondsToUnitText(seconds, unitSeconds) ?? "");
}

export function prefillTermsForm(
  terms: LoanSecurityTerms | null | undefined,
): TermsFormValues {
  if (terms == null) return EMPTY_TERMS_FORM;
  const bps = (value: number | undefined) =>
    value == null ? "" : bpsToPercentText(value);
  const term = SECURITY_PAYMENT_TERMS.find((t) => t === terms.payment_term);
  return {
    advanceRatio: bps(terms.advance_ratio_bps),
    marginCallRatio: bps(terms.margin_call_ratio_bps),
    defaultRatio: bps(terms.default_ratio_bps ?? undefined),
    curePeriod: durationPrefill(terms.cure_period, SECONDS_PER_DAY),
    priceStaleAfter: durationPrefill(terms.price_stale_after, SECONDS_PER_HOUR),
    gracePeriod: durationPrefill(terms.grace_period, SECONDS_PER_DAY),
    defaultRate:
      terms.default_rate == null
        ? ""
        : defaultRateToPercentText(terms.default_rate),
    originatorFeeRate:
      terms.originator_fee_rate == null
        ? ""
        : defaultRateToPercentText(terms.originator_fee_rate),
    attestationInterval: durationPrefill(
      terms.attestation_interval,
      SECONDS_PER_DAY,
    ),
    inspectionInterval: durationPrefill(
      terms.inspection_interval,
      SECONDS_PER_DAY,
    ),
    tolerance: bps(terms.tolerance_bps),
    gradeTolerance: bps(terms.grade_tolerance_bps),
    paymentTerm: term ?? "",
  };
}

interface ParsedTerms {
  advanceRatioBps: number | null;
  marginCallRatioBps: number | null;
  defaultRatioBps: number | null;
  curePeriod: string | null;
  priceStaleAfter: string | null;
  gracePeriod: string | null;
  defaultRate: number | null;
  originatorFeeRate: number | null;
  attestationInterval: string | null;
  inspectionInterval: string | null;
  toleranceBps: number | null;
  gradeToleranceBps: number | null;
}

export function parseTermsForm(values: TermsFormValues): ParsedTerms {
  return {
    advanceRatioBps: percentToBpsStrict(values.advanceRatio),
    marginCallRatioBps: percentToBpsStrict(values.marginCallRatio),
    defaultRatioBps: percentToBpsStrict(values.defaultRatio),
    curePeriod: durationToSeconds(values.curePeriod, SECONDS_PER_DAY),
    priceStaleAfter: durationToSeconds(
      values.priceStaleAfter,
      SECONDS_PER_HOUR,
    ),
    gracePeriod: durationToSeconds(values.gracePeriod, SECONDS_PER_DAY),
    defaultRate: percentToDefaultRate(values.defaultRate),
    originatorFeeRate: percentToDefaultRate(values.originatorFeeRate),
    attestationInterval: durationToSeconds(
      values.attestationInterval,
      SECONDS_PER_DAY,
    ),
    inspectionInterval: durationToSeconds(
      values.inspectionInterval,
      SECONDS_PER_DAY,
    ),
    toleranceBps: percentToBpsStrict(values.tolerance),
    gradeToleranceBps: percentToBpsStrict(values.gradeTolerance),
  };
}

export const RATIO_ORDER_ERROR =
  "The margin call ratio must be at least the advance ratio.";

export function ratioOrderInvalid(parsed: ParsedTerms): boolean {
  return (
    parsed.advanceRatioBps !== null &&
    parsed.marginCallRatioBps !== null &&
    parsed.marginCallRatioBps < parsed.advanceRatioBps
  );
}

export const DEFAULT_RATIO_ORDER_ERROR =
  "The default ratio must be at least the margin call ratio.";

export function defaultRatioOrderInvalid(parsed: ParsedTerms): boolean {
  return (
    parsed.defaultRatioBps !== null &&
    parsed.marginCallRatioBps !== null &&
    parsed.defaultRatioBps < parsed.marginCallRatioBps
  );
}

export function ratioOrderErrorFor(
  parsed: ParsedTerms,
  chainId: number | null | undefined,
  termsShape: EvmSecurityTermsShape | null,
): string | null {
  if (ratioOrderInvalid(parsed)) return RATIO_ORDER_ERROR;
  return evmTermsExtras(chainId, termsShape) && defaultRatioOrderInvalid(parsed)
    ? DEFAULT_RATIO_ORDER_ERROR
    : null;
}

export function buildSetTermsCall(
  loanId: number | null,
  values: TermsFormValues,
  chainId: number | null | undefined,
  termsShape: EvmSecurityTermsShape | null,
): SecurityRegistryCall | null {
  const p = parseTermsForm(values);
  if (!isStellarTarget(chainId) && termsShape === null) return null;
  const evm = evmTermsExtras(chainId, termsShape);
  if (
    evm &&
    (p.defaultRatioBps === null ||
      p.originatorFeeRate === null ||
      defaultRatioOrderInvalid(p))
  ) {
    return null;
  }
  if (
    loanId === null ||
    values.paymentTerm === "" ||
    p.advanceRatioBps === null ||
    p.marginCallRatioBps === null ||
    p.curePeriod === null ||
    p.priceStaleAfter === null ||
    p.gracePeriod === null ||
    p.defaultRate === null ||
    p.attestationInterval === null ||
    p.inspectionInterval === null ||
    p.toleranceBps === null ||
    p.gradeToleranceBps === null ||
    ratioOrderInvalid(p)
  ) {
    return null;
  }
  const terms: SecurityTermsInput = {
    advanceRatioBps: p.advanceRatioBps,
    marginCallRatioBps: p.marginCallRatioBps,
    curePeriod: p.curePeriod,
    priceStaleAfter: p.priceStaleAfter,
    paymentTerm: values.paymentTerm,
    gracePeriod: p.gracePeriod,
    defaultRate: p.defaultRate,
    attestationInterval: p.attestationInterval,
    inspectionInterval: p.inspectionInterval,
    toleranceBps: p.toleranceBps,
    gradeToleranceBps: p.gradeToleranceBps,
    ...(evm
      ? {
          defaultRatioBps: p.defaultRatioBps ?? undefined,
          originatorFeeRate: p.originatorFeeRate ?? undefined,
        }
      : {}),
  };
  return { fn: "set_terms", loanId, terms };
}

export function termsFieldEcho(
  key: TermsFieldKey,
  values: TermsFormValues,
): { echo: string | null; invalid: boolean } {
  const raw = values[key];
  if (raw.trim() === "") return { echo: null, invalid: false };
  const p = parseTermsForm(values);
  const bps: Partial<Record<TermsFieldKey, number | null>> = {
    advanceRatio: p.advanceRatioBps,
    marginCallRatio: p.marginCallRatioBps,
    defaultRatio: p.defaultRatioBps,
    tolerance: p.toleranceBps,
    gradeTolerance: p.gradeToleranceBps,
  };
  const seconds: Partial<Record<TermsFieldKey, string | null>> = {
    curePeriod: p.curePeriod,
    priceStaleAfter: p.priceStaleAfter,
    gracePeriod: p.gracePeriod,
    attestationInterval: p.attestationInterval,
    inspectionInterval: p.inspectionInterval,
  };
  if (key in bps) {
    const value = bps[key] ?? null;
    return {
      echo: value === null ? null : `= ${value} bps`,
      invalid: value === null,
    };
  }
  if (key === "defaultRate" || key === "originatorFeeRate") {
    const rate = key === "defaultRate" ? p.defaultRate : p.originatorFeeRate;
    return {
      echo: rate === null ? null : `= ${rate} (1e6 scale)`,
      invalid: rate === null,
    };
  }
  const value = seconds[key] ?? null;
  return {
    echo: value === null ? null : `= ${value} s`,
    invalid: value === null,
  };
}

export interface FlaggedRecordRow {
  recordId: string;
  recordNumber: number | null;
  protection: string;
  lot: string;
  commodity: string;
  flag: LabelValue[];
}

export interface OpenRecordOption {
  recordId: string;
  label: string;
}

function dash(value: string | number | null | undefined): string {
  return value == null || value === "" ? "—" : String(value);
}

function variance(bps: number | null | undefined): string {
  return bps == null ? "—" : `${bps} bps`;
}

export function flaggingInspection(
  record: LoanSecurityRecord,
): LoanSecurityInspection | null {
  if (record.flagged_by == null) return null;
  return (
    (record.inspections ?? []).find(
      (i) => i.inspection_id === record.flagged_by,
    ) ?? null
  );
}

function recordNumber(recordId: string): number | null {
  return /^\d+$/.test(recordId) ? Number(recordId) : null;
}

export function flaggedRows(
  records: ReadonlyArray<LoanSecurityRecord> | undefined,
): FlaggedRecordRow[] {
  return (records ?? [])
    .filter((r) => r.flagged_by != null && r.record_id != null)
    .map((r) => {
      const recordId = r.record_id as string;
      const inspection = flaggingInspection(r);
      return {
        recordId,
        recordNumber: recordNumber(recordId),
        protection: dash(r.protection),
        lot: dash(r.lot_id),
        commodity: dash(r.commodity),
        flag: [
          { label: "Flagged by", value: dash(r.flagged_by) },
          { label: "Inspection kind", value: dash(inspection?.kind) },
          { label: "Inspector", value: dash(inspection?.inspector) },
          { label: "Quantity", value: dash(inspection?.quantity) },
          { label: "Grade", value: dash(inspection?.grade) },
          {
            label: "Variance vs reference",
            value: variance(inspection?.variance_reference_bps),
          },
          {
            label: "Variance vs previous",
            value: variance(inspection?.variance_previous_bps),
          },
          {
            label: "Grade variance",
            value: variance(inspection?.variance_grade_bps),
          },
        ],
      };
    });
}

export function openRecordOptions(
  records: ReadonlyArray<LoanSecurityRecord> | undefined,
): OpenRecordOption[] {
  return (records ?? [])
    .filter((r) => r.open === true && r.record_id != null)
    .map((r) => ({
      recordId: r.record_id as string,
      label: `#${r.record_id} — ${dash(r.protection)}, ${dash(r.commodity)}, lot ${dash(r.lot_id)} (${dash(r.status)})`,
    }));
}

export function buildResolveFlagCall(
  recordNumber: number | null,
  outcome: FlagOutcome,
  reasonHash: string | null,
): SecurityRegistryCall | null {
  if (recordNumber === null || reasonHash === null) return null;
  return { fn: "resolve_flag", recordId: recordNumber, outcome, reasonHash };
}

export function buildReleaseCall(
  recordId: string,
  consentHash: string | null,
): SecurityRegistryCall | null {
  const id = recordNumber(recordId);
  if (id === null || consentHash === null) return null;
  return { fn: "release_with_consent", recordId: id, consentHash };
}

export interface TermsShapeView {
  loading: boolean;
  error: UserFacingError | null;
  retry: () => void;
}

export const TERMS_SHAPE_LOADING = "Checking the SecurityRegistry build…";
export const TERMS_SHAPE_ERROR =
  "Could not identify the SecurityRegistry build — Set terms is unavailable.";

export interface SetTermsFormView {
  values: TermsFormValues;
  setField: (key: TermsFieldKey, value: string) => void;
  setPaymentTerm: (value: SecurityPaymentTerm | "") => void;
  echoes: Record<TermsFieldKey, { echo: string | null; invalid: boolean }>;
  termsFields: ReadonlyArray<TermsFieldSpec>;
  shape: TermsShapeView;
  ratioOrderError: string | null;
  pendingNotice: string | null;
  action: ActionView;
}

export interface ReleaseFormView {
  options: OpenRecordOption[];
  selected: string;
  setSelected: (recordId: string) => void;
  consent: string;
  setConsent: (value: string) => void;
  consentHash: string | null;
  confirmText: string | null;
  action: ActionView;
}

export interface RiskCouncilSecurityView {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  loanLabel: string;
  ltv: string | null;
  termsRows: LabelValue[];
  hasTerms: boolean;
  paused: boolean;
  pausedNote: string | null;
  refreshNote: string | null;
  securityLoading: boolean;
  securityError: UserFacingError | null;
  flagged: FlaggedRecordRow[];
  pending: PendingOpItem[];
  expectedTarget: string;
  setTerms: SetTermsFormView;
  release: ReleaseFormView;
  chainId: number;
  loanNumber: number | null;
  executeGate: string | null;
}

export function useRiskCouncilSecurity(
  chainId: number,
  loanIdParam: string,
): RiskCouncilSecurityView {
  const base = useRiskCouncilLoanBase(chainId, loanIdParam);
  const security = useLoanSecurity(chainId, loanIdParam);
  const served = security.data;
  const executeGate = served?.paused === true ? SECURITY_PAUSED_NOTE : null;

  const pending = useLoanPendingOps({
    chainId,
    loanId: base.loanId,
    entry: base.entry,
    extraServed: served?.pending_operations,
    extraFetchedAt: security.dataUpdatedAt,
  });
  const termsPending = pending.some(
    (item) =>
      item.fn === "set_terms" &&
      item.executed === null &&
      (item.state === "waiting" || item.state === "ready"),
  );

  const [overrides, setOverrides] = useState<Partial<TermsFormValues>>({});
  const prefill = prefillTermsForm(served?.terms);
  const values: TermsFormValues = { ...prefill, ...overrides };
  const shapeQuery = useEvmSecurityTermsShape(chainId);
  const termsShape = shapeQuery.data ?? null;
  const shapeError =
    shapeQuery.error && termsShape === null
      ? {
          ...toUserError(shapeQuery.error, TERMS_SHAPE_ERROR),
          message: TERMS_SHAPE_ERROR,
        }
      : null;
  const termsCall = buildSetTermsCall(base.loanId, values, chainId, termsShape);
  const termsFields = termsFieldsFor(chainId, termsShape);
  const parsed = parseTermsForm(values);

  const termsAction = useRiskCouncilActionView({
    chainId,
    call: termsCall,
    fn: "set_terms",
    noRoleCopy: SECURITY_TERMS_NO_ROLE,
    labels: {
      now: "Set terms",
      schedule: "Schedule terms",
      execute: "Execute terms",
    },
    enabled: true,
    executeGate,
    loanId: base.loanId ?? undefined,
  });

  const options = openRecordOptions(served?.records);
  const [picked, setPicked] = useState("");
  const selected = options.some((o) => o.recordId === picked) ? picked : "";
  const [consent, setConsent] = useState("");
  const consentHash = useTextHash(consent, securityReasonHash);
  const releaseCall = buildReleaseCall(selected, consentHash);
  const releaseAction = useRiskCouncilActionView({
    chainId,
    call: releaseCall,
    fn: "release_with_consent",
    noRoleCopy: SECURITY_RELEASE_NO_ROLE,
    labels: {
      now: "Release with consent",
      schedule: "Schedule release",
      execute: "Execute release",
    },
    enabled: selected !== "",
    executeGate,
    loanId: base.loanId ?? undefined,
    onExecuted: () => {
      setPicked("");
      setConsent("");
    },
  });

  const echoes = Object.fromEntries(
    termsFields.map(({ key }) => [key, termsFieldEcho(key, values)]),
  ) as SetTermsFormView["echoes"];

  return {
    state: base.state,
    errorMessage: base.errorMessage,
    errorDetails: base.errorDetails,
    loanId: loanIdParam,
    loanLabel: formatLoanLabel(base.entry?.originator, base.entry?.commodity),
    ltv: ltvRowText(buildSecurityCard(security), served),
    termsRows: formatTermsRows(served?.terms),
    hasTerms: served?.terms != null,
    paused: served?.paused === true,
    pausedNote: executeGate,
    refreshNote: served?.refresh_pending === true ? REFRESH_PENDING_NOTE : null,
    securityLoading: security.isLoading,
    securityError:
      security.error && security.data == null
        ? toUserError(security.error, "Failed to load the loan security.")
        : null,
    flagged: flaggedRows(served?.records),
    pending,
    expectedTarget: riskCouncilTargetId(chainId, "security_registry"),
    setTerms: {
      values,
      setField: (key, value) =>
        setOverrides((prev) => ({ ...prev, [key]: value })),
      setPaymentTerm: (value) =>
        setOverrides((prev) => ({ ...prev, paymentTerm: value })),
      echoes,
      termsFields,
      shape: {
        loading: shapeQuery.isLoading === true,
        error: shapeError,
        retry: () => void shapeQuery.refetch(),
      },
      ratioOrderError: ratioOrderErrorFor(parsed, chainId, termsShape),
      pendingNotice: termsPending ? SET_TERMS_PENDING_NOTICE : null,
      action: termsAction,
    },
    release: {
      options,
      selected,
      setSelected: setPicked,
      consent,
      setConsent,
      consentHash,
      confirmText: selected === "" ? null : releaseConfirmText(selected),
      action: releaseAction,
    },
    chainId,
    loanNumber: base.loanId,
    executeGate,
  };
}

export interface ResolveFlagFormView {
  outcome: FlagOutcome;
  setOutcome: (outcome: FlagOutcome) => void;
  reason: string;
  setReason: (value: string) => void;
  reasonHash: string | null;
  action: ActionView;
}

export function useResolveFlagForm({
  chainId,
  loanId,
  recordNumber,
  executeGate,
}: {
  chainId: number;
  loanId: number | null;
  recordNumber: number | null;
  executeGate: string | null;
}): ResolveFlagFormView {
  const [outcome, setOutcome] = useState<FlagOutcome>(FLAG_OUTCOMES[0]!);
  const [reason, setReason] = useState("");
  const reasonHash = useTextHash(reason, securityReasonHash);
  const call = buildResolveFlagCall(recordNumber, outcome, reasonHash);
  const action = useRiskCouncilActionView({
    chainId,
    call,
    fn: "resolve_flag",
    noRoleCopy: SECURITY_FLAG_NO_ROLE,
    labels: {
      now: "Resolve flag",
      schedule: "Schedule resolution",
      execute: "Execute resolution",
    },
    enabled: true,
    executeGate,
    loanId: loanId ?? undefined,
  });
  return { outcome, setOutcome, reason, setReason, reasonHash, action };
}
