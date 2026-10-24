/**
 * CFG-AC-003 (configuration is fixed at deploy time; docs/components/config.md §4):
 * - every target: the run's deployment reports exactly its committed values (the committed file
 *   for this target and stage, over the app's declared defaults);
 * - locally: changing a value in the committed file has no effect on a running build and takes
 *   effect only after the next build. Shown on a scratch copy of the reference app, so the run's
 *   working tree is never changed (COMPL-REQ-003).
 */
import { describe, expect, it } from "vitest";
import { client, createClient, tag } from "../../harness/index.js";
import { delay, scratchCopy, startDev, type DevSession } from "../core/support/processes.js";
import { committedValuesFile, isLocal, readStageValues, REFERENCE_CONFIG_DEFAULTS, REFERENCE_DIR, runDeployment, uniqueValue } from "../core/support/repo.js";

describe("CFG: fixed at deploy time", () => {
  it(tag("CFG-AC-003", "the run's deployment reports exactly its committed values over the declared defaults"), async () => {
    const run = runDeployment();
    const committed = readStageValues(committedValuesFile(REFERENCE_DIR, run.target, run.stage));
    const expected = { ...REFERENCE_CONFIG_DEFAULTS, ...(committed.values ?? {}) };
    const c = client();
    expect(c.expectStatus(await c.get("/api/ref/config"), 200).json()).toEqual(expected);
  });

  if (isLocal()) {
    it(
      tag("CFG-AC-003", "locally, a changed committed value has no effect on the running build and takes effect after the next build"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "cfg-ac-003");
        let dev: DevSession | undefined;
        try {
          const file = "config/local.json";
          const original = JSON.parse(await copy.read(file)) as { values?: Record<string, unknown> };
          const before = { ...REFERENCE_CONFIG_DEFAULTS, ...(original.values ?? {}) };
          dev = await startDev(copy.dir);
          const c1 = createClient({ baseUrl: dev.baseUrl });
          expect(c1.expectStatus(await c1.get("/api/ref/config"), 200).json(), "first build").toEqual(before);

          const changed = uniqueValue("changed greeting ");
          await copy.write(file, `${JSON.stringify({ ...original, values: { ...(original.values ?? {}), greeting: changed } }, null, 2)}\n`);
          for (let i = 0; i < 4; i += 1) {
            await delay(1500);
            expect(c1.expectStatus(await c1.get("/api/ref/config"), 200).json(), `running build, ${String((i + 1) * 1.5)} s after the change`).toEqual(before);
          }
          await dev.stop();
          dev = undefined;

          dev = await startDev(copy.dir);
          const c2 = createClient({ baseUrl: dev.baseUrl });
          expect(c2.expectStatus(await c2.get("/api/ref/config"), 200).json(), "after the next build").toEqual({ ...before, greeting: changed });
        } finally {
          if (dev !== undefined) await dev.stop();
          await copy.remove();
        }
      },
      600_000,
    );
  }
});
