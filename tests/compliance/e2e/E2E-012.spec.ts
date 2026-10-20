/**
 * E2E-012 — Stages are isolated (Where: Cloud (milestone); written now, run by D-RUN-M).
 *
 * "Deploy two test stages of the reference app on each cloud, with different data. Remove one.
 * Pass: the other stage's data and the shared resources are intact, and nothing of the removed
 * stage remains except its entries in the shared log bucket."
 *
 * Two stages of its own (`test-<random>` each), each deployed from its own copy of the app.
 * Data differs per stage in every store: the kept stage holds the migration data fixture
 * (SQL rows and files), and each stage holds its own KV value and file. The removed stage
 * writes a log entry first, which must remain. "Nothing remains" is checked with D-T2's
 * stage-resource probe (every resource of PROV's removal list, by exact identifier), the
 * stage's databases by PROV-REQ-002's exact pattern, and the stage's public address no longer
 * serving it.
 */
import { CLOUD_WAITS, createClient, newTestStage, REFERENCE_APP, tag, target, waitFor, type ComplianceClient } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { copyApp, deployStage, randomSuffix, removeDir, removeStage } from "./support/apps.js";
import { cloudflareLogBucketExists, cloudLogEntries, cloudStageResources, stageDatabases, utcDay } from "./support/cloud.js";
import { REFERENCE_DIR, tail } from "./support/process.js";

interface StageData {
  readonly kv: string;
  readonly file: string;
}

async function writeData(api: ComplianceClient, data: StageData): Promise<void> {
  api.expectStatus(await api.request("PUT", "/api/kv/value", { json: { key: "e2e012:marker", value: data.kv } }), 204);
  api.expectStatus(await api.request("PUT", "/api/files/content", { json: { name: "e2e012/marker.txt", contentType: "text/plain", base64: Buffer.from(data.file, "utf8").toString("base64") } }), 204);
}

async function readData(api: ComplianceClient): Promise<StageData> {
  const kv = api.expectStatus(await api.get("/api/kv/value?key=e2e012%3Amarker"), 200).json<{ value: string | null }>().value;
  const file = api.expectStatus(await api.get("/api/files/content?name=e2e012%2Fmarker.txt"), 200).json<{ file: { base64: string } | null }>().file;
  return { kv: kv ?? "<absent>", file: file === null ? "<absent>" : Buffer.from(file.base64, "base64").toString("utf8") };
}

async function sharedBucketExists(targetName: string): Promise<boolean> {
  if (targetName === "cloudflare") return cloudflareLogBucketExists();
  throw new Error(`no shared-bucket probe for ${targetName}`);
}

