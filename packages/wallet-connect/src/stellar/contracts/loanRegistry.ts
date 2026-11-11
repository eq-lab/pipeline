// spec: docs/frontend/trustee-flows.md#chain-first-approve-ordering-831
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as SorobanRpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import { simulateRead } from "./simulateRead";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DrawLoanEconomics {
  borrower_ref: string;
  original_facility_size: string;
  original_senior_tranche: string;
  original_equity_tranche: string;
  original_offtaker_price: string;
  senior_interest_rate: number;
  origination_date: number;
  original_maturity_date: number;
}

export interface DrawLoanArgs {
  metadata_uri: string;
  economics: DrawLoanEconomics;
}

/** Mirrors the contract's `LocationUpdate` / the API's `LocationInput`. */
export interface LocationInput {
  /** One of `Vessel`, `Warehouse`, `TankFarm`, `Other`. */
  location_type: string;
  location_identifier: string;
  tracking_url: string;
  /** Report timestamp (Unix seconds). */
  updated_at: number;
}

/** Progress stages surfaced during `drawLoan` for Approve-button UX (issue #831 Open Question 5). */
export type DrawLoanStage = "awaiting-signature" | "submitting" | "confirming";

export interface DrawLoanParams {
  /** Executor / access-control contract id. */
  executorId: string;
  /** Loan-registry contract id (the `execute` call's `target`). */
  targetId: string;
  /** Connected trustee wallet address — both `caller` and the tx source account. */
  caller: string;
  args: DrawLoanArgs;
  /** Soroban RPC URL. */
  rpcUrl: string;
  networkPassphrase: string;
  /** Injected wallet signing callback (mirrors `useStellarWallet().signTransaction`). */
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  /** Optional progress callback — fired before each major phase. */
  onStageChange?: (stage: DrawLoanStage) => void;
}

export interface DrawLoanResult {
  hash: string;
  /**
   * The on-chain id of the loan just drawn (#876) — lets the trustee jump
   * straight to `/loans/{loanId}` after approving. Sourced from the tx's
   * return value (`draw_loan` returns the new id), falling back to the
   * `loan_drawn` event topic. `null` if neither is present in the result
   * (the mint still succeeded — the caller just can't deep-link).
   */
  loanId: number | null;
}

// ── ScVal encoding helpers ────────────────────────────────────────────────────

/**
 * Builds a Soroban `map` ScVal from `[symbolKey, ScVal]` entries, sorting by
 * key — Soroban requires map keys in sorted order; a contract call with an
 * unsorted map either fails to decode or silently reads the wrong field.
 * Keys are encoded as `Symbol`s (the shape Soroban struct fields use), NOT
 * `String`s.
 */
function scMap(entries: Array<[string, xdr.ScVal]>): xdr.ScVal {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return xdr.ScVal.scvMap(
    sorted.map(
      ([key, val]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

function u128(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u128" });
}

function u64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: "u64" });
}

const U128_MAX = 2n ** 128n - 1n;
const U32_MAX = 4_294_967_295;

function invalidInput(field: string, hint = ""): Error {
  return new Error(`drawLoan: invalid draw_loan input ${field}${hint}`);
}

function hexToBytes32(hex: unknown): Uint8Array {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw invalidInput(
      "economics.borrower_ref",
      " (expected 32 bytes as 64 hex characters)",
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw invalidInput(
      `economics.${field}`,
      " (expected a base-unit integer string)",
    );
  }
  const n = BigInt(value);
  if (n > U128_MAX) {
    throw invalidInput(`economics.${field}`, " (exceeds u128)");
  }
  return n;
}

function parseDate(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`economics.${field}`, " (expected unix seconds)");
  }
  return value;
}

function parseRate(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > U32_MAX
  ) {
    throw invalidInput("economics.senior_interest_rate", " (expected a u32)");
  }
  return value;
}

