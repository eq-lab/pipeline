// Stellar loan journey: submit → approve → draw → wire in, disburse → security record, LTV, margin call → repay → close → yield, and the loan-book reconcile; see docs/e2e.md "Stellar loan journey".

import { createHash, randomBytes } from "node:crypto";
import { AuthClawbackEnabledFlag, AuthRevocableFlag, type AuthFlag, xdr } from "@stellar/stellar-sdk";
import type { Check, Journey, Recorded } from "../lib/journey";
import { PORTS } from "../lib/env";
import { STANDALONE_PASSPHRASE } from "../lib/guard";
import { addr, Asset, classic, i128, invoke, Operation, read, stackKey, submit, trust, type Keypair } from "../lib/stellar";
import { registerDealArgs } from "../../../packages/wallet-connect/src/stellar/contracts/dealTokenFactory";
import { CHAIN, http, minioPut, ok, ONE, until, world, type World } from "../lib/stellar-world";
import { encodeCloseLoanArgs, encodeDrawLoanArgs, type DrawLoanArgs } from "../../../packages/wallet-connect/src/stellar/contracts/loanRegistry";
import { encodeDisburseArgs, encodeRecordWireInArgs, encodeRepayArgs } from "../../../packages/wallet-connect/src/stellar/contracts/minter";
import { encodeSecurityRegistryArgs } from "../../../packages/wallet-connect/src/stellar/contracts/securityRegistry";
import { scMap, u32 } from "../../../packages/wallet-connect/src/stellar/contracts/scval";
import { units } from "./stellar-lp";

const SENIOR = "800";
const EQUITY = "200";
const RATE_BPS = 1200;
const PRICE = "2500"; // the fakes' static MetalpriceAPI XAU rate
const MARK_DOWN = 900n * ONE;
const TERMS = { advanceRatioBps: 8000, marginCallRatioBps: 8500 };
const GATEWAY = `http://localhost:${PORTS.fakes}/ipfs`;

let w: World;
let trustee: Keypair;
let council: Keypair;
let loanId = 0;
export const ids = () => ({
  am: w.env.VITE_STELLAR_LOAN_REGISTRY_EXECUTOR_ID,
  registry: w.env.VITE_STELLAR_LOAN_REGISTRY_ID,
  minter: w.env.VITE_STELLAR_YIELD_MINTER_ID,
  security: w.env.VITE_STELLAR_SECURITY_REGISTRY_ID,
  vault: w.env.VITE_STELLAR_STAKED_PLUSD_ID,
});
const me = () => trustee.publicKey();
export const chain = <T>(contract: string, fn: string, args: xdr.ScVal[] = []) => read<T>(me(), contract, fn, args);
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const variant = (s: string) => xdr.ScVal.scvVec([sym(s)]);
const hash32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const ref = () => randomBytes(32).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
/** A privileged call relayed by the AccessManager, as the apps' `relay(mode: "execute")` does. */
export const execute = (signer: Keypair, target: string, fn: string, args: xdr.ScVal[]) =>
  invoke(signer, ids().am, "execute", [addr(target), sym(fn), xdr.ScVal.scvVec(args), addr(signer.publicKey())]);
const str = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const usd6 = (raw: bigint) => raw / 10n;

type Entry = Record<string, any>;
async function loanBook(): Promise<{ summary: Entry; entry?: Entry }> {
  const lb = ok(await http("GET", `/v1/loan-book?${CHAIN}`), "loan book");
  return { summary: lb.summary, entry: (lb.loans as Entry[]).find((l) => l.loan_id === String(loanId)) };
}

/** Each document and the metadata JSON go to MinIO under ipfs/<cid>; the IPFS stub serves them from there. */
function pin(body: string | Buffer): string {
  const cid = `e2e${sha256(body)}`;
  minioPut(w.tag, `ipfs/${cid}`, body);
  return cid;
}

const ACTIVE = ["Approved", "Performing", "WatchList"];
/** Σ facility (senior + equity) of the registry's active loans: what the API calls secured loans outstanding (docs/product-specs/dashboards.md). */
async function activeFacility(): Promise<bigint> {
  const { registry } = ids();
  let sum = 0n;
  for (let id = 0; id < (await chain<number>(registry, "next_loan_id")); id++) {
    const m = await chain<Entry>(registry, "mutable_loan_data", [u32(id)]);
    if (ACTIVE.includes(m.status[0])) sum += (await chain<Entry>(registry, "immutable_loan_data", [u32(id)])).original_facility_size as bigint;
  }
  return sum;
}

