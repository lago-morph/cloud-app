import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkDependencyTree, deniedChains, findLockfile, resolveLocation, type LockPackages } from "./dependencies.js";

const FRAMEWORK = "@lago-morph/prototype-framework";

function dir(): string {
  return mkdtempSync(join(tmpdir(), "pf-deps-"));
}

function write(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/** A standalone app: its package.json and a version 3 lockfile with the given packages. */
function app(manifest: Record<string, unknown>, packages: LockPackages): string {
  const root = dir();
  write(join(root, "package.json"), { name: "notes", version: "0.0.0", ...manifest });
  write(join(root, "package-lock.json"), { name: "notes", lockfileVersion: 3, requires: true, packages: { "": { name: "notes", ...manifest }, ...packages } });
  return root;
}

describe("the installed dependency tree check (DEC-0554)", () => {
  it("[CHECK-AC-001] an ordinary dependency whose own tree installs a provider SDK fails, naming the chain on the dependency's package.json line", () => {
    const root = app(
      { dependencies: { [FRAMEWORK]: "0.1.0", "nice-uploads": "1.0.0", zod: "4.6.7" } },
      {
        "node_modules/nice-uploads": { version: "1.0.0", dependencies: { "storage-helper": "^2.0.0" } },
        "node_modules/storage-helper": { version: "2.1.0", dependencies: { "@aws-sdk/client-s3": "^3.0.0", tslib: "^2" } },
        "node_modules/@aws-sdk/client-s3": { version: "3.700.0" },
        "node_modules/tslib": { version: "2.8.0" },
        "node_modules/zod": { version: "4.6.7" },
      },
    );
    const diagnostics = checkDependencyTree(root);
    expect(diagnostics).toEqual([
      {
        file: "package.json",
        line: 6,
        column: 1,
        rule: "prototype-framework/allowed-imports",
        message: 'Dependency "nice-uploads" installs the platform SDK or database driver "@aws-sdk/client-s3" (nice-uploads → storage-helper → @aws-sdk/client-s3); use a package without it, or the framework\'s API.',
        reference: "skill/reference/http-and-validation.md",
      },
    ]);
  });

  it("[CHECK-AC-001] ordinary packages pass; the framework's own tree (SST, Wrangler, PGlite) is not the app's", () => {
    const root = app(
      { dependencies: { [FRAMEWORK]: "0.1.0", hono: "4.13.13", zod: "4.6.7" }, devDependencies: { vitest: "5.0.5" } },
      {
        [`node_modules/${FRAMEWORK}`]: { version: "0.1.0", dependencies: { sst: "4.17.2", wrangler: "4.149.0", "@electric-sql/pglite": "0.5.8" } },
        "node_modules/sst": { version: "4.17.2", dependencies: { "@pulumi/pulumi": "3" } },
        "node_modules/@pulumi/pulumi": { version: "3.0.0" },
        "node_modules/wrangler": { version: "4.149.0", dependencies: { miniflare: "4" } },
        "node_modules/miniflare": { version: "4.0.0" },
        "node_modules/@electric-sql/pglite": { version: "0.5.8" },
        "node_modules/hono": { version: "4.13.13" },
        "node_modules/zod": { version: "4.6.7" },
        "node_modules/vitest": { version: "5.0.5", dependencies: { vite: "8" }, peerDependencies: { "@vitest/browser": "5", "@types/node": "*" }, peerDependenciesMeta: { "@vitest/browser": { optional: true } } },
        "node_modules/vite": { version: "8.3.4", optionalDependencies: { fsevents: "2" } },
      },
    );
    expect(checkDependencyTree(root)).toEqual([]);
  });

  it("nested node_modules resolve as Node does; optional and required peers are followed, optional peers that are not installed are skipped", () => {
    const packages: LockPackages = {
      "node_modules/a": { version: "1.0.0", dependencies: { b: "1" } },
      "node_modules/a/node_modules/b": { version: "1.0.0", optionalDependencies: { "pg-native": "3" } },
      "node_modules/b": { version: "2.0.0" },
      "node_modules/pg-native": { version: "3.0.0" },
      "node_modules/c": { version: "1.0.0", peerDependencies: { mongodb: "6", redis: "4" }, peerDependenciesMeta: { redis: { optional: true } } },
      "node_modules/mongodb": { version: "6.0.0" },
      "node_modules/redis": { version: "4.0.0" },
    };
    expect(resolveLocation(packages, "node_modules/a", "b")).toBe("node_modules/a/node_modules/b");
    expect(resolveLocation(packages, "node_modules/a/node_modules/b", "pg-native")).toBe("node_modules/pg-native");
    expect(resolveLocation(packages, "", "missing")).toBeUndefined();
    const lock = { packages, appLocation: "" };
    expect(deniedChains(lock, ["a", "c"]).map((c) => c.chain.join(" > "))).toEqual(["a > b > pg-native", "c > mongodb"]);
  });

  it("a denied package the app depends on directly is named as such; each denied package of a dependency is reported once, by a shortest chain", () => {
    const root = app(
      { devDependencies: { wrangler: "4.149.0", kit: "1.0.0" } },
      {
        "node_modules/wrangler": { version: "4.149.0" },
        "node_modules/kit": { version: "1.0.0", dependencies: { x: "1", "@prisma/client": "5" } },
        "node_modules/x": { version: "1.0.0", dependencies: { "@prisma/client": "5" } },
        "node_modules/@prisma/client": { version: "5.0.0" },
      },
    );
    expect(checkDependencyTree(root).map((d) => d.message)).toEqual([
      'Dependency "kit" installs the platform SDK or database driver "@prisma/client" (kit → @prisma/client); use a package without it, or the framework\'s API.',
      'Dependency "wrangler" is a platform SDK or database driver; app code uses the framework\'s APIs instead.',
    ]);
  });

  it("an app in an npm workspace is read from the workspace root's lockfile, with workspace links followed", () => {
    const root = dir();
    write(join(root, "package.json"), { name: "ws", private: true, workspaces: ["apps/notes", "packages/lib"] });
    write(join(root, "apps/notes/package.json"), { name: "notes", dependencies: { lib: "1.0.0" } });
    write(join(root, "package-lock.json"), {
      lockfileVersion: 3,
      packages: {
        "": { name: "ws" },
        "apps/notes": { version: "0.0.0", dependencies: { lib: "1.0.0" } },
        "packages/lib": { version: "1.0.0", dependencies: { "@google-cloud/storage": "7" } },
        "node_modules/lib": { resolved: "packages/lib", link: true },
        "node_modules/@google-cloud/storage": { version: "7.0.0" },
      },
    });
    expect(findLockfile(join(root, "apps/notes"))?.appLocation).toBe("apps/notes");
    expect(checkDependencyTree(join(root, "apps/notes")).map((d) => d.message)).toEqual([
      'Dependency "lib" installs the platform SDK or database driver "@google-cloud/storage" (lib → @google-cloud/storage); use a package without it, or the framework\'s API.',
    ]);
  });

  it("without a lockfile (nothing installed) there is nothing to inspect; npm's hidden lockfile counts as one", () => {
    const root = dir();
    write(join(root, "package.json"), { name: "notes", dependencies: { helper: "1.0.0" } });
    expect(checkDependencyTree(root)).toEqual([]);
    write(join(root, "node_modules/.package-lock.json"), { lockfileVersion: 3, packages: { "node_modules/helper": { version: "1.0.0", dependencies: { mysql2: "3" } }, "node_modules/mysql2": { version: "3.0.0" } } });
    expect(checkDependencyTree(root).map((d) => d.message)).toEqual([
      'Dependency "helper" installs the platform SDK or database driver "mysql2" (helper → mysql2); use a package without it, or the framework\'s API.',
    ]);
  });

  it("the repository's own apps pass against the real lockfile", () => {
    for (const name of ["template", "reference", "demo"]) expect(checkDependencyTree(fileURLToPath(new URL(`../../../../apps/${name}`, import.meta.url)))).toEqual([]);
  });
});
