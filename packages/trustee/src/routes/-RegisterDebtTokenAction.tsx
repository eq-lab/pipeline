// spec: docs/frontend/trustee-flows.md#register-debt-token-1766
import { InlineError } from "@pipeline/ui";
import { useStellarWallet } from "@pipeline/wallet-connect";
import {
  dealTokenConfigured,
  useDeal,
  useRegisterDeal,
  useRegisterDealAccess,
} from "@/api/useDealToken";
import { CardTitle } from "@/components/detail/DetailCard";
import {
  BRAND,
  CARD_CLASS,
  INK_MUTED,
  cardStyle,
} from "@/components/detail/detailTokens";
import {
  DEBT_TOKEN_NO_ROLE,
  debtTokenView,
  registerDealAccessReason,
  registerDealError,
} from "@/lib/dealToken";
import {
  accessAction,
  riskCouncilRoleLine,
  stageLabel,
} from "@/lib/accessManagerAction";

const BUTTON_CLASS =
  "inline-flex h-[40px] w-fit items-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-50";
const NOTE_CLASS =
  "font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]";

const IDLE_LABEL = {
  "execute-now": "Register debt token",
  schedule: "Schedule registration",
  "execute-scheduled": "Execute registration",
} as const;

export function RegisterDebtTokenAction({
  chainId,
  loanId,
  variant,
}: {
  chainId: number | null | undefined;
  loanId: number | null | undefined;
  variant: "card" | "inline";
}) {
  const { address, isConnected } = useStellarWallet();
  const deal = useDeal(chainId, loanId);
  const view = debtTokenView(chainId, dealTokenConfigured(), deal);
  const access = useRegisterDealAccess(loanId, view.kind === "unregistered");
  const register = useRegisterDeal();

  if (view.kind === "hidden") return null;
  if (view.kind === "registered") {
    return variant === "inline" ? (
      <p
        data-testid="register-debt-token-registered"
        className={`${NOTE_CLASS} break-all`}
        style={{ color: INK_MUTED }}
      >
        Debt token registered · {view.debt}
      </p>
    ) : null;
  }

  const action = accessAction(
    access.data?.canCall,
    access.data?.schedule ?? undefined,
  );
  const accessReason =
    view.kind === "blocked"
      ? view.reason
      : registerDealAccessReason({
          connected: isConnected && !!address,
          access: access.data?.canCall,
          isPending: access.isPending,
          isError: access.isError,
        });
  const mode =
    action === "schedule" ? "schedule" : ("execute" as "schedule" | "execute");
  const roleLine =
    view.kind === "unregistered" && accessReason === null
      ? riskCouncilRoleLine(
          action,
          access.data?.canCall.delay ?? null,
          access.data?.schedule?.readyAt ?? null,
          DEBT_TOKEN_NO_ROLE,
        )
      : null;
  const disabled =
    accessReason !== null ||
    action === null ||
    action === "no-role" ||
    register.isPending ||
    loanId == null;
  const idle =
    IDLE_LABEL[
      action === "no-role" || action === null ? "execute-now" : action
    ];
  const error = register.error ? registerDealError(mode, register.error) : null;

  const body = (
    <>
      <p className={NOTE_CLASS} style={{ color: INK_MUTED }}>
        This loan has no debt token yet. Registering it creates the on-chain
        token for the loan.
      </p>
      {(accessReason ?? roleLine) && (
        <p
          data-testid="register-debt-token-note"
          className={NOTE_CLASS}
          style={{ color: INK_MUTED }}
        >
          {accessReason ?? roleLine}
        </p>
      )}
      {view.kind === "unregistered" && (
        <button
          type="button"
          data-testid="register-debt-token-button"
          disabled={disabled}
          onClick={() => {
            if (loanId == null) return;
            register.reset();
            void register
              .mutateAsync({ mode, loanId, chainId })
              .catch(() => {});
          }}
          className={BUTTON_CLASS}
          style={{ backgroundColor: BRAND }}
        >
          {stageLabel(register.stage, idle)}
        </button>
      )}
      {error && (
        <div data-testid="register-debt-token-error">
          <InlineError
            message={error.message}
            details={error.details}
            className="block text-[14px]"
          />
        </div>
      )}
    </>
  );

  return variant === "card" ? (
    <div
      className={`${CARD_CLASS} gap-[16px] p-[26px]`}
      style={cardStyle()}
      data-testid="register-debt-token"
    >
      <CardTitle>Debt token</CardTitle>
      {body}
    </div>
  ) : (
    <div
      className="flex flex-col items-start gap-[10px]"
      data-testid="register-debt-token"
    >
      {body}
    </div>
  );
}
