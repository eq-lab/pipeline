// Local stand-ins for Sumsub, MetalpriceAPI and the IPFS gateway, plus the signed Sumsub webhook helper; see docs/e2e.md "Fakes".

import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body), type: "application/json" });

export function route(method: string, path: string, ipfsDir: string) {
  const sumsubOne = /^\/sumsub\/resources\/applicants\/-;externalUserId=([^/]+)\/one$/.exec(path);
  if (path === "/health") return json({ ok: true });
  if (method === "POST" && path === "/sumsub/resources/applicants") return json({ id: randomUUID(), createdAt: new Date().toISOString() });
  if (method === "GET" && sumsubOne) return json({ id: `applicant-${sumsubOne[1]}`, info: { firstName: "E2E", lastName: "Tester" } });
  if (method === "POST" && path === "/sumsub/resources/accessTokens/sdk") return json({ token: `e2e-token-${randomUUID()}` });
  if (path.startsWith("/metalprice/")) return json({ success: true, base: "USD", rates: { XAU: 0.0004, XAG: 0.03, USDXAU: 2500, USDXAG: 30 } });
  if (path.startsWith("/ipfs/")) {
    const file = join(ipfsDir, path.slice("/ipfs/".length).replace(/[^A-Za-z0-9._-]/g, "_"));
    if (existsSync(file)) return { status: 200, body: readFileSync(file, "utf8"), type: "application/json" };
  }
  return { status: 404, body: "not faked", type: "text/plain" };
}

/** An `/ipfs/<cid>` not on disk is read from the object store prefix (MinIO `ipfs/`, anonymous download). */
async function fromStore(store: string, path: string) {
  const r = await fetch(`${store}/${path.slice("/ipfs/".length).replace(/[^A-Za-z0-9._-]/g, "_")}`).catch(() => undefined);
  if (!r?.ok) return undefined;
  return { status: 200, body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "application/octet-stream" };
}

export function serve(port: number, ipfsDir: string, ipfsStore?: string): Server {
  return createServer((req, res) => {
    req.resume().on("end", async () => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      let r: { status: number; body: string | Buffer; type: string } = route(req.method ?? "GET", path, ipfsDir);
      if (r.status === 404 && ipfsStore && path.startsWith("/ipfs/")) r = (await fromStore(ipfsStore, path)) ?? r;
      console.log(`${req.method} ${req.url} -> ${r.status}`);
      res.writeHead(r.status, { "content-type": r.type }).end(r.body);
    });
  }).listen(port, "127.0.0.1");
}

export async function postSumsubWebhook(apiUrl: string, secret: string, payload: object): Promise<Response> {
  const body = JSON.stringify(payload);
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return fetch(`${apiUrl}/v1/kyc/callback`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payload-digest": digest, "x-payload-digest-alg": "HMAC_SHA256_HEX" },
    body,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve(Number(process.argv[2]), process.argv[3], process.argv[4]);
