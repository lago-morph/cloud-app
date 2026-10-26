import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readDevVars } from "../../secrets/dev-vars.js";
import { ensureEnvCloudflareIgnored } from "../cloudflare/git-safety.js";
import { describeLocalSetup, KEEP_TRACKED_MARKER, runLocalSetup, type LocalSetupDeps } from "./local-setup.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}, { repo = true } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "local-setup-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: { "dep-a": "1.0.0" } }));
  mkdirSync(join(dir, "node_modules", "dep-a"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep-a", "package.json"), "{}");
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  if (repo) execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  return dir;
}

/** Each call returns new bytes, all of `fill`, so values are known only to the test. */
function counter(): (size: number) => Uint8Array {
  let n = 0;
  return (size) => new Uint8Array(size).fill(++n);
}

const fakes = (over: Partial<LocalSetupDeps> = {}): Partial<LocalSetupDeps> => ({
  npmInstall: () => Promise.reject(new Error("npm install must not run")),
  random: counter(),
  declaredSecrets: () => Promise.resolve(["apiKey"]),
  ...over,
});

describe("runLocalSetup (plan-setup-wizard §3.1, §4.3 step 0)", () => {
  it("sets a random local value for each secret and lists .env.cloudflare in .gitignore, then does nothing on a second run", async () => {
    const dir = project({ ".gitignore": "node_modules/\n" });
    const first = await runLocalSetup(dir, fakes());
    expect(first.map((o) => [o.step, o.result])).toEqual([
      ["dependencies", "already"],
      ["local-secrets", "applied"],
      ["gitignore", "applied"],
    ]);
    const vars = readDevVars(readFileSync(join(dir, ".dev.vars"), "utf8"));
    expect(Object.keys(vars).sort()).toEqual(["SECRET_API_KEY", "SECRET_FRAMEWORK_AUTH_SECRET", "SECRET_FRAMEWORK_LOCAL_TICKET_KEY", "SECRET_FRAMEWORK_SESSION_KEY"]);
    expect(new Set(Object.values(vars)).size).toBe(4);
    for (const v of Object.values(vars)) expect(Buffer.from(v, "base64url")).toHaveLength(32);
    expect(statSync(join(dir, ".dev.vars")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^node_modules\/\n[\s\S]*\n\.env\.cloudflare\n$/);
    // No message carries a value.
    const said = describeLocalSetup(first).join("\n");
    expect(said).toContain("apiKey");
    for (const v of Object.values(vars)) expect(said).not.toContain(v);

    const before = readFileSync(join(dir, ".dev.vars"), "utf8");
    const second = await runLocalSetup(dir, fakes());
    expect(second.map((o) => o.result)).toEqual(["already", "already", "already"]);
    expect(describeLocalSetup(second)).toEqual([]);
    expect(readFileSync(join(dir, ".dev.vars"), "utf8")).toBe(before);
  });

  it("never changes a value that is set, and fills an empty one", async () => {
    const dir = project({ ".dev.vars": "SECRET_API_KEY=mine\nSECRET_FRAMEWORK_SESSION_KEY=\n" });
    const r = await runLocalSetup(dir, fakes());
    expect(r[1]).toMatchObject({ result: "applied", message: "set a random local value for frameworkSessionKey, frameworkAuthSecret, frameworkLocalTicketKey in .dev.vars" });
    const vars = readDevVars(readFileSync(join(dir, ".dev.vars"), "utf8"));
    expect(vars.SECRET_API_KEY).toBe("mine");
    expect(vars.SECRET_FRAMEWORK_SESSION_KEY).not.toBe("");
  });

  it("installs missing dependencies first, and warns (without failing the other steps) when npm install fails", async () => {
    const dir = project();
    rmSync(join(dir, "node_modules"), { recursive: true });
    const installed: string[] = [];
    const ok = await runLocalSetup(dir, fakes({ npmInstall: (d) => (installed.push(d), Promise.resolve()) }));
    expect(installed).toEqual([dir]);
    expect(ok[0]).toMatchObject({ step: "dependencies", result: "applied" });

    const failed = await runLocalSetup(dir, fakes({ npmInstall: () => Promise.reject(new Error("ENETUNREACH")) }));
    expect(failed[0]).toMatchObject({ step: "dependencies", result: "warned" });
    expect(failed[0]?.message).toContain("ENETUNREACH");
    expect(failed.map((o) => o.step)).toEqual(["dependencies", "local-secrets", "gitignore"]);
  });

  it("finds dependencies installed in a parent folder (a workspace)", async () => {
    const dir = project();
    const app = join(dir, "apps", "a");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "package.json"), JSON.stringify({ name: "a", dependencies: { "dep-a": "1.0.0" } }));
    expect((await runLocalSetup(app, fakes({ ensureIgnored: () => "already" })))[0]?.result).toBe("already");
  });

  it("warns when the app's secret names cannot be read, and sets nothing", async () => {
    const dir = project();
    const r = await runLocalSetup(dir, fakes({ declaredSecrets: () => Promise.reject(new Error("src/app.ts was not found")) }));
    expect(r[1]).toMatchObject({ step: "local-secrets", result: "warned" });
    expect(r[1]?.message).toContain("src/app.ts was not found");
    expect(existsSync(join(dir, ".dev.vars"))).toBe(false);
  });

  it("respects the keep-env-cloudflare-tracked marker: warns and leaves .gitignore unchanged", async () => {
    const text = `node_modules/\n${KEEP_TRACKED_MARKER}\n`;
    const dir = project({ ".gitignore": text });
    const r = await runLocalSetup(dir, fakes());
    expect(r[2]).toMatchObject({ step: "gitignore", result: "warned" });
    expect(r[2]?.message).toMatch(/^WARNING: .*keep-env-cloudflare-tracked/);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(text);
  });

  it("an already-ignored .env.cloudflare (any pattern) is left alone", async () => {
    const dir = project({ ".gitignore": ".env*\n" });
    expect(ensureEnvCloudflareIgnored(dir)).toBe("already");
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(".env*\n");
  });

  it("outside a git repository (or without git) it warns prominently, writes no .gitignore, and never fails", async () => {
    const dir = project({}, { repo: false });
    const r = await runLocalSetup(dir, fakes());
    expect(r[2]).toMatchObject({ step: "gitignore", result: "warned" });
    expect(r[2]?.message).toMatch(/^WARNING: this folder is not a git repository, or git is not installed/);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    expect(r[1]?.result).toBe("applied");
  });

  it("an ensureIgnored that throws (git failing) is a warning, not a failure", async () => {
    const dir = project();
    const r = await runLocalSetup(dir, fakes({ ensureIgnored: () => Promise.reject(new Error("spawn git ENOENT")) }));
    expect(r[2]).toMatchObject({ step: "gitignore", result: "warned" });
    expect(r[2]?.message).toContain("spawn git ENOENT");
  });

  it("uses an injected ensureIgnored (the default is git-safety's ensureEnvCloudflareIgnored)", async () => {
    const dir = project();
    const seen: string[] = [];
    const r = await runLocalSetup(dir, fakes({ ensureIgnored: (d) => (seen.push(d), "added") }));
    expect(seen).toEqual([dir]);
    expect(r[2]?.result).toBe("applied");
  });
});
