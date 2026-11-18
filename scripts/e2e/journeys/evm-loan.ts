// EVM loan journey on anvil: submit → approve → draw → deal → wire in, disburse → collateral lot, valuation, margin call → repay → close → yield, and the loan-book reconcile for 31337; see docs/e2e.md "EVM loan journey".

import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseAbi, stringToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Journey } from "../lib/journey";
import { PORTS } from "../lib/env";
import { EVM_CHAIN_ID } from "../lib/guard";
import { readJson, stackDir } from "../lib/stack";
import { anvil, EVM_CHAIN, read, send, views } from "../lib/evm-world";
import { http, minioPut, ok, psql, until } from "../lib/stellar-world";
import { EVM_ROLES } from "../stack";
import { minterRecoveryAbi } from "../../../packages/wallet-connect/src/evm/contracts/minter";
import { check, need, same, units, verdict } from "./stellar-lp";

const SENIOR = "800";
const EQUITY = "200";
const OFFTAKER_PRICE = "1100";
const RATE_BPS = 1200;
const PRICE = "2500"; // the fakes' static MetalpriceAPI XAU rate
const MARK_DOWN = units("900", 6);
const QUANTITY = units("1", 6);
/** The collateral registry's coverage floor for an 85 % margin-call LTV: ceil(10000 / 0.85) bps. */
const FLOOR_BPS = 11_765;
const GATEWAY = `http://localhost:${PORTS.fakes}/ipfs`;
const STATUS = ["Approved", "Performing", "WatchList", "Default", "Closed"];
const CLOSURE = ["None", "ScheduledMaturity", "EarlyRepayment", "Cancelled", "Default", "OtherWriteDown"];
const CMA = 3;
const WAREHOUSE_RECEIPT = 1;

const abi = parseAbi([
  "struct ImmutableLoanData { bytes32 borrowerRef; uint256 originalFacilitySize; uint256 originalSeniorTranche; uint256 originalEquityTranche; uint256 originalOfftakerPrice; uint32 seniorInterestRate; uint64 originationDate; uint64 originalMaturityDate; }",
  "struct MutableLoanData { uint256 nextEconomicsEpochsId; uint256 nextRepaymentId; uint8 status; uint64 currentMaturityTimestamp; uint32 currentRate; uint8 closureReason; bool carvedOut; uint256 disbursed; uint256 repaid; uint256 writtenDown; int256 interestAdjustment; string metadataURI; }",
  "struct LoanMoney { uint256 disbursed; uint256 repaid; uint256 writtenDown; uint256 outstanding; uint256 accruedInterest; bool carvedOut; }",
  "struct RepaymentData { uint256 offtakerReceived; uint256 seniorPrincipalRepaid; uint256 seniorInterest; uint256 equityDistributed; uint256 mgmtFee; uint256 perfFee; uint256 oetAlloc; }",
  "struct CargoDetails { string commodity; uint8 valuationMode; }",
  "struct ReceivableDetails { bytes32 obligorRef; uint64 dueDate; uint8 form; }",
  "struct Location { uint8 locationType; string identifier; string trackingUrl; }",
  "struct Control { uint8 kind; string ref; }",
  "struct Doc { uint8 kind; bytes32 hash; }",
  "struct Mark { uint256 valuePerUnit; uint64 at; bytes32 benchmark; bytes32 reportHash; }",
  "struct PledgeLot { uint8 kind; uint8 unit; uint32 haircutBps; bool hasLocation; uint256 quantity; CargoDetails cargo; ReceivableDetails receivable; Location location; }",
  "struct Lot { uint8 kind; uint8 unit; uint8 stage; uint32 haircutBps; bool hasLocation; bool hasMark; uint256 quantity; CargoDetails cargo; ReceivableDetails receivable; Location location; Control control; Mark mark; Doc[] docs; }",
  "function drawLoan(string metadataURI, ImmutableLoanData economics) returns (uint256)",
  "function closeLoan(uint256 loanId, uint8 reason)",
  "function nextLoanId() view returns (uint256)",
  "function immutableLoanData(uint256 loanId) view returns (ImmutableLoanData)",
  "function mutableLoanData(uint256 loanId) view returns (MutableLoanData)",
  "function loanMoney(uint256 loanId) view returns (LoanMoney)",
  "function outstandingTotal() view returns (uint256)",
  "function registerDeal(uint256 loanId) returns ((address debt, address cargo))",
  "function deal(uint256 loanId) view returns ((address debt, address cargo))",
  "function recordWireIn(address receiver, uint256 amount, uint64 valueDate, bytes32 refHash) returns (uint256)",
  "function disburse(uint256 loanId, uint256 amount, uint64 valueDate, bytes32 refHash) returns (uint256)",
  "function bankCash() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function pledge(uint256 loanId, PledgeLot pledgeLot) returns (uint256)",
  "function setControl(uint256 loanId, uint256 lotId, Control control)",
  "function addDoc(uint256 loanId, uint256 lotId, uint8 kind, bytes32 hash)",
  "function setFloor(uint256 loanId, uint32 bps)",
  "function revalue(uint256 loanId, uint256 lotId, uint256 valuePerUnit, bytes32 benchmark, bytes32 reportHash)",
  "function lot(uint256 loanId, uint256 lotId) view returns (Lot)",
  "function collateralValue(uint256 loanId) view returns (uint256)",
  "function coverage(uint256 loanId) view returns (uint32)",
  "function floorBps(uint256 loanId) view returns (uint32)",
  "event MarginCall(uint256 indexed loanId, uint32 coverageBps, uint32 floorBps)",
  "event CashRepaid(uint256 indexed loanId, uint256 repaymentId, uint256 saleId, uint256 cash, uint256 interestMinted, uint256 feeShares, uint64 valueDate, bytes32 refHash)",
  "event PaymentRecorded(uint256 indexed loanId, uint256 indexed repaymentId, RepaymentData repayment, uint256 outstanding)",
]);

