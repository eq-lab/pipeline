// Unit tests of the e2e runner, result contract and redaction; see docs/e2e.md.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { buildResult, check, exitCode, parseChecksFile, type BuildInput } from "./check";
import { riskChecks } from "./journeys/risk-checks";
import type { Journey } from "./lib/journey";
import { redact } from "./lib/redact";
import { stackDir } from "./lib/stack";
import { run, type RunRecord } from "./run";

const SEED = "SBZVMB74Z76QZ3ZOY7UTDFYKMEGKW5XFJEB6PFKBF4UYSSWHG4EDH7PY";
const EVM_KEY = "0x" + "ab".repeat(32);
const OTP = "482913";

function fakeJourney(apiMinted: number, details = ""): Journey {
  return {
    chain: "stellar",
    name: "fake",
    steps: [
      { name: "deposit", run: ({ recorded }) => void (recorded["chain.minted"] = 100) },
      { name: "read api", run: ({ recorded }) => void (recorded["api.minted"] = apiMinted) },
    ],
    checks: [
      {
        id: "stellar.fake.reconcile",
        title: "API minted equals chain minted",
        evaluate: (r) =>
          r["api.minted"] === r["chain.minted"]
            ? { ok: true }
            : { ok: false, details: `api ${r["api.minted"]} ≠ chain ${r["chain.minted"]}${details}` },
      },
      { id: "stellar.fake.always", title: "Always passes", evaluate: () => ({ ok: true }) },
    ],
  };
}

const runRecord = (recorded: Record<string, unknown>, error?: string): RunRecord => ({
  commit: "abc123",
  startedAt: "2026-11-17T10:00:00.000Z",
  finishedAt: "2026-11-17T10:05:00.000Z",
  durations: { run: 300 },
  journeys: ["stellar-fake"],
  recorded,
  ...(error ? { error } : {}),
});

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  tag: "2026-11-17-a",
  state: { tag: "2026-11-17-a", contracts: { stellar: "7646cef", evm: "3b74e98" }, durations: { up: 120 } },
  run: runRecord({ "chain.minted": 100, "api.minted": 100 }),
  journeys: [fakeJourney(100)],
  optional: {},
  artifacts: ["logs/api.log"],
  checkSeconds: 1,
  finishedAt: "2026-11-17T10:06:00.000Z",
  ...over,
});

const corrupted = runRecord({ "chain.minted": 100, "api.minted": 99 });

describe("result builder", () => {
  it("matches the contract", () => {
    assert.deepEqual(buildResult(input()), {
      schemaVersion: 1,
      tag: "2026-11-17-a",
      commit: "abc123",
      contracts: { stellar: "7646cef", evm: "3b74e98" },
      startedAt: "2026-11-17T10:00:00.000Z",
      finishedAt: "2026-11-17T10:06:00.000Z",
      durations: { up: 120, run: 300, check: 1 },
      ok: true,
      checks: [
        { id: "stellar.fake.reconcile", ok: true, optional: false, title: "API minted equals chain minted" },
        { id: "stellar.fake.always", ok: true, optional: false, title: "Always passes" },
      ],
      canBeRequired: [],
      artifacts: ["logs/api.log"],
    });
  });

  it("reports missing state.json fields as null", () => {
    for (const state of [undefined, {}]) {
      const r = buildResult(input({ state }));
      assert.deepEqual(r.contracts, { stellar: null, evm: null });
      assert.equal(r.durations.up, null);
    }
  });

  it("turns a corrupted reconciled figure into ❌ with details", () => {
    const r = buildResult(input({ run: corrupted }));
    assert.deepEqual(r.checks[0], {
      id: "stellar.fake.reconcile",
      ok: false,
      optional: false,
      title: "API minted equals chain minted",
      details: "api 99 ≠ chain 100",
    });
    assert.equal(exitCode(r), 1);
  });
});

