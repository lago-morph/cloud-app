/**
 * `connectTestStage` (testing.d.ts; core.md §2 "Testing"; cli.md `smoke`): the `TestApp` shape
 * over HTTP, for the deployed test stage that the running `smoke` command targets, or for the
 * local `dev` server when `smoke` runs with target `local`.
 *
 * The `smoke` command resolves the base URL (the stage's recorded deploy output, or the running
 * `dev` server's recorded origin) and passes `{ target, stage, baseUrl }` to the test run in
 * `PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION`. Framework code may read the environment; app code may
 * not (`no-env-access`), so app tests see only this function.
 *
 * Every request sends an explicit User-Agent (DEC-0089) and follows no redirect. State-changing
 * requests carry the stage's origin in `Origin` unless the caller sets one. Each identity from
 * `as(user)` logs in once through `POST /api/auth/mock-login`, on its first request, and keeps its
 * own session cookie. `dispose()` only logs out; stage data is kept. A URL on any origin but the
 * stage's is refused before anything is sent (`appUrl`), so the jar and `Origin` never leave it.
 */
import type { CurrentUser } from "../auth/public.js";
import type { LogEntry } from "../log/entry.js";
import type { TestApp } from "./test-app.js";

/** The environment variable through which `smoke` passes the connection to its test run. */
export const SMOKE_CONNECTION_ENV = "PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION";

/** Cloudflare refuses some default User-Agents (DEC-0089). */
export const SMOKE_USER_AGENT = "prototype-framework-smoke/0.1.0";

/** What `smoke` passes to the test run. */
export interface SmokeConnection {
  readonly target: string;
  readonly stage: string;
  /** The origin requests go to, e.g. `http://localhost:5179` or the stage's `workers.dev` origin. */
  readonly baseUrl: string;
}

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TEST_STAGE_PREFIX = "test-";

/** Reads the connection `smoke` set; throws a message saying how to start a smoke run otherwise. */
export function readSmokeConnection(env: Readonly<Record<string, string | undefined>>): SmokeConnection {
  const raw = env[SMOKE_CONNECTION_ENV];
  if (raw === undefined || raw === "") {
    throw new Error(
      "connectTestStage() works only in a test run started by `smoke`: run `npm run smoke -- --target local` (against the running `dev` server) or `npm run smoke -- --target <t> --stage test-<name>`",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  const v = value as Partial<Record<keyof SmokeConnection, unknown>> | undefined;
  if (typeof v !== "object" || v === null || typeof v.target !== "string" || typeof v.stage !== "string" || typeof v.baseUrl !== "string") {
    throw new Error(`connectTestStage(): the connection in ${SMOKE_CONNECTION_ENV} is malformed; start the run with the \`smoke\` command`);
  }
  return { target: v.target, stage: v.stage, baseUrl: v.baseUrl };
}

/**
 * Resolves `path` against the app's origin and refuses, before anything is sent, a URL whose origin
 * or protocol is not the app's: an absolute URL on another host, `//host`, `/\host`, `http:` on an
 * `https` app's host, `blob:` (root cause F-02 entry 2 revised). Shared by both test apps.
 */
export function appUrl(path: string, appOrigin: string): URL {
  const app = new URL(appOrigin);
  const url = new URL(path, app);
  if (url.origin !== app.origin || url.protocol !== app.protocol) {
    const where = url.origin === app.origin ? `a ${url.protocol} URL` : url.origin;
    throw new Error(
      `request(${JSON.stringify(path)}): ${where} is not the app's origin (${app.origin}); the test app sends requests only to the app. Send requests to other hosts, such as a cloud upload or download ticket's url, with fetch.`,
    );
  }
  return url;
}

/** "METHOD /path answered HTTP n, error code C, requestId R" (testing.d.ts). */
async function unexpected(method: string, path: string, res: Response): Promise<string> {
  let code = "(none)";
  let requestId = "(none)";
  try {
    const body = (await res.json()) as { error?: { code?: unknown; requestId?: unknown } };
    if (typeof body.error?.code === "string") code = body.error.code;
    if (typeof body.error?.requestId === "string") requestId = body.error.requestId;
  } catch {
    // not an error body: the status alone is reported
  }
  return `${method} ${path} answered HTTP ${String(res.status)}, error code ${code}, requestId ${requestId}`;
}

function causeOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

interface Connection {
  readonly connection: SmokeConnection;
  readonly origin: string;
  readonly fetch: Fetch;
}

/** One request with the User-Agent and no redirects; no answer becomes a message naming the URL. */
async function send(c: Connection, path: string, init: RequestInit = {}): Promise<Response> {
  const url = appUrl(path, c.origin).toString();
  const headers = new Headers(init.headers);
  headers.set("user-agent", SMOKE_USER_AGENT);
  const method = (init.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method) && !headers.has("origin")) headers.set("origin", c.origin);
  try {
    return await c.fetch(url, { ...init, method, headers, redirect: "manual" });
  } catch (error) {
    const hint = c.connection.target === "local" ? "; is `dev` still running?" : "";
    throw new Error(`${method} ${url}: no response (${causeOf(error)})${hint}`);
  }
}

/** A cookie jar of name=value pairs (the session cookie, and anything else the stage sets). */
function storeCookies(jar: Map<string, string>, res: Response): void {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "" || /;\s*max-age=0\b/i.test(header)) jar.delete(name);
    else jar.set(name, value);
  }
}

