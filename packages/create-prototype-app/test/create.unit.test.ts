// Unit tests for the create starter (`npm create @lago-morph/prototype-app`). No network, no install.
// The offline end-to-end run (pack, create, `npm ci --offline`, build, verify) is create.offline.test.ts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appNameFrom, copySkill, create, firstCommit, FRAMEWORK_PACKAGE, initRepo, nextStep, packageNameFrom, SKILL_TARGET } from "../lib/create.mjs";
import { bundle } from "../scripts/bundle.mjs";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PKG_DIR, "..", "..");
const TEMPLATE = join(REPO, "apps", "template");
const SKILL = join(REPO, "skill");
const BIN = join(PKG_DIR, "bin", "create-prototype-app.js");
const SELF = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as { name: string; version: string; dependencies?: object; bin: Record<string, string> };

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "create-unit-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

describe("package conventions", () => {
  it("is the @scope/create-<name> package that `npm create @lago-morph/prototype-app` runs, with one bin", () => {
    expect(SELF.name).toBe("@lago-morph/create-prototype-app");
    expect(Object.keys(SELF.bin)).toEqual(["create-prototype-app"]);
  });

  it("has no runtime dependencies", () => {
    expect(SELF.dependencies).toBeUndefined();
  });

  it("is released in lockstep with the framework and the template's pin", () => {
    const fw = JSON.parse(readFileSync(join(REPO, "packages", "framework", "package.json"), "utf8")) as { version: string };
    const tpl = JSON.parse(readFileSync(join(TEMPLATE, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(SELF.version).toBe(fw.version);
    expect(tpl.dependencies[FRAMEWORK_PACKAGE]).toBe(fw.version);
  });
});

describe("names", () => {
  it("derives a valid app name (lowercase letters and digits, at most 20) from the folder", () => {
    expect(appNameFrom("/x/My-App_2")).toBe("myapp2");
    expect(appNameFrom("/x/a-really-long-folder-name-here")).toBe("areallylongfoldernam");
    expect(packageNameFrom("/x/My App")).toBe("my-app");
    expect(packageNameFrom("/x/.hidden")).toBe("hidden");
  });

  it("refuses an invalid app name before writing anything", () => {
    const target = join(root, "---");
    expect(() => create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0" })).toThrow(/app name "" is not valid/);
    expect(() => create({ target: join(root, "ok"), templateDir: TEMPLATE, frameworkSpec: "0.1.0", appName: "Bad-Name" })).toThrow(/not valid/);
    expect(existsSync(target)).toBe(false);
    expect(existsSync(join(root, "ok"))).toBe(false);
  });
});

describe("create", () => {
  it("copies the template without build, dependency or local-state output", () => {
    mkdirSync(join(root, "tpl"));
    // A template holding leftovers from a local run: they must not be copied.
    const tpl = join(root, "tpl");
    for (const f of files(TEMPLATE)) {
      mkdirSync(dirname(join(tpl, f)), { recursive: true });
      writeFileSync(join(tpl, f), readFileSync(join(TEMPLATE, f)));
    }
    for (const junk of ["node_modules/x/index.js", ".framework/local/a.js", ".dev.vars", ".logs/a.log", ".wrangler/s", "dist/a.js"]) {
      mkdirSync(dirname(join(tpl, junk)), { recursive: true });
      writeFileSync(join(tpl, junk), "x");
    }
    const target = join(root, "app");
    create({ target, templateDir: tpl, frameworkSpec: "0.1.0" });
    const got = files(target);
    expect(got).toContain("src/app.ts");
    expect(got).toContain(".gitignore");
    expect(got.filter((f) => /^(node_modules|\.framework|\.logs|\.wrangler|dist)\/|^\.dev\.vars$/.test(f))).toEqual([]);
  });

  it("names the app and rewrites the framework dependency to the given spec", () => {
    const target = join(root, "notes-app");
    const r = create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0" });
    expect(r).toMatchObject({ appName: "notesapp", packageName: "notes-app", skill: false });
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { name: string; dependencies: Record<string, string>; scripts: object };
    expect(pkg.name).toBe("notes-app");
    expect(pkg.dependencies[FRAMEWORK_PACKAGE]).toBe("0.1.0");
    expect(pkg.dependencies.hono).toBeDefined();
    expect(readFileSync(join(target, "src", "app.ts"), "utf8")).toContain('name: "notesapp",');
    expect(readFileSync(join(target, "src", "app.ts"), "utf8")).not.toContain('name: "template"');
    expect(readFileSync(join(target, "index.html"), "utf8")).toContain("<title>notesapp</title>");
    expect(existsSync(join(target, SKILL_TARGET))).toBe(false);
  });

  it("accepts a file: tarball spec and an explicit name", () => {
    const target = join(root, "x");
    create({ target, templateDir: TEMPLATE, frameworkSpec: "file:/tmp/fw.tgz", appName: "board" });
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies[FRAMEWORK_PACKAGE]).toBe("file:/tmp/fw.tgz");
    expect(readFileSync(join(target, "src", "app.ts"), "utf8")).toContain('name: "board",');
  });

  it("copies the skill into .claude/skills/prototype-framework without the repository's scripts", () => {
    const target = join(root, "app");
    expect(create({ target, templateDir: TEMPLATE, skillDir: SKILL, frameworkSpec: "0.1.0" }).skill).toBe(true);
    const got = files(join(target, SKILL_TARGET));
    expect(got).toContain("SKILL.md");
    expect(got).toContain("reference/local-development.md");
    expect(got).toContain("templates/FRAMEWORK-ISSUE.md");
    expect(got.filter((f) => f.startsWith("scripts/") || f.startsWith(".claude-plugin/"))).toEqual([]);
    expect(readFileSync(join(target, SKILL_TARGET, "SKILL.md"), "utf8")).toBe(readFileSync(join(SKILL, "SKILL.md"), "utf8"));
    // The template's committed Claude Code settings come along, with the rule that keeps the agent out of .env.cloudflare (DEC-0599).
    const settings = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8")) as { permissions: { deny: string[] } };
    expect(settings.permissions.deny).toContain("Read(.env.cloudflare)");
  });

  it("gives every skill copy a VERSION marker from the plugin manifest, and keeps it when copying a copy", () => {
    const plugin = JSON.parse(readFileSync(join(SKILL, ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
    expect(copySkill(SKILL, join(root, "a"))).toBe(plugin.version);
    expect(readFileSync(join(root, "a", "VERSION"), "utf8")).toBe(`${plugin.version}\n`);
    expect(copySkill(join(root, "a"), join(root, "b"))).toBe(plugin.version);
    expect(readFileSync(join(root, "b", "VERSION"), "utf8")).toBe(`${plugin.version}\n`);
  });

  it("lists .env.cloudflare in the new app's .gitignore", () => {
    const target = join(root, "app");
    create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0" });
    expect(readFileSync(join(target, ".gitignore"), "utf8").split("\n")).toContain(".env.cloudflare");
  });

  it("refuses a non-empty folder without changing it, and overwrites with force", () => {
    const target = join(root, "app");
    mkdirSync(target);
    writeFileSync(join(target, "mine.txt"), "keep");
    expect(() => create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0" })).toThrow(/is not empty; nothing was changed/);
    expect(files(target)).toEqual(["mine.txt"]);
    create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0", force: true });
    expect(files(target)).toContain("src/app.ts");
    expect(readFileSync(join(target, "mine.txt"), "utf8")).toBe("keep");
  });
});

describe("bundle (prepack)", () => {
  it("bundles the template with .gitignore stored as gitignore, and the skill without scripts", () => {
    const { template, skill } = bundle(root);
    const t = files(template);
    expect(t).toContain("gitignore");
    expect(t).not.toContain(".gitignore");
    expect(t).toContain("src/app.ts");
    expect(files(skill).some((f) => f.startsWith("scripts/"))).toBe(false);
    // create() from the bundle restores .gitignore.
    const target = join(root, "fromBundle");
    create({ target, templateDir: template, skillDir: skill, frameworkSpec: "0.1.0" });
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toBe(readFileSync(join(TEMPLATE, ".gitignore"), "utf8"));
  });
});

/** A git identity for the first commit, as a configured machine has; CI runners have none. */
const GIT_ENV = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });

describe("git (never fails the starter)", () => {
  it("initializes a repository and makes the first commit of everything not ignored", () => {
    const target = join(root, "app");
    create({ target, templateDir: TEMPLATE, frameworkSpec: "0.1.0" });
    writeFileSync(join(target, ".dev.vars"), "SECRET_API_KEY=local\n");
    expect(initRepo(target)).toEqual({ status: "initialized" });
    const saved = { ...process.env };
    Object.assign(process.env, GIT_ENV);
    try {
      expect(firstCommit(target, "First")).toEqual({ ok: true });
    } finally {
      for (const k of Object.keys(GIT_ENV)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    const tracked = git(target, "ls-files").stdout.split("\n");
    expect(tracked).toContain("src/app.ts");
    expect(tracked).toContain(".gitignore");
    expect(tracked).not.toContain(".dev.vars");
  });

  it("warns when git is missing, and when the commit fails", () => {
    const target = join(root, "app");
    mkdirSync(target);
    const missing = initRepo(target, { git: join(root, "no-such-git") });
    expect(missing.status).toBe("warned");
    expect(missing.message).toMatch(/^WARNING: git was not found/);
    const failed = firstCommit(target, "First", { git: join(root, "no-such-git") });
    expect(failed.ok).toBe(false);
    expect(failed.message).toMatch(/^WARNING: the first commit failed\. Commit yourself: git add -A && git commit/);
  });

  it("leaves a folder inside an existing repository to that repository", () => {
    expect(git(root, "init", "-q").status).toBe(0);
    const target = join(root, "sub");
    mkdirSync(target);
    expect(initRepo(target).status).toBe("inside-repo");
    expect(existsSync(join(target, ".git"))).toBe(false);
  });
});

describe("command line", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });

  it("creates an app with the skill and a first commit, and ends with the next step", () => {
    const r = run("demo", "--no-install", "--framework", "0.1.0");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Created demo in");
    expect(r.stdout).toContain("Made the first git commit.");
    expect(r.stdout).not.toContain("/plugin");
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("cd demo, then `npm install` and `npm run dev`, or open this folder in Claude Code and say what to build.");
    expect(existsSync(join(root, "demo", SKILL_TARGET, "SKILL.md"))).toBe(true);
    expect(git(join(root, "demo"), "ls-files", SKILL_TARGET).stdout).toContain("SKILL.md");
  });

  it("defaults the framework spec to its own version, and without the skill names the plugin", () => {
    const r = run("demo", "--no-install", "--no-skill");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("/plugin marketplace add lago-morph/cloud-app");
    expect(r.stdout).toContain("/plugin install prototype-framework@lago-morph");
    const pkg = JSON.parse(readFileSync(join(root, "demo", "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies[FRAMEWORK_PACKAGE]).toBe(SELF.version);
    expect(existsSync(join(root, "demo", ".claude", "skills"))).toBe(false);
    // The template's settings (the .env.cloudflare deny rule, DEC-0599) come with or without the skill.
    expect(existsSync(join(root, "demo", ".claude", "settings.json"))).toBe(true);
  });

  it("prints exactly plan §3.1's closing line, with the folder as typed", () => {
    expect(nextStep("my-app")).toBe("cd my-app, then `npm run dev`, or open this folder in Claude Code and say what to build.");
    expect(nextStep(".")).toBe("Run `npm run dev`, or open this folder in Claude Code and say what to build.");
  });

  it("exits 2 with usage on bad arguments, and 1 on a non-empty folder", () => {
    expect(run().status).toBe(2);
    expect(run("a", "b").status).toBe(2);
    expect(run("a", "--bogus").status).toBe(2);
    expect(run("a", "--name").status).toBe(2);
    mkdirSync(join(root, "full"));
    writeFileSync(join(root, "full", "f"), "");
    const r = run("full", "--no-install");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not empty; nothing was changed/);
  });
});
