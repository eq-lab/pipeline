/**
 * Stellar Wallets Kit singleton initialisation.
 *
 * This is the ONLY file that imports `@creit.tech/stellar-wallets-kit` directly.
 * All other files in this module import the re-exported `StellarWalletsKit`
 * from here — never from the library root — so that tests can mock this module
 * cleanly without touching the kit's DOM registration machinery.
 *
 * The static `StellarWalletsKit.init(...)` call at module load mirrors the
 * pattern used by `evm/config.ts` (`createAppKit` at module scope).
 *
 * NOTE: A WalletConnect-for-Stellar module requires a `projectId` and is
 * therefore NOT included in `defaultModules()`. It can be added in a later
 * iteration by passing a custom modules array.
 */
import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { kitNetwork } from "./chain";

const modules = defaultModules();
StellarWalletsKit.init({
  network: kitNetwork,
  modules,
  // selectedWalletId is left unset — authModal lets the user pick.
});

/* eslint-disable no-restricted-syntax */
export const E2E_WALLET_ID: string | undefined =
  import.meta.env.DEV &&
  import.meta.env.VITE_E2E_WALLET &&
  kitNetwork === Networks.STANDALONE
    ? "pipeline-e2e-wallet"
    : undefined;

if (import.meta.env.DEV && E2E_WALLET_ID)
  void import("@pipeline/wallet-connect/e2e-wallet").then(
    ({ e2eWalletModule }) => {
      const e2e = e2eWalletModule(import.meta.env, kitNetwork);
      if (e2e)
        StellarWalletsKit.init({
          network: kitNetwork,
          modules: [...modules, e2e],
        });
    },
  );
/* eslint-enable no-restricted-syntax */

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
