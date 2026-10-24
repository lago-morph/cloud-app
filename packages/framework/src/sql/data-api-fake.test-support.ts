/**
 * An in-process fake of the RDS Data API for unit tests (plan-aws G-F1). It is a PRE-CHECK,
 * never evidence: a criterion verified only against this fake is not verified on AWS
 * (sql.md §2 "Local": "Neither proves Data API behavior"; plan-aws §2). It makes no network
 * call. Node only; tests only.
 *
 * What it does:
 * - `send(command)` answers `ExecuteStatementCommand`, `BatchExecuteStatementCommand`,
 *   `BeginTransactionCommand`, `CommitTransactionCommand` and `RollbackTransactionCommand` from
 *   `@aws-sdk/client-rds-data` (PAR-111 pin), with the SDK's request, response and exception
 *   types. Any other command is refused with `DataApiFakeUnsupportedError`. `client` hands the
 *   fake to code that expects an `RDSDataClient`, such as `drizzle-orm/aws-data-api/pg`.
 * - One "cluster" holds named databases. Each database is its own PGlite instance (PGlite
 *   connects to one database per instance). `postgres` always exists and is the cluster's
 *   administration instance.
 * - `CREATE DATABASE "<n>" [TEMPLATE template0|template1] [LC_COLLATE '…'] [LC_CTYPE '…']`
 *   runs on the `postgres` instance (so Postgres itself validates the options), and the new
 *   database is loaded from that data directory. `CREATE DATABASE "<new>" TEMPLATE "<old>"`
 *   copies `<old>`'s current data directory into a scratch instance connected to `postgres`
 *   and runs the statement there, so the copy is Postgres's own template copy.
 *   `DROP DATABASE [IF EXISTS] "<n>" [WITH (FORCE)]` closes the instance; without FORCE it fails
 *   (SQLSTATE 55006) while a transaction is open on it. Both refuse to run inside a transaction
 *   (25001) and while connected to the database being dropped (55006), as Postgres does
 *   (migrations.md §2, AWS).
 * - `:name` parameters become `$n` (outside string literals, quoted identifiers, dollar quotes,
 *   comments and `::` casts). Each `Field` is bound with a Postgres type: `stringValue` as
 *   varchar, or the `typeHint`'s type (DATE, TIME, TIMESTAMP, DECIMAL → numeric, JSON → json,
 *   UUID); `longValue` as int8; `doubleValue` as float8; `booleanValue` as bool; `blobValue` as
 *   bytea; `isNull` untyped.
 * - Results come back as `records` (`Field[][]`) and, with `includeResultMetadata`,
 *   `columnMetadata` (`name`, `label`, `typeName`, `type` as a JDBC type code). bool →
 *   `booleanValue`; int2/int4/int8/oid → `longValue` (`stringValue` with
 *   `longReturnType: "STRING"`); float4/float8 → `doubleValue`; numeric → `stringValue`
 *   (`doubleValue`/`longValue` with `decimalReturnType: "DOUBLE_OR_LONG"`); bytea → `blobValue`;
 *   one- or more-dimensional bool/int/float/text/varchar arrays → `arrayValue`; every other
 *   type → `stringValue` in Postgres's text output form; NULL → `isNull: true`.
 *   `numberOfRecordsUpdated` is the affected row count (0 for a select).
 * - Postgres errors become `BadRequestException` (default) or `DatabaseErrorException`
 *   (`sqlErrorException` option) whose message carries the SQLSTATE:
 *   `ERROR: <message>[\n  Detail: <detail>]; SQLState: <code>`. No error has a pg `code` field
 *   or a `cause`: the PGlite error is never reachable from the thrown exception (the fake keeps
 *   its own "statement failed" bookkeeping in a private WeakSet), so consumers cannot classify
 *   without parsing the message, as on AWS.
 * - A response whose JSON encoding exceeds `maxResponseBytes` (PAR-214, 1 MiB) fails with
 *   `BadRequestException` "Database returned more than the allowed response size limit".
 * - Injection: `inject()` makes matching calls fail with a given error before they run;
 *   `resume()` makes calls fail with `DatabaseResumingException` for a number of calls or until
 *   an instant of the injected clock (`now` option). `calls` records every call.
 *
 * FIDELITY GAPS (each is a place where this fake may accept what AWS refuses, or the reverse;
 * the live phase L confirms the shapes marked "assumed"):
 * 1. Error shapes are assumed. The real exception name for a SQL error (the SDK marks
 *    `BadRequestException` deprecated in favour of `DatabaseErrorException`), the exact message
 *    layout around `SQLState: <code>`, the resume message, the response-size message and its
 *    exception are not confirmed live (G-S1 RESULT §4). Consumers must classify by the
 *    exception `name` and by the SQLSTATE parsed from the message, accepting either name.
 *    (Until the G-F1 follow-up, the fake attached the PGlite error, with its pg `code`, as
 *    `cause`; that let a consumer skip the message parsing. It no longer does, and a self-test
 *    checks that no pg `code` is reachable from a thrown exception.) Whether the real SDK
 *    exception carries anything besides `name`, `message`, `$fault` and `$metadata` is assumed.
 * 2. Response size is measured as the UTF-8 length of the JSON-encoded response body (blobs as
 *    base64), not the service's own accounting. For a write the statement has already run (and,
 *    outside a transaction, committed) when the size error is raised; that is assumed.
 * 3. Unknown databases, wrong ARNs, missing parameters, array parameters and unknown
 *    transaction ids fail with assumed exceptions and messages (`BadRequestException` with
 *    SQLSTATE 3D000 for a missing database; `TransactionNotFoundException` for an unknown
 *    transaction). Wrong ARNs are refused only when the fake was given expected ARNs.
 * 4. Parameter typing is assumed: unhinted strings bind as varchar, integers as int8. Postgres's
 *    own implicit and assignment casts then apply. A `:name` inside an array slice (`a[1:2]`) is
 *    taken as a parameter. Extra, unused parameters are ignored. `$1` placeholders are refused.
 *    Because integers bind as int8, a function wanting int4 (`repeat(text, :n)`) fails with
 *    42883 here; that is assumed to match Aurora.
 * 5. One statement per `ExecuteStatement`: PGlite's extended protocol refuses several (42601).
 *    Transaction-control SQL (`BEGIN`, `COMMIT`, `ROLLBACK`, `START TRANSACTION`) outside
 *    `transactionId` is refused; SAVEPOINT inside a transaction runs.
 * 6. Concurrency is serialised per database: a transaction holds its database from
 *    `BeginTransaction` to `Commit`/`Rollback`, and other statements and transactions on it wait.
 *    Aurora would run them on other connections (seeing only committed data). Code that awaits
 *    an outside-transaction statement while holding a transaction therefore hangs here.
 *    Transactions never expire (AWS: 3 minutes idle, 24 hours total). No statement timeout,
 *    no `continueAfterTimeout`.
 * 7. `CommitTransaction` of a transaction whose statement failed is refused (25P02) and rolls it
 *    back; Postgres itself would answer COMMIT with ROLLBACK silently. Assumed strictness.
 * 8. `BatchExecuteStatement` without a `transactionId` runs all parameter sets in one
 *    transaction (all or nothing): assumed. `updateResults[].generatedFields` is always empty,
 *    as is `generatedFields` (Postgres does not return them).
 * 9. `columnMetadata` carries only `name`, `label`, `typeName`, `type` and
 *    `arrayBaseColumnType`; no table, schema, nullability, precision or scale. JDBC type codes
 *    follow the pgJDBC mapping and are assumed.
 * 10. Values: int8 beyond 2^53 loses precision as a JS number; timestamps and dates are
 *    Postgres's text output (`2026-01-02 03:04:05.678`), not reformatted; arrays of other
 *    element types fail with `UnsupportedResultException`.
 * 11. `schema`, `formatRecordsAs: "JSON"`, `continueAfterTimeout` and `ExecuteSql` are not
 *    modelled and are refused with `DataApiFakeUnsupportedError`.
 * 12. Databases: each database's `pg_database` lists the databases that existed in the
 *    `postgres` instance when it was created or copied (a stale view). Only `postgres`'s
 *    `pg_database` stays current. `ALTER DATABASE` is refused. A database created without
 *    `LC_COLLATE` uses PGlite's default locale, not Aurora's (en_US.UTF-8); PGlite accepts any
 *    `LC_COLLATE`/`LC_CTYPE` name without checking it (Aurora refuses an unknown locale). The copy refuses
 *    only while a transaction is open on the source; on AWS a pooled connection left open by
 *    the Data API could also block it (migrations.md "Early spike"); inject 55006 to model it.
 * 13. No IAM, Secrets Manager, cluster state (other than injected resuming), throttling, or HTTP
 *    layer: the SDK's own serialisation, retries and middleware are not exercised.
 */
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  BadRequestException,
  BatchExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseErrorException,
  DatabaseResumingException,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  TransactionNotFoundException,
  UnsupportedResultException,
  type ArrayValue,
  type BatchExecuteStatementCommandOutput,
  type BatchExecuteStatementRequest,
  type BeginTransactionCommandOutput,
  type ColumnMetadata,
  type CommitTransactionCommandOutput,
  type ExecuteStatementCommandOutput,
  type ExecuteStatementRequest,
  type ExecuteStatementResponse,
  type Field,
  type RDSDataClient,
  type RollbackTransactionCommandOutput,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";

