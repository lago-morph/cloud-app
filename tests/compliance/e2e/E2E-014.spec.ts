/**
 * E2E-014 — Secrets and configuration discipline (Where: Local, cloud).
 *
 * "Set the reference app's secret with the CLI on each cloud, deploy, and scan the repository,
 * the build outputs, the deployed browser assets, the logs. Locally, change a configuration
 * value and rebuild. Pass: the secret value appears nowhere scanned, each deployed stage
 * reports exactly its committed configuration values, and the local configuration change takes
 * effect only after the rebuild."
 *
 * - Every target: the stage reports exactly its committed values (`GET /api/ref/config`
 *   against the app's declared defaults overlaid with the committed values file: locally
 *   `config/local.json`, on a test stage `config/<target>/test.json`; CFG §2).
 * - Cloud: a fresh secret value is set with `secrets set apiKey` on the run's stage, the stage is
 *   deployed again, the routes that read and throw with the secret are exercised, then the
 *   repository, `apps/reference/.framework/` (build outputs), the browser assets the stage
 *   serves and the stage's log entries of the day are scanned.
 * - Local: in a copy of the reference app (so the tree stays clean), a fresh secret is set the
 *   same way; `dev` serves the committed value; `config/local.json` is changed while `dev` runs
 *   and the served value stays the same; after the rebuild (`dev` restarted, which builds;
 *   DEC-0215) the new value is served. The same scans run on the copy (sources, `.framework/`,
 *   served assets, `.logs/`).
 *
 * The value is compared, never printed: findings name only where it was found.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOUD_WAITS, client, createClient, REFERENCE_APP, tag, target, waitFor } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { crawlAssets, filesWithValue, repositoryFiles } from "./support/assets.js";
import { copyApp, randomSuffix, removeDir, setSecret, setSecretThenDeploy } from "./support/apps.js";
import { cloudLogEntries, utcDay } from "./support/cloud.js";
import { REFERENCE_DIR, REPO_ROOT, startDev, type DevServer } from "./support/process.js";
import { listFiles, sha256Hex } from "./support/scan.js";

/** The reference app's declared configuration defaults (ROUTES.md "Configuration and secrets"). */
const DEFAULTS = { greeting: "Hello", pageSize: 20, featureOn: false, tags: [] as string[] };

function committedValues(appDir: string, file: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(join(appDir, "config", file), "utf8")) as { values?: Record<string, unknown> };
  return { ...DEFAULTS, ...(parsed.values ?? {}) };
}

function freshSecret(): string {
  return `e2e014-${randomSuffix(16)}`;
}

/** Exercises the routes that read the secret and fail with it in their error message. */
async function exerciseSecret(origin: string, value: string): Promise<void> {
  const api = createClient({ baseUrl: origin });
  const digest = await waitFor(
    async () => {
      const r = await api.get("/api/ref/secret");
      return r.status === 200 && r.json<{ sha256: string }>().sha256 === sha256Hex(value) ? r : undefined;
    },
    { what: "the stage to report the new secret's digest", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1000 },
  );
  expect(digest.status).toBe(200);
  api.expectError(await api.get("/api/ref/throw-secret"), 500, "CORE.INTERNAL");
  api.expectError(await api.get("/api/ref/throw-secret-app"), 409, "HTTP.CONFLICT");
}

function report(kind: string, places: readonly string[]): string {
  return `the secret value was found in ${kind}: ${places.join(", ")}`;
}

test(tag("E2E-014", "the stage reports exactly its committed configuration values"), async () => {
  const t = target();
  const file = t.target === "local" ? "local.json" : join(t.target, "test.json");
  const served = client().expectStatus(await client().get("/api/ref/config"), 200).json<unknown>();
  expect(served).toEqual(committedValues(REFERENCE_DIR, file));
});

