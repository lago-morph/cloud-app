/**
 * `createTestApp` (testing.d.ts; core.md §2 "Testing"): the app in the test runner's own Node
 * process, over fresh local storage — local D1 and R2 through Wrangler's `getPlatformProxy`
 * (DEC-0105), or PGlite for SQL when the process runs the Postgres dialect
 * (`PROTOTYPE_FRAMEWORK_DIALECT=postgres`) — with migrations applied and the local target's
 * runtime (the same stage runtime the local Worker uses), the authentication mock, the stub
 * login provider or the password provider (PWD) with an in-memory outbox, and an in-memory log.
 * Node only; never part of a Worker bundle.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleD1, type AnyD1Database } from "drizzle-orm/d1";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { RuntimeEnv } from "../core/assemble.js";
import { createDeployment } from "../core/identity.js";
import type { DefinedApp } from "../core/public.js";
import type { ConfigDeclaration } from "../config/public.js";
import { resolveConfig, type ResolvedConfig } from "../config/resolve.js";
import { parseStageConfig } from "../config/schema.js";
import { secretLocation } from "../config/secret-locations.js";
import { createAuthMock } from "../auth/mock.js";
import { LOCAL_COOKIES } from "../auth/local-cookies.js";
import { createStubLoginProvider, stubCallbackUrl, type StubFailure } from "../auth/stub-provider.js";
import type { CurrentUser } from "../auth/public.js";
import { createPasswordProvider } from "../auth/password/provider.js";
import type { PasswordDatabase } from "../auth/password/options.js";
import { createOutbox, failingMailSender, neverCompletingMailSender, type TestMail } from "./test-outbox.js";
import { appUrl } from "./connect.js";
import { checkSecretDeclarations, FRAMEWORK_SECRETS } from "../secrets/names.js";
import { LOCAL_FRAMEWORK_SECRETS, LOCAL_TICKET_KEY } from "../secrets/local-names.js";
import { envSecretReader, type SecretReader } from "../secrets/service.js";
import { createMemorySink } from "../log/memory.js";
import { failingSink, neverCompletingSink } from "../log/test-sinks.js";
import type { LogEntry } from "../log/entry.js";
import { processDialect } from "../sql/dialect.js";
import { sqliteDb } from "../sql/d1.js";
import { openPostgres, postgresDb } from "../sql/postgres.js";
import type { AnyTable } from "../sql/types.js";
import { d1MigrationDatabase, migrateLocal, pgliteMigrationDatabase, type D1Like } from "../mig/apply.js";
import { generateAppMigrations } from "../mig/generate.js";
import type { FilesStore } from "../files/service.js";
import { createLocalTicketIssuer } from "../files/local/tickets.js";
import { registerLocalTransferRoute } from "../files/local/route.js";
import { assembleStage } from "../targets/stage.js";
import { startPlatformProxy } from "../targets/local/platform-proxy.js";

/** Options for `createTestApp` (testing.d.ts). */
export interface TestAppOptions {
  /** Identity for every request; default anonymous (a session from mock-login then decides). */
  readonly user?: CurrentUser;
  /** Config values overriding the app's defaults; the reserved key `framework` holds the stage's `framework` section. */
  readonly config?: Record<string, unknown>;
  /** Secret values for the test, by logical name. */
  readonly secrets?: Record<string, string>;
  /** Capabilities that fail as unavailable: every operation of each one named throws its `*.UNAVAILABLE` code. */
  readonly unavailable?: readonly ("sql" | "kv" | "files" | "secrets")[];
  /** Use the test-only stub login provider instead of the authentication mock. Default false. */
  readonly stubLoginProvider?: boolean;
  /**
   * Use the real email-and-password login provider (password.md) with the in-memory outbox,
   * instead of the authentication mock; its rate limits and origin check are on. Mutually
   * exclusive with `stubLoginProvider`. Default false.
   */
  readonly passwordLoginProvider?: boolean;
  /** For MAIL's own tests: a mail sender whose every send fails, or whose sends never complete. Default the outbox. */
  readonly mailSender?: "failing" | "never-completing";
  /** LOG-AC-001: a log writer that fails on every write, or whose writes never complete (DEC-0210). */
  readonly logWriter?: "failing" | "never-completing";
}

