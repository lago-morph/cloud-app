// Self-tests of the Data API fake (plan-aws G-F1). The fake is a pre-check, never evidence.
import {
  BadRequestException,
  BatchExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseErrorException,
  DatabaseResumingException,
  ExecuteSqlCommand,
  ExecuteStatementCommand,
  RollbackTransactionCommand,
  TransactionNotFoundException,
  type ExecuteStatementCommandInput,
  type SqlParameter,
} from "@aws-sdk/client-rds-data";
import { eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/aws-data-api/pg";
import { boolean, doublePrecision, integer, pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DATA_API_MAX_RESPONSE_BYTES,
  DataApiFake,
  DataApiFakeUnsupportedError,
  FAKE_RESOURCE_ARN,
  FAKE_SECRET_ARN,
  RESPONSE_TOO_LARGE_MESSAGE,
  databaseResumingError,
  parseDatabaseStatement,
  responseBytes,
  responseTooLargeError,
  sqlStateError,
  translateStatement,
} from "./data-api-fake.test-support.js";

const ARNS = { resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN };
const exec = (input: Omit<ExecuteStatementCommandInput, "resourceArn" | "secretArn">) => new ExecuteStatementCommand({ ...ARNS, ...input });
const str = (name: string, value: string): SqlParameter => ({ name, value: { stringValue: value } });
const long = (name: string, value: number): SqlParameter => ({ name, value: { longValue: value } });

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a rejection");
}

let fake: DataApiFake;
beforeAll(async () => {
  fake = await DataApiFake.create({ databases: ["app"], defaultDatabase: "app" });
}, 120_000);
afterAll(async () => {
  await fake.close();
});

describe("translateStatement: :name parameters", () => {
  it("replaces :name with $n, reuses a repeated name, and keeps :: casts", () => {
    const t = translateStatement("select :a::int4, :b, :a", [long("a", 1), str("b", "x")]);
    expect(t.text).toBe("select $1::int4, $2, $1");
    expect(t.values).toEqual(["1", "x"]);
    expect(t.types).toEqual([20, 1043]);
  });

  it("leaves placeholders inside literals, quoted identifiers, dollar quotes and comments alone", () => {
    const t = translateStatement(
      `select ':x', E'\\':y', "c:z", $$ :w $$, $t$ :v $t$ -- :u\n, /* :s /* :r */ */ :n`,
      [long("n", 1)],
    );
    expect(t.text).toBe(`select ':x', E'\\':y', "c:z", $$ :w $$, $t$ :v $t$ -- :u\n, /* :s /* :r */ */ $1`);
  });

  it("accepts the numeric names drizzle uses (:1, :2)", () => {
    expect(translateStatement("select :1, :2", [long("1", 5), str("2", "b")]).text).toBe("select $1, $2");
  });

  it("binds every Field kind with a Postgres type", () => {
    const t = translateStatement("select :s, :l, :d, :b, :x, :n", [
      str("s", "t"),
      long("l", -3),
      { name: "d", value: { doubleValue: 1.5 } },
      { name: "b", value: { booleanValue: false } },
      { name: "x", value: { blobValue: new Uint8Array([1, 255]) } },
      { name: "n", value: { isNull: true } },
    ]);
    expect(t.values).toEqual(["t", "-3", "1.5", "f", "\\x01ff", null]);
    expect(t.types).toEqual([1043, 20, 701, 16, 17, 0]);
  });

  it.each([
    ["DATE", 1082],
    ["TIME", 1083],
    ["TIMESTAMP", 1114],
    ["DECIMAL", 1700],
    ["JSON", 114],
    ["UUID", 2950],
  ] as const)("binds typeHint %s as OID %i", (typeHint, oid) => {
    expect(translateStatement("select :v", [{ name: "v", value: { stringValue: "x" }, typeHint }]).types).toEqual([oid]);
  });

  it("refuses missing, duplicate, unnamed and unbindable parameters with BadRequestException", () => {
    const cases: [string, SqlParameter[]][] = [
      ["select :missing", []],
      ["select :a", [long("a", 1), long("a", 2)]],
      ["select 1", [{ value: { longValue: 1 } }]],
      ["select :a", [{ name: "a", value: { longValue: 1 }, typeHint: "UUID" }]],
      ["select :a", [{ name: "a", value: { arrayValue: { longValues: [1] } } }]],
      ["select :a", [{ name: "a", value: { longValue: 1.5 } }]],
      ["select :a", [{ name: "a" }]],
    ];
    for (const [sql, params] of cases) expect(() => translateStatement(sql, params)).toThrow(BadRequestException);
  });

  it("ignores unused parameters and refuses positional $n placeholders", () => {
    expect(translateStatement("select 1", [long("unused", 1)]).values).toEqual([]);
    expect(() => translateStatement("select $1", [])).toThrow(DataApiFakeUnsupportedError);
  });
});

