/**
 * Public surface of `@pipeline/wallet-connect`.
 *
 * Minimal shared wallet-connect slice extracted from `packages/frontend/src/wallet`
 * (#791): connect/disconnect + connected address/chain + a picker modal +
 * provider mounting + message signing (EVM `personal_sign` / Stellar
 * SEP-0053), for consumption by both the LP frontend and the Trustee app.
 *
 * Callers must call `setWalletConnectConfig(...)` once, at the very start of
 * bootstrap, before rendering `EvmWalletProvider` / `StellarWalletProvider`.
 * Those providers lazily initialise AppKit / the wagmi adapter / the Stellar
 * kit on first render (not at module load — ES module imports are hoisted
 * and evaluated before the importing module's own body runs, so a
 * module-scope read of the injected config would throw before an app's
 * `main.tsx` ever gets a chance to call `setWalletConnectConfig()`).
 *
 * The gate (`WalletGateContext`) is optional: mount a
 * `WalletGateContext.Provider` above these providers to interpose a
 * pre-connect gate (e.g. the LP terms attestation); omit it (the Trustee's
 * choice) to connect directly.
 *
 * Do NOT import wagmi, viem, @reown/appkit, @tanstack/react-query,
 * @creit.tech/stellar-wallets-kit, or @stellar/stellar-sdk directly from
 * outside this package — the ESLint `no-restricted-imports` rule enforces
 * this boundary (mirrors `packages/frontend/src/wallet/index.ts`, TD-33).
 */

// ── Config ───────────────────────────────────────────────────────────────────
export {
  setWalletConnectConfig,
  getWalletConnectConfig,
  _resetWalletConnectConfigForTests,
} from "./config";
export type { WalletConnectConfig } from "./config";

// ── Gate (optional, injectable) ───────────────────────────────────────────────
export { WalletGateContext, useWalletGate } from "./WalletGateContext";
export type { WalletGateContextValue } from "./WalletGateContext";

// ── EVM namespace ─────────────────────────────────────────────────────────────
export { EvmWalletProvider } from "./evm/EvmWalletProvider";
export {
  useEvmWallet,
  useContractRead,
  useEvmConnectors,
} from "./evm/useEvmWallet";
export type {
  WalletState,
  UseContractReadArgs,
  ContractReadResult,
  UseEvmConnectorsResult,
  EvmWalletConnectorId,
} from "./evm/useEvmWallet";
export {
  isMockKeyPresent,
  readMock,
  useMock,
  subscribeMock,
  parseJson,
} from "./evm/mock";

// ── Stellar namespace ─────────────────────────────────────────────────────────
export { StellarWalletProvider } from "./stellar/StellarWalletProvider";
export {
  useStellarWallet,
  useStellarConnectors,
} from "./stellar/useStellarWallet";
export type {
  StellarWalletState,
  UseStellarConnectorsResult,
  SorobanWalletId,
} from "./stellar/useStellarWallet";

// ── Connect-modal (shared single instance) ────────────────────────────────────
export { ConnectModalProvider } from "./ConnectModalProvider";
export { useConnectModal } from "./ConnectModalContext";
export type { ConnectModalContextValue } from "./ConnectModalContext";
export { ConnectWalletModal } from "./ConnectWalletModal";
export type { ConnectWalletModalProps, WalletTab } from "./ConnectWalletModal";
