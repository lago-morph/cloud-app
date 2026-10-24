/**
 * The AWS Lambda runtime (plan-aws G-05) driven by Lambda Function URL events (payload 2.0)
 * through the fully assembled stage: the Data API adapter on the G-F1 fake, the S3 files store
 * on the G-04 fake, SSM through a stub client, and the S3 log sink on a fetch stub. These are
 * pre-checks of the runtime's logic, never AWS evidence (plan-aws.md §2). A network guard
 * refuses any `*.amazonaws.com` connection, and each test file run asserts it saw none.
 */
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GetParameterCommand } from "@aws-sdk/client-ssm";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { defineApp, FrameworkError, requireAdmin, requireCurrentUser, requireUser } from "../../index.js";
import { createDeployment } from "../../core/identity.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { createAuthMock } from "../../auth/mock.js";
import { createS3Fake, type S3Fake } from "../../files/aws/s3-fake.test-support.js";
import { isLogEntry, type LogEntry } from "../../log/entry.js";
import { LOG_WRITE_WAIT_MS } from "../../log/aws/pending.js";
import { applyMigrations, pgliteMigrationDatabase } from "../../mig/apply.js";
import { readHistory } from "../../mig/history.js";
import { FRAMEWORK_MIGRATIONS_DIR } from "../../mig/migrations-dir.js";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import { DataApiFake, FAKE_RESOURCE_ARN, FAKE_SECRET_ARN } from "../../sql/data-api-fake.test-support.js";
import { createAwsLambdaRuntime, type AwsRuntimeDependencies, type FunctionUrlResult } from "./handler.js";
import { LAMBDA_RUNTIME_VARIABLES, LAMBDA_VARIABLES } from "./variables.js";

