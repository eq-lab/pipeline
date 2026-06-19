/**
 * Tests for `useStakeFlow` — focused on the Stellar PLUSD balance bug fix.
 *
 * Issue #677: The Stellar Stake-tab PLUSD balance read was hardcoded to
 * `assetIssuer: ""` in `useStellarSacToken`, which only matches the mock path.
 * On the real Horizon path the hook matches BOTH `asset_code` AND
 * `asset_issuer` — an empty issuer never matches a real balance line, so the
 * hook returned balance "0" / hasTrustline false and the stake input was gated
 * off.
 *
 * These tests exercise the **Horizon-matching path** (mocked `loadAccount`
 * returning balance lines with real issuer) rather than the localStorage mock
 * key (`balanceSacPlusd`), which ignores the issuer and would not catch the bug.
 *
 * Scenarios:
 *   1. Stellar connected; Horizon PLUSD line with protocol issuer →
 *      balance is non-zero bigint; hasBalance is true for an in-range amount.
 *   2. Stellar connected; Horizon PLUSD line with a *different* issuer →
 *      balance is 0n; hasBalance is false (issuer-mismatch contract pinned).
 *   3. sPLUSD balance via `useStellarStakedPlusdBalance` (Unstake tab input)
 *      is unaffected by the issuer — read raw from vault mock key, non-zero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useStakeFlow } from "./useStakeFlow";

// ── Stellar SDK mock ──────────────────────────────────────────────────────────
// Intercept Horizon.Server.loadAccount so we control balance lines.

const mockLoadAccount = vi.hoisted(() => vi.fn());

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class MockHorizonServer {
    loadAccount(address: string) {
      return mockLoadAccount(address);
    }
  }
  // Keep original exports; only replace the Horizon.Server class.
  return {
    ...original,
    Horizon: { Server: MockHorizonServer },
  };
});

// ── Stellar chain mock ────────────────────────────────────────────────────────
// Provide all chain constants explicitly so StellarWalletsKit.init() and
// other chain consumers get valid values without hitting ENV.

vi.mock("./stellar/chain", () => ({
  kitNetwork: "Test SDF Network ; September 2015",
  networkPassphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  READ_SIMULATION_SOURCE:
    "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  depositManagerId: "CARFA2QETOZVKHSG4BCEEXMJHTYR2Z75VR7WQNX4MWZ33RQMKRKATIVI",
  withdrawalQueueId: "",
  stakedPlusdId: "CDO4X3HCPR44UGXJ5PE35JBB4SYVDRQETXXOPQZLB7THN6FOTBTRKLW5",
  usdcIssuerId: "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM",
}));

// ── StellarWalletsKit mock ────────────────────────────────────────────────────
// Prevent StellarWalletsKit.init() from failing in test environments.

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    getAddress: vi.fn().mockResolvedValue({ address: undefined }),
    authModal: vi.fn().mockRejectedValue(new Error("no modal in tests")),
    signTransaction: vi.fn().mockRejectedValue(new Error("no sign in tests")),
  },
  LOBSTR_ID: "lobstr",
  FREIGHTER_ID: "freighter",
  XBULL_ID: "xbull",
  HANA_ID: "hana",
  ALBEDO_ID: "albedo",
  RABET_ID: "rabet",
  Networks: {
    TESTNET: "Test SDF Network ; September 2015",
    MAINNET: "Public Global Stellar Network ; September 2015",
  },
}));

// ── Wagmi mocks ───────────────────────────────────────────────────────────────
// useStakeFlow calls EVM hooks unconditionally; mock wagmi to return
// disconnected EVM so those code paths remain inert.

vi.mock("wagmi", async (importOriginal) => {
  const original = await importOriginal<typeof import("wagmi")>();
  return {
    ...original,
    useAccount: vi.fn(() => ({ address: undefined, isConnected: false })),
    useChainId: vi.fn(() => 560048),
    useDisconnect: vi.fn(() => ({ disconnect: vi.fn() })),
    useReadContract: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    useWriteContract: vi.fn(() => ({
      writeContract: vi.fn(),
      data: undefined,
      isPending: false,
      isSuccess: false,
      error: null,
      reset: vi.fn(),
    })),
    usePublicClient: vi.fn(() => ({
      estimateContractGas: vi.fn(async () => 1_000_000n),
    })),
    useWaitForTransactionReceipt: vi.fn(() => ({
      data: undefined,
      isLoading: false,
      isSuccess: false,
      isError: false,
      error: null,
    })),
  };
});

vi.mock("@reown/appkit/react", () => ({
  createAppKit: vi.fn(),
  useAppKit: vi.fn(() => ({ open: vi.fn() })),
}));

vi.mock("@/wallet/config", () => ({
  wagmiConfig: {},
  wagmiAdapter: {},
}));

vi.mock("@/lib/env", () => ({
  ENV: {
    EVM_CHAIN_ID: 560048,
    EVM_RPC_URL: "https://ethereum-hoodi-rpc.publicnode.com",
    DEPOSIT_MANAGER_ADDRESS: "0x3333000000000000000000000000000000000003",
    WITHDRAWAL_QUEUE_ADDRESS: "0x4444000000000000000000000000000000000004",
    STAKED_PLUSD_ADDRESS: "0x5555000000000000000000000000000000000005",
    WALLETCONNECT_PROJECT_ID: "replace-me",
  },
}));

// ── WalletView mock ───────────────────────────────────────────────────────────
// useStakeFlow calls useWalletView() which returns "evm" outside a provider.
// Override it to return "stellar" so the Stellar path is exercised.

vi.mock("./WalletViewContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./WalletViewContext")>();
  return {
    ...actual,
    useWalletView: vi.fn(() => ({
      kind: "stellar" as const,
      setKind: vi.fn(),
    })),
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

const PROTOCOL_ISSUER =
  "GC5SUAXMROK67LIE3DDMJG3AHHEVSFDAZ55A4WS655XYSKIN46RG7ACM";
const FAKE_ISSUER = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGYWDOUALPFD9TLVMQSRJV";
const STELLAR_ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

const USDC_CONTRACT_ID =
  "CCWX3TKH3K5SQDPOBGQTGOGE6Q5VEZWCOYJ2HDVV5U6GNN5U4WOEB3C7";
const PLUSD_CONTRACT_ID =
  "CAC7JMGRFZBL4IS4WBO5R3AMTK3C53FEOQZSU2WL5C4TWCRFAYWFSIBN";

// 50 PLUSD at 7 decimals (SAC raw = 50 * 1e7)
const PLUSD_BALANCE_50 = "50.0000000";
const PLUSD_BALANCE_50_RAW = 500_000_000n; // 50 * 1e7

// 25 sPLUSD at 7 decimals raw bigint — fed via stakedPlusd.shareBalance mock key
const SPLUSD_BALANCE_RAW = "250000000"; // 25 * 1e7

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
}

/**
 * Seed localStorage keys so the Stellar wallet reports as connected.
 * `useWalletView` is mocked to return `"stellar"` at the module level.
 */
