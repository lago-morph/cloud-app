/**
 * CF-AC-003 (cloudflare.md §4), the provider-SDK clause (CF-REQ-003 as amended, DEC-0554): "A
 * bundle with a module from a denied package, or with a provider SDK's marker string, fails the
 * build naming it; the template's and reference app's bundles pass." The other CF-AC-003 clauses
 * are covered by the framework's bundle suite
 * (`packages/framework/test/integration/build/cloudflare-bundles.test.ts`).
 *
 * `npx <package> build --target cloudflare --stage test-<x>` (CLI-REQ-001) runs on scratch copies
 * of apps/template and apps/reference; nothing is deployed and no cloud is called.
 * - Denied module: the template copy's `src/app.ts` imports `nice-uploads`, an ordinary-looking
 *   package (not on the deny list, so the import rule has nothing to say), whose own code imports
 *   `googleapis`, a package of `allowed-imports`' deny list (check.md §2, DEC-0554). Both are
 *   small local fixture packages in the copy's own `node_modules` (the repository's packages are
 *   linked beside them), so esbuild bundles a module from `node_modules/googleapis/`. The build
 *   must fail with the bundle inspection's refusal (`the Worker bundle contains a provider SDK:
 *   package googleapis`), after esbuild wrote the bundle (the written `worker.js` holds the
 *   fixture module). DEC-0554 raises `CORE.MISCONFIGURED` inside the build; the CLI prints tooling
 *   errors as messages without a code (PROV §2 "Errors"), and CF-AC-003 asks only that the build
 *   fail naming it, so the code is not asserted.
 * - Marker string: the template copy's `src/app.ts` keeps the client header `x-goog-api-client`
 *   (one of DEC-0554's provider SDK markers) in a value the bundle cannot drop. The build must
 *   fail with the inspection's refusal naming `(marker "x-goog-api-client")`, after bundling.
 * - The unchanged template and reference apps build successfully.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { npxCli, scratchCopy, type CommandResult, type ScratchApp } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, REPO_ROOT, TEMPLATE_DIR } from "../core/support/repo.js";

const STAGE = "test-dt1sdkbundle";
const MARKER = "x-goog-api-client";

/** Replaces the copy's linked `node_modules` with a directory linking each of the repository's packages, plus `extra` packages. */
function ownNodeModules(dir: string, extra: Readonly<Record<string, Readonly<Record<string, string>>>>): void {
  const target = join(dir, "node_modules");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target);
  const repo = join(REPO_ROOT, "node_modules");
  for (const entry of readdirSync(repo)) if (extra[entry] === undefined) symlinkSync(join(repo, entry), join(target, entry), "dir");
  for (const [name, files] of Object.entries(extra)) {
    mkdirSync(join(target, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(target, name, file), content);
  }
}

/** Appends `lines` to the copy's `src/app.ts`, after an import of `imports` when given. */
async function extendApp(copy: ScratchApp, statement: string, importLine?: string): Promise<void> {
  const app = await copy.read("src/app.ts");
  await copy.write("src/app.ts", `${importLine === undefined ? "" : `${importLine}\n`}${app}\n${statement}\n`);
}

/** The text of every `worker.js` the build wrote under the copy's `.framework/` (the bundle esbuild produced). */
function bundles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name === "worker.js") out.push(readFileSync(path, "utf8"));
    }
  };
  walk(join(dir, ".framework"));
  return out;
}

/**
 * The bundle inspection's refusal (CF-REQ-003 as amended, DEC-0554; `build/inspect.ts`
 * `providerSdksIn` names each find as `package <name>` or `<SDK> (marker "<marker>")`).
 */
const REFUSAL = "the Worker bundle contains a provider SDK: ";

function build(copy: ScratchApp): Promise<CommandResult> {
  return npxCli(["build", "--target", "cloudflare", "--stage", STAGE], { cwd: copy.dir, timeoutMs: 15 * 60_000 });
}

function show(r: CommandResult | undefined): string {
  return `build exit ${String(r?.status)}; output:\n${(r?.output ?? "").slice(-6_000)}`;
}

