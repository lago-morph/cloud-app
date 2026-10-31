/**
 * The stage Worker's settings (cloudflare.md §2 "Worker settings"; config.md §2 "Delivery";
 * DEC-0087): the bundle, static assets with entry-page fallback, the Worker first for `/api`
 * and `/api/*`, the D1, R2 and log-bucket bindings, and the framework variables. D-03 turns them
 * into the SST Worker's arguments; `wranglerWorkerConfig` gives the same settings in Wrangler's
 * form, used to run them under local workerd.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
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
  isTestStage: true,
};

/** A production stage of the same app, with the account's email domain from a stubbed account settings record. */
const production: StageWorkerInput = {
  ...input,
  workerName: "notes-prod",
  publicOrigin: "https://notes-prod.example.workers.dev",
  isTestStage: false,
  emailDomain: "example.test",
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

  it(tag("CF-AC-003", "every stage's Worker carries the compatibility flag nodejs_compat"), () => {
    for (const stage of [input, production, { ...input, emailDomain: "example.test" }]) {
      expect(cloudflareWorkerSettings(stage).compatibilityFlags).toEqual(["nodejs_compat"]);
    }
  });

  it("a production stage binds EMAIL (send_email) with exactly the allowed sender no-reply@<emailDomain> and sets FRAMEWORK_MAIL_FROM (untagged: MAIL-AC-004 is retired, DEC-0696; the EMAIL binding stays until F removes it)", () => {
    const settings = cloudflareWorkerSettings(production);
    expect(settings.sendEmail).toEqual([{ binding: "EMAIL", allowedSenderAddresses: ["no-reply@example.test"] }]);
    expect(settings.vars).toEqual({ FRAMEWORK_PUBLIC_ORIGIN: "https://notes-prod.example.workers.dev", FRAMEWORK_MAIL_FROM: "no-reply@example.test" });
  });

  it("a test stage binds no EMAIL, with or without a recorded email domain; with one it sets FRAMEWORK_MAIL_FROM (untagged: MAIL-AC-004 is retired, DEC-0696; the EMAIL binding stays until F removes it)", () => {
    expect(cloudflareWorkerSettings(input).sendEmail).toEqual([]);
    const recorded = cloudflareWorkerSettings({ ...input, emailDomain: "example.test" });
    expect(recorded.sendEmail).toEqual([]);
    expect(recorded.vars["FRAMEWORK_MAIL_FROM"]).toBe("no-reply@example.test");
  });

  it("a production stage without the account's email domain is CORE.MISCONFIGURED naming the missing domain, and no removed option (v0.2.0, DEC-0689)", () => {
    const { emailDomain: _omitted, ...withoutDomain } = production;
    expect(() => cloudflareWorkerSettings(withoutDomain)).toThrow(/needs the account's email domain for its EMAIL binding; the account settings record names none/);
    expect(() => cloudflareWorkerSettings(withoutDomain)).not.toThrow(/--email-domain/);
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
    const withEmail = { ...settings, sendEmail: [{ binding: "SECRET_FILES", allowedSenderAddresses: ["no-reply@example.test"] }] };
    for (const bad of [withVar, withBinding, withEmail]) {
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
      compatibility_flags: ["nodejs_compat"],
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

  it("writes a production stage's EMAIL binding as Wrangler's send_email", () => {
    const config = wranglerWorkerConfig(cloudflareWorkerSettings(production));
    expect(config["send_email"]).toEqual([{ name: "EMAIL", allowed_sender_addresses: ["no-reply@example.test"] }]);
    expect(config["vars"]).toMatchObject({ FRAMEWORK_MAIL_FROM: "no-reply@example.test" });
  });
});
