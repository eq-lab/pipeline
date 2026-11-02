// spec: docs/product-specs/staking.md#default-pockets
import { useEffect, useRef } from "react";
import { useLoanBook } from "@/api";
import { formatTokenAmount } from "@/lib/format";
import { useToast } from "@/lib/toast";
import { toUserError, type UserFacingError } from "@/utils/userError";
import {
  SAC_DECIMALS,
  isPocketConfigured,
  useActiveChain,
  useEvmStakeDecimals,
  usePocketClaim,
  usePocketReads,
  useEvmWallet,
  useStellarWallet,
} from "@/wallet";

const TOAST_ID = "pocket-claim-tx";
const DASH = "—";

export interface PocketRowView {
  loanId: string;
  title: string;
  commodity: string;
  balance: string;
  claimable: string;
  claimed: string;
  canClaim: boolean;
  isClaiming: boolean;
  claim: () => void;
}

export interface DefaultPocketsCardView {
  visible: boolean;
  rows: PocketRowView[];
  error: UserFacingError | undefined;
}

function isPositive(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  try {
    return BigInt(raw) > 0n;
  } catch {
    return false;
  }
}

export function useDefaultPocketsCard(
  claimBlocked: boolean,
): DefaultPocketsCardView {
  const { kind, chainId } = useActiveChain();
  const stellar = useStellarWallet();
  const evm = useEvmWallet();
  const connected = kind === "stellar" ? stellar.isConnected : evm.isConnected;
  const holder = connected
    ? kind === "stellar"
      ? stellar.address
      : evm.address
    : undefined;
  const configured = isPocketConfigured(kind);

  const { data } = useLoanBook({ chainId });
  const candidates = (data?.loans ?? []).filter(
    (loan) => loan.status === "Default" || loan.status === "Closed",
  );
  const active = connected && configured;
  const loanIds = active ? candidates.map((loan) => loan.loan_id) : [];
  const reads = usePocketReads(kind, loanIds, holder);
  const claim = usePocketClaim(kind);
  const evmDecimals = useEvmStakeDecimals().plusd;
  const decimals = kind === "stellar" ? SAC_DECIMALS : evmDecimals;

  const toast = useToast();
  const claimableAtClick = useRef<string | undefined>(undefined);
  const prev = useRef({
    isPending: false,
    isSuccess: false,
    error: null as Error | null,
  });
  const { isPending, isSuccess, error, amountRaw } = claim;

  useEffect(() => {
    if (isPending && !prev.current.isPending) {
      toast.show({ id: TOAST_ID, tone: "pending", title: "Claiming…" });
    }
    if (isSuccess && !prev.current.isSuccess) {
      const raw = amountRaw ?? claimableAtClick.current;
      toast.update(TOAST_ID, {
        tone: "success",
        title:
          raw === undefined
            ? "Claimed"
            : `Claimed ${formatTokenAmount(raw, decimals)} PLUSD`,
      });
    }
    if (error && error !== prev.current.error) {
      const mapped = toUserError(error);
      toast.update(TOAST_ID, {
        tone: "danger",
        title: mapped.isSpecific ? mapped.message : "Claim failed",
      });
    }
    prev.current = { isPending, isSuccess, error };
  }, [isPending, isSuccess, error, amountRaw, decimals, toast]);

  const fmt = (raw: string | undefined) =>
    raw === undefined ? DASH : formatTokenAmount(raw, decimals);

  const rows: PocketRowView[] = candidates
    .filter((loan) => reads[loan.loan_id]?.exists !== false)
    .map((loan) => {
      const read = reads[loan.loan_id];
      const isClaiming = isPending && claim.loanId === loan.loan_id;
      return {
        loanId: loan.loan_id,
        title: `Loan #${loan.loan_id} · ${loan.borrower}`,
        commodity: loan.commodity,
        balance: fmt(read?.balanceRaw),
        claimable: fmt(read?.claimableRaw),
        claimed: fmt(read?.claimedRaw),
        canClaim: !claimBlocked && !isPending && isPositive(read?.claimableRaw),
        isClaiming,
        claim: () => {
          claimableAtClick.current = read?.claimableRaw;
          claim.claim(loan.loan_id);
        },
      };
    });

  return {
    visible: active && rows.length > 0,
    rows,
    error: error ? toUserError(error) : undefined,
  };
}
