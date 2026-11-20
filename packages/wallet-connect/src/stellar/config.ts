/**
 * Stellar Wallets Kit singleton initialisation.
 *
 * Ported from `packages/frontend/src/wallet/stellar/config.ts` (#791
 * shared-slice extraction). This is the ONLY file in this package that
 * imports `@creit.tech/stellar-wallets-kit` directly. All other files import
 * the re-exported `StellarWalletsKit` from here — never from the library
 * root — so that tests can mock this module cleanly without touching the
 * kit's DOM registration machinery.
 *
 * `initStellarWalletConnect()` calls `StellarWalletsKit.init(...)` on first
 * call, not at module load — a module-scope call would read
 * `getWalletConnectConfig()` (via `./chain`'s `getKitNetwork()`) before the
 * consuming app's `main.tsx` calls `setWalletConnectConfig()` (ES module
 * imports are hoisted and evaluated before the importing module's own body
 * runs). `StellarWalletProvider` calls this on render, memoized so it runs
 * exactly once even under StrictMode's double-render.
 *
 * NOTE: A WalletConnect-for-Stellar module requires a `projectId` and is
 * therefore NOT included in `defaultModules()`. It can be added in a later
 * iteration by passing a custom modules array.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import type { ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { getKitNetwork } from "./chain";

let initialized = false;
let e2eWallet: ModuleInterface | undefined;

function init(): void {
  StellarWalletsKit.init({
    network: getKitNetwork(),
    modules: e2eWallet ? [...defaultModules(), e2eWallet] : defaultModules(),
    // selectedWalletId is left unset — authModal lets the user pick.
  });
}

/** Initialises the StellarWalletsKit singleton on first call. Idempotent. */
export function initStellarWalletConnect(): void {
  if (initialized) return;
  init();
  initialized = true;
}

/**
 * Adds the e2e test wallet module (`./e2eWallet`) to the kit, before or after
 * `initStellarWalletConnect()`. The app decides whether to call it; see
 * packages/frontend/src/wallet/README.md "E2E test wallet".
 */
export function registerStellarE2EWallet(module: ModuleInterface): void {
  e2eWallet = module;
  if (initialized) init();
}

/** The registered e2e test wallet's id; the Connect modal lists it first. */
export function getStellarE2EWalletId(): string | undefined {
  return e2eWallet?.productId;
}

/** Test helper — allows re-initialisation across tests. FOR TESTS ONLY. */
export function _resetStellarWalletConnectForTests(): void {
  initialized = false;
}

// Re-export the singleton class so the hook imports it from here (boundary).
export { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";

// Re-export wallet module ID constants — consumed by useStellarWallet and the
// Connect modal wallet catalogue.  Import from this boundary file, never from
// the kit sub-paths directly (enforced by ESLint no-restricted-imports).
export { LOBSTR_ID } from "@creit.tech/stellar-wallets-kit/modules/lobstr";
export { FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
export { XBULL_ID } from "@creit.tech/stellar-wallets-kit/modules/xbull";
export { HANA_ID } from "@creit.tech/stellar-wallets-kit/modules/hana";
export { ALBEDO_ID } from "@creit.tech/stellar-wallets-kit/modules/albedo";
export { RABET_ID } from "@creit.tech/stellar-wallets-kit/modules/rabet";