const APP = "awsunit";
const STAGE = "test-unit";
const ACCOUNT = "123456789012";
const REGION = "us-east-1";
const ORIGIN = "https://d111111abcdef8.cloudfront.net";
const FUNCTION_HOST = "abcdefghijklmnopqrstuvwxyz012345.lambda-url.us-east-1.on.aws";
const LOG_BUCKET = `prototype-logs-${ACCOUNT}`;
const FILES_BUCKET = `${APP}-${STAGE}-files-${ACCOUNT}`;
const CREDENTIALS = { accessKeyId: "ASIAEXAMPLEKEYID", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", sessionToken: "session-token-value" };
const SESSION_KEY = "k".repeat(43);
const API_KEY = "api-key-value-0123456789";

const V = LAMBDA_VARIABLES;
const R = LAMBDA_RUNTIME_VARIABLES;
const ENV: Record<string, string> = {
  [V.publicOrigin]: ORIGIN,
  [V.accountId]: ACCOUNT,
  [V.logBucket]: LOG_BUCKET,
  [V.filesBucket]: FILES_BUCKET,
  [V.databaseClusterArn]: FAKE_RESOURCE_ARN,
  [V.databaseSecretArn]: FAKE_SECRET_ARN,
  [V.databaseName]: "app",
  [R.region]: REGION,
  [R.accessKeyId]: CREDENTIALS.accessKeyId,
  [R.secretAccessKey]: CREDENTIALS.secretAccessKey,
  [R.sessionToken]: CREDENTIALS.sessionToken,
};

const app = defineApp({
  name: APP,
  config: {},
  secrets: ["apiKey"],
  tables: {},
  routes: (api) => {
    // The reference app's fixtures (apps/reference ROUTES.md), mirrored here so the test runs on
    // the framework's sources.
    api.get("/ref/two-cookies", (c) => {
      c.header("Set-Cookie", "refOne=1; Path=/; HttpOnly; SameSite=Lax", { append: true });
      c.header("Set-Cookie", "refTwo=2; Path=/; HttpOnly; SameSite=Lax", { append: true });
      return c.json({ cookies: ["refOne", "refTwo"] });
    });
    api.post("/ref/log", (c) => {
      c.var.log.write("APP", "warn", "from the route");
      return c.json({ requestId: c.var.requestId });
    });
    api.get("/ref/me", (c) => c.json({ user: c.var.user }));
    api.get("/ref/url", (c) => c.json({ url: c.req.url }));
    api.get("/ref/secret", async (c) => c.json({ length: (await c.var.secrets.get("apiKey")).length }));
    api.get("/ref/throw-secret-app", async (c) => {
      throw new FrameworkError("HTTP.CONFLICT", `conflict carrying ${await c.var.secrets.get("apiKey")}`);
    });
    api.get("/ref/kv", async (c) => {
      await c.var.kv.put("k", "v1");
      return c.json({ value: await c.var.kv.get("k") });
    });
    api.post("/ref/file", async (c) => {
      await c.var.files.put("notes/a.txt", new TextEncoder().encode("hello"), { contentType: "text/plain" });
      const file = await c.var.files.get("notes/a.txt");
      return c.json({ text: file === null ? null : await new Response(file.body).text() });
    });
    for (const method of ["get", "post"] as const) {
      api[method]("/levels/user", requireUser(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
      api[method]("/levels/admin", requireAdmin(), (c) => c.json({ level: c.var.user.level, id: c.var.user.id }));
    }
    api.get("/levels/current", (c) => {
      const user = requireCurrentUser(c);
      return c.json({ level: user.level, id: user.id });
    });
  },
});

function resolved(stage: string): ResolvedConfig {
  return { deployment: createDeployment({ app: APP, stage, target: "aws" }), values: {}, admins: [], secrets: [{ name: "apiKey", location: `/${APP}/${stage}/secrets/apiKey` }] };
}

// ---- Function URL events -------------------------------------------------------------------

interface EventInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly cookies?: readonly string[];
  readonly body?: string;
  readonly host?: string;
}

/** A Function URL (payload 2.0) event as AWS documents it: auth type NONE, cookies split out. */
function event(path: string, init: EventInit = {}): APIGatewayProxyEventV2 {
  const method = init.method ?? "GET";
  const host = init.host ?? FUNCTION_HOST;
  const [rawPath = path, rawQueryString = ""] = path.split("?");
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath,
    rawQueryString,
    headers: { host, "user-agent": "g05", "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7", ...init.headers },
    ...(init.cookies === undefined ? {} : { cookies: [...init.cookies] }),
    ...(init.body === undefined ? {} : { body: init.body }),
    isBase64Encoded: false,
    requestContext: {
      accountId: "anonymous",
      apiId: host.split(".")[0] ?? "",
      domainName: host,
      domainPrefix: host.split(".")[0] ?? "",
      http: { method, path: rawPath, protocol: "HTTP/1.1", sourceIp: "203.0.113.7", userAgent: "g05" },
      requestId: "c6af9ac6-7b61-11e6-9a41-93e8deadbeef",
      routeKey: "$default",
      stage: "$default",
      time: "24/Oct/2026:12:00:00 +0000",
      timeEpoch: 1792843200000,
    },
  };
}

const json = (result: FunctionUrlResult): { error?: { code: string; message: string; requestId: string } } & Record<string, unknown> =>
  JSON.parse(result.body) as { error?: { code: string; message: string; requestId: string } } & Record<string, unknown>;

// ---- Fakes -----------------------------------------------------------------------------------

let guard: AwsNetworkGuard;
let dataApi: DataApiFake;
let files: S3Fake;
const ssmCalls: string[] = [];
let parameters: Record<string, string> = {};

/** The SSM client stub: GetParameter only, `ParameterNotFound` by name as the SDK throws it. */
const ssm = {
  send: async (command: unknown) => {
    if (!(command instanceof GetParameterCommand)) throw new Error("unexpected SSM command");
    const name = command.input.Name ?? "";
    ssmCalls.push(name);
    const value = parameters[name];
    if (value === undefined) throw Object.assign(new Error("not found"), { name: "ParameterNotFound" });
    return { Parameter: { Name: name, Value: value } };
  },
};

interface LogPut {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly entry: LogEntry;
}

/** What the log bucket does with each PutObject. */
let logAnswer: (request: Request) => Promise<Response> = async () => new Response(null, { status: 200 });
const logPuts: LogPut[] = [];

/** One fetch for every runtime S3 call: the log bucket's host to the log stub, the rest to the files fake. */
const s3Fetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  if (url.hostname === `${LOG_BUCKET}.s3.${REGION}.amazonaws.com`) {
    const body = await request.clone().text();
    logPuts.push({ url: request.url, headers: Object.fromEntries(request.headers), entry: JSON.parse(body) as LogEntry });
    return logAnswer(request);
  }
  return files.fetch(request);
};

