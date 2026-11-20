// Stellar LP journey: deposit → voucher → claim → stake → unstake → withdrawal (too early, then claim), and the API ↔ chain reconcile; see docs/e2e.md "Stellar LP journey".

import type { Check, Journey, Recorded } from "../lib/journey";
import { addr, bytes, classic, contractError, i128, invoke, pay, read, u128, u64 } from "../lib/stellar";
import { API, CHAIN, http, ok, ONE, passKyc, until, world, type World } from "../lib/stellar-world";
import { PORTS } from "../lib/env";

const DEPOSIT = 100n * ONE;
const STAKE = 60n * ONE;
const RATE_ONE = 1_000_000n;
const VOUCHER_TTL_S = 86_400;

let w: World;
const ids = () => ({
  dm: w.env.VITE_STELLAR_DEPOSIT_MANAGER_ID,
  wq: w.env.VITE_STELLAR_WITHDRAWAL_QUEUE_ID,
  vault: w.env.VITE_STELLAR_STAKED_PLUSD_ID,
  usdc: w.env.VITE_STELLAR_USDC_ID,
  plusd: w.env.CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID,
  registry: w.env.VITE_STELLAR_LOAN_REGISTRY_ID,
});
const me = () => w.lp.publicKey();
const balance = (token: string, holder: string) => read<bigint>(me(), token, "balance", [addr(holder)]);
const str = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

/** A decimal string ("40.000000") as an integer of `places` decimals. */
export function units(s: string, places: number): bigint {
  const [whole, frac = ""] = s.trim().split(".");
  return BigInt(whole + frac.padEnd(places, "0").slice(0, places));
}
/** Stellar raw (7 decimals) in the API's 6-decimal USD unit, truncated the way the API normalizes. */
const usd6 = (raw: bigint) => raw / 10n;

export async function voucher(kind: "deposits" | "withdrawals", id: bigint) {
  return until(`the ${kind} voucher of request ${id}`, async () => {
    const r = await http("GET", `/v1/${kind}/${id}/voucher?wallet=${me()}&${CHAIN}`);
    return r.status === 403 || r.status === 404 ? undefined : (ok(r, `${kind} voucher`) as { amount: string; user: string; signature: string; deadline: string });
  });
}
export const claimArgs =(id: bigint, v: { signature: string; deadline: string }) => [u128(id), bytes(v.signature), u64(BigInt(v.deadline))];

async function plusdSupply(): Promise<bigint> {
  const r = await fetch(`http://localhost:${PORTS.stellar}/assets?asset_code=PLUSD&asset_issuer=${w.plusd.getIssuer()}`);
  const a = (await r.json())._embedded.records[0];
  if (!a) return 0n;
  const parts = [...Object.values(a.balances as Record<string, string>), a.contracts_amount, a.claimable_balances_amount, a.liquidity_pools_amount];
  return parts.filter((p): p is string => typeof p === "string").reduce((s, p) => s + units(p, 7), 0n);
}