describe("optional and required checks", () => {
  const optional = { "stellar.fake.reconcile": { issue: 765 }, "stellar.fake.always": { issue: 766 } };

  it("an optional failure keeps ok and exit 0; an optional pass can be required", () => {
    const r = buildResult(input({ run: corrupted, optional }));
    assert.equal(r.ok, true);
    assert.equal(exitCode(r), 0);
    assert.equal(r.checks[0].issue, 765);
    assert.deepEqual(r.canBeRequired, ["stellar.fake.always"]);
  });

  it("--require overrides the file", () => {
    const r = buildResult(input({ run: corrupted, optional, overrides: { require: ["stellar.fake.reconcile"] } }));
    assert.equal(r.checks[0].optional, false);
    assert.equal(exitCode(r), 1);
  });

  it("--optional overrides the file", () => {
    const r = buildResult(input({ run: corrupted, overrides: { optional: ["stellar.fake.reconcile"] } }));
    assert.equal(r.checks[0].optional, true);
    assert.equal(exitCode(r), 0);
  });

  it("accepts a pending entry with its finding and rejects malformed ones", () => {
    const pending = parseChecksFile({ "stellar.fake.reconcile": { issue: "pending", finding: "API under-reports minted" } });
    const r = buildResult(input({ run: corrupted, optional: pending }));
    assert.equal(r.checks[0].issue, "pending");
    assert.equal(r.checks[0].finding, "API under-reports minted");
    assert.equal(r.ok, true);
    assert.throws(() => parseChecksFile({ "stellar.fake.reconcile": { issue: "pending" } }));
    assert.throws(() => parseChecksFile({ "stellar.fake.reconcile": { issue: "765" } }));
    assert.throws(() => parseChecksFile({ "Stellar fake": { issue: 765 } }));
  });

  it("a failed run exits 2", () => {
    assert.equal(exitCode(buildResult(input({ run: runRecord({}, "stack down") }))), 2);
    assert.equal(exitCode(buildResult(input({ run: undefined }))), 2);
  });

  it("a run that checked nothing is an error, not a green run", () => {
    for (const r of [
      buildResult(input({ run: { ...runRecord({}), journeys: [] } })),
      buildResult(input({ journeys: [{ ...fakeJourney(100), checks: [] }] })),
    ]) {
      assert.deepEqual(r.checks, []);
      assert.equal(r.ok, false);
      assert.equal(r.error, "no checks ran");
      assert.equal(exitCode(r), 2);
    }
  });
});

