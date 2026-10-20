/**
 * The driver's real dependencies: processes, the local `dev` server of the reference app, the
 * cloud stage operations through the framework CLI, the pending-stage file and versions.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitState, newRunId, writeEvidence } from "../../../packages/framework/src/evidence/public.js";
import { readCatalogue, type Target } from "./catalogue.js";
import type { CloudStageOps, DriverDeps, LocalSession, PendingStages, RunCall } from "./driver.js";
import { waitFor } from "./wait.js";

/** The origin `dev` prints once the client and `/api` answer (cli.md `dev`). */
export function devOrigin(output: string): string | undefined {
  return /is running at (http:\/\/localhost:\d+)\//.exec(output)?.[1];
}

/** The stage's public origin in `deploy` output (PROV-REQ-002 "Publishing the result"). */
export function deployOrigin(output: string): string | undefined {
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

function runProcess(call: RunCall): Promise<{ status: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(call.command, [...call.args], { cwd: call.cwd, env: call.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      process.stderr.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => resolve({ status: 127, output: `${output}${error.message}\n` }));
    child.on("close", (code) => resolve({ status: code ?? 1, output }));
  });
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

function cliStageOps(repoRoot: string, target: Target): CloudStageOps {
  const cli = (args: string[]): Promise<{ status: number; output: string }> =>
    runProcess({ command: "npx", args: ["prototype-framework", ...args], cwd: join(repoRoot, "apps", "reference"), env: { ...(process.env as Record<string, string>), NODE_USE_ENV_PROXY: "1" } });
  return {
    async deploy(stage) {
      const result = await cli(["deploy", "--target", target, "--stage", stage]);
      if (result.status !== 0) throw new Error(`deploy --target ${target} --stage ${stage} failed with status ${String(result.status)}\n${result.output.slice(-2000)}`);
      const baseUrl = deployOrigin(result.output);
      if (baseUrl === undefined) throw new Error(`deploy --target ${target} --stage ${stage} printed no workers.dev origin`);
      return { baseUrl, output: result.output };
    },
    async remove(stage) {
      const result = await cli(["remove", "--target", target, "--stage", stage]);
      if (result.status !== 0) throw new Error(`remove --target ${target} --stage ${stage} failed with status ${String(result.status)}\n${result.output.slice(-2000)}`);
      return result.output;
    },
    listStageResources() {
      return Promise.reject(new Error(`listStageResources for ${target} is not wired into the compliance driver yet (PROV per-target operations; D-03/D-05)`));
    },
  };
}

export function nodeDeps(repoRoot: string): DriverDeps {
  return {
    repoRoot,
    git: gitState(repoRoot),
    catalogue: () => readCatalogue(join(repoRoot, "docs")),
    newRunId: () => newRunId(),
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
    cloud: (target) => {
      if (target === "aws") throw new Error("AWS phase not started");
      return cliStageOps(repoRoot, target);
    },
    pendingStages: pendingStageStore(join(repoRoot, ".framework", "compliance", "pending-stages.json")),
    writeEvidence,
    log: (line) => process.stdout.write(`${line}\n`),
  };
}