const cookieHeader = (jar: Map<string, string>): string | undefined =>
  jar.size === 0 ? undefined : [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

function describeUser(user: CurrentUser): string {
  return user.level === "anonymous" ? "anonymous" : `${user.level} ${user.id}`;
}

function connectedApp(c: Connection, user: CurrentUser | undefined): TestApp {
  const jar = new Map<string, string>();
  let disposed = false;
  let login: Promise<void> | undefined;
  const loggedIn = user !== undefined && user.level !== "anonymous";

  const logIn = async (): Promise<void> => {
    if (user === undefined || user.level === "anonymous") return;
    const path = "/api/auth/mock-login";
    const res = await send(c, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: user.level, id: user.id, displayName: user.displayName }),
    });
    if (res.status !== 204) throw new Error(`logging in as ${describeUser(user)} on stage ${c.connection.stage}: ${await unexpected("POST", path, res)}`);
    storeCookies(jar, res);
  };

  const self: TestApp = {
    async request(path, init = {}) {
      if (disposed) throw new Error("this test app was disposed");
      appUrl(path, c.origin); // before logging in, sending or touching the jar
      login ??= logIn();
      try {
        await login;
      } catch (error) {
        login = undefined; // the next request tries again
        throw error;
      }
      const headers = new Headers(init.headers);
      const cookie = cookieHeader(jar);
      if (cookie !== undefined && !headers.has("cookie")) headers.set("cookie", cookie);
      const res = await send(c, path, { ...init, headers });
      storeCookies(jar, res);
      return res;
    },
    as: (next) => connectedApp(c, next),
    logs(): readonly LogEntry[] {
      throw new Error("logs() is not available on a connected stage: its entries are in the stage's log location, which `smoke` prints");
    },
    loginWithStub() {
      return Promise.reject(new Error("loginWithStub is not available on a connected stage: use as(user), which logs in through mock-login"));
    },
    loginWithAuthApp() {
      return Promise.reject(new Error("loginWithAuthApp is not available on a connected stage: test stages sign in with the mock only; use as(user)"));
    },
    get authApp(): never {
      throw new Error("authApp is not available on a connected stage: it is the in-process fake auth app");
    },
    get clock(): never {
      throw new Error("clock is not available on a connected stage: the stage keeps real time");
    },
    grantRole() {
      return Promise.reject(new Error("grantRole is not available on a connected stage: test stages sign in with the mock only; use as(mockUsers.admin())"));
    },
    setUnavailable() {
      throw new Error("setUnavailable is not available on a connected stage: a deployed stage's storage cannot be made to fail from a test");
    },
    revokeRole() {
      return Promise.reject(new Error("revokeRole is not available on a connected stage: test stages sign in with the mock only; use as(mockUsers.user())"));
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (!loggedIn || login === undefined) return;
      const cookie = cookieHeader(jar);
      await send(c, "/api/auth/logout", { method: "POST", ...(cookie === undefined ? {} : { headers: { cookie } }) });
      jar.clear();
    },
  };
  return self;
}

/** `connectTestStage` with the connection and `fetch` given (unit tests; the command passes the environment). */
export async function connectWith(connection: SmokeConnection, fetch: Fetch): Promise<TestApp> {
  if (connection.target !== "local" && !connection.stage.startsWith(TEST_STAGE_PREFIX)) {
    throw new Error(`connectTestStage(): stage ${JSON.stringify(connection.stage)} is not a test stage; only stages whose names start with "${TEST_STAGE_PREFIX}" can be connected to`);
  }
  const c: Connection = { connection, origin: new URL(connection.baseUrl).origin, fetch };
  const path = "/api/auth/me";
  const probe = await send(c, path);
  if (probe.status !== 200) {
    const where = connection.target === "local" ? "the local dev server" : `stage ${connection.stage}`;
    throw new Error(`connecting to ${where}: ${await unexpected("GET", path, probe)}`);
  }
  await probe.body?.cancel();
  return connectedApp(c, undefined);
}

/** Connects to the stage the running `smoke` command targets (testing.d.ts). */
export async function connectTestStage(): Promise<TestApp> {
  return connectWith(readSmokeConnection(process.env), (input, init) => fetch(input, init));
}
