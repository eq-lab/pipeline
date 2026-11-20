// The Stellar e2e test wallet in the Operations Console: a vite dev server, VITE_E2E_WALLET and the standalone passphrase only; see packages/frontend/src/wallet/README.md "E2E test wallet".

import { registerStellarE2EWallet } from "@pipeline/wallet-connect";
import type { E2EWalletEnv } from "@pipeline/wallet-connect/e2e-wallet";
import { ENV } from "@/lib/env";

/* eslint-disable no-restricted-syntax -- the literal import.meta.env.DEV lets a production build drop the import() */
export async function loadE2EWallet(
  env: E2EWalletEnv = import.meta.env,
  passphrase: string = ENV.STELLAR_NETWORK_PASSPHRASE,
): Promise<boolean> {
  if (import.meta.env.DEV && env.VITE_E2E_WALLET) {
    const { e2eWalletModule } =
      await import("@pipeline/wallet-connect/e2e-wallet");
    const module = e2eWalletModule(env, passphrase);
    if (module) registerStellarE2EWallet(module);
    return module !== undefined;
  }
  return false;
}
/* eslint-enable no-restricted-syntax */
