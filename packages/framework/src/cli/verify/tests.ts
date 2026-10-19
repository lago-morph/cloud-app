/**
 * `verify` step 4 (CLI-REQ-002, LOCAL-REQ-003): the app's tests (PAR-116: Vitest, glob
 * `tests/**\/*.test.ts`) once per SQL dialect, each in its own process. The dialect is fixed
 * per process by `PROTOTYPE_FRAMEWORK_DIALECT` (DEC-PENDING-B-05-2). The child
 * (`test-runner-child.ts`) runs Vitest through its Node API with the framework's options only
 * (the app's Vitest configuration is not read), and writes a summary file the parent reads.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dialect } from "../../sql/dialect.js";
import type { TestCase, TestRun } from "../commands/verify.js";

/** PAR-116. */
export const TEST_GLOB = "tests/**/*.test.ts";

/**
 * Vitest options for an app's test run. Opening PGlite the first time in a process takes
 * several seconds, so tests and hooks get 60 s (the template's own setting).
 */
export function testRunnerOptions(appDir: string) {
  return {
    root: appDir,
    config: false as const,
    include: [TEST_GLOB],
    watch: false,
    passWithNoTests: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fsModuleCache: false,
    silent: true,
    reporters: [{}],
  };
}

/** The parts of Vitest's task tree the summary reads. */
interface TaskLike {
  readonly type: string;
  readonly name: string;
  readonly mode?: string;
  readonly filepath?: string;
  readonly tasks?: readonly TaskLike[];
  readonly result?: { readonly state?: string; readonly errors?: readonly { readonly message?: string }[] };
}

const messages = (t: TaskLike): string[] => (t.result?.errors ?? []).map((e) => e.message ?? "unknown error");

export function summarizeFiles(appDir: string, files: readonly TaskLike[]): Omit<TestRun, "error"> {
  const tests: TestCase[] = [];
  const fileErrors: { file: string; message: string }[] = [];
  for (const f of files) {
    const file = relative(appDir, f.filepath ?? f.name).split("\\").join("/");
    for (const message of messages(f)) fileErrors.push({ file, message });
    const walk = (tasks: readonly TaskLike[], path: readonly string[]): void => {
      for (const t of tasks) {
        if (t.type === "test") {
          const state = t.result?.state;
          tests.push({
            file,
            name: [...path, t.name].join(" > "),
            state: state === "pass" ? "passed" : state === "fail" ? "failed" : "skipped",
            errors: messages(t),
          });
        } else {
          for (const message of messages(t)) fileErrors.push({ file, message: `${[...path, t.name].join(" > ")}: ${message}` });
          walk(t.tasks ?? [], [...path, t.name]);
        }
      }
    };
    walk(f.tasks ?? [], []);
  }
  return { tests, fileErrors };
}

const CHILD = fileURLToPath(new URL("./test-runner-child.js", import.meta.url));

/** Runs the app's tests on one dialect in a separate process. */
export async function runAppTests(appDir: string, dialect: Dialect): Promise<TestRun> {
  const dir = mkdtempSync(join(tmpdir(), "verify-tests-"));
  const out = join(dir, "summary.json");
  try {
    const { status, output } = await new Promise<{ status: number | null; output: string }>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [CHILD, appDir, out], {
        cwd: appDir,
        env: { ...process.env, PROTOTYPE_FRAMEWORK_DIALECT: dialect, NO_COLOR: "1", FORCE_COLOR: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (d: Buffer) => (output += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (output += d.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolvePromise({ status: code, output }));
    });
    let summary: Omit<TestRun, "error"> | undefined;
    try {
      summary = JSON.parse(readFileSync(out, "utf8")) as Omit<TestRun, "error">;
    } catch {
      summary = undefined;
    }
    if (summary === undefined) return { tests: [], fileErrors: [], error: `the test runner exited with status ${String(status)} without results:\n${output.trim()}` };
    if (status !== 0) return { ...summary, error: `the test runner exited with status ${String(status)}:\n${output.trim()}` };
    return summary;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
