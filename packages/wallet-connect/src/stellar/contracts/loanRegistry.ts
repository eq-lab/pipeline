/**
 * Soroban client for the trustee's `draw_loan` on-chain mint (issue #831).
 *
 * On Approve, the trustee wallet — NOT a backend relayer key — signs and
 * submits `execute(target, "draw_loan", args, caller)` on the executor /
 * access-control contract, registering the approved loan on-chain. Reached
 * via an executor/proxy pattern (not `draw_loan` directly):
 *
 *   executor.execute(target: Address, function: Symbol, args: Vec<Val>, caller: Address)
 *
 * where `target` is the loan-registry contract, `function` is the symbol
 * `"draw_loan"`, `args` are the five positional `draw_loan` arguments encoded
 * below, and `caller` is the connected trustee address (== the transaction's
 * source account, so a single source-account signature satisfies the
 * contract's `caller.require_auth()` — confirmed, issue #831 Open Question
 * 1 — no separate Soroban auth entry to assemble).
 *
 * Lives in `@pipeline/wallet-connect` (not the trustee app) per the #831
 * planner's architecture decision: the trustee app's ESLint config forbids
 * importing `@stellar/stellar-sdk` anywhere (TD-33/#791, no `src/wallet/**`
 * carve-out). This package already bundles the SDK and is the sanctioned
 * on-chain home; `drawLoan` is exposed as a **plain async function**
 * (mirroring `../sacBalance.ts`'s `getSacBalance`) — NOT a hook, since
 * `@tanstack/react-query` is forbidden outside `src/evm/**` in this package's
 * own ESLint config. The trustee wraps it in a thin `useMutation` hook
 * (`packages/trustee/src/api/useDrawLoan.ts`) that injects
 * `useStellarWallet().signTransaction`.
 *
 * ## Encoding (issue #831 Open Question 3, resolved against the contract)
 *
 * `loan_data` (the API's `SubmitLoanRequest`) → `draw_loan`'s 5 positional
 * args:
 *   [0] `address`  `to`
 *   [1] `string`   `metadata_uri`
 *   [2] `map`      economics (see `encodeEconomicsMap`)
 *   [3] `u32`      `initial_ccr` (already 1e6-scaled — pass through)
 *   [4] `map`      location (see `encodeLocationMap`)
 *
 * Economics map (Soroban requires map keys in sorted order — see `scMap`):
 *   - `original_facility_size` / `original_senior_tranche` /
 *     `original_equity_tranche` / `original_offtaker_price`: the API's
 *     6-decimal human-unit string (e.g. `"1200000.000000"` = $1,200,000) →
 *     `u128` = `round(decimal_value × 1000)` (see `parseUsdcAmountToU128`).
 *   - `senior_interest_rate_bps` (bps) → contract `senior_interest_rate`
 *     `u32` = `bps × 100` (1000 bps → `100000`).
 *   - `origination_date`, `original_maturity_date`: `u64` pass-through (Unix
 *     seconds).
 *
 * Location map:
 *   - `location_type` (`Vessel | Warehouse | TankFarm | Other`) → the
 *     contract's unit-variant enum, encoded as `{vec:[{symbol:<type>}]}`.
 *   - `location_identifier`, `tracking_url`: `string` pass-through.
 *   - `updated_at`: `u64` pass-through (Unix seconds).
 *
 * `simulateTransaction` (inside `buildDrawLoanEnvelope`) IS the "verify the
 * loan" step referenced in the issue — a bad encoding surfaces as a decode
 * error there, before any wallet signature is requested.
 *
 * Testnet contract ids (per #831): executor
 * `CAGCWDZYWDN6USS3YY7BA2FGRCLOPGHBTSPJ6VRSPAJSMGFPONFIAREF`, loan registry
 * `CDYKALTKVDLXALYAYIOTAWGTI3U7XZAUUXSYYM6QFXMCVTKV7PLD5UFH`. Injected by the
 * caller (trustee `ENV.STELLAR_LOAN_REGISTRY_EXECUTOR_ID` /
 * `ENV.STELLAR_LOAN_REGISTRY_ID`) — not hardcoded here.
 */
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

// ── Types (self-contained port of the API's SubmitLoanRequest — see
//    `packages/trustee/src/api/useLoanSubmissions.ts` /
//    `packages/api/src/routes/loan_book.rs`. Duplicated deliberately: this
//    package must not import from either app. See TD-42.) ──────────────────

