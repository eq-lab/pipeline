// What the Stellar and EVM risk journeys share: API reads, how a refused call is recorded and the checks over the same recorded shapes; see docs/e2e.md "Risk Council".

import type { Check } from "../lib/journey";
import { http, ok } from "../lib/stellar-world";
import { check, need, units, verdict } from "./stellar-lp";

type Entry = Record<string, any>;

/** The error of a call that was rejected, or null when it went through. */
export const rejection = (call: () => Promise<unknown>): Promise<string | null> =>
  call().then(
    () => null,
    (e) => String(e instanceof Error ? e.message : e).slice(0, 300),
  );

/** The loan-book reads of a risk journey on one chain (`query` is `chain_id=<id>`), for the trustee's `token`. */
export const riskApi = (query: string, token: () => string, loanId: () => bigint | number) => {
  const get = async (path: string, auth = false) => ok(await http("GET", `${path}?${query}`, auth ? { token: token() } : {}), path);
  return {
    entry: async () => ((await get("/v1/loan-book")).loans as Entry[]).find((l) => l.loan_id === String(loanId())),
    defaulted: async () => (await get("/v1/attention-counts", true)).loans.defaulted as number,
    financials: () => get(`/v1/loan-book/${loanId()}/financials`, true),
    book: async () => (await get("/v1/loan-book")).summary as Entry,
    cumulativeYield: async () => (await get("/v1/dashboard/summary")).cumulative_yield_total as string,
  };
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The checks over the recorded `{prefix}risk.*` of one chain's risk journey. */
export function riskChecks(chain: "stellar" | "evm"): Check[] {
  const key = (name: string) => `${chain === "evm" ? "evm." : ""}risk.${name}`;
  const id = (name: string) => `${chain}.risk.${name}`;
  const flags = (name: string, paused: boolean) =>
    check(
      id(paused ? "pause" : "unpause"),
      paused
        ? "The risk council pauses the deposit, vault and withdrawal contracts; the LP's deposit request, stake, unstake, withdrawal request and claim are rejected"
        : "After unpause the same LP operations succeed",
      (r) => {
        const d = need(r, key(name));
        const states = Object.values(d.paused as Record<string, boolean>);
        const errors = Object.values(d.errors as Record<string, string | null>);
        return verdict(states.length > 0 && states.every((p) => p === paused) && errors.length > 0 && errors.every((e) => (e !== null) === paused), JSON.stringify(d));
      },
    );
  return [
    flags("pause", true),
    flags("unpause", false),
    check(id("default-refused"), "Keys without the risk council role (the trustee-side key and the originator) cannot move a loan to Default: the call is rejected and the loan keeps its status", (r) => {
      const d = need(r, key("defaultRefused"));
      const attempts = d.attempts as { who: string; error: string | null }[];
      return verdict(attempts.length >= 2 && attempts.every((a) => a.error !== null) && d.statusAfter === "Performing", JSON.stringify(d));
    }),
    check(id("default"), "The risk council moves the loan to Default: the status on chain, in the loan book and loan detail agree, attention counts one more defaulted loan and the at-risk senior is the outstanding", (r) => {
      const d = need(r, key("default"));
      const agree =
        d.chain.status === "Default" &&
        d.api.book === "Default" &&
        d.api.detail.every((s: string) => s === "Default") &&
        d.api.attention[1] === d.api.attention[0] + 1 &&
        units(String(d.api.atRiskSenior), 6) === BigInt(d.chain.outstanding6);
      return verdict(agree, JSON.stringify(d));
    }),
    check(id("no-yield"), "No yield accrues to the LPs after Default: vault assets, minted yield and cumulative yield stay flat and the weighted rate has no active loan", (r) => {
      const { after, later } = need(r, key("noYield"));
      return verdict(sameJson(after, later) && after.weightedRate === null, JSON.stringify({ after, later }));
    }),
    check(id("close"), "The risk council writes the defaulted loan down and closes it with the Default reason: chain and API show Closed and the defaulted count drops it", (r) => {
      const c = need(r, key("close"));
      const agree =
        c.chain.status === "Closed" &&
        c.chain.reason === "Default" &&
        c.chain.writtenDown === c.chain.outstanding &&
        c.api.detail.every((s: string) => s === "Closed") &&
        c.api.defaulted === c.api.defaultedBefore;
      return verdict(agree, JSON.stringify(c));
    }),
  ];
}
