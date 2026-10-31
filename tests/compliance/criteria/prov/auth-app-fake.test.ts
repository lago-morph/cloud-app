/**
 * PROV-REQ-002's production sign-in prerequisite (plan-v0.2.0 §3, §4.1; owner question 21,
 * DEC-0725) against the fake Cloudflare API, with the auth app's registry in local D1 (the fake D1
 * HTTP API over Miniflare): no network.
 * - Without the account's auth app (Worker `prototype-auth`), or with an auth app that has no
 *   registry (no D1 binding `DB`), a production deploy stops at step 1 naming it, before anything
 *   is created.
 * - With both, a production deploy binds `AUTH` and registers the stage's return URL, which the
 *   auth app's own exact-match lookup then finds; `remove` clears it again.
 *
 * Criterion text proposed to D for PROV-AC-002 (no criterion names this prerequisite yet): "For a
 * production stage, without the account's auth app or its registry, deploy names it and stops
 * before creating anything; a production deploy registers `<public origin>/api/auth/callback` for
 * `<app>-<stage>` with the auth app, and `remove` clears it."
 *
 * The target is the framework's Cloudflare target with its real auth-app link
 * (`cloudflareAuthAppLink`), driven by the target-neutral `runDeploy` and `runRemove` on the
 * framework's in-memory Cloudflare account. Expectations come from PROV-REQ-002 step 1, plan §3 and
 * §4.1 step 2, and DEC-0667, not from the implementation.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { isRegistered, type D1Like } from "../../../../packages/framework/src/auth-app/store.js";
import { captureIo } from "../../../../packages/framework/src/cli/io.test-support.js";
import type { Migration } from "../../../../packages/framework/src/mig/history.js";
import { runDeploy, type DeployRequest } from "../../../../packages/framework/src/provision/core/deploy.js";
import type { HealthOutcome } from "../../../../packages/framework/src/provision/core/operations.js";
import { runRemove } from "../../../../packages/framework/src/provision/core/remove.js";
import { openFakeD1Api, type FakeD1Api } from "../../../../packages/framework/src/provision/cloudflare/d1/fake-d1-api.js";
import { ACCOUNT, FakeCloud, FakeDatabases, type FakeWorker } from "../../../../packages/framework/src/provision/cloudflare/fake-cloud.test-support.js";
import { createCloudflareTarget } from "../../../../packages/framework/src/provision/cloudflare/target.js";

const PROD = { app: "reference", stage: "prod" };
const APP_ID = "reference-prod";
const RETURN_URL = "https://reference-prod.example.workers.dev/api/auth/callback";
const ENV = { CLOUDFLARE_API_TOKEN: "placeholder-not-a-credential", CLOUDFLARE_ACCOUNT_ID: ACCOUNT, PATH: "/usr/bin" };
const migration = (id: string): Migration => ({ id, name: id.split("/")[1] ?? id, file: `${id}.sql`, text: "", checksum: "", statements: [] });
const REQUEST: DeployRequest = { stage: PROD, migrations: { framework: [migration("framework/0001_init")], app: [migration("app/0001_schema")] }, requiredSecrets: [] };

let d1: FakeD1Api;
let registryId: string;
beforeAll(async () => {
  d1 = await openFakeD1Api({ accountId: ACCOUNT });
  const created = await d1.api("POST", `/accounts/${ACCOUNT}/d1/database`, { name: "auth-app-registry" });
  registryId = (created.body as { result: { uuid: string } }).result.uuid;
}, 60_000);
afterAll(async () => {
  await d1?.close();
});

/** A fake account set up for production deploys (email seam satisfied), with the auth app's Worker as `authApp` gives it. */
function account(authApp: "absent" | "no-registry" | "deployed") {
  const cloud = FakeCloud.withSharedResources();
  cloud.objectBodies.set("sst-state/framework/account.json", { emailDomain: "example.test" });
  cloud.buckets.get("sst-state")!.add("framework/account.json");
  if (authApp !== "absent") {
    const bindings = authApp === "deployed" ? [{ type: "d1", name: "DB", id: registryId }] : [];
    const worker: FakeWorker = { secrets: new Map(), enabled: true, previews: false, bindings };
    cloud.workers.set("prototype-auth", worker);
  }
  // The auth app's registry database answers through the fake D1 HTTP API; everything else is the fake account.
  const api: typeof cloud.api = (method, path, body) => (path.startsWith(`/accounts/${ACCOUNT}/d1/database/${registryId}/`) ? d1.api(method, path, body) : cloud.api(method, path, body));
  const target = createCloudflareTarget({
    api,
    bytes: cloud.bytes,
    accountId: ACCOUNT,
    env: ENV,
    appDir: mkdtempSync(join(tmpdir(), "compl-prov002-auth-")),
    databases: new FakeDatabases(),
    sst: cloud.sst,
    fetch: (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
    code: { bundle: "/app/.framework/cloudflare/worker.js", compatibilityDate: "2026-10-01", logBucketBinding: "LOGS" },
    files: { bucketCors: () => ({ rules: [] }), storagePreflight: async (): Promise<HealthOutcome> => ({ ok: true }) },
    email: { setupProblems: async () => [], setUp: async () => [], productionPrerequisites: async () => [] },
    randomKey: () => "generated-session-key",
    sleep: async () => {},
  });
  return { cloud, target };
}

describe("PROV-REQ-002 production sign-in prerequisite on the fake Cloudflare API (DEC-0725)", () => {
  for (const [state, named] of [
    ["absent", "the account's auth app (Worker prototype-auth) is not deployed"],
    ["no-registry", "the account's auth app (Worker prototype-auth) has no registry (its D1 binding DB)"],
  ] as const) {
    it(tag("PROV-AC-002", `fake API: with the auth app ${state === "absent" ? "absent" : "lacking its registry"}, a production deploy names it at step 1 and creates nothing`), async () => {
      const { cloud, target } = account(state);
      const io = captureIo();
      expect((await runDeploy(target, REQUEST, io)).status, io.err).toBe(1);
      expect(io.err).toMatch(/deploy failed at step 1 \(preflight\)/);
      expect(io.err).toContain(named);
      expect(cloud.requests.filter((r) => !r.startsWith("GET ")), "requests that change anything").toEqual([]);
      expect((await target.listStageResources(PROD)).resources, "stage resources the stopped deploy created").toEqual([]);
    });
  }

  it(tag("PROV-AC-002", "fake API: a production deploy binds AUTH and registers <app>-<stage> with its callback URL, which the auth app's lookup finds; remove clears it"), async () => {
    const { cloud, target } = account("deployed");
    const registry = d1.database(registryId) as unknown as D1Like;
    const io = captureIo();
    expect((await runDeploy(target, REQUEST, io)).status, io.err).toBe(0);
    expect(cloud.workers.get(APP_ID)!.bindings).toContainEqual({ type: "service", name: "AUTH", service: "prototype-auth", entrypoint: "AuthApp" });
    expect(await isRegistered(registry, APP_ID, RETURN_URL)).toBe(true);

    expect((await runRemove(target, PROD, captureIo())).status).toBe(0);
    expect(await isRegistered(registry, APP_ID, RETURN_URL)).toBe(false);
    expect(cloud.workers.has("prototype-auth"), "the auth app itself stays").toBe(true);
  });
});
