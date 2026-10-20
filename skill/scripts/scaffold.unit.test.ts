import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.mjs";

const PKG = "@lago-morph/prototype-framework";
let root: string;
let template: string;
let tarball: string;
let installs: string[];
const install = (dir: string): void => {
  installs.push(dir);
};

function listTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scaffold-unit-"));
  template = join(root, "template");
  mkdirSync(join(template, "src"), { recursive: true });
  mkdirSync(join(template, "node_modules", "x"), { recursive: true });
  mkdirSync(join(template, ".framework"), { recursive: true });
  writeFileSync(join(template, "src", "app.ts"), "export {};\n");
  writeFileSync(join(template, "node_modules", "x", "index.js"), "");
  writeFileSync(join(template, ".framework", "state"), "");
  writeFileSync(join(template, ".gitignore"), ".dev.vars\n");
  writeFileSync(
    join(template, "package.json"),
    JSON.stringify({ name: "template", dependencies: { [PKG]: "0.1.0", hono: "4.13.13" } }, null, 2) + "\n",
  );
  tarball = join(root, "lago-morph-prototype-framework-0.1.0.tgz");
  writeFileSync(tarball, "fake tarball");
  installs = [];
});

describe("scaffold", () => {
  it("copies the template into a new directory, leaving out build and dependency output", async () => {
    const target = join(root, "app");
    await scaffold({ target, templateDir: template, tarball, version: "0.1.0", install });
    const tree = listTree(target);
    expect(tree["src/app.ts"]).toBe("export {};\n");
    expect(Object.keys(tree).some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(Object.keys(tree).some((p) => p.startsWith(".framework"))).toBe(false);
  });

  it("installs the framework from the npm pack tarball at the exact version", async () => {
    const target = join(root, "app");
    await scaffold({ target, templateDir: template, tarball, version: "0.1.0", install });
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    expect(pkg.dependencies[PKG]).toBe("file:vendor/lago-morph-prototype-framework-0.1.0.tgz");
    expect(pkg.dependencies.hono).toBe("4.13.13");
    expect(readFileSync(join(target, "vendor", "lago-morph-prototype-framework-0.1.0.tgz"), "utf8")).toBe(
      "fake tarball",
    );
    expect(installs).toEqual([target]);
  });

  it("refuses a tarball whose version differs from the template's exact pin", async () => {
    const target = join(root, "app");
    await expect(scaffold({ target, templateDir: template, tarball, version: "0.2.0", install })).rejects.toThrow(
      /0\.2\.0.*0\.1\.0/,
    );
    expect(existsSync(target)).toBe(false);
    expect(installs).toEqual([]);
  });

  it("[SKILL-AC-005] scaffolding into a directory with existing files stops without changing them", async () => {
    const target = join(root, "app");
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(join(target, "src", "app.ts"), "mine\n");
    writeFileSync(join(target, "notes.txt"), "keep\n");
    const before = listTree(target);
    await expect(scaffold({ target, templateDir: template, tarball, version: "0.1.0", install })).rejects.toThrow(
      /not empty/,
    );
    expect(listTree(target)).toEqual(before);
    expect(installs).toEqual([]);
  });

  it("overwrites existing files only when explicitly told to (force)", async () => {
    const target = join(root, "app");
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(join(target, "src", "app.ts"), "mine\n");
    await scaffold({ target, templateDir: template, tarball, version: "0.1.0", install, force: true });
    expect(readFileSync(join(target, "src", "app.ts"), "utf8")).toBe("export {};\n");
  });

  it("copies the template's .gitignore, so a scaffolded app never commits local state or dev secrets", async () => {
    const target = join(root, "app");
    await scaffold({ target, templateDir: template, tarball, version: "0.1.0", install });
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toBe(".dev.vars\n");
    const real = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "template", ".gitignore"),
      "utf8",
    )
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""));
    for (const entry of [".dev.vars", ".framework", ".wrangler", ".logs", "node_modules"]) {
      expect(real).toContain(entry);
    }
  });
});