describe("ExecuteStatement: records and columnMetadata", () => {
  it("maps each result type to the SDK's Field members", async () => {
    const out = await fake.send(
      exec({
        sql: `select true as b, 7::int4 as i, 8::int8 as l, 1.5::float8 as d, 1.25::numeric as n, 'x'::text as t, null::text as z,
              '\\x01ff'::bytea as y, '2026-01-02 03:04:05'::timestamp as ts, array[1,2]::int4[] as ia, array['a',null]::text[] as ta,
              array[[1,2],[3,4]]::int8[] as m, array[true]::bool[] as ba, array[0.5]::float8[] as da`,
      }),
    );
    expect(out.records).toEqual([
      [
        { booleanValue: true },
        { longValue: 7 },
        { longValue: 8 },
        { doubleValue: 1.5 },
        { stringValue: "1.25" },
        { stringValue: "x" },
        { isNull: true },
        { blobValue: new Uint8Array([1, 255]) },
        { stringValue: "2026-01-02 03:04:05" },
        { arrayValue: { longValues: [1, 2] } },
        { arrayValue: { stringValues: ["a", null] } },
        { arrayValue: { arrayValues: [{ longValues: [1, 2] }, { longValues: [3, 4] }] } },
        { arrayValue: { booleanValues: [true] } },
        { arrayValue: { doubleValues: [0.5] } },
      ],
    ]);
    expect(out.columnMetadata).toBeUndefined();
    expect(out.numberOfRecordsUpdated).toBe(0);
    expect(out.$metadata.httpStatusCode).toBe(200);
  });

  it("returns columnMetadata only with includeResultMetadata", async () => {
    const out = await fake.send(exec({ sql: "select 1::int4 as a, 'x'::text as b, array[1]::int4[] as c", includeResultMetadata: true }));
    expect(out.columnMetadata).toEqual([
      { name: "a", label: "a", typeName: "int4", type: 4, arrayBaseColumnType: 0 },
      { name: "b", label: "b", typeName: "text", type: 12, arrayBaseColumnType: 0 },
      { name: "c", label: "c", typeName: "_int4", type: 2003, arrayBaseColumnType: -5 },
    ]);
  });

  it("honours resultSetOptions longReturnType and decimalReturnType", async () => {
    const out = await fake.send(
      exec({ sql: "select 9::int8, 2.5::numeric, 3::numeric", resultSetOptions: { longReturnType: "STRING", decimalReturnType: "DOUBLE_OR_LONG" } }),
    );
    expect(out.records).toEqual([[{ stringValue: "9" }, { doubleValue: 2.5 }, { longValue: 3 }]]);
  });

  it("binds typeHint values with their Postgres types", async () => {
    const out = await fake.send(
      exec({
        sql: "select pg_typeof(:u)::text, pg_typeof(:d)::text, pg_typeof(:n)::text, pg_typeof(:j)::text, pg_typeof(:t)::text, pg_typeof(:s)::text, pg_typeof(:l)::text",
        parameters: [
          { name: "u", value: { stringValue: "6f1f7c5e-8d2a-4b39-9a51-2d6a0c3e4f10" }, typeHint: "UUID" },
          { name: "d", value: { stringValue: "2026-01-02" }, typeHint: "DATE" },
          { name: "n", value: { stringValue: "1.5" }, typeHint: "DECIMAL" },
          { name: "j", value: { stringValue: "{}" }, typeHint: "JSON" },
          { name: "t", value: { stringValue: "2026-01-02 03:04:05" }, typeHint: "TIMESTAMP" },
          str("s", "x"),
          long("l", 1),
        ],
      }),
    );
    expect(out.records?.[0]?.map((f) => f.stringValue)).toEqual(["uuid", "date", "numeric", "json", "timestamp without time zone", "character varying", "bigint"]);
  });

  it("an int8 parameter where Postgres wants int4 fails (assumed to match Aurora); a cast fixes it", async () => {
    await expect(fake.send(exec({ sql: "select repeat('x', :n)", parameters: [long("n", 2)] }))).rejects.toThrow(/SQLState: 42883$/);
    expect((await fake.send(exec({ sql: "select repeat('x', :n::int4)", parameters: [long("n", 2)] }))).records).toEqual([[{ stringValue: "xx" }]]);
  });

  it("an unhinted string compared with a uuid fails, as a varchar parameter does in Postgres", async () => {
    const e = await rejection(fake.send(exec({ sql: "select gen_random_uuid() = :v", parameters: [str("v", "6f1f7c5e-8d2a-4b39-9a51-2d6a0c3e4f10")] })));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toMatch(/SQLState: 42883$/);
  });

  it("a write without RETURNING reports numberOfRecordsUpdated and no records", async () => {
    await fake.send(exec({ sql: "create table w1 (id text primary key, n int4)" }));
    const out = await fake.send(exec({ sql: "insert into w1 values (:a, 1), (:b, 2)", parameters: [str("a", "a"), str("b", "b")] }));
    expect(out.numberOfRecordsUpdated).toBe(2);
    expect(out.records).toBeUndefined();
    const upd = await fake.send(exec({ sql: "update w1 set n = n + 1 returning id", includeResultMetadata: true }));
    expect(upd.numberOfRecordsUpdated).toBe(2);
    expect(upd.records).toHaveLength(2);
  });

  it("refuses several statements in one call (42601)", async () => {
    const e = await rejection(fake.send(exec({ sql: "select 1; select 2" })));
    expect(e.message).toMatch(/SQLState: 42601$/);
  });

  it("refuses transaction-control SQL and unmodelled options with DataApiFakeUnsupportedError", async () => {
    for (const input of [
      { sql: "BEGIN" },
      { sql: "commit" },
      { sql: "start transaction" },
      { sql: "select 1", schema: "public" },
      { sql: "select 1", formatRecordsAs: "JSON" as const },
      { sql: "select 1", continueAfterTimeout: true },
      { sql: "ALTER DATABASE app RENAME TO b" },
    ]) {
      await expect(fake.send(exec(input))).rejects.toBeInstanceOf(DataApiFakeUnsupportedError);
    }
    const other = new ExecuteSqlCommand({ dbClusterOrInstanceArn: FAKE_RESOURCE_ARN, awsSecretStoreArn: FAKE_SECRET_ARN, sqlStatements: "select 1" });
    await expect(fake.send(other as unknown as ExecuteStatementCommand)).rejects.toBeInstanceOf(DataApiFakeUnsupportedError);
  });

  it("requires both ARNs, and checks them when the fake was given expected ARNs", async () => {
    await expect(fake.send(new ExecuteStatementCommand({ resourceArn: FAKE_RESOURCE_ARN, secretArn: undefined, sql: "select 1" }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const strict = await DataApiFake.create({ resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN });
    try {
      await expect(strict.send(new ExecuteStatementCommand({ ...ARNS, resourceArn: "arn:aws:rds:us-east-1:1:cluster:other", sql: "select 1" }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(strict.send(new ExecuteStatementCommand({ ...ARNS, secretArn: "arn:other", sql: "select 1" }))).rejects.toBeInstanceOf(BadRequestException);
      expect((await strict.send(exec({ sql: "select 1" }))).records).toEqual([[{ longValue: 1 }]]);
    } finally {
      await strict.close();
    }
  });

  it("an unknown database is a SQL error with SQLSTATE 3D000", async () => {
    const e = await rejection(fake.send(exec({ sql: "select 1", database: "nope" })));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe('ERROR: database "nope" does not exist; SQLState: 3D000');
  });
});

describe("SQL errors carry the SQLSTATE in the message", () => {
  it("a unique violation is BadRequestException with SQLState 23505 and no pg code field", async () => {
    await fake.send(exec({ sql: "create table u1 (id text primary key)" }));
    await fake.send(exec({ sql: "insert into u1 values ('a')" }));
    const e = await rejection(fake.send(exec({ sql: "insert into u1 values ('a')" })));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.name).toBe("BadRequestException");
    expect(e.message).toBe('ERROR: duplicate key value violates unique constraint "u1_pkey"\n  Detail: Key (id)=(a) already exists.; SQLState: 23505');
    expect((e as { code?: unknown }).code).toBeUndefined();
  });

  it("a foreign-key violation carries SQLState 23503", async () => {
    await fake.send(exec({ sql: "create table p1 (id text primary key)" }));
    await fake.send(exec({ sql: "create table c1 (id text primary key, p text references p1(id))" }));
    const e = await rejection(fake.send(exec({ sql: "insert into c1 values ('c', 'missing')" })));
    expect(e.message).toMatch(/; SQLState: 23503$/);
  });

  it("sqlErrorException selects DatabaseErrorException", async () => {
    const other = await DataApiFake.create({ sqlErrorException: "DatabaseErrorException" });
    try {
      const e = await rejection(other.send(exec({ sql: "select * from missing_table" })));
      expect(e).toBeInstanceOf(DatabaseErrorException);
      expect(e.message).toBe('ERROR: relation "missing_table" does not exist; SQLState: 42P01');
    } finally {
      await other.close();
    }
  });

  it("sqlStateError builds either exception", () => {
    expect(sqlStateError("23505", "dup")).toBeInstanceOf(BadRequestException);
    expect(sqlStateError("23505", "dup", { exception: "DatabaseErrorException", detail: "d" }).message).toBe("ERROR: dup\n  Detail: d; SQLState: 23505");
  });
});

describe("response size (PAR-214)", () => {
  it("one row whose response exceeds 1 MiB fails with the response-size error", async () => {
    const e = await rejection(fake.send(exec({ sql: "select repeat('x', :n::int4)", parameters: [long("n", DATA_API_MAX_RESPONSE_BYTES)] })));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.message).toBe(RESPONSE_TOO_LARGE_MESSAGE);
  });

  it("a response just under the limit passes; maxResponseBytes lowers the limit", async () => {
    const out = await fake.send(exec({ sql: "select repeat('x', :n::int4)", parameters: [long("n", DATA_API_MAX_RESPONSE_BYTES - 200)] }));
    expect(out.records?.[0]?.[0]?.stringValue).toHaveLength(DATA_API_MAX_RESPONSE_BYTES - 200);
    const small = await DataApiFake.create({ maxResponseBytes: 100 });
    try {
      await expect(small.send(exec({ sql: "select repeat('x', 100)" }))).rejects.toThrow(RESPONSE_TOO_LARGE_MESSAGE);
      expect((await small.send(exec({ sql: "select 'x'" }))).records).toEqual([[{ stringValue: "x" }]]);
    } finally {
      await small.close();
    }
  });

  it("responseBytes counts UTF-8 JSON with blobs as base64", () => {
    expect(responseBytes({ s: "é" })).toBe(Buffer.byteLength('{"s":"é"}'));
    expect(responseBytes({ b: new Uint8Array([1, 2, 3]) })).toBe('{"b":"AQID"}'.length);
  });
});

describe("transactions", () => {
  beforeAll(async () => {
    await fake.send(exec({ sql: "create table t1 (id text primary key)" }));
  });
  const count = async (): Promise<number> => (await fake.send(exec({ sql: "select count(*)::int4 from t1" }))).records?.[0]?.[0]?.longValue ?? -1;

  it("Begin, ExecuteStatement with transactionId, Commit", async () => {
    const { transactionId } = await fake.send(new BeginTransactionCommand({ ...ARNS, database: "app" }));
    expect(transactionId).toMatch(/^[0-9a-f]{32}$/);
    await fake.send(exec({ sql: "insert into t1 values ('c1')", transactionId, database: "app" }));
    const done = await fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }));
    expect(done.transactionStatus).toBe("Transaction Committed");
    expect(await count()).toBe(1);
  });

  it("Rollback discards the transaction's writes", async () => {
    const before = await count();
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(exec({ sql: "insert into t1 values ('r1')", transactionId }));
    const done = await fake.send(new RollbackTransactionCommand({ ...ARNS, transactionId }));
    expect(done.transactionStatus).toBe("Rollback Complete");
    expect(await count()).toBe(before);
  });

  it("an unknown or finished transaction is TransactionNotFoundException", async () => {
    await expect(fake.send(new CommitTransactionCommand({ ...ARNS, transactionId: "nope" }))).rejects.toBeInstanceOf(TransactionNotFoundException);
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }));
    await expect(fake.send(exec({ sql: "select 1", transactionId }))).rejects.toBeInstanceOf(TransactionNotFoundException);
  });

  it("Commit after a failed statement is refused (25P02) and rolls back", async () => {
    const before = await count();
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(exec({ sql: "insert into t1 values ('f1')", transactionId }));
    await expect(fake.send(exec({ sql: "insert into t1 values ('f1')", transactionId }))).rejects.toThrow(/SQLState: 23505$/);
    await expect(fake.send(exec({ sql: "select 1", transactionId }))).rejects.toThrow(/SQLState: 25P02$/);
    await expect(fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }))).rejects.toThrow(/SQLState: 25P02$/);
    expect(await count()).toBe(before);
  });

  it("a statement outside the transaction waits until the transaction ends", async () => {
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(exec({ sql: "insert into t1 values ('w1')", transactionId }));
    let settled = false;
    const outside = count().then((n) => ((settled = true), n));
    await new Promise((resolve) => setImmediate(resolve));
    await fake.send(exec({ sql: "select 1", transactionId }));
    expect(settled).toBe(false);
    await fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }));
    expect(await outside).toBeGreaterThan(0);
  });

  it("a statement naming another database than its transaction's is refused", async () => {
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    try {
      await expect(fake.send(exec({ sql: "select 1", transactionId, database: "postgres" }))).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      await fake.send(new RollbackTransactionCommand({ ...ARNS, transactionId }));
    }
  });
});

