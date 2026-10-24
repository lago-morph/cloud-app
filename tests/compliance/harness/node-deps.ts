/**
 * The driver's real dependencies: processes, the local `dev` server of the reference app, the
 * cloud stage operations through the framework CLI, the pending-stage file and versions.
 */
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitState, newRunId, redact, writeEvidence } from "../../../packages/framework/src/evidence/public.js";
import { readCatalogue, type Target } from "./catalogue.js";
import { SecretsNotSetError, TEST_SECRET, type CloudStageOps, type DriverDeps, type LocalSession, type PendingStages, type RunCall } from "./driver.js";
import { REFERENCE_APP, stageLeftovers } from "./leftovers.js";
import { waitFor } from "./wait.js";
import type { TargetOperations } from "../../../packages/framework/src/provision/core/operations.js";
import { targetOperations } from "../../../packages/framework/src/cli/commands/operations.js";
import { awsChildEnvironment } from "../../../packages/framework/src/cli/commands/aws-operations.js";
import { awsAccount } from "../../../packages/framework/src/provision/aws/account.js";
import { cloudProcessProblems } from "../../../packages/framework/src/cli/commands/smoke-cloud.js";

/** The origin `dev` prints once the client and `/api` answer (cli.md `dev`). */
export function devOrigin(output: string): string | undefined {
  return /is running at (http:\/\/localhost:\d+)\//.exec(output)?.[1];
}

/**
 * The stage's public origin in `deploy` output (PROV-REQ-002 "Publishing the result"): the
 * `workers.dev` URL on Cloudflare, the CloudFront URL on AWS (aws.md §2: the public origin is the
 * CloudFront URL, never the Function URL).
 */
export function deployOrigin(output: string, target: Target = "cloudflare"): string | undefined {
  if (target === "aws") return /(https:\/\/[a-z0-9]+\.cloudfront\.net)\b/.exec(output)?.[1];
  return /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev)\b/.exec(output)?.[1];
}

export function pendingStageStore(path: string): PendingStages {
  const read = (): Record<string, string[]> => {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, string[]>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string[]>): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  };
  return {
    list: (target) => read()[target] ?? [],
    add: (target, stage) => {
      const data = read();
      data[target] = [...new Set([...(data[target] ?? []), stage])];
      write(data);
    },
    remove: (target, stage) => {
      const data = read();
      data[target] = (data[target] ?? []).filter((s) => s !== stage);
      write(data);
    },
  };
}

const VERSIONED = ["vitest", "@playwright/test", "wrangler", "typescript", "drizzle-orm", "drizzle-kit", "hono", "zod", "@electric-sql/pglite", "esbuild", "sst"];

export function readVersions(repoRoot: string): Record<string, string> {
  const versionOf = (path: string): string | undefined => {
    try {
      return (JSON.parse(readFileSync(path, "utf8")) as { version?: string }).version;
    } catch {
      return undefined;
    }
  };
  const out: Record<string, string> = { node: process.version };
  const framework = versionOf(join(repoRoot, "packages", "framework", "package.json"));
  if (framework !== undefined) out["@lago-morph/prototype-framework"] = framework;
  for (const name of VERSIONED) {
    const version = versionOf(join(repoRoot, "node_modules", name, "package.json"));
    if (version !== undefined) out[name] = version;
  }
  return out;
}

/** Runs a process; its output is echoed live (to stderr by default) and returned. */
export function runProcess(call: RunCall, echo: (text: string) => void = (text) => void process.stderr.write(text)): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    const hidden = (call.redact ?? []).filter((v) => v !== "").map((value) => ({ value, replacement: TEST_SECRET.replacement }));
    const child = spawn(call.command, [...call.args], { cwd: call.cwd, env: call.env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    // With values to hide, the live echo goes out a whole line at a time, so a value split across
    // two chunks is still replaced (the returned output is redacted by the evidence writer).
    const pending = { stdout: "", stderr: "" };
    const take = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      if (hidden.length === 0) return void echo(text);
      const lines = (pending[stream] + text).split("\n");
      pending[stream] = lines.pop() ?? "";
      if (lines.length > 0) echo(redact(`${lines.join("\n")}\n`, hidden));
    };
    const flush = (): void => {
      for (const stream of ["stdout", "stderr"] as const) if (pending[stream] !== "") echo(redact(pending[stream], hidden));
    };
    child.stdout.on("data", take("stdout"));
    child.stderr.on("data", take("stderr"));
    // Standard input is closed at once: empty unless a value is given (as `ignore` was before).
    child.stdin.on("error", () => undefined);
    child.stdin.end(call.input ?? "");
    child.on("error", (error) => (flush(), resolve({ status: 127, output: `${output}${error.message}\n` })));
    child.on("close", (code) => (flush(), resolve({ status: code ?? 1, output })));
  });
}

