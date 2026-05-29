/**
 * /test — Diagnostic page.
 *
 * Two-tab layout driven by a TanStack Router search param (`?tab=status|mocks`):
 *
 *   - **Status** (default) — the existing read-only sections surfacing runtime
 *     state: ENV, Wallet, DepositManager, USDC balance, ERC-20 approval. No
 *     buttons. This is the live observability surface.
 *
 *   - **Mocks** — a global "Clear mocks" button + one scenario card per
 *     meaningful app state. Clicking Enable wipes all `pipeline.mock.*` keys,
 *     seeds only the scenario's keys, and reloads the page.
 *
 * The active tab is reflected in the URL. Reloading preserves the tab.
 * Invalid `?tab=` values fall back to `"status"`.
 *
 * The page is intentionally NOT linked from `TopBar`; it is a developer /
 * manual-QA tool only.
 */
import React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SegmentedTabs, Button } from "@pipeline/ui";
import { ENV } from "@/lib/env";
import {
  useEvmWallet,
  useDepositManagerAddresses,
  useDepositManagerMinDeposit,
  useEvmToken,
  useApproval,
  isMockKeyPresent,
} from "@/wallet";
import {
  SCENARIOS,
  clearMocksAndReload,
  enableScenario,
} from "./test/-scenarios";
import type { TestScenario } from "./test/-scenarios";

// ── Constants ─────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// ── Tab type ──────────────────────────────────────────────────────────────────

type TestTab = "status" | "mocks";

const TABS = [
  { id: "status", label: "Status" },
  { id: "mocks", label: "Mocks" },
];

// ── Route ─────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/test")({
  validateSearch: (raw): { tab: TestTab } => {
    const tab = raw.tab === "mocks" ? "mocks" : "status";
    return { tab };
  },
  component: TestPage,
});

// ── Inline sub-components ─────────────────────────────────────────────────────

/**
 * Small inline badge that renders `MOCKED` when `when` is true, or nothing.
 */
function MockedBadge({ when }: { when: boolean }): React.JSX.Element | null {
  if (!when) return null;
  return (
    <span
      className="ml-1 rounded border border-[color:var(--color-pipeline-line)] px-1 text-[10px] tracking-wide text-[color:var(--color-pipeline-ink-muted)] uppercase"
      title="This value is sourced from localStorage mock layer"
    >
      MOCKED
    </span>
  );
}

/**
 * One labeled key/value row with an optional `MOCKED` badge and trailing
 * action element.
 */
function KeyValueRow({
  label,
  value,
  mocked = false,
  extra,
}: {
  label: string;
  value: React.ReactNode;
  mocked?: boolean;
  extra?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-start gap-2 py-1">
      <span className="w-64 shrink-0 text-sm font-medium text-[color:var(--color-pipeline-ink-muted)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 font-mono text-sm break-all text-[color:var(--color-pipeline-ink)]">
        {value === undefined ? (
          <span className="opacity-40">—</span>
        ) : value === null ? (
          <span className="opacity-40">null</span>
        ) : typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "bigint" ||
          typeof value === "boolean" ? (
          String(value)
        ) : (
          value
        )}
        <MockedBadge when={mocked} />
      </span>
      {extra ? <div className="shrink-0">{extra}</div> : null}
    </div>
  );
}

/**
 * Section wrapper — heading + a vertical stack of rows, separated by a bottom
 * border.
 */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b border-[color:var(--color-pipeline-line)] pb-6">
      <h2 className="mb-3 text-base font-semibold text-[color:var(--color-pipeline-ink)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── StatusTab ─────────────────────────────────────────────────────────────────

/**
 * The read-only Status tab — shows live runtime state.
 * No buttons; pure observability.
 */
