// startMockOAuth2() (launcher.ts) against a fake `docker` first on PATH (DEC-0805). The fake records
// every invocation; `docker port` answers with a port the test chooses, so "ready" is a loopback HTTP
// server of the test's own, and "never ready" is a port nobody listens on. Interruption runs in a child
// process, which the test sends SIGTERM.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_OAUTH2_IMAGE, MOCK_OAUTH2_LABEL, startMockOAuth2 } from "./launcher.js";

const LAUNCHER = join(import.meta.dirname, "launcher.ts");
const ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * A fake `docker`. Each call appends one line, its arguments joined by spaces, to $FAKE_DOCKER_LOG.
 * FAKE_DOCKER_DAEMON=down makes `version` fail as a stopped daemon does; FAKE_DOCKER_RUN_EXIT makes
 * `run` fail; FAKE_DOCKER_RUNNING (default true) is what `inspect` reports.
 */
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  version) if [ "$FAKE_DOCKER_DAEMON" = down ]; then echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1; fi; echo 29.1.3 ;;
  run) if [ -n "$FAKE_DOCKER_RUN_EXIT" ]; then echo "pull access denied" >&2; exit "$FAKE_DOCKER_RUN_EXIT"; fi; echo 0123456789abcdef ;;
  port) echo "127.0.0.1:$FAKE_DOCKER_PORT" ;;
  inspect) echo "\${FAKE_DOCKER_RUNNING:-true}" ;;
  logs) echo "fake container log line" ;;
  rm) echo "$3" ;;
