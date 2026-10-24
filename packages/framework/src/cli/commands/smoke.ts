/**
 * `smoke --target <t> --stage <s>` (CLI-REQ-001; cli.md `smoke`; CLI-AC-005): runs the app's
 * smoke tests (`tests/smoke/**`) against the running `dev` server (target `local`, stage
 * `local`, which may be left out) or against a deployed test stage, writes an evidence record
 * (COMPL-REQ-003, through `src/evidence/`), and prints the stage's log location for the day
 * (LOG-REQ-003, LOG-REQ-004).
 *
 * 1. Options. A cloud stage must be a test stage (`test-…`); anything else is refused first.
 * 2. The working tree must match HEAD (tracked files), because the record names a commit.
 * 3. The base URL: locally the origin the running `dev` server recorded in
 *    `.framework/local/dev-server.json`; on a cloud the stage's recorded deploy output
 *    `.framework/<target>/stages/<stage>.json` (`publicOrigin`, written by `deploy`).
 * 4. Vitest (PAR-116) runs `tests/smoke/**` once with `provide: { prototypeFrameworkSmoke: true }`
 *    (DEC-0207) and the connection in `PROTOTYPE_FRAMEWORK_SMOKE_CONNECTION`, which
 *    `connectTestStage()` reads (`src/testing/connect.ts`).
 * 5. One result per test (`smoke: <file> > <name>`) and per file-level failure; the record goes to
 *    `validation/<target>/<runId>.json` in the repository holding the app, with the account's
 *    `workers.dev` subdomain redacted (DEC-0086).
 * Exit 0 only when at least one test ran, every test passed, nothing failed outside a test, and
 * the record was written.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsNotImplementedError } from "../../core/aws-pending.js";
import type { Target } from "../../core/identity.js";
import type { EvidencePaths, EvidenceResult, GitState, Redaction, WriteEvidenceInput } from "../../evidence/writer.js";
import { LOG_BUCKET } from "../../provision/cloudflare/account.js";
import { SMOKE_CONNECTION_ENV, type SmokeConnection } from "../../testing/connect.js";
import { parseOptions, TARGETS, UsageError } from "../args.js";
import type { TestRun } from "./verify.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";

/** The smoke tests (cli.md §2 "App layout"), within the PAR-116 glob. */
export const SMOKE_GLOB = "tests/smoke/**/*.test.ts";

const LOCAL_STAGE = "local";
const TEST_STAGE_PREFIX = "test-";
const DETAIL_MAX = 500;

export type SmokeTestRun = TestRun;

export interface DevServerRecord {
  readonly origin: string;
}

export interface SmokeDeps {
  /** The running `dev` server of the app, if one is recorded and its process is alive. */
  devServer(appDir: string): DevServerRecord | undefined;
  /** The stage's public origin from its recorded deploy output. */
  deployedOrigin(appDir: string, target: Target, stage: string): string | undefined;
  appName(appDir: string): Promise<string>;
  /** The repository holding the app: where `validation/` is, and its working-tree state. */
  repo(appDir: string): { readonly root: string; readonly git: GitState };
  runTests(appDir: string, connection: SmokeConnection): Promise<SmokeTestRun>;
  writeEvidence(input: WriteEvidenceInput): EvidencePaths;
  newRunId(): string;
  now(): Date;
  versions(): Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Recorded origins: `dev` records its origin while it runs; `deploy` records the stage's output.

export function devServerRecordPath(appDir: string): string {
  return join(appDir, ".framework", "local", "dev-server.json");
}

/** For `dev`: records the origin it serves (call after it printed it). */
export function recordDevServer(appDir: string, origin: string, pid: number = process.pid): void {
  const path = devServerRecordPath(appDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ origin, pid })}\n`);
}

/** For `dev`: removes the record when it stops. */
export function clearDevServer(appDir: string): void {
  rmSync(devServerRecordPath(appDir), { force: true });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The recorded `dev` server, unless missing, malformed, or its process has ended. */
export function readDevServer(appDir: string): DevServerRecord | undefined {
  const record = readJson(devServerRecordPath(appDir));
  if (typeof record?.origin !== "string" || typeof record.pid !== "number" || !alive(record.pid)) return undefined;
  return { origin: record.origin };
}

export function deployRecordPath(appDir: string, target: Target, stage: string): string {
  return join(appDir, ".framework", target, "stages", `${stage}.json`);
}

/** For `deploy` (D-05): records the stage's public origin after a successful deploy. */
export function recordDeployOutput(appDir: string, target: Target, stage: string, publicOrigin: string): void {
  const path = deployRecordPath(appDir, target, stage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ publicOrigin })}\n`);
}

export function readDeployedOrigin(appDir: string, target: Target, stage: string): string | undefined {
  const origin = readJson(deployRecordPath(appDir, target, stage))?.publicOrigin;
  return typeof origin === "string" ? origin : undefined;
}