function StatusTab(): React.JSX.Element {
  // ── Wallet ──────────────────────────────────────────────────────────────
  const { address, isConnected, chainId } = useEvmWallet();

  // ── DepositManager ──────────────────────────────────────────────────────
  const {
    plusd,
    usdc,
    isLoading: dmAddrLoading,
    error: dmAddrError,
  } = useDepositManagerAddresses();

  const {
    minDeposit,
    isLoading: dmMinLoading,
    error: dmMinError,
  } = useDepositManagerMinDeposit();

  // ── USDC token ──────────────────────────────────────────────────────────
  const usdcAddress = usdc ?? (ZERO_ADDRESS as `0x${string}`);
  const {
    decimals: usdcDecimals,
    symbol: usdcSymbol,
    balance: usdcBalance,
    formattedBalance: usdcFormattedBalance,
  } = useEvmToken({ token: usdcAddress });

  // ── Approval ────────────────────────────────────────────────────────────
  const {
    allowance,
    isSufficient,
    data: approveData,
    isPending: isApprovePending,
    isSuccess: isApproveSuccess,
    error: approveError,
  } = useApproval({
    token: usdcAddress,
    spender: ENV.DEPOSIT_MANAGER_ADDRESS,
  });

  // ── Mock-key checks ─────────────────────────────────────────────────────
  // Wallet
  const walletAddressMocked = isMockKeyPresent("pipeline.mock.wallet.address");
  const walletIsConnectedMocked = isMockKeyPresent(
    "pipeline.mock.wallet.isConnected",
  );
  const walletChainIdMocked = isMockKeyPresent("pipeline.mock.wallet.chainId");

  // DepositManager — check all priority aliases
  const dmAddr = ENV.DEPOSIT_MANAGER_ADDRESS.toLowerCase();
  const plusdMocked =
    isMockKeyPresent("pipeline.mock.wallet.contract.depositManager.plusd") ||
    isMockKeyPresent(`pipeline.mock.wallet.contract.${dmAddr}.plUsd`);
  const usdcMocked =
    isMockKeyPresent("pipeline.mock.wallet.contract.depositManager.usdc") ||
    isMockKeyPresent(`pipeline.mock.wallet.contract.${dmAddr}.usdc`);
  const minDepositMocked =
    isMockKeyPresent(
      "pipeline.mock.wallet.contract.depositManager.minDeposit",
    ) || isMockKeyPresent(`pipeline.mock.wallet.contract.${dmAddr}.minDeposit`);

  // USDC token
  const usdcAddrLower = usdc?.toLowerCase();
  const usdcDecimalsMocked = usdcAddrLower
    ? isMockKeyPresent(
        `pipeline.mock.wallet.contract.${usdcAddrLower}.decimals`,
      )
    : false;
  const usdcSymbolMocked = usdcAddrLower
    ? isMockKeyPresent(`pipeline.mock.wallet.contract.${usdcAddrLower}.symbol`)
    : false;
  const usdcBalanceMocked = usdcAddrLower
    ? isMockKeyPresent(`pipeline.mock.wallet.balance.${usdcAddrLower}`)
    : false;

  // Approval
  const approvalAllowanceMocked =
    usdcAddrLower && ENV.DEPOSIT_MANAGER_ADDRESS
      ? isMockKeyPresent(
          `pipeline.mock.wallet.allowance.${usdcAddrLower}.${ENV.DEPOSIT_MANAGER_ADDRESS.toLowerCase()}`,
        )
      : false;

  // ── ENV flags ────────────────────────────────────────────────────────────
  const isZeroAddr =
    ENV.DEPOSIT_MANAGER_ADDRESS === ZERO_ADDRESS ||
    ENV.DEPOSIT_MANAGER_ADDRESS ===
      "0x0000000000000000000000000000000000000000";
  const isReplaceMe = ENV.WALLETCONNECT_PROJECT_ID === "replace-me";

  return (
    <>
      {/* ── 1. Environment ────────────────────────────────────────────── */}
      <Section title="Environment">
        <KeyValueRow label="EVM_CHAIN_ID" value={ENV.EVM_CHAIN_ID} />
        <KeyValueRow label="EVM_RPC_URL" value={ENV.EVM_RPC_URL} />
        <KeyValueRow
          label="DEPOSIT_MANAGER_ADDRESS"
          value={
            <>
              {ENV.DEPOSIT_MANAGER_ADDRESS}
              {isZeroAddr && (
                <span className="ml-2 text-[color:var(--color-pipeline-ink-muted)] opacity-60">
                  (zero-address — DM hooks short-circuit)
                </span>
              )}
            </>
          }
        />
        <KeyValueRow
          label="WALLETCONNECT_PROJECT_ID"
          value={
            <>
              {ENV.WALLETCONNECT_PROJECT_ID}
              {isReplaceMe && (
                <span className="ml-2 text-[color:var(--color-pipeline-ink-muted)] opacity-60">
                  (replace-me placeholder)
                </span>
              )}
            </>
          }
        />
      </Section>

      {/* ── 2. Wallet ────────────────────────────────────────────────── */}
      <Section title="Wallet (useEvmWallet)">
        <KeyValueRow
          label="address"
          value={address}
          mocked={walletAddressMocked}
        />
        <KeyValueRow
          label="isConnected"
          value={String(isConnected)}
          mocked={walletIsConnectedMocked}
        />
        <KeyValueRow
          label="chainId"
          value={chainId}
          mocked={walletChainIdMocked}
        />
      </Section>

      {/* ── 3. DepositManager ────────────────────────────────────────── */}
      <Section title="DepositManager (useDepositManagerAddresses + useDepositManagerMinDeposit)">
        <KeyValueRow
          label="isLoading"
          value={String(dmAddrLoading || dmMinLoading)}
        />
        <KeyValueRow
          label="error"
          value={dmAddrError?.message ?? dmMinError?.message ?? null}
        />
        <KeyValueRow label="plusd" value={plusd} mocked={plusdMocked} />
        <KeyValueRow label="usdc" value={usdc} mocked={usdcMocked} />
        <KeyValueRow
          label="minDeposit (raw)"
          value={minDeposit !== undefined ? String(minDeposit) : undefined}
          mocked={minDepositMocked}
        />
        <KeyValueRow
          label="minDeposit (6 dp)"
          value={
            minDeposit !== undefined
              ? String(Number(minDeposit) / 1e6)
              : undefined
          }
          mocked={minDepositMocked}
        />
      </Section>

      {/* ── 4. USDC token ────────────────────────────────────────────── */}
      <Section title="USDC token (useEvmToken)">
        {usdc === undefined ? (
          <p className="text-sm text-[color:var(--color-pipeline-ink-muted)] opacity-60">
            USDC address unknown — DepositManager not configured or still
            loading.
          </p>
        ) : (
          <>
            <KeyValueRow
              label="token address"
              value={usdc}
              mocked={usdcMocked}
            />
            <KeyValueRow
              label="decimals"
              value={usdcDecimals}
              mocked={usdcDecimalsMocked}
            />
            <KeyValueRow
              label="symbol"
              value={usdcSymbol}
              mocked={usdcSymbolMocked}
            />
            <KeyValueRow
              label="balance (raw)"
              value={
                usdcBalance !== undefined ? String(usdcBalance) : undefined
              }
              mocked={usdcBalanceMocked}
            />
            <KeyValueRow
              label="formattedBalance"
              value={usdcFormattedBalance}
              mocked={usdcBalanceMocked}
            />
          </>
        )}
      </Section>

      {/* ── 5. ERC-20 Approval ───────────────────────────────────────── */}
      <Section title="ERC-20 Approval (useApproval — USDC → DepositManager)">
        <KeyValueRow
          label="allowance (raw)"
          value={allowance !== undefined ? String(allowance) : undefined}
          mocked={approvalAllowanceMocked}
        />
        <KeyValueRow
          label="isSufficient(minDeposit)"
          value={
            minDeposit !== undefined
              ? String(isSufficient(minDeposit))
              : "false"
          }
        />
        <KeyValueRow label="isPending" value={String(isApprovePending)} />
        <KeyValueRow label="isSuccess" value={String(isApproveSuccess)} />
        <KeyValueRow label="error" value={approveError?.message ?? null} />
        <KeyValueRow
          label="data"
          value={approveData ? JSON.stringify(approveData) : undefined}
        />
      </Section>
    </>
  );
}

