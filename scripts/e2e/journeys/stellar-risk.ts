// Stellar Risk Council journey: pause → the LP's calls refused → unpause → the same calls succeed; then a second loan: Default refused for other keys → Default → write down → close; see docs/e2e.md "Risk Council".

import { setTimeout as sleep } from "node:timers/promises";
import type { Journey } from "../lib/journey";
import { addr, friendbot, i128, invoke, Keypair, read, stackKey } from "../lib/stellar";
import { CHAIN, ONE, until, world, type World } from "../lib/stellar-world";
import { encodeRiskCouncilArgs } from "../../../packages/wallet-connect/src/stellar/contracts/riskCouncil";
import { u32 } from "../../../packages/wallet-connect/src/stellar/contracts/scval";
import loan, { chain, execute, ids } from "./stellar-loan";
import lp, { claimArgs, voucher } from "./stellar-lp";
import { rejection, riskApi, riskChecks } from "./risk-checks";

const DEPOSIT = 20n * ONE;
const STAKE = 8n * ONE;
const SHARES = 5n * ONE;
const WITHDRAW = 5n * ONE;
/** The loan journey's steps that take a loan to Performing; they run on a scratch record, the loan journey's own figures stay as they are. */
const ORIGINATE = ["submit and approve", "draw", "debt token", "wire in and disburse"];

type Entry = Record<string, any>;
let w: World;
let council: Keypair;
let loanId = 0;
let pending: { id: bigint; voucher: Awaited<ReturnType<typeof voucher>> };
const me = () => w.lp.publicKey();
const api = riskApi(CHAIN,() => w.trusteeToken, () => loanId);
const targets = () => ({ deposit: w.env.VITE_STELLAR_DEPOSIT_MANAGER_ID, vault: w.env.VITE_STELLAR_STAKED_PLUSD_ID, queue: w.env.VITE_STELLAR_WITHDRAWAL_QUEUE_ID });

/** What the LP does with each contract; a paused one rejects its call. */
async function attempt(): Promise<Record<string, string | null>> {
  const { deposit, vault, queue } = targets();
  const lpAll = [addr(me()), addr(me()), addr(me())];
  const ops: Record<string, () => Promise<unknown>> = {
    "deposit request": () => invoke(w.lp, deposit, "request_deposit", [addr(me()), i128(DEPOSIT)]),
    stake: () => invoke(w.lp, vault, "deposit", [i128(STAKE), ...lpAll]),
    unstake: () => invoke(w.lp, vault, "redeem", [i128(SHARES), ...lpAll]),
    "withdrawal request": () => invoke(w.lp, queue, "request_withdrawal", [addr(me()), i128(WITHDRAW)]),
    "withdrawal claim": () => invoke(w.lp, queue, "claim_request", claimArgs(pending.id, pending.voucher)),
  };
  const errors: Record<string, string | null> = {};
  for (const [name, op] of Object.entries(ops)) errors[name] = await rejection(op);
  return errors;
}

const pausedFlags = async () => Object.fromEntries(await Promise.all(Object.entries(targets()).map(async ([k, id]) => [k, await read<boolean>(me(), id, "paused")])));

/** Pause and unpause go through the AccessManager's `execute`; the target receives the AccessManager as its caller argument. */
const setPaused = async (signer: Keypair, fn: "pause" | "unpause") => {
  for (const target of Object.values(targets())) await execute(signer, target, fn, [addr(ids().am)]);
};

async function yieldFigures() {
  const { vault } = ids();
  return {
    vaultAssets: (await chain<bigint>(vault, "total_assets")).toString(),
    mintedYield: (await api.financials()).minted_yield,
    weightedRate: (await api.book()).weighted_rate,
    cumulativeYield: await api.cumulativeYield(),
  };
}

