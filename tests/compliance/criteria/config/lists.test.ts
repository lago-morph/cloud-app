/**
 * CFG-AC-005 (docs/components/config.md §4; CFG-REQ-005 as amended, DEC-0521, DEC-0522,
 * DEC-0526): "A build of a values file holding `framework.admins` (even an empty list) fails with
 * `CORE.MISCONFIGURED`, naming the file and the unknown field `framework.admins`; likewise for
 * `framework.users`. `createTestApp` with `config: { framework: { admins: [] } }` or
 * `{ users: [] }` throws. The stage configuration schema's `framework` properties are exactly
 * `email`. The committed values files of the template, the reference app and the demo, and
 * `skill/templates/production-stage.json`, hold neither field."
 *
 * The build is the framework's own build pipeline (`buildApp`, what `build` runs; cli.md §2),
 * loaded from the built package, run on a scratch copy of the reference app whose committed
 * `config/local.json` is edited there, so the thrown error's code can be read (the CLI prints only
 * the message). Rewritten for the amended criterion: the admin and users lists are removed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { referenceTestApp } from "../core/support/in-process.js";
import { requireBuiltFramework, scratchCopy } from "../core/support/processes.js";
import { DOCS, FRAMEWORK_DIR, isLocal, REFERENCE_DIR, REPO_ROOT } from "../core/support/repo.js";

type BuildApp = (options: { readonly appDir: string; readonly target: "local"; readonly stage: string }) => Promise<unknown>;

async function buildApp(): Promise<BuildApp> {
  requireBuiltFramework();
  return ((await import(pathToFileURL(join(FRAMEWORK_DIR, "dist", "build", "build.js")).href)) as { buildApp: BuildApp }).buildApp;
}

/** Every `*.json` under an app's `config/`. */
function valuesFiles(appDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".json")) out.push(full);
    }
  };
  walk(join(appDir, "config"));
  return out;
}

if (isLocal()) {
  describe("CFG: no admin or users list in configuration", () => {
    it(
      tag("CFG-AC-005", "a build of a values file holding framework.admins or framework.users (even an empty list) fails with CORE.MISCONFIGURED naming the file and the unknown field"),
      async () => {
        const build = await buildApp();
        const copy = await scratchCopy(REFERENCE_DIR, "cfg-ac-005");
        try {
          const original = JSON.parse(await copy.read("config/local.json")) as { values?: unknown; framework?: Record<string, unknown> };
          for (const [field, value] of [
            ["admins", []],
            ["admins", ["u_AAAAAAAAAAAAAAAAAAAAAAAAAA"]],
            ["users", []],
            ["users", ["u_AAAAAAAAAAAAAAAAAAAAAAAAAA"]],
          ] as const) {
            await copy.write("config/local.json", JSON.stringify({ ...original, framework: { ...(original.framework ?? {}), [field]: value } }, null, 2));
            const error = (await build({ appDir: copy.dir, target: "local", stage: "local" }).then(
              () => undefined,
              (e: unknown) => e,
            )) as { code?: unknown; message?: unknown } | undefined;
            const what = `framework.${field} = ${JSON.stringify(value)}`;
            expect(error, `${what}: the build fails`).toBeDefined();
            expect(error?.code, `${what}: the error code`).toBe("CORE.MISCONFIGURED");
            expect(String(error?.message), `${what}: names the file`).toContain("local.json");
            expect(String(error?.message), `${what}: names the unknown field`).toContain(`framework.${field}`);
            expect(String(error?.message), `${what}: as an unknown field`).toMatch(/unknown|unrecognized/i);
          }
          await copy.write("config/local.json", JSON.stringify(original, null, 2));
          await expect(build({ appDir: copy.dir, target: "local", stage: "local" }), "the unedited file builds").resolves.toBeDefined();
        } finally {
          await copy.remove();
        }
      },
      900_000,
    );

    it(tag("CFG-AC-005", "createTestApp with config.framework.admins or config.framework.users throws"), async () => {
      for (const framework of [{ admins: [] }, { users: [] }]) {
        await expect(referenceTestApp({ secrets: { apiKey: "cfg-ac-005-in-process-value" }, config: { framework } as never }), JSON.stringify(framework)).rejects.toThrow();
      }
    });

    it(tag("CFG-AC-005", "the stage configuration schema's framework properties are exactly email"), () => {
      const schema = JSON.parse(readFileSync(join(DOCS, "contracts", "schemas", "stage-config.schema.json"), "utf8")) as { properties?: { framework?: { properties?: Record<string, unknown> } } };
      expect(Object.keys(schema.properties?.framework?.properties ?? {})).toEqual(["email"]);
    });

    it(tag("CFG-AC-005", "the committed values files of the template, the reference app and the demo, and skill/templates/production-stage.json, hold neither framework.admins nor framework.users"), () => {
      const files = [
        ...["template", "reference", "demo"].flatMap((app) => valuesFiles(join(REPO_ROOT, "apps", app))),
        join(REPO_ROOT, "skill", "templates", "production-stage.json"),
      ];
      expect(files.length).toBeGreaterThan(4);
      const holding = files.filter((file) => {
        const framework = (JSON.parse(readFileSync(file, "utf8")) as { framework?: Record<string, unknown> }).framework ?? {};
        return "admins" in framework || "users" in framework;
      });
      expect(holding.map((f) => relative(REPO_ROOT, f))).toEqual([]);
    });
  });
}
