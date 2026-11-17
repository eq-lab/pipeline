// EVM LP journey on anvil: approve + deposit → voucher → claim → stake → redeem → withdrawal (too early, then claim), and the API ↔ chain reconcile; see docs/e2e.md "EVM LP journey".

import type { Address } from "viem";
import type { Journey } from "../lib/journey";
import { EVM_CHAIN, evmWorld, passEvmKyc, read, revertName, send, views, type EvmWorld } from "../lib/evm-world";
import { http, ok, until } from "../lib/stellar-world";
import { depositManagerAbi } from "../../../packages/frontend/src/wallet/evm/abis/depositManager";
import { erc20Abi } from "../../../packages/frontend/src/wallet/evm/abis/erc20";
import { stakedPlusdAbi } from "../../../packages/frontend/src/wallet/evm/abis/stakedPlusd";
import { withdrawalQueueAbi } from "../../../packages/frontend/src/wallet/evm/abis/withdrawalQueue";
import { check, need, same, units, verdict } from "./stellar-lp";

const DEPOSIT = 1_000_000_000n;
const STAKE = 600_000_000n;
const VOUCHER_TTL_S = 86_400;

let w: EvmWorld;
const me = () => w.lp.address;
const balance = (token: Address, holder: Address) => read<bigint>(token, "balanceOf", [holder]);
const claimed = async (queue: Address, id: bigint) => (await read<{ claimed: boolean }>(queue, "requests", [id])).claimed;
const str = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

interface Voucher {
  amount: string;
  user: string;
  signature: `0x${string}`;
  deadline?: string | null;
}
async function voucher(kind: "deposits" | "withdrawals", id: bigint): Promise<Voucher> {
  return until(`the ${kind} voucher of request ${id}`, async () => {
    const r = await http("GET", `/v1/${kind}/${id}/voucher?wallet=${me()}&${EVM_CHAIN}`);
    return r.status === 403 || r.status === 404 ? undefined : (ok(r, `${kind} voucher`) as Voucher);
  });
}
const voucherSeen = (v: Voucher) => ({ amount: v.amount, user: v.user, deadline: v.deadline ?? null, servedAt: Math.floor(Date.now() / 1000) });

