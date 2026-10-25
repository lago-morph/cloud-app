/**
 * PROV-AC-002's account clauses against the fake Cloudflare API (DEC-0560): on every automated
 * pass, with no network, the logic of the clauses whose live form changes shared account state
 * and so runs in the milestone pass only (`deploy-sequence.test.ts`, clause 2b):
 * - "without the account's R2 signing credential, deploy names it and `setup-account` and stops
 *   before creating anything" (DEC-0550): a signing record that is absent, or one written before
 *   the backup bucket existed (no `deniedBuckets`, PROV §2 "Signing record"), stops the deploy at
 *   step 1, and the preflight names every absent shared resource in one message, here with the
 *   backup bucket's lifecycle rule (PAR-311, DEC-0543): `the account's shared resources are
 *   missing (…); run setup-account --target cloudflare first`. The deploy sends only reads;
 *   no stage resource exists afterwards;
 * - "deploy needs no permission on API tokens" (DEC-0550, DEC-0551): with every API-token
 *   endpoint refusing (HTTP 403, as for the everyday token), the deploy succeeds and sends no
 *   token creation.
 *
 * The target is the framework's own Cloudflare target (`createCloudflareTarget`) driven by the
 * target-neutral deploy sequence (`runDeploy`), on the framework's in-memory Cloudflare account
 * (`fake-cloud.test-support.ts`, shapes recorded from the live API). Expectations come from
 * PROV-REQ-002 step 1, PROV §2 and the decisions above, not from the implementation.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { captureIo } from "../../../../packages/framework/src/cli/io.test-support.js";
import type { Migration } from "../../../../packages/framework/src/mig/history.js";
import { runDeploy, type DeployRequest } from "../../../../packages/framework/src/provision/core/deploy.js";
import type { HealthOutcome } from "../../../../packages/framework/src/provision/core/operations.js";
import { ACCOUNT, FAKE_SIGNING, FakeCloud, FakeDatabases } from "../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { createCloudflareTarget, type CloudflareTargetOptions } from "../../../../packages/framework/src/provision/cloudflare/target.js";

const STAGE = { app: "reference", stage: "test-fakepreflight" };
const ENV = { CLOUDFLARE_API_TOKEN: "placeholder-not-a-credential", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PATH: "/usr/bin" };
const RECORD_KEY = "sst-state/framework/r2-signing.json";
const BACKUP_RULE_ID = "framework-backups-retention";
const REFUSED = { status: 403, body: { success: false, errors: [{ code: 9109, message: "Unauthorized to access requested resource" }] } };

const migration = (id: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `${id}.sql`, text: "", checksum: "", statements: [] });
const REQUEST: DeployRequest = { stage: STAGE, migrations: { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] }, requiredSecrets: [] };

function account() {
  const cloud = FakeCloud.withSharedResources();
  const options: CloudflareTargetOptions = {
    api: cloud.api,
    accountId: ACCOUNT,
    env: ENV,
    appDir: mkdtempSync(join(tmpdir(), "compl-prov002-fake-")),
    databases: new FakeDatabases(),
    sst: cloud.sst,
    fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
    files: {
      bucketCors: (origin) => ({ rules: [{ allowed: { origins: [origin], methods: ["PUT", "GET"], headers: ["Content-Type"] }, maxAgeSeconds: 60 }] }),
      storagePreflight: async (): Promise<HealthOutcome> => ({ ok: true }),
    },
    randomKey: () => "generated-session-key",
    sleep: async () => {},
  };
  return { cloud, target: createCloudflareTarget(options) };
}

describe("PROV-AC-002 account clauses on the fake Cloudflare API (DEC-0560)", () => {
  it(tag("PROV-AC-002", "fake API: with a signing record written before the backup bucket existed and the PAR-311 rule removed, deploy stops at step 1 naming both in one message that points to setup-account, sending only reads"), async () => {
    const { cloud, target } = account();
    const { deniedBuckets: _old, ...legacy } = FAKE_SIGNING;
    cloud.objectBodies.set(RECORD_KEY, legacy);
    cloud.lifecycles.set("prototype-backups", (cloud.lifecycles.get("prototype-backups") ?? []).filter((r) => (r as { id?: string }).id !== BACKUP_RULE_ID));
    const io = captureIo();
    const result = await runDeploy(target, REQUEST, io);
    expect(result.status, io.err).not.toBe(0);
    const lines = io.err.split("\n").filter((l) => l.includes("the account's shared resources are missing ("));
    expect(lines, `one message names the absent shared resources:\n${io.err}`).toHaveLength(1);
    expect(lines[0]).toContain("R2 signing credential prototype-r2-signing");
    expect(lines[0]).toContain("lifecycle rule of R2 bucket prototype-backups (PAR-311)");
    expect(lines[0]).toContain("run setup-account --target cloudflare first");
    expect(cloud.requests.filter((r) => !r.startsWith("GET ")), "requests that change anything").toEqual([]);
    expect(io.err.includes(FAKE_SIGNING.secretAccessKey), "the output does not print the credential").toBe(false);
    expect((await target.listStageResources(STAGE)).resources, "stage resources the stopped deploy created").toEqual([]);
  });

  it(tag("PROV-AC-002", "fake API: without the signing record, deploy names the R2 signing credential and setup-account and stops before creating anything"), async () => {
    const { cloud, target } = account();
    cloud.objectBodies.delete(RECORD_KEY);
    cloud.buckets.get("sst-state")?.delete("framework/r2-signing.json");
    const io = captureIo();
    expect((await runDeploy(target, REQUEST, io)).status, io.err).not.toBe(0);
    expect(io.err).toMatch(/the account's shared resources are missing \(.*R2 signing credential prototype-r2-signing.*\); run setup-account --target cloudflare first/);
    expect(cloud.requests.filter((r) => !r.startsWith("GET ")), "requests that change anything").toEqual([]);
    expect((await target.listStageResources(STAGE)).resources, "stage resources the stopped deploy created").toEqual([]);
  });

  it(tag("PROV-AC-002", "fake API: with every API-token endpoint refused (the everyday token), the deploy succeeds and creates no API token"), async () => {
    const { cloud, target } = account();
    cloud.override.set(`GET /accounts/${ACCOUNT}/tokens/permission_groups`, REFUSED);
    cloud.override.set(`GET /accounts/${ACCOUNT}/tokens?per_page=50&page=1`, REFUSED);
    cloud.override.set(`POST /accounts/${ACCOUNT}/tokens`, REFUSED);
    const io = captureIo();
    expect((await runDeploy(target, REQUEST, io)).status, io.err).toBe(0);
    expect(cloud.requests.filter((r) => r.startsWith(`POST /accounts/${ACCOUNT}/tokens`)), "token creations").toEqual([]);
  });
});