export type { MailMessage, TestMail } from "./test-outbox.js";

export interface TestApp {
  request(path: string, init?: RequestInit): Promise<Response>;
  /** The framework's outgoing email: the in-memory outbox of this test app. */
  readonly mail: TestMail;
  as(user: CurrentUser): TestApp;
  logs(): readonly LogEntry[];
  loginWithStub(subject: string, options?: { readonly displayName?: string; readonly stubFailure?: "refused" | "replayed" }): Promise<void>;
  dispose(): Promise<void>;
}

/** The test app's public origin: state-changing requests carry it in `Origin`. */
export const TEST_APP_ORIGIN = "http://localhost:8787";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

let proxyConfig: string | undefined;

/** A wrangler.jsonc declaring the local D1 (`DB`) and R2 (`FILES`) bindings, written once per process. */
function proxyConfigPath(): string {
  if (proxyConfig !== undefined && existsSync(proxyConfig)) return proxyConfig;
  const dir = join(tmpdir(), `prototype-framework-test-app-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  proxyConfig = join(dir, "wrangler.jsonc");
  writeFileSync(
    proxyConfig,
    JSON.stringify({
      name: "test-app",
      compatibility_date: "2026-10-01",
      d1_databases: [{ binding: "DB", database_name: "test-app", database_id: "00000000-0000-0000-0000-000000000000" }],
      r2_buckets: [{ binding: "FILES", bucket_name: "test-app" }],
    }),
  );
  return proxyConfig;
}

/** Generated migrations for app definitions run without committed ones, per process. */
const generated = new WeakMap<object, Promise<string>>();

/**
 * The app's migrations directory: `<cwd>/migrations` when it holds this dialect's history
 * (an app's tests run from the app root, DEC-0192); otherwise, for an app with
 * tables, a history generated once from the table definitions into a temporary directory.
 */
async function appMigrationsDir(defined: DefinedApp<ConfigDeclaration, string>, dialect: string): Promise<string> {
  const committed = join(process.cwd(), "migrations");
  const tables = defined.definition.tables as Readonly<Record<string, AnyTable>>;
  if (existsSync(join(committed, dialect)) || Object.keys(tables).length === 0) return committed;
  let dir = generated.get(defined.definition);
  if (dir === undefined) {
    dir = (async () => {
      const root = mkdtempSync(join(tmpdir(), "prototype-framework-test-migrations-"));
      process.once("exit", () => rmSync(root, { recursive: true, force: true }));
      await generateAppMigrations(root, tables);
      return join(root, "migrations");
    })();
    generated.set(defined.definition, dir);
  }
  return dir;
}

function resolveTestConfig(defined: DefinedApp<ConfigDeclaration, string>, deployment: ReturnType<typeof createDeployment>, config: Record<string, unknown>): ResolvedConfig {
  const { framework, ...values } = config;
  const file = "createTestApp options.config";
  const stage = parseStageConfig(JSON.stringify({ values, framework: framework ?? {} }), file);
  return resolveConfig({ deployment, declaration: defined.definition.config, secrets: defined.definition.secrets, file, config: stage });
}

/** A store whose every operation fails, for `unavailable: ["files"]`. */
function unreachableStore(): FilesStore {
  const fail = async (): Promise<never> => {
    throw new Error("local file storage is unavailable (forced for this test app)");
  };
  return { put: fail, get: fail, head: fail, delete: fail, list: fail };
}

function randomKey(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function cookiePairs(res: Response): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) pairs.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return pairs;
}

interface Shared {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly fixed: WeakMap<Request, CurrentUser>;
  readonly logs: () => readonly LogEntry[];
  readonly mail: TestMail;
  /** The app has no authentication mock (stub or password provider): `as` throws. */
  readonly noMock: "stub" | "password" | undefined;
  readonly stub: boolean;
  session: string | undefined;
  disposed: boolean;
  readonly dispose: () => Promise<void>;
}

function testApp(shared: Shared, user: CurrentUser | undefined): TestApp {
  const self: TestApp = {
    async request(path, init = {}) {
      if (shared.disposed) throw new Error("this test app was disposed");
      const url = appUrl(path, TEST_APP_ORIGIN);
      const headers = new Headers(init.headers);
      const method = (init.method ?? "GET").toUpperCase();
      if (!SAFE_METHODS.has(method) && !headers.has("origin")) headers.set("origin", TEST_APP_ORIGIN);
      if (shared.session !== undefined && !headers.has("cookie")) headers.set("cookie", shared.session);
      const body = init.body;
      const request = new Request(url, {
        ...init,
        headers,
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
      if (user !== undefined) shared.fixed.set(request, user);
      return shared.fetch(request);
    },
    mail: shared.mail,
    as(next) {
      if (shared.noMock !== undefined) throw new Error(`as() needs the authentication mock; this test app uses the ${shared.noMock} login provider`);
      return testApp(shared, next);
    },
    logs: () => shared.logs(),
    async loginWithStub(subject, options = {}) {
      if (!shared.stub) throw new Error("loginWithStub needs createTestApp(app, { stubLoginProvider: true })");
      const begin = await self.request("/api/auth/login");
      const location = begin.headers.get("location");
      if (begin.status !== 302 || location === null) throw new Error(`stub login: /api/auth/login answered ${begin.status} without a redirect`);
      const transaction = [...cookiePairs(begin)].filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");
      const failure: StubFailure | undefined = options.stubFailure;
      const callback = new URL(
        stubCallbackUrl(new URL(location, TEST_APP_ORIGIN).toString(), {
          subject,
          ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
          ...(failure === undefined ? {} : { failure }),
        }),
      );
      const done = await self.request(`${callback.pathname}${callback.search}`, { headers: { cookie: transaction } });
      const name = LOCAL_COOKIES.session;
      const session = cookiePairs(done).get(name);
      if (session === undefined || session === "") {
        throw new Error(`stub login as ${JSON.stringify(subject)} failed: redirected to ${done.headers.get("location") ?? "(none)"}`);
      }
      shared.session = `${name}=${session}`;
    },
    dispose: () => shared.dispose(),
  };
  return self;
}

export async function createTestApp<C extends ConfigDeclaration, S extends string>(app: DefinedApp<C, S>, options: TestAppOptions = {}): Promise<TestApp> {
  const defined = app as unknown as DefinedApp<ConfigDeclaration, string>;
  const deployment = createDeployment({ app: defined.definition.name, stage: "local", target: "local" });
  checkSecretDeclarations(defined.definition.secrets);
  const resolved = resolveTestConfig(defined, deployment, options.config ?? {});
  const unavailable = new Set(options.unavailable ?? []);
  const stub = options.stubLoginProvider === true;
  const password = options.passwordLoginProvider === true;
  if (stub && password) throw new Error("stubLoginProvider and passwordLoginProvider cannot be combined");
  if (stub && options.user !== undefined) throw new Error("the user option needs the authentication mock; it cannot be combined with stubLoginProvider");
  if (password && options.user !== undefined) throw new Error("the user option needs the authentication mock; it cannot be combined with passwordLoginProvider");

  const dialect = processDialect();
  // Outside the dev registry; guarded by "createTestApp and the dev registry" in test-app.unit.test.ts.
  const proxy = await startPlatformProxy<{ DB: AnyD1Database & D1Like; FILES: FilesStore }>(proxyConfigPath());
  let pg: PGlite | undefined;
  try {
    if (dialect === "postgres") pg = await openPostgres();
    const migrations = await appMigrationsDir(defined, dialect);
    await migrateLocal(pg === undefined ? d1MigrationDatabase(proxy.env.DB) : pgliteMigrationDatabase(pg), migrations);
  } catch (error) {
    await pg?.close();
    await proxy.dispose();
    throw error;
  }

  // Secret store: the Worker env form (`SECRET_<NAME>`), with fresh framework keys per app.
  const secretEnv: Record<string, string> = {
    [secretLocation("local", FRAMEWORK_SECRETS.sessionKey)]: randomKey(),
    [secretLocation("local", FRAMEWORK_SECRETS.authSecret)]: randomKey(),
    [secretLocation("local", LOCAL_TICKET_KEY)]: randomKey(),
  };
  for (const [name, value] of Object.entries(options.secrets ?? {})) secretEnv[secretLocation("local", name)] = value;
  const frameworkReader = envSecretReader(secretEnv, "local");
  const appReader: SecretReader = unavailable.has("secrets")
    ? async () => {
        throw new Error("the local secret store is unavailable (forced for this test app)");
      }
    : frameworkReader;
  const ticketKey = async (): Promise<string> => (await frameworkReader(LOCAL_TICKET_KEY)) ?? "";

  const memory = createMemorySink();
  const sink = options.logWriter === "failing" ? failingSink() : options.logWriter === "never-completing" ? neverCompletingSink() : memory.sink;
  const fixed = new WeakMap<Request, CurrentUser>();
  const env = proxy.env as unknown as RuntimeEnv["Bindings"];
  const store = unavailable.has("files") ? unreachableStore() : proxy.env.FILES;
  const outbox = createOutbox({ senderName: defined.definition.name });
  const mailSender = options.mailSender === "failing" ? failingMailSender() : options.mailSender === "never-completing" ? neverCompletingMailSender() : outbox.sender;
  // The request's background tasks (`waitUntil`): sends run after the response, as on a Worker.
  const executionCtx = { waitUntil: (pending: Promise<unknown>) => void pending.catch(() => undefined), passThroughOnException: () => undefined, props: {} };
  // PWD's database: BA's Drizzle adapter over the same local D1 or PGlite as the app.
  const passwordDatabase: PasswordDatabase = pg === undefined ? { dialect: "sqlite", db: drizzleD1(proxy.env.DB) } : { dialect: "postgres", db: drizzlePglite(pg) };
  const sqlUnavailable = unavailable.has("sql");
  const kvUnavailable = sqlUnavailable || unavailable.has("kv");

  const hono = assembleStage(defined, {
    resolved,
    sink,
    publicOrigin: () => TEST_APP_ORIGIN,
    sql: (_env, log) =>
      pg === undefined
        ? { sql: sqliteDb(proxy.env.DB, { unavailable: sqlUnavailable, log }), kv: sqliteDb(proxy.env.DB, { unavailable: kvUnavailable }) }
        : { sql: postgresDb(pg, { unavailable: sqlUnavailable, log }), kv: postgresDb(pg, { unavailable: kvUnavailable }) },
    store: () => store,
    tickets: () => createLocalTicketIssuer({ key: ticketKey }),
    readSecret: () => appReader,
    readFrameworkSecret: () => frameworkReader,
    secretValues: () => Object.values(secretEnv),
    requiredFrameworkSecrets: [FRAMEWORK_SECRETS.sessionKey, FRAMEWORK_SECRETS.authSecret, ...LOCAL_FRAMEWORK_SECRETS],
    cookies: LOCAL_COOKIES,
    ...(stub
      ? { provider: createStubLoginProvider() }
      : password
        ? { credentialProvider: (c) => createPasswordProvider({ database: passwordDatabase, log: c.var.log, mail: mailSender }) }
        : { mock: createAuthMock({ fixedUser: (c) => fixed.get(c.req.raw) }) }),
    routes: (api) => registerLocalTransferRoute(api, { key: ticketKey }),
  });

  const shared: Shared = {
    fetch: async (request) => hono.fetch(request, env, executionCtx),
    fixed,
    logs: () => memory.entries(),
    mail: { lastTo: outbox.lastTo, all: outbox.all },
    noMock: stub ? "stub" : password ? "password" : undefined,
    stub,
    session: undefined,
    disposed: false,
    dispose: async () => {
      if (shared.disposed) return;
      shared.disposed = true;
      await pg?.close();
      await proxy.dispose();
    },
  };
  return testApp(shared, options.user);
}