const journey: Journey = {
  chain: "evm",
  name: "lp",
  steps: [
    { name: "world", run: async ({ tag, recorded }) => void (w = await evmWorld(tag, recorded)) },
    {
      name: "deposit request",
      run: async ({ recorded }) => {
        const before = await balance(w.usdc, me());
        await send(w.lp, w.usdc, erc20Abi, "approve", [w.dm, DEPOSIT]);
        const id = await send<bigint>(w.lp, w.dm, depositManagerAbi, "requestDeposit", [DEPOSIT]);
        recorded["evm.lp.deposit"] = str({ id, amount: DEPOSIT, usdcDelta: (await balance(w.usdc, me())) - before });
      },
    },
    { name: "kyc", run: ({ recorded }) => passEvmKyc(w, recorded) },
    {
      name: "deposit voucher and claim",
      run: async ({ recorded }) => {
        const dep = recorded["evm.lp.deposit"] as Record<string, string>;
        const id = BigInt(dep.id);
        const v = await voucher("deposits", id);
        const before = await balance(w.plusd, me());
        await send(w.lp, w.dm, depositManagerAbi, "claimDeposit", [id, v.signature]);
        recorded["evm.lp.deposit"] = {
          ...dep,
          voucher: voucherSeen(v),
          plusdDelta: ((await balance(w.plusd, me())) - before).toString(),
          claimedOnChain: await claimed(w.dm, id),
        };
      },
    },
    {
      name: "stake",
      run: async ({ recorded }) => {
        const before = await balance(w.plusd, me());
        await send(w.lp, w.plusd, erc20Abi, "approve", [w.vault, STAKE]);
        const shares = await send<bigint>(w.lp, w.vault, stakedPlusdAbi, "deposit", [STAKE, me()]);
        recorded["evm.lp.stake"] = str({ assets: STAKE, shares, plusdDelta: (await balance(w.plusd, me())) - before, sharesBalance: await balance(w.vault, me()) });
      },
    },
    {
      name: "unstake",
      run: async ({ recorded }) => {
        const shares = BigInt((recorded["evm.lp.stake"] as Record<string, string>).shares) / 3n;
        const before = await balance(w.plusd, me());
        const assets = await send<bigint>(w.lp, w.vault, stakedPlusdAbi, "redeem", [shares, me(), me()]);
        recorded["evm.lp.unstake"] = str({ shares, assets, plusdDelta: (await balance(w.plusd, me())) - before, sharesBalance: await balance(w.vault, me()) });
      },
    },
    {
      name: "withdrawal request, too early",
      run: async ({ recorded }) => {
        // The custodian (the queue's asset holder, unlocked on anvil) moves its USDC out, so the queue cannot pay the request yet.
        const held = await balance(w.usdc, w.custodian);
        if (held > 0n) await send(w.custodian, w.usdc, views, "transfer", [w.capital, held]);
        const amount = await balance(w.plusd, me());
        await send(w.lp, w.plusd, erc20Abi, "approve", [w.wq, amount]);
        const [id] = await send<[bigint, bigint]>(w.lp, w.wq, withdrawalQueueAbi, "requestWithdrawal", [amount]);
        const v = await voucher("withdrawals", id);
        let tooEarly = "claim succeeded";
        try {
          await send(w.lp, w.wq, withdrawalQueueAbi, "claimWithdrawal", [id, v.signature]);
        } catch (e) {
          tooEarly = revertName(e);
        }
        recorded["evm.lp.withdrawal"] = str({ id, amount, custodianMovedOut: held, tooEarly, voucher: voucherSeen(v) });
      },
    },
    {
      name: "withdrawal claim",
      run: async ({ recorded }) => {
        const wd = recorded["evm.lp.withdrawal"] as Record<string, any>;
        const id = BigInt(wd.id);
        await send(w.capital, w.usdc, views, "transfer", [w.custodian, BigInt(wd.custodianMovedOut)]);
        await send(w.custodian, w.usdc, views, "approve", [w.wq, BigInt(wd.amount)]);
        const v = await voucher("withdrawals", id);
        const before = await balance(w.usdc, me());
        await send(w.lp, w.wq, withdrawalQueueAbi, "claimWithdrawal", [id, v.signature]);
        recorded["evm.lp.withdrawal"] = str({
          ...wd,
          expectedUsdc: await read<bigint>(w.wq, "convertToAssets", [BigInt(wd.amount)]),
          usdcDelta: (await balance(w.usdc, me())) - before,
          plusdAfter: await balance(w.plusd, me()),
          claimedOnChain: await claimed(w.wq, id),
        });
      },
    },
    {
      name: "reconcile",
      run: async ({ recorded }) => {
        const wd = recorded["evm.lp.withdrawal"] as Record<string, string>;
        const dep = recorded["evm.lp.deposit"] as Record<string, string>;
        const q = `wallet=${me()}&${EVM_CHAIN}`;
        const requests = await until("the API to index the withdrawal claim", async () => {
          const r = ok(await http("GET", `/v1/requests?${q}&status=all`), "requests").requests as { type: string; request_id?: string; status: string }[];
          return r.some((x) => x.type === "Withdraw" && x.request_id === wd.id && x.status === "Completed") ? r : undefined;
        });
        const next = await read<bigint>(w.dm, "nextRequestId");
        let deposited = 0n;
        let unclaimed = 0n;
        for (let i = 0n; i < next; i++) {
          const r = await read<{ amount: bigint; claimed: boolean }>(w.dm, "requests", [i]);
          deposited += r.amount;
          if (!r.claimed) unclaimed += r.amount;
        }
        const [wqQueued, wqClaimed] = await read<[bigint, bigint]>(w.wq, "queueMetadata");
        const withdrawnUsdc = await read<bigint>(w.wq, "convertToAssets", [wqClaimed]);
        type Item = { amount: string; status: string };
        const sum = (rows: { amount: string }[]) => rows.reduce((s, x) => s + units(x.amount, 6), 0n).toString();
        const tvl = deposited - withdrawnUsdc;
        const reads = async () => ({
          queue: ok(await http("GET", `/v1/withdrawal-queue?${EVM_CHAIN}`), "withdrawal queue"),
          summary: ok(await http("GET", `/v1/dashboard/summary?${EVM_CHAIN}`), "dashboard summary"),
        });
        // /v1/requests shows the claim before the queue events and the PLUSD burn are indexed; an API that never catches up is left to the checks.
        const { queue, summary } = await until(
          "the withdrawal queue and TVL to show the claim",
          async () => {
            const r = await reads();
            const claimedSeen = sum((r.queue.items as Item[]).filter((x) => x.status === "Completed")) === wqClaimed.toString();
            return claimedSeen && units(String(r.summary.tvl), 6) === tvl ? r : undefined;
          },
          30_000,
        ).catch(reads);
        const pnl = ok(await http("GET", `/v1/pnl?${q}`), "pnl");
        const fp = ok(await http("GET", `/v1/financial-position?${EVM_CHAIN}`), "financial position");
        const position = (pnl.positions as { vault_address: string; shares_balance: string }[]).find((p) => p.vault_address.toLowerCase() === w.vault.toLowerCase());
        const items = queue.items as Item[];
        recorded["evm.reconcile"] = {
          tvl: { api: summary.tvl, chain: tvl.toString() },
          plusdSupply: { apiTvl: summary.tvl, chainUnclaimedDeposits: unclaimed.toString(), chainSupply: (await read<bigint>(w.plusd, "totalSupply")).toString() },
          positions: {
            apiShares: position?.shares_balance ?? null,
            chainShares: (await balance(w.vault, me())).toString(),
            apiDeposit: requests.find((x) => x.type === "Deposit" && x.request_id === dep.id)?.status ?? null,
            apiWithdrawal: requests.find((x) => x.type === "Withdraw" && x.request_id === wd.id)?.status ?? null,
            chainDepositClaimed: dep.claimedOnChain,
            chainWithdrawalClaimed: wd.claimedOnChain,
          },
          withdrawalQueue: {
            api: {
              inQueue: queue.summary.in_queue_usd,
              itemsTotal: sum(items),
              itemsCompleted: sum(items.filter((x) => x.status === "Completed")),
              totalQueued: queue.summary.total_queued,
              totalClaimed: queue.summary.total_claimed,
              rate: queue.summary.rate,
            },
            chain: { totalQueued: wqQueued.toString(), totalClaimed: wqClaimed.toString() },
          },
          financialPosition: {
            api: fp.assets.deployed.secured_loans_outstanding,
            chain: (await read<bigint>(w.registry, "outstandingTotal")).toString(),
          },
        };
      },
    },
  ],
  checks: [],
};

