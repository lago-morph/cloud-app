/**
 * Cloud stages that the D-T1 criteria (CF, PROV, COMPL) deploy, change and remove themselves,
 * separate from the run's shared stage (compliance.md "Test stages": stage-lifecycle criteria
 * create and remove their own stages). Written from the criteria and PROV/CLI documents, not
 * from the implementation. Assumptions: DEC-0359…DEC-0366 (docs/decisions/decision-log.md, Item: D-T).
 *
 * - Each stage is `test-<random>` (`newTestStage()`), deployed from a scratch copy of an app
 *   (`apps/reference` or `apps/template`, committed content only) with the framework CLI, and
 *   removed in `finally`.
 * - Cloud usage (plan §1): every deploy needs D1 (it creates and migrates the stage's
 *   database), so `withCloudStage` first applies the D1 stop (DEC-0317, `_cloud/d1.ts`); it
 *   then takes the cross-process "further-stage" lock that C-T1's further stages also take (one
 *   further stage at a time across files) and checks the two-database cap (DEC-0318). No data
 *   is generated; tests write a handful of rows at most.
 * - A stage's first Cloudflare deploy stops naming unset secrets (PROV §2 "First Cloudflare
 *   deploy"); `deployReady` then sets them with `secrets set` and deploys again.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, newTestStage, target, type ComplianceClient } from "../../../harness/index.js";
import { requireCloudD1, requireDatabaseRoom } from "../../_cloud/d1.js";
import { acquireLock, requireBuiltFramework, scratchCopy, type ScratchApp } from "../../core/support/processes.js";
import { BIN, REFERENCE_DIR } from "../../core/support/repo.js";

export interface CommandResult {
  readonly command: string;
  readonly status: number | null;
  readonly output: string;
}

export interface RunOptions {
  readonly cwd: string;
  /** Variables added to (or replacing) the parent's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Variables removed from the environment (PROV-AC-002: "with one credential removed"). */
  readonly unset?: readonly string[];
  readonly stdin?: string;
  readonly timeoutMs?: number;
  /** Called with the whole output so far whenever new output arrives. */
  readonly onOutput?: (output: string) => void;
}

const DEPLOY_TIMEOUT_MS = 20 * 60_000;

/** Runs the package binary with Node, to completion (bounded); output is stdout and stderr interleaved. */
export function runCli(args: readonly string[], options: RunOptions): Promise<CommandResult> {
  requireBuiltFramework();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { CI: "1", NO_COLOR: "1", NODE_USE_ENV_PROXY: "1" }, options.env ?? {});
  for (const k of options.unset ?? []) delete env[k];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: options.cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    let output = "";
    const take = (d: Buffer): void => {
      output += d.toString("utf8");
      options.onOutput?.(output);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timeoutMs = options.timeoutMs ?? DEPLOY_TIMEOUT_MS;
    const timer = setTimeout(() => {
      output += `\n[d-t1] timed out after ${String(timeoutMs)} ms\n`;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);
    const command = `prototype-framework ${args.join(" ")}`;
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ command, status: 127, output: `${output}${e.message}\n` });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ command, status, output });
    });
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

/** The stage's public origin in `deploy` output (PROV §2 "Publishing the result"). */
export function deployOrigin(output: string): string | undefined {
  return /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)\b/.exec(output)?.[1];
}

/** The last `chars` characters of command output, for failure messages. */
export function tail(output: string, chars = 2000): string {
  return output.length <= chars ? output : `…${output.slice(-chars)}`;
}

export type Overlay = "v2" | "unique-fail";

export interface CloudStage {
  readonly app: string;
  readonly stage: string;
  readonly target: string;
  /** The scratch copy deployed from. */
  readonly copy: ScratchApp;
  /** Every CLI command run for this stage, in order. */
  readonly outputs: CommandResult[];
  /** Origin from the latest deploy that printed one. */
  baseUrl(): string;
  /** A new anonymous client of the stage. */
  client(): ComplianceClient;
  /** `deploy --target <t> --stage <s>` once, as is. */
  deploy(options?: Omit<RunOptions, "cwd">): Promise<CommandResult>;
  /** Deploys; when the first deploy stops naming unset secrets, sets them and deploys again. Throws unless it ends with status 0. */
  deployReady(): Promise<CommandResult>;
  setSecret(name: string, value: string): Promise<CommandResult>;
  /** `remove` (once; later calls return the first result that exited 0, or the last one). A production stage's carries `--confirm-production`. */
  remove(options?: Omit<RunOptions, "cwd">): Promise<CommandResult>;
  /**
   * Records a removal of the stage made by another actor (a clean machine, the driver's
   * cleanup), so the cleanup in `finally` does not remove it a second time. It counts only when
   * `result` exited 0 and `remaining` (the stage-resource probe after it) is empty; otherwise the
   * cleanup still runs.
   */
  removedElsewhere(result: CommandResult, remaining: readonly string[]): void;
  /** Applies a migration overlay of apps/reference (ROUTES.md "Migration overlays") to the copy. */
  applyOverlay(overlay: Overlay): void;
  /** Runs any other CLI command in the copy. */
  cli(args: readonly string[], options?: Omit<RunOptions, "cwd">): Promise<CommandResult>;
}

