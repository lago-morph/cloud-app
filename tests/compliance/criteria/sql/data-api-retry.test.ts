/**
 * SQL-AC-006, Data API retry-loop clause (sql.md §4; SQL-REQ-006; plan-aws.md G-T4): "Locally and
 * deterministically, with a 'database resuming' error injected into the Data API adapter on
 * every attempt, the retry loop gives up at PAR-210 and returns `SQL.UNAVAILABLE`."
 *
 * Written from the criterion and sql.md §AWS ("the clock and the error source are injected"):
 * - the error source is the adapter's Data API client: a stand-in whose every `send` rejects with
 *   an error named `DatabaseResumingException`, the Data API's "database resuming" error;
 * - the clock is a virtual one: `now` reads virtual time and `sleep` advances it at once, so the
 *   test takes no real time and gives the same result on every run;
 * - "gives up at PAR-210": the failure is `SQL.UNAVAILABLE` (a catalogue error), the last attempt
 *   starts within PAR-210 of the first, and no wait the loop asked for would have carried an
 *   attempt past PAR-210. It must not give up early either: at least two attempts are made and the
 *   last starts within the backoff cap of PAR-210 (sql.md §AWS: backoff with jitter until PAR-210).
 *
 * The adapter is the framework's AWS SQL driver (`packages/framework/src/sql/data-api.ts`, plan
 * item G-02). Only local runs this clause (the criterion states it as local); no AWS request is
 * made: the client is a stand-in object and never reaches the network.
 */
import { describe, expect, it } from "vitest";
import { tag, target } from "../../harness/index.js";
import { parameterNumber } from "../core/support/repo.js";

process.env.PROTOTYPE_FRAMEWORK_DIALECT = "postgres";
const { dataApiDb } = await import("../../../../packages/framework/src/sql/data-api.js");
const { defineTable, id, text } = await import("../../../../packages/framework/src/index.js");

const PAR_210_MS = parameterNumber("PAR-210") * 1000;
/** Generous bound on the backoff's largest single wait (sql.md §AWS names backoff, not its cap); PAR-275's cap is 5 s. */
const MAX_WAIT_MS = 10_000;
/** Attempts the stand-in answers before it stops the test (a loop that never gives up). */
const MAX_ATTEMPTS = 10_000;

const probes = defineTable("retry_clause_probes", { id: id(), name: text() });

function virtualClock(random: () => number) {
  let time = 1_000_000;
  const waits: number[] = [];
  return {
    waits,
    elapsedSince: (start: number) => time - start,
    clock: {
      now: () => time,
      sleep: (ms: number) => {
        if (!Number.isFinite(ms) || ms < 0) throw new Error(`the retry loop asked to wait ${String(ms)} ms`);
        waits.push(ms);
        time += ms;
        return Promise.resolve();
      },
      random,
    },
  };
}

/** The injected error source: a client object (a class instance, as the SDK's is) whose every `send` rejects with the resuming error. */
class ResumingClient {
  readonly attempts: number[] = [];
  constructor(private readonly now: () => number) {}
  send(): Promise<never> {
    this.attempts.push(this.now());
    if (this.attempts.length > MAX_ATTEMPTS) return Promise.reject(new Error(`the retry loop made more than ${String(MAX_ATTEMPTS)} attempts`));
    return Promise.reject(Object.assign(new Error("Database is resuming (injected)"), { name: "DatabaseResumingException", $fault: "client", $metadata: { httpStatusCode: 400 } }));
  }
}

const TARGET = { resourceArn: "arn:aws:rds:eu-west-1:123456789012:cluster:reference-test-retryclause", secretArn: "arn:aws:secretsmanager:eu-west-1:123456789012:secret:reference-test-retryclause-database-credentials-AbCdEf", database: "reference" };

if (target().target === "local") {
  describe("SQL-AC-006 Data API retry-loop clause (local, deterministic)", () => {
    for (const [label, random] of [
      ["longest waits", () => 1 - Number.EPSILON],
      ["mid-range jitter", () => 0.5],
      ["short waits", () => 0.05],
    ] as const) {
      it(tag("SQL-AC-006", `Data API retry-loop clause (${label}): with a "database resuming" error injected on every attempt, the retry loop gives up at PAR-210 and returns SQL.UNAVAILABLE`), async () => {
        const v = virtualClock(random);
        const client = new ResumingClient(v.clock.now);
        const attempts = client.attempts;
        // The adapter's parameter is the SDK client type; the stand-in has the one method the driver calls.
        const db = dataApiDb(client as unknown as Parameters<typeof dataApiDb>[0], TARGET, { clock: v.clock });
        const start = v.clock.now();

        const error = await db.select({ id: probes.id }).from(probes).then(
          () => undefined,
          (e: unknown) => e as { name?: string; code?: string },
        );

        expect(error, "the query fails").toBeDefined();
        expect(error).toMatchObject({ name: "FrameworkError", code: "SQL.UNAVAILABLE" });
        expect(attempts.length, "attempts made (every one answered with the resuming error)").toBeGreaterThanOrEqual(2);
        expect(attempts.length).toBeLessThanOrEqual(MAX_ATTEMPTS);
        const last = (attempts.at(-1) ?? start) - start;
        expect(last, "the last attempt starts within PAR-210 of the first").toBeLessThanOrEqual(PAR_210_MS);
        expect(last, "the loop does not give up long before PAR-210").toBeGreaterThan(PAR_210_MS - MAX_WAIT_MS);
        expect(v.elapsedSince(start), "it gives up at PAR-210, not later").toBeLessThanOrEqual(PAR_210_MS);
        expect(Math.max(...v.waits), "each wait is bounded backoff").toBeLessThanOrEqual(MAX_WAIT_MS);
        // Every wait came between two attempts: the loop never slept after its final attempt.
        expect(v.waits.length).toBe(attempts.length - 1);
      });
    }
  });
} else {
  // Untagged, so never selected as evidence: the clause is local only (sql.md §4).
  describe("SQL-AC-006 Data API retry-loop clause (local only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