describe("BatchExecuteStatement", () => {
  beforeAll(async () => {
    await fake.send(exec({ sql: "create table b1 (id text primary key, n int4)" }));
  });
  const ids = async (): Promise<string[]> =>
    ((await fake.send(exec({ sql: "select id from b1 order by id" }))).records ?? []).map((r) => r[0]?.stringValue ?? "");

  it("runs the statement once per parameter set", async () => {
    const out = await fake.send(
      new BatchExecuteStatementCommand({ ...ARNS, sql: "insert into b1 values (:id, :n)", parameterSets: [[str("id", "a"), long("n", 1)], [str("id", "b"), long("n", 2)]] }),
    );
    expect(out.updateResults).toEqual([{ generatedFields: [] }, { generatedFields: [] }]);
    expect(await ids()).toEqual(["a", "b"]);
  });

  it("outside a transaction it is all or nothing", async () => {
    const e = await rejection(
      fake.send(new BatchExecuteStatementCommand({ ...ARNS, sql: "insert into b1 values (:id, 0)", parameterSets: [[str("id", "c")], [str("id", "a")]] })),
    );
    expect(e.message).toMatch(/SQLState: 23505$/);
    expect(await ids()).toEqual(["a", "b"]);
  });

  it("inside a transaction it commits with the transaction", async () => {
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(new BatchExecuteStatementCommand({ ...ARNS, transactionId, sql: "insert into b1 values (:id, 0)", parameterSets: [[str("id", "d")]] }));
    await fake.send(new RollbackTransactionCommand({ ...ARNS, transactionId }));
    expect(await ids()).toEqual(["a", "b"]);
  });
});