export interface StageOptions {
  /** The app directory to copy (`apps/reference` or `apps/template`). */
  readonly appDir: string;
  /** The app's name in its `defineApp` (`reference`, `template`). */
  readonly app: string;
  /** Declared secrets and the values to set on the stage. */
  readonly secrets: Readonly<Record<string, string>>;
  /** D1 databases this stage may hold at once (2 for a schema-changing deploy). */
  readonly databases: 1 | 2;
  /** Environment for every command (for example a fresh HOME). */
  readonly env?: Readonly<Record<string, string>>;
  /** Remove the stage in `finally` (default true). */
  readonly removeAfter?: boolean;
  /**
   * The caller already holds the further-stage lock and checked the database cap for every
   * stage it opens (`holdStages`), e.g. a criterion with two stages at once.
   */
  readonly held?: boolean;
  /**
   * A production stage of this name instead of a `test-<random>` one (`newProductionStage`): the
   * copy gets `config/<target>/<stage>.json` from prodcheck's committed values file (CFG-REQ-002),
   * and `remove` passes `--confirm-production <stage>` (PROV-REQ-003). Only for a criterion about
   * production stages (DEC-0543, DEC-0553); never `prodcheck`.
   */
  readonly productionStage?: string;
}

/**
 * A new production stage name for a criterion about production stages: `prefix` and 10
 * random lowercase letters and digits (PAR-291's alphabet), never starting with `test-`
 * (PROV-REQ-005) and never `prodcheck`.
 */
export function newProductionStage(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  while (out.length < 10) {
    const byte = randomBytes(1)[0] ?? 255;
    if (byte < 252) out += alphabet[byte % 36] ?? "";
  }
  const stage = `${prefix}${out}`;
  if (stage.startsWith("test-") || stage === "prodcheck") throw new Error(`${stage} is not a new production stage name`);
  return stage;
}

/** Copies one overlay of apps/reference over a copy (remove the app's migrations first, then copy). */
export function copyOverlay(dir: string, overlay: Overlay): void {
  const from = join(REFERENCE_DIR, "versions", overlay);
  if (!existsSync(from)) throw new Error(`apps/reference/versions/${overlay} does not exist`);
  rmSync(join(dir, "migrations"), { recursive: true, force: true });
  cpSync(from, dir, { recursive: true });
}

/** Puts the committed (version 1) schema and migrations of apps/reference back into a copy. */
export function restoreCommitted(dir: string): void {
  rmSync(join(dir, "migrations"), { recursive: true, force: true });
  cpSync(join(REFERENCE_DIR, "migrations"), join(dir, "migrations"), { recursive: true });
  cpSync(join(REFERENCE_DIR, "src", "server", "evolution.ts"), join(dir, "src", "server", "evolution.ts"));
}

/**
 * One stage shared by the tests of a file, opened on first use inside a test (so a missing
 * prerequisite is reported by that test) and removed by `close()` in `afterAll`.
 */
export function sharedStage(options: StageOptions): { get(): Promise<CloudStage>; close(): Promise<void> } {
  let ready: Promise<CloudStage> | undefined;
  let finish: (() => void) | undefined;
  let held: Promise<unknown> | undefined;
  return {
    get() {
      ready ??= new Promise<CloudStage>((resolveReady, rejectReady) => {
        held = withCloudStage(options, (s) => {
          resolveReady(s);
          return new Promise<void>((done) => (finish = done));
        }).catch((error: unknown) => {
          rejectReady(error);
        });
      });
      return ready;
    },
    async close() {
      finish?.();
      await held;
    },
  };
}

/**
 * The guards every further cloud stage takes, in order (plan §1 "Cloud usage limits"): the D1
 * stop (DEC-0317), the cross-process further-stage lock (one further stage at a time across
 * test files and Playwright workers), and the two-database cap (DEC-0318) checked under the
 * lock. Resolves to the lock's release (idempotent); when the cap check throws, the lock is
 * released before the error is rethrown. Callers release it on every later failure path.
 */
export async function takeStageRoom(databases: number, what: string): Promise<() => Promise<void>> {
  requireCloudD1(target().target);
  const release = await acquireLock("further-stage", 60 * 60_000);
  try {
    await requireDatabaseRoom(databases, what);
  } catch (error) {
    await release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await release();
  };
}