type Entry = Record<string, any>;
let env: Record<string, string>;
let roles: Address[];
let trusteeToken: string;
let originatorToken: string;
let loanId = 0n;
const C = `CHAIN_${EVM_CHAIN_ID}_EVM`;
const ids = () => ({
  registry: env[`${C}_INDEXER_LOAN_REGISTRY_ADDRESS`] as Address,
  minter: env[`${C}_INDEXER_MINTER_ADDRESS`] as Address,
  collateral: env[`${C}_INDEXER_COLLATERAL_REGISTRY_ADDRESS`] as Address,
  factory: env[`${C}_INDEXER_DEAL_TOKEN_FACTORY_ADDRESS`] as Address,
  vault: env[`${C}_INDEXER_STAKED_PLUSD_ADDRESS`] as Address,
  capital: env.VITE_EVM_CAPITAL_WALLET_ADDRESS as Address,
});
const role = (name: keyof typeof EVM_ROLES) => roles[EVM_ROLES[name]];
const chain = <T>(address: Address, fn: string, args: unknown[] = []) => read<T>(address, fn, args, abi);
const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const ref = (): Hex => `0x${randomBytes(32).toString("hex")}`;
const now = () => BigInt(Math.floor(Date.now() / 1000));
const str = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const pick = (o: Entry, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
const events = async (address: Address, eventName: "MarginCall" | "CashRepaid" | "PaymentRecorded", args?: Entry) =>
  (await anvil.getContractEvents({ address, abi, eventName, args, fromBlock: 0n } as never)).map((e) => (e as { args: Entry }).args);

/** An operator wallet on 31337 with `roles`, signed in by personal_sign challenge. */
async function operator(tag: string, roleSet: string): Promise<string> {
  const key = privateKeyToAccount(generatePrivateKey());
  const address = key.address.toLowerCase();
  psql(tag, `WITH a AS (INSERT INTO accounts (id) VALUES (gen_random_uuid()) RETURNING id) INSERT INTO auth_users (chain_id, address, roles, account_id) SELECT ${EVM_CHAIN_ID}, '${address}', '${roleSet}', id FROM a;`);
  const { message } = ok(await http("GET", `/v1/auth/challenge?${EVM_CHAIN}&address=${address}`), "operator challenge");
  const body = { chain_id: Number(EVM_CHAIN_ID), address, signature: await key.signMessage({ message }) };
  return ok(await http("POST", "/v1/auth/verify", { body }), "operator verify").token;
}

function pin(tag: string, body: string): string {
  const cid = `e2e${sha256(body)}`;
  minioPut(tag, `ipfs/${cid}`, body);
  return cid;
}

async function loanBook(): Promise<{ summary: Entry; entry?: Entry }> {
  const lb = ok(await http("GET", `/v1/loan-book?${EVM_CHAIN}`), "loan book");
  return { summary: lb.summary, entry: (lb.loans as Entry[]).find((l) => l.loan_id === String(loanId)) };
}

/** Σ facility (senior + equity) of the registry's active loans: the API's secured loans outstanding. */
async function activeFacility(): Promise<bigint> {
  const { registry } = ids();
  let sum = 0n;
  for (let id = 0n; id < (await chain<bigint>(registry, "nextLoanId")); id++)
    if ((await chain<Entry>(registry, "mutableLoanData", [id])).status <= 2) sum += (await chain<Entry>(registry, "immutableLoanData", [id])).originalFacilitySize;
  return sum;
}

async function security() {
  const { registry, collateral } = ids();
  const [value, coverage, floor, money, marginCalls] = await Promise.all([
    chain<bigint>(collateral, "collateralValue", [loanId]),
    chain<number>(collateral, "coverage", [loanId]),
    chain<number>(collateral, "floorBps", [loanId]),
    chain<Entry>(registry, "loanMoney", [loanId]),
    events(collateral, "MarginCall", { loanId }),
  ]);
  return { value, coverage, floor, outstanding: money.outstanding, accrued: money.accruedInterest, marginCalls: marginCalls.map((e) => ({ coverage: e.coverageBps, floor: e.floorBps })) };
}

const journey: Journey = {
  chain: "evm",
  name: "loan",
  steps: [
    {
      name: "world",
      run: async ({ tag }) => {
        const found = readJson<Record<string, string>>(join(stackDir(tag), "env.json"));
        if (!found?.[`${C}_INDEXER_LOAN_REGISTRY_ADDRESS`]) throw new Error(`no EVM chain in ${stackDir(tag)}/env.json: bring the stack up with --chains evm`);
        env = found;
        roles = (await anvil.request({ method: "eth_accounts" } as never)) as Address[];
        [trusteeToken, originatorToken] = [await operator(tag, "{trustee}"), await operator(tag, "{originator}")];
      },
    },
    {
      name: "submit and approve",
      run: async ({ tag, recorded }) => {
        const docs = [
          { name: "Facility Agreement", body: `E2E EVM facility agreement ${ref()}` },
          { name: "Warehouse Receipt", body: `E2E EVM warehouse receipt ${ref()}` },
        ].map((d) => ({ ...d, sha256: sha256(d.body), uri: `ipfs://${pin(tag, d.body)}` }));
        const documents = docs.map(({ name, uri }) => ({ name, uri }));
        const meta = { originator: "E2E Originator", borrowerId: `borrower-${now()}`, commodity: "Gold", corridor: "CH-AE", governingLaw: "English law", protection: "LC at sight", documents };
        const metadataUri = `ipfs://${pin(tag, JSON.stringify(meta))}`;
        const body = {
          metadata_uri: metadataUri,
          data_room_id: `e2e-data-room-${ref().slice(2, 14)}`,
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
            original_offtaker_price: OFFTAKER_PRICE,
            senior_interest_rate_bps: RATE_BPS,
            origination_date: Number(now()) - 60,
            original_maturity_date: Number(now()) + 90 * 86_400,
          },
          collateral_valuation: { valuation_mode: "StandardGoods", asset: "XAU", price_provider: "metal_price", haircut_pct: "0", quantity_dmt: "1" },
          fee_schedule: { mgmt_fee_rate_bps: 0, perf_fee_rate_bps: 0, oet_alloc_rate_bps: 0 },
        };
        const submitted = ok(await http("POST", `/v1/loan-book/loan?${EVM_CHAIN}`, { token: originatorToken, body }), "submit loan");
        const find = async (q: string) => (ok(await http("GET", `/v1/loan-book/submissions?${q}${EVM_CHAIN}`), "submissions") as Entry[]).find((s) => s.id === submitted.id);
        const before = await find("");
        ok(await http("POST", `/v1/loan-book/submissions/${submitted.id}/review`, { token: trusteeToken, body: { decision: "Approved" } }), "approve");
        const after = await find("status=Approved&");
        const served = await Promise.all(docs.map(async (d) => sha256(Buffer.from(await (await fetch(`${GATEWAY}/${d.uri.slice("ipfs://".length)}`)).arrayBuffer()))));
        recorded["evm.loan.submission"] = {
          id: submitted.id,
          metadataUri,
          statusBefore: before?.status ?? null,
          statusAfter: after?.status ?? null,
          loanData: after?.loan_data ?? null,
          documents: docs.map(({ name, uri, sha256 }, i) => ({ name, uri, sha256, served: served[i] })),
        };
      },
    },
    {
      name: "draw",
      run: async ({ recorded }) => {
        const sub = need(recorded, "evm.loan.submission");
        const e = sub.loanData?.economics;
        if (!e) throw new Error(`no approved submission to draw: ${JSON.stringify(sub)}`);
        const economics = {
          borrowerRef: `0x${sha256(sub.loanData.data_room_id)}` as Hex,
          originalFacilitySize: units(e.original_facility_size, 6),
          originalSeniorTranche: units(e.original_senior_tranche, 6),
          originalEquityTranche: units(e.original_equity_tranche, 6),
          originalOfftakerPrice: units(e.original_offtaker_price, 6),
          seniorInterestRate: e.senior_interest_rate_bps * 100,
          originationDate: BigInt(e.origination_date),
          originalMaturityDate: BigInt(e.original_maturity_date),
        };
        const { registry } = ids();
        loanId = await send<bigint>(role("LoanRegistryManager"), registry, abi, "drawLoan", [sub.metadataUri, economics]);
        const immutable = await chain<Entry>(registry, "immutableLoanData", [loanId]);
        const linked = await until("the API to link the submission to the drawn loan", async () => {
          const s = (ok(await http("GET", `/v1/loan-book/submissions?${EVM_CHAIN}`), "submissions") as Entry[]).find((x) => x.id === sub.id);
          return s?.loan_id ? s : undefined;
        });
        recorded["evm.loan.draw"] = str({
          loanId,
          status: STATUS[(await chain<Entry>(registry, "mutableLoanData", [loanId])).status],
          immutable: { senior: immutable.originalSeniorTranche, equity: immutable.originalEquityTranche, offtakerPrice: immutable.originalOfftakerPrice, rate: immutable.seniorInterestRate },
          submitted: { senior: economics.originalSeniorTranche, equity: economics.originalEquityTranche, offtakerPrice: economics.originalOfftakerPrice, rate: economics.seniorInterestRate },
          linkedLoanId: linked.loan_id,
        });
      },
    },
    {
      name: "deal tokens",
      run: async ({ recorded }) => {
        const { factory } = ids();
        await send(role("LoanRegistryManager"), factory, abi, "registerDeal", [loanId]);
        recorded["evm.loan.deal"] = await chain<{ debt: Address; cargo: Address }>(factory, "deal", [loanId]);
      },
    },
    {
      name: "wire in and disburse",
      run: async ({ recorded }) => {
        const { minter, registry, capital } = ids();
        const amount = units(SENIOR, 6);
        const bankBefore = await chain<bigint>(minter, "bankCash");
        // The Cash reporter (MintCaller) books the borrower's facility cash into the minter's escrow; minter ops wire it out.
        await send(role("MintCaller"), minter, abi, "recordWireIn", [minter, amount, now(), ref()]);
        const bankAfterWire = await chain<bigint>(minter, "bankCash");
        await send(role("MinterOps"), minter, abi, "disburse", [loanId, amount, now(), ref()]);
        ok(await http("POST", `/v1/loan-book/${loanId}/disbursement/complete?${EVM_CHAIN}`, { token: trusteeToken }), "disbursement complete");
        const mutable = await chain<Entry>(registry, "mutableLoanData", [loanId]);
        const debt = (recorded["evm.loan.deal"] as { debt: Address }).debt;
        recorded["evm.loan.disburse"] = str({
          amount,
          wiredIn: bankAfterWire - bankBefore,
          bankAfterWire,
          bankAfter: await chain<bigint>(minter, "bankCash"),
          disbursed: mutable.disbursed,
          status: STATUS[mutable.status],
          debtBalance: await read<bigint>(debt, "balanceOf", [capital], views),
        });
      },
    },
    {
      name: "collateral and margin call",
      run: async ({ recorded }) => {
        const { collateral } = ids();
        const trustee = role("CollateralTrustee");
        const receipt = (need(recorded, "evm.loan.submission").documents as Entry[]).find((d) => d.name === "Warehouse Receipt")!;
        const lot = {
          kind: 0,
          unit: 1,
          haircutBps: 0,
          hasLocation: false,
          quantity: QUANTITY,
          cargo: { commodity: "Gold", valuationMode: 0 },
          receivable: { obligorRef: `0x${"0".repeat(64)}`, dueDate: 0n, form: 0 },
          location: { locationType: 0, identifier: "", trackingUrl: "" },
        };
        const lotId = await send<bigint>(trustee, collateral, abi, "pledge", [loanId, lot]);
        await send(trustee, collateral, abi, "setControl", [loanId, lotId, { kind: CMA, ref: "E2E CM" }]);
        await send(trustee, collateral, abi, "addDoc", [loanId, lotId, WAREHOUSE_RECEIPT, `0x${receipt.sha256}`]);
        const revalue = (perUnit: bigint) => send(role("CollateralValuer"), collateral, abi, "revalue", [loanId, lotId, perUnit, stringToHex("XAU", { size: 32 }), `0x${sha256(`mark ${perUnit}`)}`]);
        await revalue(units(PRICE, 6));
        await send(trustee, collateral, abi, "setFloor", [loanId, FLOOR_BPS]);
        const marked = await security();
        await revalue(MARK_DOWN);
        const called = await security();
        const onChain = await chain<Entry>(collateral, "lot", [loanId, lotId]);
        recorded["evm.loan.collateral"] = str({
          lotId,
          control: onChain.control.kind,
          docs: (onChain.docs as Entry[]).map((d) => d.hash.slice(2)),
          marked,
          called,
        });
      },
    },
    {
      name: "loan book while active",
      run: async ({ recorded }) => {
        const { registry } = ids();
        const { entry, summary } = await until("the loan book to price the loan", async () => {
          const lb = await loanBook();
          return lb.entry?.collateral && lb.entry.status === "Performing" ? lb : undefined;
        }, 180_000);
        const auditLog = async () => (ok(await http("GET", `/v1/audit-log?${EVM_CHAIN}`), "audit log").items as Entry[]).find((i) => i.event_name === "MarginCall" && i.scope?.loan_id === String(loanId));
        const marginCall = await until("the audit log to show the margin call", auditLog, 60_000).catch(() => null);
        const s = await security();
        const immutable = await chain<Entry>(registry, "immutableLoanData", [loanId]);
        recorded["evm.loanBook.active"] = str({
          entry: pick(entry!, ["principal", "senior_outstanding", "original_senior_tranche", "rate", "spot_price", "collateral", "ltv", "status", "onchain_status", "documents", "ltv_bps", "margin_call_open"]),
          auditMarginCall: marginCall ? pick(marginCall, ["action", "details"]) : null,
          summary: pick(summary, ["avg_yield", "weighted_rate", "deployed_senior"]),
          dashboard: pick(ok(await http("GET", `/v1/dashboard/summary?${EVM_CHAIN}`), "dashboard summary"), ["outstanding_in_loans", "loan_book_yield"]),
          financialPosition: ok(await http("GET", `/v1/financial-position?${EVM_CHAIN}`), "financial position").assets.deployed.secured_loans_outstanding,
          chain: {
            facility: immutable.originalFacilitySize,
            senior: immutable.originalSeniorTranche,
            outstanding: s.outstanding,
            outstandingTotal: await chain<bigint>(registry, "outstandingTotal"),
            activeFacility: await activeFacility(),
            rate: (await chain<Entry>(registry, "mutableLoanData", [loanId])).currentRate,
            value: s.value,
            marginCalls: s.marginCalls,
          },
        });
      },
    },
    {
      name: "repay",
      run: async ({ recorded }) => {
        const { minter, registry, vault, capital } = ids();
        const before = await chain<Entry>(registry, "loanMoney", [loanId]);
        const vaultBefore = await chain<bigint>(vault, "totalAssets");
        const interest = before.accruedInterest as bigint;
        const principal = before.outstanding as bigint;
        const repayment = {
          offtakerReceived: principal + interest,
          seniorPrincipalRepaid: principal,
          seniorInterest: interest,
          equityDistributed: 0n,
          mgmtFee: 0n,
          perfFee: 0n,
          oetAlloc: 0n,
        };
        // As the Cash reporter (MintCaller), with the LP app's EVM minter ABI.
        const repaymentId = await send<bigint>(role("MintCaller"), minter, minterRecoveryAbi, "repay", [loanId, repayment, now(), ref(), 0n]);
        const booked = (await events(minter, "CashRepaid", { loanId })).find((e) => e.repaymentId === repaymentId);
        const debt = (recorded["evm.loan.deal"] as { debt: Address }).debt;
        recorded["evm.loan.repay"] = str({
          repaymentId,
          repayment,
          interestMinted: booked?.interestMinted ?? null,
          vaultDelta: (await chain<bigint>(vault, "totalAssets")) - vaultBefore,
          outstandingAfter: (await chain<Entry>(registry, "loanMoney", [loanId])).outstanding,
          debtBalance: await read<bigint>(debt, "balanceOf", [capital], views),
        });
      },
    },
    {
      name: "close",
      run: async ({ recorded }) => {
        const { registry } = ids();
        await send(role("LoanRegistryManager"), registry, abi, "closeLoan", [loanId, CLOSURE.indexOf("EarlyRepayment")]);
        const mutable = await chain<Entry>(registry, "mutableLoanData", [loanId]);
        recorded["evm.loan.close"] = { status: STATUS[mutable.status], reason: CLOSURE[mutable.closureReason] };
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
        // shortcut: Σ CashRepaid.interestMinted ignores reversals and carve-outs, which no e2e journey makes; net them when one does.
        const minted = (await events(minter, "CashRepaid")).reduce((s, e) => s + (e.interestMinted as bigint), 0n);
        const summaryNow = async () => ok(await http("GET", `/v1/dashboard/summary?${EVM_CHAIN}`), "dashboard summary").cumulative_yield_total;
        const yieldTotal = await until("the API to index the repayment", async () => {
          const y = await summaryNow();
          return units(String(y), 6) === minted ? y : undefined;
        }, 60_000).catch(summaryNow);
        const offtakerReceived = (await events(registry, "PaymentRecorded", { loanId })).reduce((s, e) => s + (e.repayment.offtakerReceived as bigint), 0n);
        recorded["evm.loanBook.closed"] = str({
          entry: pick(entry!, ["status", "onchain_status", "repaid_to_date", "senior_outstanding"]),
          deployedSenior: summary.deployed_senior,
          financialPosition: ok(await http("GET", `/v1/financial-position?${EVM_CHAIN}`), "financial position").assets.deployed.secured_loans_outstanding,
          yieldTotal,
          chain: { offtakerReceived, outstandingTotal: await chain<bigint>(registry, "outstandingTotal"), activeFacility: await activeFacility(), interestMinted: minted },
        });
      },
    },
  ],
  checks: [],
};

