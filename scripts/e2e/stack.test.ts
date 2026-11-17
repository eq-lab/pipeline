// Unit tests of the local stack guard, hook, clean environment and stack lock; see docs/e2e.md "Local stack".

import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { route } from "./fakes";
import { generateEnv, PORTS, type Addresses } from "./lib/env";
import { guard } from "./lib/guard";
import { stackDir } from "./lib/stack";
import { acquireStackLock, down, startService, viteArgs } from "./stack";

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
const generated = generateEnv({
  ports: PORTS,
  addresses,
  accounts: { issuer: G, verifierSecret: "SV", relayerSecret: "SR", depositCustodian: G, withdrawalCustodian: G, capitalWallet: G },
  jwt: { privatePem: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n", publicPem: "-----BEGIN PUBLIC KEY-----\ny\n-----END PUBLIC KEY-----\n" },
});
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
    refuses({ CHAIN_99000002_STELLAR_RPC_URL: "http://localhost:1/rpc" }, /chain 99000002 is not the local Stellar chain/);
  });

  it("refuses a key not from the generated env", () => refuses({ EXTRA_SECRET: "x" }, /EXTRA_SECRET: not from this tag's generated env/));
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
    writeFileSync(script, `import { ensureContracts } from ${JSON.stringify(join(HERE, "stack.ts"))};\nensureContracts(process.argv[2]).then((d) => console.log(d));\n`);
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

describe("fakes", () => {
  it("answers the Sumsub calls the API makes", () => {
    assert.equal(route("POST", "/sumsub/resources/applicants", home).status, 200);
    assert.equal(route("GET", "/sumsub/resources/applicants/-;externalUserId=G1/one", home).status, 200);
    assert.equal(route("POST", "/sumsub/resources/accessTokens/sdk", home).status, 200);
  });
});