const journey: Journey = {
  chain: "stellar",
  name: "lp",
  steps: [
    { name: "world", run: async ({ tag, recorded }) => void (w = await world(tag, recorded)) },
    {
      name: "deposit request",
      run: async ({ recorded }) => {
        const before = await balance(ids().usdc, me());
        const id = (await invoke(w.lp, ids().dm, "request_deposit", [addr(me()), i128(DEPOSIT)])) as bigint;
        recorded["lp.deposit"] = str({ id, amount: DEPOSIT, usdcDelta: (await balance(ids().usdc, me())) - before });
      },
    },
    { name: "kyc", run: ({ recorded }) => passKyc(w, recorded) },
    {
      name: "deposit voucher and claim",
      run: async ({ recorded }) => {
        const dep = recorded["lp.deposit"] as Record<string, string>;
        const id = BigInt(dep.id);
        const v = await voucher("deposits", id);
        const servedAt = Math.floor(Date.now() / 1000);
        const before = await balance(ids().plusd, me());
        await invoke(w.lp, ids().dm, "claim_request", claimArgs(id, v));
        const req = await read<{ claimed: boolean }>(me(), ids().dm, "get_request", [u128(id)]);
        recorded["lp.deposit"] = {
          ...dep,
          voucher: { amount: v.amount, user: v.user, deadline: v.deadline, servedAt },
          plusdDelta: ((await balance(ids().plusd, me())) - before).toString(),
          claimedOnChain: req.claimed,
        };
      },
    },
    {
      name: "stake",
      run: async ({ recorded }) => {
        const before = await balance(ids().plusd, me());
        const shares = (await invoke(w.lp, ids().vault, "deposit", [i128(STAKE), addr(me()), addr(me()), addr(me())])) as bigint;
        recorded["lp.stake"] = str({ assets: STAKE, shares, plusdDelta: (await balance(ids().plusd, me())) - before, sharesBalance: await balance(ids().vault, me()) });
      },
    },
    {
      name: "unstake",
      run: async ({ recorded }) => {
        const shares = BigInt((recorded["lp.stake"] as Record<string, string>).shares) / 3n;
        const before = await balance(ids().plusd, me());
        const assets = (await invoke(w.lp, ids().vault, "redeem", [i128(shares), addr(me()), addr(me()), addr(me())])) as bigint;
        recorded["lp.unstake"] = str({ shares, assets, plusdDelta: (await balance(ids().plusd, me())) - before, sharesBalance: await balance(ids().vault, me()) });
      },
    },
    {
      name: "withdrawal request, too early",
      run: async ({ recorded }) => {
        // The custodian moves its USDC out (capital deployed), so the queue cannot pay the request yet.
        const custodian = w.deployer.publicKey();
        const held = await balance(ids().usdc, custodian);
        if (held > 0n) await classic(w.deployer, [pay(w.capital.publicKey(), w.usdc, held)]);
        const amount = await balance(ids().plusd, me());
        const [id] = (await invoke(w.lp, ids().wq, "request_withdrawal", [addr(me()), i128(amount)])) as [bigint, bigint];
        const v = await voucher("withdrawals", id);
        let tooEarly = "claim succeeded";
        try {
          await invoke(w.lp, ids().wq, "claim_request", claimArgs(id, v));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          tooEarly = contractError(message) ?? message.slice(0, 300);
        }
        recorded["lp.withdrawal"] = str({ id, amount, custodianMovedOut: held, tooEarly });
      },
    },
    {
      name: "withdrawal claim",
      run: async ({ recorded }) => {
        const wd = recorded["lp.withdrawal"] as Record<string, string>;
        const id = BigInt(wd.id);
        await classic(w.capital, [pay(w.deployer.publicKey(), w.usdc, BigInt(wd.custodianMovedOut))]);
        const v = await voucher("withdrawals", id);
        const before = await balance(ids().usdc, me());
        await invoke(w.lp, ids().wq, "claim_request", claimArgs(id, v));
        const req = await read<{ claimed: boolean }>(me(), ids().wq, "get_request", [u128(id)]);
        const rate = await read<bigint>(me(), ids().wq, "rate");
        recorded["lp.withdrawal"] = str({
          ...wd,
          rate,
          usdcDelta: (await balance(ids().usdc, me())) - before,
          plusdAfter: await balance(ids().plusd, me()),
          claimedOnChain: req.claimed,
        });
      },
    },
    {
      name: "reconcile",
      run: async ({ recorded }) => {
        const wd = recorded["lp.withdrawal"] as Record<string, string>;
        const q = `wallet=${me()}&${CHAIN}`;
        // The indexer has caught up once the API shows the last claim.
        const requests = await until("the API to index the withdrawal claim", async () => {
          const r = ok(await http("GET", `/v1/requests?${q}&status=all`), "requests").requests as { type: string; request_id?: string; status: string }[];
          return r.some((x) => x.type === "Withdraw" && x.request_id === wd.id && x.status === "Completed") ? r : undefined;
        });
        const { dm, wq, vault, registry } = ids();
        const next = await read<bigint>(me(), dm, "next_request_id");
        let unclaimed = 0n;
        for (let i = 0n; i < next; i++) {
          // Request ids may start at 1; a missing id is skipped.
          const r = await read<{ amount: bigint; claimed: boolean }>(me(), dm, "get_request", [u128(i)]).catch(() => undefined);
          if (r && !r.claimed) unclaimed += r.amount;
        }
        const [wqQueued, wqClaimed, rate] = await Promise.all([read<bigint>(me(), wq, "total_queued"), read<bigint>(me(), wq, "total_claimed"), read<bigint>(me(), wq, "rate")]);
        const supply = await plusdSupply();
        const summary = ok(await http("GET", `/v1/dashboard/summary?${CHAIN}`), "dashboard summary");
        const queue = ok(await http("GET", `/v1/withdrawal-queue?${CHAIN}`), "withdrawal queue");
        const pnl = ok(await http("GET", `/v1/pnl?${q}`), "pnl");
        const fp = ok(await http("GET", `/v1/financial-position?${CHAIN}`), "financial position");
        const position = (pnl.positions as { vault_address: string; shares_balance: string }[]).find((p) => p.vault_address.toUpperCase() === vault.toUpperCase());
        const dep = recorded["lp.deposit"] as Record<string, string>;
        recorded["reconcile"] = {
          // TVL is PLUSD in circulation plus deposits whose PLUSD is not minted yet (docs/product-specs/dashboards-tvl-ledger.md).
          tvl: { api: summary.tvl, chain: usd6(supply + unclaimed).toString() },
          plusdSupply: { apiTvl: summary.tvl, chainUnclaimedDeposits: usd6(unclaimed).toString(), chainSupply: usd6(supply).toString() },
          positions: {
            apiShares: position?.shares_balance ?? null,
            chainShares: (await balance(vault, me())).toString(),
            apiDeposit: requests.find((x) => x.type === "Deposit" && x.request_id === dep.id)?.status ?? null,
            apiWithdrawal: requests.find((x) => x.type === "Withdraw" && x.request_id === wd.id)?.status ?? null,
            chainDepositClaimed: dep.claimedOnChain,
            chainWithdrawalClaimed: wd.claimedOnChain,
          },
          withdrawalQueue: {
            api: { totalQueued: queue.summary.total_queued, totalClaimed: queue.summary.total_claimed, rate: queue.summary.rate },
            chain: { totalQueued: usd6(wqQueued).toString(), totalClaimed: usd6(wqClaimed).toString(), rate: rate.toString() },
          },
          financialPosition: {
            api: fp.assets.deployed.secured_loans_outstanding,
            chain: usd6(BigInt(await read<bigint>(me(), registry, "outstanding_total"))).toString(),
          },
        };
      },
    },
    {
      name: "known bugs",
      run: async ({ recorded }) => {
        const spec = await (await fetch(`${API}/api-docs/openapi.json`)).json();
        const param = (spec.paths?.["/v1/lps"]?.get?.parameters ?? []).find((p: { name: string }) => p.name === "payment_details");
        const assay = await http("POST", `/v1/loan-book/999999999/assay?${CHAIN}`, {
          token: w.trusteeToken,
          body: { assay_status: "Provisional", assays: [{ metal: "gold", grade_g_per_t: "1e1000" }], effective_at: Math.floor(Date.now() / 1000) },
        });
        recorded["knownBugs"] = { lpsPaymentDetailsIn: param?.in ?? null, assayHugeExponentStatus: assay.status };
      },
    },
  ],
  checks: [],
};

