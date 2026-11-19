// Unit tests of the local stack guard, hook, clean environment and stack lock; see docs/e2e.md "Local stack".

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { route } from "./fakes";
import { EVM_CONTRACTS, generateEnv, PORTS, type Addresses, type EvmAddresses } from "./lib/env";
import { guard } from "./lib/guard";
import { findPasscode } from "./passcode";
import { stackDir } from "./lib/stack";
import { stackKey, stackStellarEnv } from "./lib/stellar";
import { acquireStackLock, deployEnv, down, EVM_ROLES, parseArgs, patchChainValues, startService, viteArgs } from "./stack";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const TIMEOUT = 30_000;
const home = mkdtempSync(join(tmpdir(), "e2e-stack-"));
process.env.E2E_HOME = join(home, "e2e-home");
after(() => rmSync(home, { recursive: true, force: true }));

const C = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const addresses = Object.fromEntries(
  ["usdc", "plusd", "access_manager", "deposit_manager", "withdrawal_queue", "staked_pl_usd", "pocket", "loan_registry", "collateral_registry", "deal_token_factory", "minter"].map((k) => [k, C]),
) as unknown as Addresses;
const G = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const stellar = {
  addresses,
  accounts: { issuer: G, verifierSecret: "SV", relayerSecret: "SR", depositCustodian: G, withdrawalCustodian: G, capitalWallet: G, browserLpSecret: "SB" },
  startLedger: 1234,
};
const E = "0x00000000000000000000000000000000000000E2";
const evm = {
  addresses: Object.fromEntries([...EVM_CONTRACTS, "USDC"].map((k) => [k, E])) as EvmAddresses,
  accounts: { relayerKey: `0x${"11".repeat(32)}`, verifierKey: `0x${"22".repeat(32)}`, capitalWallet: E, browserLpKey: `0x${"33".repeat(32)}`, riskCouncilKey: `0x${"44".repeat(32)}` },
  pricePollerStartBlock: 60,
};
const envInput = {
  ports: PORTS,
  jwt: { privatePem: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", publicPem: "-----BEGIN PUBLIC KEY-----\ny\n-----END PUBLIC KEY-----\n" },
  stellar,
  evm,
};
const generated = generateEnv(envInput);
const check = (overrides: Record<string, string>) => guard({ env: { ...generated, ...overrides }, generated, postgresPort: PORTS.postgres });
const refuses = (overrides: Record<string, string>, pattern: RegExp) =>
  assert.ok(check(overrides).some((v) => pattern.test(v)), `expected ${pattern} in ${JSON.stringify(check(overrides))}`);

describe("guard", () => {
  it("accepts the generated env", () => assert.deepEqual(guard({ env: generated, generated, postgresPort: PORTS.postgres }), []));

  it("refuses a stage URL", () => refuses({ SUMSUB_BASE_URL: "https://pipeline.stage.eqlab.net/sumsub" }, /SUMSUB_BASE_URL: points at stage\.eqlab\.net/));

  it("refuses a non-local RPC", () => refuses({ CHAIN_99000001_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org" }, /RPC_URL: soroban-testnet\.stellar\.org is not localhost/));

  it("refuses a non-local or non-e2e DATABASE_URL", () => {
    refuses({ DATABASE_URL: "postgres://u:p@db.example.com:54329/pipeline_e2e" }, /DATABASE_URL: db\.example\.com is not localhost/);
    refuses({ DATABASE_URL: "postgres://u:p@localhost:5432/pipeline" }, /DATABASE_URL: database must be/);
  });

  it("refuses a foreign passphrase", () => {
    refuses({ CHAIN_99000001_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015" }, /not the standalone passphrase/);
    const env = { ...generated };
    delete env.CHAIN_99000001_STELLAR_NETWORK_PASSPHRASE;
    assert.ok(guard({ env, postgresPort: PORTS.postgres }).some((v) => /must be set to the standalone passphrase/.test(v)));
  });

  it("refuses chain id 99000002", () => {
    refuses({ CHAINS: "99000002" }, /CHAINS: chain 99000002/);
    refuses({ CHAIN_99000002_STELLAR_RPC_URL: "http://localhost:1/rpc" }, /chain 99000002 is not a local chain/);
  });

  it("accepts only 31337 for EVM: refuses mainnet (1) and Hoodi (560048)", () => {
    assert.equal(generated.CHAINS, "99000001,31337");
    for (const id of ["1", "560048"]) {
      refuses({ CHAINS: `99000001,${id}` }, new RegExp(`CHAINS: chain ${id} is not a local chain`));
      refuses({ DEFAULT_CHAIN_ID: id }, new RegExp(`DEFAULT_CHAIN_ID: chain ${id} is not a local chain`));
      refuses({ [`CHAIN_${id}_EVM_RPC_URL`]: "http://localhost:1" }, new RegExp(`CHAIN_${id}_EVM_RPC_URL: chain ${id} is not a local chain`));
      refuses({ VITE_EVM_CHAIN_ID: id }, new RegExp(`VITE_EVM_CHAIN_ID: chain ${id} is not the local chain 31337`));
    }
  });

  it("accepts an EVM-only env, which needs no Stellar passphrase", () => {
    const evmOnly = generateEnv({ ...envInput, stellar: undefined });
    assert.equal(evmOnly.CHAINS, "31337");
    assert.deepEqual(guard({ env: evmOnly, generated: evmOnly, postgresPort: PORTS.postgres }), []);
  });

  it("refuses a key not from the generated env", () => refuses({ EXTRA_SECRET: "x" }, /EXTRA_SECRET: not from this tag's generated env/));
});

describe("generated env", () => {
  // getEvents refuses a startLedger below the RPC's oldest ledger, so a 0 cursor would stall the indexer for good.
  it("starts the Stellar indexer at the deploy-time ledger and refuses ledger 0", () => {
    assert.equal(generated.CHAIN_99000001_STELLAR_START_BLOCK, "1234");
    assert.throws(() => generateEnv({ ...envInput, stellar: { ...stellar, startLedger: 0 } }), /startLedger must be a positive ledger/);
  });

  // An unset app RPC falls back to a public node (Hoodi, Stellar testnet), so a one-chain stack still points the other chain's at this machine.
  it("points both chains' app endpoints at localhost whichever chains run", () => {
    for (const env of [generated, generateEnv({ ...envInput, stellar: undefined }), generateEnv({ ...envInput, evm: undefined })]) {
      for (const key of ["VITE_EVM_RPC_URL", "VITE_STELLAR_RPC_URL", "VITE_STELLAR_HORIZON_URL"]) assert.match(env[key] ?? "", /^http:\/\/localhost:\d+/, key);
      assert.equal(env.VITE_STELLAR_NETWORK_PASSPHRASE, "Standalone Network ; February 2017");
      assert.deepEqual(guard({ env, generated: env, postgresPort: PORTS.postgres }), []);
    }
  });
});

describe("pipeline-contracts anvil values", () => {
  const line = (name: string, a = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") => `        values[ANVIL_CHAIN_ID]["${name}"] =\n            bytes32(uint256(uint160(${a})));\n`;
  const source = (names: string[]) =>
    `pragma solidity ^0.8.34;\n\ncontract ChainValues {\n    function _loadHoodiValues() private {\n        values[HOODI_CHAIN_ID]["Treasury"] = bytes32(uint256(uint160(0xFE1748f511583f6c9349f672593E6312BeDfcE40)));\n    }\n    function _loadAnvilValues() private {\n${names.map((n) => line(n)).join("")}        values[ANVIL_CHAIN_ID]["DepositManager__MinDeposit"] = bytes32(uint256(1_000_000_000));\n    }\n}\n`;
  const names = [...Object.keys(EVM_ROLES), "USDC"];

  it("reads every anvil address from E2E_EVM_<name> and leaves other chains alone", () => {
    const out = patchChainValues(source(names));
    assert.ok(!/ANVIL_CHAIN_ID\]\["\w+"\] =\s*bytes32\(uint256\(uint160\(0x/.test(out), out);
    for (const n of names) assert.ok(out.includes(`envAddress("E2E_EVM_${n}")`), n);
    assert.match(out, /0xFE1748f511583f6c9349f672593E6312BeDfcE40/);
    assert.match(out, /^pragma solidity \^0\.8\.34;\n\nimport \{Vm\} from "forge-std\/Vm\.sol";/);
  });

  it("refuses a ref whose anvil values differ, instead of deploying with default-mnemonic holders", () => {
    assert.throws(() => patchChainValues(source(names.slice(1))), /expects/);
    assert.throws(() => patchChainValues(source([...names, "NewRole"])), /NewRole/);
  });
});

describe("guard hook", { timeout: TIMEOUT }, () => {
  const hook = (command: string) =>
    spawnSync(process.execPath, [join(REPO, "node_modules/.bin/tsx"), join(HERE, "guard-hook.ts")], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
      timeout: TIMEOUT,
    });

  it("refuses a scripts/e2e command with a stage URL", () => {
    const r = hook("SUMSUB_BASE_URL=https://pipeline.stage.eqlab.net scripts/e2e/up.sh --tag x");
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /stage\.eqlab\.net/);
    assert.equal(hook("npx tsx scripts/e2e/run.ts --tag x --api https://pipeline.stage.eqlab.net").status, 2);
  });

  it("lets a clean scripts/e2e command and other commands through", () => {
    assert.equal(hook("scripts/e2e/up.sh --tag x").status, 0);
    assert.equal(hook("curl https://pipeline.stage.eqlab.net").status, 0);
  });
});

describe("clean environment", { timeout: TIMEOUT }, () => {
  const SENTINEL_URL = "https://poisoned.stage.eqlab.net";
  const SENTINEL_KEY = "POISONED-SUMSUB-KEY";
  const poison = `SUMSUB_BASE_URL=${SENTINEL_URL}\nSUMSUB_SECRET_KEY=${SENTINEL_KEY}\nVITE_API_BASE_URL=${SENTINEL_URL}\n`;

  const waitExit = async (pid: number) => {
    const deadline = Date.now() + TIMEOUT;
    for (;;) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      if (Date.now() > deadline) throw new Error(`pid ${pid} did not exit`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  it("a poisoned working-tree or ancestor .env reaches neither api/worker nor Vite", async () => {
    const worktree = join(home, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".env"), poison);
    // An ancestor of E2E_HOME (like ~/.env above ~/.cache), with a key the generated env does not shadow.
    const ancestorEnv = join(home, ".env");
    writeFileSync(ancestorEnv, `TURNSTILE_SECRET_KEY=${SENTINEL_KEY}\n`);
    const cwd = process.cwd();
    const saved = { ...process.env };
    process.chdir(worktree);
    Object.assign(process.env, { SUMSUB_BASE_URL: SENTINEL_URL, SUMSUB_SECRET_KEY: SENTINEL_KEY, VITE_API_BASE_URL: SENTINEL_URL });
    try {
      const dotenvy =
        "const fs=require('fs'),p=require('path');let d=process.cwd();for(;;){const f=p.join(d,'.env');" +
        "if(fs.existsSync(f)){for(const l of fs.readFileSync(f,'utf8').split('\\n')){const m=/^(\\w+)=(.*)$/.exec(l);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2];}break;}" +
        "if(p.dirname(d)===d)break;d=p.dirname(d);}console.log('EFFECTIVE '+JSON.stringify(process.env));";
      const svc = startService("poison", "service", process.execPath, ["-e", dotenvy], generated);
      await waitExit(svc.pid);
      const out = readFileSync(svc.log, "utf8");
      const effective = JSON.parse(out.slice(out.indexOf("EFFECTIVE ") + 10)) as Record<string, string>;
      assert.equal(effective.SUMSUB_BASE_URL, generated.SUMSUB_BASE_URL);
      assert.equal(effective.SUMSUB_SECRET_KEY, generated.SUMSUB_SECRET_KEY);
      assert.equal(effective.TURNSTILE_SECRET_KEY, undefined);
      assert.ok(!out.includes(SENTINEL_KEY) && !out.includes(SENTINEL_URL), out);

      const dir = stackDir("poison");
      const vite = Object.fromEntries(Object.entries(generated).filter(([k]) => k.startsWith("VITE_")));
      writeFileSync(join(dir, ".env.e2e-frontend"), Object.entries(vite).map(([k, v]) => `${k}=${v}`).join("\n"));
      const [, , configFile, , , , , mode] = viteArgs("poison", "frontend", PORTS.lp);
      const probe =
        `import('vite').then(v=>v.resolveConfig({configFile:${JSON.stringify(configFile)},mode:${JSON.stringify(mode)}},'serve'))` +
        ".then(c=>console.log('VITE '+JSON.stringify({envDir:c.envDir,env:c.env})))";
      const app = startService("poison", "vite", process.execPath, ["-e", probe], { ...vite, E2E_VITE_APP: "frontend", E2E_VITE_ENV_DIR: dir }, join(REPO, "packages/frontend"));
      await waitExit(app.pid);
      const vout = readFileSync(app.log, "utf8");
      assert.ok(vout.includes("VITE "), vout);
      const resolved = JSON.parse(vout.slice(vout.indexOf("VITE ") + 5)) as { envDir: string; env: Record<string, string> };
      assert.equal(resolved.envDir, dir);
      assert.equal(resolved.env.VITE_API_BASE_URL, generated.VITE_API_BASE_URL);
      assert.ok(!vout.includes(SENTINEL_URL), vout);
    } finally {
      rmSync(ancestorEnv, { force: true });
      process.chdir(cwd);
      process.env = saved;
    }
  });
});

const gone = async (pid: number) => {
  const deadline = Date.now() + TIMEOUT;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`pid ${pid} is still alive`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

describe("--chains", () => {
  const chains = (...args: string[]) => parseArgs(["up", "--tag", "t", ...args]).chains;

  it("defaults to both chains and selects one or both in a fixed order", () => {
    assert.deepEqual(chains(), ["stellar", "evm"]);
    assert.deepEqual(chains("--chains", "stellar"), ["stellar"]);
    assert.deepEqual(chains("--chains", "evm", "--reclaim"), ["evm"]);
    assert.deepEqual(chains("--chains", "evm,stellar"), ["stellar", "evm"]);
  });

  it("refuses an unknown or missing chain instead of starting a different stack", () => {
    assert.throws(() => chains("--chains", "hoodi"), /--chains takes stellar,evm; got "hoodi"/);
    assert.throws(() => chains("--chains"), /--chains takes stellar,evm; got ""/);
    assert.throws(() => chains("--chains", "--reclaim"), /got "--reclaim"/);
  });
});

describe("stack lock", { timeout: TIMEOUT }, () => {
  it("refuses another tag, names it, and --reclaim takes over", () => {
    acquireStackLock("x", false);
    assert.throws(() => acquireStackLock("y", false), /stack "x" holds .*down\.sh --tag x/);
    acquireStackLock("y", true);
    assert.equal(readFileSync(join(process.env.E2E_HOME!, "stack.lock"), "utf8"), "y");
  });

  it("--reclaim kills the processes of the stack it tears down", async () => {
    acquireStackLock("r1", true);
    const svc = startService("r1", "sleeper", process.execPath, ["-e", "setInterval(() => {}, 1000)"], {});
    acquireStackLock("r2", true);
    await gone(svc.pid);
    assert.ok(!existsSync(stackDir("r1")));
    assert.equal(readFileSync(join(process.env.E2E_HOME!, "stack.lock"), "utf8"), "r2");
  });
});

describe("down", { timeout: TIMEOUT }, () => {
  it("kills the tag's processes, removes its state and lock, and is idempotent from another directory", async () => {
    acquireStackLock("d", true);
    const svc = startService("d", "sleeper", process.execPath, ["-e", "setInterval(() => {}, 1000)"], {});
    process.kill(svc.pid, 0);
    down("d");
    await gone(svc.pid);
    assert.ok(!existsSync(stackDir("d")));
    assert.ok(!existsSync(join(process.env.E2E_HOME!, "stack.lock")));
    const again = spawnSync(join(HERE, "down.sh"), ["--tag", "d"], { cwd: home, env: process.env, encoding: "utf8", timeout: TIMEOUT });
    assert.equal(again.status, 0, again.stderr);
  });

  it("leaves the lock of another tag alone", () => {
    acquireStackLock("keep", true);
    down("other");
    assert.equal(readFileSync(join(process.env.E2E_HOME!, "stack.lock"), "utf8"), "keep");
    down("keep");
  });
});

describe("contracts cache", { timeout: TIMEOUT }, () => {
  const fixture = () => {
    const root = mkdtempSync(join(home, "contracts-"));
    const repo = join(root, "repo");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.email=e2e@localhost", "-c", "user.name=e2e", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, encoding: "utf8" }).trim();
    mkdirSync(join(repo, "deployments"), { recursive: true });
    writeFileSync(join(repo, "deployments", "justfile"), "");
    git("init", "--quiet");
    git("add", ".");
    git("commit", "--quiet", "-m", "init");
    const ref = git("rev-parse", "--short", "HEAD");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const counter = join(root, "builds");
    writeFileSync(join(bin, "stellar"), `#!/bin/sh\necho "$*" >> "${counter}"\nsleep 1\nmkdir -p target\n`, { mode: 0o755 });
    const script = join(root, "ensure.ts");
    writeFileSync(script, `import { ensureContracts, STELLAR_CONTRACTS } from ${JSON.stringify(join(HERE, "stack.ts"))};\nensureContracts({ ...STELLAR_CONTRACTS, ref: process.argv[2] }).then((d) => console.log(d));\n`);
    const e2eHome = join(root, "home");
    const env = { ...process.env, E2E_HOME: e2eHome, E2E_STELLAR_CONTRACTS_REPO: repo, PATH: `${bin}:${process.env.PATH}` };
    const one = () =>
      new Promise<{ code: number | null; out: string; err: string }>((ok) => {
        const c = spawn(process.execPath, [join(REPO, "node_modules/.bin/tsx"), script, ref], { env, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (err += d));
        c.on("close", (code) => ok({ code, out, err }));
      });
    const dir = join(e2eHome, "contracts", `pipeline-stellar-contracts@${ref}`);
    return { one, dir, counter, e2eHome };
  };

  it("two concurrent invocations clone and build a ref once", async () => {
    const { one, dir, counter, e2eHome } = fixture();
    const results = await Promise.all([one(), one()]);
    for (const r of results) {
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.trim(), dir);
    }
    assert.equal(readFileSync(counter, "utf8").trim().split("\n").length, 1);
    assert.ok(existsSync(join(dir, "target")) && existsSync(join(dir, "deployments", "justfile")));
    assert.deepEqual(readdirSync(join(e2eHome, "contracts")).filter((f) => f.startsWith(".tmp-") || f.endsWith(".lock")), []);
  });

  it("breaks a lock left by a killed build (dead pid, or no pid and old) instead of waiting forever", async () => {
    const dead = spawnSync(process.execPath, ["-e", "0"], { timeout: TIMEOUT }).pid;
    for (const seed of ["dead-pid", "legacy"] as const) {
      const { one, dir, counter } = fixture();
      const lock = `${dir}.lock`;
      mkdirSync(lock, { recursive: true });
      if (seed === "dead-pid") writeFileSync(join(lock, "pid"), String(dead));
      else utimesSync(lock, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
      const r = await one();
      assert.equal(r.code, 0, r.err);
      assert.equal(r.out.trim(), dir);
      assert.equal(readFileSync(counter, "utf8").trim().split("\n").length, 1);
      assert.ok(!existsSync(lock), `${seed}: lock left behind`);
    }
  });

  it("waits for a lock whose holder is alive", async () => {
    const { one, dir } = fixture();
    const lock = `${dir}.lock`;
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), String(process.pid));
    const pending = one();
    await new Promise((r) => setTimeout(r, 3000));
    assert.ok(!existsSync(dir), "built while another invocation held the lock");
    rmSync(lock, { recursive: true, force: true });
    const r = await pending;
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(dir));
  });
});

describe("passcode", { timeout: TIMEOUT }, () => {
  const line = (email: string, code: string) => `\x1b[2m INFO\x1b[0m email to=${email} body=Your verification code is ${code}\n`;
  const notice = (email: string) => `\x1b[2m INFO\x1b[0m email to=${email} body=An account already exists for this address\n`;
  const log = line("a@x.io", "111111") + line("b@x.io", "222222") + line("a@x.io", "333333");

  it("finds the latest code of the email, none for an unknown one", () => {
    assert.equal(findPasscode(log, "b@x.io"), "222222");
    assert.equal(findPasscode(log, "a@x.io"), "333333");
    assert.equal(findPasscode(log, "c@x.io"), undefined);
  });

  it("never returns another address's code", () => {
    assert.equal(findPasscode(log + notice("a@x.io") + line("b@x.io", "444444"), "a@x.io"), "333333");
    assert.equal(findPasscode(notice("c@x.io") + line("b@x.io", "444444"), "c@x.io"), undefined);
    assert.equal(findPasscode(line("aa@x.io", "555555"), "a@x.io"), undefined);
    assert.equal(findPasscode(line("a@x.io.uk", "555555"), "a@x.io"), undefined);
  });

  it("prints only the code, and exits 1 without one", () => {
    mkdirSync(join(stackDir("pc"), "logs"), { recursive: true });
    writeFileSync(join(stackDir("pc"), "logs", "api.log"), log);
    const run = (email: string) =>
      spawnSync("npx", ["tsx", join(HERE, "passcode.ts"), "--tag", "pc", "--email", email, "--wait", "0"], { encoding: "utf8", timeout: TIMEOUT, env: process.env });
    assert.equal(run("a@x.io").stdout, "333333\n");
    assert.equal(run("c@x.io").status, 1);
  });
});

describe("fakes", () => {
  it("answers the Sumsub calls the API makes", () => {
    assert.equal(route("POST", "/sumsub/resources/applicants", home).status, 200);
    assert.equal(route("GET", "/sumsub/resources/applicants/-;externalUserId=G1/one", home).status, 200);
    assert.equal(route("POST", "/sumsub/resources/accessTokens/sdk", home).status, 200);
  });
});

// #1981: with the real CLI, a stack's keys stay out of the developer's ~/.config/stellar, where `keys generate --overwrite` would replace same-named identities.
const hasStellar = spawnSync("stellar", ["--version"]).status === 0;
describe("stack stellar keys", { timeout: TIMEOUT, skip: hasStellar ? false : "stellar CLI not on PATH" }, () => {
  it("generates and reads keys under stacks/<tag>/stellar, never under the developer config", () => {
    const fakeHome = mkdtempSync(join(home, "stellar-home-"));
    const devConfig = join(fakeHome, ".config");
    // A developer may export either variable; STELLAR_CONFIG_HOME wins over XDG_CONFIG_HOME in stellar 30.
    const devStellar = join(fakeHome, "stellar-config");
    const env = stackStellarEnv("keys", { ...process.env, HOME: fakeHome, XDG_CONFIG_HOME: devConfig, STELLAR_CONFIG_HOME: devStellar });
    const cli = (...args: string[]) => execFileSync("stellar", args, { env, encoding: "utf8" }).trim();
    cli("keys", "generate", "e2e-isolation-1981", "--overwrite");
    assert.ok(existsSync(join(stackDir("keys"), "stellar", "identity", "e2e-isolation-1981.toml")));
    assert.ok(!existsSync(join(devConfig, "stellar")), "the key went to the developer config");
    assert.ok(!existsSync(devStellar), "the key went to the developer's STELLAR_CONFIG_HOME");
    assert.equal(stackKey("keys", "e2e-isolation-1981").publicKey(), cli("keys", "address", "e2e-isolation-1981"));
  });
});

// #1984: a caller's USDC / RPC_URL / STELLAR_* must not reach the contracts deploy.
describe("deployEnv", () => {
  it("drops the caller's variables", () => {
    const keys = ["USDC", "RPC_URL", "STELLAR_RPC_URL"];
    const saved = keys.map((k) => process.env[k]);
    for (const k of keys) process.env[k] = "x";
    try {
      const env = deployEnv("deploy-env");
      assert.deepEqual(keys.filter((k) => k in env), []);
      assert.equal(env.NETWORK, "e2e");
    } finally {
      keys.forEach((k, i) => (saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i])));
    }
  });
});