journey.checks = [
  check("evm.lp.onboarding", "LP signs up by email + OTP, links its EVM wallet by personal_sign challenge, passes Sumsub and is allowed on the WhitelistRegistry", (r) => {
    const lp = need(r, "evm.world.lp");
    const kyc = need(r, "evm.world.kyc");
    const green = kyc.sumsub_kyc_status === 2 && kyc.sumsub_review_status === 2 && kyc.sumsub_aml_status === 2;
    const linked = String(lp.linkedAddress).toLowerCase() === String(lp.address).toLowerCase();
    return verdict(lp.emailVerified && linked && green && kyc.whitelisted, `linked ${lp.linkedAddress} for ${lp.address}; kyc ${JSON.stringify(kyc)}`);
  }),
  check("evm.lp.deposit-voucher", "approve + requestDeposit moves the USDC; the API serves an EIP-712 voucher for the request", (r) => {
    const d = need(r, "evm.lp.deposit");
    const v = d.voucher ?? {};
    const user = String(v.user).toLowerCase() === String(need(r, "evm.world.accounts").lp).toLowerCase();
    return verdict(d.usdcDelta === `-${d.amount}` && v.amount === d.amount && user, `USDC moved ${d.usdcDelta} for ${d.amount}; voucher ${JSON.stringify(v)}`);
  }),
  check("evm.lp.voucher-deadline", "EVM deposit and withdrawal vouchers carry a deadline within 24 h (#1798)", (r) => {
    const vouchers = [need(r, "evm.lp.deposit").voucher, need(r, "evm.lp.withdrawal").voucher];
    const valid = vouchers.every((v) => {
      const left = Number(v?.deadline) - v?.servedAt;
      return v?.deadline != null && left > 0 && left <= VOUCHER_TTL_S + 60;
    });
    return { ok: valid, details: `the API returned deadline ${vouchers.map((v) => JSON.stringify(v?.deadline ?? null)).join(" (deposit), ")} (withdrawal)` };
  }),
  check("evm.lp.deposit-claim", "claimDeposit with the voucher mints the deposit in PLUSD", (r) => {
    const d = need(r, "evm.lp.deposit");
    return verdict(d.plusdDelta === d.amount && d.claimedOnChain === true, `PLUSD +${d.plusdDelta} for ${d.amount}; claimed on chain ${d.claimedOnChain}`);
  }),
  check("evm.lp.stake", "Staking PLUSD mints sPLUSD shares", (r) => {
    const s = need(r, "evm.lp.stake");
    return verdict(BigInt(s.shares) > 0n && s.plusdDelta === `-${s.assets}` && s.sharesBalance === s.shares, JSON.stringify(s));
  }),
  check("evm.lp.unstake", "Redeeming sPLUSD returns PLUSD", (r) => {
    const s = need(r, "evm.lp.stake");
    const u = need(r, "evm.lp.unstake");
    return verdict(BigInt(u.assets) > 0n && u.plusdDelta === u.assets && BigInt(u.sharesBalance) === BigInt(s.sharesBalance) - BigInt(u.shares), JSON.stringify(u));
  }),
  check("evm.lp.withdrawal-too-early", "Claiming an unfunded withdrawal reverts with WithdrawalQueueTooEarly", (r) => {
    const wd = need(r, "evm.lp.withdrawal");
    return verdict(wd.tooEarly === "WithdrawalQueueTooEarly", `claim before funding: ${wd.tooEarly}`);
  }),
  check("evm.lp.withdrawal-claim", "Once funded, claimWithdrawal pays USDC at the queue rate and burns the PLUSD", (r) => {
    const wd = need(r, "evm.lp.withdrawal");
    return verdict(BigInt(wd.amount) > 0n && wd.usdcDelta === wd.expectedUsdc && wd.plusdAfter === "0" && wd.claimedOnChain === true, JSON.stringify(wd));
  }),
  check("evm.reconcile.tvl", "Dashboard TVL for 31337 equals deposits requested minus withdrawals paid on chain", (r) => {
    const t = need(r, "evm.reconcile").tvl;
    return same("TVL", t.api, t.chain);
  }),
  check("evm.reconcile.plusd-supply", "PLUSD totalSupply equals the API TVL less unclaimed deposits", (r) => {
    const p = need(r, "evm.reconcile").plusdSupply;
    return verdict(p.apiTvl != null && units(String(p.apiTvl), 6) - BigInt(p.chainUnclaimedDeposits) === BigInt(p.chainSupply), JSON.stringify(p));
  }),
  check("evm.reconcile.positions", "API positions and request statuses match the chain (sPLUSD shares, claimed requests)", (r) => {
    const p = need(r, "evm.reconcile").positions;
    const shares = p.apiShares !== null && Number(p.apiShares) === Number(p.chainShares);
    const statuses = p.apiDeposit === "Completed" && p.chainDepositClaimed === true && p.apiWithdrawal === "Completed" && p.chainWithdrawalClaimed === true;
    return verdict(shares && statuses, JSON.stringify(p));
  }),
  check("evm.reconcile.withdrawal-queue", "/v1/withdrawal-queue items and in-queue amount match the queue's totalQueued and totalClaimed", (r) => {
    const { api, chain } = need(r, "evm.reconcile").withdrawalQueue;
    const queued = BigInt(chain.totalQueued);
    const done = BigInt(chain.totalClaimed);
    const match = BigInt(api.itemsTotal) === queued && BigInt(api.itemsCompleted) === done && same("in_queue_usd", api.inQueue, queued - done).ok;
    return verdict(match, `API ${JSON.stringify(api)} vs chain ${JSON.stringify(chain)}`);
  }),
  check("evm.reconcile.financial-position", "/v1/financial-position secured loans outstanding equals the loan registry's outstandingTotal", (r) => {
    const f = need(r, "evm.reconcile").financialPosition;
    return same("secured_loans_outstanding", f.api, f.chain);
  }),
];

export default journey;
