/**
 * CF-AC-002 (cloudflare.md §4, amended by DEC-0550): two stages of one app have disjoint
 * databases, buckets and secrets; both write to the shared log bucket. Both stages' tickets are
 * signed with the account's R2 signing credential, and each stage's ticket names only its own
 * bucket.
 *
 * The two stages are the run's stage (A) and one further `test-<random>` stage of
 * apps/reference (B, prov/support/stage.ts), removed afterwards. Each resource kind is checked
 * twice: by the stage-resource probe (`_cloud/stage-resources.ts`: one database, Worker and
 * bucket per stage, none shared, and no per-stage R2 API token: `deploy` creates none, DEC-0550)
 * and by behaviour through the app (a value written on B is not visible on A, for KV and files;
 * deleting B's secret through the store leaves A's secret unchanged). The credential: both
 * stages' upload tickets carry the same access key ID, the one of the account's signing record
 * (`framework/r2-signing.json`, whose access key ID is the token ID of `prototype-r2-signing`,
 * DEC-0100), and each ticket's bucket is that stage's own `<app>-<stage>-files`. Both stages'
 * entries are found in the shared log bucket by their request IDs.
 *
 * Cloud usage (estimate, D-T.md): one further deploy (≈ 50 D1 rows written by migrations and
 * records), 2 KV rows written (put, delete) and about 10 rows read; R2: 2 small objects written
 * and deleted; ≈ 25 Cloudflare API requests (probe ×2, secrets ×3, deploy/remove not counted
 * here); the signing record is read through R2's S3 endpoint (no API request). Needs D1 (blocked while DEC-0317 holds). Holds 2 D1 databases with the run stage.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLOUD_WAITS, client, tag, target, waitFor, type ComplianceClient } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { cloudHooks as hooksFor } from "../_cloud/index.js";
import { signingAccessKeyId, signingTokens } from "../_cloud/account.js";
import { stageBucketName, stageResourceDetails, stageWorker } from "../_cloud/stage-resources.js";
import { catalogueStatus, isLocal, REFERENCE_DIR, runDeployment, uniqueValue, utcDay } from "../core/support/repo.js";
import { logDayPrefix } from "../core/support/stores.js";
import { withCloudStage } from "../prov/support/stage.js";

/** The first presigned https URL in a ticket's JSON form. */
function ticketUrl(ticket: unknown): URL {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string" && /^https:\/\//.test(v)) found.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(walk);
  };
  walk(ticket);
  if (found[0] === undefined) throw new Error(`the upload ticket carries no https URL: ${JSON.stringify(ticket).slice(0, 200)}`);
  return new URL(found[0]);
}

/** Access key ID of a SigV4 presigned URL (`X-Amz-Credential=<key>/<date>/…`) and its first path segment (path-style bucket). */
function signing(url: URL): { accessKey: string; bucket: string } {
  const credential = url.searchParams.get("X-Amz-Credential") ?? "";
  return { accessKey: credential.split("/")[0] ?? "", bucket: decodeURIComponent(url.pathname.split("/")[1] ?? "") };
}

async function logKeyFor(app: string, stage: string, requestId: string): Promise<string> {
  const hooks = hooksFor("cloudflare");
  const day = utcDay(new Date());
  return waitFor(
    async () => (await hooks.listLogKeys(logDayPrefix(app, stage, day))).find((k) => k.endsWith(`-${requestId}.json`)),
    { what: `the log entry of request ${requestId} of stage ${stage} in the shared log bucket`, timeoutMs: CLOUD_WAITS.requestMs, intervalMs: 2_000 },
  );
}

