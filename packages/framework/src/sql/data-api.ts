/**
 * The AWS SQL driver (sql.md §2.2, §AWS; plan-aws G-02): Aurora Serverless v2 PostgreSQL through
 * the RDS Data API, with drizzle's `aws-data-api/pg` driver behind the framework's portable
 * handle, value rules and guard. Node only (the AWS Lambda bundle and the CLI); no Worker
 * runtime imports it.
 *
 * - **Client.** One `RDSDataClient` per cold start (`dataApiClient`), with the SDK's own retries
 *   off (`maxAttempts: 1`, DEC-PENDING-g-s1-4 (c)) so this module's loop is the only retry, and
 *   an explicit `NodeHttpHandler` whose agent honours `HTTPS_PROXY`/`NO_PROXY` (`proxyEnv`,
 *   DEC-PENDING-g-s1-5); with no proxy variable set, as in Lambda, it connects directly.
 * - **Resume retry.** A call failing with `DatabaseResumingException` (matched by `name`) is
 *   retried after random(0, min(5 s, 250 ms × 2ⁿ)) (proposed PAR-275, full jitter) until the
 *   next attempt would start after PAR-210 (the handle's budget); then the call fails with
 *   `SQL.UNAVAILABLE`, logged once. The clock, the sleep and the random source are injected
 *   (sql.md §AWS), and the error source is the client, so the loop is tested with the Data API
 *   fake on fake timers. The retry wraps each Data API call (a resuming error means the call did
 *   not run), so a resume during `BeginTransaction` is retried like any statement.
 * - **Errors.** The Data API reports a Postgres error as `BadRequestException` or
 *   `DatabaseErrorException` with the SQLSTATE only in its message (`…; SQLState: 23505`, G-S1
 *   finding (b), shape assumed until phase L). SQLSTATE 23505/23503 under either name is
 *   `SQL.CONFLICT`; the response-size error (PAR-214) is `SQL.RESULT_TOO_LARGE`;
 *   `ServiceUnavailableError` and connection-level failures are `SQL.UNAVAILABLE`. Everything
 *   else goes to the shared guard unchanged, which makes it `CORE.INTERNAL`. The shared guard
 *   (guard.ts) is composed, not changed, so local and Cloudflare behave as before. PAR-215 is
 *   checked by the handle on every result, as on every target.
 * - **Values.** drizzle sends every integral JS number as `longValue` (int8). An integral
 *   `number()` value outside the safe range (1e300) is not an int64, so it is sent as
 *   `doubleValue` instead. A `longValue` read back that is not a safe JS integer would have lost
 *   precision in the SDK's JSON parsing and is `SQL.INVALID_VALUE`. `doubleValue`,
 *   `booleanValue` and `isNull` come back as JS numbers, booleans and null (drizzle's
 *   `getValueFromDataApi`); numeric aggregates arrive as strings and are converted by `sum`/`avg`.
 * - **`atomic`** runs through atomic.ts's Postgres path: drizzle's `transaction()` over
 *   `BeginTransaction`/`CommitTransaction`, `RollbackTransaction` on error. Inside it only the
 *   transaction's handle is awaited, so no statement outside the transaction waits on it.
 */
import https from "node:https";
import {
  BatchExecuteStatementCommand,
  ExecuteStatementCommand,
  RDSDataClient,
  type BatchExecuteStatementCommandInput,
  type ExecuteStatementCommandInput,
  type Field,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { FrameworkError } from "../core/errors.js";
import { logFailure } from "../log/failures.js";
import type { SqlAdapterOptions } from "./d1.js";
import { createGuard, PAR_210_MS, type Guard } from "./guard.js";
import { portableHandle, type DrizzleDb } from "./handle.js";
import type { PortableDb } from "./types.js";
import { withValueRules } from "./write-rules.js";

/** Proposed PAR-275: Data API resume backoff (G-S1 RESULT; DEC-PENDING-g-s1 parameter changes). */
export const RESUME_BACKOFF = { baseMs: 250, factor: 2, capMs: 5_000 } as const;

/** PAR-214: the Data API's maximum response size, in bytes. */
export const PAR_214_BYTES = 1024 * 1024;

/** Which cluster, credentials secret and database the handle runs on (from provisioning, via CFG). */
export interface DataApiTarget {
  readonly resourceArn: string;
  readonly secretArn: string;
  readonly database: string;
}

/** The retry loop's time and randomness (injected in tests). */
export interface DataApiClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Uniform in [0, 1). */
  random(): number;
}