test(tag("E2E-012", "removing one of two stages leaves the other stage's data and the shared resources intact, and nothing of the removed stage but its log entries"), async () => {
  test.setTimeout(60 * 60_000);
  const t = target();
  const kept = newTestStage();
  const removed = newTestStage();
  const secrets = { apiKey: `e2e012-${randomSuffix(16)}` };
  const keptDir = copyApp(REFERENCE_DIR, "e2e012-kept");
  const removedDir = copyApp(REFERENCE_DIR, "e2e012-removed");
  let removedGone = false;
  try {
    expect(await sharedBucketExists(t.target), "the shared log bucket exists before").toBe(true);
    const keptStage = await deployStage(keptDir, t.target, kept, secrets);
    const removedStage = await deployStage(removedDir, t.target, removed, secrets);
    const keptUser = await createClient({ baseUrl: keptStage.origin }).as("user", { id: "e2e012-user" });
    const removedUser = await createClient({ baseUrl: removedStage.origin }).as("user", { id: "e2e012-user" });

    // Different data per stage, in SQL, KV and files.
    const keptData = { kv: `kept-${randomSuffix()}`, file: `kept file ${randomSuffix()}` };
    const removedData = { kv: `removed-${randomSuffix()}`, file: `removed file ${randomSuffix()}` };
    keptUser.expectStatus(await keptUser.post("/api/fixture/load", {}), 201);
    await writeData(keptUser, keptData);
    await writeData(removedUser, removedData);
    const keptDump = keptUser.expectStatus(await keptUser.get("/api/fixture/dump"), 200).json<{ parents: unknown[]; children: unknown[]; files: unknown[] }>();
    const removedDump = removedUser.expectStatus(await removedUser.get("/api/fixture/dump"), 200).json<{ parents: unknown[]; children: unknown[]; files: unknown[] }>();
    expect([keptDump.parents.length, keptDump.children.length, keptDump.files.length]).toEqual([3, 5, 2]);
    expect([removedDump.parents.length, removedDump.children.length, removedDump.files.length], "stages share no data").toEqual([0, 0, 0]);
    expect(await readData(keptUser)).toEqual(keptData);
    expect(await readData(removedUser)).toEqual(removedData);

    // A log entry of the stage to be removed.
    const logged = removedUser.expectStatus(await removedUser.post("/api/ref/log", { severity: "info", message: `e2e-012 ${randomSuffix()}` }), 200).json<{ requestId: string }>();
    const day = utcDay(new Date());
    const removedEntries = await waitFor(
      async () => {
        const entries = await cloudLogEntries(t.target, REFERENCE_APP, removed, day);
        return entries.some((e) => e.key.includes(logged.requestId)) ? entries : undefined;
      },
      { what: "the removed stage's log entry in the shared bucket", timeoutMs: CLOUD_WAITS.requestMs, intervalMs: 5_000 },
    );
    const keptDatabases = await stageDatabases(t.target, REFERENCE_APP, kept);
    expect(keptDatabases).toHaveLength(1);

    // Remove one stage.
    const result = await removeStage(removedDir, t.target, removed);
    expect(result.status, `remove --stage ${removed}:\n${tail(result.output)}`).toBe(0);
    removedGone = true;

    // Nothing of the removed stage remains…
    expect(await cloudStageResources(t.target, REFERENCE_APP, removed), "resources of the removed stage").toEqual([]);
    expect(await stageDatabases(t.target, REFERENCE_APP, removed), "databases of the removed stage").toEqual([]);
    await waitFor(
      async () => {
        try {
          const r = await createClient({ baseUrl: removedStage.origin }).get("/api/ref/deployment");
          return r.status === 200 && r.text.includes(removed) ? undefined : true;
        } catch {
          return true;
        }
      },
      { what: "the removed stage's address to stop serving it", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 2_000 },
    );
    // …except its entries in the shared log bucket.
    const after = await cloudLogEntries(t.target, REFERENCE_APP, removed, day);
    expect(after.map((e) => e.key).sort(), "the removed stage's log entries remain").toEqual(expect.arrayContaining(removedEntries.map((e) => e.key)));

    // The other stage and the shared resources are intact.
    expect(await sharedBucketExists(t.target), "the shared log bucket exists after").toBe(true);
    expect(await stageDatabases(t.target, REFERENCE_APP, kept)).toEqual(keptDatabases);
    const keptAgain = await createClient({ baseUrl: keptStage.origin }).as("user", { id: "e2e012-user" });
    expect(await readData(keptAgain)).toEqual(keptData);
    expect(keptAgain.expectStatus(await keptAgain.get("/api/fixture/dump"), 200).json<unknown>()).toEqual(keptDump);
  } finally {
    const cleanup: string[] = [];
    if (!removedGone) {
      const r = await removeStage(removedDir, t.target, removed);
      if (r.status !== 0) cleanup.push(`remove ${removed}: ${tail(r.output, 500)}`);
    }
    const r = await removeStage(keptDir, t.target, kept);
    if (r.status !== 0) cleanup.push(`remove ${kept}: ${tail(r.output, 500)}`);
    removeDir(keptDir);
    removeDir(removedDir);
    expect(cleanup, "test stages removed").toEqual([]);
  }
});