function encodeEconomicsMap(economics: DrawLoanEconomics): xdr.ScVal {
  if (!economics || typeof economics !== "object") {
    throw invalidInput("economics");
  }
  const borrowerRef = hexToBytes32(economics.borrower_ref);
  return scMap([
    ["borrower_ref", nativeToScVal(borrowerRef, { type: "bytes" })],
    [
      "original_equity_tranche",
      u128(
        parseAmount(
          economics.original_equity_tranche,
          "original_equity_tranche",
        ),
      ),
    ],
    [
      "original_facility_size",
      u128(
        parseAmount(economics.original_facility_size, "original_facility_size"),
      ),
    ],
    [
      "original_maturity_date",
      u64(
        parseDate(economics.original_maturity_date, "original_maturity_date"),
      ),
    ],
    [
      "original_offtaker_price",
      u128(
        parseAmount(
          economics.original_offtaker_price,
          "original_offtaker_price",
        ),
      ),
    ],
    [
      "original_senior_tranche",
      u128(
        parseAmount(
          economics.original_senior_tranche,
          "original_senior_tranche",
        ),
      ),
    ],
    [
      "origination_date",
      u64(parseDate(economics.origination_date, "origination_date")),
    ],
    [
      "senior_interest_rate",
      xdr.ScVal.scvU32(parseRate(economics.senior_interest_rate)),
    ],
  ]);
}

export function encodeDrawLoanArgs(args: DrawLoanArgs): xdr.ScVal[] {
  if (
    typeof args?.metadata_uri !== "string" ||
    args.metadata_uri.trim() === ""
  ) {
    throw invalidInput("metadata_uri");
  }
  return [
    xdr.ScVal.scvString(args.metadata_uri),
    encodeEconomicsMap(args.economics),
  ];
}

// ── Envelope build + simulate ─────────────────────────────────────────────────

