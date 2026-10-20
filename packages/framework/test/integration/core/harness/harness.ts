/**
 * Shared harness for the B-T1 integration suites (core, http, log, config, secrets).
 *
 * Written from the contracts and acceptance criteria only (plan §3 "Phase B test-case authors").
 * It drives the framework through its public surface: the package hubs (`.`, `./client`,
 * `./testing`, which re-export exactly the contract names), the package's own binary
 * (CLI-REQ-001), and plain HTTP against `dev`. Nothing here is mocked: `dev` runs Wrangler/workerd
 * and Vite, builds write real files, and `createTestApp` uses its real local storage.
 *
 * Assumptions are recorded in ai/implementation/decisions/B-T1.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root (…/packages/framework/test/integration/core/harness → root). */
export const REPO_ROOT = resolve(here, "../../../../../..");
export const FRAMEWORK_DIR = join(REPO_ROOT, "packages/framework");
export const PACKAGE_NAME = "@lago-morph/prototype-framework";
export const BIN = join(FRAMEWORK_DIR, "bin/prototype-framework.js");
export const DOCS = join(REPO_ROOT, "docs");

/** Parameters used by the criteria (docs/parameters/parameters.md). */
export const PAR = {
  /** PAR-200 — maximum JSON request body, bytes. */
  maxJsonBody: 1_000_000,
  /** PAR-260 — maximum time a response waits for pending log writes, ms. */
  logWait: 2_000,
} as const;

/**
 * The CLI binary and the package exports run the compiled `dist/` (DEC-0111).
 * Tests that use them fail with this message when the framework has not been built.
 */
export function requireBuiltFramework(): void {
  if (!existsSync(join(FRAMEWORK_DIR, "dist/index.js")) || !existsSync(join(FRAMEWORK_DIR, "dist/cli/public.js"))) {
    throw new Error(
      "packages/framework/dist is missing: build the framework (npm run build -w packages/framework) before the integration layer",
    );
  }
}

/** A unique, recognisable test value (e.g. a test secret value). */
export function uniqueValue(label: string): string {
  return `${label}${randomBytes(12).toString("hex")}`;
}

// ---------------------------------------------------------------------------------------------
// Fixture apps on disk
// ---------------------------------------------------------------------------------------------

export type FileTree = Record<string, string>;

export interface TempApp {
  readonly dir: string;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  remove(): Promise<void>;
}

/**
 * Creates an app directory outside the repository with the given files. Its `node_modules`
 * links to the workspace's, so `@lago-morph/prototype-framework` resolves to this checkout.
 */
export async function makeTempApp(files: FileTree): Promise<TempApp> {
  const dir = await mkdtemp(join(tmpdir(), "bt1-app-"));
  await symlink(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  const app: TempApp = {
    dir,
    async write(path, content) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), content);
    },
    read: (path) => readFile(join(dir, path), "utf8"),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
  for (const [path, content] of Object.entries(files)) await app.write(path, content);
  return app;
}

/** The files every fixture app has (cli.md §2 "App layout"). */
export function baseAppFiles(name: string): FileTree {
  return {
    "package.json": JSON.stringify(
      {
        name,
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: { [PACKAGE_NAME]: "0.1.0", zod: "4.6.7" },
      },
      null,
      2,
    ),
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          types: [],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          verbatimModuleSyntax: true,
        },
        include: ["src/**/*.ts", "tests/**/*.ts"],
      },
      null,
      2,
    ),
    // The client entry page. Its location is not contracted (decision B-T1-4), so the page is
    // written both at the app root and in src/client/. Like apps/template, the page loads its
    // script with the absolute URL /src/client/main.ts (the file below): Vite's dev server rewrites
    // relative script URLs on SPA-fallback paths, so only an absolute URL is served byte-identically
    // on deep links (HTTP-AC-001; root cause 2026-10-19-HTTP-AC-001).
    "index.html": CLIENT_PAGE,
    "src/client/index.html": CLIENT_PAGE,
    "src/client/main.ts": "export {};\n",
    ".gitignore": ".framework/\n.wrangler/\n.logs/\n.dev.vars\nnode_modules/\n",
  };
}

export const CLIENT_MARKER = "bt1-client-entry-page";
const CLIENT_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>${CLIENT_MARKER}</title></head>
<body><div id="app">${CLIENT_MARKER}</div><script type="module" src="/src/client/main.ts"></script></body></html>
`;

/** A stage values file (stage-config.schema.json). */
export function stageConfig(values: Record<string, unknown>, framework: Record<string, unknown> = {}): string {
  return JSON.stringify({ values, framework }, null, 2);
}

// ---------------------------------------------------------------------------------------------
// The CLI (package binary)
// ---------------------------------------------------------------------------------------------

export interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

/** Runs `npx <package> <args>` equivalent: the package binary, in `cwd`. */
export function runCli(
  args: readonly string[],
  options: { readonly cwd: string; readonly stdin?: string; readonly timeoutMs?: number },
): Promise<CliResult> {
  requireBuiltFramework();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: options.cwd,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 120_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolvePromise({ status, stdout, stderr, output: stdout + stderr });
    });
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

/** Every regular file under `dir` (recursively), skipping `node_modules`. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

/** Files under `dir` whose content contains `needle`. */
export async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await listFiles(dir)) {
    const s = await stat(f);
    if (s.size > 50_000_000) continue;
    if ((await readFile(f)).includes(needle)) hits.push(f);
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// `dev`
// ---------------------------------------------------------------------------------------------

export interface DevServer {
  /** `http://localhost:<port>`: the origin that serves both the client and `/api`. */
  readonly baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

