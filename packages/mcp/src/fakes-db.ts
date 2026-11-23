// In-memory database of the specs (specs/README.md, "Fakes"): the `Db` port
// built from the `given` events; `fakes.ts` assembles it with the other fakes.
import { Effect } from "effect";
import { Db, type Queues, queueErrors } from "./db.js";
import { ToolError } from "./errors.js";
import { type Delay, type Message, text } from "./fake-cluster.js";

const newest = (rows: ReadonlyArray<Message>) =>
  rows
    .filter((r) => typeof r.error === "string")
    .sort(
      (a, b) => Date.parse(text(b.createdAt)) - Date.parse(text(a.createdAt)),
    )
    .slice(0, queueErrors);

const queues = (of: (tag: string) => ReadonlyArray<Message>): Queues => {
  const kyc = of("KycOutboxRow");
  const open = kyc
    .filter((r) => r.processedAt === null)
    .map((r) => text(r.createdAt))
    .sort();
  const mint = of("YieldMintOutboxRow");
  const byStatus: Record<string, number> = {};
  for (const { status } of mint)
    byStatus[text(status)] = (byStatus[text(status)] ?? 0) + 1;
  return {
    kyc: {
      unprocessed: open.length,
      oldestUnprocessedAt: open[0] ?? null,
      errors: newest(kyc).map((r) => ({
        id: Number(r.id),
        chainId: Number(r.chainId),
        error: text(r.error),
      })),
    },
    yieldMint: {
      byStatus,
      errors: newest(mint.map((r) => ({ ...r, error: r.lastError }))).map(
        (r) => ({
          chainId: Number(r.chainId),
          loanId: Number(r.loanId),
          repaymentId: Number(r.repaymentId),
          status: text(r.status),
          error: text(r.error),
        }),
      ),
    },
  };
};

export const db = (
  of: (tag: string) => ReadonlyArray<Message>,
  down: boolean,
  slow: Delay,
) => {
  const unavailable = Effect.fail(new ToolError({ reason: "db_unavailable" }));
  const cursors = (tag: string, field: string) =>
    of(tag).map((c) => ({
      chainId: Number(c.chainId),
      contract: text(c.contract),
      cursor: Number(c[field]),
    }));
  return Db.of({
    cursors: slow(
      down
        ? unavailable
        : Effect.succeed(
            of("IndexerCursor").map((c) => ({
              chainId: Number(c.chainId),
              updatedAt: text(c.updatedAt),
            })),
          ),
    ),
    queues: down ? unavailable : Effect.sync(() => queues(of)),
    syncState: down
      ? unavailable
      : Effect.succeed({
          indexer: of("IndexerCursor").map((c) => ({
            chainId: Number(c.chainId),
            next: Number(c.lastIndexedBlock),
            ...(typeof c.updatedAt === "string"
              ? { updatedAt: c.updatedAt }
              : {}),
          })),
          registry: cursors("SecurityRegistryCursor", "projectedLogId"),
          accessManager: cursors("AccessManagerCursor", "lastLogId"),
        }),
    maxLogId: (chainId, contracts, events) =>
      down
        ? unavailable
        : Effect.succeed(
            Math.max(
              0,
              ...of("ContractLog")
                .filter(
                  (l) =>
                    l.chainId === chainId &&
                    contracts.includes(text(l.contract)) &&
                    (events === undefined || events.includes(text(l.event))),
                )
                .map((l) => Number(l.id)),
            ),
          ),
    tables: down
      ? unavailable
      : Effect.succeed(
          of("Table")
            .filter((t) => t.schema === "public")
            .map((t) => ({
              name: text(t.name),
              columns: Array.isArray(t.columns) ? t.columns : [],
            }))
            .sort((a, b) => (a.name < b.name ? -1 : 1)),
        ),
  });
};
