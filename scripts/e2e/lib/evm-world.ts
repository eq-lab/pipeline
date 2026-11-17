// Shared world of the EVM journeys on anvil (31337): chain access, a funded LP with a linked EVM address, and its KYC; see docs/e2e.md "EVM world".

import { join } from "node:path";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http as rpc,
  parseAbi,
  toHex,
  type Abi,
  type Account,
  type Address,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { PORTS } from "./env";
import { EVM_CHAIN_ID } from "./guard";
import type { Recorded } from "./journey";
import { readJson, stackDir } from "./stack";
import { signupLp, sumsubGreen, until } from "./stellar-world";

export const EVM_CHAIN = `chain_id=${EVM_CHAIN_ID}`;
const LP_USDC = 2_000_000_000n;
const LP_ETH = 10n ** 20n;

const transport = rpc(`http://localhost:${PORTS.evm}`);
const anvil = createPublicClient({ chain: foundry, transport });
const wallet = createWalletClient({ chain: foundry, transport });

export const views = parseAbi([
  "function usdc() view returns (address)",
  "function plUsd() view returns (address)",
  "function custodian() view returns (address)",
  "function assetHolder() view returns (address)",
  "function nextRequestId() view returns (uint256)",
  "function requests(uint256) view returns ((uint256 amount, address user, uint88 timestamp, bool claimed))",
  "function queueMetadata() view returns (uint256 totalQueued, uint256 totalClaimed)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function isAllowed(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function outstandingTotal() view returns (uint256)",
  "function transfer(address, uint256) returns (bool)",
  "function approve(address, uint256) returns (bool)",
]);

export const read = <T>(address: Address, functionName: string, args: unknown[] = []) =>
  anvil.readContract({ address, abi: views, functionName, args } as never) as Promise<T>;

/** Simulates then sends a call from `from` (a local key, or an address anvil holds unlocked); returns the simulated result. */
export async function send<T = unknown>(from: Account | Address, address: Address, abi: Abi, functionName: string, args: unknown[]): Promise<T> {
  const { request, result } = await anvil.simulateContract({ account: from, address, abi, functionName, args } as never);
  const hash = await wallet.writeContract(request as never);
  const receipt = await anvil.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  return result as T;
}

/** The custom error a failed call reverted with, else the start of its message. */
export function revertName(e: unknown): string {
  const reverted = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : undefined;
  return (reverted as ContractFunctionRevertedError | undefined)?.data?.errorName ?? String(e instanceof Error ? e.message : e).slice(0, 300);
}

export interface EvmWorld {
  env: Record<string, string>;
  lp: PrivateKeyAccount;
  lpToken: string;
  dm: Address;
  wq: Address;
  vault: Address;
  registry: Address;
  whitelist: Address;
  usdc: Address;
  plusd: Address;
  custodian: Address;
  capital: Address;
}

async function setupEvmWorld(tag: string, recorded: Recorded): Promise<EvmWorld> {
  const env = readJson<Record<string, string>>(join(stackDir(tag), "env.json"));
  const C = `CHAIN_${EVM_CHAIN_ID}`;
  if (!env?.[`${C}_DM_ADDRESS`]) throw new Error(`no EVM chain in ${stackDir(tag)}/env.json: bring the stack up with --chains evm`);
  const dm = env[`${C}_DM_ADDRESS`] as Address;
  const usdc = await read<Address>(dm, "usdc");
  const lp = privateKeyToAccount(generatePrivateKey());
  await anvil.request({ method: "anvil_setBalance", params: [lp.address, toHex(LP_ETH)] } as never);
  await anvil.request({ method: "anvil_dealERC20", params: [lp.address, usdc, toHex(LP_USDC)] } as never);
  recorded["evm.world.accounts"] = { lp: lp.address, usdc: LP_USDC.toString() };
  const lpToken = await signupLp(tag, { chainId: EVM_CHAIN_ID, address: lp.address, sign: (message) => lp.signMessage({ message }) }, recorded, "evm.world.lp");
  return {
    env,
    lp,
    lpToken,
    dm,
    wq: env[`${C}_WQ_ADDRESS`] as Address,
    vault: env.VITE_STAKED_PLUSD_ADDRESS as Address,
    registry: env[`${C}_EVM_API_LOAN_REGISTRY_ADDRESS`] as Address,
    whitelist: env[`${C}_RELAYER_REGISTRY_ADDRESS`] as Address,
    usdc,
    plusd: await read<Address>(dm, "plUsd"),
    custodian: await read<Address>(dm, "custodian"),
    capital: env.VITE_EVM_CAPITAL_WALLET_ADDRESS as Address,
  };
}

let shared: Promise<EvmWorld> | undefined;
/** One EVM world per run, shared by the EVM journeys of the run. */
export const evmWorld = (tag: string, recorded: Recorded): Promise<EvmWorld> => (shared ??= setupEvmWorld(tag, recorded));

/** Sumsub GREEN for the LP's address, then waits until the relayer has allowed it on the WhitelistRegistry. */
export async function passEvmKyc(w: EvmWorld, recorded: Recorded): Promise<void> {
  const status = await sumsubGreen(w.env, EVM_CHAIN_ID, w.lp.address.toLowerCase());
  await until("the relayer to allow the LP on the WhitelistRegistry", async () => (await read<boolean>(w.whitelist, "isAllowed", [w.lp.address])) || undefined);
  recorded["evm.world.kyc"] = { ...status, whitelisted: true };
}