/** Mirrors the contract's `ImmutableLoanData` / the API's `EconomicsInput`. */
export interface EconomicsInput {
  /** Total facility size, USDC (6-decimal string). */
  original_facility_size: string;
  /** Senior tranche, USDC (6-decimal string). */
  original_senior_tranche: string;
  /** Equity tranche, USDC (6-decimal string). */
  original_equity_tranche: string;
  /** Offtaker price, USDC (6-decimal string). */
  original_offtaker_price: string;
  /** Senior interest rate in basis points. */
  senior_interest_rate_bps: number;
  /** Origination timestamp (Unix seconds). */
  origination_date: number;
  /** Original maturity timestamp (Unix seconds). */
  original_maturity_date: number;
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

/** The subset of the API's `SubmitLoanRequest` that `draw_loan` consumes. */
export interface SubmitLoanRequest {
  /** Address the soulbound loan token is minted to. */
  to: string;
  metadata_uri: string;
  economics: EconomicsInput;
  /** Initial collateral-coverage ratio (1e6-scaled; `>= 1_000_000`). */
  initial_ccr: number;
  initial_location: LocationInput;
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
  loanData: SubmitLoanRequest;
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

/**
 * Converts the API's 6-decimal USDC human-unit string (e.g.
 * `"1200000.000000"` = $1,200,000) to the on-chain `u128` base unit
 * `draw_loan`'s economics map expects — 3-decimal scale, i.e. the decimal
 * value × 1000 (`"1200000.000000"` → `1200000000n`).
 *
 * Any precision beyond 3 decimal places is floored (truncated), never
 * rounded up — the API's 6-decimal string can carry cents/sub-cent noise the
 * contract doesn't represent.
 *
 * @throws if `decimalStr` is not a well-formed non-negative decimal string.
 */
export function parseUsdcAmountToU128(decimalStr: string): bigint {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(decimalStr.trim());
  if (!match) {
    throw new Error(
      `parseUsdcAmountToU128: invalid decimal string "${decimalStr}"`,
    );
  }
  const [, intPart, fracPart = ""] = match;
  // Shift the decimal point 3 places right (× 1000), flooring anything past
  // the 3rd fractional digit.
  const fracTruncated = (fracPart + "000").slice(0, 3);
  return BigInt(`${intPart}${fracTruncated}`);
}

/**
 * Encodes the `economics` positional arg (`draw_loan` arg index 2). Map keys
 * sorted lexicographically per `scMap`.
 */
function encodeEconomicsMap(economics: EconomicsInput): xdr.ScVal {
  return scMap([
    [
      "original_equity_tranche",
      u128(parseUsdcAmountToU128(economics.original_equity_tranche)),
    ],
    [
      "original_facility_size",
      u128(parseUsdcAmountToU128(economics.original_facility_size)),
    ],
    ["original_maturity_date", u64(economics.original_maturity_date)],
    [
      "original_offtaker_price",
      u128(parseUsdcAmountToU128(economics.original_offtaker_price)),
    ],
    [
      "original_senior_tranche",
      u128(parseUsdcAmountToU128(economics.original_senior_tranche)),
    ],
    ["origination_date", u64(economics.origination_date)],
    [
      "senior_interest_rate",
      xdr.ScVal.scvU32(economics.senior_interest_rate_bps * 100),
    ],
  ]);
}

/**
 * Encodes the `location` positional arg (`draw_loan` arg index 4). Map keys
 * sorted lexicographically per `scMap`. `location_type` is encoded as the
 * contract's unit-variant enum shape (`{vec:[{symbol:<type>}]}`), NOT a
 * plain string.
 */
function encodeLocationMap(location: LocationInput): xdr.ScVal {
  return scMap([
    ["location_identifier", xdr.ScVal.scvString(location.location_identifier)],
    [
      "location_type",
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(location.location_type)]),
    ],
    ["tracking_url", xdr.ScVal.scvString(location.tracking_url)],
    ["updated_at", u64(location.updated_at)],
  ]);
}

/**
 * Pure function — encodes `loan_data` into `draw_loan`'s 5 positional
 * `xdr.ScVal`s (see the module doc's Encoding section). Exported for direct
 * unit testing of the transform matrix.
 */
export function encodeDrawLoanArgs(loanData: SubmitLoanRequest): xdr.ScVal[] {
  return [
    new Address(loanData.to).toScVal(),
    xdr.ScVal.scvString(loanData.metadata_uri),
    encodeEconomicsMap(loanData.economics),
    xdr.ScVal.scvU32(loanData.initial_ccr),
    encodeLocationMap(loanData.initial_location),
  ];
}

// ── Envelope build + simulate ─────────────────────────────────────────────────

export interface BuildDrawLoanEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanData: SubmitLoanRequest;
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
  loanData,
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

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("draw_loan"),
    xdr.ScVal.scvVec(encodeDrawLoanArgs(loanData)),
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

/**
 * Coerces a `scValToNative` result (bigint | number | anything) to a positive
 * integer loan id, or `null` when it isn't one.
 */