/** PAR-214: the Data API's maximum response size. */
export const DATA_API_MAX_RESPONSE_BYTES = 1024 * 1024;
export const FAKE_RESOURCE_ARN = "arn:aws:rds:us-east-1:123456789012:cluster:fake-cluster";
export const FAKE_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:fake-secret-AbCdEf";
export const RESPONSE_TOO_LARGE_MESSAGE = "Database returned more than the allowed response size limit";

/** Thrown for a request shape the fake does not model (see the header's gaps); never an AWS error. */
export class DataApiFakeUnsupportedError extends Error {
  override readonly name = "DataApiFakeUnsupportedError";
}

export type DataApiCommandName =
  | "ExecuteStatement"
  | "BatchExecuteStatement"
  | "BeginTransaction"
  | "CommitTransaction"
  | "RollbackTransaction";

export type DataApiFakeCommand =
  | ExecuteStatementCommand
  | BatchExecuteStatementCommand
  | BeginTransactionCommand
  | CommitTransactionCommand
  | RollbackTransactionCommand;

/** One call the fake received. `database` is the request's, or the transaction's. */
export interface DataApiFakeCall {
  readonly command: DataApiCommandName;
  readonly input: Readonly<Record<string, unknown>>;
  readonly database: string | undefined;
  readonly sql: string | undefined;
}

export interface InjectOptions {
  /** How many matching calls fail (default 1). */
  readonly times?: number;
  readonly command?: DataApiCommandName;
  readonly database?: string;
  readonly sql?: RegExp;
}

export type SqlErrorExceptionName = "BadRequestException" | "DatabaseErrorException";

export interface DataApiFakeOptions {
  /** Databases created at start, each like the CLI's first database (template0, C collation). */
  readonly databases?: readonly string[];
  /** The database used when a request names none (default `postgres`). */
  readonly defaultDatabase?: string;
  /** When given, requests with another ARN are refused. */
  readonly resourceArn?: string;
  readonly secretArn?: string;
  /** The exception a Postgres error is reported as (default `BadRequestException`). */
  readonly sqlErrorException?: SqlErrorExceptionName;
  /** Default PAR-214. */
  readonly maxResponseBytes?: number;
  /** The clock `resume({ untilMs })` compares with (default `Date.now`). */
  readonly now?: () => number;
}