/** A long random value of letters and digits for the run stage's test secret (DEC-0277). */
export function generateTestSecret(length = 32): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** True when a failed deploy stopped only on unset secrets (provision core: the step-5 check or the preflight). */
export function secretsNotSet(output: string): boolean {
  return /required secrets are not set:|secret \S+ is not set \(set it with secrets set\)/.test(output);
}

const DEV_START_MS = 180_000;
const DEV_STOP_MS = 20_000;

/** Starts `dev` for the reference app and resolves once it prints its origin (bounded). */
function startReferenceDev(repoRoot: string): Promise<LocalSession> {
  const child = spawn("npx", ["prototype-framework", "dev"], { cwd: join(repoRoot, "apps", "reference"), env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  let exited: number | null | undefined;
  child.stdout.on("data", (c: Buffer) => (output += c.toString("utf8")));
  child.stderr.on("data", (c: Buffer) => (output += c.toString("utf8")));
  const closed = new Promise<void>((resolve) => child.on("close", (code) => ((exited = code), resolve())));
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, name);
    } catch {
      // already gone
    }
  };
  const stop = async (): Promise<string> => {
    if (exited === undefined) {
      signal("SIGINT");
      const timer = setTimeout(() => signal("SIGKILL"), DEV_STOP_MS);
      await closed;
      clearTimeout(timer);
    }
    return output;
  };
  return waitFor(
    () => {
      if (exited !== undefined) return Promise.reject(new Error(`dev exited with status ${String(exited)} before serving:\n${output.slice(-2000)}`));
      const origin = devOrigin(output);
      return Promise.resolve(origin === undefined ? undefined : { baseUrl: origin, stop });
    },
    { what: "the reference app's dev server", timeoutMs: DEV_START_MS, intervalMs: 500 },
  ).catch(async (error: unknown) => {
    await stop();
    throw error;
  });
}

/** Builds a target's PROV operations as `remove` builds them (the framework's per-target `targetOperations`, D-05, G-11). */
export type OperationsFactory = (options: { readonly env: Readonly<Record<string, string | undefined>>; readonly requireCredentials: boolean; readonly fetch?: typeof fetch }) => (input: { readonly appDir: string; readonly target: Target }) => Pick<TargetOperations, "listStageResources">;

/**
 * The target's PROV operations (PROV §2), for the leftover check (compliance.md "Test stages":
 * by exact name, using `listStageResources`). These are the framework's own operations, wired
 * exactly as `remove` wires them (`targetOperations`, the per-target factory; decision D-06-2):
 * Cloudflare's D-03 operations, or on AWS G-10's `TargetOperations` (wired by G-11). A failure to
 * build them (missing credentials, for example) rejects, and the driver records it as a failed
 * leftover check, never as "no leftovers". Tests pass a fake target's operations as `operations`.
 * The check runs in the driver's process, so behind a proxy the driver itself must be started with
 * `NODE_USE_ENV_PROXY=1` (DEC-0085); otherwise, and without credentials, this rejects before any
 * request and the driver records the failure as a leftover entry.
 */
export async function stageResourceOperations(
  repoRoot: string,
  target: Target,
  options: { readonly env: Readonly<Record<string, string | undefined>>; readonly fetch?: typeof fetch; readonly operations?: OperationsFactory },
): Promise<Pick<TargetOperations, "listStageResources">> {
  if (target === "local") throw new Error("the local target has no stage resources");
  const problems = cloudProcessProblems(options.env);
  if (problems.length > 0) throw new Error(`the leftover check cannot reach ${target === "aws" ? "AWS" : "Cloudflare"}: ${problems.join("; ")}`);
  const factory: OperationsFactory = options.operations ?? targetOperations;
  const make = factory({ env: options.env, requireCredentials: true, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) });
  return make({ appDir: join(repoRoot, "apps", REFERENCE_APP), target });
}

/** The AWS usage parts of the stage operations: the cluster count and the driver's own call count (the G-T1 hooks, loaded only on AWS). */
async function awsUsageHooks(): Promise<{
  testStageClusters(env: Readonly<Record<string, string | undefined>>): Promise<string[]>;
  accountLambdaFunctions(): Promise<string[]>;
  awsCallCount(): number;
}> {
  const [usage, api] = await Promise.all([import("../criteria/_cloud/aws/usage.js"), import("../criteria/_cloud/aws/api.js")]);
  return { testStageClusters: usage.testStageClusters, accountLambdaFunctions: usage.accountLambdaFunctions, awsCallCount: api.awsCallCount };
}

/** Reads the AWS account's region, given the CLI's AWS child environment (default: `defaultAccountRegion`). */
export type AccountRegionReader = (env: Readonly<Record<string, string | undefined>>) => Promise<string>;

