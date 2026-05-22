/**
 * Test scenario registry for the /test Mocks tab.
 *
 * Each scenario is a pure data record describing a meaningful app state. The
 * Mocks tab renders one card per scenario and lets the developer activate it
 * with a single click.
 *
 * Activation flow:
 *   1. `clearAllMocks()` — removes every `pipeline.mock.*` key from localStorage.
 *   2. `localStorage.setItem(key, value)` for every entry in `scenario.keys`.
 *   3. `reloadPage()` — calls `window.location.reload()` so every hook re-reads
 *      its keys from a clean slate.
 *
 * We deliberately choose page reload over reactive wiring because `/test` is a
 * developer surface and a reload is both acceptable and simpler.
 *
 * Addresses used in scenarios:
 *   - Wallet address : `0x1234000000000000000000000000000000000000`
 *   - USDC           : `0x2222000000000000000000000000000000000002`
 *   - DepositManager : `0x3333000000000000000000000000000000000003`
 *   - PLUSD          : `0x1111000000000000000000000000000000000001`
 *   - WithdrawalQueue: `0x4444000000000000000000000000000000000004`
 *   - StakedPLUSD    : `0x5555000000000000000000000000000000000005`
 *
 * Convention — every request-flow feature ships with full mock state:
 *   - Balance and allowance keys so the UI renders the correct CTA step.
 *   - A write-side contract mock (e.g. `depositManager.requestDeposit`,
 *     `withdrawalQueue.requestWithdrawal`) so clicking Confirm settles
 *     synchronously inside the Mocks tab without falling through to a real
 *     wagmi/RPC call. Shape: `{ hash: "0x...", requestId?: "123" }` for
 *     deposit; `{ hash: "0x...", requestId?: "123", queued?: "0" }` for
 *     withdrawal.
 *   - API mock keys for in-flight request states (`pipeline.mock.api.GET./v1/requests`).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestScenario {
  /** Stable id for URLs, tests, and debugging. */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** One or two sentences describing the app state. */
  description: string;
  /**
   * Mock keys to set. All keys MUST start with `pipeline.mock.`.
   * Values are already-serialised strings (JSON for objects, plain string for
   * scalars), matching what `localStorage.setItem` expects.
   */
  keys: Record<string, string>;
}

// ── Address constants ─────────────────────────────────────────────────────────

const WALLET_ADDRESS = "0x1234000000000000000000000000000000000000";
const USDC_ADDRESS = "0x2222000000000000000000000000000000000002";
const DM_ADDRESS = "0x3333000000000000000000000000000000000003";
const PLUSD_ADDRESS = "0x1111000000000000000000000000000000000001";
const WQ_ADDRESS = "0x4444000000000000000000000000000000000004";
const SPLUSD_ADDRESS = "0x5555000000000000000000000000000000000005";

// Shared wallet keys that every "connected" scenario seeds.
const WALLET_CONNECTED_BASE: Record<string, string> = {
  "pipeline.mock.wallet.address": WALLET_ADDRESS,
  "pipeline.mock.wallet.isConnected": "true",
  // DepositManager named aliases so useDepositManagerAddresses() returns the
  // stub addresses regardless of VITE_DEPOSIT_MANAGER_ADDRESS in .env.
  "pipeline.mock.wallet.contract.depositManager.usdc": USDC_ADDRESS,
  "pipeline.mock.wallet.contract.depositManager.plusd": PLUSD_ADDRESS,
  "pipeline.mock.wallet.contract.depositManager.minDeposit": "1000000",
  // USDC token metadata (needed by useToken + useApproval)
  [`pipeline.mock.wallet.contract.${USDC_ADDRESS}.decimals`]: "6",
  [`pipeline.mock.wallet.contract.${USDC_ADDRESS}.symbol`]: "USDC",
  // PLUSD token metadata (needed by useToken + useApproval on /withdraw and /stake)
  [`pipeline.mock.wallet.contract.${PLUSD_ADDRESS}.decimals`]: "18",
  [`pipeline.mock.wallet.contract.${PLUSD_ADDRESS}.symbol`]: "PLUSD",
  // StakedPLUSD named alias — resolves PLUSD address from the vault's asset()
  // so useStakedPlusdAsset() returns the PLUSD address on /stake.
  "pipeline.mock.wallet.contract.stakedPlusd.asset": PLUSD_ADDRESS,
  // sPLUSD ERC-20 metadata (the share token)
  [`pipeline.mock.wallet.contract.${SPLUSD_ADDRESS}.decimals`]: "18",
  [`pipeline.mock.wallet.contract.${SPLUSD_ADDRESS}.symbol`]: "sPLUSD",
};

// ── Scenarios ─────────────────────────────────────────────────────────────────