function toLoanId(native: unknown): number | null {
  const n =
    typeof native === "bigint"
      ? Number(native)
      : typeof native === "number"
        ? native
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
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
  loanData,
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
    loanData,
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

/**
 * Soroban client for the trustee's `update_mutable` on-chain call (issue #872) —
 * `LoanRegistry.updateMutable`, through the same executor proxy as `draw_loan`:
 *
 *   executor.execute(target, function: Symbol("update_mutable"), args, caller)
 *
 * Non-economic fields only, no NAV impact. On success the contract emits some of
 * `status_updated { new_status: LoanStatus }`, `ccr_updated { new_ccr: u32 }`,
 * `location_updated { new_location: String }` (the fields that changed).
 *
 * ⚠️ The method name + positional arg order (`loan_id`, `status`, `ccr`,
 * `location`, `metadata_uri`) are inferred from the event/state shape and MUST be
 * confirmed on testnet — see #870's rollover trap for why. The verifying
 * `simulateTransaction` fails loudly on a wrong encoding before any signature.
 *
 * Encodings (verified from the indexer/reader):
 *   - `status` — a `LoanStatus` unit-variant enum: `ScVal::Vec([Symbol(variant)])`
 *     (same as `draw_loan`'s `location_type`). On-chain variants: `Performing`,
 *     `WatchList`, `Default`, `Closed`.
 *   - `ccr` — `ONE = 1_000_000` fixed-point (100% = 1_000_000), i.e. percent ×
 *     10_000 (135% → 1_350_000); the indexer reads it back with `/100` → bps.
 *   - `location` — a plain `String` (the event's `new_location` is a String, not
 *     a map — matches the single Location field in the S10 form).
 *   - `metadataUri` — `String`; pass "" when blank.
 */
export type UpdateMutableStage = DrawLoanStage;

export interface UpdateMutableParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  /** On-chain `LoanStatus` variant: `Performing` | `WatchList` | `Default` | `Closed`. */
  status: string;
  /** New CCR as a percent (e.g. `135` for 135%); scaled to `ONE = 1e6` on encode. */
  ccrPercent: number;
  /** New collateral location — the `LocationUpdate` struct (not a bare string). */
  location: LocationInput;
  /** Optional metadata URI (assay / offtake hash); pass "" when blank. */
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

/**
 * Encodes `update_mutable`'s positional args, per the actual contract signature
 * (confirmed against the deployed Rust source):
 *
 *   update_mutable(e, loan_id: u32, metadata_uri: String, status: LoanStatus,
 *                  new_ccr: u32 [ONE=1e6], new_location: LocationUpdate)
 *
 * `e: &Env` is implicit (not a wire arg), so the 5 encoded positional args are
 * `[loan_id, metadata_uri, status, new_ccr, new_location]` — note `metadata_uri`
 * is SECOND, not last. Exported for unit testing.
 *
 * `new_location` is the same `LocationUpdate` map as `draw_loan`'s
 * `initial_location` — NOT a bare string. A wrong arg ORDER or a mistyped arg
 * makes the contract's guest-side `TryFromVal` panic (`UnreachableCodeReached`);
 * that trap is what an out-of-order encoding produced here.
 */
export function encodeUpdateMutableArgs(
  loanId: number,
  status: string,
  ccrPercent: number,
  location: LocationInput,
  metadataUri: string,
): xdr.ScVal[] {
  return [
    xdr.ScVal.scvU32(loanId),
    xdr.ScVal.scvString(metadataUri),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(status)]),
    xdr.ScVal.scvU32(Math.round(ccrPercent * 10_000)),
    encodeLocationMap(location),
  ];
}

export interface BuildUpdateMutableEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  status: string;
  ccrPercent: number;
  location: LocationInput;
  metadataUri: string;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Builds, simulates, and assembles the `execute(target, "update_mutable", args,
 * caller)` transaction — unsigned XDR ready for `signTransaction`. Mirrors
 * `buildRolloverEnvelope`.
 */