// ── ScenarioCard ──────────────────────────────────────────────────────────────

/**
 * A single scenario card: title + description + Enable button.
 */
function ScenarioCard({
  scenario,
}: {
  scenario: TestScenario;
}): React.JSX.Element {
  return (
    <li className="flex flex-col gap-2 rounded border border-[color:var(--color-pipeline-line)] bg-[var(--color-pipeline-paper)] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-[color:var(--color-pipeline-ink)]">
          {scenario.title}
        </span>
        <Button
          variant="secondary"
          className="h-8 shrink-0 text-xs"
          onClick={() => enableScenario(scenario)}
        >
          Enable
        </Button>
      </div>
      <p className="text-sm text-[color:var(--color-pipeline-ink-muted)]">
        {scenario.description}
      </p>
    </li>
  );
}

// ── MocksTab ──────────────────────────────────────────────────────────────────

/**
 * The Mocks tab — a global Clear button + one scenario card per scenario.
 */
function MocksTab(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="secondary"
          className="h-8 text-xs"
          onClick={clearMocksAndReload}
        >
          Clear mocks
        </Button>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SCENARIOS.map((s) => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
      </ul>
    </div>
  );
}

// ── Page component ────────────────────────────────────────────────────────────

function TestPage(): React.JSX.Element {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setTab = (next: string) =>
    void navigate({ search: { tab: next as TestTab } });

  return (
    <div className="min-h-screen bg-[var(--color-pipeline-paper)] text-[color:var(--color-pipeline-ink)]">
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
        <h1 className="text-xl font-bold text-[color:var(--color-pipeline-ink)]">
          /test — Diagnostic Page
        </h1>

        <SegmentedTabs tabs={TABS} activeId={tab} onSelect={setTab} />

        {tab === "status" ? <StatusTab /> : <MocksTab />}
      </main>
    </div>
  );
}
