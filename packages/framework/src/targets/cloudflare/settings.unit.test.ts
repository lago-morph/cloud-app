/**
 * The stage Worker's settings (cloudflare.md §2 "Worker settings"; config.md §2 "Delivery";
 * DEC-0087): the bundle, static assets with entry-page fallback, the Worker first for `/api`
 * and `/api/*`, the D1, R2 and log-bucket bindings, and the framework variables. D-03 turns them
 * into the SST Worker's arguments; `wranglerWorkerConfig` gives the same settings in Wrangler's
 * form, used to run them under local workerd.
 */
import { describe, expect, it } from "vitest";
import { FrameworkError } from "../../core/errors.js";
import { COMPATIBILITY_DATE } from "../../build/build.js";
import { checkWorkerSettings, cloudflareWorkerSettings, wranglerWorkerConfig, type StageWorkerInput } from "./settings.js";

const input: StageWorkerInput = {
  workerName: "notes-test-abc",
  bundle: "/apps/notes/.framework/cloudflare/worker.js",
  assetsDirectory: "/apps/notes/dist/client",
  publicOrigin: "https://notes-test-abc.example.workers.dev",
  database: { id: "1f2e3d4c-0000-4000-8000-000000000001", name: "notes-test-abc-db-1" },
  filesBucket: "notes-test-abc-files",
};

describe("cloudflareWorkerSettings", () => {
  it("runs the Worker first for /api and /api/*, other paths from static assets with entry-page fallback", () => {
    const settings = cloudflareWorkerSettings(input);
    expect(settings.assets).toEqual({ directory: "/apps/notes/dist/client", notFoundHandling: "single-page-application", runWorkerFirst: ["/api", "/api/*"] });
  });

  it("binds D1 as DB, the stage bucket as FILES and the shared log bucket prototype-logs as LOGS", () => {
    const settings = cloudflareWorkerSettings(input);
    expect(settings.d1Databases).toEqual([{ binding: "DB", databaseId: input.database.id, databaseName: "notes-test-abc-db-1" }]);
    expect(settings.r2Buckets).toEqual([
      { binding: "FILES", bucketName: "notes-test-abc-files" },
      { binding: "LOGS", bucketName: "prototype-logs" },
    ]);
  });

  it("delivers the provisioning-derived public origin as the plain-text Worker variable FRAMEWORK_PUBLIC_ORIGIN", () => {
    const settings = cloudflareWorkerSettings(input);
    expect(settings.vars).toEqual({ FRAMEWORK_PUBLIC_ORIGIN: "https://notes-test-abc.example.workers.dev" });
    expect(settings).toMatchObject({ name: "notes-test-abc", main: input.bundle, compatibilityDate: COMPATIBILITY_DATE });
  });

  it("refuses a public origin that is not an https origin", () => {
    for (const publicOrigin of ["http://notes.example.workers.dev", "https://notes.example.workers.dev/", "notes.example.workers.dev"]) {
      expect(() => cloudflareWorkerSettings({ ...input, publicOrigin })).toThrow(FrameworkError);
    }
  });

  it("never declares a variable or binding named SECRET_* (an upload declaring one replaces that secret, DEC-0087)", () => {
    const settings = cloudflareWorkerSettings(input);
    expect(() => checkWorkerSettings(settings)).not.toThrow();
    const withVar = { ...settings, vars: { ...settings.vars, SECRET_API_KEY: "x" } };
    const withBinding = { ...settings, r2Buckets: [...settings.r2Buckets, { binding: "SECRET_FILES", bucketName: "b" }] };
    for (const bad of [withVar, withBinding]) {
      let thrown: unknown;
      try {
        checkWorkerSettings(bad);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FrameworkError);
      expect((thrown as FrameworkError).code).toBe("CORE.MISCONFIGURED");
      expect((thrown as Error).message).toMatch(/SECRET_(API_KEY|FILES)/);
    }
  });
});

describe("wranglerWorkerConfig", () => {
  it("writes the same settings in Wrangler's configuration form", () => {
    expect(wranglerWorkerConfig(cloudflareWorkerSettings(input))).toEqual({
      name: "notes-test-abc",
      main: input.bundle,
      compatibility_date: COMPATIBILITY_DATE,
      workers_dev: true,
      assets: { directory: "/apps/notes/dist/client", not_found_handling: "single-page-application", run_worker_first: ["/api", "/api/*"] },
      d1_databases: [{ binding: "DB", database_id: input.database.id, database_name: "notes-test-abc-db-1" }],
      r2_buckets: [
        { binding: "FILES", bucket_name: "notes-test-abc-files" },
        { binding: "LOGS", bucket_name: "prototype-logs" },
      ],
      vars: { FRAMEWORK_PUBLIC_ORIGIN: "https://notes-test-abc.example.workers.dev" },
    });
  });
});
