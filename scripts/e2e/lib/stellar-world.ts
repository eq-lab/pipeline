// Shared world of the Stellar journeys: funded accounts and USDC, an onboarded LP, operators and KYC; see docs/e2e.md "Stellar world".

import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { postSumsubWebhook } from "../fakes";
import { PORTS, SPACES } from "./env";
import { STELLAR_CHAIN_ID } from "./guard";
import type { Recorded } from "./journey";
import { passcodeFor } from "../passcode";
import { readJson, stackDir } from "./stack";
import { addr, Asset, classic, friendbot, Keypair, pay, read, stackKey, trust } from "./stellar";

export const API = `http://localhost:${PORTS.api}`;
export const CHAIN = `chain_id=${STELLAR_CHAIN_ID}`;
export const ONE = 10_000_000n;
const LP_USDC = 1_000n * ONE;

export interface World {
  tag: string;
  env: Record<string, string>;
  lp: Keypair;
  lpToken: string;
  trusteeToken: string;
  originatorToken: string;
  deployer: Keypair;
  capital: Keypair;
  usdc: Asset;
  plusd: Asset;
}

export interface Reply {
  status: number;
  body: any;
}

export async function http(method: string, path: string, opts: { body?: unknown; token?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const r = await fetch(`${API}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await r.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, body };
}

export function ok(r: Reply, what: string): any {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await probe();
      if (v !== undefined) return v;
    } catch (e) {
      last = e;
    }
    await sleep(1000);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}${last ? ` (last error: ${last instanceof Error ? last.message : last})` : ""}`);
}

/** SEP-53: ed25519 over SHA-256("Stellar Signed Message:\n" + message), base64; what the wallets' signMessage returns. */
export const signMessage = (kp: Keypair, message: string) =>
  kp.sign(createHash("sha256").update(`Stellar Signed Message:\n${message}`, "utf8").digest()).toString("base64");

function container(tag: string, service: string): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=pipeline-e2e.tag=${tag}`, "--filter", `label=com.docker.compose.service=${service}`], { encoding: "utf8" }).trim();
  if (!id) throw new Error(`no ${service} container for stack ${tag}`);
  return id;
}

export function psql(tag: string, sql: string): string {
  return execFileSync("docker", ["exec", "-i", container(tag, "postgres"), "psql", "-U", "pipeline", "-d", "pipeline_e2e", "-tAq", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim();
}

/** Stores `body` in the stack's bucket under `key` with mc (alias `l`, set by up.sh). */
export function minioPut(tag: string, key: string, body: string | Buffer): void {
  execFileSync("docker", ["exec", "-i", container(tag, "minio"), "mc", "pipe", "-q", `l/${SPACES.bucket}/${key}`], { input: body });
}

/** The wallet an LP links as its settlement address, with its personal-message signer. */
export interface LinkWallet {
  chainId: string;
  address: string;
  sign(message: string): string | Promise<string>;
}

/** A fresh LP by email + OTP with `wallet` linked by challenge; recorded under `key`. */
export async function signupLp(tag: string, wallet: LinkWallet, recorded: Recorded, key = "world.lp"): Promise<string> {
  const email = `lp-${Date.now()}@example.com`;
  const password = `E2e-${randomBytes(8).toString("hex")}!1`;
  ok(await http("POST", "/v1/auth/signup", { body: { email, password, captcha_token: "e2e" } }), "signup");
  const code = await until("the signup passcode in logs/api.log", async () => passcodeFor(tag, email), 30_000);
  const { token } = ok(await http("POST", "/v1/auth/verify-otp", { body: { email, code } }), "verify-otp");
  ok(await http("POST", "/v1/lps/me", { token, body: { legal_name: "E2E Lender", contact_email: email, country: "CH" } }), "create LP");
  const q = `chain_id=${wallet.chainId}&address=${wallet.address}`;
  const { message } = ok(await http("GET", `/v1/lps/me/link-address/challenge?${q}`, { token }), "link-address challenge");
  const linked = ok(
    await http("POST", "/v1/lps/me/link-address/verify", {
      token,
      body: { chain_id: Number(wallet.chainId), address: wallet.address, signature: await wallet.sign(message) },
    }),
    "link-address verify",
  );
  const linkedAddress = wallet.chainId === STELLAR_CHAIN_ID ? linked.stellar_address : linked.evm_address;
  recorded[key] = { address: wallet.address, emailVerified: true, linkedAddress: linkedAddress ?? null };
  return token;
}

async function signIn(kp: Keypair): Promise<string> {
  const { message } = ok(await http("GET", `/v1/auth/challenge?${CHAIN}&address=${kp.publicKey()}`), "operator challenge");
  const body = { chain_id: Number(STELLAR_CHAIN_ID), address: kp.publicKey(), signature: signMessage(kp, message) };
  return ok(await http("POST", "/v1/auth/verify", { body }), "operator verify").token;
}

async function operators(tag: string, trustee: Keypair, originator: Keypair, recorded: Recorded): Promise<[string, string]> {
  // shortcut: there is no `team` role in the API (only trustee and originator), so the team member is an operator row without roles; give it one when the API grows it.
  const rows: [string, string][] = [
    [trustee.publicKey(), "{trustee}"],
    [originator.publicKey(), "{originator}"],
    [Keypair.random().publicKey(), "{}"],
  ];
  for (const [address, roles] of rows)
    psql(
      tag,
      `WITH a AS (INSERT INTO accounts (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM auth_users WHERE chain_id=${STELLAR_CHAIN_ID} AND address='${address}') RETURNING id)
       INSERT INTO auth_users (chain_id, address, roles, account_id) SELECT ${STELLAR_CHAIN_ID}, '${address}', '${roles}', id FROM a;`,
    );
  const tokens: [string, string] = [await signIn(trustee), await signIn(originator)];
  recorded["world.operators"] = { rows: rows.length, trusteeLogin: true };
  return tokens;
}

export async function setupWorld(tag: string, recorded: Recorded): Promise<World> {
  const env = readJson<Record<string, string>>(join(stackDir(tag), "env.json"));
  if (!env) throw new Error(`no env.json in ${stackDir(tag)}`);
  const deployer = stackKey(tag, "deployer");
  const capital = stackKey(tag, "capital");
  const usdcIssuer = stackKey(tag, "usdc-issuer");
  const usdc = new Asset("USDC", usdcIssuer.publicKey());
  const plusd = new Asset("PLUSD", env.VITE_STELLAR_PLUSD_ISSUER_ID);
  // The deposit custodian (deployer) receives USDC as a classic holder; an existing trustline is left as it is.
  await classic(deployer, [trust(usdc)]);

  const lp = Keypair.random();
  await friendbot(lp.publicKey());
  await classic(lp, [trust(usdc), trust(plusd)]);
  await classic(usdcIssuer, [pay(lp.publicKey(), usdc, LP_USDC)]);
  recorded["world.accounts"] = { lp: lp.publicKey(), usdc: LP_USDC.toString() };

  const lpToken = await signupLp(tag, { chainId: STELLAR_CHAIN_ID, address: lp.publicKey(), sign: (m) => signMessage(lp, m) }, recorded);
  const [trusteeToken, originatorToken] = await operators(tag, stackKey(tag, "trustee"), Keypair.random(), recorded);
  return { tag, env, lp, lpToken, trusteeToken, originatorToken, deployer, capital, usdc, plusd };
}

let shared: Promise<World> | undefined;
/** One world per run: the journeys of a run share its LP, operators and recorded `world.*`. */
export const world = (tag: string, recorded: Recorded): Promise<World> => (shared ??= setupWorld(tag, recorded));

/** Sumsub through the stub and a signed GREEN webhook for `wallet`; returns the API's KYC status. */
export async function sumsubGreen(env: Record<string, string>, chainId: string, wallet: string): Promise<Record<string, unknown>> {
  // The API creates the applicant only once the relayer has a profile for the wallet, i.e. after its first DepositRequested.
  const { applicant_id } = await until("the LP's KYC profile", async () => {
    const r = await http("POST", `/v1/kyc/applicants?chain_id=${chainId}`, { body: { wallet_address: wallet } });
    return r.status === 403 ? undefined : ok(r, "kyc applicant");
  });
  const hook = await postSumsubWebhook(API, env.SUMSUB_WEBHOOK_SECRET_KEY, {
    applicantId: applicant_id,
    type: "applicantReviewed",
    externalUserId: wallet,
    sandboxMode: true,
    reviewStatus: "completed",
    reviewResult: { reviewAnswer: "GREEN" },
  });
  if (!hook.ok) throw new Error(`sumsub webhook: HTTP ${hook.status} ${await hook.text()}`);
  return ok(await http("GET", `/v1/kyc/status/${wallet}?chain_id=${chainId}`), "kyc status");
}

/** KYC through `sumsubGreen`, then waits until the relayer has whitelisted the LP on PLUSD. */
export async function passKyc(w: World, recorded: Recorded): Promise<void> {
  const wallet = w.lp.publicKey();
  const status = await sumsubGreen(w.env, STELLAR_CHAIN_ID, wallet);
  await until("the relayer to whitelist the LP on PLUSD", async () =>
    (await read<boolean>(wallet, w.env.CHAIN_99000001_RELAYER_STELLAR_PLUSD_SAC_ID, "authorized", [addr(wallet)])) || undefined,
  );
  recorded["world.kyc"] = { ...status, whitelisted: true };
}