type ResponseMetadata = ExecuteStatementCommandOutput["$metadata"];

const metadata = (httpStatusCode: number): ResponseMetadata => ({ httpStatusCode, requestId: randomUUID(), attempts: 1, totalRetryDelay: 0 });

/** The error the Data API gives while a paused cluster resumes (message assumed). */
export function databaseResumingError(
  message = `The Aurora DB instance ${FAKE_RESOURCE_ARN} is resuming after being auto-paused. Please wait a few seconds and try again.`,
): DatabaseResumingException {
  return new DatabaseResumingException({ message, $metadata: metadata(400) });
}

/** A SQL error carrying `state` in its message, as the Data API reports Postgres errors (assumed shape). */
export function sqlStateError(
  state: string,
  text: string,
  options: { readonly exception?: SqlErrorExceptionName; readonly detail?: string } = {},
): BadRequestException | DatabaseErrorException {
  const message = `ERROR: ${text}${options.detail === undefined ? "" : `\n  Detail: ${options.detail}`}; SQLState: ${state}`;
  const opts = { message, $metadata: metadata(400) };
  return options.exception === "DatabaseErrorException" ? new DatabaseErrorException(opts) : new BadRequestException(opts);
}

/** The Data API's error for a response larger than PAR-214 (message assumed). */
export function responseTooLargeError(): BadRequestException {
  return new BadRequestException({ message: RESPONSE_TOO_LARGE_MESSAGE, $metadata: metadata(400) });
}

const badRequest = (message: string): BadRequestException => new BadRequestException({ message, $metadata: metadata(400) });

// ---------------------------------------------------------------------------------------------
// Parameters

/** Postgres type OIDs used for binding and reading. */
const OID = {
  bool: 16, bytea: 17, int8: 20, int2: 21, int4: 23, text: 25, oid: 26, json: 114, float4: 700, float8: 701,
  bpchar: 1042, varchar: 1043, date: 1082, time: 1083, timestamp: 1114, timestamptz: 1184, numeric: 1700,
  uuid: 2950, jsonb: 3802, unknown: 0,
} as const;

const TYPE_HINT_OID: Readonly<Record<string, number>> = {
  DATE: OID.date, TIME: OID.time, TIMESTAMP: OID.timestamp, DECIMAL: OID.numeric, JSON: OID.json, UUID: OID.uuid,
};

export interface TranslatedStatement {
  /** The SQL with `$n` placeholders. */
  readonly text: string;
  /** Text-form values, in `$n` order (null for NULL). */
  readonly values: readonly (string | null)[];
  /** Postgres type OIDs, in `$n` order (0 = let Postgres infer). */
  readonly types: readonly number[];
}

const isIdentChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_$]/.test(c);
const isNameChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/**
 * Replaces `:name` placeholders with `$n` and binds each named parameter (header: "What it does").
 * Throws `BadRequestException` for a placeholder without a parameter or a value that cannot be bound.
 */
export function translateStatement(sql: string, parameters: readonly SqlParameter[] = []): TranslatedStatement {
  const byName = new Map<string, SqlParameter>();
  for (const p of parameters) {
    if (p.name === undefined || p.name === "") throw badRequest("Parameter name is required");
    if (byName.has(p.name)) throw badRequest(`Duplicate parameter name: ${p.name}`);
    byName.set(p.name, p);
  }
  const order = new Map<string, number>();
  const values: (string | null)[] = [];
  const types: number[] = [];
  let out = "";
  let i = 0;
  const copyUntil = (end: number): void => {
    out += sql.slice(i, end);
    i = end;
  };
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'") {
      const escapes = (sql[i - 1] === "E" || sql[i - 1] === "e") && !isIdentChar(sql[i - 2]);
      let j = i + 1;
      while (j < sql.length) {
        if (escapes && sql[j] === "\\") j += 2;
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      copyUntil(Math.min(j + 1, sql.length));
    } else if (c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      copyUntil(Math.min(j + 1, sql.length));
    } else if (c === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      copyUntil(nl === -1 ? sql.length : nl);
    } else if (c === "/" && next === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else j += 1;
      }
      copyUntil(j);
    } else if (c === "$" && !isIdentChar(sql[i - 1])) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        copyUntil(end === -1 ? sql.length : end + tag[0].length);
      } else if (next !== undefined && /[0-9]/.test(next)) {
        throw new DataApiFakeUnsupportedError("positional $n placeholders are not modelled; use :name parameters");
      } else copyUntil(i + 1);
    } else if (c === ":" && next === ":") {
      copyUntil(i + 2);
    } else if (c === ":" && isNameChar(next)) {
      let j = i + 1;
      while (isNameChar(sql[j])) j += 1;
      const name = sql.slice(i + 1, j);
      let index = order.get(name);
      if (index === undefined) {
        const p = byName.get(name);
        if (p === undefined) throw badRequest(`No value specified for parameter: ${name}`);
        const bound = bindParameter(p);
        values.push(bound.value);
        types.push(bound.oid);
        index = values.length;
        order.set(name, index);
      }
      out += `$${index}`;
      i = j;
    } else {
      copyUntil(i + 1);
    }
  }
  return { text: out, values, types };
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function bindParameter(p: SqlParameter): { value: string | null; oid: number } {
  const v: Field | undefined = p.value;
  const name = p.name ?? "";
  if (v === undefined) throw badRequest(`Parameter ${name} has no value`);
  if (p.typeHint !== undefined) {
    const oid = TYPE_HINT_OID[p.typeHint];
    if (oid === undefined) throw badRequest(`Unknown typeHint for parameter ${name}: ${String(p.typeHint)}`);
    if (v.stringValue === undefined) throw badRequest(`typeHint ${p.typeHint} requires a stringValue (parameter ${name})`);
    return { value: v.stringValue, oid };
  }
  if (v.isNull !== undefined) {
    if (v.isNull !== true) throw badRequest(`Parameter ${name}: isNull must be true`);
    return { value: null, oid: OID.unknown };
  }
  if (v.stringValue !== undefined) return { value: v.stringValue, oid: OID.varchar };
  if (v.longValue !== undefined) {
    if (!Number.isSafeInteger(v.longValue)) throw badRequest(`Parameter ${name}: longValue must be an integer`);
    return { value: String(v.longValue), oid: OID.int8 };
  }
  if (v.doubleValue !== undefined) return { value: String(v.doubleValue), oid: OID.float8 };
  if (v.booleanValue !== undefined) return { value: v.booleanValue ? "t" : "f", oid: OID.bool };
  if (v.blobValue !== undefined) return { value: `\\x${toHex(v.blobValue)}`, oid: OID.bytea };
  if (v.arrayValue !== undefined) throw badRequest(`Array parameters are not supported (parameter ${name})`);
  throw badRequest(`Parameter ${name} has an unsupported value`);
}