function dependencies(overrides: Partial<AwsRuntimeDependencies> = {}): AwsRuntimeDependencies {
  return { env: ENV, dataApi: () => dataApi.client, ssm: () => ssm, fetch: s3Fetch, ...overrides };
}

beforeAll(async () => {
  guard = installAwsNetworkGuard();
  dataApi = await DataApiFake.create({ databases: ["app"], defaultDatabase: "app", resourceArn: FAKE_RESOURCE_ARN, secretArn: FAKE_SECRET_ARN });
  const pg: PGlite = dataApi.pglite("app");
  await applyMigrations(pgliteMigrationDatabase(pg), { framework: readHistory(FRAMEWORK_MIGRATIONS_DIR, "postgres", "framework"), app: [] });
  files = createS3Fake({ location: { bucket: FILES_BUCKET, region: REGION, accountId: ACCOUNT }, credentials: CREDENTIALS });
}, 60_000);

afterAll(async () => {
  guard.uninstall();
  await dataApi.close();
  expect(guard.attempts).toEqual([]);
});

afterEach(() => {
  vi.useRealTimers();
  logAnswer = async () => new Response(null, { status: 200 });
  logPuts.length = 0;
  ssmCalls.length = 0;
});

function stageParameters(stage: string, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [`/${APP}/${stage}/secrets/${name}`, value]));
}

parameters = stageParameters(STAGE, { frameworkSessionKey: SESSION_KEY, apiKey: API_KEY });

const testStage = createAwsLambdaRuntime(app, resolved(STAGE), dependencies({ mock: createAuthMock() }));

