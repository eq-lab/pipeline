import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CapitalAllocationCard } from "@/components/CapitalAllocationCard";
import {
  useCashManagement,
  type RampEventRow as RampEventRowData,
} from "./-cash-management";
import { formatFullUsd } from "@/utils/formatUsd";

/**
 * Cash Management (issue #943, Figma node `4116-11802` for styling) — replaces
 * the #786 placeholder. Source of truth: `docs/product-specs/trustee-dashboard.md`
 * (§Type 1 flow 2, §Type 4) + the Cash Management working doc.
 *
 * The **On/Off-ramp** tab has two parts:
 *   1. a **"New swap" button** that opens the doc's swap form in a modal
 *      (`SwapDialog`, Transak-style) — off/on-ramp toggle, USDC amount + real
 *      on-chain balance (`useCapitalWalletBalance`), bank-wire method, ramp
 *      destination (`GET /v1/ramp/addresses`), and a 1:1 receive summary. This is
 *      a UI shell: off-ramp execution is a Capital-Wallet MPC 3-of-5 transfer with
 *      no backend endpoint yet (#781), and there is no ramp-quote endpoint, so
 *      submit is disabled and the fee shows `—` (never fabricated).
 *   2. the **review queue** below it — the pending ramp-boundary events
 *      (`GET /v1/ramp/events`, #936) the Trustee Approves/Rejects
 *      (`POST …/review`), which is what actually moves the on-chain state.
 *
 * The **T-Bills** (#944) and **Withdrawal Queue** (#945) tabs are placeholders
 * here. (No Refunds tab — the working doc has no such section; docs are the
 * source of truth, Figma is styling only.)
 *
 * Per `docs/FRONTEND.md` rule 2, this `.tsx` is JSX/styling only; the fetch +
 * value→display mapping live in `-cash-management.ts`.
 */

const LINE_COLOR = "rgba(56, 55, 53, 0.18)";
const INK = "#262524";
const INK_MUTED = "rgba(56,55,53,0.6)";
const INK_SUBTLE = "rgba(56,55,53,0.3)";
const NEGATIVE_RED = "#b20000";
const POSITIVE_GREEN = "var(--color-pipeline-positive-primary)";
const BRAND = "var(--color-pipeline-brand)";

type TabKey = "onofframp" | "tbills" | "withdrawals";

const TABS: { key: TabKey; label: string }[] = [
  { key: "onofframp", label: "On / Off-ramp" },
  { key: "tbills", label: "T-Bills" },
  { key: "withdrawals", label: "Withdrawal Queue" },
];