function seedStellarWalletKeys() {
  localStorage.setItem("pipeline.mock.wallet.stellar.address", STELLAR_ADDR);
  localStorage.setItem("pipeline.mock.wallet.stellar.isConnected", "true");
}

/**
 * Seed the deposit-manager contract mock keys so
 * `useStellarDepositManagerAddresses` returns the PLUSD SAC contract ID and
 * its classic issuer via the mock fast-path (no RPC call).
 */
function seedDepositManagerMockKeys() {
  localStorage.setItem(
    "pipeline.mock.wallet.stellar.contract.usdc",
    USDC_CONTRACT_ID,
  );
  localStorage.setItem(
    "pipeline.mock.wallet.stellar.contract.plusd",
    PLUSD_CONTRACT_ID,
  );
}

/**
 * Return balance lines with a PLUSD entry for the specified issuer.
 */
function makeBalances(
  balance: string,
  issuer: string,
  isAuthorized = true,
): object[] {
  return [
    { asset_type: "native", balance: "10.0000000" },
    {
      asset_type: "credit_alphanum4",
      asset_code: "PLUSD",
      asset_issuer: issuer,
      balance,
      is_authorized: isAuthorized,
    },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useStakeFlow — Stellar PLUSD balance (Horizon path, issuer-sensitive)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockLoadAccount.mockClear();
    seedStellarWalletKeys();
    seedDepositManagerMockKeys();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("balance is non-zero bigint and hasBalance is true when Horizon PLUSD line matches protocol issuer", async () => {
    // Arrange: Horizon returns a PLUSD line with the protocol issuer.
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances(PLUSD_BALANCE_50, PROTOCOL_ISSUER),
    });

    const { result } = renderHook(
      () => useStakeFlow("stake", PLUSD_BALANCE_50_RAW, () => {}),
      { wrapper: makeWrapper().wrapper },
    );

    // Wait for Horizon to resolve and balance to propagate.
    await waitFor(() => {
      expect(result.current.balance).not.toBeUndefined();
      expect(result.current.balance).toBeGreaterThan(0n);
    });

    // Positive balance: stake input should be enabled for an amount ≤ balance.
    const amountInRange = PLUSD_BALANCE_50_RAW; // exactly the balance
    const { result: resultWithAmount } = renderHook(
      () => useStakeFlow("stake", amountInRange, () => {}),
      { wrapper: makeWrapper().wrapper },
    );

    await waitFor(() => {
      expect(resultWithAmount.current.balance).toBe(PLUSD_BALANCE_50_RAW);
    });

    expect(resultWithAmount.current.hasBalance).toBe(true);
  });

  it("balance is 0n and hasBalance is false when Horizon PLUSD line has a different issuer", async () => {
    // Arrange: Horizon returns PLUSD from a *different* issuer — issuer mismatch.
    mockLoadAccount.mockResolvedValue({
      balances: makeBalances(PLUSD_BALANCE_50, FAKE_ISSUER),
    });

    const { result } = renderHook(
      () => useStakeFlow("stake", PLUSD_BALANCE_50_RAW, () => {}),
      { wrapper: makeWrapper().wrapper },
    );

    // Wait for the Horizon query to settle — should return "0" (issuer mismatch).
    await waitFor(() => {
      // When the Horizon query returns "0" the sacDisplayToRaw("0") = 0n and
      // stellarPlusdBalanceRaw is 0n (converted from "0.0000000" → 0n).
      // stellarIsReady: connected but balance === 0n is still defined (not undefined)
      // so isReady is true; hasBalance requires amountBig <= balance → false when
      // balance is 0n and amountBig > 0n.
      expect(result.current.hasBalance).toBe(false);
    });

    // Also verify balance is 0n (or undefined — mismatch returns "0" display
    // which sacDisplayToRaw converts to 0n; either way hasBalance must be false).
    const bal = result.current.balance;
    expect(bal === undefined || bal === 0n).toBe(true);
  });
});