// run() spawns git for the commit sha.
describe("run.ts and check.ts on disk", { timeout: 30_000 }, () => {
  const home = mkdtempSync(join(tmpdir(), "e2e-test-"));
  const checksPath = join(home, "checks.json");
  const tag = "t1";
  const dir = () => stackDir(tag);
  const readResult = () => readFileSync(join(dir(), "result.json"), "utf8");
  process.env.E2E_HOME = home;
  after(() => rmSync(home, { recursive: true, force: true }));

  beforeEach(() => {
    rmSync(join(home, "stacks"), { recursive: true, force: true });
    mkdirSync(join(dir(), "logs"), { recursive: true });
    writeFileSync(join(dir(), "state.json"), JSON.stringify({ tag, contracts: { stellar: "7646cef" } }));
    writeFileSync(checksPath, "{}");
  });

  it("exit 0 when every required check passes", async () => {
    assert.equal(await run(["--tag", tag], [fakeJourney(100)]), 0);
    assert.equal(check(["--tag", tag], [fakeJourney(100)], checksPath), 0);
    const r = JSON.parse(readResult());
    assert.equal(r.ok, true);
    assert.equal(r.contracts.evm, null);
    assert.equal(r.durations.up, null);
  });

  it("exit 1 when a required check fails", async () => {
    assert.equal(await run(["--tag", tag], [fakeJourney(99)]), 0);
    assert.equal(check(["--tag", tag], [fakeJourney(99)], checksPath), 1);
    assert.equal(check(["--tag", tag, "--optional", "stellar.fake.reconcile"], [fakeJourney(99)], checksPath), 0);
  });

  it("exit 2 when the stack is missing, a step throws or an argument is bad", async () => {
    rmSync(join(dir(), "state.json"));
    assert.equal(await run(["--tag", tag], [fakeJourney(100)]), 2);
    assert.equal(check(["--tag", tag], [fakeJourney(100)], checksPath), 2);
    const broken: Journey = { ...fakeJourney(100), steps: [{ name: "boom", run: () => { throw new Error(`key ${SEED}`); } }] };
    writeFileSync(join(dir(), "state.json"), "{}");
    assert.equal(await run(["--tag", tag], [broken]), 2);
    assert.equal(check(["--tag", tag], [broken], checksPath), 2);
    assert.ok(!readResult().includes(SEED));
    assert.equal(await run(["--tag", "../escape"], [fakeJourney(100)]), 2);
    assert.equal(check(["--tag", "../escape"], [fakeJourney(100)], checksPath), 2);
    assert.equal(await run(["--tag", tag, "--chains", "solana"], [fakeJourney(100)]), 2);
    assert.equal(await run(["--tag", tag, "--chains", "evm"], [fakeJourney(100)]), 2);
    assert.equal(await run(["--tag", tag], []), 2);
    assert.equal(check(["--tag", tag, "--require", "stellar.nope.x"], [fakeJourney(100)], checksPath), 2);
    writeFileSync(checksPath, JSON.stringify({ "stellar.fake.reconcile": { issue: "pending" } }));
    assert.equal(check(["--tag", tag], [fakeJourney(100)], checksPath), 2);
  });

  it("a failing check.ts replaces a stale result.json with ok:false", async () => {
    assert.equal(await run(["--tag", tag], [fakeJourney(100)]), 0);
    assert.equal(check(["--tag", tag], [fakeJourney(100)], checksPath), 0);
    assert.equal(check(["--tag", tag, "--require", "stellar.nope.x"], [fakeJourney(100)], checksPath), 2);
    const r = JSON.parse(readResult());
    assert.deepEqual([r.ok, r.tag, r.schemaVersion], [false, tag, 1]);
    assert.match(r.error, /unknown check id/);
  });

  it("no secret reaches the result or a redacted log", async () => {
    const leaky = fakeJourney(99, ` signer ${SEED} privateKey=${EVM_KEY}`);
    writeFileSync(
      join(dir(), "logs", "api.log"),
      [
        `INFO email body="Your Pipeline verification code is ${OTP}.\n\nIt expires in 1 minute."`,
        `DEBUG deployer secret=${SEED} "privateKey":"${EVM_KEY}" otp: ${OTP}`,
        `INFO tx 0x${"cd".repeat(32)} confirmed`,
      ].join("\n"),
    );
    assert.equal(await run(["--tag", tag], [leaky]), 0);
    assert.equal(check(["--tag", tag, "--json"], [leaky], checksPath), 1);
    const result = readResult();
    const log = readFileSync(join(dir(), "logs", "api.log"), "utf8");
    for (const text of [result, log]) {
      for (const secret of [SEED, EVM_KEY, OTP]) assert.ok(!text.includes(secret), `${secret} leaked`);
    }
    assert.match(log, /verification code is \*\*\*/);
    assert.match(log, new RegExp(`0x${"cd".repeat(32)}`));
    assert.deepEqual(JSON.parse(result).artifacts, ["logs/api.log"]);
  });

  it("redacts secret values from the environment", () => {
    assert.equal(redact("token abcdefgh in url", ["abcdefgh"]), "token *** in url");
  });

  it("redacts every word of a mnemonic", () => {
    const words = "abandon ability able about above absent absorb abstract absurd abuse access accident";
    for (const line of [`Mnemonic: ${words}`, `{"mnemonic": "${words}"}`, `MNEMONIC=${words}`]) {
      const out = redact(line, []);
      for (const w of words.split(" ")) assert.ok(!out.includes(w), `${w} leaked from ${out}`);
    }
  });
});

describe("risk council refusal check", () => {
  const refused = riskChecks("stellar").find((c) => c.id === "stellar.risk.default-refused")!;
  const recorded = (statusAfter: string, ...errors: (string | null)[]) => ({
    "risk.defaultRefused": { attempts: errors.map((error, i) => ({ who: `key${i}`, error })), statusAfter },
  });

  it("passes when every key without the role is rejected and the loan keeps its status", () => {
    assert.equal(refused.evaluate(recorded("Performing", "Error(Contract, #1)", "Error(Contract, #1)")).ok, true);
  });

  it("fails when a call failed for another reason than the AccessManager's refusal", () => {
    assert.equal(refused.evaluate(recorded("Performing", "Error(Contract, #1)", "invalid argument encoding")).ok, false);
    const evm = riskChecks("evm").find((c) => c.id === "evm.risk.default-refused")!;
    const attempts = (...errors: string[]) => ({ "evm.risk.defaultRefused": { attempts: errors.map((error) => ({ who: "k", error })), statusAfter: "Performing" } });
    assert.equal(evm.evaluate(attempts("AccessManagedUnauthorized", "AccessManagedUnauthorized")).ok, true);
    assert.equal(evm.evaluate(attempts("AccessManagedUnauthorized", "InsufficientFunds")).ok, false);
  });

  it("fails when the role went to the wrong key: a refused key's call went through and the loan defaulted", () => {
    assert.equal(refused.evaluate(recorded("Default", "Error(Contract, #1)", null)).ok, false);
    assert.equal(refused.evaluate(recorded("Performing", "Error(Contract, #1)", null)).ok, false);
  });
});