async function chainMoney() {
  const { registry, security, vault } = ids();
  const [money, mutable, outstandingTotal, value, terms, vaultAssets] = await Promise.all([
    chain<Entry>(registry, "loan_money", [u32(loanId)]),
    chain<Entry>(registry, "mutable_loan_data", [u32(loanId)]),
    chain<bigint>(registry, "outstanding_total"),
    chain<bigint>(security, "collateral_value", [u32(loanId)]),
    chain<Entry>(security, "terms", [u32(loanId)]),
    chain<bigint>(vault, "total_assets"),
  ]);
  return { money, mutable, outstandingTotal, value, terms, vaultAssets };
}

const journey: Journey = {
  chain: "stellar",
  name: "loan",
  steps: [
    {
      name: "world",
      run: async ({ tag, recorded }) => {
        w = await world(tag, recorded);
        trustee = stackKey(tag, "trustee");
        council = stackKey(tag, "risk-council");
      },
    },
    {
      name: "submit and approve",
      run: async ({ recorded }) => {
        const docs = [
          { name: "Facility Agreement", body: `E2E facility agreement ${ref()}` },
          { name: "Warehouse Receipt", body: `E2E warehouse receipt ${ref()}` },
        ].map((d) => ({ ...d, sha256: sha256(d.body), uri: `ipfs://${pin(d.body)}` }));
        const documents = docs.map(({ name, uri }) => ({ name, uri }));
        const meta = { originator: "E2E Originator", borrowerId: `borrower-${now()}`, commodity: "Gold", corridor: "CH-AE", governingLaw: "English law", protection: "LC at sight", documents };
        const metadataUri = `ipfs://${pin(JSON.stringify(meta))}`;
        const body = {
          metadata_uri: metadataUri,
          data_room_id: `e2e-data-room-${ref().slice(0, 12)}`,
          originator: meta.originator,
          borrower_id: meta.borrowerId,
          commodity: meta.commodity,
          corridor: meta.corridor,
          governing_law: meta.governingLaw,
          protection: meta.protection,
          documents,
          economics: {
            original_facility_size: String(Number(SENIOR) + Number(EQUITY)),
            original_senior_tranche: SENIOR,
            original_equity_tranche: EQUITY,
            original_offtaker_price: "1100",
            senior_interest_rate_bps: RATE_BPS,
            origination_date: now() - 60,
            original_maturity_date: now() + 90 * 86_400,
          },
          collateral_valuation: { valuation_mode: "StandardGoods", asset: "XAU", price_provider: "metal_price", haircut_pct: "0", quantity_dmt: "0.0000311035" },
          fee_schedule: { mgmt_fee_rate_bps: 0, perf_fee_rate_bps: 0, oet_alloc_rate_bps: 0 },
        };
        const submitted = ok(await http("POST", `/v1/loan-book/loan?${CHAIN}`, { token: w.originatorToken, body }), "submit loan");
        const before = (ok(await http("GET", `/v1/loan-book/submissions?${CHAIN}`), "submissions") as Entry[]).find((s) => s.id === submitted.id);
        ok(await http("POST", `/v1/loan-book/submissions/${submitted.id}/review`, { token: w.trusteeToken, body: { decision: "Approved" } }), "approve");
        const after = (ok(await http("GET", `/v1/loan-book/submissions?status=Approved&${CHAIN}`), "approved submissions") as Entry[]).find((s) => s.id === submitted.id);
        const served = await Promise.all(docs.map(async (d) => sha256(Buffer.from(await (await fetch(`${GATEWAY}/${d.uri.slice("ipfs://".length)}`)).arrayBuffer()))));
        recorded["loan.submission"] = {
          id: submitted.id,
          metadataUri,
          statusBefore: before?.status ?? null,
          statusAfter: after?.status ?? null,
          drawLoan: after?.draw_loan ?? null,
          documents: docs.map(({ name, uri, sha256 }, i) => ({ name, uri, sha256, served: served[i] })),
        };
      },
    },
    {
      name: "draw",
      run: async ({ recorded }) => {
        const sub = recorded["loan.submission"] as Entry;
        const args = sub.drawLoan as DrawLoanArgs & { missing_inputs: string[] };
        if (!args || args.missing_inputs.length) throw new Error(`draw_loan args from the API: ${JSON.stringify(args)}`);
        loanId = Number(await execute(trustee, ids().registry, "draw_loan", encodeDrawLoanArgs(args)));
        const immutable = await chain<Entry>(ids().registry, "immutable_loan_data", [u32(loanId)]);
        const linked = await until("the API to link the submission to the drawn loan", async () => {
          const s = (ok(await http("GET", `/v1/loan-book/submissions?${CHAIN}`), "submissions") as Entry[]).find((x) => x.id === sub.id);
          return s?.loan_id ? s : undefined;
        });
        recorded["loan.draw"] = str({
          loanId,
          status: (await chain<Entry>(ids().registry, "mutable_loan_data", [u32(loanId)])).status,
          immutable: { senior: immutable.original_senior_tranche, equity: immutable.original_equity_tranche, rate: immutable.senior_interest_rate },
          apiArgs: args.economics,
          linkedLoanId: linked.loan_id,
          linkedStatus: linked.status,
        });
      },
    },
    {
      name: "debt token",
      run: async ({ recorded }) => {
        // What the contracts repo's `just new-deal <id>` does for ops: the DEBT<nnnn> SAC (issuer: the trustee) with the factory as admin, and the capital wallet's trustline.
        const factory = w.env.VITE_STELLAR_DEAL_TOKEN_FACTORY_ID;
        const debt = new Asset(`DEBT${String(loanId).padStart(4, "0")}`, me());
        const sac = debt.contractId(STANDALONE_PASSPHRASE);
        // sync_debt freezes the holder after each mint (AUTH_REVOCABLE) and claws DEBT back on repayment (AUTH_CLAWBACK_ENABLED, before the trustline opens).
        await classic(trustee, [Operation.setOptions({ setFlags: (AuthRevocableFlag | AuthClawbackEnabledFlag) as AuthFlag })]);
        await submit(trustee, Operation.createStellarAssetContract({ asset: debt }), "deploy DEBT SAC");
        await invoke(trustee, sac, "set_admin", [addr(factory)]);
        await classic(w.capital, [trust(debt)]);
        await execute(trustee, factory, "register_deal", registerDealArgs(loanId));
        recorded["loan.debtToken"] = { sac, registered: (await chain<Entry>(factory, "deal", [u32(loanId)])).debt };
      },
    },
    {
      name: "wire in and disburse",
      run: async ({ recorded }) => {
        const { minter, registry } = ids();
        const bankBefore = await chain<bigint>(minter, "bank_cash");
        // The Cash reporter books the borrower's facility cash into the minter's escrow, then the trustee wires it out.
        await invoke(trustee, minter, "record_wire_in", encodeRecordWireInArgs({ caller: me(), receiver: minter, amount: SENIOR, valueDate: now(), refHash: ref() }));
        const bankAfterWire = await chain<bigint>(minter, "bank_cash");
        const amount = units(SENIOR, 7);
        await execute(trustee, minter, "disburse", encodeDisburseArgs({ loanId, amountRaw: amount.toString(), valueDate: now(), refHash: ref() }));
        ok(await http("POST", `/v1/loan-book/${loanId}/disbursement/complete?${CHAIN}`, { token: w.trusteeToken }), "disbursement complete");
        const mutable = await chain<Entry>(registry, "mutable_loan_data", [u32(loanId)]);
        recorded["loan.disburse"] = str({ amount, wiredIn: bankAfterWire - bankBefore, bankAfter: await chain<bigint>(minter, "bank_cash"), bankAfterWire, disbursed: mutable.disbursed, status: mutable.status });
      },
    },
    {
      name: "collateral and margin call",
      run: async ({ recorded }) => {
        const { security } = ids();
        const docs = (recorded["loan.submission"] as Entry).documents as Entry[];
        const receipt = docs.find((d) => d.name === "Warehouse Receipt")!;
        await execute(council, security, "set_terms", encodeSecurityRegistryArgs({
          fn: "set_terms",
          loanId,
          terms: { ...TERMS, curePeriod: 604_800, priceStaleAfter: 0, paymentTerm: "Lc", gracePeriod: 0, defaultRate: 0, attestationInterval: 0, inspectionInterval: 0, toleranceBps: 200, gradeToleranceBps: 100 },
        }));
        const record = scMap([
          ["protection", variant("WarehousePledge")],
          ["commodity", xdr.ScVal.scvString("Gold")],
          ["unit", variant("Mt")],
          ["reference_quantity", i128(ONE)],
          ["reference_grade", i128(0n)],
          ["region", xdr.ScVal.scvString("CH")],
          ["site_hash", hash32(sha256("e2e-warehouse"))],
          ["control", scMap([["kind", variant("CollateralManager")], ["reference", xdr.ScVal.scvString("E2E CM")]])],
          ["perfection", variant("Registration")],
          ["release_condition", hash32(sha256("e2e release on repayment"))],
          ["docs", xdr.ScVal.scvVec([scMap([["kind", variant("WarehouseReceipt")], ["sha256", hash32(receipt.sha256)]])])],
        ]);
        // The trustee holds SECURITY_AGENT (register, perfect); the risk council key holds RISK_COUNCIL (set_terms).
        const recordId = Number(await invoke(trustee, security, "register", [addr(me()), u32(loanId), u32(0), record]));
        await invoke(trustee, security, "perfect", [addr(me()), u32(recordId), hash32(sha256(`perfected ${recordId}`))]);
        const revalue = (perUnit: bigint) => execute(trustee, security, "revalue", [u32(recordId), i128(perUnit), sym("XAU"), hash32(sha256(`mark ${perUnit}`))]);
        await revalue(units(PRICE, 7));
        const marked = await chainMoney();
        await revalue(MARK_DOWN);
        const called = await chainMoney();
        const onChain = await chain<Entry>(security, "record", [u32(recordId)]);
        recorded["loan.collateral"] = str({
          recordId,
          status: onChain.status,
          docs: (onChain.docs as Entry[]).map((d) => Buffer.from(d.sha256).toString("hex")),
          marked: { value: marked.value, debt: marked.money.outstanding + marked.money.accrued_interest, marginCallAt: marked.terms.margin_call_at },
          called: { value: called.value, outstanding: called.money.outstanding, accrued: called.money.accrued_interest, marginCallAt: called.terms.margin_call_at },
        });
      },
    },
    {
      name: "loan book while active",
      run: async ({ recorded }) => {
        const { entry, summary } = await until("the loan book to price the loan", async () => {
          const lb = await loanBook();
          return lb.entry?.collateral && lb.entry.status === "Performing" ? lb : undefined;
        }, 180_000);
        // The security projection folds every 30 s; it may also never show for this contracts ref, which the check then reports.
        const security = await until("the loan book to show the margin call", async () => ((await loanBook()).entry?.margin_call_open === true ? (await loanBook()).entry : undefined), 120_000).catch(() => entry!);
        const c = await chainMoney();
        const immutable = await chain<Entry>(ids().registry, "immutable_loan_data", [u32(loanId)]);
        recorded["loanBook.active"] = str({
          entry: pick(entry!, ["principal", "senior_outstanding", "original_senior_tranche", "rate", "spot_price", "collateral", "ltv", "status", "onchain_status", "documents"]),
          security: pick(security, ["ltv_bps", "margin_call_open", "price_stale"]),
          summary: pick(summary, ["avg_yield", "weighted_rate", "deployed_senior"]),
          dashboard: pick(ok(await http("GET", `/v1/dashboard/summary?${CHAIN}`), "dashboard summary"), ["outstanding_in_loans", "loan_book_yield"]),
          financialPosition: ok(await http("GET", `/v1/financial-position?${CHAIN}`), "financial position").assets.deployed.secured_loans_outstanding,
          chain: {
            facility: immutable.original_facility_size,
            senior: immutable.original_senior_tranche,
            outstanding: c.money.outstanding,
            accrued: c.money.accrued_interest,
            outstandingTotal: c.outstandingTotal,
            activeFacility: await activeFacility(),
            rate: c.mutable.current_rate,
            value: c.value,
            marginCallAt: c.terms.margin_call_at,
          },
        });
      },
    },
    {
      name: "repay",
      run: async ({ recorded }) => {
        const { registry, minter } = ids();
        const before = await chainMoney();
        const interest = before.money.accrued_interest as bigint;
        const principal = before.money.outstanding as bigint;
        const repayment = {
          offtaker_received: (principal + interest).toString(),
          senior_principal_repaid: principal.toString(),
          senior_interest: interest.toString(),
          equity_distributed: "0",
          mgmt_fee: "0",
          perf_fee: "0",
          oet_alloc: "0",
        };
        const repaymentId = Number(await invoke(trustee, minter, "repay", encodeRepayArgs({ caller: me(), loanId, repayment, valueDate: now(), refHash: ref() })));
        const after = await chainMoney();
        const booked = await chain<Entry>(minter, "repayment", [u32(loanId), u32(repaymentId)]);
        recorded["loan.repay"] = str({
          repaymentId,
          repayment,
          interestMinted: booked.interest_minted,
          vaultDelta: (after.vaultAssets as bigint) - (before.vaultAssets as bigint),
          outstandingAfter: after.money.outstanding,
          registryRepaid: (await chain<Entry>(registry, "repayment_data", [u32(loanId), u32(repaymentId)])).senior_interest,
        });
      },
    },
    {
      name: "close",
      run: async ({ recorded }) => {
        await execute(trustee, ids().registry, "close_loan", encodeCloseLoanArgs(loanId, "EarlyRepayment"));
        const mutable = await chain<Entry>(ids().registry, "mutable_loan_data", [u32(loanId)]);
        recorded["loan.close"] = str({ status: mutable.status, reason: mutable.closure_reason });
      },
    },
    {
      name: "loan book after close",
      run: async ({ recorded }) => {
        const { entry, summary } = await until("the loan book to show the loan closed", async () => {
          const lb = await loanBook();
          return lb.entry?.onchain_status === "Closed" ? lb : undefined;
        });
        const { registry, minter } = ids();
        // Σ interest minted over every loan's repayments on chain, net of reversals: the API's cumulative LP yield.
        let minted = 0n;
        const next = await chain<number>(registry, "next_loan_id");
        for (let id = 0; id < next; id++) {
          const m = await chain<Entry>(registry, "mutable_loan_data", [u32(id)]).catch(() => undefined);
          for (let r = 0; m && r < m.next_repayment_id; r++) {
            const rep = await chain<Entry>(minter, "repayment", [u32(id), u32(r)]).catch(() => undefined);
            if (rep && !rep.reversed && !rep.carved_out) minted += rep.interest_minted as bigint;
          }
        }
        const yieldTotal = await until("the API to index the repayment", async () => {
          const d = ok(await http("GET", `/v1/dashboard/summary?${CHAIN}`), "dashboard summary");
          return units(d.cumulative_yield_total, 6) === usd6(minted) ? d.cumulative_yield_total : undefined;
        }, 60_000).catch(async () => ok(await http("GET", `/v1/dashboard/summary?${CHAIN}`), "dashboard summary").cumulative_yield_total);
        const c = await chainMoney();
        recorded["loanBook.closed"] = str({
          entry: pick(entry!, ["status", "onchain_status", "repaid_to_date", "senior_outstanding"]),
          deployedSenior: summary.deployed_senior,
          financialPosition: ok(await http("GET", `/v1/financial-position?${CHAIN}`), "financial position").assets.deployed.secured_loans_outstanding,
          yieldTotal,
          chain: {
            offtakerReceived: (await chain<Entry>(registry, "cumulative_repayment_data", [u32(loanId)])).offtaker_received,
            outstandingTotal: c.outstandingTotal,
            activeFacility: await activeFacility(),
            interestMinted: minted,
          },
        });
      },
    },
  ],
  checks: [],
};

