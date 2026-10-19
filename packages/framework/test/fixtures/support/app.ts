/**
 * Fixture-app harness for the B-T4 integration suites (check, cli, local, build).
 *
 * Every test works on a throwaway copy of a fixture app in the OS temp directory and drives
 * it through the framework's own package binary, exactly as an owner would
 * (`npx @lago-morph/prototype-framework <command>` resolves to the same `.bin` entry).
 * Nothing in here re-implements or mocks the CLI, the checker, the build or the local
 * target.
 *
 * Fixture trees live under `packages/framework/test/fixtures/`. TypeScript files in them are
 * stored with a trailing `.fixture` suffix (`app.ts.fixture`) so the framework's own
 * `tsc -p packages/framework` does not compile them with the framework lib set; the copy
 * step strips the suffix (decision DEC-PENDING-B-T4-1).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
export const FW_DIR = join(REPO_ROOT, "packages", "framework");
export const FIXTURES = join(FW_DIR, "test", "fixtures");
export const PACKAGE_NAME = "@lago-morph/prototype-framework";
export const OFFLINE_WRAPPER = join(REPO_ROOT, "scripts", "offline.sh");

const FIXTURE_SUFFIX = ".fixture";

export interface RunResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** stdout + stderr with ANSI colour codes removed. */
  readonly output: string;
}

export interface RunOptions {
  /** Run inside a network namespace with only loopback up (plan §10.2, DEC-0108). */
  readonly offline?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface AppSpec {
  /** Fixture directories (relative to `FIXTURES`) copied in order; later layers overwrite earlier files. */
  readonly layers: readonly string[];
  /** Extra files written after the layers (app-relative path → content; null deletes). */
  readonly files?: Readonly<Record<string, string | null>>;
  /**
   * Run `generate-migration` once after copying, as an owner does after defining tables.
   * Default true. The fixture trees hold no generated migrations because the generator is
   * the framework's (decision DEC-PENDING-B-T4-3).
   */
  readonly generateMigrations?: boolean;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * The suites need the compiled package (`dist/`), because the package binary and every
 * export point there (DEC-PENDING-B-01-2). Fails with the command to run instead of
 * silently testing stale output.
 */
export async function assertFrameworkBuilt(): Promise<void> {
  const marker = join(FW_DIR, "dist", "cli", "public.js");
  const hint = "run `npm --workspace packages/framework run build` before the integration suites";
  if (!existsSync(marker)) throw new Error(`framework dist/ is missing (${marker}); ${hint}`);
  const builtAt = (await stat(marker)).mtimeMs;
  const newest = await newestMtime(join(FW_DIR, "src"));
  if (newest > builtAt + 1000) throw new Error(`framework dist/ is older than src/; ${hint}`);
}

async function newestMtime(dir: string): Promise<number> {
  let newest = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, await newestMtime(p));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".unit.test.ts")) newest = Math.max(newest, (await stat(p)).mtimeMs);
  }
  return newest;
}

async function copyLayer(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const name = entry.name.endsWith(FIXTURE_SUFFIX) ? entry.name.slice(0, -FIXTURE_SUFFIX.length) : entry.name;
    const dest = join(to, name);
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyLayer(src, dest);
    } else {
      await mkdir(dirname(dest), { recursive: true });
      await cp(src, dest);
    }
  }
}

export class FixtureApp {
  private constructor(readonly dir: string) {}