const mockLogin = (level: "user" | "admin", id = "m1") =>
  event("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ level, id }) });

/** Logs in through the mock and returns the session cookie (`name=value`). */
async function login(level: "user" | "admin", id?: string): Promise<string> {
  const res = await testStage(mockLogin(level, id));
  expect(res.statusCode).toBe(204);
  const session = (res.cookies ?? []).find((c) => c.startsWith("__Host-session="));
  expect(session).toBeDefined();
  return (session ?? "").split(";")[0] ?? "";
}

/**
 * The longest `untilTrue` waits. The wait is bounded by wall time, not by a count of event-loop turns: signing
 * (WebCrypto) runs on libuv's thread pool, so under CPU load a fixed number of turns can pass before it finishes.
 * 10,000 turns lasted only 112 ms in a loaded run and failed (ai/implementation/root-causes/
 * 2026-10-24-data-api-fake-template-intermittent.md). Passing loaded runs needed at most 31 ms. 10 s leaves
 * ample headroom, still fails a condition that never holds, and stays inside these suites' 60 s timeout.
 * `performance.now()` is real time here: the tests fake only setTimeout and clearTimeout.
 */
const UNTIL_TRUE_MS = 10_000;

/** Lets real I/O (signing, PGlite) progress while timers are faked. */
async function untilTrue(condition: () => boolean): Promise<void> {
  const start = performance.now();
  while (!condition() && performance.now() - start < UNTIL_TRUE_MS) await new Promise((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}

// ---- Tests ---------------------------------------------------------------------------------

describe("AWS Lambda runtime: Function URL responses", { timeout: 60_000 }, () => {
  it(tag(["HTTP-AC-001", "AWS-AC-001"], "unit (AWS runtime, Function URL fixture): an unknown API path is a JSON 404 ErrorResponse with Cache-Control: no-store"), async () => {
    const res = await testStage(event("/api/nope"));
    expect(res.statusCode).toBe(404);
    expect(res.headers?.["content-type"]).toMatch(/^application\/json/);
    expect(res.headers?.["cache-control"]).toBe("no-store");
    expect(res.isBase64Encoded).toBe(false);
    expect(json(res).error?.code).toBe("HTTP.NOT_FOUND");
  });

  it(tag("HTTP-AC-005", "unit (AWS runtime, Function URL fixture): API responses carry Cache-Control: no-store"), async () => {
    const res = await testStage(event("/api/ref/me"));
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["cache-control"]).toBe("no-store");
    expect(json(res)).toEqual({ user: { level: "anonymous" } });
  });

  it(tag("AWS-AC-006", "unit (AWS runtime, Function URL fixture): a route setting two cookies returns both in cookies[], none folded into headers"), async () => {
    const res = await testStage(event("/api/ref/two-cookies"));
    expect(res.statusCode).toBe(200);
    expect(res.cookies).toEqual(["refOne=1; Path=/; HttpOnly; SameSite=Lax", "refTwo=2; Path=/; HttpOnly; SameSite=Lax"]);
    expect(Object.keys(res.headers ?? {}).map((k) => k.toLowerCase())).not.toContain("set-cookie");
  });

  it("serves SQL through the Data API adapter and files through the S3 store", async () => {
    expect(json(await testStage(event("/api/ref/kv")))).toEqual({ value: "v1" });
    const before = files.requests.length;
    const res = await testStage(event("/api/ref/file", { method: "POST", headers: { origin: ORIGIN } }));
    expect(json(res)).toEqual({ text: "hello" });
    const sent = files.requests.slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) {
      expect(r.headers["x-amz-expected-bucket-owner"]).toBe(ACCOUNT);
      expect(r.headers["x-amz-security-token"]).toBe(CREDENTIALS.sessionToken);
    }
    expect(dataApi.calls.some((c) => c.database === "app" && c.input.resourceArn === FAKE_RESOURCE_ARN && c.input.secretArn === FAKE_SECRET_ARN)).toBe(true);
  });

  it("answers the health check when the database reads and the stage's SSM secrets are set", async () => {
    expect((await testStage(event("/api/__framework/health"))).statusCode).toBe(204);
    expect(ssmCalls).toEqual(expect.arrayContaining([`/${APP}/${STAGE}/secrets/apiKey`, `/${APP}/${STAGE}/secrets/frameworkSessionKey`]));
  });
});

describe("AWS Lambda runtime: the public origin comes from the environment, never Host (AWS-REQ-004)", { timeout: 60_000 }, () => {
  it(tag(["AWS-AC-004", "AUTH-AC-007"], "unit (AWS runtime, Function URL fixture): a spoofed Host does not become the origin; a POST with a session is checked against FRAMEWORK_PUBLIC_ORIGIN"), async () => {
    const session = await login("user");
    const spoofed = "evil.example";
    // The adapter builds the request URL from Host / domainName, so the app sees the spoofed host...
    expect(json(await testStage(event("/api/ref/url", { host: spoofed })))).toEqual({ url: `https://${spoofed}/api/ref/url` });
    // ...but the forgery check compares Origin with the configured public origin only.
    for (const origin of [`https://${spoofed}`, `https://${FUNCTION_HOST}`, undefined]) {
      const headers = origin === undefined ? {} : { origin };
      const res = await testStage(event("/api/levels/user", { method: "POST", host: spoofed, cookies: [session], headers }));
      expect(res.statusCode, String(origin)).toBe(403);
      expect(json(res).error?.code).toBe("AUTH.REQUEST_FORGERY");
    }
    const ok = await testStage(event("/api/levels/user", { method: "POST", host: spoofed, cookies: [session], headers: { origin: ORIGIN } }));
    expect(ok.statusCode).toBe(200);
    expect(json(ok)).toEqual({ level: "user", id: "m1" });
  });

  it("without FRAMEWORK_PUBLIC_ORIGIN a checked request fails with CORE.MISCONFIGURED instead of trusting Host", async () => {
    const { [V.publicOrigin]: _removed, ...withoutOrigin } = ENV;
    const handler = createAwsLambdaRuntime(app, resolved(STAGE), dependencies({ env: withoutOrigin, mock: createAuthMock() }));
    const session = await login("user");
    const res = await handler(event("/api/levels/user", { method: "POST", cookies: [session], headers: { origin: `https://${FUNCTION_HOST}` } }));
    expect(json(res).error?.code).toBe("CORE.MISCONFIGURED");
  });
});

describe("AWS Lambda runtime: authentication guards at the Function URL", { timeout: 60_000 }, () => {
  it(tag(["AUTH-AC-004", "AWS-AC-004"], "unit (AWS runtime, Function URL fixture): protected routes answer 401 anonymous and 403 below the level; requireCurrentUser throws AUTH.UNAUTHENTICATED when anonymous"), async () => {
    for (const path of ["/api/levels/user", "/api/levels/admin", "/api/levels/current"]) {
      const res = await testStage(event(path));
      expect(res.statusCode, path).toBe(401);
      expect(json(res).error?.code).toBe("AUTH.UNAUTHENTICATED");
    }
    const user = await login("user", "u1");
    expect(json(await testStage(event("/api/levels/user", { cookies: [user] })))).toEqual({ level: "user", id: "u1" });
    expect(json(await testStage(event("/api/levels/current", { cookies: [user] })))).toEqual({ level: "user", id: "u1" });
    const forbidden = await testStage(event("/api/levels/admin", { cookies: [user] }));
    expect(forbidden.statusCode).toBe(403);
    expect(json(forbidden).error?.code).toBe("AUTH.FORBIDDEN");
    const admin = await login("admin", "a1");
    expect(json(await testStage(event("/api/levels/admin", { cookies: [admin] })))).toEqual({ level: "admin", id: "a1" });
    expect(json(await testStage(event("/api/levels/user", { cookies: [admin] })))).toEqual({ level: "admin", id: "a1" });
  });

  it(tag("AUTH-AC-006", "unit (AWS runtime, Function URL fixture): the session cookie is __Host-session, HttpOnly, Secure, SameSite=Lax, Path=/, host-only; a tampered cookie is anonymous; logout clears it"), async () => {
    const res = await testStage(mockLogin("user"));
    const cookie = (res.cookies ?? []).find((c) => c.startsWith("__Host-session=")) ?? "";
    expect(cookie).toMatch(/; Path=\/(;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; Secure(;|$)/);
    expect(cookie.toLowerCase()).not.toContain("domain=");
    const session = cookie.split(";")[0] ?? "";
    expect(json(await testStage(event("/api/ref/me", { cookies: [session] })))).toEqual({ user: { level: "user", id: "m1", displayName: null } });
    const tampered = `${session.slice(0, -3)}${session.at(-3) === "A" ? "B" : "A"}${session.slice(-2)}`;
    expect(json(await testStage(event("/api/ref/me", { cookies: [tampered] })))).toEqual({ user: { level: "anonymous" } });
    const out = await testStage(event("/api/auth/logout", { method: "POST", cookies: [session], headers: { origin: ORIGIN } }));
    const cleared = (out.cookies ?? []).find((c) => c.startsWith("__Host-session=")) ?? "";
    expect(cleared).toMatch(/^__Host-session=; /);
    expect(cleared).toMatch(/Max-Age=0/);
  });

  it(tag("AUTH-AC-009", "unit (AWS runtime, Function URL fixture): mock-login works on a test stage and is 404 on a production stage"), async () => {
    expect((await testStage(mockLogin("user"))).statusCode).toBe(204);
    parameters = { ...parameters, ...stageParameters("prod", { frameworkSessionKey: SESSION_KEY, frameworkGoogleClientSecret: "g".repeat(20), apiKey: API_KEY }) };
    const production = createAwsLambdaRuntime(app, resolved("prod"), dependencies());
    const res = await production(mockLogin("user"));
    expect(res.statusCode).toBe(404);
    expect(json(res).error?.code).toBe("HTTP.NOT_FOUND");
  });

  it("a production stage given the mock fails with CORE.MISCONFIGURED", async () => {
    const production = createAwsLambdaRuntime(app, resolved("prod"), dependencies({ mock: createAuthMock() }));
    expect(json(await production(event("/api/ref/me"))).error?.code).toBe("CORE.MISCONFIGURED");
  });
});

describe("AWS Lambda runtime: secrets", { timeout: 60_000 }, () => {
  it(tag("SEC-AC-001", "unit (AWS runtime, Function URL fixture): a declared secret is the stage's SSM parameter, read per request"), async () => {
    expect(json(await testStage(event("/api/ref/secret")))).toEqual({ length: API_KEY.length });
    expect(ssmCalls).toContain(`/${APP}/${STAGE}/secrets/apiKey`);
  });

  it(tag("SEC-AC-002", "unit (AWS runtime, Function URL fixture): a secret value read by the request is redacted from the error response and the stored log entries"), async () => {
    const res = await testStage(event("/api/ref/throw-secret-app"));
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain(API_KEY);
    expect(json(res).error?.message).toContain("[redacted]");
    const plain = defineApp({
      name: APP,
      config: {},
      secrets: ["apiKey"],
      tables: {},
      routes: (api) => {
        api.get("/leak", async (c) => {
          throw new Error(`leaking ${await c.var.secrets.get("apiKey")}`);
        });
      },
    });
    const leaky = createAwsLambdaRuntime(plain, resolved(STAGE), dependencies());
    const failed = await leaky(event("/api/leak"));
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain(API_KEY);
    expect(logPuts.length).toBeGreaterThan(0);
    for (const put of logPuts) expect(JSON.stringify(put.entry)).not.toContain(API_KEY);
  });
});

describe("AWS Lambda runtime: log writes", { timeout: 60_000 }, () => {
  it(tag(["LOG-AC-002", "LOG-AC-004"], "unit (AWS runtime, Function URL fixture): an entry is one PutObject to the shared log bucket under the LOG-REQ-004 key, with the expected owner, finished before the handler returns"), async () => {
    const res = await testStage(event("/api/ref/log", { method: "POST" }));
    expect(res.statusCode).toBe(200);
    const { requestId } = json(res) as { requestId: string };
    const puts = logPuts.filter((p) => p.entry.requestId === requestId);
    expect(puts).toHaveLength(1);
    const put = puts[0]!;
    expect(isLogEntry(put.entry)).toBe(true);
    expect(put.entry).toMatchObject({ app: APP, stage: STAGE, target: "aws", component: "APP", severity: "warn", message: "from the route" });
    expect(new URL(put.url).pathname).toMatch(new RegExp(`^/${APP}/${STAGE}/\\d{4}/\\d{2}/\\d{2}/\\d{6}\\.\\d{3}-warn-${requestId}\\.json$`));
    expect(put.headers["x-amz-expected-bucket-owner"]).toBe(ACCOUNT);
    expect(put.headers["x-amz-security-token"]).toBe(CREDENTIALS.sessionToken);
  });

  it("the handler returns only once a pending log write has finished", async () => {
    let release: () => void = () => undefined;
    logAnswer = () => new Promise<Response>((resolve) => (release = () => resolve(new Response(null, { status: 200 }))));
    let done = false;
    const pending = testStage(event("/api/ref/log", { method: "POST" })).then((r) => {
      done = true;
      return r;
    });
    await untilTrue(() => logPuts.length === 1);
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);
    release();
    expect((await pending).statusCode).toBe(200);
  });

  it(tag("LOG-AC-001", "unit (AWS runtime, Function URL fixture, fake timers): a log write that never completes delays the response by exactly PAR-260, then is abandoned"), async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    logAnswer = () => new Promise<Response>(() => undefined);
    let done = false;
    const pending = testStage(event("/api/ref/log", { method: "POST" })).then((r) => {
      done = true;
      return r;
    });
    await untilTrue(() => logPuts.length === 1 && vi.getTimerCount() > 0);
    await vi.advanceTimersByTimeAsync(LOG_WRITE_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await untilTrue(() => done);
    expect((await pending).statusCode).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it(tag("LOG-AC-001", "unit (AWS runtime, Function URL fixture): with PutObject denied (403 AccessDenied) the request still succeeds"), async () => {
    logAnswer = async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    const res = await testStage(event("/api/ref/log", { method: "POST" }));
    expect(res.statusCode).toBe(200);
    expect(logPuts).toHaveLength(1);
  });

  it("without the log bucket variable entries are printed as marked output lines and no PutObject is sent", async () => {
    const { [V.logBucket]: _removed, ...withoutLogs } = ENV;
    const print = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const handler = createAwsLambdaRuntime(app, resolved(STAGE), dependencies({ env: withoutLogs }));
      expect((await handler(event("/api/ref/log", { method: "POST" }))).statusCode).toBe(200);
      expect(print.mock.calls.some(([line]) => String(line).startsWith("[prototype-framework:log]"))).toBe(true);
      expect(logPuts).toHaveLength(0);
    } finally {
      print.mockRestore();
    }
  });
});