export interface BuildDrawLoanEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  args: DrawLoanArgs;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Builds, simulates, and assembles the `execute(target, "draw_loan", args,
 * caller)` transaction — unsigned XDR ready for `signTransaction`.
 *
 * The `simulateTransaction` call here IS the "verify the loan" pre-submit
 * step (issue #831): a bad encoding or an invalid loan fails here with a
 * decode/contract error, before any signature is requested.
 *
 * @throws if any id is empty, or the simulation errors.
 */
export async function buildDrawLoanEnvelope({
  executorId,
  targetId,
  caller,
  args,
  rpcUrl,
  networkPassphrase,
}: BuildDrawLoanEnvelopeParams): Promise<string> {
  if (!executorId) {
    throw new Error("buildDrawLoanEnvelope: executorId must not be empty");
  }
  if (!targetId) {
    throw new Error("buildDrawLoanEnvelope: targetId must not be empty");
  }
  if (!caller) {
    throw new Error("buildDrawLoanEnvelope: caller must not be empty");
  }

  const encodedArgs = encodeDrawLoanArgs(args);

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("draw_loan"),
    xdr.ScVal.scvVec(encodedArgs),
    new Address(caller).toScVal(),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`drawLoan simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

function toLoanId(native: unknown): number | null {
  const n =
    typeof native === "bigint"
      ? Number(native)
      : typeof native === "number"
        ? native
        : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : null;
}

/**
 * Best-effort extraction of the just-drawn loan id from a successful
 * `draw_loan` transaction (#876). Tries the tx return value first (`draw_loan`
 * returns the new id), then the `loan_drawn` contract event's `loan_id` topic
 * (`topics: [loan_drawn, loan_id: u32, holder]` — see the worker's
 * `parse_loan_drawn`). Returns `null` if neither is present or decodable — the
 * mint still succeeded, the caller just can't deep-link to the loan.
 */
function extractDrawnLoanId(
  finalResult: SorobanRpc.Api.GetSuccessfulTransactionResponse,
): number | null {
  // 1) The call's return value — `execute` forwards `draw_loan`'s returned id.
  try {
    if (finalResult.returnValue) {
      const id = toLoanId(scValToNative(finalResult.returnValue));
      if (id != null) return id;
    }
  } catch {
    // fall through to the event scan
  }

  // 2) The `loan_drawn` contract event topic.
  try {
    const events = finalResult.resultMetaXdr.v3().sorobanMeta()?.events() ?? [];
    for (const event of events) {
      const topics = event.body().v0().topics();
      const nameTopic = topics[0];
      const idTopic = topics[1];
      if (!nameTopic || !idTopic) continue;
      if (scValToNative(nameTopic) === "loan_drawn") {
        const id = toLoanId(scValToNative(idTopic));
        if (id != null) return id;
      }
    }
  } catch {
    // ignore — return null below
  }

  return null;
}

// ── Orchestration: build → sign → submit → poll ───────────────────────────────

/**
 * Signs and submits the trustee-wallet-signed `draw_loan` mint end-to-end:
 * build envelope (incl. the verifying `simulateTransaction`) → sign via the
 * injected `signTransaction` → submit → poll to a terminal status.
 *
 * No signature is requested if the simulation fails (`buildDrawLoanEnvelope`
 * throws before `signTransaction` is ever called) — a wallet-reject or
 * simulate/send/poll failure all reject this promise; callers must leave the
 * submission `InReview` and make no review call on any rejection (issue
 * #831's chain-first ordering).
 */
export async function drawLoan({
  executorId,
  targetId,
  caller,
  args,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: DrawLoanParams): Promise<DrawLoanResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildDrawLoanEnvelope({
    executorId,
    targetId,
    caller,
    args,
    rpcUrl,
    networkPassphrase,
  });

  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: caller,
  });

  onStageChange?.("submitting");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx as Transaction);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `drawLoan: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `drawLoan: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash, loanId: extractDrawnLoanId(finalResult) };
}

// ── Rollover (issue #870) ─────────────────────────────────────────────────────

/**
 * Soroban client for the trustee's `rollover` on-chain call (issue #870) —
 * `LoanRegistry.rollover`, run through the SAME executor proxy as `draw_loan`:
 *
 *   executor.execute(target: Address, function: Symbol("rollover"), args, caller)
 *
 * Appends an epoch from the prior maturity, sets `currentMaturityDate`, returns
 * the loan's status to Performing, and raises the mint ceiling only (mints
 * nothing). On success the indexer emits `LoanRolledOver { new_maturity_timestamp:
 * u64, new_rate: u32 }`.
 *
 * Positional args: **`(loan_id: u32, new_rate: u32, new_maturity_timestamp:
 * u64)`** — rate BEFORE maturity, matching the S9 form order. `new_rate` is the
 * on-chain bps × 100 scale (see `encodeRolloverArgs`). The initial cut sent
 * `(loan_id, new_maturity, new_rate)` and the contract trapped
 * (`UnreachableCodeReached` — `new_maturity` decoded as `1234`, a past
 * timestamp, tripping the future-maturity guard). The verifying
 * `simulateTransaction` in `buildRolloverEnvelope` fails loudly on a wrong
 * encoding before any signature is requested.
 */
export type RolloverStage = DrawLoanStage;

export interface RolloverParams {
  /** Executor / access-control contract id (same as `draw_loan`). */
  executorId: string;
  /** Loan-registry contract id (the `execute` call's `target`). */
  targetId: string;
  /** Connected trustee wallet address — both `caller` and the tx source account. */
  caller: string;
  /** On-chain loan id (u32). */
  loanId: number;
  /** New senior interest rate, basis points (u32). */
  newRateBps: number;
  /** New maturity timestamp, Unix seconds (u64). */
  newMaturity: number;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: RolloverStage) => void;
}

export interface RolloverResult {
  hash: string;
}

/**
 * Encodes `rollover`'s positional args: `(loan_id: u32, new_maturity_timestamp:
 * u64, new_rate: u32)`. Exported for direct unit testing. See the arg-order
 * caveat above.
 */
export function encodeRolloverArgs(
  loanId: number,
  newRateBps: number,
  newMaturity: number,
): xdr.ScVal[] {
  return [
    xdr.ScVal.scvU32(loanId),
    // Rate is stored on-chain at bps × 100 (same scale as `draw_loan`'s
    // `senior_interest_rate = senior_interest_rate_bps * 100`; the indexer reads
    // it back with `/ 100`). Pass the scaled value, not raw bps.
    xdr.ScVal.scvU32(newRateBps * 100),
    u64(newMaturity),
  ];
}

export interface BuildRolloverEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  newRateBps: number;
  newMaturity: number;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Builds, simulates, and assembles the `execute(target, "rollover", args,
 * caller)` transaction — unsigned XDR ready for `signTransaction`. The
 * simulation is the pre-submit verify step (mirrors `buildDrawLoanEnvelope`).
 */
export async function buildRolloverEnvelope({
  executorId,
  targetId,
  caller,
  loanId,
  newRateBps,
  newMaturity,
  rpcUrl,
  networkPassphrase,
}: BuildRolloverEnvelopeParams): Promise<string> {
  if (!executorId) {
    throw new Error("buildRolloverEnvelope: executorId must not be empty");
  }
  if (!targetId) {
    throw new Error("buildRolloverEnvelope: targetId must not be empty");
  }
  if (!caller) {
    throw new Error("buildRolloverEnvelope: caller must not be empty");
  }

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("rollover"),
    xdr.ScVal.scvVec(encodeRolloverArgs(loanId, newRateBps, newMaturity)),
    new Address(caller).toScVal(),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`rollover simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

/**
 * Signs and submits the trustee-wallet-signed `rollover` end-to-end: build
 * envelope (incl. the verifying `simulateTransaction`) → sign → submit → poll to
 * a terminal status. Mirrors `drawLoan`. Any wallet-reject or simulate/send/poll
 * failure rejects this promise.
 */
export async function rollover({
  executorId,
  targetId,
  caller,
  loanId,
  newRateBps,
  newMaturity,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: RolloverParams): Promise<RolloverResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildRolloverEnvelope({
    executorId,
    targetId,
    caller,
    loanId,
    newRateBps,
    newMaturity,
    rpcUrl,
    networkPassphrase,
  });

  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: caller,
  });

  onStageChange?.("submitting");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx as Transaction);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `rollover: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `rollover: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
}

