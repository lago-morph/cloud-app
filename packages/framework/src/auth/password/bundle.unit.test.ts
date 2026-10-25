/**
 * The password provider in a Worker bundle (CF-REQ-003, PWD-REQ-007, DEC-0516; RESULT.md P5):
 * bundled with the Workers export conditions, it references no `node:*` module other than
 * `node:crypto` and `node:async_hooks`, contains no kysely or `node:sqlite`, and stays far within
 * PAR-245. The framework's source imports better-auth only as `better-auth/minimal` and
 * `better-auth/adapters/drizzle`, and the installed version is PAR-122 exactly.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";

const SRC = fileURLToPath(new URL("../../", import.meta.url));
const PROVIDER = fileURLToPath(new URL("./provider.ts", import.meta.url));
/** PAR-245: the Cloudflare Worker bundle bound, minified. */
const PAR_245_BYTES = 2 * 1024 * 1024;
/** PAR-122. */
const BETTER_AUTH_VERSION = "1.7.7";

describe("the password provider's bundle", () => {
  it(
    tag("CF-AC-003", "bundles for workerd with only node:crypto and node:async_hooks, without kysely, within PAR-245"),
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "pwd-bundle-"));
      try {
        const outfile = join(dir, "provider.js");
        const result = await esbuild.build({
          entryPoints: [PROVIDER],
          outfile,
          bundle: true,
          format: "esm",
          platform: "browser",
          conditions: ["workerd", "worker", "browser"],
          target: "es2023",
          minify: true,
          legalComments: "none",
          metafile: true,
          logLevel: "silent",
          external: ["node:*"],
        });
        const output = Object.values(result.metafile.outputs)[0];
        const nodeImports = new Set((output?.imports ?? []).map((i) => i.path).filter((p) => p.startsWith("node:")));
        expect([...nodeImports].sort()).toEqual(["node:async_hooks", "node:crypto"]);
        const inputs = Object.entries(output?.inputs ?? {}).filter(([, i]) => i.bytesInOutput > 0).map(([p]) => p);
        expect(inputs.filter((p) => /kysely|pglite|node_modules\/wrangler|miniflare/.test(p))).toEqual([]);
        expect(readFileSync(outfile, "utf8")).not.toContain("node:sqlite");
        const size = statSync(outfile).size;
        expect(size).toBeLessThan(PAR_245_BYTES);
        // RESULT.md: about 600 KiB with `better-auth/minimal`; the root import adds about 230 KiB.
        expect(size).toBeLessThan(800 * 1024);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it(tag("PWD-AC-007", "framework source imports better-auth only as better-auth/minimal and better-auth/adapters/drizzle; the version is PAR-122"), () => {
    const specifiers = new Set<string>();
    for (const entry of readdirSync(SRC, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const text = readFileSync(join(entry.parentPath, entry.name), "utf8");
      for (const m of text.matchAll(/from\s+["'](better-auth[^"']*)["']|import\(\s*["'](better-auth[^"']*)["']\s*\)/g)) specifiers.add(m[1] ?? m[2] ?? "");
    }
    expect([...specifiers].sort()).toEqual(["better-auth/adapters/drizzle", "better-auth/minimal"]);
    const require = createRequire(import.meta.url);
    const entry = require.resolve("better-auth/minimal");
    const root = entry.slice(0, entry.lastIndexOf("/node_modules/better-auth/") + "/node_modules/better-auth/".length);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe(BETTER_AUTH_VERSION);
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["better-auth"]).toBe(BETTER_AUTH_VERSION);
  });
});