// ---------------------------------------------------------------------------------------------
// Results

/** Base types read as raw text; array types keep PGlite's parsers (elements come back typed). */
const TEXT_PARSERS: Readonly<Record<number, (value: string) => string>> = Object.fromEntries(
  [16, 17, 18, 19, 20, 21, 23, 25, 26, 114, 700, 701, 1042, 1043, 1082, 1083, 1114, 1184, 1186, 1266, 1700, 2950, 3802].map(
    (oid) => [oid, (value: string) => value],
  ),
);
/** Serialisers: every value is already in Postgres text form. */
const TEXT_SERIALIZERS = new Proxy({}, { get: () => (value: unknown) => value });

const ARRAY_ELEMENT: Readonly<Record<number, "boolean" | "long" | "double" | "string">> = {
  1000: "boolean", 1005: "long", 1007: "long", 1016: "long", 1021: "double", 1022: "double", 1009: "string", 1015: "string",
};

/** typeName and JDBC type code (pgJDBC mapping; assumed for the Data API). */
const COLUMN_TYPES: Readonly<Record<number, readonly [string, number]>> = {
  16: ["bool", -7], 17: ["bytea", -2], 20: ["int8", -5], 21: ["int2", 5], 23: ["int4", 4], 25: ["text", 12], 26: ["oid", -5],
  114: ["json", 1111], 700: ["float4", 7], 701: ["float8", 8], 1042: ["bpchar", 1], 1043: ["varchar", 12], 1082: ["date", 91],
  1083: ["time", 92], 1114: ["timestamp", 93], 1184: ["timestamptz", 93], 1700: ["numeric", 2], 2950: ["uuid", 1111],
  3802: ["jsonb", 1111], 1000: ["_bool", 2003], 1005: ["_int2", 2003], 1007: ["_int4", 2003], 1016: ["_int8", 2003],
  1021: ["_float4", 2003], 1022: ["_float8", 2003], 1009: ["_text", 2003], 1015: ["_varchar", 2003],
};
const ARRAY_BASE_JDBC: Readonly<Record<string, number>> = { boolean: -7, long: -5, double: 8, string: 12 };

interface ReadOptions {
  readonly longAsString: boolean;
  readonly decimalAsNumber: boolean;
}

const fromHex = (text: string): Uint8Array => {
  const hex = text.startsWith("\\x") ? text.slice(2) : text;
  const out = new Uint8Array(hex.length / 2);
  for (let k = 0; k < out.length; k += 1) out[k] = Number.parseInt(hex.slice(2 * k, 2 * k + 2), 16);
  return out;
};

function toArrayValue(values: readonly unknown[], element: "boolean" | "long" | "double" | "string"): ArrayValue {
  if (values.some((v) => Array.isArray(v))) {
    return { arrayValues: values.map((v) => (Array.isArray(v) ? toArrayValue(v, element) : null)) };
  }
  switch (element) {
    case "boolean":
      return { booleanValues: values.map((v) => (v === null ? null : Boolean(v))) };
    case "long":
      return { longValues: values.map((v) => (v === null ? null : Number(v))) };
    case "double":
      return { doubleValues: values.map((v) => (v === null ? null : Number(v))) };
    case "string":
      return { stringValues: values.map((v) => (v === null ? null : String(v))) };
  }
}

function toField(value: unknown, oid: number, options: ReadOptions): Field {
  if (value === null || value === undefined) return { isNull: true };
  const element = ARRAY_ELEMENT[oid];
  if (element !== undefined) {
    if (!Array.isArray(value)) throw new Error(`data-api-fake: expected an array for type ${oid}`);
    return { arrayValue: toArrayValue(value, element) };
  }
  if (Array.isArray(value)) {
    throw new UnsupportedResultException({ message: `The result contains the unsupported data type ${oid}.`, $metadata: metadata(400) });
  }
  const text = String(value);
  switch (oid) {
    case OID.bool:
      return { booleanValue: text === "t" || text === "true" };
    case OID.int2:
    case OID.int4:
    case OID.int8:
    case OID.oid:
      return options.longAsString ? { stringValue: text } : { longValue: Number(text) };
    case OID.float4:
    case OID.float8:
      return { doubleValue: Number(text) };
    case OID.numeric:
      if (!options.decimalAsNumber) return { stringValue: text };
      return /^-?\d+$/.test(text) ? { longValue: Number(text) } : { doubleValue: Number(text) };
    case OID.bytea:
      return { blobValue: fromHex(text) };
    default:
      return { stringValue: text };
  }
}

function columnMetadata(field: { name: string; dataTypeID: number }): ColumnMetadata {
  const [typeName, type] = COLUMN_TYPES[field.dataTypeID] ?? ["unknown", 1111];
  const element = ARRAY_ELEMENT[field.dataTypeID];
  return { name: field.name, label: field.name, typeName, type, arrayBaseColumnType: element === undefined ? 0 : (ARRAY_BASE_JDBC[element] ?? 0) };
}