describe("databases: CREATE … TEMPLATE and DROP … WITH (FORCE)", () => {
  const onPostgres = (sql: string) => fake.send(exec({ sql, database: "postgres" }));
  const names = async (): Promise<string[]> =>
    ((await onPostgres("select datname from pg_database where not datistemplate order by datname")).records ?? []).map((r) => r[0]?.stringValue ?? "");

  it("parses quoted and unquoted names and the supported options", () => {
    expect(parseDatabaseStatement(`CREATE DATABASE "a""b" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`)).toEqual({ kind: "create", name: 'a"b', template: "template0" });
    expect(parseDatabaseStatement("create database Foo with template = \"Old\"")).toEqual({ kind: "create", name: "foo", template: "Old" });
    expect(parseDatabaseStatement('DROP DATABASE IF EXISTS "x" WITH (FORCE)')).toEqual({ kind: "drop", name: "x", ifExists: true, force: true });
    expect(parseDatabaseStatement("drop database x (force)")).toEqual({ kind: "drop", name: "x", ifExists: false, force: true });
    expect(parseDatabaseStatement("select 1")).toBeUndefined();
    expect(() => parseDatabaseStatement("CREATE DATABASE x OWNER bob")).toThrow(DataApiFakeUnsupportedError);
    expect(() => parseDatabaseStatement("DROP DATABASE x CASCADE")).toThrow(DataApiFakeUnsupportedError);
  });

  it("the databases option creates C-collated databases; current_database() is the name", async () => {
    const out = await fake.send(exec({ sql: "select current_database()::text, datcollate::text, datctype::text from pg_database where datname = current_database()" }));
    expect(out.records).toEqual([[{ stringValue: "app" }, { stringValue: "C" }, { stringValue: "C" }]]);
    expect(fake.databaseNames()).toEqual(["app", "postgres"]);
  });

  it("creates from template0 with C collation, copies with TEMPLATE, and drops WITH (FORCE)", async () => {
    await onPostgres(`CREATE DATABASE "d_one" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    await fake.send(exec({ sql: "create table k (id text primary key)", database: "d_one" }));
    await fake.send(exec({ sql: "insert into k values ('é'), ('z'), ('a')", database: "d_one" }));
    await onPostgres(`CREATE DATABASE "d_two" TEMPLATE "d_one"`);
    const copied = await fake.send(exec({ sql: "select id, current_database()::text from k order by id", database: "d_two" }));
    expect(copied.records?.map((r) => r.map((f) => f.stringValue))).toEqual([
      ["a", "d_two"],
      ["z", "d_two"],
      ["é", "d_two"],
    ]);
    // The copy is independent of its source.
    await fake.send(exec({ sql: "delete from k", database: "d_two" }));
    expect((await fake.send(exec({ sql: "select count(*) from k", database: "d_one" }))).records).toEqual([[{ longValue: 3 }]]);
    expect(await names()).toEqual(expect.arrayContaining(["d_one", "d_two"]));
    await onPostgres(`DROP DATABASE "d_one" WITH (FORCE)`);
    await onPostgres(`DROP DATABASE "d_two"`);
    expect(await names()).not.toContain("d_one");
    expect(fake.databaseNames()).not.toContain("d_two");
    await expect(fake.send(exec({ sql: "select 1", database: "d_one" }))).rejects.toThrow(/SQLState: 3D000$/);
  });

  it("refuses an existing name (42P04), a missing template (3D000), and running inside a transaction (25001)", async () => {
    await expect(onPostgres(`CREATE DATABASE "app"`)).rejects.toThrow(/SQLState: 42P04$/);
    await expect(onPostgres(`CREATE DATABASE "x1" TEMPLATE "missing"`)).rejects.toThrow(/SQLState: 3D000$/);
    const { transactionId } = await fake.send(new BeginTransactionCommand({ ...ARNS, database: "postgres" }));
    await expect(fake.send(exec({ sql: `CREATE DATABASE "x2"`, transactionId }))).rejects.toThrow(/SQLState: 25001$/);
    await fake.send(new RollbackTransactionCommand({ ...ARNS, transactionId }));
    await expect(fake.send(new BatchExecuteStatementCommand({ ...ARNS, sql: `DROP DATABASE "app"` }))).rejects.toThrow(/SQLState: 25001$/);
  });

  it("Postgres validates the options: an unknown encoding fails", async () => {
    await expect(onPostgres(`CREATE DATABASE "x3" TEMPLATE template0 ENCODING 'no_such_encoding'`)).rejects.toThrow(BadRequestException);
    expect(fake.databaseNames()).not.toContain("x3");
  });

  it("refuses dropping the connected database, a template, or a missing one; IF EXISTS passes", async () => {
    await expect(fake.send(exec({ sql: `DROP DATABASE "app"`, database: "app" }))).rejects.toThrow(/SQLState: 55006$/);
    await expect(onPostgres(`DROP DATABASE template1`)).rejects.toThrow(/SQLState: 55006$/);
    await expect(onPostgres(`DROP DATABASE "gone"`)).rejects.toThrow(/SQLState: 3D000$/);
    await onPostgres(`DROP DATABASE IF EXISTS "gone"`);
  });

  it("an open transaction blocks a copy and a plain drop (55006); FORCE ends it", async () => {
    await onPostgres(`CREATE DATABASE "d_busy" TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    const { transactionId } = await fake.send(new BeginTransactionCommand({ ...ARNS, database: "d_busy" }));
    await expect(onPostgres(`CREATE DATABASE "d_copy" TEMPLATE "d_busy"`)).rejects.toThrow(/SQLState: 55006$/);
    await expect(onPostgres(`DROP DATABASE "d_busy"`)).rejects.toThrow(/SQLState: 55006$/);
    await onPostgres(`DROP DATABASE "d_busy" WITH (FORCE)`);
    await expect(fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }))).rejects.toBeInstanceOf(TransactionNotFoundException);
    expect(fake.databaseNames()).not.toContain("d_busy");
  });
});

