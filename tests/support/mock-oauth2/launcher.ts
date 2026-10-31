/**
 * mock-oauth2-server (navikt) for the auth app's integration suite: the local stand-in for
 * Cloudflare's OAuth endpoints (plan-v0.2.0 §4.3, §7a.1.4; DEC-0662).
 *
 * - With `MOCK_OAUTH2_URL` set (CI: a Docker service `ghcr.io/navikt/mock-oauth2-server:6.1.4`),
 *   that server is used as is.
 * - Otherwise it runs locally on Java 21: the runtime classpath is resolved once by Maven from
 *   `pom.xml` into `MOCK_OAUTH2_HOME` (default `~/.cache/prototype-framework/mock-oauth2-server/
 *   <version>`), through `MOCK_OAUTH2_MAVEN_MIRROR` (default: Google's Maven Central mirror, which
 *   answered when repo1/repo.maven.apache.org returned 429 through the sandbox proxy), then the
 *   standalone main class is started on a free port.
 *
 * Never skips: when neither is possible, it throws, naming what is missing.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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

/** The directory of jars, resolving it with Maven when it is not there yet. */
export function ensureClasspath(): string {
  const lib = join(home(), "lib");
  // `.complete` is written only after Maven succeeded, so an interrupted copy is resolved again.
  if (existsSync(join(lib, ".complete")) && readdirSync(lib).some((f) => f.startsWith(`mock-oauth2-server-${MOCK_OAUTH2_VERSION}`))) return lib;
  mkdirSync(home(), { recursive: true });
  const settings = join(home(), "settings.xml");
  const mirror = process.env.MOCK_OAUTH2_MAVEN_MIRROR ?? DEFAULT_MIRROR;
  writeFileSync(settings, `<settings><mirrors><mirror><id>mock-oauth2-mirror</id><mirrorOf>*</mirrorOf><url>${mirror}</url></mirror></mirrors></settings>\n`);
  const args = ["-q", "-B", "-s", settings, `-Dmaven.repo.local=${join(home(), "repo")}`, "-f", join(HERE, "pom.xml"), "dependency:copy-dependencies", `-DoutputDirectory=${lib}`, "-DincludeScope=runtime"];
  // Below the suite's 600 s hook timeout, so this message, not Vitest's, explains a slow resolve.
  const run = spawnSync("mvn", args, { encoding: "utf8", timeout: MAVEN_TIMEOUT_MS });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(`mock-oauth2-server: could not resolve its classpath with Maven into ${lib} (${run.error?.message ?? `exit ${run.status}`}). Install Maven and Java 21, or set MOCK_OAUTH2_URL to a running server.\n${(run.stdout ?? "").slice(-2000)}${(run.stderr ?? "").slice(-2000)}`);
  }
  writeFileSync(join(lib, ".complete"), `${MOCK_OAUTH2_VERSION}\n`);
  return lib;
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
