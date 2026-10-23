/**
 * E2E-010 — Schema evolution with data (Where: Cloud (milestone); written now, run by D-RUN-M).
 *
 * "Deploy reference app version 1 and load its data fixture, including files. Deploy version 2,
 * which adds a defaulted column, adds an index, and drops a column. Deploy version 2 again.
 * Pass: all data not explicitly dropped survives the first upgrade, the stage is left with one
 * database, and the second deploy applies nothing and causes no downtime."
 *
 * Its own stage (`test-<random>`, a stage-lifecycle scenario: compliance.md "Test stages"),
 * removed at the end. Version 2 is a copy of the reference app with the `versions/v2/` overlay
 * applied (ROUTES.md "Migration overlays"). Data: the fixture's 3 parents, 5 children, 2 files.
 * "Applies nothing": the stage keeps the same database (a deploy that applies a migration
 * copies to a new one, MIG-REQ-006) and the dump is unchanged. "No downtime": the stage answers every
 * probe during the second deploy (one light request per second, no database rows).
 */
import { join } from "node:path";
import { createClient, newTestStage, REFERENCE_APP, tag, target, type ComplianceClient } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { applyOverlay, copyApp, deployStage, randomSuffix, removeDir, removeStage, withE2EStages } from "./support/apps.js";
import { stageDatabases } from "./support/cloud.js";
import { REFERENCE_DIR, tail } from "./support/process.js";

interface Dump {
  readonly version: string;
  readonly parents: readonly { readonly name: string; readonly note?: string | null }[];
  readonly children: readonly { readonly parent: string; readonly label: string; readonly rank?: number }[];
  readonly files: readonly { readonly name: string; readonly size: number; readonly contentType: string; readonly sha256: string }[];
}

async function dump(api: ComplianceClient): Promise<Dump> {
  return api.expectStatus(await api.get("/api/fixture/dump"), 200).json<Dump>();
}

async function schemaVersion(origin: string): Promise<string> {
  const api = createClient({ baseUrl: origin });
  return api.expectStatus(await api.get("/api/ref/schema-version"), 200).json<{ version: string }>().version;
}

test(tag("E2E-010", "data survives the v1 → v2 upgrade, the stage keeps one database, and deploying v2 again applies nothing with no downtime"), async () => {
  test.setTimeout(60 * 60_000);
  // Holds 2 D1 databases during the v2 deploy (MIG-REQ-006): the stage guards cover the whole body, removal included.
  await withE2EStages(2, "E2E-010 (v1 → v2 on its own stage)", async () => {
    const t = target();
    const stage = newTestStage();
    const secrets = { apiKey: `e2e010-${randomSuffix(16)}` };
    // Each version deploys from its own copy, so no other deploy shares its build directory.
    const v1 = copyApp(REFERENCE_DIR, "e2e010-v1");
    const v2 = copyApp(REFERENCE_DIR, "e2e010-v2");
    applyOverlay(v2, join(REFERENCE_DIR, "versions", "v2"));
    try {
      // Version 1, with the data fixture (rows and files).
      const first = await deployStage(v1, t.target, stage, secrets);
      expect(await schemaVersion(first.origin)).toBe("v1");
      const user1 = await createClient({ baseUrl: first.origin }).as("user", { id: `e2e010-${randomSuffix()}` });
      const loaded = user1.expectStatus(await user1.post("/api/fixture/load", {}), 201).json<unknown>();
      expect(loaded).toEqual({ parents: 3, children: 5, files: 2 });
      const before = await dump(user1);
      expect(before.version).toBe("v1");
      expect([before.parents.length, before.children.length, before.files.length]).toEqual([3, 5, 2]);
      const dbV1 = await stageDatabases(t.target, REFERENCE_APP, stage);
      expect(dbV1, "one database after the first deploy").toHaveLength(1);

      // Version 2: adds children.rank (default 0), an index, and drops parents.note.
      const second = await deployStage(v2, t.target, stage, secrets);
      expect(await schemaVersion(second.origin)).toBe("v2");
      const user2 = await createClient({ baseUrl: second.origin }).as("user", { id: `e2e010-${randomSuffix()}` });
      const after = await dump(user2);
      expect(after.version).toBe("v2");
      // Every parent survives without the dropped column; every child survives with the default.
      expect(after.parents).toEqual(before.parents.map((p) => ({ name: p.name })));
      expect(after.children).toEqual(before.children.map((c) => ({ parent: c.parent, label: c.label, rank: 0 })));
      expect(after.files).toEqual(before.files);
      const dbV2 = await stageDatabases(t.target, REFERENCE_APP, stage);
      expect(dbV2, "the stage is left with one database").toHaveLength(1);

      // Version 2 again: nothing to apply, and the stage keeps answering throughout.
      const probe = createClient({ baseUrl: second.origin });
      const failures: string[] = [];
      let probes = 0;
      let deploying = true;
      const poller = (async () => {
        while (deploying) {
          probes++;
          try {
            const r = await probe.get("/api/ref/schema-version");
            if (r.status !== 200) failures.push(`status ${String(r.status)} code ${r.errorCode ?? "none"} at ${new Date().toISOString()}`);
          } catch (error) {
            failures.push(`${error instanceof Error ? error.message : String(error)} at ${new Date().toISOString()}`);
          }
          await new Promise((r) => setTimeout(r, 1_000));
        }
      })();
      let third: Awaited<ReturnType<typeof deployStage>>;
      try {
        third = await deployStage(v2, t.target, stage, secrets);
      } finally {
        deploying = false;
        await poller;
      }
      expect(probes, "the stage was probed during the second v2 deploy").toBeGreaterThan(3);
      expect(failures, `the stage did not answer during the second v2 deploy:\n${failures.join("\n")}`).toEqual([]);
      expect(await stageDatabases(t.target, REFERENCE_APP, stage), "the same single database after the second v2 deploy").toEqual(dbV2);
      const user3 = await createClient({ baseUrl: third.origin }).as("user", { id: `e2e010-${randomSuffix()}` });
      expect(await dump(user3)).toEqual(after);
    } finally {
      const removed = await removeStage(v2, t.target, stage);
      removeDir(v1);
      removeDir(v2);
      expect(removed.status, `remove --stage ${stage}:\n${tail(removed.output)}`).toBe(0);
    }
  });
});