if (isLocal()) {
  describe("CF-AC-003 provider SDKs in the Worker bundle (DEC-0554)", () => {
    const copies: ScratchApp[] = [];
    const results = new Map<string, CommandResult>();
    const bundled = new Map<string, string[]>();

    beforeAll(async () => {
      const denied = await scratchCopy(TEMPLATE_DIR, "cf-ac-003-denied");
      copies.push(denied);
      ownNodeModules(denied.dir, {
        "nice-uploads": {
          "package.json": JSON.stringify({ name: "nice-uploads", version: "1.0.0", type: "module", main: "index.js", types: "index.d.ts", dependencies: { googleapis: "*" } }),
          "index.js": 'import { google } from "googleapis";\nexport function describeUploads() {\n  return `nice-uploads via ${google.name}`;\n}\n',
          "index.d.ts": "export declare function describeUploads(): string;\n",
        },
        googleapis: {
          "package.json": JSON.stringify({ name: "googleapis", version: "3.0.0", type: "module", main: "index.js" }),
          "index.js": 'export const google = { name: "dt1-fixture-googleapis-module" };\n',
        },
      });
      await extendApp(denied, '(globalThis as Record<string, unknown>)["__dt1Uploads"] = describeUploads();', 'import { describeUploads } from "nice-uploads";');
      results.set("denied", await build(denied));
      bundled.set("denied", bundles(denied.dir));

      const marker = await scratchCopy(TEMPLATE_DIR, "cf-ac-003-marker");
      copies.push(marker);
      await extendApp(marker, `(globalThis as Record<string, unknown>)["__dt1Header"] = "${MARKER}";`);
      results.set("marker", await build(marker));
      bundled.set("marker", bundles(marker.dir));

      for (const [label, dir] of [["template", TEMPLATE_DIR], ["reference", REFERENCE_DIR]] as const) {
        const copy = await scratchCopy(dir, `cf-ac-003-${label}`);
        copies.push(copy);
        results.set(label, await build(copy));
      }
    }, 60 * 60_000);

    afterAll(async () => {
      for (const c of copies) await c.remove();
    });

    it(tag("CF-AC-003", "a bundle with a module from a denied package (googleapis, brought in by an ordinary-looking dependency) fails the build naming it"), () => {
      const r = results.get("denied");
      expect(r?.status, show(r)).not.toBe(0);
      const line = (r?.output ?? "").split("\n").find((l) => l.includes(REFUSAL)) ?? "";
      expect(line, `the bundle inspection refuses the bundle:\n${show(r)}`).not.toBe("");
      expect(line, "the refusal names the denied package by its bundled module").toContain("package googleapis");
      // Past bundling: esbuild wrote the bundle, and it holds the denied package's module.
      expect((bundled.get("denied") ?? []).some((b) => b.includes("dt1-fixture-googleapis-module")), "the written bundle holds the googleapis fixture module").toBe(true);
    });

    it(tag("CF-AC-003", "a bundle carrying a provider SDK's marker string (x-goog-api-client) fails the build naming it"), () => {
      const r = results.get("marker");
      expect(r?.status, show(r)).not.toBe(0);
      const line = (r?.output ?? "").split("\n").find((l) => l.includes(REFUSAL)) ?? "";
      expect(line, `the bundle inspection refuses the bundle:\n${show(r)}`).not.toBe("");
      expect(line, "the refusal names the marker").toContain(`(marker "${MARKER}")`);
      expect((bundled.get("marker") ?? []).some((b) => b.includes(MARKER)), "the written bundle holds the marker").toBe(true);
    });

    it(tag("CF-AC-003", "the template's and the reference app's Cloudflare bundles pass the provider SDK inspection"), () => {
      for (const label of ["template", "reference"]) {
        const r = results.get(label);
        expect(r?.status, `${label}: ${show(r)}`).toBe(0);
      }
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("CF-AC-003 provider SDKs in the Worker bundle (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}