const DEV_LOCK = join(tmpdir(), "bt1-dev-server.lock");

/**
 * Serialises `dev` sessions across test files (Vitest runs files in parallel and the dev port
 * is not contracted). The lock is a directory holding the owner's pid; a dead owner's lock is
 * taken over.
 */
async function acquireDevLock(timeoutMs: number): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(DEV_LOCK);
      await writeFile(join(DEV_LOCK, "pid"), String(process.pid));
      return () => rm(DEV_LOCK, { recursive: true, force: true });
    } catch {
      let owner = NaN;
      try {
        owner = Number(readFileSync(join(DEV_LOCK, "pid"), "utf8"));
      } catch {
        /* lock being created */
      }
      if (Number.isInteger(owner) && owner > 0 && !isAlive(owner)) {
        await rm(DEV_LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error("timed out waiting for another dev server to stop");
      await delay(250);
    }
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Starts `npx <package> dev` in `appDir` and waits until it serves both the client entry page
 * and the framework health route on one `http://localhost:<port>` origin printed in its output
 * (HTTP-REQ-004, LOCAL-REQ-004). The URL is found from the output, since the port is not
 * contracted (decision B-T1-3).
 */
export async function startDev(appDir: string, timeoutMs = 120_000): Promise<DevServer> {
  requireBuiltFramework();
  const release = await acquireDevLock(10 * 60_000);
  let child: ChildProcess | undefined;
  let out = "";
  try {
    child = spawn(process.execPath, [BIN, "dev"], {
      cwd: appDir,
      env: { ...process.env, CI: "1", NO_COLOR: "1", BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    const proc = child;
    const deadline = Date.now() + timeoutMs;
    let baseUrl: string | undefined;
    while (baseUrl === undefined) {
      if (proc.exitCode !== null) throw new Error(`dev exited with ${proc.exitCode}:\n${out}`);
      if (Date.now() > deadline) throw new Error(`dev did not serve the app within ${timeoutMs} ms:\n${out}`);
      const candidates = [...new Set(Array.from(out.matchAll(/http:\/\/localhost:(\d+)/g), (m) => `http://localhost:${m[1]}`))];
      for (const url of candidates) {
        if (await servesApp(url)) {
          baseUrl = url;
          break;
        }
      }
      if (baseUrl === undefined) await delay(500);
    }
    const server: DevServer = {
      baseUrl,
      output: () => out,
      async stop() {
        await killTree(proc);
        await release();
      },
    };
    return server;
  } catch (e) {
    if (child) await killTree(child);
    await release();
    throw e;
  }
}

async function servesApp(url: string): Promise<boolean> {
  try {
    const page = await fetch(`${url}/`, { signal: AbortSignal.timeout(5_000) });
    const health = await fetch(`${url}/api/__framework/health`, { signal: AbortSignal.timeout(5_000) });
    // The health route answers 204, or an ErrorResponse when e.g. a declared secret has no value
    // yet (framework.openapi.yaml); either shows the API is served on this origin.
    const healthIsFramework =
      health.status === 204 || (health.headers.get("content-type") ?? "").includes("application/json");
    return page.status === 200 && (page.headers.get("content-type") ?? "").includes("text/html") && healthIsFramework;
  } catch {
    return false;
  }
}

async function killTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  try {
    process.kill(-child.pid, "SIGINT");
  } catch {
    child.kill("SIGINT");
  }
  const timedOut = await Promise.race([exited.then(() => false), delay(15_000).then(() => true)]);
  if (timedOut) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    await exited;
  }
}

/** Polls `check` until it returns a value other than undefined, or fails after `timeoutMs`. */
export async function waitFor<T>(what: string, check: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await delay(250);
  }
}

// ---------------------------------------------------------------------------------------------
// Contract validators (written from the schema files in docs/contracts)
// ---------------------------------------------------------------------------------------------

interface JsonSchemaLike {
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly properties?: Record<string, { readonly type?: string; readonly enum?: readonly string[]; readonly format?: string }>;
}

const logEntrySchema = JSON.parse(readFileSync(join(DOCS, "contracts/schemas/log-entry.schema.json"), "utf8")) as JsonSchemaLike;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validates one stored log entry against contracts/schemas/log-entry.schema.json (required,
 * additionalProperties, types, enums, date-time format). Returns the list of violations.
 */
export function logEntryViolations(entry: unknown): string[] {
  const problems: string[] = [];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ["entry is not an object"];
  const obj = entry as Record<string, unknown>;
  const props = logEntrySchema.properties ?? {};
  for (const key of logEntrySchema.required ?? []) if (!(key in obj)) problems.push(`missing ${key}`);
  for (const [key, value] of Object.entries(obj)) {
    const p = props[key];
    if (!p) {
      if (logEntrySchema.additionalProperties === false) problems.push(`unexpected property ${key}`);
      continue;
    }
    if (p.enum) {
      if (!p.enum.includes(value as string)) problems.push(`${key}=${JSON.stringify(value)} not in enum`);
      continue;
    }
    if (p.type === "string" && typeof value !== "string") problems.push(`${key} is not a string`);
    if (p.format === "date-time" && (typeof value !== "string" || !ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))))
      problems.push(`${key} is not a date-time`);
  }
  return problems;
}