const journey: Journey = {
  chain: "stellar",
  name: "risk",
  steps: [
    {
      name: "world",
      run: async (ctx) => {
        for (const s of [lp.steps[0], loan.steps[0]]) await s.run(ctx);
        w = await world(ctx.tag, ctx.recorded);
        council = stackKey(ctx.tag, "risk-council");
      },
    },
    {
      name: "prepare the LP",
      run: async () => {
        // PLUSD to stake and an unclaimed withdrawal request to claim while paused; the LP is KYC'd by the LP journey.
        const { deposit, queue } = targets();
        const depositId = (await invoke(w.lp, deposit, "request_deposit", [addr(me()), i128(DEPOSIT)])) as bigint;
        await invoke(w.lp, deposit, "claim_request", claimArgs(depositId, await voucher("deposits", depositId)));
        const [id] = (await invoke(w.lp, queue, "request_withdrawal", [addr(me()), i128(WITHDRAW)])) as [bigint, bigint];
        pending = { id, voucher: await voucher("withdrawals", id) };
      },
    },
    {
      name: "pause",
      run: async ({ recorded }) => {
        await setPaused(council, "pause");
        recorded["risk.pause"] = { by: council.publicKey(), paused: await pausedFlags(), errors: await attempt() };
      },
    },
    {
      name: "unpause",
      run: async ({ recorded }) => {
        // The pinned justfile maps `pause` to PAUSER and leaves `unpause` to ADMIN, which the deployer holds.
        await setPaused(w.deployer, "unpause");
        recorded["risk.unpause"] = { by: w.deployer.publicKey(), paused: await pausedFlags(), errors: await attempt() };
      },
    },
    {
      name: "second loan",
      run: async (ctx) => {
        const scratch: Record<string, Entry> = {};
        for (const s of loan.steps.filter((x) => ORIGINATE.includes(x.name))) await s.run({ ...ctx, recorded: scratch });
        loanId = scratch["loan.draw"].loanId;
      },
    },
    {
      name: "default refused",
      run: async ({ tag, recorded }) => {
        const originator = Keypair.random();
        await friendbot(originator.publicKey());
        const attempts = [];
        for (const [who, key] of [["trustee", stackKey(tag, "trustee")], ["originator", originator]] as const)
          attempts.push({ who, error: await rejection(() => execute(key, ids().registry, "set_default", encodeRiskCouncilArgs({ fn: "set_default", loanId }))) });
        const m = await chain<Entry>(ids().registry, "mutable_loan_data", [u32(loanId)]);
        recorded["risk.defaultRefused"] = { attempts, statusAfter: m.status[0] };
      },
    },
    {
      name: "default",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const before = await api.defaulted();
        await execute(council, registry, "set_default", encodeRiskCouncilArgs({ fn: "set_default", loanId }));
        const money = await chain<Entry>(registry, "loan_money", [u32(loanId)]);
        const status = (await chain<Entry>(registry, "mutable_loan_data", [u32(loanId)])).status[0];
        const entry = await until("the API to show the loan defaulted", async () => {
          const e = await api.entry();
          return e?.onchain_status === "Default" && (await api.defaulted()) === before + 1 ? e : undefined;
        });
        const detail = await api.financials();
        recorded["risk.default"] = {
          chain: { status, outstanding6: ((money.outstanding as bigint) / 10n).toString() },
          api: { book: entry.onchain_status, detail: [detail.status, detail.onchain_status], attention: [before, await api.defaulted()], atRiskSenior: (await api.book()).at_risk_wl_and_default_senior },
        };
        const first = await yieldFigures();
        await sleep(15_000);
        recorded["risk.noYield"] = { after: first, later: await yieldFigures() };
      },
    },
    {
      name: "write down and close",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const outstanding = (await chain<Entry>(registry, "loan_money", [u32(loanId)])).outstanding as bigint;
        await execute(council, registry, "write_down", encodeRiskCouncilArgs({ fn: "write_down", loanId, amount: outstanding.toString() }));
        await execute(council, registry, "close_defaulted", encodeRiskCouncilArgs({ fn: "close_defaulted", loanId, reason: "Default" }));
        const m = await chain<Entry>(registry, "mutable_loan_data", [u32(loanId)]);
        const defaulted = await until("the API to show the loan closed", async () => ((await api.entry())?.onchain_status === "Closed" ? api.defaulted() : undefined));
        const detail = await api.financials();
        recorded["risk.close"] = {
          chain: { status: m.status[0], reason: m.closure_reason[0], writtenDown: m.written_down.toString(), outstanding: outstanding.toString() },
          api: { detail: [detail.status, detail.onchain_status], defaulted, defaultedBefore: (recorded["risk.default"] as Entry).api.attention[0] },
        };
      },
    },
  ],
  checks: riskChecks("stellar"),
};

export default journey;
