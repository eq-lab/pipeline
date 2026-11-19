// EVM Risk Council journey: pause → the LP's calls refused → unpause → the same calls succeed; then a second loan: Default refused for other keys → Default → write down → close; see docs/e2e.md "Risk Council".

import { setTimeout as sleep } from "node:timers/promises";
import { parseAbi, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Journey } from "../lib/journey";
import { anvil, EVM_CHAIN, evmWorld, read, revertName, send, views, type EvmWorld } from "../lib/evm-world";
import { until } from "../lib/stellar-world";
import { depositManagerAbi } from "../../../packages/frontend/src/wallet/evm/abis/depositManager";
import { erc20Abi } from "../../../packages/frontend/src/wallet/evm/abis/erc20";
import { stakedPlusdAbi } from "../../../packages/frontend/src/wallet/evm/abis/stakedPlusd";
import { withdrawalQueueAbi } from "../../../packages/frontend/src/wallet/evm/abis/withdrawalQueue";
import loan, { chain, CLOSURE, ids, role, STATUS, trusteeTokenOf } from "./evm-loan";
import lp, { voucher } from "./evm-lp";
import { rejection, riskApi, riskChecks } from "./risk-checks";

/** The pinned contracts' anvil minimum deposit (`DepositManager__MinDeposit`, 1000 USDC): a smaller request reverts `DepositManagerLessThanMinAmount`. */
const DEPOSIT = 1_000_000_000n;
const STAKE = 40_000_000n;
const SHARES = 10_000_000n;
const WITHDRAW = 20_000_000n;
/** The loan journey's steps that take a loan to Performing; they run on a scratch record, the loan journey's own figures stay as they are. */
const ORIGINATE = ["submit and approve", "draw", "deal tokens", "wire in and disburse"];

const riskAbi = parseAbi([
  "function setDefault(uint256 loanId)",
  "function writeDown(uint256 loanId, uint256 amount)",
  "function closeDefaulted(uint256 loanId, uint8 reason)",
  "function paused() view returns (bool)",
  "function pause()",
  "function unpause()",
]);

type Entry = Record<string, any>;
let w: EvmWorld;
let council: PrivateKeyAccount;
let loanId = 0n;
let pending: { id: bigint; signature: Hex };
const me = () => w.lp.address;
const api = riskApi(EVM_CHAIN, trusteeTokenOf, () => loanId);
const targets = (): Record<string, Address> => ({ deposit: w.dm, plusd: w.plusd, vault: w.vault, queue: w.wq });

/** What the LP does with each contract; a paused one rejects its call. The allowances are set in "prepare the LP". */
async function attempt(): Promise<Record<string, string | null>> {
  const ops: Record<string, () => Promise<unknown>> = {
    "deposit request": () => send(w.lp, w.dm, depositManagerAbi, "requestDeposit", [DEPOSIT]),
    stake: () => send(w.lp, w.vault, stakedPlusdAbi, "deposit", [STAKE, me()]),
    unstake: () => send(w.lp, w.vault, stakedPlusdAbi, "redeem", [SHARES, me(), me()]),
    "withdrawal request": () => send(w.lp, w.wq, withdrawalQueueAbi, "requestWithdrawal", [WITHDRAW]),
    "withdrawal claim": () => send(w.lp, w.wq, withdrawalQueueAbi, "claimWithdrawal", [pending.id, pending.signature]),
  };
  const errors: Record<string, string | null> = {};
  for (const [name, op] of Object.entries(ops)) errors[name] = await rejection(op);
  return errors;
}

const pausedFlags = async () => Object.fromEntries(await Promise.all(Object.entries(targets()).map(async ([k, a]) => [k, await read<boolean>(a, "paused", [], riskAbi)])));

async function yieldFigures() {
  return {
    vaultAssets: (await chain<bigint>(ids().vault, "totalAssets")).toString(),
    mintedYield: (await api.financials()).minted_yield,
    weightedRate: (await api.book()).weighted_rate,
    cumulativeYield: await api.cumulativeYield(),
  };
}