export interface DataApiOptions extends SqlAdapterOptions {
  /** Default: `Date.now`, `setTimeout` and `Math.random`. */
  readonly clock?: DataApiClock;
}

const systemClock: DataApiClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

// ---- Client ------------------------------------------------------------------------------

/** `https.AgentOptions` plus Node 22's `proxyEnv`, which @types/node 22.20.5 does not declare. */
type ProxyAgentOptions = https.AgentOptions & { proxyEnv?: NodeJS.ProcessEnv };

/** A new Data API client: SDK retries off, proxy-aware Node handler. Region from the SDK's chain unless given. */
export function createDataApiClient(config: { readonly region?: string } = {}): RDSDataClient {
  const agent: ProxyAgentOptions = { keepAlive: true, proxyEnv: process.env };
  return new RDSDataClient({
    ...(config.region === undefined ? {} : { region: config.region }),
    maxAttempts: 1,
    requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent(agent) }),
  });
}

let shared: RDSDataClient | undefined;

/** The process's Data API client, created on first use and kept for the cold start. */
export function dataApiClient(): RDSDataClient {
  shared ??= createDataApiClient();
  return shared;
}

// ---- Resume retry ------------------------------------------------------------------------

/** Wait before retry `retry` (0-based): random(0, min(cap, base × factorⁿ)), full jitter. */
export function resumeDelayMs(retry: number, random: () => number): number {
  const { baseMs, factor, capMs } = RESUME_BACKOFF;
  return random() * Math.min(capMs, baseMs * factor ** retry);
}