if (!isLocal()) {
  describe("CF-AC-002 two stages (cloud)", () => {
    it(
      tag("CF-AC-002", "two stages of one app have disjoint databases, buckets and secrets, both write to the shared log bucket, and both sign tickets with the account's R2 signing credential, each naming only its own bucket"),
      async () => {
        const t = target().target;
        requireCloudD1(t);
        const run = runDeployment();
        const a = { app: run.app, stage: run.stage };
        const valueB = uniqueValue("dt1cf002");
        await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: valueB }, databases: 1 }, async (stageB) => {
          await stageB.deployReady();
          const b = { app: stageB.app, stage: stageB.stage };
          const hooks = hooksFor(t);

          // Probe: one of each per stage, none shared; no per-stage R2 API token (DEC-0550).
          const [ra, rb] = [await stageResourceDetails(a), await stageResourceDetails(b)];
          for (const [label, r] of [["A (run stage)", ra], ["B (further stage)", rb]] as const) {
            expect(r.databases.length, `${label}: databases`).toBe(1);
            expect(r.workers.length, `${label}: Workers`).toBe(1);
            expect(r.buckets.length, `${label}: R2 buckets`).toBe(1);
          }
          expect(rb.tokens, "B, deployed now: per-stage R2 API tokens (deploy creates none, DEC-0550)").toEqual([]);
          expect(ra.databases.map((d) => d.uuid), "database IDs").not.toEqual(rb.databases.map((d) => d.uuid));
          expect(ra.buckets, "buckets").not.toEqual(rb.buckets);
          expect(await stageWorker(a), "Workers (secret stores)").not.toBe(await stageWorker(b));
          const accountKey = await signingAccessKeyId();
          expect(accountKey, "the account's signing record names an access key ID").toBeDefined();
          expect((await signingTokens()).map((x) => x.id), "the account's signing token is the record's").toEqual([accountKey]);

          const userA: ComplianceClient = await client().as("user");
          const userB: ComplianceClient = await stageB.client().as("user");
          const key = `dt1:cf002:${randomBytes(6).toString("hex")}`;
          const file = `dt1/cf002-${randomBytes(6).toString("hex")}.txt`;
          try {
            // Databases: a KV value written on B is absent on A.
            userB.expectStatus(await userB.request("PUT", "/api/kv/value", { json: { key, value: "written on B" } }), 204);
            expect(userB.expectStatus(await userB.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json(), "B reads its value").toEqual({ value: "written on B" });
            expect(userA.expectStatus(await userA.get(`/api/kv/value?key=${encodeURIComponent(key)}`), 200).json(), "A does not see B's value").toEqual({ value: null });

            // Buckets: a file written on B is absent on A.
            userB.expectStatus(await userB.request("PUT", "/api/files/content", { json: { name: file, contentType: "text/plain", base64: Buffer.from("B").toString("base64") } }), 204);
            expect(userB.expectStatus(await userB.get(`/api/files/head?name=${encodeURIComponent(file)}`), 200).json<{ file: unknown }>().file, "B sees its file").not.toBeNull();
            expect(userA.expectStatus(await userA.get(`/api/files/head?name=${encodeURIComponent(file)}`), 200).json(), "A does not see B's file").toEqual({ file: null });

            // Credentials: both stages sign with the account's credential; each ticket names only its own bucket.
            const ticketName = `dt1/cf002-ticket-${randomBytes(4).toString("hex")}.txt`;
            const sa = signing(ticketUrl(userA.expectStatus(await userA.post("/api/files/upload-ticket", { name: ticketName, contentType: "text/plain" }), 200).json<{ ticket: unknown }>().ticket));
            const sb = signing(ticketUrl(userB.expectStatus(await userB.post("/api/files/upload-ticket", { name: ticketName, contentType: "text/plain" }), 200).json<{ ticket: unknown }>().ticket));
            expect(sa.accessKey, "A's ticket is signed with the account's R2 signing credential").toBe(accountKey);
            expect(sb.accessKey, "B's ticket is signed with the account's R2 signing credential").toBe(accountKey);
            expect(sa.bucket, "A's ticket names A's own bucket").toBe(stageBucketName(a));
            expect(sb.bucket, "B's ticket names B's own bucket").toBe(stageBucketName(b));
            expect(sb.bucket, "the stages' ticket buckets").not.toBe(sa.bucket);
          } finally {
            await userB.request("DELETE", `/api/kv/value?key=${encodeURIComponent(key)}`);
            await userB.request("DELETE", `/api/files/content?name=${encodeURIComponent(file)}`);
          }

          // Secrets: both stores hold SECRET_API_KEY; the values differ; deleting B's leaves A's.
          expect(await hooks.secretLocations(a), "A's secret locations").toContain("SECRET_API_KEY");
          expect(await hooks.secretLocations(b), "B's secret locations").toContain("SECRET_API_KEY");
          const anonA = client();
          const anonB = stageB.client();
          const shaA = anonA.expectStatus(await anonA.get("/api/ref/secret"), 200).json<{ sha256: string }>().sha256;
          const shaB = anonB.expectStatus(await anonB.get("/api/ref/secret"), 200).json<{ sha256: string }>().sha256;
          expect(shaB, "the stages' secret values").not.toBe(shaA);
          await hooks.deleteSecret(b, "apiKey");
          // DEC-0092: a secret change reaches requests after a short, bounded delay.
          await waitFor(async () => ((await anonB.get("/api/ref/secret")).errorCode === "SEC.MISSING" ? true : undefined), { what: "B answering SEC.MISSING after its secret was deleted", timeoutMs: CLOUD_WAITS.routeToggleMs * 2, intervalMs: 2_000 });
          anonB.expectError(await anonB.get("/api/ref/secret"), catalogueStatus("SEC.MISSING"), "SEC.MISSING");
          expect(anonA.expectStatus(await anonA.get("/api/ref/secret"), 200).json(), "A's secret is unchanged").toEqual({ sha256: shaA });

          // Both write to the shared log bucket.
          const idA = anonA.expectStatus(await anonA.post("/api/ref/log", { severity: "info", message: "d-t1 CF-AC-002 stage A" }), 200).json<{ requestId: string }>().requestId;
          const idB = anonB.expectStatus(await anonB.post("/api/ref/log", { severity: "info", message: "d-t1 CF-AC-002 stage B" }), 200).json<{ requestId: string }>().requestId;
          expect(await logKeyFor(a.app, a.stage, idA), "A's entry in the shared bucket").toMatch(new RegExp(`^${a.app}/${a.stage}/`));
          expect(await logKeyFor(b.app, b.stage, idB), "B's entry in the shared bucket").toMatch(new RegExp(`^${b.app}/${b.stage}/`));
        });
      },
      45 * 60_000,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("CF-AC-002 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