describe("injected failures", () => {
  it("resume({ calls }) fails that many calls with DatabaseResumingException, then serves", async () => {
    fake.resume({ calls: 2 });
    for (let k = 0; k < 2; k += 1) {
      const e = await rejection(fake.send(exec({ sql: "select 1" })));
      expect(e).toBeInstanceOf(DatabaseResumingException);
      expect(e.name).toBe("DatabaseResumingException");
    }
    expect((await fake.send(exec({ sql: "select 1" }))).records).toEqual([[{ longValue: 1 }]]);
  });

  it("resume({ untilMs }) uses the injected clock and covers every command", async () => {
    let t = 1_000;
    const timed = await DataApiFake.create({ now: () => t });
    try {
      timed.resume({ untilMs: 5_000 });
      await expect(timed.send(new BeginTransactionCommand(ARNS))).rejects.toBeInstanceOf(DatabaseResumingException);
      t = 4_999;
      await expect(timed.send(exec({ sql: "select 1" }))).rejects.toBeInstanceOf(DatabaseResumingException);
      t = 5_000;
      expect((await timed.send(exec({ sql: "select 1" }))).records).toEqual([[{ longValue: 1 }]]);
    } finally {
      await timed.close();
    }
  });

  it("inject() fails matching calls before they run, the given number of times", async () => {
    await fake.send(exec({ sql: "create table i1 (id text primary key)" }));
    fake.inject(() => sqlStateError("23505", 'duplicate key value violates unique constraint "i1_pkey"'), { command: "ExecuteStatement", sql: /insert into i1/, times: 2 });
    await expect(fake.send(exec({ sql: "select 1" }))).resolves.toBeDefined();
    for (let k = 0; k < 2; k += 1) await expect(fake.send(exec({ sql: "insert into i1 values ('a')" }))).rejects.toThrow(/SQLState: 23505$/);
    expect((await fake.send(exec({ sql: "select count(*) from i1" }))).records).toEqual([[{ longValue: 0 }]]);
    await fake.send(exec({ sql: "insert into i1 values ('a')" }));
  });

  it("inject() takes a database filter and the response-size error; clearInjections() removes them", async () => {
    fake.inject(responseTooLargeError(), { database: "postgres" });
    await expect(fake.send(exec({ sql: "select 1" }))).resolves.toBeDefined();
    await expect(fake.send(exec({ sql: "select 1", database: "postgres" }))).rejects.toThrow(RESPONSE_TOO_LARGE_MESSAGE);
    fake.inject(databaseResumingError(), { times: 5 });
    fake.resume({ calls: 3 });
    fake.clearInjections();
    await expect(fake.send(exec({ sql: "select 1" }))).resolves.toBeDefined();
  });

  it("records every call with its database and SQL", async () => {
    const from = fake.calls.length;
    const { transactionId } = await fake.send(new BeginTransactionCommand(ARNS));
    await fake.send(exec({ sql: "select 2", transactionId }));
    await fake.send(new CommitTransactionCommand({ ...ARNS, transactionId }));
    expect(fake.calls.slice(from).map((c) => [c.command, c.database, c.sql])).toEqual([
      ["BeginTransaction", "app", undefined],
      ["ExecuteStatement", "app", "select 2"],
      ["CommitTransaction", "app", undefined],
    ]);
  });
});