const PLACEHOLDER_COPY: Record<Exclude<TabKey, "onofframp">, string> = {
  tbills: "Buy / Sell USYC — lands in #944.",
  withdrawals:
    "Withdrawal-queue balance, top-up alert, and MPC transfer — lands in #945.",
};

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <div
      data-testid="cash-management-tabs"
      className="flex flex-wrap items-center gap-[4px] rounded-[6px] p-[4px]"
      style={{ backgroundColor: "rgba(191,189,187,0.12)" }}
    >
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            type="button"
            data-testid={`cash-management-tab-${tab.key}`}
            aria-pressed={isActive}
            onClick={() => onChange(tab.key)}
            className="rounded-[4px] px-[14px] py-[7px] font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
            style={
              isActive
                ? {
                    backgroundColor: "#ffffff",
                    color: INK,
                    border: `1px solid ${LINE_COLOR}`,
                  }
                : { color: INK_MUTED }
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ── On/Off-ramp review queue ──────────────────────────────────────────────────

function ReviewButtons({
  id,
  pending,
  onReview,
}: {
  id: number;
  pending: boolean;
  onReview: (decision: "Approved" | "Rejected", reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  if (rejecting) {
    return (
      <div className="flex flex-col items-end gap-[8px]">
        <input
          type="text"
          data-testid={`cash-management-reject-reason-${id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejecting"
          className="w-[240px] max-w-full rounded-[4px] border border-solid px-[11px] py-[8px] font-[family-name:var(--font-body)] text-[14px] outline-none"
          style={{ borderColor: LINE_COLOR, color: INK }}
        />
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => setRejecting(false)}
            disabled={pending}
            className="rounded-[4px] border border-solid px-[13px] py-[7px] font-[family-name:var(--font-body)] text-[14px] disabled:opacity-50"
            style={{ borderColor: LINE_COLOR, color: INK }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid={`cash-management-confirm-reject-${id}`}
            onClick={() => onReview("Rejected", reason)}
            disabled={pending || reason.trim().length === 0}
            className="rounded-[4px] px-[13px] py-[7px] font-[family-name:var(--font-body)] text-[14px] text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: NEGATIVE_RED }}
          >
            {pending ? "…" : "Confirm reject"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[8px]">
      <button
        type="button"
        data-testid={`cash-management-reject-${id}`}
        onClick={() => setRejecting(true)}
        disabled={pending}
        className="rounded-[4px] border border-solid px-[14px] py-[8px] font-[family-name:var(--font-body)] text-[14px] disabled:opacity-50"
        style={{ borderColor: LINE_COLOR, color: INK }}
      >
        Reject
      </button>
      <button
        type="button"
        data-testid={`cash-management-approve-${id}`}
        onClick={() => onReview("Approved")}
        disabled={pending}
        className="rounded-[4px] px-[14px] py-[8px] font-[family-name:var(--font-body)] text-[14px] text-white disabled:cursor-not-allowed disabled:opacity-50"
        style={{ backgroundColor: BRAND }}
      >
        {pending ? "…" : "Approve"}
      </button>
    </div>
  );
}

function RampEventRow({
  event,
  pending,
  onReview,
}: {
  event: RampEventRowData;
  pending: boolean;
  onReview: (
    id: number,
    decision: "Approved" | "Rejected",
    reason?: string,
  ) => void;
}) {
  return (
    <div
      data-testid="cash-management-ramp-event"
      className="flex flex-col gap-[12px] py-[16px] sm:flex-row sm:items-center sm:justify-between"
      style={{ borderTop: `1px solid ${LINE_COLOR}` }}
    >
      <div className="flex flex-col gap-[2px]">
        <span className="font-[family-name:var(--font-body)] text-[17px] leading-[23.8px] font-semibold text-[#262524]">
          {event.amount}
        </span>
        <span
          className="font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
          style={{ color: INK_MUTED }}
        >
          {event.from} → {event.to} · {event.age}
        </span>
      </div>
      <ReviewButtons
        id={event.id}
        pending={pending}
        onReview={(decision, reason) => onReview(event.id, decision, reason)}
      />
    </div>
  );
}

function RampSection({
  title,
  note,
  events,
  reviewPendingId,
  onReview,
  testId,
}: {
  title: string;
  note: string;
  events: RampEventRowData[];
  reviewPendingId: number | null;
  onReview: (
    id: number,
    decision: "Approved" | "Rejected",
    reason?: string,
  ) => void;
  testId: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col">
      <div className="flex items-baseline justify-between gap-[16px] pb-[4px]">
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] uppercase"
          style={{ color: INK_MUTED }}
        >
          {title}
        </span>
        <span
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_SUBTLE }}
        >
          {note}
        </span>
      </div>
      {events.length === 0 ? (
        <p
          className="py-[12px] font-[family-name:var(--font-body)] text-[14px]"
          style={{ color: INK_MUTED }}
        >
          Nothing pending.
        </p>
      ) : (
        events.map((event) => (
          <RampEventRow
            key={event.id}
            event={event}
            pending={reviewPendingId === event.id}
            onReview={onReview}
          />
        ))
      )}
    </div>
  );
}

// ── On/Off-ramp swap dialog (UI shell — #943, execution blocked on Type-2 MPC #781) ──
//
// Opened from the tab's "New swap" button (Transak-style). Mirrors the app's
// dialog shell (RolloverDialog / UpdateLifecycleDialog): backdrop, centered
// panel, Escape/backdrop close, form reset on open.

function SwapDialog({
  open,
  onClose,
  usdcBalanceValue,
  usdcBalanceDisplay,
  rampAddressDisplay,
}: {
  open: boolean;
  onClose: () => void;
  usdcBalanceValue: number | null;
  usdcBalanceDisplay: string;
  rampAddressDisplay: string;
}) {
  const [mode, setMode] = useState<"off" | "on">("off");
  const [amount, setAmount] = useState("");

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setMode("off");
      setAmount("");
    }
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isOff = mode === "off";
  const amountNum = Number.parseFloat(amount);
  // USDC ↔ USD is 1:1; the provider fee has no quote endpoint, so it stays "—".
  const receiveUsd = Number.isFinite(amountNum)
    ? formatFullUsd(String(amountNum))
    : "—";

  return (
    <div
      data-testid="cash-management-swap-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)] px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-management-swap-title"
        data-testid="cash-management-swap"
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-[16px] rounded-[6px] bg-white px-[27px] py-[25px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + close. */}
        <div className="flex items-center justify-between">
          <h2
            id="cash-management-swap-title"
            className="font-[family-name:var(--font-display)] text-[24px] leading-[33.6px] text-[#262524]"
          >
            New swap
          </h2>
          <button
            type="button"
            data-testid="cash-management-swap-close"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-[20px] leading-none"
            style={{ color: INK_MUTED }}
          >
            ×
          </button>
        </div>

        {/* Off-ramp / On-ramp toggle (top of the swap form). */}
        <div
          className="flex items-center gap-[4px] self-start rounded-[6px] p-[4px]"
          style={{ backgroundColor: "rgba(191,189,187,0.12)" }}
        >
          {(["off", "on"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`cash-management-swap-mode-${m}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="rounded-[4px] px-[14px] py-[6px] font-[family-name:var(--font-body)] text-[14px]"
              style={
                mode === m
                  ? {
                      backgroundColor: "#ffffff",
                      color: INK,
                      border: `1px solid ${LINE_COLOR}`,
                    }
                  : { color: INK_MUTED }
              }
            >
              {m === "off" ? "Off-ramp" : "On-ramp"}
            </button>
          ))}
        </div>

        {/* Amount + balance/max. */}
        <label className="flex flex-col gap-[6px]">
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {isOff ? "You off-ramp" : "You on-ramp"}
          </span>
          <div
            className="flex items-center gap-[10px] rounded-[4px] border border-solid px-[13px] py-[10px]"
            style={{ borderColor: LINE_COLOR }}
          >
            <input
              type="number"
              inputMode="decimal"
              data-testid="cash-management-swap-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-transparent font-[family-name:var(--font-body)] text-[20px] text-[#262524] outline-none"
            />
            <span
              className="font-[family-name:var(--font-body)] text-[14px]"
              style={{ color: INK_MUTED }}
            >
              USDC
            </span>
            <button
              type="button"
              data-testid="cash-management-swap-max"
              onClick={() =>
                usdcBalanceValue != null && setAmount(String(usdcBalanceValue))
              }
              disabled={usdcBalanceValue == null}
              className="rounded-[4px] border border-solid px-[9px] py-[4px] font-[family-name:var(--font-body)] text-[12px] disabled:opacity-40"
              style={{ borderColor: LINE_COLOR, color: INK_MUTED }}
            >
              Max
            </button>
          </div>
          <span
            className="font-[family-name:var(--font-body)] text-[12px]"
            style={{ color: INK_MUTED }}
          >
            Balance: {usdcBalanceDisplay} USDC
          </span>
        </label>

        {/* Receive method + destination. */}
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center justify-between">
            <span
              className="font-[family-name:var(--font-body)] text-[14px]"
              style={{ color: INK_MUTED }}
            >
              {isOff ? "Receive method" : "Pay method"}
            </span>
            <span className="font-[family-name:var(--font-body)] text-[14px] text-[#262524]">
              Bank wire
            </span>
          </div>
          {isOff && (
            <div className="flex items-center justify-between">
              <span
                className="font-[family-name:var(--font-body)] text-[14px]"
                style={{ color: INK_MUTED }}
              >
                To (ramp)
              </span>
              <span className="font-[family-name:var(--font-body)] text-[14px] text-[#262524]">
                {rampAddressDisplay}
              </span>
            </div>
          )}
        </div>

        {/* Transaction summary. */}
        <div
          className="flex flex-col gap-[8px] rounded-[4px] px-[15px] py-[13px]"
          style={{ backgroundColor: "rgba(191,189,187,0.12)" }}
        >
          <div className="flex items-center justify-between font-[family-name:var(--font-body)] text-[14px]">
            <span style={{ color: INK_MUTED }}>You receive (1:1)</span>
            <span
              data-testid="cash-management-swap-receive"
              className="text-[#262524]"
            >
              {receiveUsd === "—" ? "—" : `~${receiveUsd} USD`}
            </span>
          </div>
          <div className="flex items-center justify-between font-[family-name:var(--font-body)] text-[14px]">
            <span style={{ color: INK_MUTED }}>Fee</span>
            {/* No ramp-quote endpoint — never fabricated. */}
            <span className="text-[#262524]">—</span>
          </div>
        </div>

        <button
          type="button"
          data-testid="cash-management-swap-submit"
          disabled
          className="flex h-[48px] items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {isOff ? "Off-ramp now" : "On-ramp now"}
        </button>
        <p
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          {isOff
            ? "Off-ramp is a Capital-Wallet MPC transfer (3-of-5) — execution not yet available (#781)."
            : "On-ramp USDC arrivals are detected on-chain and reviewed below."}
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CashManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>("onofframp");
  const [swapOpen, setSwapOpen] = useState(false);
  const view = useCashManagement();

  const onReview = (
    id: number,
    decision: "Approved" | "Rejected",
    reason?: string,
  ) => view.review({ id, decision, reason });

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-[16px] px-[56px] pt-[39px] pb-[105px]">
      <h1
        className="font-[family-name:var(--font-display)] text-[44px] leading-[48.4px]"
        style={{ color: INK_SUBTLE }}
      >
        Cash Management
      </h1>

      <TabBar
        active={activeTab}
        onChange={(key) => {
          setActiveTab(key);
          setSwapOpen(false);
        }}
      />

      {/* Shared Capital Allocation — same block as the Overview page. */}
      <CapitalAllocationCard />

      {activeTab === "onofframp" ? (
        <div className="flex w-full flex-col gap-[16px]">
          {/* Header + "New swap" trigger — opens the swap form in a dialog. */}
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <div className="flex flex-col gap-[2px]">
              <span
                className="font-[family-name:var(--font-display)] text-[20px] leading-[28px]"
                style={{ color: INK }}
              >
                On / Off-ramp
              </span>
              <span
                className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
                style={{ color: INK_MUTED }}
              >
                Move USDC in and out of the Capital Wallet; arrivals are
                reviewed below.
              </span>
            </div>
            <button
              type="button"
              data-testid="cash-management-swap-open"
              onClick={() => setSwapOpen(true)}
              className="flex h-[44px] items-center justify-center rounded-[4px] px-[20px] font-[family-name:var(--font-body)] text-[15px] text-white"
              style={{ backgroundColor: BRAND }}
            >
              New swap
            </button>
          </div>
          <div
            data-testid="cash-management-onofframp"
            className="flex w-full flex-col gap-[24px] rounded-[4px] bg-white px-[27px] py-[25px]"
            style={{ border: `1px solid ${LINE_COLOR}` }}
          >
            {view.state === "loading" && (
              <div
                data-testid="cash-management-loading"
                className="flex w-full flex-col gap-3"
                aria-busy="true"
                aria-label="Loading ramp events"
              >
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="h-[64px] w-full animate-pulse rounded-[4px] bg-[color:var(--color-pipeline-surface-muted)]"
                  />
                ))}
              </div>
            )}

            {view.state === "error" && (
              <div
                role="alert"
                data-testid="cash-management-error"
                className="w-full rounded-[4px] border border-solid border-[color:var(--color-pipeline-negative)] bg-[rgba(192,57,43,0.06)] p-3 font-[family-name:var(--font-body)] text-[14px] leading-[19.6px] text-[color:var(--color-pipeline-ink)]"
              >
                {view.errorMessage ?? "Failed to load ramp events."}
              </div>
            )}

            {view.state === "ready" && (
              <>
                {view.isEmpty && (
                  <p
                    data-testid="cash-management-empty"
                    className="font-[family-name:var(--font-body)] text-[15px]"
                    style={{ color: INK_MUTED }}
                  >
                    No ramp transfers awaiting review.
                  </p>
                )}
                {!view.isEmpty && (
                  <>
                    <RampSection
                      testId="cash-management-inbound"
                      title="Inbound · repayment on-ramps"
                      note="Relayer + custodian mint · you review"
                      events={view.inbound}
                      reviewPendingId={view.reviewPendingId}
                      onReview={onReview}
                    />
                    <RampSection
                      testId="cash-management-outbound"
                      title="Outbound · off-ramps & facility allocations"
                      note="MPC 3-of-5"
                      events={view.outbound}
                      reviewPendingId={view.reviewPendingId}
                      onReview={onReview}
                    />
                  </>
                )}
                {view.reviewErrorMessage && (
                  <p
                    role="alert"
                    data-testid="cash-management-review-error"
                    className="font-[family-name:var(--font-body)] text-[14px]"
                    style={{ color: NEGATIVE_RED }}
                  >
                    {view.reviewErrorMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div
          data-testid={`cash-management-placeholder-${activeTab}`}
          className="flex w-full flex-col gap-[8px] rounded-[4px] bg-white px-[27px] py-[25px]"
          style={{ border: `1px solid ${LINE_COLOR}` }}
        >
          <p
            className="font-[family-name:var(--font-body)] text-[15px] leading-[21px]"
            style={{ color: INK_MUTED }}
          >
            {PLACEHOLDER_COPY[activeTab]}
          </p>
        </div>
      )}

      <p
        className="text-center font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
        style={{ color: POSITIVE_GREEN }}
      >
        A reviewed transfer counts toward Capital Allocation only once Approved.
      </p>

      <SwapDialog
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        usdcBalanceValue={view.usdcBalanceValue}
        usdcBalanceDisplay={view.usdcBalanceDisplay}
        rampAddressDisplay={view.rampAddressDisplay}
      />
    </main>
  );
}

export const Route = createFileRoute("/cash-management")({
  component: CashManagement,
});
