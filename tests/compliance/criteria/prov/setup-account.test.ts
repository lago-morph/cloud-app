/**
 * PROV-AC-004 (provisioning.md §4; milestone): running `setup-account` twice changes nothing
 * the second time, including in the state home. Deploying without it fails with a clear
 * message.
 *
 * Idempotence: `setup-account --target cloudflare` runs once (creating or confirming the shared
 * resources), then the account's shared state is snapshotted, `setup-account` runs again, and
 * the snapshot must be identical. The snapshot covers: the shared log bucket and the state home
 * (`sst-state`, DEC-0084) — existence, bucket settings (creation date, location, storage
 * class), CORS and lifecycle rules — every object of the state home (key, ETag, last-modified,
 * size), every object of the log bucket that is not a log entry (account settings recorded with
 * the shared resources, PROV §2 "State home"), and the workers.dev subdomain (by digest only,
 * DEC-0086). Run in a milestone pass with no stage running, so no log entry is written meanwhile.
 *
 * "Deploying without it": needs an account on which `setup-account` has never run. The test
 * never deletes the shared resources (they hold other stages' state and retained log entries),
 * so it runs only when the operator says the account is fresh (`COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1`)
 * and the log bucket is indeed absent; otherwise it reports a missing prerequisite (`blocked`).
 * It then runs before the idempotence test (file order). The deploy must exit non-zero, name
 * `setup-account` and the missing shared resource, and create nothing.
 *
 * Cloud usage (estimate, D-T.md): no D1 at all (setup-account creates R2 buckets only; the
 * stopped deploy creates nothing). ≈ 20 Cloudflare API requests (two setup-account runs'
 * own requests not counted), plus the state-home and log-bucket listings through R2's S3
 * endpoint (one request per 1,000 objects).
 */
import { describe, expect, it } from "vitest";
import { newTestStage, prerequisiteMissing, tag, target } from "../../harness/index.js";
import { accountId, cfApi } from "../_cloud/api.js";
import { LOG_BUCKET, listObjects, STATE_BUCKET } from "../_cloud/r2.js";
import { listStageResources, sharedResources } from "../_cloud/stage-resources.js";
import { scratchCopy } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR } from "../core/support/repo.js";
import { runCli, tail } from "./support/stage.js";

const FRESH_ENV = "COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT";
/** A log entry's key (LOG-REQ-004): `<app>/<stage>/<yyyy>/<mm>/<dd>/<file>`. */
const LOG_ENTRY_KEY = /^[a-z0-9]+\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/;

async function bucketSettings(bucket: string): Promise<unknown> {
  const base = `/accounts/${accountId()}/r2/buckets/${encodeURIComponent(bucket)}`;
  const out: Record<string, unknown> = {};
  for (const [name, path] of [["bucket", base], ["cors", `${base}/cors`], ["lifecycle", `${base}/lifecycle`]] as const) {
    const r = await cfApi("GET", path);
    out[name] = { status: r.status, result: r.body?.result ?? null };
  }
  return out;
}

async function accountSnapshot(): Promise<unknown> {
  return {
    shared: await sharedResources(),
    logBucket: await bucketSettings(LOG_BUCKET),
    stateHome: await bucketSettings(STATE_BUCKET),
    stateObjects: await listObjects(STATE_BUCKET, ""),
    logBucketNonEntries: (await listObjects(LOG_BUCKET, "")).filter((o) => !LOG_ENTRY_KEY.test(o.key)),
  };
}

if (!isLocal()) {
  describe("PROV-AC-004 setup-account (cloud, milestone, no D1)", () => {
    it(tag("PROV-AC-004", "deploying on an account without setup-account fails with a clear message and creates nothing"), async () => {
      if (process.env[FRESH_ENV] !== "1") {
        prerequisiteMissing(
          `needs a Cloudflare account on which setup-account has never run (set ${FRESH_ENV}=1 on such an account); this test never deletes the shared log bucket or state home, which hold other stages' state and retained log entries`,
        );
      }
      if ((await sharedResources()).logBucket) prerequisiteMissing(`${FRESH_ENV}=1 is set, but the shared log bucket ${LOG_BUCKET} exists: the account is not fresh`);
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004");
      const stage = newTestStage();
      try {
        const r = await runCli(["deploy", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(r.status, `deploy without setup-account must fail:\n${tail(r.output)}`).not.toBe(0);
        expect(r.output, "the message tells the owner to run setup-account").toContain("setup-account");
        expect(r.output, "the message names the missing shared resource").toContain(LOG_BUCKET);
        expect(await listStageResources({ target: t, app: "reference", stage }), "resources the stopped deploy created").toEqual([]);
      } finally {
        await copy.remove();
      }
    }, 15 * 60_000);

    it(tag("PROV-AC-004", "running setup-account twice changes nothing the second time, including in the state home"), async () => {
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004");
      try {
        const first = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(first.status, `first setup-account:\n${tail(first.output)}`).toBe(0);
        const before = await accountSnapshot();
        expect((before as { shared: { logBucket: boolean; stateHome: boolean } }).shared, "shared resources after the first run").toMatchObject({ logBucket: true, stateHome: true });

        const second = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(second.status, `second setup-account:\n${tail(second.output)}`).toBe(0);
        expect(await accountSnapshot(), "the account's shared state after the second run").toEqual(before);
      } finally {
        await copy.remove();
      }
    }, 30 * 60_000);
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-004 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