export const SCENARIOS: ReadonlyArray<TestScenario> = [
  // 1. Connected, fresh wallet (zero USDC, zero allowance) ──────────────────────
  {
    id: "connected-fresh",
    title: "Connected, fresh wallet (zero USDC, zero allowance)",
    description:
      "Wallet connected; no funds; no approval. Home shows Portfolio transition; /deposit Approve is disabled.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "0",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]: "0",
    },
  },

  // 2. Connected, balance below min deposit ────────────────────────────────────
  {
    id: "connected-below-min",
    title: "Connected, balance below min deposit",
    description:
      "Balance is below the minimum deposit threshold. Triggers the low-balance banner on /deposit.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "500000", // 0.5 USDC
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]: "0",
    },
  },

  // 3. Connected, balance ≥ min, allowance 0 ────────────────────────────────────
  {
    id: "connected-allowance-zero",
    title: "Connected, balance ≥ min, allowance 0",
    description:
      "Sufficient balance but no approval yet. Approve is the live action on /deposit.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000", // 100 USDC
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]: "0",
    },
  },

  // 4. Connected, allowance ≥ amount, no active request ────────────────────────
  {
    id: "connected-allowance-ok",
    title: "Connected, allowance ≥ amount, no active request",
    description:
      "Sufficient balance and allowance; no pending request. Confirm is the live action on /deposit. Clicking Confirm settles synchronously via the requestDeposit mock.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000", // 100 USDC
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]:
        "100000000000", // 100,000 USDC
      "pipeline.mock.wallet.contract.depositManager.requestDeposit":
        JSON.stringify({
          hash: "0xde000000000000000000000000000000000000000000000000000000000000de",
          requestId: "99",
        }),
    },
  },

  // 5. PendingVerification request ──────────────────────────────────────────────
  {
    id: "request-pending-verification",
    title: "Connected, PendingVerification request",
    description:
      "A deposit is submitted and awaiting verifier review (Step 2 in flight per #242).",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]:
        "100000000000",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Deposit",
            amount: "10000000",
            request_id: "42",
            status: "PendingVerification",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    },
  },

  // 6. PendingClaim request, voucher ready ──────────────────────────────────────
  {
    id: "request-pending-claim",
    title: "Connected, PendingClaim request, voucher ready",
    description:
      "Verification passed; a claim voucher is available. Step 3 is enabled on /deposit.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]:
        "100000000000",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Deposit",
            amount: "10000000",
            request_id: "42",
            status: "PendingClaim",
            created_at: new Date().toISOString(),
          },
        ],
      }),
      "pipeline.mock.api.GET./v1/deposits/42/voucher": JSON.stringify({
        request_id: "42",
        amount: "10000000",
        user: WALLET_ADDRESS,
        signature:
          "0xaabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd001122330011",
      }),
    },
  },

  // 7. VerificationFailed request ──────────────────────────────────────────────
  {
    id: "request-verification-failed",
    title: "Connected, VerificationFailed request",
    description:
      "Verification failed. Step 2 is in a failed state; the deposit input is still editable.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]:
        "100000000000",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Deposit",
            amount: "10000000",
            request_id: "42",
            status: "VerificationFailed",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    },
  },

  // 8. Completed deposit history ───────────────────────────────────────────────
  {
    id: "history-completed",
    title: "Connected, Completed deposit history",
    description:
      "/transactions and home RecentActivityCard render historical rows for completed deposits and withdrawals.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]: "0",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Deposit",
            amount: "100000000",
            request_id: "10",
            status: "Completed",
            created_at: "2026-05-10T10:00:00Z",
          },
          {
            type: "Deposit",
            amount: "50000000",
            request_id: "11",
            status: "Completed",
            created_at: "2026-05-09T14:30:00Z",
          },
          {
            type: "Withdraw",
            amount: "20000000",
            request_id: "12",
            status: "Completed",
            created_at: "2026-05-08T09:00:00Z",
          },
        ],
      }),
    },
  },

  // 9. Mixed activity ──────────────────────────────────────────────────────────
  {
    id: "history-mixed",
    title: "Connected, mixed activity (Deposit + Withdraw + Stake + Unstake)",
    description:
      "Stresses the row-rendering helper across every request type and a mix of terminal/in-flight statuses.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${USDC_ADDRESS}`]: "100000000",
      [`pipeline.mock.wallet.allowance.${USDC_ADDRESS}.${DM_ADDRESS}`]: "0",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Deposit",
            amount: "100000000",
            request_id: "20",
            status: "Completed",
            created_at: "2026-05-15T12:00:00Z",
          },
          {
            type: "Withdraw",
            amount: "50000000",
            request_id: "21",
            status: "PendingVerification",
            created_at: "2026-05-14T09:30:00Z",
          },
          {
            type: "Stake",
            amount: "1000000000000000000000",
            assets: "1000000000000000000000",
            shares: "999500000000000000000",
            request_id: "22",
            status: "Completed",
            created_at: "2026-05-13T18:00:00Z",
          },
          {
            type: "Unstake",
            amount: "500000000000000000000",
            assets: "500000000000000000000",
            shares: "499750000000000000000",
            request_id: "23",
            status: "Completed",
            created_at: "2026-05-12T08:00:00Z",
          },
          {
            type: "Deposit",
            amount: "25000000",
            request_id: "24",
            status: "PendingClaim",
            created_at: "2026-05-11T16:00:00Z",
          },
        ],
      }),
    },
  },

  // 10. Connected, PendingClaim withdrawal request, voucher ready ─────────────
  {
    id: "withdrawal-pending-claim",
    title: "Connected, PendingClaim withdrawal request, voucher ready",
    description:
      "Withdrawal verification passed; a claim voucher is available. Step 3 is enabled on /withdraw.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000", // 100 PLUSD at 18 decimals
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]:
        "1000000000000000000000", // 1000 PLUSD allowance
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Withdraw",
            amount: "10000000000000000000", // 10 PLUSD at 18 decimals
            request_id: "77",
            status: "PendingClaim",
            created_at: new Date().toISOString(),
          },
        ],
      }),
      "pipeline.mock.api.GET./v1/withdrawals/77/voucher": JSON.stringify({
        request_id: "77",
        amount: "10000000000000000000",
        user: WALLET_ADDRESS,
        signature:
          "0xaabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd001122330011",
      }),
      "pipeline.mock.wallet.contract.withdrawalQueue.claimWithdrawal":
        JSON.stringify({
          hash: "0xc1a100000000000000000000000000000000000000000000000000000000c1a1",
          amount: "10000000000000000000",
        }),
    },
  },

  // 11. Withdraw — connected, fresh wallet ────────────────────────────────────
  {
    id: "withdraw-connected-fresh",
    title: "Withdraw: connected, fresh wallet (zero PLUSD, zero allowance)",
    description:
      "Wallet connected; no PLUSD balance; no WQ allowance. /deposit?direction=withdraw shows empty input + disabled Approve.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "0",
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]: "0",
    },
  },

  // 12. Withdraw — balance ≥ 0, allowance 0 ───────────────────────────────────
  {
    id: "withdraw-connected-allowance-zero",
    title: "Withdraw: balance ≥ 0, allowance 0",
    description:
      "PLUSD balance present but no WQ allowance. Approve is the live action on /deposit?direction=withdraw.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000", // 100 PLUSD
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]: "0",
    },
  },

  // 13. Withdraw — allowance ≥ amount, no active request ──────────────────────
  {
    id: "withdraw-connected-allowance-ok",
    title: "Withdraw: allowance ≥ amount, no active request",
    description:
      "PLUSD balance and WQ allowance are sufficient. Confirm is the live action on /deposit?direction=withdraw. Clicking Confirm settles synchronously via the requestWithdrawal mock.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000", // 100 PLUSD
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]:
        "1000000000000000000000", // 1000 PLUSD
      "pipeline.mock.wallet.contract.withdrawalQueue.requestWithdrawal":
        JSON.stringify({
          hash: "0xab000000000000000000000000000000000000000000000000000000000000ab",
          requestId: "88",
          queued: "0",
        }),
    },
  },

  // 14. Withdraw — PendingVerification ─────────────────────────────────────────
  {
    id: "withdraw-request-pending-verification",
    title: "Withdraw: PendingVerification request",
    description:
      "A withdrawal is submitted and awaiting verifier review on /deposit?direction=withdraw.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000",
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]:
        "1000000000000000000000",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Withdraw",
            amount: "10000000000000000000",
            request_id: "77",
            status: "PendingVerification",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    },
  },

  // 15. Withdraw — VerificationFailed ──────────────────────────────────────────
  {
    id: "withdraw-request-verification-failed",
    title: "Withdraw: VerificationFailed request",
    description:
      "Withdraw verification failed. The withdrawal input is still editable on /deposit?direction=withdraw.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000",
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${WQ_ADDRESS}`]:
        "1000000000000000000000",
      "pipeline.mock.api.GET./v1/requests": JSON.stringify({
        requests: [
          {
            type: "Withdraw",
            amount: "10000000000000000000",
            request_id: "77",
            status: "VerificationFailed",
            created_at: new Date().toISOString(),
          },
        ],
      }),
    },
  },

  // 17. Connected, ready to stake (allowance 0) ────────────────────────────────
  {
    id: "stake-ready-allowance-zero",
    title: "Connected, ready to stake (allowance 0)",
    description:
      "PLUSD balance present; no approval to the sPLUSD vault yet. Approve is the live action on /stake → Stake tab.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000", // 100 PLUSD
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${SPLUSD_ADDRESS}`]:
        "0",
      [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
        "959600000000000000", // 0.9596 sPLUSD per PLUSD
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
        "1042100000000000000", // 1.0421 PLUSD per sPLUSD
      [`pipeline.mock.wallet.contract.${PLUSD_ADDRESS}.approve`]:
        JSON.stringify({ hash: "0xapprove" }),
    },
  },

  // 18. Connected, ready to stake (approved) ───────────────────────────────────
  {
    id: "stake-ready-approved",
    title: "Connected, ready to stake (approved)",
    description:
      "Allowance ≥ amount. Stake is the live action on /stake → Stake tab; clicking settles via the mock stake key.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000",
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${SPLUSD_ADDRESS}`]:
        "1000000000000000000000",
      [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
        "959600000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
        "1042100000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.stake": JSON.stringify({
        hash: "0xabc1000000000000000000000000000000000000000000000000000000000abc",
        shares: "9596000000000000000",
      }),
    },
  },

  // 19. Connected, ready to unstake ────────────────────────────────────────────
  {
    id: "unstake-ready",
    title: "Connected, ready to unstake",
    description:
      "sPLUSD balance present. Unstake is the live action on /stake → Unstake tab; clicking settles via the mock unstake key.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "0",
      [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]:
        "50000000000000000000", // 50 sPLUSD
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
        "959600000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
        "1042100000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.unstake": JSON.stringify({
        hash: "0xde110000000000000000000000000000000000000000000000000000000000de",
        assets: "52105000000000000000",
      }),
    },
  },
  // 20. Stake/Unstake — fresh wallet ───────────────────────────────────────────
  {
    id: "stake-fresh",
    title: "Stake: fresh wallet (zero PLUSD and sPLUSD)",
    description:
      "No PLUSD or sPLUSD balance; no vault allowance. Both Stake and Unstake tabs show empty state with disabled CTAs on /stake.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]: "0",
      [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
      [`pipeline.mock.wallet.allowance.${PLUSD_ADDRESS}.${SPLUSD_ADDRESS}`]:
        "0",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
        "959600000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
        "1042100000000000000",
    },
  },

  // 21. Unstake — PLUSD present, sPLUSD zero ────────────────────────────────────
  {
    id: "unstake-empty",
    title: "Unstake: PLUSD present, sPLUSD zero",
    description:
      "PLUSD balance is actionable; sPLUSD balance is zero. Stake tab is live; Unstake tab shows empty state with disabled CTA on /stake.",
    keys: {
      ...WALLET_CONNECTED_BASE,
      [`pipeline.mock.wallet.balance.${PLUSD_ADDRESS}`]:
        "100000000000000000000", // 100 PLUSD
      [`pipeline.mock.wallet.balance.${SPLUSD_ADDRESS}`]: "0",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToShares":
        "959600000000000000",
      "pipeline.mock.wallet.contract.stakedPlusd.convertToAssets":
        "1042100000000000000",
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wipes every `pipeline.mock.*` key from localStorage.
 * Returns the list of removed keys (for testability).
 */
export function clearAllMocks(): string[] {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith("pipeline.mock.")) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
  return toRemove;
}

/**
 * Pure helper: clears all mock keys then applies a scenario's keys.
 * Does NOT reload the page.
 */
export function enableScenarioKeys(scenario: TestScenario): void {
  clearAllMocks();
  for (const [key, value] of Object.entries(scenario.keys)) {
    localStorage.setItem(key, value);
  }
}

/**
 * Wrapper around `window.location.reload()` so tests can spy on it.
 *
 * `enableScenario` and `clearMocksAndReload` call this through the `_reload`
 * indirection object so tests can replace the reference via `vi.spyOn` or
 * direct assignment without hitting the non-writable JSDOM `window.location`
 * property.
 */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Internal indirection object — lets tests replace `_reload.fn` without
 * patching `window.location.reload` directly (which JSDOM forbids).
 *
 * @internal — exported only for test spy access. Do not call outside tests.
 */
export const _reload = { fn: reloadPage };

/**
 * Full activation flow: apply the scenario's keys then reload.
 * Used by the Enable button on each scenario card.
 */
export function enableScenario(scenario: TestScenario): void {
  enableScenarioKeys(scenario);
  _reload.fn();
}

/**
 * Full clear flow: clear all mock keys then reload.
 * Used by the top-level "Clear mocks" button on the Mocks tab.
 */
export function clearMocksAndReload(): void {
  clearAllMocks();
  _reload.fn();
}
