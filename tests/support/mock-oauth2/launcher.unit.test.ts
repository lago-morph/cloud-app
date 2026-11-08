// ensureClasspath() (launcher.ts) against a fake `mvn`, in child processes as the test files that start
// the mock server call it (root cause ai/implementation/root-causes/2026-11-08-rc01-mock-oauth2-classpath-race.md,
// attempt 2). The concurrent case holds both callers inside `mvn` until both have entered it (a barrier),
// so neither can take the fast path, whichever code runs.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const LAUNCHER = join(import.meta.dirname, "launcher.ts");
const JAR = "mock-oauth2-server-6.1.4.jar";

/**
 * A fake `mvn`. It records its PID, -DoutputDirectory, -Dmaven.repo.local and -s, then waits until
 * FAKE_MVN_BARRIER invocations have registered (exit 3 after 30 s). Then it creates its output
 * directory itself, as Maven does, and writes the server jar (holding its PID) and one more jar.
 * With FAKE_MVN_EXIT set, it writes a partial jar and exits with that code instead.
 */
const FAKE_MVN = `#!/bin/sh
out=; repo=; settings=; prev=
for a in "$@"; do
  case "$a" in
    -DoutputDirectory=*) out="\${a#-DoutputDirectory=}" ;;
    -Dmaven.repo.local=*) repo="\${a#-Dmaven.repo.local=}" ;;
  esac
  if [ "$prev" = "-s" ]; then settings="$a"; fi
  prev="$a"
done
printf '%s\\n%s\\n%s\\n%s\\n' "$$" "$out" "$repo" "$settings" > "$FAKE_MVN_LOG/.tmp-$$"
mv "$FAKE_MVN_LOG/.tmp-$$" "$FAKE_MVN_LOG/inv-$$"
deadline=$(( $(date +%s) + 30 ))
while [ "$(ls "$FAKE_MVN_LOG" | grep -c '^inv-')" -lt "\${FAKE_MVN_BARRIER:-1}" ]; do
  if [ "$(date +%s)" -ge "$deadline" ]; then echo "barrier timeout" >&2; exit 3; fi
  sleep 0.02
done
mkdir -p "$out"
if [ -n "$FAKE_MVN_EXIT" ]; then printf partial > "$out/${JAR}"; exit "$FAKE_MVN_EXIT"; fi
printf '%s' "$$" > "$out/${JAR}"
printf x > "$out/other.jar"
`;

interface World {
  readonly home: string;
  readonly log: string;
  readonly bin: string;
}

function world(): World {
  const root = mkdtempSync(join(tmpdir(), "mock-oauth2-launcher-"));
  const w = { home: join(root, "home"), log: join(root, "log"), bin: join(root, "bin") };
  for (const d of [w.log, w.bin]) mkdirSync(d);
  writeFileSync(join(w.bin, "mvn"), FAKE_MVN);
  chmodSync(join(w.bin, "mvn"), 0o755);
  return w;
}

interface Call {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** One child process that imports launcher.ts and calls ensureClasspath() once, printing the result. */
function call(w: World, env: Record<string, string> = {}): Promise<Call> {
  const script = `const { ensureClasspath } = await import(${JSON.stringify(pathToFileURL(LAUNCHER).href)}); process.stdout.write(ensureClasspath());`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, PATH: `${w.bin}:${process.env.PATH ?? ""}`, MOCK_OAUTH2_HOME: w.home, FAKE_MVN_LOG: w.log, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  return new Promise((resolve) => child.once("close", (code) => resolve({ code, stdout, stderr })));
}

/** The fake `mvn`'s invocations: PID, output directory, repository, settings file. */
function invocations(w: World): { pid: string; out: string; repo: string; settings: string }[] {
  return readdirSync(w.log)
    .filter((f) => f.startsWith("inv-"))
    .map((f) => {
      const [pid = "", out = "", repo = "", settings = ""] = readFileSync(join(w.log, f), "utf8").split("\n");
      return { pid, out, repo, settings };
    });
}

/** A complete classpath directory as a successful build leaves it. */
function complete(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, JAR), "earlier");
  writeFileSync(join(dir, ".complete"), "6.1.4\n");
}

const snapshot = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const staging = (w: World): string[] => (existsSync(w.home) ? readdirSync(w.home).filter((f) => f.startsWith("staging-")) : []);

describe("ensureClasspath (mock-oauth2-server's classpath)", () => {
  it("two concurrent callers build in private folders, one publishes classpath/, and both return it", async () => {
    const w = world();
    const [a, b] = await Promise.all([call(w, { FAKE_MVN_BARRIER: "2" }), call(w, { FAKE_MVN_BARRIER: "2" })]);
    const classpath = join(w.home, "classpath");
    expect([a.code, b.code], `${a.stderr}\n${b.stderr}`).toEqual([0, 0]);

    // Both callers were inside Maven at once; neither may share a path Maven writes with the other.
    const inv = invocations(w);
    expect(inv).toHaveLength(2);
    const [x, y] = inv as [(typeof inv)[0], (typeof inv)[0]];
    expect(x.out, "distinct Maven output directories").not.toBe(y.out);
    expect(x.repo, "distinct Maven repositories").not.toBe(y.repo);
    expect(x.settings, "distinct settings files").not.toBe(y.settings);
    for (const i of inv) {
      expect([classpath, join(w.home, "lib")]).not.toContain(i.out);
      expect(i.repo).not.toBe(join(w.home, "repo"));
    }

    expect([a.stdout, b.stdout], "both return the published classpath/").toEqual([classpath, classpath]);
    expect(existsSync(join(classpath, ".complete"))).toBe(true);
    expect(inv.map((i) => i.pid), "the published jar came from exactly one build").toContain(readFileSync(join(classpath, JAR), "utf8"));
    expect(staging(w), "no staging folder is left").toEqual([]);
  }, 90_000);

  it("returns a published classpath/ without running Maven", async () => {
    const w = world();
    complete(join(w.home, "classpath"));
    const r = await call(w);
    expect(r, r.stderr).toMatchObject({ code: 0, stdout: join(w.home, "classpath") });
    expect(invocations(w)).toEqual([]);
  });

  it("ignores the old lib/: builds and publishes classpath/, and leaves lib/ as it was", async () => {
    const w = world();
    const lib = join(w.home, "lib");
    complete(lib);
    const before = snapshot(lib);
    const r = await call(w);
    expect(r, r.stderr).toMatchObject({ code: 0, stdout: join(w.home, "classpath") });
    expect(invocations(w)).toHaveLength(1);
    expect(existsSync(join(w.home, "classpath", ".complete"))).toBe(true);
    expect(snapshot(lib)).toEqual(before);
    expect(staging(w)).toEqual([]);
  });

  it("a Maven failure throws the launcher's message and leaves no classpath/ and no staging folder", async () => {
    const w = world();
    const r = await call(w, { FAKE_MVN_EXIT: "1" });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/mock-oauth2-server: could not resolve its classpath with Maven into .* \(exit 1\)\. Install Maven and Java 21, or set MOCK_OAUTH2_URL/);
    expect(invocations(w)).toHaveLength(1);
    expect(existsSync(join(w.home, "classpath"))).toBe(false);
    expect(staging(w)).toEqual([]);
  });
});
