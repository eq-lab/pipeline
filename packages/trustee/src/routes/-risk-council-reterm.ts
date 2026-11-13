// spec: docs/frontend/trustee-flows.md#risk-council-actions
import { useState } from "react";
import { riskCouncilReasonHash } from "@pipeline/wallet-connect";
import { dateInputToUnixUtc, formatMaturityDate } from "@/utils/formatDate";
import { formatBpsRate } from "@/utils/formatUsd";
import { percentToBps } from "@/utils/rateUnits";
import { usdInputToSacBaseUnits } from "@/utils/stellarSacUnits";
import type { RiskCouncilCall } from "@/api/useRiskCouncil";
import { useLoanSecurity } from "@/api/useLoanSecurity";
import { buildSecurityCard, ltvRowText } from "./-loanSecurity";
import { formatChainAmount } from "./-repayment-recovery";
import {
  amendEligibility,
  formatLoanLabel,
  formatSignedChainAmount,
  notAvailableNote,
  useRiskCouncilActionView,
  useRiskCouncilLoanBase,
  useTextHash,
  type ActionView,
  type PageState,
} from "./-risk-council-shared";

export const AMEND_NO_ROLE =
  "Changing loan economics belongs to the Risk Council.";

export function parseSignedUsdDelta(input: string): string | null {
  const trimmed = input.trim();
  const negative = trimmed.startsWith("-");
  const base = usdInputToSacBaseUnits(negative ? trimmed.slice(1) : trimmed);
  if (base == null) return null;
  return negative ? `-${base}` : base;
}

export function buildAmendCall(
  loanId: number | null,
  ratePercent: string,
  maturityDate: string,
): RiskCouncilCall | null {
  const rateBps = percentToBps(ratePercent);
  const maturity = dateInputToUnixUtc(maturityDate);
  if (loanId === null || rateBps === null || maturity === null) return null;
  return { fn: "amend_economics", loanId, rateBps, maturity };
}

export function buildAdjustCall(
  loanId: number | null,
  deltaUsd: string,
  reasonHash: string | null,
): RiskCouncilCall | null {
  const delta = parseSignedUsdDelta(deltaUsd);
  if (loanId === null || delta === null || reasonHash === null) return null;
  return { fn: "adjust_interest", loanId, delta, reasonHash };
}

export interface RetermCurrentTerms {
  loan: string;
  coupon: string;
  maturity: string;
  ltv: string | null;
  accruedInterest: string;
  interestAdjustment: string;
}

export interface AmendFormView {
  ratePercent: string;
  setRatePercent: (value: string) => void;
  maturityDate: string;
  setMaturityDate: (value: string) => void;
  bps: number | null;
  rateInvalid: boolean;
  action: ActionView;
}

export interface AdjustFormView {
  deltaUsd: string;
  setDeltaUsd: (value: string) => void;
  deltaInvalid: boolean;
  reason: string;
  setReason: (value: string) => void;
  reasonHash: string | null;
  action: ActionView;
}

export interface RiskCouncilRetermView {
  state: PageState;
  errorMessage: string | null;
  errorDetails: string | null;
  loanId: string;
  current: RetermCurrentTerms;
  eligibilityNote: string | null;
  amend: AmendFormView;
  adjust: AdjustFormView;
}

function useReasonHash(reason: string): string | null {
  return useTextHash(reason, riskCouncilReasonHash);
}

export function useRiskCouncilReterm(
  chainId: number,
  loanIdParam: string,
): RiskCouncilRetermView {
  const base = useRiskCouncilLoanBase(chainId, loanIdParam);
  const security = useLoanSecurity(chainId, loanIdParam);
  const [ratePercent, setRatePercent] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [deltaUsd, setDeltaUsd] = useState("");
  const [reason, setReason] = useState("");
  const reasonHash = useReasonHash(reason);

  const bps = percentToBps(ratePercent);
  const eligible = amendEligibility(base.chainStatus);
  const amendCall = buildAmendCall(base.loanId, ratePercent, maturityDate);
  const adjustCall = buildAdjustCall(base.loanId, deltaUsd, reasonHash);

  const amend = useRiskCouncilActionView({
    chainId,
    call: amendCall,
    fn: "amend_economics",
    noRoleCopy: AMEND_NO_ROLE,
    labels: {
      now: "Amend economics",
      schedule: "Schedule amendment",
      execute: "Execute amendment",
    },
    enabled: eligible,
  });
  const adjust = useRiskCouncilActionView({
    chainId,
    call: adjustCall,
    fn: "adjust_interest",
    noRoleCopy: AMEND_NO_ROLE,
    labels: {
      now: "Adjust interest",
      schedule: "Schedule adjustment",
      execute: "Execute adjustment",
    },
    enabled: eligible,
  });

  const entry = base.entry;
  const chain = base.chainState?.chain;
  const money = base.chainState?.money;

  return {
    state: base.state,
    errorMessage: base.errorMessage,
    errorDetails: base.errorDetails,
    loanId: loanIdParam,
    current: {
      loan: formatLoanLabel(entry?.originator, entry?.commodity),
      coupon: chain == null ? "—" : formatBpsRate(chain.currentRate / 100),
      maturity: chain == null ? "—" : formatMaturityDate(chain.currentMaturity),
      ltv: ltvRowText(buildSecurityCard(security), security.data),
      accruedInterest:
        money == null ? "—" : formatChainAmount(money.accruedInterest, chainId),
      interestAdjustment:
        chain == null
          ? "—"
          : formatSignedChainAmount(chain.interestAdjustment, chainId),
    },
    eligibilityNote: notAvailableNote(base.chainStatus),
    amend: {
      ratePercent,
      setRatePercent,
      maturityDate,
      setMaturityDate,
      bps,
      rateInvalid: ratePercent.trim() !== "" && bps === null,
      action: amend,
    },
    adjust: {
      deltaUsd,
      setDeltaUsd,
      deltaInvalid:
        deltaUsd.trim() !== "" && parseSignedUsdDelta(deltaUsd) === null,
      reason,
      setReason,
      reasonHash,
      action: adjust,
    },
  };
}