// ── Update lifecycle (issue #872) ─────────────────────────────────────────────

export type UpdateMutableStage = DrawLoanStage;

export interface UpdateMutableParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  status: string;
  metadataUri: string;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: UpdateMutableStage) => void;
}

export interface UpdateMutableResult {
  hash: string;
}

export function encodeUpdateMutableArgs(
  loanId: number,
  status: string,
  metadataUri: string,
): xdr.ScVal[] {
  return [
    xdr.ScVal.scvU32(loanId),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(status)]),
    xdr.ScVal.scvString(metadataUri),
  ];
}

export interface BuildUpdateMutableEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  status: string;
  metadataUri: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export async function buildUpdateMutableEnvelope({
  executorId,
  targetId,
  caller,
  loanId,
  status,
  metadataUri,
  rpcUrl,
  networkPassphrase,
}: BuildUpdateMutableEnvelopeParams): Promise<string> {
  if (!executorId) {
    throw new Error("buildUpdateMutableEnvelope: executorId must not be empty");
  }
  if (!targetId) {
    throw new Error("buildUpdateMutableEnvelope: targetId must not be empty");
  }
  if (!caller) {
    throw new Error("buildUpdateMutableEnvelope: caller must not be empty");
  }

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("update_mutable"),
    xdr.ScVal.scvVec(encodeUpdateMutableArgs(loanId, status, metadataUri)),
    new Address(caller).toScVal(),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`updateMutable simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

export async function updateMutable({
  executorId,
  targetId,
  caller,
  loanId,
  status,
  metadataUri,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: UpdateMutableParams): Promise<UpdateMutableResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildUpdateMutableEnvelope({
    executorId,
    targetId,
    caller,
    loanId,
    status,
    metadataUri,
    rpcUrl,
    networkPassphrase,
  });

  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: caller,
  });

  onStageChange?.("submitting");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx as Transaction);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `updateMutable: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `updateMutable: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
}

// ── Repayment data ────────────────────────────────────────────────────────────

export interface RepaymentInput {
  offtaker_received: string;
  senior_principal_repaid: string;
  senior_interest: string;
  equity_distributed: string;
  mgmt_fee: string;
  perf_fee: string;
  oet_alloc: string;
}

export function encodeRepaymentData(r: RepaymentInput): xdr.ScVal {
  return scMap([
    ["equity_distributed", u128(BigInt(r.equity_distributed))],
    ["mgmt_fee", u128(BigInt(r.mgmt_fee))],
    ["oet_alloc", u128(BigInt(r.oet_alloc))],
    ["offtaker_received", u128(BigInt(r.offtaker_received))],
    ["perf_fee", u128(BigInt(r.perf_fee))],
    ["senior_interest", u128(BigInt(r.senior_interest))],
    ["senior_principal_repaid", u128(BigInt(r.senior_principal_repaid))],
  ]);
}

export interface ReadNextRepaymentIdParams {
  registryId: string;
  loanId: number;
  rpcUrl: string;
  networkPassphrase: string;
}

export async function readNextRepaymentId({
  registryId,
  loanId,
  rpcUrl,
  networkPassphrase,
}: ReadNextRepaymentIdParams): Promise<number> {
  if (!registryId) {
    throw new Error("readNextRepaymentId: registryId must not be empty");
  }
  const data = (await simulateRead(
    registryId,
    "mutable_loan_data",
    [xdr.ScVal.scvU32(loanId)],
    { rpcUrl, networkPassphrase, label: "readNextRepaymentId" },
  )) as { next_repayment_id?: number | bigint };
  const next = Number(data?.next_repayment_id);
  if (!Number.isInteger(next) || next < 0) {
    throw new Error("readNextRepaymentId: next_repayment_id missing");
  }
  return next;
}

export interface ReadRepaymentParams extends ReadNextRepaymentIdParams {
  repaymentId: number;
}

const REPAYMENT_KEYS = [
  "offtaker_received",
  "senior_principal_repaid",
  "senior_interest",
  "equity_distributed",
  "mgmt_fee",
  "perf_fee",
  "oet_alloc",
] as const;

export async function readRepaymentData({
  registryId,
  loanId,
  repaymentId,
  rpcUrl,
  networkPassphrase,
}: ReadRepaymentParams): Promise<RepaymentInput> {
  if (!registryId) {
    throw new Error("readRepaymentData: registryId must not be empty");
  }
  const data = (await simulateRead(
    registryId,
    "repayment_data",
    [xdr.ScVal.scvU32(loanId), xdr.ScVal.scvU32(repaymentId)],
    { rpcUrl, networkPassphrase },
  )) as Record<string, bigint | number | string | undefined>;
  const out = {} as Record<(typeof REPAYMENT_KEYS)[number], string>;
  for (const key of REPAYMENT_KEYS) {
    const raw = data?.[key];
    if (raw === undefined || raw === null) {
      throw new Error(`readRepaymentData: ${key} missing`);
    }
    out[key] = String(raw);
  }
  return out;
}

export async function readIsRepaymentReversed({
  registryId,
  loanId,
  repaymentId,
  rpcUrl,
  networkPassphrase,
}: ReadRepaymentParams): Promise<boolean> {
  if (!registryId) {
    throw new Error("readIsRepaymentReversed: registryId must not be empty");
  }
  const reversed = await simulateRead(
    registryId,
    "is_repayment_reversed",
    [xdr.ScVal.scvU32(loanId), xdr.ScVal.scvU32(repaymentId)],
    { rpcUrl, networkPassphrase },
  );
  return reversed === true;
}

// ── Close loan (issue #884) ───────────────────────────────────────────────────

/**
 * Soroban client for the trustee's `close_loan` on-chain call (issue #884) —
 * `LoanRegistry.closeLoan`, through the same executor proxy as `draw_loan`:
 *
 *   executor.execute(target, function: Symbol("close_loan"), args, caller)
 *
 * Moves the loan to `Closed`. Emits `LoanClosed { reason }`. Confirmed against
 * the deployed Rust source:
 *
 *   pub enum ClosureReason { None, ScheduledMaturity, EarlyRepayment, Default, OtherWriteDown }
 *   pub fn close_loan(e: &Env, loan_id: u32, reason: ClosureReason)
 *
 * so the two wire args are `[u32 loan_id, ClosureReason]`. `ClosureReason` is a
 * unit-variant enum → `scvVec([scvSymbol(variant)])` (same shape as `LoanStatus`
 * / `draw_loan`'s `location_type`). TRUSTEE may close with `ScheduledMaturity` or
 * `EarlyRepayment` (the repayment-close reasons #884 uses).
 */
export type CloseLoanStage = DrawLoanStage;

export interface CloseLoanParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  /** A `ClosureReason` variant: `ScheduledMaturity` | `EarlyRepayment` (repayment closes). */
  reason: string;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: CloseLoanStage) => void;
}

export interface CloseLoanResult {
  hash: string;
}

/**
 * Encodes `close_loan`'s two positional args: `[loan_id: u32, reason:
 * ClosureReason]`. Exported for unit testing.
 */
export function encodeCloseLoanArgs(
  loanId: number,
  reason: string,
): xdr.ScVal[] {
  return [
    xdr.ScVal.scvU32(loanId),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(reason)]),
  ];
}

export interface BuildCloseLoanEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  reason: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Builds, simulates, and assembles the `execute(target, "close_loan", args,
 * caller)` transaction — unsigned XDR ready for `signTransaction`. Mirrors
 * `buildRecordPaymentEnvelope`.
 */
export async function buildCloseLoanEnvelope({
  executorId,
  targetId,
  caller,
  loanId,
  reason,
  rpcUrl,
  networkPassphrase,
}: BuildCloseLoanEnvelopeParams): Promise<string> {
  if (!executorId) {
    throw new Error("buildCloseLoanEnvelope: executorId must not be empty");
  }
  if (!targetId) {
    throw new Error("buildCloseLoanEnvelope: targetId must not be empty");
  }
  if (!caller) {
    throw new Error("buildCloseLoanEnvelope: caller must not be empty");
  }

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("close_loan"),
    xdr.ScVal.scvVec(encodeCloseLoanArgs(loanId, reason)),
    new Address(caller).toScVal(),
  );

  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`closeLoan simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

/**
 * Signs and submits the trustee-wallet-signed `close_loan` end-to-end: build
 * envelope (incl. the verifying `simulateTransaction`) → sign → submit → poll to
 * a terminal status. Mirrors `recordPayment`.
 */
export async function closeLoan({
  executorId,
  targetId,
  caller,
  loanId,
  reason,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: CloseLoanParams): Promise<CloseLoanResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildCloseLoanEnvelope({
    executorId,
    targetId,
    caller,
    loanId,
    reason,
    rpcUrl,
    networkPassphrase,
  });

  const { signedTxXdr } = await signTransaction(assembledXdr, {
    networkPassphrase,
    address: caller,
  });

  onStageChange?.("submitting");

  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });
  const signedTx = TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);

  const sendResult = await server.sendTransaction(signedTx as Transaction);

  if (sendResult.status === "ERROR") {
    throw new Error(
      `closeLoan: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `closeLoan: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
}
