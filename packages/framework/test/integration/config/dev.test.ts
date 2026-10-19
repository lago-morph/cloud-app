/**
 * CFG-AC-003 (local): changing a value in the committed file has no effect on a running build
 * and takes effect only after the next build. The running build is `dev`; the next build is the
 * next `dev` start, which builds the app again (decision B-T1-6). Criteria: docs/components/config.md §4.
 */
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { delay, devFixtureFiles, makeTempApp, stageConfig, startDev, type DevServer, type TempApp } from "../core/harness/harness.js";

let app: TempApp | undefined;
let dev: DevServer | undefined;

afterAll(async () => {
  await dev?.stop();
  await app?.remove();
}, 60_000);

async function greeting(server: DevServer): Promise<unknown> {
  const res = await fetch(`${server.baseUrl}/api/config`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { greeting: unknown }).greeting;
}

describe("CFG-AC-003 local", () => {
  it(tag("CFG-AC-003", "local: a committed value change has no effect on the running build and takes effect after the next build"), async () => {
    app = await makeTempApp(devFixtureFiles({ name: "bt1cfgdev", greeting: "before the change" }));
    dev = await startDev(app.dir);
    expect(await greeting(dev)).toBe("before the change");

    await app.write("config/local.json", stageConfig({ greeting: "after the change" }));
    // Give any file watcher ample time to react; the running build must not change.
    await delay(8_000);
    expect(await greeting(dev)).toBe("before the change");
    await delay(2_000);
    expect(await greeting(dev)).toBe("before the change");

    await dev.stop();
    dev = undefined;
    dev = await startDev(app.dir);
    expect(await greeting(dev)).toBe("after the change");
  }, 400_000);
});
