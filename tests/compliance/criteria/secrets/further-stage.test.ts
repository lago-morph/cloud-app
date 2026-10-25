/**
 * Cloud criteria that change a stage's secrets or remove a stage, run on one further
 * `test-<random>` stage of the reference app (core/support/stages.ts), never on the run's shared
 * stage:
 * - SEC-AC-003 (cloud part): after `secrets set`, the secret exists at SECRET_<NAME> in the
 *   target's store;
 * - SEC-AC-005 (DEC-0540): after `secrets set`, requests see the new value within PAR-310 and the
 *   5 consecutive requests after the first that sees it all see it; after the secret is deleted
 *   directly through the store (test hook), requests fail with SEC.MISSING within PAR-310 and the
 *   5 consecutive requests after the first that fails all fail with it;
 * - SEC-AC-001 (cloud, "without a value" clause) and HTTP-AC-002 (SEC.MISSING on a cloud): the
 *   declared secret without a value fails with SEC.MISSING as a schema-valid ErrorResponse;
 * - LOG-AC-004 (removal clause): after the further stage is removed, the shared bucket and the
 *   run stage's entries remain;
 * - CLI-AC-004 (cloud part): no output of deploy, secrets set or remove contains a test secret value.
 * The tests in this file run in order and share the stage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, CLOUD_WAITS, createClient, tag, waitFor } from "../../harness/index.js";
import { withFurtherStage, type FurtherStage } from "../core/support/stages.js";
import { catalogueStatus, isLocal, REFERENCE_DIR, sha256Hex, uniqueValue, runDeployment, utcDay } from "../core/support/repo.js";
import { expectSecretMissing } from "../core/support/secrets.js";
import { cloudHooks, logDayPrefix } from "../core/support/stores.js";

/** DEC-0540: the sample of consecutive requests after the first that shows the change. */
const CONSECUTIVE = 5;

