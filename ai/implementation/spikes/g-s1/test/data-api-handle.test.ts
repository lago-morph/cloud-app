/**
 * Q4 runtime check (beyond the type-level spike): queries built on the portable handle go
 * through drizzle's Data API session to an RDSDataClient mocked with aws-sdk-client-mock.
 * The client has a fake endpoint and fake credentials; a real request would fail the test.
 */
import {
  DatabaseErrorException,
  DatabaseResumingException,
  ExecuteStatementCommand,
  RDSDataClient,
} from "@aws-sdk/client-rds-data";
import { mockClient } from "aws-sdk-client-mock";
import { eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vitest";
import { dataApiDb } from "../src/data-api.js";

const kv = pgTable("__framework_kv", { key: text("key").primaryKey(), value: text("value").notNull() });
const target = {
  resourceArn: "arn:aws:rds:us-east-1:111122223333:cluster:spike",
  secretArn: "arn:aws:secretsmanager:us-east-1:111122223333:secret:spike",
  database: "app",
};

function client(): RDSDataClient {
  return new RDSDataClient({
    region: "us-east-1",
    endpoint: "https://data-api.invalid",
    credentials: { accessKeyId: "AKIDSPIKE", secretAccessKey: "spike" },
    maxAttempts: 1,
  });
}

const mock = mockClient(RDSDataClient);
afterEach(() => mock.reset());

describe("aws-data-api/pg behind portableHandle", () => {
  it("runs a select through the guard and maps records to rows", async () => {
    mock.on(ExecuteStatementCommand).resolves({ records: [[{ stringValue: "k1" }, { stringValue: "v1" }]] });
    const db = dataApiDb(client(), target) as unknown as {
      select(): { from(t: unknown): { where(c: unknown): Promise<unknown> } };
    };
    const rows = await db.select().from(kv).where(eq(kv.key, "k1"));
    expect(rows).toEqual([{ key: "k1", value: "v1" }]);
    const input = mock.commandCalls(ExecuteStatementCommand)[0]?.args[0].input;
    expect(input).toMatchObject({ resourceArn: target.resourceArn, secretArn: target.secretArn, database: "app" });
    expect(input?.sql).toBe('select "key", "value" from "__framework_kv" where "__framework_kv"."key" = :1');
    expect(input?.parameters).toEqual([{ name: "1", value: { stringValue: "k1" } }]);
  });

  it("an insert without returning resolves to undefined (SQL-REQ-004)", async () => {
    mock.on(ExecuteStatementCommand).resolves({ numberOfRecordsUpdated: 1 });
    const db = dataApiDb(client(), target) as unknown as {
      insert(t: unknown): { values(v: unknown): Promise<unknown> };
    };
    await expect(db.insert(kv).values({ key: "a", value: "b" })).resolves.toBeUndefined();
  });

  it("DatabaseResumingException is distinguishable by name (input for the G-item retry loop)", async () => {
    mock.on(ExecuteStatementCommand).rejects(new DatabaseResumingException({ message: "resuming", $metadata: {} }));
    const db = dataApiDb(client(), target) as unknown as { select(): { from(t: unknown): Promise<unknown> } };
    // Today's guard has no resume retry: it normalizes the driver error. Record what comes out.
    const error = await db.select().from(kv).then(
      () => undefined,
      (e: unknown) => e as { name?: string; code?: string; message?: string; cause?: unknown },
    );
    expect(error?.name).toBe("FrameworkError");
    // Observed: CORE.INTERNAL "database error: resuming"; the SDK exception is on the cause chain.
    expect(error?.code).toBe("CORE.INTERNAL");
    const names: string[] = [];
    for (let e: unknown = error?.cause; typeof e === "object" && e !== null; e = (e as { cause?: unknown }).cause) {
      names.push((e as { name?: string }).name ?? "?");
    }
    expect(names).toContain("DatabaseResumingException");
    console.log("cause chain:", names.join(" -> "));
  });

  it("a Data API constraint error has no pg `code` field: today's guard does not map it to SQL.CONFLICT", async () => {
    // Message shape as the Data API reports PostgreSQL errors (SQLState in the text). To be
    // confirmed live; the AWS adapter must map SQLState 23505/23503 itself.
    mock.on(ExecuteStatementCommand).rejects(
      new DatabaseErrorException({
        message: 'ERROR: duplicate key value violates unique constraint "__framework_kv_pkey"\n  Detail: Key (key)=(a) already exists.; SQLState: 23505',
        $metadata: {},
      }),
    );
    const db = dataApiDb(client(), target) as unknown as { insert(t: unknown): { values(v: unknown): Promise<unknown> } };
    await expect(db.insert(kv).values({ key: "a", value: "b" })).rejects.toMatchObject({ code: "CORE.INTERNAL" });
  });
});