const RATE = (RATE_BPS / 10_000).toFixed(6);

journey.checks = [
  check("evm.loan.submission", "The originator submits a 31337 loan through the API and the trustee approves it", (r) => {
    const s = need(r, "evm.loan.submission");
    return verdict(s.statusBefore === "InReview" && s.statusAfter === "Approved", JSON.stringify(s));
  }),
  check("evm.loan.documents", "Loan documents stored in MinIO are served unchanged through the IPFS stub and listed in the 31337 loan book", (r) => {
    const docs = need(r, "evm.loan.submission").documents as Entry[];
    const listed = need(r, "evm.loanBook.active").entry.documents as Entry[] | null;
    const served = docs.every((d) => d.served === d.sha256);
    const inBook = docs.every((d) => listed?.some((l) => l.name === d.name && l.uri === d.uri));
    return verdict(docs.length > 0 && served && inBook, `stored ${JSON.stringify(docs)}; loan book ${JSON.stringify(listed)}`);
  }),
  check("evm.loan.draw", "drawLoan mints the loan as Approved with the submitted economics in 6-decimal units and the rate in ppm, and the API links the submission", (r) => {
    const d = need(r, "evm.loan.draw");
    const econ = JSON.stringify(d.immutable) === JSON.stringify(d.submitted) && d.immutable.rate === RATE_BPS * 100;
    return verdict(d.status === "Approved" && econ && d.linkedLoanId === d.loanId, JSON.stringify(d));
  }),
  check("evm.loan.disburse", "registerDeal, the Cash reporter's recordWireIn books the cash, disburse draws the senior tranche; the loan turns Performing and the DEBT token tracks it", (r) => {
    const deal = need(r, "evm.loan.deal");
    const d = need(r, "evm.loan.disburse");
    const cash = d.wiredIn === d.amount && BigInt(d.bankAfterWire) - BigInt(d.bankAfter) === BigInt(d.amount);
    return verdict(/^0x[0-9a-fA-F]{40}$/.test(deal.debt) && cash && d.disbursed === d.amount && d.status === "Performing" && d.debtBalance === d.amount, `deal ${JSON.stringify(deal)}; ${JSON.stringify(d)}`);
  }),
  check("evm.loan.collateral", "A controlled cargo lot with the warehouse receipt's hash, marked at the static price, values the collateral on the collateral registry above the floor", (r) => {
    const c = need(r, "evm.loan.collateral");
    const receipt = (need(r, "evm.loan.submission").documents as Entry[]).find((d) => d.name === "Warehouse Receipt")?.sha256;
    const m = c.marked;
    return verdict(c.control === CMA && c.docs.includes(receipt) && m.value === units(PRICE, 6).toString() && m.coverage >= FLOOR_BPS && m.marginCalls.length === 0, JSON.stringify(c));
  }),
  check("evm.loan.margin-call", "Marking the collateral down below the coverage floor emits MarginCall on the collateral registry", (r) => {
    const c = need(r, "evm.loan.collateral").called;
    const ev = c.marginCalls.at(-1);
    return verdict(c.coverage < FLOOR_BPS && ev?.floor === FLOOR_BPS && ev.coverage < FLOOR_BPS, JSON.stringify(c));
  }),
  check("evm.loan.repay", "repay through the minter books principal and accrued interest, clears the outstanding and the DEBT token, and mints the interest to sPLUSD", (r) => {
    const p = need(r, "evm.loan.repay");
    const interest = p.repayment.seniorInterest;
    return verdict(BigInt(interest) > 0n && p.interestMinted === interest && p.vaultDelta === interest && p.outstandingAfter === "0" && p.debtBalance === "0", JSON.stringify(p));
  }),
  check("evm.loan.close", "closeLoan with EarlyRepayment closes the repaid loan", (r) => {
    const c = need(r, "evm.loan.close");
    return verdict(c.status === "Closed" && c.reason === "EarlyRepayment", JSON.stringify(c));
  }),
  check("evm.loan-book.entry", "/v1/loan-book principal, senior tranche and senior outstanding of the 31337 loan match the loan registry", (r) => {
    const { entry: e, chain: c } = need(r, "evm.loanBook.active");
    const all = [same("principal", e.principal, c.facility), same("original_senior_tranche", e.original_senior_tranche, c.senior), same("senior_outstanding", e.senior_outstanding, c.outstanding)];
    return verdict(all.every((x) => x.ok), all.map((x) => x.details).filter(Boolean).join("; "));
  }),
  check("evm.loan-book.rate", "/v1/loan-book rate of the 31337 loan is the registry's ppm rate as a fraction (#765, fixed in #1434)", (r) => {
    const { entry: e, chain: c } = need(r, "evm.loanBook.active");
    const expected = (Number(c.rate) / 1e6).toFixed(6);
    return { ok: e.rate === expected && e.rate === RATE, details: `API rate ${e.rate} vs chain currentRate ${c.rate} ppm = ${expected} (submitted ${RATE_BPS} bps)` };
  }),
  check("evm.loan-book.collateral", "/v1/loan-book values the 31337 collateral at the static price × quantity, less the haircut", (r) => {
    const { entry } = need(r, "evm.loanBook.active");
    return verdict(units(String(entry.spot_price), 6) === units(PRICE, 6) && units(String(entry.collateral), 6) === units(PRICE, 6), `spot ${entry.spot_price}, collateral ${entry.collateral} (expected ${PRICE} × 1, no haircut)`);
  }),
  check("evm.loan-book.ltv-range", "31337 loan-book LTV is within 0–200% and equals principal / collateral (#765)", (r) => {
    const { entry } = need(r, "evm.loanBook.active");
    const expected = (Number(entry.principal) / Number(entry.collateral)).toFixed(4);
    const ltv = Number(entry.ltv);
    return { ok: ltv >= 0 && ltv <= 2 && entry.ltv === expected, details: `LTV ${entry.ltv} (${(ltv * 100).toFixed(2)}%): principal ${entry.principal} / collateral ${entry.collateral} = ${expected}` };
  }),
  check("evm.loan-book.margin-call", "/v1/audit-log shows the collateral registry's MarginCall for the 31337 loan with its coverage and floor", (r) => {
    const { auditMarginCall: a, chain: c } = need(r, "evm.loanBook.active");
    const ev = c.marginCalls.at(-1);
    const match = a !== null && ev && String(a.details?.coverage_bps) === String(ev.coverage) && String(a.details?.floor_bps) === String(ev.floor);
    return verdict(Boolean(match), `API ${JSON.stringify(a)} vs chain ${JSON.stringify(ev ?? null)}`);
  }),
  check("evm.loan-book.summary", "While the 31337 loan is active: weighted rate, deployed senior, /v1/dashboard/summary and /v1/financial-position match the registry", (r) => {
    const a = need(r, "evm.loanBook.active");
    const rates = a.summary.weighted_rate === RATE && a.dashboard.loan_book_yield === RATE;
    const money = [same("deployed_senior", a.summary.deployed_senior, a.chain.outstandingTotal), same("secured_loans_outstanding", a.financialPosition, a.chain.activeFacility), same("outstanding_in_loans", a.dashboard.outstanding_in_loans, a.chain.activeFacility)];
    return verdict(rates && money.every((x) => x.ok), `summary ${JSON.stringify(a.summary)}, dashboard ${JSON.stringify(a.dashboard)}, financial position ${a.financialPosition} vs chain ${JSON.stringify(a.chain)}`);
  }),
  check("evm.loan-book.closed", "After close the 31337 loan book shows the loan Closed with what was repaid; deployed senior and secured loans drop it", (r) => {
    const c = need(r, "evm.loanBook.closed");
    const money = [same("repaid_to_date", c.entry.repaid_to_date, c.chain.offtakerReceived), same("deployed_senior", c.deployedSenior, c.chain.outstandingTotal), same("secured_loans_outstanding", c.financialPosition, c.chain.activeFacility)];
    return verdict(c.entry.status === "Closed" && money.every((x) => x.ok), JSON.stringify(c));
  }),
  check("evm.loan-book.yield", "/v1/dashboard/summary cumulative yield for 31337 equals the interest the minter minted to sPLUSD", (r) => {
    const c = need(r, "evm.loanBook.closed");
    return same("cumulative_yield_total", c.yieldTotal, c.chain.interestMinted);
  }),
];

export default journey;
