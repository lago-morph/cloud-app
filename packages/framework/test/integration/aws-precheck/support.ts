/**
 * AWS pre-check support (plan-aws G-T3). PRE-CHECK, NOT EVIDENCE: these suites run shared case
 * sets through the real AWS adapters over in-process fakes (the RDS Data API fake, G-F1; the S3
 * fake, G-04). A pass here says the adapter agrees with the fake, not with AWS (sql.md §2 "Local":
 * "Neither proves Data API behavior"; plan-aws §2). The suites carry no criterion IDs, so the
 * traceability generator and the release check never count them.
 *
 * No AWS call is made: every client gets a fake, and `guardAwsNetwork` fails the file if a
 * request to `*.amazonaws.com` is attempted.
 *
 * Load only after the entry file has selected the Postgres dialect and pointed
 * `@lago-morph/prototype-framework` at the sources (see sql.data-api.test.ts): the reference
 * app's cases and the adapters must share one `FrameworkError` class.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect } from "vitest";
import { ERROR_CATALOGUE, FrameworkError, type FilesService, type KvService, type LogService, type PortableDb } from "../../../src/index.js";
import { createFilesService } from "../../../src/files/service.js";
import { createS3Fake } from "../../../src/files/aws/s3-fake.test-support.js";
import { createS3FilesStore } from "../../../src/files/aws/store.js";
import { createAwsTicketIssuer } from "../../../src/files/aws/tickets.js";
import { createKv } from "../../../src/kv/service.js";
import { migrateLocal, pgliteMigrationDatabase } from "../../../src/mig/apply.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../../src/provision/aws/aws-network-guard.test-support.js";
import { DataApiFake, FAKE_RESOURCE_ARN, FAKE_SECRET_ARN } from "../../../src/sql/data-api-fake.test-support.js";
import { dataApiDb } from "../../../src/sql/data-api.js";
import type { CaseResult, CaseRunner, Place } from "../../../../../tests/compliance/criteria/sql/support/runner.js";
import type { FilesCaseHost } from "../files/server-operations.cases.js";

/** In every describe title of these suites. */
export const NOT_EVIDENCE = "pre-check, not evidence";

/** The runner's place, shown in the shared suites' describe and test titles. */
export const DATA_API_PLACE = `AWS Data API adapter over the Data API fake, ${NOT_EVIDENCE}` as unknown as Place;

/** Installs the AWS network guard for the file; the file fails if any AWS host was attempted. */
export function guardAwsNetwork(): void {
  let guard: AwsNetworkGuard | undefined;
  beforeAll(() => {
    guard = installAwsNetworkGuard();
  });
  afterAll(() => {
    const attempts = guard?.attempts ?? [];
    guard?.uninstall();
    expect(attempts, "AWS hosts a pre-check tried to reach").toEqual([]);
  });
}

// ---- SQL and KV: the reference app's case sets through the Data API adapter -------------

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const REFERENCE = path.join(root, "apps/reference");

type CaseServices = { sql: PortableDb; kv: KvService; files: FilesService; log: LogService };
type Case = (services: CaseServices, input: unknown) => Promise<unknown>;

/** Loaded by path so that the framework typecheck does not compile the reference app. */
async function caseSet(set: "sql" | "kv"): Promise<Readonly<Record<string, Case>>> {
  const module = pathToFileURL(path.join(REFERENCE, `src/server/cases/${set}.ts`)).href;
  const loaded = (await import(/* @vite-ignore */ module)) as Record<string, Readonly<Record<string, Case>>>;
  const cases = loaded[`${set}Cases`];
  if (cases === undefined) throw new Error(`the reference app's ${set} case set was not found`);
  return cases;
}

const noFiles = new Proxy({} as FilesService, {
  get: (_t, operation) => () => Promise.reject(new Error(`the SQL/KV pre-check has no FILES (${String(operation)})`)),
});