/**
 * The AWS account's region as the framework reads it for `deploy` and `smoke` (DEC-0075, DEC-0476):
 * G-07's account operations, so STS `GetCallerIdentity` and the log bucket's location (PAR-060
 * when the account has no log bucket yet, whose deploy preflight then fails on its own).
 */
export const defaultAccountRegion: AccountRegionReader = (env) => awsAccount({ env }).region();

export function cliStageOps(
  repoRoot: string,
  target: Target,
  options: {
    readonly operations?: OperationsFactory;
    readonly run?: (call: RunCall) => Promise<{ status: number; output: string }>;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly accountRegion?: AccountRegionReader;
  } = {},
): CloudStageOps {
  const runner = options.run ?? runProcess;
  const env = options.env ?? process.env;
  // G-EV F3: operations built on a fake runner or factory say so, and the driver marks the record.
  const fakes = [...(options.run === undefined ? [] : ["fake framework CLI runner"]), ...(options.operations === undefined ? [] : ["fake stage operations (OperationsFactory)"])];
  let ownCalls = (): number => 0;
  const cli = (args: string[], input?: string): Promise<{ status: number; output: string }> =>
    runner({
      command: "npx",
      args: ["prototype-framework", ...args],
      cwd: join(repoRoot, "apps", "reference"),
      env: { ...(process.env as Record<string, string>), NODE_USE_ENV_PROXY: "1" },
      ...(input === undefined ? {} : { input, redact: [input] }),
    });
  return {
    ...(fakes.length === 0 ? {} : { dryRun: fakes.join("; ") }),
    async deploy(stage) {
      const result = await cli(["deploy", "--target", target, "--stage", stage]);
      if (result.status !== 0) {
        const message = `deploy --target ${target} --stage ${stage} failed with status ${String(result.status)}\n${result.output.slice(-2000)}`;
        throw secretsNotSet(result.output) ? new SecretsNotSetError(message, result.output) : new Error(message);
      }
      const baseUrl = deployOrigin(result.output, target);
      if (baseUrl === undefined) throw new Error(`deploy --target ${target} --stage ${stage} printed no ${target === "aws" ? "CloudFront" : "workers.dev"} origin`);
      return { baseUrl, output: result.output };
    },
    async remove(stage) {
      const result = await cli(["remove", "--target", target, "--stage", stage]);
      if (result.status !== 0) throw new Error(`remove --target ${target} --stage ${stage} failed with status ${String(result.status)}\n${result.output.slice(-2000)}`);
      return result.output;
    },
    async setSecret(stage, name, value) {
      // The framework's own path (D-05, DEC-0354): one PUT of the Worker secret; the value only on standard input.
      const result = await cli(["secrets", "set", name, "--target", target, "--stage", stage], value);
      const output = redact(result.output, [{ value, replacement: TEST_SECRET.replacement }]);
      if (result.status !== 0) throw new Error(`secrets set ${name} --target ${target} --stage ${stage} failed with status ${String(result.status)}\n${output.slice(-2000)}`);
      return output;
    },
    async listStageResources(stage) {
      return stageLeftovers(await stageResourceOperations(repoRoot, target, { env, ...(options.operations === undefined ? {} : { operations: options.operations }) }), { app: REFERENCE_APP, stage });
    },
    ...(target === "aws"
      ? {
          region: () => (options.accountRegion ?? defaultAccountRegion)(awsChildEnvironment(env)),
          async testStageClusters(region) {
            const hooks = await awsUsageHooks();
            ownCalls = hooks.awsCallCount;
            return hooks.testStageClusters({ ...env, AWS_REGION: region, AWS_DEFAULT_REGION: region });
          },
          async lambdaFunctions() {
            const hooks = await awsUsageHooks();
            ownCalls = hooks.awsCallCount;
            return hooks.accountLambdaFunctions();
          },
          apiCalls: () => ownCalls(),
        }
      : {}),
  };
}

export function nodeDeps(repoRoot: string): DriverDeps {
  return {
    repoRoot,
    git: gitState(repoRoot),
    catalogue: () => readCatalogue(join(repoRoot, "docs")),
    newRunId: () => newRunId(),
    newTestSecret: () => generateTestSecret(),
    now: () => new Date(),
    versions: () => readVersions(repoRoot),
    tempDir: () => mkdtempSync(join(tmpdir(), "compliance-")),
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    run: runProcess,
    startLocal: () => startReferenceDev(repoRoot),
    cloud: (target) => cliStageOps(repoRoot, target),
    pendingStages: pendingStageStore(join(repoRoot, ".framework", "compliance", "pending-stages.json")),
    writeEvidence,
    log: (line) => process.stdout.write(`${line}\n`),
  };
}
