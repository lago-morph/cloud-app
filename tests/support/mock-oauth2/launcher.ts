/**
 * mock-oauth2-server (navikt) for the auth app's and the admin app's tests: the local stand-in for
 * Cloudflare's OAuth endpoints (plan-v0.2.0 §4.3, §7a.1.4; DEC-0662 as superseded by DEC-0805).
 *
 * - With `MOCK_OAUTH2_URL` set, that server is used as is and nothing is started.
 * - Otherwise each call runs the pinned image `MOCK_OAUTH2_IMAGE` (the one CI runs; a unit test keeps
 *   the workflows on the same string) with `docker run`, in its own container with a unique name and a
 *   host port Docker picks on 127.0.0.1, so test files in parallel workers and runs in other worktrees
 *   never share one. It waits for the discovery document, and `stop()` removes the container. A failed
 *   start removes it too, and so does the process exiting or being interrupted (SIGINT, SIGTERM,
 *   SIGHUP) before `stop()`.
 *
 * Never skips: without `MOCK_OAUTH2_URL` and without a usable Docker, it throws, naming the remedy.
 */
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export const MOCK_OAUTH2_VERSION = "6.1.4";
/** The one pin of the server's image, by tag and digest. `.github/workflows/*.yml` must name exactly this. */
export const MOCK_OAUTH2_IMAGE = `ghcr.io/navikt/mock-oauth2-server:${MOCK_OAUTH2_VERSION}@sha256:647dd8c78a54f0e6fcd58d79c884e612f8f998a0662276f3e1db22e464a50192`;
/** Every container this launcher starts carries this label (`docker ps --filter label=…` finds leftovers). */
export const MOCK_OAUTH2_LABEL = "prototype-framework.mock-oauth2";
/** `docker run` pulls the image first when it is not local yet; below the suites' 600 s hook timeout. */
const RUN_TIMEOUT_MS = 300_000;
const READY_TIMEOUT_MS = 60_000;
const REMEDY = "Install Docker (and start its daemon), or set MOCK_OAUTH2_URL to a running mock-oauth2-server.";

export interface MockOAuth2 {
  /** Base URL of the server, e.g. `http://127.0.0.1:41234`; issuer `<base>/<issuerId>`. */
  readonly baseUrl: string;
  stop(): Promise<void>;
}

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: NodeJS.ErrnoException;
}

function docker(args: string[], timeoutMs = 30_000): Promise<Run> {
  return new Promise((resolve) => {
    execFile("docker", args, { encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const err = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
      const code = err === null ? 0 : typeof err.code === "number" ? err.code : null;
      resolve({ code, stdout, stderr, ...(err !== null && typeof err.code !== "number" ? { error: err } : {}) });
    });
  });
}

const tail = (r: Run): string => `${r.stdout}${r.stderr}`.trim().slice(-2000);

/** Containers started and not yet removed by this process, removed on exit or interruption. */
const live = new Set<string>();
let handlersInstalled = false;

function removeLiveSync(): void {
  for (const name of live) spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 15_000 });
  live.clear();
}

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.once("exit", removeLiveSync);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const onSignal = (): void => {
      removeLiveSync();
      // Keep the default outcome when nobody else handles it: die by the same signal.
      if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
    };
    process.once(signal, onSignal);
  }
}

async function ensureDocker(): Promise<void> {
  const r = await docker(["version", "--format", "{{.Server.Version}}"]);
  if (r.error?.code === "ENOENT") throw new Error(`mock-oauth2-server: Docker is not installed (no \`docker\` on PATH). ${REMEDY}`);
  if (r.code !== 0) throw new Error(`mock-oauth2-server: Docker is installed but its daemon does not answer (\`docker version\`: ${r.error?.message ?? `exit ${r.code}`}). Start the Docker daemon, or set MOCK_OAUTH2_URL to a running mock-oauth2-server.\n${tail(r)}`);
}

async function remove(name: string): Promise<void> {
  await docker(["rm", "-f", name], 30_000);
  live.delete(name);
}

async function waitUntilUp(baseUrl: string, timeoutMs: number, exited: () => Promise<string | null>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/default/.well-known/openid-configuration`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    const why = await exited();
    if (why !== null) throw new Error(why);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`mock-oauth2-server did not answer at ${baseUrl} within ${timeoutMs} ms`);
}

export async function startMockOAuth2(): Promise<MockOAuth2> {
  const external = process.env.MOCK_OAUTH2_URL;
  if (external !== undefined && external !== "") {
    const baseUrl = external.replace(/\/+$/, "");
    await waitUntilUp(baseUrl, 30_000, async () => null);
    return { baseUrl, stop: async () => undefined };
  }
  await ensureDocker();
  installHandlers();
  const name = `mock-oauth2-${process.pid}-${randomUUID().slice(0, 8)}`;
  // Registered before `run`, so an interruption while it pulls or starts still removes the container.
  live.add(name);
  try {
    const run = await docker(["run", "-d", "--rm", "--name", name, "--label", `${MOCK_OAUTH2_LABEL}=${process.pid}`, "-p", "127.0.0.1::8080", MOCK_OAUTH2_IMAGE], RUN_TIMEOUT_MS);
    if (run.code !== 0) throw new Error(`mock-oauth2-server: \`docker run ${MOCK_OAUTH2_IMAGE}\` failed (${run.error?.message ?? `exit ${run.code}`}).\n${tail(run)}`);
    const port = await docker(["port", name, "8080/tcp"]);
    const hostPort = /:(\d+)\s*$/m.exec(port.stdout)?.[1];
    if (port.code !== 0 || hostPort === undefined) throw new Error(`mock-oauth2-server: could not read the host port of container ${name}.\n${tail(port)}`);
    const baseUrl = `http://127.0.0.1:${hostPort}`;
    await waitUntilUp(baseUrl, READY_TIMEOUT_MS, async () => {
      const state = await docker(["inspect", "--format", "{{.State.Running}}", name]);
      if (state.code === 0 && state.stdout.trim() === "true") return null;
      const logs = await docker(["logs", "--tail", "50", name]);
      return `mock-oauth2-server: container ${name} stopped before it answered at ${baseUrl}.\n${tail(logs)}`;
    });
    return { baseUrl, stop: () => remove(name) };
  } catch (e) {
    await remove(name);
    throw e;
  }
}
