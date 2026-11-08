/**
 * mock-oauth2-server (navikt) for the auth app's integration suite: the local stand-in for
 * Cloudflare's OAuth endpoints (plan-v0.2.0 §4.3, §7a.1.4; DEC-0662).
 *
 * - With `MOCK_OAUTH2_URL` set (CI: a Docker service `ghcr.io/navikt/mock-oauth2-server:6.1.4`),
 *   that server is used as is.
 * - Otherwise it runs locally on Java 21: the runtime classpath is resolved once by Maven from
 *   `pom.xml` and published as `classpath/` in `MOCK_OAUTH2_HOME` (default
 *   `~/.cache/prototype-framework/mock-oauth2-server/<version>`), through `MOCK_OAUTH2_MAVEN_MIRROR`
 *   (default: Google's Maven Central mirror, which answered when repo1/repo.maven.apache.org
 *   returned 429 through the sandbox proxy), then the standalone main class is started on a free
 *   port.
 * - Callers may build at the same time: test files in parallel workers, or runs in other worktrees
 *   that share the home. Each build uses a private staging folder (its own settings, Maven
 *   repository and output), and publishes it with one rename that never replaces a published
 *   `classpath/` (root cause ai/implementation/root-causes/2026-11-08-rc01-mock-oauth2-classpath-race.md).
 *
 * Never skips: when neither is possible, it throws, naming what is missing.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MOCK_OAUTH2_VERSION = "6.1.4";
const MAIN_CLASS = "no.nav.security.mock.oauth2.StandaloneMockOAuth2ServerKt";
const MAVEN_TIMEOUT_MS = 540_000;
const DEFAULT_MIRROR = "https://maven-central.storage-download.googleapis.com/maven2";
const HERE = dirname(fileURLToPath(import.meta.url));

export interface MockOAuth2 {
  /** Base URL of the server, e.g. `http://127.0.0.1:41234`; issuer `<base>/<issuerId>`. */
  readonly baseUrl: string;
  stop(): Promise<void>;
}

const home = (): string => process.env.MOCK_OAUTH2_HOME ?? join(homedir(), ".cache", "prototype-framework", "mock-oauth2-server", MOCK_OAUTH2_VERSION);

/** A complete classpath: `.complete` (written only after Maven succeeded) and the server's jar. */
const isComplete = (dir: string): boolean => existsSync(join(dir, ".complete")) && readdirSync(dir).some((f) => f.startsWith(`mock-oauth2-server-${MOCK_OAUTH2_VERSION}`));

/**
 * The directory of jars, resolving it with Maven when it is not there yet. The old code's `lib/`,
 * `repo/` and `settings.xml` in the home are ignored: never read, moved or deleted.
 */
export function ensureClasspath(): string {
  const classpath = join(home(), "classpath");
  if (isComplete(classpath)) return classpath;
  // Nothing Maven writes is shared with another caller. A staging folder left by a killed process
  // is never read again; it is not removed by others, because it may belong to a live caller.
  const staging = join(home(), `staging-${process.pid}-${randomUUID()}`);
  mkdirSync(staging, { recursive: true });
  try {
    const settings = join(staging, "settings.xml");
    const lib = join(staging, "lib"); // created by Maven
    const mirror = process.env.MOCK_OAUTH2_MAVEN_MIRROR ?? DEFAULT_MIRROR;
    writeFileSync(settings, `<settings><mirrors><mirror><id>mock-oauth2-mirror</id><mirrorOf>*</mirrorOf><url>${mirror}</url></mirror></mirrors></settings>\n`);
    const args = ["-q", "-B", "-s", settings, `-Dmaven.repo.local=${join(staging, "repo")}`, "-f", join(HERE, "pom.xml"), "dependency:copy-dependencies", `-DoutputDirectory=${lib}`, "-DincludeScope=runtime"];
    // Below the suite's 600 s hook timeout, so this message, not Vitest's, explains a slow resolve.
    const run = spawnSync("mvn", args, { encoding: "utf8", timeout: MAVEN_TIMEOUT_MS });
    if (run.error !== undefined || run.status !== 0) {
      throw new Error(`mock-oauth2-server: could not resolve its classpath with Maven into ${classpath} (${run.error?.message ?? `exit ${run.status}`}). Install Maven and Java 21, or set MOCK_OAUTH2_URL to a running server.\n${(run.stdout ?? "").slice(-2000)}${(run.stderr ?? "").slice(-2000)}`);
    }
    writeFileSync(join(lib, ".complete"), `${MOCK_OAUTH2_VERSION}\n`);
    try {
      // Atomic, and it fails when `classpath/` already exists with content, so a published classpath
      // is never replaced or written to again.
      renameSync(lib, classpath);
    } catch (e) {
      // Another caller published first. Any other failure is an error (the code differs by platform).
      if (!isComplete(classpath)) throw e;
    }
    return classpath;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(baseUrl: string, child: ChildProcess | null, timeoutMs: number, output: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child !== null && child.exitCode !== null) throw new Error(`mock-oauth2-server exited with ${child.exitCode}:\n${output()}`);
    try {
      const res = await fetch(`${baseUrl}/default/.well-known/openid-configuration`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`mock-oauth2-server did not answer at ${baseUrl} within ${timeoutMs} ms:\n${output()}`);
}

export async function startMockOAuth2(): Promise<MockOAuth2> {
  const external = process.env.MOCK_OAUTH2_URL;
  if (external !== undefined && external !== "") {
    const baseUrl = external.replace(/\/+$/, "");
    await waitUntilUp(baseUrl, null, 30_000, () => "");
    return { baseUrl, stop: async () => undefined };
  }
  const lib = ensureClasspath();
  const port = await freePort();
  let out = "";
  const child = spawn("java", ["-cp", join(lib, "*"), MAIN_CLASS], { env: { ...process.env, SERVER_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-4000)));
  child.stderr?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-4000)));
  const spawned = new Promise<void>((resolve, reject) => {
    child.once("spawn", () => resolve());
    child.once("error", (e) => reject(new Error(`mock-oauth2-server: could not start java (${e.message}). Install Java 21, or set MOCK_OAUTH2_URL.`)));
  });
  await spawned;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitUntilUp(baseUrl, child, 60_000, () => `(port ${port} was free when chosen; another process may have taken it)\n${out}`);
  } catch (e) {
    child.kill("SIGKILL");
    throw e;
  }
  return {
    baseUrl,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
        child.once("exit", () => {
          clearTimeout(force);
          resolve();
        });
        child.kill("SIGTERM");
      }),
  };
}