describe("drizzle-orm/aws-data-api/pg against the fake", () => {
  const notes = pgTable("notes", { id: text("id").primaryKey(), title: text("title").notNull(), views: integer("views").notNull(), score: doublePrecision("score"), done: boolean("done").notNull() });
  const db = () => drizzle(fake.client, { ...ARNS, database: "app" });

  beforeAll(async () => {
    await fake.send(exec({ sql: "create table notes (id text primary key, title text not null, views integer not null, score double precision, done boolean not null)" }));
  });

  it("insert, select, update returning, delete", async () => {
    const d = db();
    await d.insert(notes).values([
      { id: "n1", title: "One", views: 1, score: 0.5, done: false },
      { id: "n2", title: "Two", views: 2, score: null, done: true },
    ]);
    expect(await d.select().from(notes).where(eq(notes.id, "n1"))).toEqual([{ id: "n1", title: "One", views: 1, score: 0.5, done: false }]);
    const renamed = await d.update(notes).set({ title: "Uno", views: 3 }).where(eq(notes.id, "n1")).returning({ id: notes.id, views: notes.views });
    expect(renamed).toEqual([{ id: "n1", views: 3 }]);
    const [counted] = await d.select({ n: dsql<number>`count(*)` }).from(notes);
    expect(counted).toEqual({ n: 2 });
    await d.delete(notes).where(eq(notes.id, "n2"));
    expect(await d.select({ id: notes.id, score: notes.score }).from(notes)).toEqual([{ id: "n1", score: 0.5 }]);
    const sent = fake.calls.filter((c) => c.sql?.startsWith("select") && c.sql.includes('"notes"."id" = :1'));
    expect(sent.length).toBeGreaterThan(0);
  });

  it("transaction() commits through Begin/Commit and rolls back through Rollback", async () => {
    const d = db();
    await d.transaction(async (tx) => {
      await tx.insert(notes).values({ id: "t1", title: "T", views: 0, done: false });
    });
    await expect(
      d.transaction(async (tx) => {
        await tx.insert(notes).values({ id: "t2", title: "T", views: 0, done: false });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    const ids = (await d.select({ id: notes.id }).from(notes)).map((r) => r.id).sort();
    expect(ids).toEqual(["n1", "t1"]);
  });

  it("a unique violation reaches drizzle's caller with the SDK exception on the cause chain", async () => {
    const e = await rejection(db().insert(notes).values({ id: "n1", title: "Dup", views: 0, done: false }));
    const cause = (e as { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(BadRequestException);
    expect((cause as Error).message).toMatch(/SQLState: 23505$/);
  });
});