/** UTF-8 length of the JSON encoding of a response body, with blobs as base64. */
export function responseBytes(body: unknown): number {
  const json = JSON.stringify(body, (_key, value: unknown) => (value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value));
  return Buffer.byteLength(json ?? "", "utf8");
}

// ---------------------------------------------------------------------------------------------
// Databases

/** A simple FIFO lock. */
class Lock {
  private tail: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const previous = this.tail;
    this.tail = previous.then(() => held);
    return previous.then(() => release);
  }
}

interface Database {
  readonly name: string;
  readonly pg: PGlite;
  readonly lock: Lock;
  /** The open transaction holding `lock`, if any. */
  tx: Transaction | undefined;
  dropped: boolean;
}

interface Transaction {
  readonly id: string;
  readonly db: Database;
  readonly release: () => void;
  failed: boolean;
}

interface PgError {
  readonly code: string;
  readonly message: string;
  readonly detail?: string;
}
const isPgError = (e: unknown): e is PgError => {
  const code: unknown = e instanceof Error ? (e as Error & { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code);
};

let clusterTemplate: Promise<Blob> | undefined;

/** An initdb'd cluster (postgres, template0, template1), made once per process. */
function cluster(): Promise<Blob> {
  clusterTemplate ??= (async () => {
    const init = await PGlite.create({ database: "postgres" });
    try {
      return await init.dumpDataDir("none");
    } finally {
      await init.close();
    }
  })();
  clusterTemplate.catch(() => {
    clusterTemplate = undefined;
  });
  return clusterTemplate;
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** One identifier at the start of `text`: quoted (`""` escapes) or unquoted (lower-cased). */
function readIdent(text: string): { name: string; rest: string } | undefined {
  const t = text.trimStart();
  if (t.startsWith('"')) {
    const m = /^"((?:[^"]|"")*)"/.exec(t);
    return m && m[1] !== undefined ? { name: m[1].replace(/""/g, '"'), rest: t.slice(m[0].length) } : undefined;
  }
  const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(t);
  return m ? { name: m[0].toLowerCase(), rest: t.slice(m[0].length) } : undefined;
}

type DatabaseStatement =
  | { readonly kind: "create"; readonly name: string; readonly template: string | undefined }
  | { readonly kind: "drop"; readonly name: string; readonly ifExists: boolean; readonly force: boolean };

/** Recognises CREATE/DROP/ALTER DATABASE; anything else is an ordinary statement (undefined). */
export function parseDatabaseStatement(sql: string): DatabaseStatement | undefined {
  const s = sql.trim().replace(/;\s*$/, "");
  if (/^ALTER\s+DATABASE\b/i.test(s)) throw new DataApiFakeUnsupportedError("ALTER DATABASE is not modelled");
  const create = /^CREATE\s+DATABASE\b/i.exec(s);
  if (create) {
    const id = readIdent(s.slice(create[0].length));
    if (!id) throw new DataApiFakeUnsupportedError(`cannot parse: ${sql}`);
    let rest = id.rest.trim().replace(/^WITH\b/i, "").trim();
    let template: string | undefined;
    while (rest !== "") {
      const key = /^([A-Za-z_]+)\s*(=\s*)?/.exec(rest);
      if (!key || key[1] === undefined) throw new DataApiFakeUnsupportedError(`cannot parse CREATE DATABASE options: ${rest}`);
      const option = key[1].toUpperCase();
      rest = rest.slice(key[0].length);
      if (option === "TEMPLATE") {
        const t = readIdent(rest);
        if (!t) throw new DataApiFakeUnsupportedError(`cannot parse TEMPLATE: ${rest}`);
        template = t.name;
        rest = t.rest.trim();
      } else if (["LC_COLLATE", "LC_CTYPE", "LOCALE", "ENCODING"].includes(option)) {
        const v = /^'(?:[^']|'')*'\s*/.exec(rest) ?? /^[A-Za-z0-9_.-]+\s*/.exec(rest);
        if (!v) throw new DataApiFakeUnsupportedError(`cannot parse ${option}: ${rest}`);
        rest = rest.slice(v[0].length);
      } else {
        throw new DataApiFakeUnsupportedError(`CREATE DATABASE option ${option} is not modelled`);
      }
    }
    return { kind: "create", name: id.name, template };
  }
  const drop = /^DROP\s+DATABASE\s+(IF\s+EXISTS\s+)?/i.exec(s);
  if (drop) {
    const id = readIdent(s.slice(drop[0].length));
    if (!id) throw new DataApiFakeUnsupportedError(`cannot parse: ${sql}`);
    const rest = id.rest.trim();
    const force = /^(WITH\s*)?\(\s*FORCE\s*\)$/i.test(rest);
    if (rest !== "" && !force) throw new DataApiFakeUnsupportedError(`DROP DATABASE option is not modelled: ${rest}`);
    return { kind: "drop", name: id.name, ifExists: drop[1] !== undefined, force };
  }
  return undefined;
}

const TX_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION|END|ABORT)\b(?!\s+TO\b)/i;

// ---------------------------------------------------------------------------------------------
// The fake

interface Injection {
  readonly error: () => Error;
  remaining: number;
  readonly match: (call: DataApiFakeCall) => boolean;
}

/** The fake Data API. Create with `DataApiFake.create()`; `close()` after use. */
export class DataApiFake {
  readonly calls: DataApiFakeCall[] = [];
  private readonly databases = new Map<string, Database>();
  private readonly transactions = new Map<string, Transaction>();
  private readonly injections: Injection[] = [];
  private readonly adminLock = new Lock();
  /**
   * SQL exceptions raised by a statement Postgres ran and refused (they abort an open
   * transaction). Kept here, not on the exception: an SDK exception carries no PGlite error, so
   * a pg `code` on the thrown error would let consumers skip parsing the message.
   */
  private readonly statementFailures = new WeakSet<object>();
  private resumeCalls = 0;
  private resumeUntil = Number.NEGATIVE_INFINITY;
  private closed = false;
  private readonly sqlErrorException: SqlErrorExceptionName;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;
  private readonly defaultDatabase: string;

