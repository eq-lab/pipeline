// E2E test wallet: a Stellar Wallets Kit module signing with the e2e run's generated key, on the local standalone network only; see packages/frontend/src/wallet/README.md "E2E test wallet".

import {
  ModuleType,
  type ModuleInterface,
} from "@creit.tech/stellar-wallets-kit/types";
import {
  hash,
  Keypair,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

export const E2E_WALLET_ID = "pipeline-e2e-wallet";

export interface E2EWalletEnv {
  DEV?: boolean;
  VITE_E2E_WALLET?: string;
  E2E_WALLET_SECRET?: string;
}

export function e2eWalletModule(
  env: E2EWalletEnv,
  passphrase: string,
): ModuleInterface | undefined {
  if (
    env.DEV !== true ||
    !env.VITE_E2E_WALLET ||
    passphrase !== Networks.STANDALONE
  )
    return undefined;
  if (!env.E2E_WALLET_SECRET)
    throw new Error(
      "VITE_E2E_WALLET is set but E2E_WALLET_SECRET is not: start the LP app through scripts/e2e/up.sh",
    );
  const key = Keypair.fromSecret(env.E2E_WALLET_SECRET);
  const address = key.publicKey();
  const standalone = (opts?: { networkPassphrase?: string }) => {
    if (
      opts?.networkPassphrase &&
      opts.networkPassphrase !== Networks.STANDALONE
    )
      throw {
        code: -3,
        message: `the e2e test wallet signs on the standalone network only, not "${opts.networkPassphrase}"`,
      };
  };
  const unsupported = async () => {
    throw {
      code: -3,
      message: "the e2e test wallet does not support this function",
    };
  };
  return {
    moduleType: ModuleType.HOT_WALLET,
    productId: E2E_WALLET_ID,
    productName: "E2E test wallet",
    productUrl: "",
    productIcon: "",
    isAvailable: async () => true,
    getAddress: async () => ({ address }),
    signTransaction: async (xdr, opts) => {
      standalone(opts);
      const tx = TransactionBuilder.fromXDR(xdr, Networks.STANDALONE);
      tx.sign(key);
      return { signedTxXdr: tx.toXDR(), signerAddress: address };
    },
    signMessage: async (message, opts) => {
      standalone(opts);
      const digest = hash(
        new TextEncoder().encode(
          `Stellar Signed Message:\n${message}`,
        ) as Buffer,
      );
      return {
        signedMessage: key.sign(digest).toString("base64"),
        signerAddress: address,
      };
    },
    signAuthEntry: unsupported,
    getNetwork: async () => ({
      network: "standalone",
      networkPassphrase: Networks.STANDALONE,
    }),
  };
}