if (target().target !== "local") {
  test(tag("E2E-014", "cloud part: a secret set with the CLI appears nowhere in the repository, build outputs, deployed browser assets or logs"), async () => {
    test.setTimeout(30 * 60_000);
    const t = target();
    const stage = t.stage ?? "";
    expect(stage.startsWith("test-"), "the run's test stage").toBe(true);
    const value = freshSecret();
    const from = new Date();

    // Set the secret with the CLI, then deploy (after the D1 stop, DEC-0317: a deploy uses D1).
    const deployed = await setSecretThenDeploy(REFERENCE_DIR, t.target, stage, "apiKey", value);
    await exerciseSecret(deployed.origin, value);

    const repo = filesWithValue(repositoryFiles(REPO_ROOT), value, REPO_ROOT);
    expect(repo.length === 0, report("the repository", repo)).toBe(true);
    const build = filesWithValue(listFiles(join(REFERENCE_DIR, ".framework")), value, REPO_ROOT);
    expect(build.length === 0, report("the build outputs", build)).toBe(true);
    const assets = await crawlAssets(deployed.origin);
    expect(assets.length, "browser assets served").toBeGreaterThan(1);
    const inAssets = assets.filter((a) => a.text.includes(value)).map((a) => a.path);
    expect(inAssets.length === 0, report("the deployed browser assets", inAssets)).toBe(true);

    // The logs: the stage's entries of the day, after the throwing routes' entries have landed.
    const days = [...new Set([utcDay(from), utcDay(new Date())])];
    const entries = await waitFor(
      async () => {
        const all = [];
        for (const day of days) all.push(...(await cloudLogEntries(t.target, REFERENCE_APP, stage, day)));
        return all.some((e) => /-error-/.test(e.key) && Date.parse((JSON.parse(e.body) as { time: string }).time) >= from.getTime() - 60_000) ? all : undefined;
      },
      { what: "the stage's error entries in the shared log bucket", timeoutMs: CLOUD_WAITS.requestMs, intervalMs: 5_000 },
    );
    const inLogs = entries.filter((e) => e.body.includes(value) || e.key.includes(value)).map((e) => e.key);
    expect(inLogs.length === 0, report("the logs", inLogs)).toBe(true);
  });
}

if (target().target === "local") {
  test(tag("E2E-014", "local part: a configuration change takes effect only after the rebuild, and a secret set with the CLI appears nowhere scanned"), async () => {
    test.setTimeout(15 * 60_000);
    const copy = copyApp(REFERENCE_DIR, "e2e014");
    let dev: DevServer | undefined;
    try {
      const value = freshSecret();
      await setSecret(copy, "local", "local", "apiKey", value);
      const committed = committedValues(copy, "local.json");

      dev = await startDev(copy);
      const api = createClient({ baseUrl: dev.origin });
      expect(api.expectStatus(await api.get("/api/ref/config"), 200).json<unknown>()).toEqual(committed);
      await exerciseSecret(dev.origin, value);

      // Change a configuration value while the build runs: it must not take effect.
      const changed = `E2E-014 changed ${randomSuffix()}`;
      const configPath = join(copy, "config", "local.json");
      const file = JSON.parse(readFileSync(configPath, "utf8")) as { values?: Record<string, unknown> };
      writeFileSync(configPath, `${JSON.stringify({ ...file, values: { ...(file.values ?? {}), greeting: changed } }, null, 2)}\n`);
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 2_000));
        expect(api.expectStatus(await api.get("/api/ref/config"), 200).json<{ greeting: string }>().greeting, "the value before the rebuild").toBe(committed.greeting);
      }

      // Scan while the first build's state exists: the copy's files, build outputs, served assets and logs.
      const sources = filesWithValue(
        listFiles(copy, new Set([".framework", ".wrangler", ".logs", "node_modules"])).filter((f) => !f.endsWith(`${"/"}.dev.vars`)),
        value,
        copy,
      );
      expect(sources.length === 0, report("the app's files", sources)).toBe(true);
      const build = filesWithValue(listFiles(join(copy, ".framework")), value, copy);
      expect(build.length === 0, report("the build outputs", build)).toBe(true);
      const assets = await crawlAssets(dev.origin);
      expect(assets.length, "browser assets served").toBeGreaterThan(1);
      const inAssets = assets.filter((a) => a.text.includes(value)).map((a) => a.path);
      expect(inAssets.length === 0, report("the served browser assets", inAssets)).toBe(true);
      const logs = filesWithValue(listFiles(join(copy, ".logs")), value, copy);
      expect(listFiles(join(copy, ".logs")).length, "local log files written").toBeGreaterThan(0);
      expect(logs.length === 0, report("the logs", logs)).toBe(true);
      const repo = filesWithValue(repositoryFiles(REPO_ROOT), value, REPO_ROOT);
      expect(repo.length === 0, report("the repository", repo)).toBe(true);

      // Rebuild: the change takes effect.
      await dev.stop();
      dev = await startDev(copy);
      const rebuilt = createClient({ baseUrl: dev.origin });
      expect(rebuilt.expectStatus(await rebuilt.get("/api/ref/config"), 200).json<unknown>()).toEqual({ ...committed, greeting: changed });
    } finally {
      if (dev !== undefined) await dev.stop();
      removeDir(copy);
    }
  });
}
