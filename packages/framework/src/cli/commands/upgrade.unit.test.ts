import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageError } from "../args.js";
import { captureIo } from "../io.test-support.js";
import { cloudflareVerdict, repin, upgradeCommand, type Release, type SetupVersions, type UpgradeDeps } from "./upgrade.js";

const FW = "@lago-morph/prototype-framework";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function app(): string {
  const dir = mkdtempSync(join(tmpdir(), "upgrade-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "a", dependencies: { [FW]: "0.1.0", hono: "4.13.13", zod: "4.6.7" }, devDependencies: { typescript: "6.0.3", vite: "8.3.4", vitest: "5.0.5" } }, null, 2) + "\n",
  );
  mkdirSync(join(dir, ".claude", "skills", "prototype-framework"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "prototype-framework", "SKILL.md"), "old skill\n");
  writeFileSync(join(dir, ".claude", "skills", "prototype-framework", "gone.md"), "removed in the new release\n");
  return dir;
}

const RELEASE: Release = { version: "0.2.0", dependencies: { hono: "4.14.0", zod: "4.6.7", typescript: "6.0.3", vite: "8.4.0", vitest: "5.0.5", wrangler: "4.150.0" } };

/** A fake npm: `install` puts the release's package (with `skill/` unless `withSkill` is false) into node_modules. */
function fakes(_dir: string, o: { release?: Release; withSkill?: boolean; verify?: boolean; before?: SetupVersions; after?: SetupVersions } = {}): UpgradeDeps & { calls: string[] } {
  const calls: string[] = [];
  let installed = false;
  return {
    calls,
    view: (spec) => (calls.push(`view ${spec}`), Promise.resolve(o.release ?? RELEASE)),
    install: (d) => {
      calls.push("install");
      const fw = join(d, "node_modules", "@lago-morph", "prototype-framework");
      mkdirSync(fw, { recursive: true });
      writeFileSync(join(fw, "package.json"), JSON.stringify({ version: (o.release ?? RELEASE).version }));
      if (o.withSkill !== false) {
        mkdirSync(join(fw, "skill", "reference"), { recursive: true });
        writeFileSync(join(fw, "skill", "SKILL.md"), "new skill\n");
        writeFileSync(join(fw, "skill", "VERSION"), "0.2.0\n");
        writeFileSync(join(fw, "skill", "reference", "kv.md"), "kv\n");
      }
      installed = true;
      return Promise.resolve();
    },
    verify: () => (calls.push("verify"), Promise.resolve(o.verify ?? true)),
    setupVersions: () => Promise.resolve(installed ? o.after : o.before),
  };
}

async function upgrade(dir: string, d: UpgradeDeps, args: string[] = []): Promise<{ code: number; out: string; err: string }> {
  const io = captureIo(dir);
  const code = await upgradeCommand(d)(args, io);
  return { code, out: io.out, err: io.err };
}

describe("upgrade (plan-setup-wizard §4.8a)", () => {
  it("pins the framework and its companions, installs, refreshes the skill copy, verifies, and prints the setup script", async () => {
    const dir = app();
    const d = fakes(dir, { before: { permissions: 1, accountSetup: 1 }, after: { permissions: 1, accountSetup: 1 } });
    const r = await upgrade(dir, d);
    expect(r.code).toBe(0);
    expect(d.calls).toEqual(["view latest", "install", "verify"]);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.dependencies).toEqual({ [FW]: "0.2.0", hono: "4.14.0", zod: "4.6.7" });
    expect(pkg.devDependencies).toEqual({ typescript: "6.0.3", vite: "8.4.0", vitest: "5.0.5" });
    expect(pkg.dependencies.wrangler).toBeUndefined();
    const skill = join(dir, ".claude", "skills", "prototype-framework");
    expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe("new skill\n");
    expect(readFileSync(join(skill, "VERSION"), "utf8")).toBe("0.2.0\n");
    expect(existsSync(join(skill, "reference", "kv.md"))).toBe(true);
    expect(existsSync(join(skill, "gone.md"))).toBe(false);
    expect(r.out).toContain(`1. pinned ${FW} 0.2.0, hono 4.14.0, vite 8.4.0; running npm install`);
    expect(r.out).toContain("2. refreshed");
    expect(r.out).toContain("verify passed");
    expect(r.out).toContain("4. Cloudflare setup: nothing new is needed");
    expect(r.out).toContain("npm pack -q @lago-morph/prototype-framework-skill@0.2.0");
    expect(r.out).toContain("upgraded to 0.2.0");
  });

  it("takes a named version", async () => {
    const dir = app();
    const d = fakes(dir);
    expect((await upgrade(dir, d, ["0.2.0"])).code).toBe(0);
    expect(d.calls[0]).toBe("view 0.2.0");
  });

  it("refuses a version that is not latest, next or exact", async () => {
    const dir = app();
    await expect(upgrade(dir, fakes(dir), ["^0.2"])).rejects.toThrow(UsageError);
    await expect(upgrade(dir, fakes(dir), ["0.2.0", "x"])).rejects.toThrow(UsageError);
  });

  it("a failed verify exits 1, keeps the upgrade, and says how to go back", async () => {
    const dir = app();
    const r = await upgrade(dir, fakes(dir, { verify: false }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("verify failed");
    expect(r.out).toContain("git checkout -- package.json package-lock.json .claude/skills/prototype-framework");
    expect(r.out).toContain("npm pack -q @lago-morph/prototype-framework-skill@0.2.0");
  });

  it("an installed framework without skill/ leaves the copy as it was and exits 1", async () => {
    const dir = app();
    const r = await upgrade(dir, fakes(dir, { withSkill: false }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("WARNING: the installed framework has no skill/ copy");
    expect(readFileSync(join(dir, ".claude", "skills", "prototype-framework", "SKILL.md"), "utf8")).toBe("old skill\n");
  });

  it("a failed npm install stops before the skill and verify", async () => {
    const dir = app();
    const d = { ...fakes(dir), install: () => Promise.reject(new Error("exit status 1")) };
    const r = await upgrade(dir, d);
    expect(r.code).toBe(1);
    expect(r.err).toContain("npm install failed");
    expect(readFileSync(join(dir, ".claude", "skills", "prototype-framework", "SKILL.md"), "utf8")).toBe("old skill\n");
  });

  it("an app that does not depend on the framework is refused, unchanged", async () => {
    const dir = app();
    writeFileSync(join(dir, "package.json"), "{}\n");
    const r = await upgrade(dir, fakes(dir));
    expect(r.code).toBe(1);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe("{}\n");
  });
});

describe("whether Cloudflare setup needs re-running", () => {
  it("compares the versions the app had with the new release's", () => {
    expect(cloudflareVerdict({ permissions: 1, accountSetup: 1 }, { permissions: 2, accountSetup: 1 })).toBe(
      "Cloudflare setup needs re-running (token permissions 1 → 2): run `npm run cloudflare-setup`. It needs the bootstrap token once.",
    );
    expect(cloudflareVerdict({ permissions: 1, accountSetup: 1 }, { permissions: 2, accountSetup: 3 })).toContain("token permissions 1 → 2, account setup 1 → 3");
    expect(cloudflareVerdict({ permissions: 2, accountSetup: 2 }, { permissions: 2, accountSetup: 2 })).toContain("nothing new is needed");
  });

  it("is unknown when either release does not export the versions", () => {
    for (const [before, after] of [
      [undefined, { permissions: 1, accountSetup: 1 }],
      [{ permissions: 1, accountSetup: 1 }, undefined],
      [{ permissions: 1 }, { permissions: 1, accountSetup: 1 }],
    ] as const) {
      expect(cloudflareVerdict(before, after)).toBe("Cloudflare setup: unknown whether this release needs more; run `npm run cloudflare-setup` to check (it does only what is missing).");
    }
  });
});

describe("repin", () => {
  it("changes only pins the app has, to exact versions, and reports nothing when already there", () => {
    const pkg = { dependencies: { [FW]: "0.2.0", hono: "4.14.0" } };
    expect(repin(pkg, RELEASE).changed).toEqual([]);
    expect(repin({ dependencies: { [FW]: "0.1.0", zod: "4.6.7" } }, { version: "0.2.0", dependencies: { zod: "^4.7.0" } }).changed).toEqual([`${FW} 0.2.0`]);
  });
});