if (!isLocal()) {
  describe("further reference stage: secrets and stage removal (cloud)", () => {
    const values = [uniqueValue("furtherA"), uniqueValue("furtherB"), uniqueValue("furtherC")] as const;
    let stage: FurtherStage | undefined;
    let finish: (() => void) | undefined;
    let held: Promise<void> | undefined;
    let ready: Promise<FurtherStage> | undefined;

    beforeAll(() => {
      // Hold the further stage open for the tests below; withFurtherStage removes it when `finish` is called.
      ready = new Promise<FurtherStage>((resolveReady, rejectReady) => {
        held = withFurtherStage(REFERENCE_DIR, "reference", { apiKey: values[0] }, (s) => {
          stage = s;
          resolveReady(s);
          return new Promise<void>((done) => (finish = done));
        }).catch((error: unknown) => {
          rejectReady(error);
        });
      });
      return ready.then(() => undefined);
    }, 45 * 60_000);

    afterAll(async () => {
      finish?.();
      await held;
    }, 30 * 60_000);

    function current(): FurtherStage {
      if (stage === undefined) throw new Error("the further stage was not deployed");
      return stage;
    }

    it(
      tag("SEC-AC-003", "on the cloud, after secrets set the secret exists at SECRET_API_KEY in the stage's store and the app reads that value"),
      async () => {
        const s = current();
        const set = await s.setSecret("apiKey", values[1]);
        expect(set.status, set.output).toBe(0);
        const hooks = await cloudHooks("SEC-AC-003");
        expect(await hooks.secretLocations({ app: s.app, stage: s.stage }), "secret locations set on the stage").toContain("SECRET_API_KEY");
        const c = createClient({ baseUrl: s.baseUrl });
        // DEC-0092: a newly set Cloudflare secret becomes visible within a bounded time.
        await waitFor(async () => ((await c.get("/api/ref/secret")).text === JSON.stringify({ sha256: sha256Hex(values[1]) }) ? true : undefined), { what: "the app reading the newly set value", timeoutMs: 60_000, intervalMs: 2_000 });
      },
      10 * 60_000,
    );

    it(
      tag("SEC-AC-005", "after secrets set, requests see the new value within PAR-310 and the next 5 consecutive requests all see it; after the secret is deleted through the store, requests fail with SEC.MISSING within PAR-310 and the next 5 consecutive requests all fail with it"),
      async () => {
        const s = current();
        const hooks = await cloudHooks("SEC-AC-005");
        const c = createClient({ baseUrl: s.baseUrl });
        const status = catalogueStatus("SEC.MISSING");
        const expected = JSON.stringify({ sha256: sha256Hex(values[2]) });

        const set = await s.setSecret("apiKey", values[2]);
        expect(set.status, set.output).toBe(0);
        // PAR-310 (DEC-0540): the first request that sees the new value comes within the bound.
        await waitFor(async () => {
          const r = await c.get("/api/ref/secret");
          return r.status === 200 && r.text === expected ? true : undefined;
        }, { what: "a request seeing the value secrets set wrote (PAR-310)", timeoutMs: CLOUD_WAITS.secretRolloutMs, intervalMs: 1_000 });
        // Then 5 consecutive requests all see it: the old value never comes back (sampled).
        for (let i = 1; i <= CONSECUTIVE; i += 1) {
          expect(c.expectStatus(await c.get("/api/ref/secret"), 200).json(), `consecutive request ${String(i)} of ${String(CONSECUTIVE)} after the first that saw the new value`).toEqual({ sha256: sha256Hex(values[2]) });
        }

        await hooks.deleteSecret({ app: s.app, stage: s.stage }, "apiKey");
        // PAR-310: the first request that fails with SEC.MISSING comes within the bound.
        await waitFor(async () => {
          const r = await c.get("/api/ref/secret");
          return r.status === status && r.errorCode === "SEC.MISSING" ? true : undefined;
        }, { what: "a request failing with SEC.MISSING after the secret was deleted through the store (PAR-310)", timeoutMs: CLOUD_WAITS.secretRolloutMs, intervalMs: 1_000 });
        for (let i = 1; i <= CONSECUTIVE; i += 1) {
          c.expectError(await c.get("/api/ref/secret"), status, "SEC.MISSING");
        }
      },
      10 * 60_000,
    );

    it(
      tag(["SEC-AC-001", "HTTP-AC-002"], "on the cloud, the declared secret without a value fails with SEC.MISSING as a schema-valid ErrorResponse with the request's ID"),
      async () => {
        const s = current();
        const hooks = await cloudHooks("SEC-AC-001");
        // Independent of the previous test: make sure the stage has no value.
        try {
          await hooks.deleteSecret({ app: s.app, stage: s.stage }, "apiKey");
        } catch {
          // already deleted
        }
        // DEC-0092: the deletion reaches requests after a short, bounded delay; then the unchanged
        // assertions run on fresh requests (core/support/secrets.ts).
        await expectSecretMissing(createClient({ baseUrl: s.baseUrl }));
      },
      10 * 60_000,
    );

    it(
      tag("LOG-AC-004", "after a stage is removed, the shared log bucket and the other stage's entries remain"),
      async () => {
        const s = current();
        const run = runDeployment();
        const hooks = await cloudHooks("LOG-AC-004");
        const main = client();
        const mainEntry = main.expectStatus(await main.post("/api/ref/log", { severity: "info", message: uniqueValue("c-t1 LOG-AC-004 run stage ") }), 200).json<{ requestId: string }>();
        const further = createClient({ baseUrl: s.baseUrl });
        further.expectStatus(await further.post("/api/ref/log", { severity: "info", message: uniqueValue("c-t1 LOG-AC-004 further stage ") }), 200);

        const day = utcDay(new Date());
        const mainKeys = async (): Promise<string[]> => [...(await hooks.listLogKeys(logDayPrefix(run.app, run.stage, day)))].filter((k) => k.endsWith(`-${mainEntry.requestId}.json`));
        const before = await waitFor(async () => {
          const keys = await mainKeys();
          return keys.length > 0 ? keys : undefined;
        }, { what: "the run stage's entry in the shared bucket", timeoutMs: 30_000, intervalMs: 1000 });

        const removed = await s.remove();
        expect(removed.status, removed.output).toBe(0);
        expect(await hooks.logBucketExists(), "the shared log bucket exists after the stage is removed").toBe(true);
        expect(await mainKeys(), "the run stage's entry is still in the bucket").toEqual(before);
      },
      30 * 60_000,
    );

    it(tag("CLI-AC-004", "on the cloud, no output of deploy, secrets set or remove contains a test secret value"), () => {
      const outputs = current().outputs;
      expect(outputs.length, "commands ran").toBeGreaterThan(0);
      const hits = outputs.flatMap((r) => values.filter((v) => r.output.includes(v)).map(() => r.command.replace(/\S*prototype-framework\.js/, "prototype-framework")));
      expect(hits, "commands whose output contains a test secret value").toEqual([]);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("further reference stage (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
