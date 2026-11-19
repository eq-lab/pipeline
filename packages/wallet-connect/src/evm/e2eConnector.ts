// E2E test wallet: a wagmi connector signing with the e2e run's generated key, on the local anvil chain (31337) only; see packages/frontend/src/wallet/README.md "E2E test wallet".

import { createConnector, type CreateConnectorFn } from "@wagmi/core";
import {
  createWalletClient,
  type Hex,
  hexToBigInt,
  http,
  numberToHex,
  SwitchChainError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const E2E_EVM_WALLET_ID = "pipeline-e2e-evm-wallet";
export const E2E_EVM_CHAIN_ID = 31337;

export interface E2EEvmWalletEnv {
  DEV?: boolean;
  VITE_E2E_WALLET?: string;
  E2E_EVM_WALLET_KEY?: string;
}

interface RpcTx {
  to?: Hex;
  data?: Hex;
  value?: Hex;
  gas?: Hex;
}

export function e2eEvmConnector(
  env: E2EEvmWalletEnv,
  chainId: number,
): CreateConnectorFn | undefined {
  if (env.DEV !== true || !env.VITE_E2E_WALLET || chainId !== E2E_EVM_CHAIN_ID)
    return undefined;
  if (!env.E2E_EVM_WALLET_KEY)
    throw new Error(
      "VITE_E2E_WALLET is set but E2E_EVM_WALLET_KEY is not: start the LP app through scripts/e2e/up.sh",
    );
  const account = privateKeyToAccount(env.E2E_EVM_WALLET_KEY as Hex);
  let connected = false;
  return createConnector((config) => {
    const chain = config.chains.find((c) => c.id === E2E_EVM_CHAIN_ID)!;
    const node = createWalletClient({
      account,
      chain,
      transport: http(chain.rpcUrls.default.http[0]),
    });
    const provider = {
      async request({ method, params }: { method: string; params?: unknown }) {
        const p = (params ?? []) as unknown[];
        switch (method) {
          case "eth_accounts":
          case "eth_requestAccounts":
            return [account.address];
          case "eth_chainId":
            return numberToHex(E2E_EVM_CHAIN_ID);
          case "personal_sign":
            return account.signMessage({ message: { raw: p[0] as Hex } });
          case "eth_sendTransaction": {
            const tx = p[0] as RpcTx;
            return node.sendTransaction({
              to: tx.to,
              data: tx.data,
              value: tx.value && hexToBigInt(tx.value),
              gas: tx.gas && hexToBigInt(tx.gas),
            });
          }
          default:
            return node.request({ method, params } as never);
        }
      },
    };
    return {
      id: E2E_EVM_WALLET_ID,
      name: "E2E test wallet",
      type: "e2e",
      async connect() {
        connected = true;
        return {
          accounts: [account.address],
          chainId: E2E_EVM_CHAIN_ID,
        } as never;
      },
      async disconnect() {
        connected = false;
      },
      async getAccounts() {
        return connected ? [account.address] : [];
      },
      async getChainId() {
        return E2E_EVM_CHAIN_ID;
      },
      async getProvider() {
        return provider;
      },
      async isAuthorized() {
        return connected;
      },
      async switchChain({ chainId: id }) {
        if (id !== E2E_EVM_CHAIN_ID)
          throw new SwitchChainError(
            new Error(
              `the e2e test wallet is on chain ${E2E_EVM_CHAIN_ID} only`,
            ),
          );
        return chain;
      },
      onAccountsChanged() {},
      onChainChanged() {},
      onDisconnect() {
        connected = false;
        config.emitter.emit("disconnect");
      },
    };
  });
}
