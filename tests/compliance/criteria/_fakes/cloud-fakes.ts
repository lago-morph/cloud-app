/**
 * Local fakes for the unit tests of the cloud test helpers (root cause
 * ai/implementation/root-causes/2026-10-23-cloud-test-paths.md, "Red tests"): a fake framework
 * CLI (`fake-cli.mjs`, swapped in for the package binary by `vi.mock` of the module that exports
 * it), a stubbed `fetch` for the D1 database listing and `/query`, and the environment of a
 * Cloudflare run. No network call and no cloud: everything is in a scratch directory, which is
 * also `TMPDIR`, so the `further-stage` lock never collides with a real run on the machine.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

export const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "fake-cli.mjs");

/** A directory with `dist/index.js`, so `requireBuiltFramework()` passes without a build. */
export function fakeFrameworkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "fake-framework-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist", "index.js"), "export {};\n");
  return dir;
}

export interface CliCall {
  readonly argv: readonly string[];
  readonly stdin: string;
}

export interface FetchCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** Tables the fake `sqlite_master` query returns. */
export const FAKE_TABLES = ["__framework_kv", "__framework_migrations", "children", "parents"];

export interface CloudFakes {
  readonly root: string;
  readonly stateDir: string;
  /** The `further-stage` lock directory under the scratch TMPDIR. */
  readonly lockPath: string;
  /** Every fake CLI call, in order. */
  calls(): CliCall[];
  /** Each call as `deploy`, `secrets set <name>`, `remove` … */
  commands(): string[];
  readonly fetches: FetchCall[];
  /** Database names listed besides those of the stages the fake CLI deployed. */
  readonly extraDatabases: string[];
  /** Called on every D1 listing (before it answers). */
  onList?: () => void;
  /** Marks a stage's Worker as existing (a stage deployed before the test). */
  existingWorker(stage: string, secrets?: readonly string[]): void;
  failNextDeploy(): void;
  failRemove(on: boolean): void;
  listCount(): number;
  queryCount(): number;
  dispose(): void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Installs the fakes: environment (vi.stubEnv), `fetch` (vi.stubGlobal) and a scratch TMPDIR. Undo with `dispose()`. */
export function installCloudFakes(options: { readonly d1?: "available" | "stopped" } = {}): CloudFakes {
  const root = mkdtempSync(join(tmpdir(), "cloud-fakes-"));
  const stateDir = join(root, "state");
  const tmp = join(root, "tmp");
  mkdirSync(stateDir);
  mkdirSync(tmp);
  const logPath = join(root, "cli.log");
  writeFileSync(logPath, "");
  vi.stubEnv("TMPDIR", tmp);
  vi.stubEnv("COMPLIANCE_TARGET", "cloudflare");
  vi.stubEnv("COMPLIANCE_STAGE", "test-x");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct0");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
  // Safety net: should a real CLI ever be spawned instead of the fake, its requests go to a
  // closed local port, never to Cloudflare.
  for (const name of ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"]) vi.stubEnv(name, "http://127.0.0.1:9");
  vi.stubEnv("NO_PROXY", "");
  vi.stubEnv("no_proxy", "");
  vi.stubEnv("COMPLIANCE_CLOUDFLARE_D1", options.d1 === "stopped" ? "" : "available");
  vi.stubEnv("FAKE_CLI_LOG", logPath);
  vi.stubEnv("FAKE_CLI_STATE", stateDir);
  vi.stubEnv("FAKE_CLI_SECRETS", "apiKey");
  const fetches: FetchCall[] = [];
  const extraDatabases: string[] = [];
  const deployedStages = (): string[] =>
    readdirSync(stateDir)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => (JSON.parse(readFileSync(join(stateDir, f), "utf8")) as { worker?: boolean }).worker === true)
      .map((f) => f.slice(0, -".json".length));
  const fakes: CloudFakes = {
    root,
    stateDir,
    lockPath: join(tmp, "c-t1-further-stage.lock"),
    calls: () =>
      readFileSync(logPath, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as CliCall),
    commands: () => fakes.calls().map((c) => (c.argv[0] === "secrets" ? `secrets ${c.argv[1] ?? ""} ${c.argv[2] ?? ""}` : (c.argv[0] ?? ""))),
    fetches,
    extraDatabases,
    existingWorker(stage, secrets = ["apiKey"]) {
      writeFileSync(join(stateDir, `${stage}.json`), JSON.stringify({ worker: true, secrets }));
    },
    failNextDeploy: () => writeFileSync(join(stateDir, "fail-next-deploy"), ""),
    failRemove(on) {
      if (on) writeFileSync(join(stateDir, "fail-remove"), "");
      else rmSync(join(stateDir, "fail-remove"), { force: true });
    },
    listCount: () => fetches.filter((f) => f.method === "GET" && f.path.endsWith("/d1/database")).length,
    queryCount: () => fetches.filter((f) => f.method === "POST" && f.path.endsWith("/query")).length,
    dispose() {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      rmSync(root, { recursive: true, force: true });
    },
  };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    fetches.push({ method, path: url.pathname, body });
    if (url.hostname !== "api.cloudflare.com") return Promise.resolve(json({ error: "the fakes answer the Cloudflare API only" }, 599));
    if (method === "GET" && url.pathname.endsWith("/d1/database")) {
      fakes.onList?.();
      const filter = url.searchParams.get("name");
      const names = [...extraDatabases, ...deployedStages().map((s) => `reference-${s}-db-1`)].filter((n) => filter === null || n.includes(filter));
      return Promise.resolve(json({ success: true, result: names.map((name) => ({ name, uuid: `uuid-${name}` })), result_info: { page: 1, per_page: 100, total_pages: 1 } }));
    }
    if (method === "POST" && /\/d1\/database\/[^/]+\/query$/.test(url.pathname)) {
      const b = body as { sql?: string; batch?: { sql: string }[] };
      const statements = b.batch !== undefined ? b.batch.map((s) => s.sql) : [b.sql ?? ""];
      const result = statements.map((sql) => ({ success: true, results: sql.includes("sqlite_master") ? FAKE_TABLES.map((name) => ({ name })) : [{ id: 1, sql }] }));
      return Promise.resolve(json({ success: true, result }));
    }
    return Promise.resolve(json({ success: false, errors: [{ message: `not faked: ${method} ${url.pathname}` }] }, 404));
  });
  return fakes;
}

/** Whether the further-stage lock directory exists now. */
export function lockHeld(fakes: CloudFakes): boolean {
  return existsSync(fakes.lockPath);
}

/** `n` distinct test-stage database names of other stages, for filling the account up to or past the cap. */
export const otherStageDatabases = (n: number): string[] => Array.from({ length: n }, (_, i) => `reference-test-other${String(i)}-db-1`);

export const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
