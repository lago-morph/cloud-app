/**
 * `atomic(db, steps)` (SQL-REQ-005, sql.md §2.2 "atomic"): all steps commit or none do.
 * - SQLite/D1: the steps are built once on a write handle over the database and submitted as
 *   one D1 batch (D1 runs a batch as one transaction).
 * - Postgres (PGlite): a transaction is opened, every step is built on a write handle over the
 *   transaction, and the writes are awaited in order; an error rolls the transaction back.
 * On both, every step's write is checked to have been built on the handle passed to it before
 * anything executes; otherwise the call rejects with `CORE.INTERNAL`.
 */
import { FrameworkError } from "../core/errors.js";
import { adapterOf, normalizeResult, targetOf, writeHandle, type Adapter, type DrizzleDb } from "./handle.js";
import type { AtomicResults, PortableDb, WriteStep } from "./types.js";
import { withValueRules } from "./write-rules.js";

interface Executable {
  execute(): Promise<unknown>;
}

function internal(message: string): FrameworkError {
  return new FrameworkError("CORE.INTERNAL", `atomic: ${message}`);
}

/** Builds every step on `db` and checks each write was built on that handle; returns the Drizzle builders. */
function buildSteps(steps: readonly WriteStep[], db: DrizzleDb, adapter: Adapter): Executable[] {
  const marks = new WeakSet<object>();
  const handle = writeHandle(db, adapter, marks);
  const built = steps.map((step) => step(handle) as unknown);
  return built.map((write, i) => {
    if (typeof write !== "object" || write === null || !marks.has(write)) {
      // An async step's promise is not awaited here; keep its own rejection from going unhandled.
      if (write instanceof Promise) write.catch(() => undefined);
      throw internal(
        `step ${i + 1} did not return a write built on the handle passed to it; build each step's write synchronously on that handle (never on c.var.sql or a builder made earlier)`,
      );
    }
    return targetOf(write) as Executable;
  });
}

/** Applies all steps as one all-or-nothing unit. */
export async function atomic<const Steps extends readonly WriteStep[]>(db: PortableDb, steps: Steps): Promise<AtomicResults<Steps>> {
  const adapter = adapterOf(db);
  if (adapter === undefined) throw internal("the database handle was not made by the framework");
  if (steps.length === 0) return [] as unknown as AtomicResults<Steps>;
  const results = await adapter.guard(async () => {
    if (adapter.dialect === "sqlite") {
      const writes = buildSteps(steps, adapter.db, adapter);
      const batch = adapter.db.batch as (queries: readonly Executable[]) => Promise<unknown[]>;
      return (await batch(writes)).map(normalizeResult);
    }
    const transaction = adapter.db.transaction as (run: (tx: DrizzleDb) => Promise<unknown[]>) => Promise<unknown[]>;
    return transaction(async (tx) => {
      const writes = buildSteps(steps, withValueRules(tx), adapter);
      const out: unknown[] = [];
      for (const write of writes) out.push(normalizeResult(await write.execute()));
      return out;
    });
  });
  // Every step is a write that has committed: its RETURNING rows are returned in full (DEC-0542).
  return results as AtomicResults<Steps>;
}