export async function buildUpdateMutableEnvelope({
  executorId,
  targetId,
  caller,
  loanId,
  status,
  ccrPercent,
  location,
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
    xdr.ScVal.scvVec(
      encodeUpdateMutableArgs(
        loanId,
        status,
        ccrPercent,
        location,
        metadataUri,
      ),
    ),
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

/**
 * Signs and submits the trustee-wallet-signed `update_mutable` end-to-end: build
 * envelope (incl. the verifying `simulateTransaction`) → sign → submit → poll to
 * a terminal status. Mirrors `rollover`.
 */
export async function updateMutable({
  executorId,
  targetId,
  caller,
  loanId,
  status,
  ccrPercent,
  location,
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
    ccrPercent,
    location,
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

// ── Record payment (issue #882) ───────────────────────────────────────────────

/**
 * Soroban client for the trustee's `record_payment` on-chain call (issue #882) —
 * `LoanRegistry.recordPayment`, through the same executor proxy as `draw_loan`:
 *
 *   executor.execute(target, function: Symbol("record_payment"), args, caller)
 *
 * Pure accounting: records a repayment split (no USDC moves, no PLUSD mint).
 * Emits `PaymentRecorded`. Confirmed against the deployed Rust source:
 *
 *   record_payment(e, loan_id: u32, repayment: RepaymentData)
 *
 * where `RepaymentData` is a struct (NOT the flat 8-arg EVM form the product-spec
 * docs list) — so the two wire args are `[u32 loan_id, map repayment]`. Amounts
 * are `u128`; the caller passes the `/waterfall` values through unchanged (the
 * backend handles USDC decimals, so the endpoint's amounts already match what
 * `record_payment` expects). The struct is a sorted-key `scMap` (like
 * `draw_loan`'s economics/location maps).
 */
export type RecordPaymentStage = DrawLoanStage;

/**
 * The `RepaymentData` fields, each a whole-base-unit (7-decimal USDC) integer
 * string. `senior_principal_repaid` / `senior_interest` / `mgmt_fee` / `perf_fee`
 * / `oet_alloc` come straight from `/waterfall`; `offtaker_received` is the entered
 * amount; `equity_distributed` is the residual so the six components sum to
 * `offtaker_received`.
 */
export interface RepaymentInput {
  offtaker_received: string;
  senior_principal_repaid: string;
  senior_interest: string;
  equity_distributed: string;
  mgmt_fee: string;
  perf_fee: string;
  oet_alloc: string;
}

export interface RecordPaymentParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  repayment: RepaymentInput;
  rpcUrl: string;
  networkPassphrase: string;
  signTransaction: (
    xdrStr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onStageChange?: (stage: RecordPaymentStage) => void;
}

export interface RecordPaymentResult {
  hash: string;
}

/** Encodes the `RepaymentData` struct as a sorted-key `u128` map. */
function encodeRepaymentData(r: RepaymentInput): xdr.ScVal {
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

/**
 * Encodes `record_payment`'s two positional args: `[loan_id: u32, repayment:
 * RepaymentData]`. Exported for unit testing.
 */
export function encodeRecordPaymentArgs(
  loanId: number,
  repayment: RepaymentInput,
): xdr.ScVal[] {
  return [xdr.ScVal.scvU32(loanId), encodeRepaymentData(repayment)];
}

export interface BuildRecordPaymentEnvelopeParams {
  executorId: string;
  targetId: string;
  caller: string;
  loanId: number;
  repayment: RepaymentInput;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Builds, simulates, and assembles the `execute(target, "record_payment", args,
 * caller)` transaction — unsigned XDR ready for `signTransaction`. Mirrors
 * `buildUpdateMutableEnvelope`.
 */
export async function buildRecordPaymentEnvelope({
  executorId,
  targetId,
  caller,
  loanId,
  repayment,
  rpcUrl,
  networkPassphrase,
}: BuildRecordPaymentEnvelopeParams): Promise<string> {
  if (!executorId) {
    throw new Error("buildRecordPaymentEnvelope: executorId must not be empty");
  }
  if (!targetId) {
    throw new Error("buildRecordPaymentEnvelope: targetId must not be empty");
  }
  if (!caller) {
    throw new Error("buildRecordPaymentEnvelope: caller must not be empty");
  }

  const contract = new Contract(executorId);
  const server = new SorobanRpc.Server(rpcUrl, {
    allowHttp: rpcUrl.startsWith("http://"),
  });

  const sourceAccount = await server.getAccount(caller);

  const op = contract.call(
    "execute",
    new Address(targetId).toScVal(),
    xdr.ScVal.scvSymbol("record_payment"),
    xdr.ScVal.scvVec(encodeRecordPaymentArgs(loanId, repayment)),
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
    throw new Error(`recordPayment simulation error: ${simResult.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

/**
 * Signs and submits the trustee-wallet-signed `record_payment` end-to-end: build
 * envelope (incl. the verifying `simulateTransaction`) → sign → submit → poll to
 * a terminal status. Mirrors `updateMutable`.
 */
export async function recordPayment({
  executorId,
  targetId,
  caller,
  loanId,
  repayment,
  rpcUrl,
  networkPassphrase,
  signTransaction,
  onStageChange,
}: RecordPaymentParams): Promise<RecordPaymentResult> {
  onStageChange?.("awaiting-signature");

  const assembledXdr = await buildRecordPaymentEnvelope({
    executorId,
    targetId,
    caller,
    loanId,
    repayment,
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
      `recordPayment: sendTransaction failed: status=ERROR hash=${sendResult.hash}`,
    );
  }

  onStageChange?.("confirming");

  const finalResult = await server.pollTransaction(sendResult.hash);

  if (finalResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(
      `recordPayment: transaction ${sendResult.hash} failed with status ${finalResult.status}`,
    );
  }

  return { hash: sendResult.hash };
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