/**
 * The answer `POST /api/cases/run` would give, without HTTP: the value through JSON, or the
 * catalogue status and code of a `FrameworkError`. Any other error is what the framework's error
 * handler makes of it (500 CORE.INTERNAL); its name and message go into `describe` so a failure
 * shows the adapter's own error.
 */
async function answer(place: string, set: string, name: string, run: () => Promise<unknown>): Promise<CaseResult> {
  const describe = `${place}: case ${set}/${name}`;
  try {
    const value = await run();
    if (value === undefined) return { status: 200, outcome: "undefined", describe };
    return { status: 200, outcome: "value", value: JSON.parse(JSON.stringify(value)) as unknown, describe };
  } catch (thrown) {
    if (thrown instanceof FrameworkError) return { status: ERROR_CATALOGUE[thrown.code].status ?? 500, code: thrown.code, describe: `${describe} (${thrown.message})` };
    const what = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
    return { status: 500, code: "CORE.INTERNAL", describe: `${describe} (not a framework error: ${what})` };
  }
}

/**
 * A `CaseRunner` for the compliance suites: one Data API fake cluster with one database holding
 * the framework's and the reference app's Postgres migrations (applied to the fake's PGlite
 * directly: setup, not the adapter under test), and the reference app's cases run with `sql`
 * from `dataApiDb` and `kv` from `createKv` over a second `dataApiDb` handle, as a stage wires them.
 */
export async function dataApiCaseRunner(): Promise<CaseRunner> {
  const database = "precheck";
  const fake = await DataApiFake.create({ databases: [database], defaultDatabase: database, resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN });
  try {
    await migrateLocal(pgliteMigrationDatabase(fake.pglite(database)), path.join(REFERENCE, "migrations"));
    const target = { resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN, database };
    const entries: string[] = [];
    const log: LogService = { write: (component, severity, message) => void entries.push(`${component} ${severity} ${message}`) };
    const services: CaseServices = { sql: dataApiDb(fake.client, target, { log }), kv: createKv(dataApiDb(fake.client, target), { log }), files: noFiles, log };
    const sets = { sql: await caseSet("sql"), kv: await caseSet("kv") };
    return {
      place: DATA_API_PLACE,
      run(set, name, input) {
        const run = (sets as Record<string, Readonly<Record<string, Case>> | undefined>)[set]?.[name];
        if (run === undefined) return Promise.resolve({ status: 404, code: "HTTP.NOT_FOUND", describe: `no case ${set}/${name}` });
        return answer(DATA_API_PLACE, set, name, () => run(services, input));
      },
      async dispose() {
        // Harness check: the cases really went through the Data API (not some other handle).
        const statements = fake.calls.filter((c) => c.command === "ExecuteStatement" && c.database === database).length;
        await fake.close();
        if (statements === 0) throw new Error("no ExecuteStatement reached the Data API fake: the cases did not run through dataApiDb");
      },
    };
  } catch (error) {
    await fake.close();
    throw error;
  }
}

// ---- FILES: the shared server-operation cases through the S3 store -----------------------

/** Dummy identifiers and per-run credentials; never real ones. */
const location = { bucket: "app-test-precheck-files", region: "us-east-1", accountId: "123456789012" };
const credentials = {
  accessKeyId: `ASIA${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
  secretAccessKey: crypto.randomUUID(),
  sessionToken: crypto.randomUUID(),
};

/** Each app is a fresh S3 fake bucket with the AWS store and ticket issuer over it. */
export const s3FilesHost: FilesCaseHost<FilesService> = {
  newApp() {
    const fake = createS3Fake({ location, credentials });
    const store = createS3FilesStore({ location, credentials: () => credentials, fetch: fake.fetch });
    return Promise.resolve(createFilesService({ store, tickets: createAwsTicketIssuer({ location, credentials: () => credentials }) }));
  },
  withFiles: (files, scenario) => scenario(files),
  async errorOf(files, scenario) {
    try {
      await scenario(files);
    } catch (error) {
      return error;
    }
    throw new Error("expected the operation to throw");
  },
};