function pick(o: Entry, keys: string[]): Entry {
  return Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
}

type Rec = Record<string, any>;
function need(recorded: Recorded, key: string): Rec {
  const v = recorded[key];
  if (v === undefined) throw new Error(`"${key}" not recorded: the run stopped before it`);
  return v as Rec;
}
const check = (id: string, title: string, evaluate: (r: Recorded) => { ok: boolean; details?: string }): Check => ({ id, title, evaluate });
const verdict = (ok: boolean, details: string) => ({ ok, ...(ok ? {} : { details }) });
/** An API 6-decimal USD string against a 7-decimal chain amount. */
const same6 = (api: unknown, raw: unknown) => api !== null && api !== undefined && units(String(api), 6) === usd6(BigInt(String(raw)));
const RATE = (RATE_BPS / 10_000).toFixed(6);

journey.checks = [
  check("stellar.loan.submission", "The originator submits through the API, the trustee approves, and the API serves the draw_loan args in contract units", (r) => {
    const s = need(r, "loan.submission");
    const e = s.drawLoan?.economics ?? {};
    const units7 = e.original_senior_tranche === units(SENIOR, 7).toString() && e.original_equity_tranche === units(EQUITY, 7).toString();
    return verdict(s.statusBefore === "InReview" && s.statusAfter === "Approved" && units7 && e.senior_interest_rate === RATE_BPS * 100, JSON.stringify(s));
  }),
  check("stellar.loan.documents", "Loan documents stored in MinIO are served unchanged through the IPFS stub and listed in the loan book", (r) => {
    const docs = need(r, "loan.submission").documents as Rec[];
    const listed = need(r, "loanBook.active").entry.documents as Rec[] | null;
    const served = docs.every((d) => d.served === d.sha256);
    const inBook = docs.every((d) => listed?.some((l) => l.name === d.name && l.uri === d.uri));
    return verdict(docs.length > 0 && served && inBook, `stored ${JSON.stringify(docs)}; loan book ${JSON.stringify(listed)}`);
  }),
  check("stellar.loan.draw", "draw_loan through the AccessManager mints the loan as Approved with the submitted economics, and the API links the submission", (r) => {
    const d = need(r, "loan.draw");
    const econ = d.immutable.senior === d.apiArgs.original_senior_tranche && d.immutable.equity === d.apiArgs.original_equity_tranche && Number(d.immutable.rate) === d.apiArgs.senior_interest_rate;
    return verdict(d.status?.[0] === "Approved" && econ && d.linkedLoanId === String(d.loanId), JSON.stringify(d));
  }),
  check("stellar.loan.disburse", "The loan's debt token is registered; the Cash reporter's record_wire_in books the cash; disburse draws the senior tranche and the loan turns Performing", (r) => {
    const t = need(r, "loan.debtToken");
    const d = need(r, "loan.disburse");
    return verdict(t.registered === t.sac && d.wiredIn === d.amount && d.disbursed === d.amount && BigInt(d.bankAfterWire) - BigInt(d.bankAfter) === BigInt(d.amount) && d.status?.[0] === "Performing", JSON.stringify(d));
  }),
  check("stellar.loan.collateral", "A perfected warehouse pledge marked at the static price values the collateral on the security registry, with the receipt's hash", (r) => {
    const c = need(r, "loan.collateral");
    const receipt = (need(r, "loan.submission").documents as Rec[]).find((d) => d.name === "Warehouse Receipt")?.sha256;
    return verdict(c.status?.[0] === "Active" && c.marked.value === units(PRICE, 7).toString() && c.marked.marginCallAt === "0" && c.docs.includes(receipt), JSON.stringify(c));
  }),
  check("stellar.loan.margin-call", "Marking the collateral down past the margin-call ratio opens a margin call on chain", (r) => {
    const c = need(r, "loan.collateral").called;
    const ltv = (BigInt(c.outstanding) * 10_000n) / BigInt(c.value);
    return verdict(ltv > BigInt(TERMS.marginCallRatioBps) && c.marginCallAt !== "0", `LTV ${ltv} bps, margin_call_at ${c.marginCallAt}`);
  }),
  check("stellar.loan.repay", "repay through the minter books principal and accrued interest, clears the outstanding and mints the interest to sPLUSD", (r) => {
    const p = need(r, "loan.repay");
    const interest = p.repayment.senior_interest;
    return verdict(BigInt(interest) > 0n && p.interestMinted === interest && p.vaultDelta === interest && p.outstandingAfter === "0" && p.registryRepaid === interest, JSON.stringify(p));
  }),
  check("stellar.loan.close", "close_loan with EarlyRepayment closes the repaid loan", (r) => {
    const c = need(r, "loan.close");
    return verdict(c.status?.[0] === "Closed" && c.reason?.[0] === "EarlyRepayment", JSON.stringify(c));
  }),
  check("stellar.loan-book.entry", "/v1/loan-book principal, senior and rate of the loan match the loan registry", (r) => {
    const { entry, chain: c } = need(r, "loanBook.active");
    const ok = same6(entry.principal, c.facility) && same6(entry.original_senior_tranche, c.senior) && same6(entry.senior_outstanding, c.outstanding) && entry.rate === (Number(c.rate) / 1e6).toFixed(6) && entry.rate === RATE;
    return verdict(ok, `API ${JSON.stringify(entry)} vs chain ${JSON.stringify(c)}`);
  }),
  check("stellar.loan-book.collateral", "/v1/loan-book values the collateral at the static price × quantity, less the haircut", (r) => {
    const { entry } = need(r, "loanBook.active");
    return verdict(units(String(entry.spot_price), 6) === units(PRICE, 6) && units(String(entry.collateral), 6) === units(PRICE, 6), `spot ${entry.spot_price}, collateral ${entry.collateral} (expected ${PRICE} × 1, no haircut)`);
  }),
  check("stellar.loan-book.ltv-range", "Loan-book LTV is within 0–200% and equals principal / collateral (#765)", (r) => {
    const { entry } = need(r, "loanBook.active");
    const expected = (Number(entry.principal) / Number(entry.collateral)).toFixed(4);
    const ltv = Number(entry.ltv);
    return { ok: ltv >= 0 && ltv <= 2 && entry.ltv === expected, details: `LTV ${entry.ltv} (${(ltv * 100).toFixed(2)}%): principal ${entry.principal} / collateral ${entry.collateral} = ${expected}` };
  }),
  check("stellar.loan-book.margin-call", "/v1/loan-book margin_call_open matches the security registry's open margin call", (r) => {
    const { security, chain: c } = need(r, "loanBook.active");
    return verdict(c.marginCallAt !== "0" && security.margin_call_open === true, `API margin_call_open ${security.margin_call_open} vs chain margin_call_at ${c.marginCallAt}`);
  }),
  check("stellar.loan-book.ltv-bps", "/v1/loan-book ltv_bps equals the security registry's LTV (debt / collateral value, rounded up)", (r) => {
    const { security, chain: c } = need(r, "loanBook.active");
    const value = BigInt(c.value);
    const ceil = (debt: bigint) => (debt * 10_000n + value - 1n) / value;
    const low = ceil(BigInt(c.outstanding));
    const high = ceil(BigInt(c.outstanding) + BigInt(c.accrued));
    const ok = security.ltv_bps !== null && BigInt(security.ltv_bps) >= low && BigInt(security.ltv_bps) <= high;
    return verdict(ok, `API ltv_bps ${security.ltv_bps} (price_stale ${security.price_stale}) vs chain ${low}–${high} bps`);
  }),
  check("stellar.loan-book.summary", "While the loan is active: weighted rate, deployed senior, /v1/dashboard/summary and /v1/financial-position match the registry", (r) => {
    const a = need(r, "loanBook.active");
    const rates = a.summary.weighted_rate === RATE && a.dashboard.loan_book_yield === RATE;
    const money = same6(a.summary.deployed_senior, a.chain.outstandingTotal) && same6(a.financialPosition, a.chain.activeFacility) && same6(a.dashboard.outstanding_in_loans, a.chain.activeFacility);
    return verdict(rates && money, `summary ${JSON.stringify(a.summary)}, dashboard ${JSON.stringify(a.dashboard)}, financial position ${a.financialPosition} vs chain ${JSON.stringify(a.chain)}`);
  }),
  check("stellar.loan-book.closed", "After close the loan book shows the loan Closed with what was repaid; deployed senior and secured loans drop it", (r) => {
    const c = need(r, "loanBook.closed");
    const ok = c.entry.status === "Closed" && same6(c.entry.repaid_to_date, c.chain.offtakerReceived) && same6(c.deployedSenior, c.chain.outstandingTotal) && same6(c.financialPosition, c.chain.activeFacility);
    return verdict(ok, JSON.stringify(c));
  }),
  check("stellar.loan-book.yield", "/v1/dashboard/summary cumulative yield equals the interest the minter minted to sPLUSD", (r) => {
    const c = need(r, "loanBook.closed");
    return verdict(same6(c.yieldTotal, c.chain.interestMinted), `API ${c.yieldTotal} vs chain ${c.chain.interestMinted}`);
  }),
];

export default journey;