type Rec = Record<string, any>;
export function need(recorded: Recorded, key: string): Rec {
  const v = recorded[key];
  if (v === undefined) throw new Error(`"${key}" not recorded: the run stopped before it`);
  return v as Rec;
}
export const check = (id: string, title: string, evaluate: (r: Recorded) => { ok: boolean; details?: string }): Check => ({ id, title, evaluate });
export const verdict = (ok: boolean, details: string) => ({ ok, ...(ok ? {} : { details }) });
export const same = (label: string, api: unknown, chain: unknown) => verdict(api !== null && api !== undefined && units(String(api), 6) === BigInt(String(chain)), `${label}: API ${api} vs chain ${chain}`);

journey.checks = [
  check("stellar.lp.onboarding", "LP signs up by email + OTP, links its wallet by challenge, passes Sumsub and is whitelisted on PLUSD", (r) => {
    const lp = need(r, "world.lp");
    const kyc = need(r, "world.kyc");
    const green = kyc.sumsub_kyc_status === 2 && kyc.sumsub_review_status === 2 && kyc.sumsub_aml_status === 2;
    return verdict(lp.emailVerified && lp.linkedAddress === lp.address && green && kyc.whitelisted, `linked ${lp.linkedAddress} for ${lp.address}; kyc ${JSON.stringify(kyc)}`);
  }),
  check("stellar.lp.operators", "Trustee, originator and team rows in auth_users; the trustee signs in by wallet challenge", (r) => {
    const o = need(r, "world.operators");
    return verdict(o.rows === 3 && o.trusteeLogin, JSON.stringify(o));
  }),
  check("stellar.lp.deposit-voucher", "Deposit request → the API serves a voucher for it with a deadline within 24 h", (r) => {
    const d = need(r, "lp.deposit");
    const v = d.voucher ?? {};
    const left = Number(v.deadline) - v.servedAt;
    return verdict(
      d.usdcDelta === `-${d.amount}` && v.amount === d.amount && v.user === need(r, "world.accounts").lp && left > 0 && left <= VOUCHER_TTL_S + 60,
      `USDC moved ${d.usdcDelta} for ${d.amount}; voucher ${JSON.stringify(v)} (deadline in ${left}s)`,
    );
  }),
  check("stellar.lp.deposit-claim", "Claiming the voucher mints the deposit in PLUSD", (r) => {
    const d = need(r, "lp.deposit");
    return verdict(d.plusdDelta === d.amount && d.claimedOnChain === true, `PLUSD +${d.plusdDelta} for ${d.amount}; claimed on chain ${d.claimedOnChain}`);
  }),
  check("stellar.lp.stake", "Staking PLUSD mints sPLUSD shares", (r) => {
    const s = need(r, "lp.stake");
    return verdict(BigInt(s.shares) > 0n && s.plusdDelta === `-${s.assets}` && s.sharesBalance === s.shares, JSON.stringify(s));
  }),
  check("stellar.lp.unstake", "Redeeming sPLUSD returns PLUSD", (r) => {
    const s = need(r, "lp.stake");
    const u = need(r, "lp.unstake");
    return verdict(BigInt(u.assets) > 0n && u.plusdDelta === u.assets && BigInt(u.sharesBalance) === BigInt(s.sharesBalance) - BigInt(u.shares), JSON.stringify(u));
  }),
  check("stellar.lp.withdrawal-too-early", "Claiming an unfunded withdrawal fails with TooEarly (#2)", (r) => {
    const wd = need(r, "lp.withdrawal");
    return verdict(wd.tooEarly === "2", `claim before funding: ${wd.tooEarly}`);
  }),
  check("stellar.lp.withdrawal-claim", "Once funded, the withdrawal claim pays USDC at the queue rate and burns the PLUSD", (r) => {
    const wd = need(r, "lp.withdrawal");
    const expected = (BigInt(wd.amount) * BigInt(wd.rate ?? 0)) / RATE_ONE;
    return verdict(BigInt(wd.amount) > 0n && wd.usdcDelta === expected.toString() && wd.plusdAfter === "0" && wd.claimedOnChain === true, JSON.stringify(wd));
  }),
  check("stellar.reconcile.tvl", "Dashboard TVL equals PLUSD supply on chain plus unclaimed deposits", (r) => {
    const t = need(r, "reconcile").tvl;
    return same("TVL", t.api, t.chain);
  }),
  check("stellar.reconcile.plusd-supply", "PLUSD supply on chain equals the API TVL less unclaimed deposits", (r) => {
    const p = need(r, "reconcile").plusdSupply;
    return verdict(units(String(p.apiTvl), 6) - BigInt(p.chainUnclaimedDeposits) === BigInt(p.chainSupply), JSON.stringify(p));
  }),
  check("stellar.reconcile.positions", "API positions and request statuses match the chain (sPLUSD shares, claimed requests)", (r) => {
    const p = need(r, "reconcile").positions;
    const shares = p.apiShares !== null && Number(p.apiShares) === Number(p.chainShares);
    const statuses = p.apiDeposit === "Completed" && p.chainDepositClaimed === true && p.apiWithdrawal === "Completed" && p.chainWithdrawalClaimed === true;
    return verdict(shares && statuses, JSON.stringify(p));
  }),
  check("stellar.reconcile.withdrawal-queue", "Withdrawal queue totals and rate in the API match the contract", (r) => {
    const { api, chain } = need(r, "reconcile").withdrawalQueue;
    const totals = same("total_queued", api.totalQueued, chain.totalQueued).ok && same("total_claimed", api.totalClaimed, chain.totalClaimed).ok;
    return verdict(totals && api.rate === chain.rate, `API ${JSON.stringify(api)} vs chain ${JSON.stringify(chain)}`);
  }),
  check("stellar.reconcile.financial-position", "/v1/financial-position secured loans outstanding equals the loan registry's outstanding total", (r) => {
    const f = need(r, "reconcile").financialPosition;
    return same("secured_loans_outstanding", f.api, f.chain);
  }),
  check("stellar.known-bugs.lps-openapi-query", "OpenAPI documents GET /v1/lps payment_details as a query parameter (BUG-37)", (r) => {
    const k = need(r, "knownBugs");
    return verdict(k.lpsPaymentDetailsIn === "query", `payment_details is in "${k.lpsPaymentDetailsIn}"`);
  }),
  check("stellar.known-bugs.assay-decimal-bound", "An assay grade with an unbounded exponent (1e1000) is refused with 400 (BUG-32)", (r) => {
    const k = need(r, "knownBugs");
    return verdict(k.assayHugeExponentStatus === 400, `HTTP ${k.assayHugeExponentStatus}: validation accepted it and the request reached the loan lookup`);
  }),
];

export default journey;
