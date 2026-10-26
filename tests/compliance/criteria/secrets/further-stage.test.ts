/**
 * Cloud criteria that change a stage's secrets or remove a stage, run on one further
 * `test-<random>` stage of the reference app (core/support/stages.ts), never on the run's shared
 * stage:
 * - SEC-AC-003 (cloud part): after `secrets set`, the secret exists at SECRET_<NAME> in the
 *   target's store;
 * - SEC-AC-005 (DEC-0540, DEC-0562): after `secrets set`, a request sees the new value within
 *   PAR-310 of the command returning, and 5 consecutive requests sent once PAR-310 has elapsed all
 *   see it; after the secret is deleted directly through the store (test hook), a request fails
 *   with SEC.MISSING within PAR-310, and 5 consecutive requests sent once PAR-310 has elapsed all
 *   fail with it;
 * - SEC-AC-001 (cloud, "without a value" clause) and HTTP-AC-002 (SEC.MISSING on a cloud): the
 *   declared secret without a value fails with SEC.MISSING as a schema-valid ErrorResponse;
 * - LOG-AC-004 (removal clause): after the further stage is removed, the shared bucket and the
 *   run stage's entries remain;
 * - CLI-AC-004 (cloud part): no output of deploy, secrets set or remove contains a test secret value.
 * The tests in this file run in order and share the stage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, CLOUD_WAITS, createClient, tag, waitFor, type HttpResponse } from "../../harness/index.js";
import { delay } from "../core/support/processes.js";
import { withFurtherStage, type FurtherStage } from "../core/support/stages.js";
import { catalogueStatus, isLocal, parameterNumber, REFERENCE_DIR, sha256Hex, uniqueValue, runDeployment, utcDay } from "../core/support/repo.js";
import { expectSecretMissing } from "../core/support/secrets.js";
import { cloudHooks, logDayPrefix } from "../core/support/stores.js";

/** DEC-0562: the sample of consecutive requests sent once PAR-310 has elapsed. */
const CONSECUTIVE = 5;
/** PAR-310 (DEC-0540): the bound for a secret change to reach requests, in ms (the parameter is in seconds). */
const PAR_310_MS = parameterNumber("PAR-310") * 1000;

/**
 * SEC-AC-005 (DEC-0562) for one change whose command (or store deletion) returned at `since`
 * (`performance.now()`): a request shows the change within PAR-310 of `since`; then, once PAR-310
 * has elapsed since `since`, 5 consecutive requests all show it.
 * - While waiting, a non-200 that is not the change is retried (a transient answer during the
 *   rollout), but a 200 whose body is neither the change nor the stale state (`stale`, the old
 *   value's hash) fails at once.
 * - Each of the 5 samples must show the change (`changed`, then `check`); one that does not fails,
 *   reported as a stale read when it answers the old value's hash.
 */
async function expectChange(o: {
  readonly since: number;
  readonly request: () => Promise<HttpResponse>;
  readonly changed: (r: HttpResponse) => boolean;
  readonly stale: { readonly sha256: string };
  readonly what: string;
  readonly check?: (r: HttpResponse) => void;
}): Promise<void> {
  const staleText = JSON.stringify(o.stale);
  let unexpected: string | undefined;
  const left = o.since + PAR_310_MS - performance.now();
  expect(left, "PAR-310 had already elapsed when the wait began").toBeGreaterThan(0);
  await waitFor(
    async () => {
      const r = await o.request();
      if (o.changed(r)) return true;
      if (r.status === 200 && r.text !== staleText) {
        unexpected = r.text.slice(0, 200);
        return false; // stop waiting: this answer is a failure, not a delay
      }
      return undefined;
    },
    { what: `${o.what} within PAR-310 of the change`, timeoutMs: left, intervalMs: 1_000 },
  );
  expect(unexpected, "a 200 before the change was seen whose body is neither the change nor the old value's hash").toBeUndefined();
  // Then wait until PAR-310 has elapsed since the change, and send 5 consecutive requests.
  await delay(Math.max(0, o.since + PAR_310_MS - performance.now()));
  for (let i = 1; i <= CONSECUTIVE; i += 1) {
    const label = `consecutive request ${String(i)} of ${String(CONSECUTIVE)} sent once PAR-310 had elapsed`;
    const r = await o.request();
    if (!o.changed(r)) {
      const stale = r.status === 200 && r.text === staleText;
      expect.fail(stale ? `${label} answered the old value's hash (stale) after PAR-310` : `${label} did not show the change: status ${String(r.status)}, body ${r.text.slice(0, 200)}`);
    }
    o.check?.(r);
  }
}

if (!isLocal()) {
  describe("further reference stage: secrets and stage removal (cloud)", () => {
    const values = [uniqueValue("furtherA"), uniqueValue("furtherB"), uniqueValue("furtherC")] as const;
    let stage: FurtherStage | undefined;
    let finish: (() => void) | undefined;
    let held: Promise<void> | undefined;
    let ready: Promise<FurtherStage> | undefined;
    /** The value the stage's apiKey last held (SEC-AC-005's old value). */
    let lastSet: string = values[0];

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
        lastSet = values[1];
        const hooks = await cloudHooks("SEC-AC-003");
        expect(await hooks.secretLocations({ app: s.app, stage: s.stage }), "secret locations set on the stage").toContain("SECRET_API_KEY");
        const c = createClient({ baseUrl: s.baseUrl });
        // DEC-0092: a newly set Cloudflare secret becomes visible within a bounded time.
        await waitFor(async () => ((await c.get("/api/ref/secret")).text === JSON.stringify({ sha256: sha256Hex(values[1]) }) ? true : undefined), { what: "the app reading the newly set value", timeoutMs: 60_000, intervalMs: 2_000 });
      },
      10 * 60_000,
    );

    it(
      tag("SEC-AC-005", "after secrets set, a request sees the new value within PAR-310 of the command returning and 5 consecutive requests sent once PAR-310 has elapsed all see it; after the secret is deleted through the store, a request fails with SEC.MISSING within PAR-310 and 5 consecutive requests sent once PAR-310 has elapsed all fail with it"),
      async () => {
        const s = current();
        const hooks = await cloudHooks("SEC-AC-005");
        const c = createClient({ baseUrl: s.baseUrl });
        const status = catalogueStatus("SEC.MISSING");
        const oldBody = { sha256: sha256Hex(lastSet) };
        const newBody = { sha256: sha256Hex(values[2]) };
        const seesNew = (r: HttpResponse): boolean => r.status === 200 && r.text === JSON.stringify(newBody);
        const isMissing = (r: HttpResponse): boolean => r.status === status && r.errorCode === "SEC.MISSING";

        const set = await s.setSecret("apiKey", values[2]);
        expect(set.status, set.output).toBe(0);
        const setReturned = performance.now();
        lastSet = values[2];
        await expectChange({ since: setReturned, request: () => c.get("/api/ref/secret"), changed: seesNew, stale: oldBody, what: "a request seeing the value secrets set wrote" });

        await hooks.deleteSecret({ app: s.app, stage: s.stage }, "apiKey");
        const deleteReturned = performance.now();
        await expectChange({
          since: deleteReturned,
          request: () => c.get("/api/ref/secret"),
          changed: isMissing,
          stale: newBody,
          what: "a request failing with SEC.MISSING after the secret was deleted through the store",
          check: (r) => c.expectError(r, status, "SEC.MISSING"),
        });
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
