/**
 * PROV's local setup (`runLocalSetup`, DEC-0591; setup.md §2 step 0) on the real file system and
 * a real git repository: dependencies, a random local value for each secret in `.dev.vars`, and
 * `.env.cloudflare` listed in `.gitignore`. Each step does only what is missing and never changes a
 * value that is set; git problems warn and never fail (SETUP-REQ-005). Only the app's declared
 * secret names are given, instead of loading an app.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runLocalSetup } from "../../../src/provision/core/local-setup.js";
import { cleanTempDirs, tempDir } from "./support.js";

afterAll(cleanTempDirs);

const project = (git: boolean): string => {
  const dir = tempDir("prov-int-local-");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "notes", private: true }));
  if (git) execFileSync("git", ["init", "-q", dir]);
  return dir;
};
const deps = { declaredSecrets: async () => ["apiKey"], npmInstall: async () => { throw new Error("no dependency is missing"); } };
const vars = (dir: string): Record<string, string> =>
  Object.fromEntries(readFileSync(join(dir, ".dev.vars"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^'|'$/g, "")]));

describe("PROV local setup on the file system and git", () => {
  it("sets a random value for each local secret and ignores .env.cloudflare; a second run changes nothing", async () => {
    const dir = project(true);
    writeFileSync(join(dir, ".dev.vars"), "SECRET_API_KEY=chosen-by-the-owner\n");
    const first = await runLocalSetup(dir, deps);
    expect(first.map((o) => [o.step, o.result])).toEqual([["dependencies", "already"], ["local-secrets", "applied"], ["gitignore", "applied"]]);
    const set = vars(dir);
    expect(set.SECRET_API_KEY, "a set value is never changed").toBe("chosen-by-the-owner");
    const generated = Object.entries(set).filter(([k]) => k.startsWith("SECRET_FRAMEWORK_"));
    expect(generated.length).toBeGreaterThan(0);
    for (const [k, v] of generated) expect(v, k).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(statSync(join(dir, ".dev.vars")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, ".gitignore"), "utf8").split("\n")).toContain(".env.cloudflare");
    writeFileSync(join(dir, ".env.cloudflare"), "CLOUDFLARE_ACCOUNT_ID=0123\n");
    expect(execFileSync("git", ["-C", dir, "check-ignore", ".env.cloudflare"], { encoding: "utf8" }).trim(), "git itself ignores the file").toBe(".env.cloudflare");

    const before = { vars: readFileSync(join(dir, ".dev.vars"), "utf8"), ignore: readFileSync(join(dir, ".gitignore"), "utf8") };
    const second = await runLocalSetup(dir, deps);
    expect(second.map((o) => o.result)).toEqual(["already", "already", "already"]);
    expect({ vars: readFileSync(join(dir, ".dev.vars"), "utf8"), ignore: readFileSync(join(dir, ".gitignore"), "utf8") }).toEqual(before);
  });

  it("outside a git repository the gitignore step warns, saying what to do, and the other steps still run", async () => {
    const dir = project(false);
    const outcomes = await runLocalSetup(dir, deps);
    expect(outcomes.map((o) => o.result)).toEqual(["already", "applied", "warned"]);
    expect(outcomes[2]?.message).toMatch(/not a git repository[\s\S]*git init/);
    expect(vars(dir).SECRET_API_KEY).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});