// ---------------------------------------------------------------------------------------------

function parseSmokeOptions(args: readonly string[]): { target: Target; stage: string } {
  const options = parseOptions(args, ["target", "stage"]);
  const target = options.get("target");
  if (target === undefined) throw new UsageError("--target is missing");
  if (!(TARGETS as readonly string[]).includes(target)) throw new UsageError(`--target must be one of: ${TARGETS.join(", ")}`);
  const stage = options.get("stage");
  if (target === "local") {
    if (stage !== undefined && stage !== LOCAL_STAGE) throw new UsageError(`with --target local the stage is "${LOCAL_STAGE}" (the running dev server)`);
    return { target, stage: LOCAL_STAGE };
  }
  if (stage === undefined) throw new UsageError("--stage is missing");
  return { target: target as Target, stage };
}

const utcDay = (d: Date) => ({ y: String(d.getUTCFullYear()), m: String(d.getUTCMonth() + 1).padStart(2, "0"), d: String(d.getUTCDate()).padStart(2, "0") });

function logLocation(target: Target, app: string, stage: string, at: Date): string {
  const { y, m, d } = utcDay(at);
  if (target === "local") return `.logs/${y}-${m}-${d}.log (in the app directory)`;
  if (target === "aws") throw new AwsNotImplementedError("smoke's log location on AWS (G-11)");
  return `R2 bucket ${LOG_BUCKET}, keys under ${app}/${stage}/${y}/${m}/${d}/`;
}

/** DEC-0086: the account's `workers.dev` subdomain is personal; it never goes into evidence. */
function subdomainRedactions(origin: string): Redaction[] {
  const match = /^https:\/\/[^./]+\.([^./]+)\.workers\.dev(?:[/:]|$)/.exec(origin);
  return match?.[1] === undefined ? [] : [{ value: match[1], replacement: "<account-subdomain>" }];
}

const firstLine = (text: string): string => (text.split("\n").find((l) => l.trim() !== "") ?? text).trim().slice(0, DETAIL_MAX);

function resultsOf(run: SmokeTestRun): EvidenceResult[] {
  const results: EvidenceResult[] = [];
  for (const t of run.tests) {
    const id = `smoke: ${t.file} > ${t.name}`;
    if (t.state === "passed") results.push({ id, status: "passed" });
    else if (t.state === "failed") results.push({ id, status: "failed", detail: firstLine(t.errors[0] ?? "failed") });
    else results.push({ id, status: "not-run", detail: "skipped" });
  }
  for (const f of run.fileErrors) results.push({ id: `smoke: ${f.file}`, status: "failed", detail: firstLine(f.message) });
  return results;
}

