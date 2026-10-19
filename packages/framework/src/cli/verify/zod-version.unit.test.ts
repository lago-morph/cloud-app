import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installedZodVersion, ZOD_VERSION } from "./zod-version.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("verify's zod version check (check.md §2, PAR-112)", () => {
  it("expects exactly the zod version the framework depends on and re-exports", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(ZOD_VERSION).toBe(pkg.dependencies["zod"]);
    expect(ZOD_VERSION).toBe("4.6.7");
  });

  it("finds the zod the app resolves (its own or an ancestor's node_modules), or none", () => {
    const root = mkdtempSync(join(tmpdir(), "zod-version-"));
    dirs.push(root);
    const appDir = join(root, "apps", "one");
    mkdirSync(appDir, { recursive: true });
    expect(installedZodVersion(appDir)).toBeUndefined();
    mkdirSync(join(root, "node_modules", "zod"), { recursive: true });
    writeFileSync(join(root, "node_modules", "zod", "package.json"), JSON.stringify({ name: "zod", version: "4.1.0" }));
    expect(installedZodVersion(appDir)).toBe("4.1.0");
    mkdirSync(join(appDir, "node_modules", "zod"), { recursive: true });
    writeFileSync(join(appDir, "node_modules", "zod", "package.json"), JSON.stringify({ name: "zod", version: "4.6.7" }));
    expect(installedZodVersion(appDir)).toBe("4.6.7");
  });
});