const journey: Journey = {
  chain: "evm",
  name: "risk",
  steps: [
    {
      name: "world",
      run: async (ctx) => {
        for (const s of [lp.steps[0], loan.steps[0]]) await s.run(ctx);
        w = await evmWorld(ctx.tag, ctx.recorded);
        council = privateKeyToAccount(w.env.E2E_EVM_RISK_COUNCIL_KEY as Hex);
      },
    },
    {
      name: "prepare the LP",
      run: async () => {
        // Allowances for every call of "attempt" (it runs twice), PLUSD to stake and an unclaimed withdrawal request to claim while paused; the LP is KYC'd by the LP journey.
        // The LP journey leaves the LP less USDC than the two minimum deposits made here (this one and the one after unpause).
        await anvil.request({ method: "anvil_dealERC20", params: [me(), w.usdc, toHex((await read<bigint>(w.usdc, "balanceOf", [me()])) + 2n * DEPOSIT)] } as never);
        await send(w.lp, w.usdc, erc20Abi, "approve", [w.dm, 2n * DEPOSIT]);
        await send(w.lp, w.plusd, erc20Abi, "approve", [w.vault, 2n * STAKE]);
        await send(w.lp, w.plusd, erc20Abi, "approve", [w.wq, 3n * WITHDRAW]);
        await send(w.custodian, w.usdc, views, "approve", [w.wq, 10n * WITHDRAW]);
        const depositId = await send<bigint>(w.lp, w.dm, depositManagerAbi, "requestDeposit", [DEPOSIT]);
        await send(w.lp, w.dm, depositManagerAbi, "claimDeposit", [depositId, (await voucher("deposits", depositId)).signature]);
        const [id] = await send<[bigint, bigint]>(w.lp, w.wq, withdrawalQueueAbi, "requestWithdrawal", [WITHDRAW]);
        pending = { id, signature: (await voucher("withdrawals", id)).signature };
      },
    },
    {
      name: "pause",
      run: async ({ recorded }) => {
        for (const target of Object.values(targets())) await send(council, target, riskAbi, "pause", []);
        recorded["evm.risk.pause"] = { by: council.address, paused: await pausedFlags(), errors: await attempt() };
      },
    },
    {
      name: "unpause",
      run: async ({ recorded }) => {
        for (const target of Object.values(targets())) await send(council, target, riskAbi, "unpause", []);
        recorded["evm.risk.unpause"] = { by: council.address, paused: await pausedFlags(), errors: await attempt() };
      },
    },
    {
      name: "second loan",
      run: async (ctx) => {
        const scratch: Record<string, Entry> = {};
        for (const s of loan.steps.filter((x) => ORIGINATE.includes(x.name))) await s.run({ ...ctx, recorded: scratch });
        loanId = BigInt(scratch["evm.loan.draw"].loanId);
      },
    },
    {
      name: "default refused",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const attempts = [];
        // The registry manager held the risk actions before the stack moved them to the council; the originator holds nothing.
        for (const [who, key] of [["loan registry manager", role("LoanRegistryManager")], ["originator", privateKeyToAccount(generatePrivateKey())]] as const)
          attempts.push({ who, error: await rejection(() => send(key, registry, riskAbi, "setDefault", [loanId]), revertName) });
        recorded["evm.risk.defaultRefused"] = { attempts, statusAfter: STATUS[(await chain<Entry>(registry, "mutableLoanData", [loanId])).status] };
      },
    },
    {
      name: "default",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const before = await api.defaulted();
        await send(council, registry, riskAbi, "setDefault", [loanId]);
        const money = await chain<Entry>(registry, "loanMoney", [loanId]);
        const status = STATUS[(await chain<Entry>(registry, "mutableLoanData", [loanId])).status];
        const entry = await until("the API to show the loan defaulted", async () => {
          const e = await api.entry();
          return e?.onchain_status === "Default" && (await api.defaulted()) === before + 1 ? e : undefined;
        });
        const detail = await api.financials();
        recorded["evm.risk.default"] = {
          chain: { status, outstanding6: money.outstanding.toString() },
          api: { book: entry.onchain_status, detail: [detail.status, detail.onchain_status], attention: [before, await api.defaulted()], atRiskSenior: (await api.book()).at_risk_wl_and_default_senior },
        };
        const first = await yieldFigures();
        await sleep(15_000);
        recorded["evm.risk.noYield"] = { after: first, later: await yieldFigures() };
      },
    },
    {
      name: "write down and close",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const outstanding = (await chain<Entry>(registry, "loanMoney", [loanId])).outstanding as bigint;
        await send(council, registry, riskAbi, "writeDown", [loanId, outstanding]);
        await send(council, registry, riskAbi, "closeDefaulted", [loanId, CLOSURE.indexOf("Default")]);
        const m = await chain<Entry>(registry, "mutableLoanData", [loanId]);
        const defaulted = await until("the API to show the loan closed", async () => ((await api.entry())?.onchain_status === "Closed" ? api.defaulted() : undefined));
        const detail = await api.financials();
        recorded["evm.risk.close"] = {
          chain: { status: STATUS[m.status], reason: CLOSURE[m.closureReason], writtenDown: m.writtenDown.toString(), outstanding: outstanding.toString() },
          api: { detail: [detail.status, detail.onchain_status], defaulted, defaultedBefore: (recorded["evm.risk.default"] as Entry).api.attention[0] },
        };
      },
    },
  ],
  checks: riskChecks("evm"),
};

export default journey;
