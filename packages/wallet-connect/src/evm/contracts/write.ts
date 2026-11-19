// spec: docs/frontend/wallet-flows.md#trustee-evm-contract-client
import {
  getConnection,
  getPublicClient,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "@wagmi/core";
import type { Abi, Address, Hex, TransactionReceipt } from "viem";
import type { RelayStage } from "../../stellar/contracts/accessManager";
import { initEvmWalletConnect } from "../config";
import { parseAddress, readMock } from "../mock";

export const EVM_TX_GAS_CAP = 16_777_215n;

const MOCK_ADDRESS_KEY = "pipeline.mock.wallet.address";

export interface ReadEvmContractParams {
  abi: Abi;
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
}

export interface SendEvmContractCallParams extends ReadEvmContractParams {
  account: string;
  chainId: number;
  value?: bigint;
  onStageChange?: (stage: RelayStage) => void;
}

export interface SendEvmContractCallResult {
  hash: Hex;
  receipt: TransactionReceipt;
}

function shortAddress(address: string): string {
  return address.length <= 12
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function readEvmContract<T = unknown>({
  abi,
  address,
  functionName,
  args = [],
  blockNumber,
}: ReadEvmContractParams): Promise<T> {
  return readContract(initEvmWalletConnect(), {
    abi,
    address,
    functionName,
    args,
    ...(blockNumber === undefined ? {} : { blockNumber }),
  } as never) as Promise<T>;
}

export async function sendEvmContractCall({
  abi,
  address,
  functionName,
  args = [],
  account,
  chainId,
  value,
  onStageChange,
}: SendEvmContractCallParams): Promise<SendEvmContractCallResult> {
  if (readMock(MOCK_ADDRESS_KEY, parseAddress) !== undefined) {
    throw new Error(
      "[wallet mock] EVM writes are not mockable; connect a real wallet",
    );
  }
  const config = initEvmWalletConnect();
  const connection = getConnection(config);
  if (!connection.address) throw new Error("EVM wallet not connected.");
  if (connection.address.toLowerCase() !== account.toLowerCase()) {
    throw new Error(
      `The connected EVM wallet changed. Reconnect ${shortAddress(account)}.`,
    );
  }
  if (connection.chainId !== chainId) {
    await switchChain(config, { chainId });
  }

  const request = {
    abi,
    address,
    functionName,
    args,
    account: connection.address,
    chainId,
    ...(value === undefined ? {} : { value }),
  };
  await simulateContract(config, request as never);
  const publicClient = getPublicClient(config, { chainId });
  if (!publicClient) throw new Error("RPC not ready");
  const estimated = await publicClient.estimateContractGas(request as never);
  const buffered = (estimated * 12n) / 10n;
  const gas = buffered > EVM_TX_GAS_CAP ? EVM_TX_GAS_CAP : buffered;

  onStageChange?.("awaiting-signature");
  const hash = await writeContract(config, { ...request, gas } as never);
  onStageChange?.("confirming");
  const receipt = await waitForTransactionReceipt(config, { hash, chainId });
  if (receipt.status !== "success") {
    throw new Error(`transaction reverted: ${hash}`);
  }
  return { hash, receipt };
}