esac
`;

interface World {
  readonly bin: string;
  readonly log: string;
}

function world(): World {
  const dir = mkdtempSync(join(tmpdir(), "mock-oauth2-launcher-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "docker"), FAKE_DOCKER);
  chmodSync(join(bin, "docker"), 0o755);
  return { bin, log: join(dir, "docker.log") };
}

const calls = (w: World): string[] => (existsSync(w.log) ? readFileSync(w.log, "utf8").trim().split("\n") : []);
const named = (line: string): string => /--name (\S+)/.exec(line)?.[1] ?? "";

/** A loopback server that answers the discovery document, as a started container would. */
async function discovery(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.writeHead(req.url === "/default/.well-known/openid-configuration" ? 200 : 404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise((r) => server.close(() => r())) };
}

/** A port nobody listens on (bound once, then closed). */
async function deadPort(): Promise<number> {
  const d = await discovery();
  await d.close();
  return d.port;
}

let w: World;
beforeEach(() => {
  w = world();
  vi.stubEnv("PATH", `${w.bin}:${process.env.PATH ?? ""}`);
  vi.stubEnv("FAKE_DOCKER_LOG", w.log);
  vi.stubEnv("MOCK_OAUTH2_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("startMockOAuth2 (mock-oauth2-server from its pinned Docker image)", () => {
  it("with MOCK_OAUTH2_URL set, uses that server and never calls docker", async () => {
    const d = await discovery();
    vi.stubEnv("MOCK_OAUTH2_URL", `http://127.0.0.1:${d.port}/`);
    const oauth = await startMockOAuth2();
    expect(oauth.baseUrl).toBe(`http://127.0.0.1:${d.port}`);
    await oauth.stop();
    await d.close();
    expect(calls(w)).toEqual([]);
  });

  it("runs the pinned image in a uniquely named, labelled, self-removing container on a 127.0.0.1 port Docker picks, waits for it, and stop() removes it", async () => {
    const d = await discovery();
    vi.stubEnv("FAKE_DOCKER_PORT", String(d.port));
    const [a, b] = await Promise.all([startMockOAuth2(), startMockOAuth2()]);
    expect(a.baseUrl).toBe(`http://127.0.0.1:${d.port}`);
    const runs = calls(w).filter((l) => l.startsWith("run "));
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(run.split(" ")).toEqual(["run", "-d", "--rm", "--name", named(run), "--label", `${MOCK_OAUTH2_LABEL}=${process.pid}`, "-p", "127.0.0.1::8080", MOCK_OAUTH2_IMAGE]);
      expect(named(run)).toMatch(new RegExp(`^mock-oauth2-${process.pid}-[0-9a-f]{8}$`));
    }
    const [nameA, nameB] = runs.map(named);
    expect(nameA).not.toBe(nameB);
    expect(calls(w).filter((l) => l.startsWith("rm "))).toEqual([]);
    await a.stop();
    await b.stop();
    expect(calls(w).filter((l) => l.startsWith("rm ")).sort()).toEqual([`rm -f ${nameA}`, `rm -f ${nameB}`].sort());
    await d.close();
  });

  it("without docker on PATH, fails saying to install Docker or set MOCK_OAUTH2_URL", async () => {
    vi.stubEnv("PATH", join(w.bin, "..", "empty"));
    await expect(startMockOAuth2()).rejects.toThrow(/Docker is not installed \(no `docker` on PATH\)\. Install Docker \(and start its daemon\), or set MOCK_OAUTH2_URL/);
  });

  it("with the daemon down, fails saying to start it or set MOCK_OAUTH2_URL, and starts nothing", async () => {
    vi.stubEnv("FAKE_DOCKER_DAEMON", "down");
    await expect(startMockOAuth2()).rejects.toThrow(/daemon does not answer.*Start the Docker daemon, or set MOCK_OAUTH2_URL[\s\S]*Cannot connect to the Docker daemon/);
    expect(calls(w)).toEqual(["version --format {{.Server.Version}}"]);
  });

  it("when docker run fails, throws its output and leaves no container", async () => {
    vi.stubEnv("FAKE_DOCKER_RUN_EXIT", "125");
    await expect(startMockOAuth2()).rejects.toThrow(/`docker run ghcr\.io\/navikt\/mock-oauth2-server:6\.1\.4@sha256:[0-9a-f]{64}` failed \(exit 125\)[\s\S]*pull access denied/);
    const name = named(calls(w).find((l) => l.startsWith("run "))!);
    expect(calls(w).at(-1)).toBe(`rm -f ${name}`);
  });

  it("when the container stops before it answers, throws its log and removes it", async () => {
    vi.stubEnv("FAKE_DOCKER_PORT", String(await deadPort()));
    vi.stubEnv("FAKE_DOCKER_RUNNING", "false");
    await expect(startMockOAuth2()).rejects.toThrow(/container mock-oauth2-\d+-[0-9a-f]{8} stopped before it answered[\s\S]*fake container log line/);
    const name = named(calls(w).find((l) => l.startsWith("run "))!);
    expect(calls(w).at(-1)).toBe(`rm -f ${name}`);
  });

  it("removes its container when the process is interrupted (SIGTERM) while waiting, and still dies by the signal", async () => {
    const script = `const { startMockOAuth2 } = await import(${JSON.stringify(pathToFileURL(LAUNCHER).href)}); await startMockOAuth2();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, PATH: `${w.bin}:${process.env.PATH ?? ""}`, FAKE_DOCKER_LOG: w.log, FAKE_DOCKER_PORT: String(await deadPort()), MOCK_OAUTH2_URL: "" },
      stdio: "ignore",
    });
    const exited = new Promise<NodeJS.Signals | null>((r) => child.once("exit", (_code, signal) => r(signal)));
    const deadline = Date.now() + 20_000;
    while (!calls(w).some((l) => l.startsWith("inspect ")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.kill("SIGTERM");
    expect(await exited).toBe("SIGTERM");
    const name = named(calls(w).find((l) => l.startsWith("run "))!);
    expect(name).not.toBe("");
    expect(calls(w)).toContain(`rm -f ${name}`);
  });
});

describe("the image pin is one string", () => {
  it("every workflow that names mock-oauth2-server's image names MOCK_OAUTH2_IMAGE exactly", () => {
    const dir = join(ROOT, ".github", "workflows");
    const named = readdirSync(dir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/\S*mock-oauth2-server:\S*/g)].map((m) => ({ f, image: m[0] })));
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(n, n.f).toEqual({ f: n.f, image: MOCK_OAUTH2_IMAGE });
  });
});