/** Holds the D1 stop, the further-stage lock and the database cap, then deploys nothing yet: `body` drives the stage. */
export async function withCloudStage<T>(options: StageOptions, body: (stage: CloudStage) => Promise<T>): Promise<T> {
  const t = target().target;
  if (t === "local") throw new Error("withCloudStage is for cloud targets only");
  requireCloudD1(t);
  const release = options.held === true ? async (): Promise<void> => undefined : await takeStageRoom(options.databases, `a further ${options.app} stage`);
  let copy: ScratchApp | undefined;
  let removed: CommandResult | undefined;
  let deployedOnce = false;
  try {
    copy = await scratchCopy(options.appDir, `d-t1-${options.app}`);
    const dir = copy.dir;
    const production = options.productionStage;
    if (production === "prodcheck" || production?.startsWith("test-") === true) throw new Error(`productionStage ${production} is not a criterion's own production stage`);
    const stageName = production ?? newTestStage();
    if (production !== undefined) await copy.write(`config/${t}/${production}.json`, await copy.read(`config/${t}/prodcheck.json`));
    const outputs: CommandResult[] = [];
    let origin: string | undefined;
    const cli = async (args: readonly string[], o: Omit<RunOptions, "cwd"> = {}): Promise<CommandResult> => {
      const r = await runCli(args, { ...o, cwd: dir, env: { ...(options.env ?? {}), ...(o.env ?? {}) } });
      outputs.push(r);
      return r;
    };
    const deploy = async (o: Omit<RunOptions, "cwd"> = {}): Promise<CommandResult> => {
      deployedOnce = true;
      const r = await cli(["deploy", "--target", t, "--stage", stageName], o);
      origin = deployOrigin(r.output) ?? origin;
      return r;
    };
    const setSecret = (name: string, value: string): Promise<CommandResult> => cli(["secrets", "set", name, "--target", t, "--stage", stageName], { stdin: `${value}\n` });
    const stage: CloudStage = {
      app: options.app,
      stage: stageName,
      target: t,
      copy,
      outputs,
      baseUrl() {
        if (origin === undefined) throw new Error(`stage ${stageName} has no public origin yet (no deploy printed one)`);
        return origin;
      },
      client() {
        return createClient({ baseUrl: stage.baseUrl() });
      },
      deploy,
      async deployReady() {
        let r = await deploy();
        if (r.status !== 0 && Object.keys(options.secrets).some((n) => r.output.includes(n))) {
          for (const [name, value] of Object.entries(options.secrets)) {
            const s = await setSecret(name, value);
            if (s.status !== 0) throw new Error(`secrets set ${name} on ${stageName} failed with status ${String(s.status)}:\n${tail(s.output)}`);
          }
          r = await deploy();
        }
        if (r.status !== 0) throw new Error(`deploy of ${options.app} stage ${stageName} failed with status ${String(r.status)}:\n${tail(r.output)}`);
        if (origin === undefined) throw new Error(`deploy of ${options.app} stage ${stageName} printed no workers.dev origin`);
        return r;
      },
      setSecret,
      async remove(o = {}) {
        if (removed?.status === 0) return removed;
        removed = await cli(["remove", "--target", t, "--stage", stageName, ...(production === undefined ? [] : ["--confirm-production", stageName])], o);
        return removed;
      },
      removedElsewhere(result, remaining) {
        if (result.status === 0 && remaining.length === 0) removed ??= result;
      },
      applyOverlay(overlay) {
        copyOverlay(dir, overlay);
      },
      cli,
    };
    try {
      return await body(stage);
    } finally {
      if (options.removeAfter !== false && deployedOnce) {
        const r = await stage.remove();
        if (r.status !== 0) process.stderr.write(`[d-t1] removing stage ${stageName} failed (status ${String(r.status)}); it may be left over:\n${tail(r.output)}\n`);
      }
    }
  } finally {
    try {
      await copy?.remove();
    } finally {
      await release();
    }
  }
}

/**
 * For a criterion that opens several stages at once: applies the D1 stop, takes the
 * further-stage lock once and checks that `databases` more D1 databases fit the cap
 * (`takeStageRoom`); the stages are then opened with `held: true`. The lock is released when
 * `body` settles, whether it resolves or throws.
 */
export async function holdStages<T>(databases: number, what: string, body: () => Promise<T>): Promise<T> {
  const release = await takeStageRoom(databases, what);
  try {
    return await body();
  } finally {
    await release();
  }
}

/** A fresh, empty home directory (no CLI state of wrangler, SST or Pulumi) and its environment. */
export function freshHome(label: string): { readonly env: Record<string, string>; remove(): void } {
  const home = mkdtempSync(join(tmpdir(), `d-t1-home-${label}-`));
  return {
    env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local", "share"), XDG_STATE_HOME: join(home, ".local", "state") },
    remove: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** `GET /api/__framework/health` answers 204 (PROV-REQ-002 step 7; framework.openapi.yaml). */
export async function healthStatus(c: ComplianceClient): Promise<number> {
  return (await c.get("/api/__framework/health")).status;
}
