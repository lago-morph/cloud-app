/**
 * PROV-AC-001 (Cloudflare part; provisioning.md §4): the template app deploys with no files
 * other than its app definition, code, and configuration values. The AWS deploy is recorded
 * not-run by the driver ("AWS phase not started").
 *
 * Reading (D-T.md):
 * - the template's committed files are each the app definition (`src/app.ts`), code
 *   (`src/**`, `index.html`, `tests/**`, generated `migrations/**`), configuration values
 *   (`config/**`), or package/tool metadata every npm app has (`package.json`,
 *   `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`); none is infrastructure as
 *   code (SST, Pulumi, wrangler, Terraform, CDK, SAM, Serverless) and no file or dependency
 *   names a provisioning tool;
 * - a scratch copy of exactly those files deploys to a new `test-<random>` stage (setting the
 *   declared secret when the first deploy asks for it, PROV §2) and the stage answers `/` and
 *   the health check;
 * - the deploy needs no other file in the app: afterwards the copy holds no new file outside
 *   the directories the template's own `.gitignore` lists as generated state.
 *
 * Cloud usage (estimate, D-T.md): one deploy and one remove of the template (≈ 40 D1 rows
 * written by migrations and records, 2 rows read by health checks), ≈ 2 HTTP requests to the
 * stage. Needs D1 (blocked while DEC-0317 holds). Holds 1 D1 database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { listFiles, runCommand } from "../core/support/processes.js";
import { isLocal, REPO_ROOT, TEMPLATE_DIR, uniqueValue } from "../core/support/repo.js";
import { healthStatus, withCloudStage } from "./support/stage.js";

const ALLOWED: readonly RegExp[] = [
  /^src\/app\.ts$/,
  /^src\/.+\.(?:ts|tsx|css|html|svg|png|json)$/,
  /^index\.html$/,
  /^public\/.+$/,
  /^tests\/.+\.ts$/,
  /^migrations\/.+\.(?:sql|json)$/,
  /^config\/(?:local\.json|[a-z0-9]+\/[a-z0-9-]+\.json)$/,
  /^(?:package\.json|tsconfig\.json|vitest\.config\.ts|\.gitignore|README\.md)$/,
];

const IAC_FILE = /(?:^|\/)(?:sst\.config\.[a-z]+|wrangler\.(?:toml|json|jsonc)|Pulumi(?:\.[A-Za-z0-9-]+)?\.ya?ml|pulumi\.[a-z]+|[^/]+\.tf|cdk\.json|serverless\.(?:ya?ml|ts|js)|template\.ya?ml|samconfig\.toml|\.sst\/.*|infra\/.*)$/i;
const IAC_IMPORT = /\bfrom\s+["'](?:sst(?:\/[^"']*)?|@pulumi\/[^"']+|wrangler|aws-cdk-lib[^"']*|@aws-cdk\/[^"']+|cdktf[^"']*)["']/;
const IAC_DEPENDENCY = /^(?:sst|wrangler|@pulumi\/.+|pulumi|aws-cdk-lib|aws-cdk|cdktf|serverless|miniflare)$/;

if (!isLocal()) {
  describe("PROV-AC-001 template deploy (cloud)", () => {
    it(
      tag("PROV-AC-001", "Cloudflare part: the template, holding only its app definition, code and configuration values, deploys and answers"),
      async () => {
        const listed = await runCommand("git", ["ls-files", "--", "apps/template"], { cwd: REPO_ROOT, timeoutMs: 60_000 });
        expect(listed.status, listed.output).toBe(0);
        const files = listed.output.split("\n").filter((l) => l !== "").map((l) => l.slice("apps/template/".length));
        expect(files, "apps/template has committed files").toContain("src/app.ts");
        expect(files.filter((f) => !ALLOWED.some((p) => p.test(f))), "files that are not app definition, code or configuration values").toEqual([]);
        expect(files.filter((f) => IAC_FILE.test(f)), "infrastructure-as-code files").toEqual([]);
        const sources = files.filter((f) => /\.(?:ts|tsx|js|mjs)$/.test(f));
        expect(sources.filter((f) => IAC_IMPORT.test(readFileSync(join(TEMPLATE_DIR, f), "utf8"))), "sources importing a provisioning tool").toEqual([]);
        const pkg = JSON.parse(readFileSync(join(TEMPLATE_DIR, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => IAC_DEPENDENCY.test(d)), "provisioning tools among the template's dependencies").toEqual([]);

        const ignored = readFileSync(join(TEMPLATE_DIR, ".gitignore"), "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l !== "" && !l.startsWith("#"))
          .map((l) => l.replace(/\/$/, ""));
        const isIgnored = (f: string): boolean => ignored.some((g) => f === g || f.startsWith(`${g}/`));

        await withCloudStage({ appDir: TEMPLATE_DIR, app: "template", secrets: { apiKey: uniqueValue("dt1prov001") }, databases: 1 }, async (stage) => {
          const before = new Set((await listFiles(stage.copy.dir)).map((f) => f.slice(stage.copy.dir.length + 1)));
          expect([...before].filter((f) => !isIgnored(f)).sort(), "the scratch copy holds exactly the template's committed files").toEqual([...files].sort());

          await stage.deployReady();
          const c = stage.client();
          c.expectStatus(await c.get("/"), 200);
          expect(await healthStatus(c), "health check of the deployed template").toBe(204);

          const after = (await listFiles(stage.copy.dir)).map((f) => f.slice(stage.copy.dir.length + 1));
          expect(after.filter((f) => !before.has(f) && !isIgnored(f)).sort(), "files the deploy added to the app outside its ignored generated-state directories").toEqual([]);
        });
      },
      45 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-001 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