  static async create(spec: AppSpec): Promise<FixtureApp> {
    await assertFrameworkBuilt();
    const dir = await mkdtemp(join(tmpdir(), "b-t4-app-"));
    const app = new FixtureApp(dir);
    for (const layer of spec.layers) {
      const from = join(FIXTURES, layer);
      if (!existsSync(from)) throw new Error(`fixture layer not found: ${from}`);
      await copyLayer(from, dir);
    }
    for (const [path, content] of Object.entries(spec.files ?? {})) {
      if (content === null) await app.remove(path);
      else await app.write(path, content);
    }
    // The workspace's installed dependencies (the framework is a workspace link there).
    await symlink(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    if (spec.generateMigrations ?? true) {
      const gen = await app.cli(["generate-migration"]);
      if (gen.code !== 0) await app.dispose();
      if (gen.code !== 0) throw new Error(`fixture preparation: generate-migration failed (exit ${gen.code}):\n${gen.output}`);
    }
    return app;
  }

  /** Copies an existing app directory (e.g. `apps/template`) without its local state. */
  static async copyOf(appDir: string): Promise<FixtureApp> {
    await assertFrameworkBuilt();
    const dir = await mkdtemp(join(tmpdir(), "b-t4-copy-"));
    const skip = new Set(["node_modules", ".framework", ".wrangler", ".logs", ".dev.vars", "test-results"]);
    await cp(appDir, dir, { recursive: true, filter: (src) => !src.split(sep).some((part) => skip.has(part)) || src === appDir });
    await symlink(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    return new FixtureApp(dir);
  }

  path(rel: string): string {
    return join(this.dir, rel);
  }

  async write(rel: string, content: string): Promise<void> {
    const p = this.path(rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content);
  }

  async read(rel: string): Promise<string> {
    return readFile(this.path(rel), "utf8");
  }

  async remove(rel: string): Promise<void> {
    await rm(this.path(rel), { recursive: true, force: true });
  }

  exists(rel: string): boolean {
    return existsSync(this.path(rel));
  }

  /** Lists files (app-relative, forward slashes) under `rel`, recursively. */
  async files(rel: string): Promise<string[]> {
    const root = this.path(rel);
    if (!existsSync(root)) return [];
    const out: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else out.push(relative(this.dir, p).split(sep).join("/"));
      }
    };
    await walk(root);
    return out.sort();
  }

  /** The framework binary as `npx <package>` resolves it from the app. */
  get binary(): string {
    return join(this.dir, "node_modules", ".bin", "prototype-framework");
  }

  /** Runs `npx <package> <args…>` in the app directory. */
  cli(args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    return run(process.execPath, [this.binary, ...args], this.dir, options);
  }

  /** Starts a long-running CLI command (e.g. `dev`) in its own process group. */
  spawnCli(args: readonly string[], env: Record<string, string | undefined> = {}): RunningProcess {
    return RunningProcess.start(process.execPath, [this.binary, ...args], this.dir, env);
  }

  async dispose(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

export function run(command: string, args: readonly string[], cwd: string, options: RunOptions = {}): Promise<RunResult> {
  const [cmd, argv] = options.offline ? ["unshare", ["-rn", "sh", OFFLINE_WRAPPER, command, ...args]] : [command, [...args]];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, argv, { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 600_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, output: stripAnsi(stdout + "\n" + stderr) });
    });
    child.stdin.end(options.stdin ?? "");
  });
}

export class RunningProcess {
  private out = "";
  private exited: Promise<number | null>;