  private constructor(private readonly options: DataApiFakeOptions) {
    this.sqlErrorException = options.sqlErrorException ?? "BadRequestException";
    this.maxResponseBytes = options.maxResponseBytes ?? DATA_API_MAX_RESPONSE_BYTES;
    this.now = options.now ?? Date.now;
    this.defaultDatabase = options.defaultDatabase ?? "postgres";
  }

  static async create(options: DataApiFakeOptions = {}): Promise<DataApiFake> {
    const fake = new DataApiFake(options);
    const pg = await PGlite.create({ loadDataDir: await cluster(), database: "postgres" });
    fake.databases.set("postgres", { name: "postgres", pg, lock: new Lock(), tx: undefined, dropped: false });
    for (const name of options.databases ?? []) {
      await fake.createDatabase(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`, { kind: "create", name, template: "template0" });
    }
    return fake;
  }

  /** The fake typed as the SDK client, for code (drizzle, adapters) that takes an `RDSDataClient`. */
  get client(): RDSDataClient {
    return this as unknown as RDSDataClient;
  }

  /** Names of the databases that exist now. */
  databaseNames(): string[] {
    return [...this.databases.keys()].sort();
  }

  /** The PGlite instance behind a database, for test assertions that bypass the Data API. */
  pglite(name: string): PGlite {
    const db = this.databases.get(name);
    if (!db) throw new Error(`data-api-fake: no database ${name}`);
    return db.pg;
  }

  /** Matching calls fail with `error` before they run, `times` times (default once). */
  inject(error: Error | (() => Error), options: InjectOptions = {}): void {
    const { times = 1, command, database, sql } = options;
    this.injections.push({
      error: typeof error === "function" ? error : () => error,
      remaining: times,
      match: (call) =>
        (command === undefined || call.command === command) &&
        (database === undefined || call.database === database) &&
        (sql === undefined || (call.sql !== undefined && sql.test(call.sql))),
    });
  }

  /** Calls fail with `DatabaseResumingException`: the next `calls` calls, or until `now() >= untilMs`. */
  resume(options: { readonly calls: number } | { readonly untilMs: number }): void {
    if ("calls" in options) this.resumeCalls = options.calls;
    else this.resumeUntil = options.untilMs;
  }

  /** Clears injected failures and resuming. */
  clearInjections(): void {
    this.injections.length = 0;
    this.resumeCalls = 0;
    this.resumeUntil = Number.NEGATIVE_INFINITY;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const tx of this.transactions.values()) tx.release();
    this.transactions.clear();
    for (const db of this.databases.values()) await db.pg.close();
    this.databases.clear();
  }

  send(command: ExecuteStatementCommand): Promise<ExecuteStatementCommandOutput>;
  send(command: BatchExecuteStatementCommand): Promise<BatchExecuteStatementCommandOutput>;
  send(command: BeginTransactionCommand): Promise<BeginTransactionCommandOutput>;
  send(command: CommitTransactionCommand): Promise<CommitTransactionCommandOutput>;
  send(command: RollbackTransactionCommand): Promise<RollbackTransactionCommandOutput>;
  send(command: DataApiFakeCommand): Promise<unknown>;
  async send(command: DataApiFakeCommand): Promise<unknown> {
    if (this.closed) throw new Error("data-api-fake: closed");
    if (command instanceof ExecuteStatementCommand) {
      const input = command.input;
      this.begin("ExecuteStatement", input, input.sql, input.transactionId);
      return { ...(await this.executeStatement(input)), $metadata: metadata(200) };
    }
    if (command instanceof BatchExecuteStatementCommand) {
      const input = command.input;
      this.begin("BatchExecuteStatement", input, input.sql, input.transactionId);
      return { ...(await this.batchExecute(input)), $metadata: metadata(200) };
    }
    if (command instanceof BeginTransactionCommand) {
      const input = command.input;
      this.begin("BeginTransaction", input, undefined, undefined);
      if (input.schema !== undefined) throw new DataApiFakeUnsupportedError("the schema parameter is not modelled");
      const db = this.database(input.database);
      const release = await db.lock.acquire();
      if (db.dropped) {
        release();
        throw this.missingDatabase(db.name);
      }
      try {
        await db.pg.exec("BEGIN");
      } catch (e) {
        release();
        throw e;
      }
      const tx: Transaction = { id: randomUUID().replace(/-/g, ""), db, release, failed: false };
      db.tx = tx;
      this.transactions.set(tx.id, tx);
      return { transactionId: tx.id, $metadata: metadata(200) };
    }
    if (command instanceof CommitTransactionCommand || command instanceof RollbackTransactionCommand) {
      const commit = command instanceof CommitTransactionCommand;
      const input = command.input;
      this.begin(commit ? "CommitTransaction" : "RollbackTransaction", input, undefined, input.transactionId);
      const tx = this.transaction(input.transactionId);
      this.transactions.delete(tx.id);
      try {
        if (commit && !tx.failed) {
          await tx.db.pg.exec("COMMIT").catch((e: unknown) => {
            throw isPgError(e) ? this.sqlError(e) : e;
          });
        } else {
          await tx.db.pg.exec("ROLLBACK").catch(() => undefined);
        }
        if (commit && tx.failed) {
          throw this.sqlError({ code: "25P02", message: "current transaction is aborted; the transaction was rolled back" });
        }
      } finally {
        tx.db.tx = undefined;
        tx.release();
      }
      return { transactionStatus: commit ? "Transaction Committed" : "Rollback Complete", $metadata: metadata(200) };
    }
    const name = (command as { constructor?: { name?: string } }).constructor?.name ?? "unknown";
    throw new DataApiFakeUnsupportedError(`command ${name} is not modelled`);
  }

  /** Records the call, checks the ARNs, and applies resuming and injected failures. */
  private begin(command: DataApiCommandName, input: object, sql: string | undefined, transactionId: string | undefined): void {
    const fields = input as { resourceArn?: string; secretArn?: string; database?: string };
    const txDb = transactionId === undefined ? undefined : this.transactions.get(transactionId)?.db.name;
    const call: DataApiFakeCall = { command, input: { ...input }, database: txDb ?? fields.database ?? this.defaultDatabase, sql };
    this.calls.push(call);
    if (!fields.resourceArn || !fields.secretArn) throw badRequest("resourceArn and secretArn are required");
    if (this.options.resourceArn !== undefined && fields.resourceArn !== this.options.resourceArn) {
      throw badRequest(`Cluster not found or HTTP endpoint not enabled: ${fields.resourceArn}`);
    }
    if (this.options.secretArn !== undefined && fields.secretArn !== this.options.secretArn) {
      throw badRequest(`Secret not found or not accessible: ${fields.secretArn}`);
    }
    if (this.resumeCalls > 0) {
      this.resumeCalls -= 1;
      throw databaseResumingError();
    }
    if (this.now() < this.resumeUntil) throw databaseResumingError();
    const injection = this.injections.find((j) => j.remaining > 0 && j.match(call));
    if (injection) {
      injection.remaining -= 1;
      throw injection.error();
    }
  }

  private database(name: string | undefined): Database {
    const n = name ?? this.defaultDatabase;
    const db = this.databases.get(n);
    if (!db) throw this.missingDatabase(n);
    return db;
  }

  private missingDatabase(name: string): Error {
    return this.sqlError({ code: "3D000", message: `database "${name}" does not exist` });
  }

  private transaction(id: string | undefined): Transaction {
    const tx = id === undefined ? undefined : this.transactions.get(id);
    if (!tx) throw new TransactionNotFoundException({ message: `Transaction ${id ?? ""} is not found`, $metadata: metadata(404) });
    return tx;
  }

  private sqlError(e: PgError): Error {
    return sqlStateError(e.code, e.message, { exception: this.sqlErrorException, ...(e.detail ? { detail: e.detail } : {}) });
  }

  /** Runs `work` on the request's database: inside its transaction, or under the database's lock. */
  private async onDatabase<T>(
    input: { database?: string | undefined; transactionId?: string | undefined },
    work: (db: Database, inTransaction: boolean) => Promise<T>,
  ): Promise<T> {
    if (input.transactionId !== undefined) {
      const tx = this.transaction(input.transactionId);
      if (input.database !== undefined && input.database !== tx.db.name) {
        throw badRequest(`Transaction ${tx.id} belongs to database ${tx.db.name}, not ${input.database}`);
      }
      try {
        return await work(tx.db, true);
      } catch (e) {
        if (typeof e === "object" && e !== null && this.statementFailures.has(e)) tx.failed = true;
        throw e;
      }
    }
    const db = this.database(input.database);
    const release = await db.lock.acquire();
    try {
      if (db.dropped) throw this.missingDatabase(db.name);
      return await work(db, false);
    } finally {
      release();
    }
  }

  private async executeStatement(input: ExecuteStatementRequest): Promise<ExecuteStatementResponse> {
    if (input.schema !== undefined) throw new DataApiFakeUnsupportedError("the schema parameter is not modelled");
    if (input.formatRecordsAs !== undefined && input.formatRecordsAs !== "NONE") throw new DataApiFakeUnsupportedError("formatRecordsAs JSON is not modelled");
    if (input.continueAfterTimeout !== undefined) throw new DataApiFakeUnsupportedError("continueAfterTimeout is not modelled");
    const sql = input.sql ?? "";
    if (sql.trim() === "") throw badRequest("SQL statement is required");
    if (TX_CONTROL.test(sql)) throw new DataApiFakeUnsupportedError("transaction-control SQL is not modelled; use BeginTransaction/CommitTransaction/RollbackTransaction");
    const dbStatement = parseDatabaseStatement(sql);
    if (dbStatement) return this.databaseStatement(input, sql, dbStatement);
    const statement = translateStatement(sql, input.parameters ?? []);
    const read: ReadOptions = {
      longAsString: input.resultSetOptions?.longReturnType === "STRING",
      decimalAsNumber: input.resultSetOptions?.decimalReturnType === "DOUBLE_OR_LONG",
    };
    const response = await this.onDatabase(input, async (db) => {
      const result = await this.run(db, statement);
      const body: ExecuteStatementResponse = { numberOfRecordsUpdated: result.affectedRows ?? 0, generatedFields: [] };
      if (result.fields.length > 0) {
        body.records = result.rows.map((row) => row.map((value, k) => toField(value, result.fields[k]?.dataTypeID ?? OID.text, read)));
        if (input.includeResultMetadata === true) body.columnMetadata = result.fields.map(columnMetadata);
      }
      return body;
    });
    if (responseBytes(response) > this.maxResponseBytes) throw responseTooLargeError();
    return response;
  }

  private async run(db: Database, statement: TranslatedStatement): Promise<{ rows: unknown[][]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }> {
    try {
      return await db.pg.query<unknown[]>(statement.text, [...statement.values], {
        rowMode: "array",
        paramTypes: [...statement.types],
        parsers: TEXT_PARSERS,
        serializers: TEXT_SERIALIZERS,
      });
    } catch (e) {
      if (!isPgError(e)) throw e;
      const error = this.sqlError(e);
      this.statementFailures.add(error);
      throw error;
    }
  }

  private async batchExecute(input: BatchExecuteStatementRequest): Promise<{ updateResults: { generatedFields: Field[] }[] }> {
    if (input.schema !== undefined) throw new DataApiFakeUnsupportedError("the schema parameter is not modelled");
    const sql = input.sql ?? "";
    if (sql.trim() === "") throw badRequest("SQL statement is required");
    if (TX_CONTROL.test(sql)) throw new DataApiFakeUnsupportedError("transaction-control SQL is not modelled");
    if (parseDatabaseStatement(sql)) throw this.sqlError({ code: "25001", message: "CREATE/DROP DATABASE cannot be executed in a batch" });
    const sets = input.parameterSets ?? [[]];
    const statements = sets.map((set) => translateStatement(sql, set));
    return this.onDatabase(input, async (db, inTransaction) => {
      if (!inTransaction) await db.pg.exec("BEGIN");
      try {
        for (const statement of statements) await this.run(db, statement);
        if (!inTransaction) await db.pg.exec("COMMIT");
      } catch (e) {
        if (!inTransaction) await db.pg.exec("ROLLBACK").catch(() => undefined);
        throw e;
      }
      return { updateResults: statements.map(() => ({ generatedFields: [] })) };
    });
  }

  private async databaseStatement(input: ExecuteStatementRequest, sql: string, statement: DatabaseStatement): Promise<ExecuteStatementResponse> {
    const verb = statement.kind === "create" ? "CREATE DATABASE" : "DROP DATABASE";
    if (input.transactionId !== undefined) {
      const tx = this.transaction(input.transactionId);
      tx.failed = true;
      throw this.sqlError({ code: "25001", message: `${verb} cannot run inside a transaction block` });
    }
    if ((input.parameters ?? []).length > 0) throw this.sqlError({ code: "42601", message: `${verb} takes no parameters` });
    const connected = input.database ?? this.defaultDatabase;
    this.database(connected);
    if (statement.kind === "create") await this.createDatabase(sql, statement);
    else await this.dropDatabase(statement, connected);
    return { numberOfRecordsUpdated: 0, generatedFields: [] };
  }

  private async createDatabase(sql: string, statement: Extract<DatabaseStatement, { kind: "create" }>): Promise<void> {
    const releaseAdmin = await this.adminLock.acquire();
    try {
      if (this.databases.has(statement.name)) throw this.sqlError({ code: "42P04", message: `database "${statement.name}" already exists` });
      const admin = this.database("postgres");
      const template = statement.template;
      let data: Blob;
      if (template === undefined || template === "template0" || template === "template1" || template === "postgres") {
        // template0/template1 live in the postgres instance; Postgres validates the options.
        const release = await admin.lock.acquire();
        try {
          await admin.pg.exec(sql).catch((e: unknown) => {
            throw isPgError(e) ? this.sqlError(e) : e;
          });
          data = await admin.pg.dumpDataDir("none");
        } finally {
          release();
        }
      } else {
        const source = this.databases.get(template);
        if (!source) throw this.sqlError({ code: "3D000", message: `template database "${template}" does not exist` });
        const release = await this.tryLock(source, template);
        let scratch: PGlite | undefined;
        try {
          scratch = await PGlite.create({ loadDataDir: await source.pg.dumpDataDir("none"), database: "postgres" });
          await scratch.exec(sql).catch((e: unknown) => {
            throw isPgError(e) ? this.sqlError(e) : e;
          });
          data = await scratch.dumpDataDir("none");
          // Mirror the new database in the postgres instance, so its pg_database stays current.
          const { rows } = await scratch.query<{ datcollate: string; datctype: string }>(
            "SELECT datcollate, datctype FROM pg_database WHERE datname = $1",
            [statement.name],
          );
          const locale = rows[0];
          const releaseAdminDb = await admin.lock.acquire();
          try {
            await admin.pg.exec(
              `CREATE DATABASE ${quoteIdent(statement.name)} TEMPLATE template0` +
                (locale ? ` LC_COLLATE '${locale.datcollate}' LC_CTYPE '${locale.datctype}'` : ""),
            );
          } finally {
            releaseAdminDb();
          }
        } finally {
          release();
          await scratch?.close();
        }
      }
      const pg = await PGlite.create({ loadDataDir: data, database: statement.name });
      this.databases.set(statement.name, { name: statement.name, pg, lock: new Lock(), tx: undefined, dropped: false });
    } finally {
      releaseAdmin();
    }
  }

  /** The source of a copy must have no open transaction (Postgres: "being accessed by other users"). */
  private async tryLock(db: Database, name: string): Promise<() => void> {
    if (db.tx) throw this.sqlError({ code: "55006", message: `source database "${name}" is being accessed by other users`, detail: "There is 1 other session using the database." });
    return db.lock.acquire();
  }

  private async dropDatabase(statement: Extract<DatabaseStatement, { kind: "drop" }>, connected: string): Promise<void> {
    const releaseAdmin = await this.adminLock.acquire();
    try {
      const { name } = statement;
      if (name === connected) throw this.sqlError({ code: "55006", message: "cannot drop the currently open database" });
      if (name === "template0" || name === "template1") throw this.sqlError({ code: "55006", message: "cannot drop a template database" });
      if (name === "postgres") throw new DataApiFakeUnsupportedError("dropping the postgres database is not modelled");
      const db = this.databases.get(name);
      if (!db) {
        if (statement.ifExists) return;
        throw this.missingDatabase(name);
      }
      if (db.tx) {
        if (!statement.force) {
          throw this.sqlError({ code: "55006", message: `database "${name}" is being accessed by other users`, detail: "There is 1 other session using the database." });
        }
        const tx = db.tx;
        this.transactions.delete(tx.id);
        db.tx = undefined;
        tx.release();
      }
      const release = await db.lock.acquire();
      try {
        db.dropped = true;
        this.databases.delete(name);
        await db.pg.close();
      } finally {
        release();
      }
      const admin = this.database("postgres");
      const releaseAdminDb = await admin.lock.acquire();
      try {
        await admin.pg.exec(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      } finally {
        releaseAdminDb();
      }
    } finally {
      releaseAdmin();
    }
  }
}