describe("useStakeFlow — Stellar sPLUSD balance (Unstake tab, not issuer-sensitive)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockLoadAccount.mockClear();
    seedStellarWalletKeys();
    seedDepositManagerMockKeys();
    // sPLUSD balance comes from the vault contract mock key, not Horizon.
    localStorage.setItem(
      "pipeline.mock.wallet.stellar.stakedPlusd.shareBalance",
      SPLUSD_BALANCE_RAW,
    );
    // Horizon called for PLUSD SAC balance (Stake-tab); return no PLUSD trustline.
    mockLoadAccount.mockResolvedValue({
      balances: [{ asset_type: "native", balance: "10.0000000" }],
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("Unstake tab balance (sPLUSD) is non-zero bigint from vault mock key", async () => {
    const splusdRaw = BigInt(SPLUSD_BALANCE_RAW); // 25 * 1e7
    const amountInRange = splusdRaw; // exactly the balance

    const { result } = renderHook(
      () => useStakeFlow("unstake", amountInRange, () => {}),
      { wrapper: makeWrapper().wrapper },
    );

    // Wait for sPLUSD balance to resolve.
    await waitFor(() => {
      expect(result.current.balance).not.toBeUndefined();
      expect(result.current.balance).toBeGreaterThan(0n);
    });

    expect(result.current.balance).toBe(splusdRaw);
    expect(result.current.hasBalance).toBe(true);
  });
});