  private constructor(private readonly child: ChildProcess) {
    child.stdout?.on("data", (d: Buffer) => (this.out += d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => (this.out += d.toString("utf8")));
    this.exited = new Promise((r) => child.on("close", (code) => r(code)));
  }

  static start(command: string, args: readonly string[], cwd: string, env: Record<string, string | undefined>): RunningProcess {
    const child = spawn(command, [...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    return new RunningProcess(child);
  }

  get pid(): number {
    if (this.child.pid === undefined) throw new Error("process did not start");
    return this.child.pid;
  }

  get output(): string {
    return stripAnsi(this.out);
  }

  /** Waits until the output matches `pattern`; rejects on exit or timeout. */
  async waitFor(pattern: RegExp, timeoutMs = 180_000): Promise<RegExpMatchArray> {
    const deadline = Date.now() + timeoutMs;
    let done = false;
    void this.exited.then(() => (done = true));
    for (;;) {
      const m = this.output.match(pattern);
      if (m) return m;
      if (done) throw new Error(`process exited before printing ${pattern}:\n${this.output}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}:\n${this.output}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  /** Interrupts the whole process group (Ctrl-C), escalating to SIGKILL after `graceMs`. */
  async stop(graceMs = 30_000): Promise<number | null> {
    const signalGroup = (sig: NodeJS.Signals): void => {
      try {
        process.kill(-this.pid, sig);
      } catch {
        /* already gone */
      }
    };
    signalGroup("SIGINT");
    const timer = setTimeout(() => signalGroup("SIGKILL"), graceMs);
    const code = await this.exited;
    clearTimeout(timer);
    return code;
  }
}

// ---- Diagnostics -------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Output lines that belong to diagnostics about `fileName` (a base name, unique within the
 * fixture app). A diagnostic is either one line that names the file (`path:line:col …`,
 * tsc's `path(line,col): …`) or a line naming the file followed by indented continuation
 * lines (ESLint's "stylish" layout). Decision DEC-PENDING-B-T4-4.
 */
export function diagnosticsFor(output: string, fileName: string): string[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const names = new RegExp(`(^|[\\\\/\\s"'(\`])${escapeRe(fileName)}($|[:\\s("'),\`])`);
  const found: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!names.test(line)) continue;
    found.push(line);
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? "";
      if (next.trim() === "" || !/^\s/.test(next)) break;
      found.push(next);
    }
  }
  return found;
}

/** True when `line` names `rule` as a whole rule name (optionally plugin-prefixed). */
export function namesRule(line: string, rule: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRe(rule)}($|[^\\w-])`).test(line);
}

export function isTypeScriptError(line: string): boolean {
  return /\bTS\d{4}\b/.test(line);
}

/** Skill reference paths named in a line, e.g. `skill/reference/storing-data.md`. */
export function skillReferences(line: string): string[] {
  return Array.from(line.matchAll(/(?:skill\/)?reference\/[A-Za-z0-9._/-]+?\.md/g), (m) => m[0].replace(/^skill\//, ""));
}

// ---- Migrations --------------------------------------------------------------------

export type Dialect = "sqlite" | "postgres";

export async function migrationFiles(app: FixtureApp, dialect: Dialect): Promise<string[]> {
  return (await app.files(`migrations/${dialect}`)).filter((f) => f.endsWith(".sql"));
}

function hashForms(content: string): string[] {
  const forms: string[] = [];
  for (const algo of ["sha256", "sha1", "sha512"]) {
    const digest = createHash(algo).update(content, "utf8").digest();
    const hex = digest.toString("hex");
    const b64 = digest.toString("base64");
    const b64url = digest.toString("base64url");
    forms.push(hex, b64, b64url, `${algo}:${hex}`, `${algo}-${b64}`, `${algo}:${b64}`);
  }
  return forms;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function replaceStrings(node: Json, map: ReadonlyMap<string, string>): { node: Json; count: number } {
  if (typeof node === "string") return map.has(node) ? { node: map.get(node) ?? node, count: 1 } : { node, count: 0 };
  if (Array.isArray(node)) {
    let count = 0;
    const out = node.map((n) => {
      const r = replaceStrings(n, map);
      count += r.count;
      return r.node;
    });
    return { node: out, count };
  }
  if (node !== null && typeof node === "object") {
    let count = 0;
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(node)) {
      const r = replaceStrings(v, map);
      count += r.count;
      out[k] = r.node;
    }
    return { node: out, count };
  }
  return { node, count: 0 };
}

/**
 * Edits a committed migration and updates its entry in `migrations/checksums.json`, so the
 * checksum check passes and only the schema comparison can catch the edit. The checksum
 * format is the framework's; this finds the old file's digest (sha256/sha1/sha512, hex or
 * base64, optionally prefixed) and replaces it in the same form (DEC-PENDING-B-T4-5).
 */
export async function editMigrationKeepingChecksum(app: FixtureApp, rel: string, edit: (sql: string) => string): Promise<void> {
  const before = await app.read(rel);
  const after = edit(before);
  await app.write(rel, after);
  const checksumsPath = "migrations/checksums.json";
  const json = JSON.parse(await app.read(checksumsPath)) as Json;
  const oldForms = hashForms(before);
  const newForms = hashForms(after);
  const map = new Map(oldForms.map((f, i) => [f, newForms[i] ?? f]));
  const { node, count } = replaceStrings(json, map);
  if (count === 0) throw new Error(`test harness: no digest of ${rel} found in ${checksumsPath}; update editMigrationKeepingChecksum for the framework's format`);
  await app.write(checksumsPath, JSON.stringify(node, null, 2) + "\n");
}

/**
 * Adds a hand-written migration file to one dialect history and registers it the way the
 * existing files are registered: a checksum entry modelled on the newest existing file's
 * entry, and a drizzle `meta/_journal.json` entry when that journal exists.
 */
export async function addHandWrittenMigration(app: FixtureApp, dialect: Dialect, slug: string, sql: string): Promise<string> {
  const existing = await migrationFiles(app, dialect);
  const last = existing[existing.length - 1];
  if (last === undefined) throw new Error(`test harness: no ${dialect} migrations to extend`);
  const lastBase = last.slice(last.lastIndexOf("/") + 1, -".sql".length);
  const m = /^(\d+)_/.exec(lastBase);
  const width = m?.[1]?.length ?? 4;
  const next = String((m ? Number(m[1]) : existing.length - 1) + 1).padStart(width, "0");
  const base = `${next}_${slug}`;
  const rel = `migrations/${dialect}/${base}.sql`;
  await app.write(rel, sql);

  const journalRel = `migrations/${dialect}/meta/_journal.json`;
  if (app.exists(journalRel)) {
    const journal = JSON.parse(await app.read(journalRel)) as { entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[] };
    const prev = journal.entries[journal.entries.length - 1];
    journal.entries.push({ idx: (prev?.idx ?? -1) + 1, version: prev?.version ?? "7", when: (prev?.when ?? 0) + 1000, tag: base, breakpoints: prev?.breakpoints ?? true });
    await app.write(journalRel, JSON.stringify(journal, null, 2) + "\n");
  }

  const checksumsPath = "migrations/checksums.json";
  const lastContent = await app.read(last);
  const oldForms = new Set(hashForms(lastContent));
  const newForms = hashForms(sql);
  const allOld = hashForms(lastContent);
  const formFor = (oldValue: string): string => newForms[allOld.indexOf(oldValue)] ?? oldValue;
  const json = JSON.parse(await app.read(checksumsPath)) as Json;
  const rename = (s: string): string => s.split(lastBase).join(base);
  let added = false;
  const visit = (node: Json): Json => {
    if (added || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      const idx = node.findIndex((n) => n !== null && typeof n === "object" && !Array.isArray(n) && Object.values(n).some((v) => typeof v === "string" && oldForms.has(v)) && JSON.stringify(n).includes(lastBase));
      const hit = idx >= 0 ? node[idx] : undefined;
      if (hit !== undefined && hit !== null && typeof hit === "object" && !Array.isArray(hit)) {
        const clone: { [k: string]: Json } = {};
        for (const [k, v] of Object.entries(hit)) clone[k] = typeof v === "string" ? (oldForms.has(v) ? formFor(v) : rename(v)) : v;
        added = true;
        return [...node, clone];
      }
      return node.map(visit);
    }
    const entries = Object.entries(node);
    const hitKey = entries.find(([k, v]) => typeof v === "string" && oldForms.has(v) && k.includes(lastBase))?.[0];
    if (hitKey !== undefined) {
      const value = node[hitKey];
      added = true;
      const copy: { [k: string]: Json } = { ...node };
      copy[rename(hitKey)] = typeof value === "string" ? formFor(value) : (value ?? null);
      return copy;
    }
    const out: { [k: string]: Json } = {};
    for (const [k, v] of entries) out[k] = visit(v);
    return out;
  };
  const updated = visit(json);
  if (!added) throw new Error(`test harness: could not find the checksum entry of ${last} in ${checksumsPath}; update addHandWrittenMigration for the framework's format`);
  await app.write(checksumsPath, JSON.stringify(updated, null, 2) + "\n");
  return rel;
}

// ---- Build output ------------------------------------------------------------------

/** Text of every file under the app's `.framework/` build directory, keyed by app-relative path. */
export async function buildOutput(app: FixtureApp): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of await app.files(".framework")) out.set(f, (await readFile(app.path(f))).toString("latin1"));
  return out;
}