/**
 * Validates an `ErrorResponse` body (contracts/http/framework.openapi.yaml): exactly
 * `{ error: { code, message, requestId } }`, all strings, nothing else.
 */
export function errorResponseViolations(body: unknown): string[] {
  const problems: string[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ["body is not an object"];
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "error") problems.push(`top-level keys ${JSON.stringify(keys)}`);
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return [...problems, "error is not an object"];
  const ek = Object.keys(error).sort();
  if (JSON.stringify(ek) !== JSON.stringify(["code", "message", "requestId"])) problems.push(`error keys ${JSON.stringify(ek)}`);
  for (const k of ["code", "message", "requestId"] as const) {
    if (typeof (error as Record<string, unknown>)[k] !== "string") problems.push(`error.${k} is not a string`);
  }
  return problems;
}

/** Reads a response as an `ErrorResponse` (asserting nothing). */
export async function errorBody(res: Response): Promise<{ error: { code: string; message: string; requestId: string } }> {
  return (await res.json()) as { error: { code: string; message: string; requestId: string } };
}

/** A V8 stack frame line, as found in a logged stack. */
export const STACK_FRAME = /\n\s+at\s/;

/** Strips a `Set-Cookie` header down to its `name=value`. */
export function cookiePair(setCookie: string | null): string {
  if (!setCookie) throw new Error("no Set-Cookie header");
  const first = setCookie.split(";")[0];
  if (!first || !first.includes("=")) throw new Error(`malformed Set-Cookie ${setCookie}`);
  return first.trim();
}

/**
 * `src/app.ts` for an on-disk fixture app. The export form of the entry module is not
 * contracted (decision B-T1-5), so the defined app is exported both as default and as `app`.
 */
export function appModule(body: { readonly imports: string; readonly definition: string }): string {
  return `${body.imports}
const app = defineApp(${body.definition});
export default app;
export { app };
`;
}

/**
 * Files of the on-disk fixture app used with `dev` and `build`: config keys `greeting`
 * (string, no default) and `limit` (integer, default 5); secrets `apiKey` and `unsetSecret`;
 * routes reading them, writing log entries, and throwing a plain `Error`.
 */
export function devFixtureFiles(options: { readonly name?: string; readonly greeting?: string } = {}): FileTree {
  const name = options.name ?? "bt1devapp";
  return {
    ...baseAppFiles(name),
    "src/app.ts": appModule({
      imports: `import { defineApp, configInteger, configString } from "${PACKAGE_NAME}";`,
      definition: `{
  name: ${JSON.stringify(name)},
  config: { greeting: configString(), limit: configInteger({ default: 5 }) },
  secrets: ["apiKey", "unsetSecret"],
  tables: {},
  routes: (api) => {
    api.get("/config", (c) => c.json({ greeting: c.var.config.get("greeting"), limit: c.var.config.get("limit") }));
    api.get("/log", (c) => {
      c.var.log.write("bt1app", "info", c.req.query("message") ?? "bt1 dev log entry");
      return c.json({ ok: true });
    });
    api.get("/throw/plain", () => {
      throw new Error("bt1 dev plain failure");
    });
    api.get("/secret", async (c) => c.json({ value: await c.var.secrets.get("apiKey") }));
    api.get("/throw/secret", async (c) => {
      throw new Error("bt1 failure using " + (await c.var.secrets.get("apiKey")));
    });
    api.get("/secret/missing", async (c) => c.json({ value: await c.var.secrets.get("unsetSecret") }));
    api.get("/secret/undeclared", async (c) => {
      const read = c.var.secrets.get as (name: string) => Promise<string>;
      return c.json({ value: await read.call(c.var.secrets, "notDeclared") });
    });
    api.get("/whoami", (c) => c.json(c.var.user));
  },
}`,
    }),
    "config/local.json": stageConfig({ greeting: options.greeting ?? "hello from local" }),
    "config/cloudflare/test.json": stageConfig({ greeting: "hello from test" }),
  };
}