export function smokeCommand(deps: SmokeDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseSmokeOptions(args);
    const appDir = io.cwd;
    const command = `smoke --target ${target} --stage ${stage}`;
    const fail = (text: string): number => {
      io.stderr(`smoke: ${text}\n`);
      return EXIT.failed;
    };

    if (target !== "local" && !stage.startsWith(TEST_STAGE_PREFIX)) {
      return fail(`runs only against test stages (names starting with "${TEST_STAGE_PREFIX}"); ${JSON.stringify(stage)} is a production stage`);
    }

    let repo: ReturnType<SmokeDeps["repo"]>;
    let commit: string;
    try {
      repo = deps.repo(appDir);
      commit = repo.git.commit();
      const changed = repo.git.changedTrackedFiles();
      if (changed.length > 0) {
        return fail(`the evidence record names a commit, but tracked files differ from it: ${changed.join(", ")}. Commit (or undo) these changes, then run smoke again`);
      }
    } catch (error) {
      return fail(`the evidence record names a commit, so the app must be in a git repository with at least one commit (${describeFailure(error)})`);
    }

    let baseUrl: string | undefined;
    if (target === "local") {
      baseUrl = deps.devServer(appDir)?.origin;
      if (baseUrl === undefined) return fail("no running `dev` server found for this app: start it with `npm run dev` in another terminal, then run smoke again");
    } else {
      baseUrl = deps.deployedOrigin(appDir, target, stage);
      if (baseUrl === undefined) return fail(`no recorded deploy output for stage ${stage} on ${target}: deploy it first with \`npm run deploy -- --target ${target} --stage ${stage}\``);
    }

    const location = logLocation(target, target === "local" ? "" : await deps.appName(appDir), stage, deps.now());
    const startedAt = deps.now();
    let log = "";
    const out = (text: string) => {
      log += text;
      io.stdout(text);
    };
    const err = (text: string) => {
      log += text;
      io.stderr(text);
    };
    out(`smoke: running ${SMOKE_GLOB} against ${baseUrl} (target ${target}, stage ${stage})\n`);

    const connection: SmokeConnection = { target, stage, baseUrl };
    let run: SmokeTestRun;
    try {
      run = await deps.runTests(appDir, connection);
    } catch (error) {
      run = { tests: [], fileErrors: [], error: describeFailure(error) };
    }

    for (const t of run.tests) {
      if (t.state === "passed") out(`  passed  ${t.name}\n`);
      else if (t.state === "skipped") out(`  skipped ${t.name}\n`);
      else err(`  FAILED ${t.name}: ${firstLine(t.errors[0] ?? "failed")}\n`);
    }
    for (const f of run.fileErrors) err(`  FAILED ${f.file}: ${firstLine(f.message)}\n`);
    if (run.error !== undefined) err(`smoke: the test runner failed: ${run.error}\n`);
    const passed = run.tests.filter((t) => t.state === "passed").length;
    const failed = run.tests.filter((t) => t.state === "failed").length;
    const skipped = run.tests.length - passed - failed;
    if (run.tests.length === 0 && run.fileErrors.length === 0 && run.error === undefined) err(`smoke: no smoke test ran (${SMOKE_GLOB})\n`);
    out(`smoke: ${String(passed)} passed, ${String(failed)} failed${skipped > 0 ? `, ${String(skipped)} skipped` : ""}\n`);
    out(`smoke: log for today: ${location}\n`);

    const ok = passed > 0 && failed === 0 && skipped === 0 && run.fileErrors.length === 0 && run.error === undefined;
    const exitStatus = ok ? EXIT.ok : EXIT.failed;
    try {
      const paths = deps.writeEvidence({
        root: repo.root,
        git: repo.git,
        record: {
          runId: deps.newRunId(),
          commit,
          target,
          stage,
          command,
          startedAt: startedAt.toISOString(),
          finishedAt: deps.now().toISOString(),
          exitStatus,
          results: resultsOf(run),
          versions: deps.versions(),
        },
        raw: { "smoke.log": log, "tests.json": `${JSON.stringify(run, null, 2)}\n` },
        redactions: subdomainRedactions(baseUrl),
      });
      io.stdout(`smoke: evidence: ${relative(repo.root, paths.recordPath).split("\\").join("/")}\n`);
    } catch (error) {
      return fail(`writing the evidence record failed: ${describeFailure(error)}`);
    }
    return exitStatus;
  };
}

// ---------------------------------------------------------------------------------------------
// Real dependencies.

const require = createRequire(import.meta.url);

function packageVersion(path: string): string | undefined {
  const version = readJson(path)?.version;
  return typeof version === "string" ? version : undefined;
}

function versions(): Record<string, string> {
  const out: Record<string, string> = { node: process.version };
  const framework = packageVersion(fileURLToPath(new URL("../../../package.json", import.meta.url)));
  if (framework !== undefined) out["@lago-morph/prototype-framework"] = framework;
  for (const name of ["vitest", "wrangler"]) {
    try {
      const version = packageVersion(require.resolve(`${name}/package.json`));
      if (version !== undefined) out[name] = version;
    } catch {
      // not installed: not recorded
    }
  }
  return out;
}

/** Runs the smoke tests once with Vitest's Node API (the app's Vitest configuration is not read, as in `verify`). */
async function runSmokeTests(appDir: string, connection: SmokeConnection): Promise<SmokeTestRun> {
  const [{ startVitest }, { summarizeFiles }] = await Promise.all([import("vitest/node"), import("../verify/tests.js")]);
  const vitest = await startVitest([], {
    root: appDir,
    config: false,
    include: [SMOKE_GLOB],
    watch: false,
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fsModuleCache: false,
    silent: true,
    reporters: [{}],
    provide: { prototypeFrameworkSmoke: true },
    env: { [SMOKE_CONNECTION_ENV]: JSON.stringify(connection) },
  } as never);
  try {
    const summary = summarizeFiles(appDir, vitest.state.getFiles() as never);
    const unhandled = vitest.state.getUnhandledErrors().map((e) => ({ file: "(test run)", message: describeFailure(e) }));
    return { tests: summary.tests, fileErrors: [...summary.fileErrors, ...unhandled] };
  } finally {
    await vitest.close();
  }
}

/** `smoke` bound to the real recorded origins, app loader, git, Vitest and evidence writer. */
export async function smokeBinding(): Promise<Command> {
  const [{ loadApp }, evidence] = await Promise.all([import("../../build/load.js"), import("../../evidence/public.js")]);
  return smokeCommand({
    devServer: readDevServer,
    deployedOrigin: readDeployedOrigin,
    appName: async (appDir) => (await loadApp(appDir)).definition.name,
    repo: (appDir) => {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      return { root, git: evidence.gitState(root) };
    },
    runTests: runSmokeTests,
    writeEvidence: evidence.writeEvidence,
    newRunId: () => evidence.newRunId(),
    now: () => new Date(),
    versions,
  });
}
