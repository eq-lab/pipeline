// spec: docs/frontend/wallet-flows.md#chain-registry
import { defineEvmChain } from "@pipeline/wallet-connect";
import { ENV } from "@/lib/env";

export const evmChain = defineEvmChain(ENV.EVM_CHAIN_ID, ENV.EVM_RPC_URL);
