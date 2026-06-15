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
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { kitNetwork } from "./chain";

StellarWalletsKit.init({
  network: kitNetwork,
  modules: defaultModules(),
  // selectedWalletId is left unset — authModal lets the user pick.
});

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
