import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CapitalAllocationCard } from "@/components/CapitalAllocationCard";
import {
  useCashManagement,
  type RampEventRow as RampEventRowData,
} from "./-cash-management";
import { useTbillsSwap, type TbillsSwapView } from "./-cash-management-tbills";
import {
  useWithdrawalQueueView,
  type WithdrawalQueueView,
} from "./-cash-management-withdrawals";

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
 * The **T-Bills** tab (#944) has the same "New swap" modal UX — a Buy/Sell USYC
 * swap-form UI shell (`TbillsSwapDialog`; submit disabled, MPC execution not yet
 * backed). The **Withdrawal Queue** tab (#945) shows the queue's total-claimable
 * / requests (served) with the wallet balance `—` (unserved), and a "Top up"
 * button opening `WithdrawalTopUpDialog` — a Capital-Wallet MPC 3-of-5 shell
 * (Co-sign disabled). (No Refunds tab — the working doc has no such section;
 * docs are the source of truth, Figma is styling only.)
 *
 * Per `docs/FRONTEND.md` rule 2, this `.tsx` is JSX/styling only; the fetch +
 * value→display mapping live in `-cash-management.ts` / `-cash-management-tbills.ts`
 * / `-cash-management-withdrawals.ts`.
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
  // USDC ↔ USD is 1:1, so "You receive" mirrors the amount — a disabled twin of
  // the amount input. The provider fee has no quote endpoint, so it stays "—".
  const receiveValue = Number.isFinite(amountNum) ? String(amountNum) : "";

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

        {/* You receive — a disabled twin of the amount input (1:1). */}
        <label className="flex flex-col gap-[6px]">
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            You receive (1:1)
          </span>
          <div
            className="flex items-center gap-[10px] rounded-[4px] border border-solid px-[13px] py-[10px]"
            style={{
              borderColor: LINE_COLOR,
              backgroundColor: "rgba(191,189,187,0.12)",
            }}
          >
            <input
              type="text"
              data-testid="cash-management-swap-receive"
              value={receiveValue}
              readOnly
              disabled
              placeholder="0"
              className="w-full bg-transparent font-[family-name:var(--font-body)] text-[20px] text-[#262524] outline-none disabled:opacity-100"
            />
            <span
              className="font-[family-name:var(--font-body)] text-[14px]"
              style={{ color: INK_MUTED }}
            >
              USD
            </span>
          </div>
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

        {/* Fee — no ramp-quote endpoint, so never fabricated. */}
        <div className="flex items-center justify-between font-[family-name:var(--font-body)] text-[14px]">
          <span style={{ color: INK_MUTED }}>Fee</span>
          <span className="text-[#262524]">—</span>
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

// ── T-Bills tab: Buy / Sell USYC swap dialog (#944) ───────────────────────────
//
// Same UX as the On/Off-ramp swap: opened from the tab's "New swap" button into
// a modal (backdrop, Escape/backdrop/× close, reset on open). UI shell — Buy
// spends real USDC (Capital-Wallet balance), Sell spends USYC valued at the
// T-Bills bucket (`buckets.tbills`, currently null → "—"). Buying/selling USYC
// is a Capital-Wallet MPC action (3-of-5, Type 2, flow 8) with no backend path
// yet, so submit is disabled; "You receive" is a disabled twin of the amount
// input that stays empty (no USYC price/NAV served — never fabricated), and the
// fee shows "—". Backend follow-up filed with #944.

function TbillsSwapDialog({
  open,
  onClose,
  tbills,
}: {
  open: boolean;
  onClose: () => void;
  tbills: TbillsSwapView;
}) {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setMode("buy");
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

  const isBuy = mode === "buy";
  // Buy spends USDC → receives USYC; Sell spends USYC → receives USDC.
  const spendAsset = isBuy ? "USDC" : "USYC";
  const receiveAsset = isBuy ? "USYC" : "USDC";
  const balanceValue = isBuy ? tbills.usdcValue : tbills.tbillsValue;
  const balanceDisplay = isBuy ? tbills.usdcDisplay : tbills.tbillsDisplay;

  return (
    <div
      data-testid="cash-management-tbills-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)] px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-management-tbills-title"
        data-testid="cash-management-tbills"
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-[16px] rounded-[6px] bg-white px-[27px] py-[25px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: title + close. */}
        <div className="flex items-center justify-between">
          <h2
            id="cash-management-tbills-title"
            className="font-[family-name:var(--font-display)] text-[24px] leading-[33.6px] text-[#262524]"
          >
            New swap
          </h2>
          <button
            type="button"
            data-testid="cash-management-tbills-close"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[28px] w-[28px] items-center justify-center rounded-[4px] text-[20px] leading-none"
            style={{ color: INK_MUTED }}
          >
            ×
          </button>
        </div>

        {/* Buy / Sell toggle. */}
        <div
          className="flex items-center gap-[4px] self-start rounded-[6px] p-[4px]"
          style={{ backgroundColor: "rgba(191,189,187,0.12)" }}
        >
          {(["buy", "sell"] as const).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`cash-management-tbills-mode-${m}`}
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
              {m === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>

        {/* Amount + balance/max. */}
        <label className="flex flex-col gap-[6px]">
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            {isBuy ? "You spend" : "You sell"}
          </span>
          <div
            className="flex items-center gap-[10px] rounded-[4px] border border-solid px-[13px] py-[10px]"
            style={{ borderColor: LINE_COLOR }}
          >
            <input
              type="number"
              inputMode="decimal"
              data-testid="cash-management-tbills-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-transparent font-[family-name:var(--font-body)] text-[20px] text-[#262524] outline-none"
            />
            <span
              className="font-[family-name:var(--font-body)] text-[14px]"
              style={{ color: INK_MUTED }}
            >
              {spendAsset}
            </span>
            <button
              type="button"
              data-testid="cash-management-tbills-max"
              onClick={() =>
                balanceValue != null && setAmount(String(balanceValue))
              }
              disabled={balanceValue == null}
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
            Balance: {balanceDisplay} {spendAsset}
          </span>
        </label>

        {/* You receive — a disabled twin of the amount input; stays empty (no
            USYC price/NAV served, so the quote is never fabricated). */}
        <label className="flex flex-col gap-[6px]">
          <span
            className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
            style={{ color: INK_MUTED }}
          >
            You receive
          </span>
          <div
            className="flex items-center gap-[10px] rounded-[4px] border border-solid px-[13px] py-[10px]"
            style={{
              borderColor: LINE_COLOR,
              backgroundColor: "rgba(191,189,187,0.12)",
            }}
          >
            <input
              type="text"
              data-testid="cash-management-tbills-receive"
              value=""
              readOnly
              disabled
              placeholder="—"
              className="w-full bg-transparent font-[family-name:var(--font-body)] text-[20px] text-[#262524] outline-none disabled:opacity-100"
            />
            <span
              className="font-[family-name:var(--font-body)] text-[14px]"
              style={{ color: INK_MUTED }}
            >
              {receiveAsset}
            </span>
          </div>
        </label>

        {/* Fee — no USYC quote endpoint, so never fabricated. */}
        <div className="flex items-center justify-between font-[family-name:var(--font-body)] text-[14px]">
          <span style={{ color: INK_MUTED }}>Fee</span>
          <span className="text-[#262524]">—</span>
        </div>

        <button
          type="button"
          data-testid="cash-management-tbills-submit"
          disabled
          className="flex h-[48px] items-center justify-center rounded-[4px] px-[28px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ backgroundColor: BRAND }}
        >
          {isBuy ? "Buy USYC" : "Sell USYC"}
        </button>
        <p
          className="font-[family-name:var(--font-body)] text-[12px] leading-[16.8px]"
          style={{ color: INK_MUTED }}
        >
          Buying / selling USYC is a Capital-Wallet MPC transfer (3-of-5) —
          execution not yet available.
        </p>
      </div>
    </div>
  );
}

// Withdrawal Queue top-up dialog (#945; Figma 4116-13974) — a disabled MPC
// shell. spec: docs/frontend/trustee-flows.md#cash-management--withdrawal-queue.
const MPC_SIGNERS: { name: string; mandatory: boolean }[] = [
  { name: "Trustee (you)", mandatory: true },
  { name: "Team", mandatory: true },
  { name: "Custodian", mandatory: false },
  { name: "Counterparty A", mandatory: false },
  { name: "Counterparty B", mandatory: false },
];

function WithdrawalTopUpDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");

  // Reset on open; Escape closes.
  useEffect(() => {
    if (open) setAmount("");
  }, [open]);
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const row = "flex items-end justify-between border-b pb-[13px] pt-[12px]";
  const rowLabel =
    "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";
  const rowValue =
    "text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]";

  return (
    <div
      data-testid="cash-management-withdrawals-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(38,37,36,0.4)] px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-management-withdrawals-title"
        data-testid="cash-management-withdrawals-dialog"
        className="flex max-h-[calc(100vh-64px)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-auto rounded-[6px] bg-white px-[30px] py-[28px] shadow-[0px_10px_40px_0px_rgba(0,0,40,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cash-management-withdrawals-title"
          className="font-[family-name:var(--font-display)] text-[26px] leading-[36.4px] text-[#262524]"
        >
          Withdrawal Queue Wallet top-up
        </h2>
        <p
          className="pt-[3px] pb-[18px] font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
          style={{ color: INK_MUTED }}
        >
          Capital Wallet MPC · 3-of-5 policy · Trustee + Team mandatory. The
          dashboard never holds your MPC key — it builds the request and tracks
          signatures.
        </p>

        <div className={row} style={{ borderColor: LINE_COLOR }}>
          <span className={rowLabel} style={{ color: INK_MUTED }}>
            From
          </span>
          <span className={rowValue}>Capital Wallet (USDC)</span>
        </div>
        <div className={row} style={{ borderColor: LINE_COLOR }}>
          <span className={rowLabel} style={{ color: INK_MUTED }}>
            To
          </span>
          <span className={rowValue}>Withdrawal Queue Wallet</span>
        </div>
        {/* Amount — Trustee-specified (doc); cosmetic while submit is disabled. */}
        <div className={row} style={{ borderColor: LINE_COLOR }}>
          <label className={rowLabel} style={{ color: INK_MUTED }}>
            Amount
          </label>
          <input
            type="number"
            inputMode="decimal"
            data-testid="cash-management-withdrawals-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className={`${rowValue} w-[200px] bg-transparent outline-none`}
          />
        </div>
        {/* Coverage / oldest-pending: no served source → "—". */}
        <div className={row} style={{ borderColor: LINE_COLOR }}>
          <span className={rowLabel} style={{ color: INK_MUTED }}>
            Coverage after
          </span>
          <span className={rowValue}>—</span>
        </div>
        <div className={row} style={{ borderColor: LINE_COLOR }}>
          <span className={rowLabel} style={{ color: INK_MUTED }}>
            Oldest pending request
          </span>
          <span className={rowValue}>—</span>
        </div>

        <p
          className="pt-[19px] pb-[1px] font-[family-name:var(--font-body)] text-[12px] leading-[16.8px] tracking-[0.96px] uppercase"
          style={{ color: INK_MUTED }}
        >
          Signature collection — 0 of 3 required
        </p>
        <div
          className="pt-[6px]"
          data-testid="cash-management-withdrawals-signers"
        >
          {MPC_SIGNERS.map((signer, i) => (
            <div
              key={signer.name}
              className="flex items-center gap-[12px] px-[4px] pt-[11px] pb-[12px]"
              style={
                i < MPC_SIGNERS.length - 1
                  ? { borderBottom: `1px solid ${LINE_COLOR}` }
                  : undefined
              }
            >
              <span
                className="h-[9px] w-[9px] shrink-0 rounded-[4.5px]"
                style={{ backgroundColor: "rgba(191,189,187,0.24)" }}
              />
              <span className="font-[family-name:var(--font-body)] text-[15px] leading-[21px] text-[#262524]">
                {signer.name}
              </span>
              {signer.mandatory && (
                <span
                  className="rounded-[4px] px-[7px] pt-[2px] pb-[3px] font-[family-name:var(--font-body)] text-[11px] leading-[15.4px]"
                  style={{
                    backgroundColor: "rgba(191,189,187,0.12)",
                    color: INK_MUTED,
                  }}
                >
                  mandatory
                </span>
              )}
              <span
                className="ml-auto font-[family-name:var(--font-body)] text-[13px] leading-[18.2px]"
                style={{ color: INK_MUTED }}
              >
                not signed
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-[12px] pt-[24px]">
          <button
            type="button"
            data-testid="cash-management-withdrawals-cancel"
            onClick={onClose}
            className="flex h-[40px] items-center justify-center rounded-[4px] border border-solid bg-white px-[17px] font-[family-name:var(--font-body)] text-[16px] text-[#262524]"
            style={{ borderColor: LINE_COLOR }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="cash-management-withdrawals-submit"
            disabled
            className="flex h-[40px] items-center justify-center rounded-[4px] px-[16px] font-[family-name:var(--font-body)] text-[16px] text-white disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: BRAND }}
          >
            Co-sign in MPC
          </button>
        </div>
      </div>
    </div>
  );
}

// Withdrawal Queue tab body — summary + "Top up" button.
// spec: docs/frontend/trustee-flows.md#cash-management--withdrawal-queue.
function WithdrawalQueueSection({
  withdrawals,
  onTopUp,
}: {
  withdrawals: WithdrawalQueueView;
  onTopUp: () => void;
}) {
  const summaryRow =
    "flex items-end justify-between border-b pb-[13px] pt-[12px]";
  const summaryLabel =
    "font-[family-name:var(--font-body)] text-[15px] leading-[21px]";
  const summaryValue =
    "text-right font-[family-name:var(--font-body)] text-[16px] leading-[22.4px] text-[#262524]";

  return (
    <div
      data-testid="cash-management-withdrawals"
      className="flex w-full flex-col gap-[16px] rounded-[4px] bg-white px-[27px] py-[25px]"
      style={{ border: `1px solid ${LINE_COLOR}` }}
    >
      <div className="flex flex-wrap items-center justify-between gap-[12px]">
        <div className="flex flex-col gap-[2px]">
          <span
            className="font-[family-name:var(--font-display)] text-[20px] leading-[28px]"
            style={{ color: INK }}
          >
            Withdrawal Queue
          </span>
          <span
            className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
            style={{ color: INK_MUTED }}
          >
            Keep the Withdrawal Queue wallet funded to cover claimable requests;
            top up from the Capital Wallet.
          </span>
        </div>
        <button
          type="button"
          data-testid="cash-management-withdrawals-open"
          onClick={onTopUp}
          className="flex h-[44px] items-center justify-center rounded-[4px] px-[20px] font-[family-name:var(--font-body)] text-[15px] text-white"
          style={{ backgroundColor: BRAND }}
        >
          Top up
        </button>
      </div>

      {withdrawals.state === "error" ? (
        <p
          role="alert"
          data-testid="cash-management-withdrawals-error"
          className="font-[family-name:var(--font-body)] text-[14px]"
          style={{ color: NEGATIVE_RED }}
        >
          {withdrawals.errorMessage ?? "Failed to load the withdrawal queue."}
        </p>
      ) : (
        <div className="flex flex-col">
          <div className={summaryRow} style={{ borderColor: LINE_COLOR }}>
            <span className={summaryLabel} style={{ color: INK_MUTED }}>
              Withdrawal Queue wallet balance
            </span>
            <span className={summaryValue}>
              {withdrawals.walletBalanceDisplay}
            </span>
          </div>
          <div className={summaryRow} style={{ borderColor: LINE_COLOR }}>
            <span className={summaryLabel} style={{ color: INK_MUTED }}>
              Total claimable
            </span>
            <span
              className={summaryValue}
              data-testid="cash-management-withdrawals-claimable"
            >
              {withdrawals.state === "loading"
                ? "…"
                : withdrawals.totalClaimableDisplay}
            </span>
          </div>
          <div
            className="flex items-end justify-between pt-[12px]"
            style={{ borderColor: LINE_COLOR }}
          >
            <span className={summaryLabel} style={{ color: INK_MUTED }}>
              Requests
            </span>
            <span className={summaryValue}>
              {withdrawals.state === "loading"
                ? "…"
                : withdrawals.requestsDisplay}
            </span>
          </div>
        </div>
      )}

      {withdrawals.needsTopUp && (
        <p
          role="alert"
          data-testid="cash-management-withdrawals-topup-alert"
          className="rounded-[4px] px-[15px] py-[13px] font-[family-name:var(--font-body)] text-[14px]"
          style={{
            backgroundColor: "rgba(178,0,0,0.06)",
            color: NEGATIVE_RED,
          }}
        >
          Balance is below the claimable total — top up the Withdrawal Queue
          wallet.
        </p>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CashManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>("onofframp");
  const [swapOpen, setSwapOpen] = useState(false);
  const [tbillsSwapOpen, setTbillsSwapOpen] = useState(false);
  const [withdrawalTopUpOpen, setWithdrawalTopUpOpen] = useState(false);
  const view = useCashManagement();
  const tbills = useTbillsSwap();
  const withdrawals = useWithdrawalQueueView();

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
          setTbillsSwapOpen(false);
          setWithdrawalTopUpOpen(false);
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
      ) : activeTab === "tbills" ? (
        <div
          className="flex flex-wrap items-center justify-between gap-[12px] rounded-[4px] bg-white px-[27px] py-[25px]"
          style={{ border: `1px solid ${LINE_COLOR}` }}
        >
          <div className="flex flex-col gap-[2px]">
            <span
              className="font-[family-name:var(--font-display)] text-[20px] leading-[28px]"
              style={{ color: INK }}
            >
              T-Bills
            </span>
            <span
              className="font-[family-name:var(--font-body)] text-[14px] leading-[19.6px]"
              style={{ color: INK_MUTED }}
            >
              Buy or sell USYC against the Capital Allocation above.
            </span>
          </div>
          <button
            type="button"
            data-testid="cash-management-tbills-open"
            onClick={() => setTbillsSwapOpen(true)}
            className="flex h-[44px] items-center justify-center rounded-[4px] px-[20px] font-[family-name:var(--font-body)] text-[15px] text-white"
            style={{ backgroundColor: BRAND }}
          >
            New swap
          </button>
        </div>
      ) : (
        <WithdrawalQueueSection
          withdrawals={withdrawals}
          onTopUp={() => setWithdrawalTopUpOpen(true)}
        />
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

      <TbillsSwapDialog
        open={tbillsSwapOpen}
        onClose={() => setTbillsSwapOpen(false)}
        tbills={tbills}
      />

      <WithdrawalTopUpDialog
        open={withdrawalTopUpOpen}
        onClose={() => setWithdrawalTopUpOpen(false)}
      />
    </main>
  );
}

export const Route = createFileRoute("/cash-management")({
  component: CashManagement,
});