const nameOf = (e: unknown): string => {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return typeof name === "string" ? name : "";
};
const messageOf = (e: unknown): string => {
  const message = typeof e === "object" && e !== null ? (e as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : "";
};

function unavailable(why: string, log: DataApiOptions["log"]): FrameworkError {
  const failure = new FrameworkError("SQL.UNAVAILABLE", `the database could not be reached: ${why}`);
  if (log !== undefined) logFailure(log, failure);
  return failure;
}

/** Runs `call`, retrying while the cluster resumes, within `budgetMs` from the first attempt (also used by the CLI's database operations, provision/aws/databases.ts). */
export async function whileResuming<T>(call: () => Promise<T>, budgetMs: number, clock: DataApiClock, log: DataApiOptions["log"]): Promise<T> {
  const start = clock.now();
  for (let retry = 0; ; retry++) {
    try {
      return await call();
    } catch (thrown) {
      if (nameOf(thrown) !== "DatabaseResumingException") throw thrown;
      const delay = resumeDelayMs(retry, () => clock.random());
      const elapsed = clock.now() - start;
      if (elapsed + delay > budgetMs) {
        throw unavailable(`the database was still resuming after ${retry + 1} attempts in ${Math.round(elapsed)} ms (PAR-210 is ${budgetMs} ms)`, log);
      }
      await clock.sleep(delay);
    }
  }
}

// ---- Values ------------------------------------------------------------------------------

/** Parameters as the Data API takes them: an integral number outside the safe range goes as a double. */
export function normalizeParameters(parameters: readonly SqlParameter[]): SqlParameter[] {
  return parameters.map((p) => {
    const long = p.value?.longValue;
    return long !== undefined && !Number.isSafeInteger(long) ? { ...p, value: { doubleValue: long } } : p;
  });
}

/** Refuses a `longValue` that is not a safe JS integer (it lost precision in the SDK's JSON parsing). */
export function checkRecords(records: readonly (readonly Field[])[] | undefined): void {
  for (const record of records ?? []) {
    for (const field of record) {
      if (field.longValue !== undefined && !Number.isSafeInteger(field.longValue)) {
        throw new FrameworkError("SQL.INVALID_VALUE", `a database integer (${field.longValue}) is not representable as a safe JS number`);
      }
    }
  }
}

function normalizeCommand(command: unknown): unknown {
  if (command instanceof ExecuteStatementCommand) {
    const input: ExecuteStatementCommandInput = command.input;
    if (input.parameters === undefined) return command;
    return new ExecuteStatementCommand({ ...input, parameters: normalizeParameters(input.parameters) });
  }
  if (command instanceof BatchExecuteStatementCommand) {
    const input: BatchExecuteStatementCommandInput = command.input;
    if (input.parameterSets === undefined) return command;
    return new BatchExecuteStatementCommand({ ...input, parameterSets: input.parameterSets.map(normalizeParameters) });
  }
  return command;
}

/** The client with values normalised and resumes retried; every other member is the client's own. */
function adaptedClient(client: RDSDataClient, budgetMs: number, clock: DataApiClock, log: DataApiOptions["log"]): RDSDataClient {
  const send = client.send.bind(client) as (command: unknown) => Promise<unknown>;
  const adaptedSend = async (command: unknown): Promise<unknown> => {
    const normalized = normalizeCommand(command);
    const output = await whileResuming(() => send(normalized), budgetMs, clock, log);
    checkRecords((output as { records?: Field[][] } | undefined)?.records);
    return output;
  };
  // A proxy, not a plain object: drizzle() takes a non-plain first argument as the client.
  return new Proxy(client, { get: (target, property) => (property === "send" ? adaptedSend : Reflect.get(target, property, target)) });
}

// ---- Errors ------------------------------------------------------------------------------

const SQL_ERROR_NAMES = new Set(["BadRequestException", "DatabaseErrorException"]);
const SQLSTATE = /SQLState:\s*([0-9A-Z]{5})\b/;
const CONFLICT_STATES = new Set(["23505", "23503"]);
const RESPONSE_TOO_LARGE = /more than the allowed response size limit/i;
/** Data API and connection-level failures meaning the database cannot be reached. */
const DATA_API_UNREACHABLE: readonly RegExp[] = [/ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|socket hang up/i];

function causes(thrown: unknown): unknown[] {
  const out: unknown[] = [];
  for (let e = thrown; e !== undefined && e !== null && out.length < 8 && !out.includes(e); ) {
    out.push(e);
    e = typeof e === "object" ? (e as { cause?: unknown }).cause : undefined;
  }
  return out;
}

/** The framework error a Data API failure maps to, or the failure itself for the shared guard. */
function classify(thrown: unknown, log: DataApiOptions["log"]): unknown {
  const chain = causes(thrown);
  const framework = chain.find((e) => e instanceof FrameworkError);
  if (framework !== undefined) return framework;
  for (const e of chain) {
    const name = nameOf(e);
    if (name === "ServiceUnavailableError") return unavailable(messageOf(e) || name, log);
    if (!SQL_ERROR_NAMES.has(name)) continue;
    const message = messageOf(e);
    const state = SQLSTATE.exec(message)?.[1];
    if (state !== undefined && CONFLICT_STATES.has(state)) {
      return new FrameworkError("SQL.CONFLICT", "a uniqueness or reference constraint was violated");
    }
    if (RESPONSE_TOO_LARGE.test(message)) {
      return new FrameworkError(
        "SQL.RESULT_TOO_LARGE",
        `the Data API response is larger than its limit of ${PAR_214_BYTES} bytes (PAR-214); paginate with limit/offset or select fewer columns`,
      );
    }
  }
  return thrown;
}

// ---- Handle ------------------------------------------------------------------------------

/** The app-facing handle over the Data API. Pass `dataApiClient()` in the Lambda (one client per cold start). */
export function dataApiDb(client: RDSDataClient, target: DataApiTarget, options: DataApiOptions = {}): PortableDb {
  const { clock = systemClock, ...guardOptions } = options;
  const budgetMs = options.budgetMs ?? PAR_210_MS;
  const base = createGuard({ ...guardOptions, unreachable: DATA_API_UNREACHABLE });
  const guard: Guard = (operation) =>
    base(async () => {
      try {
        return await operation();
      } catch (thrown) {
        throw classify(thrown, options.log);
      }
    });
  const db = drizzle(adaptedClient(client, budgetMs, clock, options.log), {
    resourceArn: target.resourceArn,
    secretArn: target.secretArn,
    database: target.database,
  });
  // Same cast as postgres.ts: DrizzleDb is an index-signature record a class instance is not.
  return portableHandle({ dialect: "postgres", db: withValueRules(db) as unknown as DrizzleDb, guard });
}
