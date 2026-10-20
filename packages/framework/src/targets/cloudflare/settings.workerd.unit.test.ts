/**
 * The stage Worker's settings run under local workerd (Wrangler's `unstable_startWorker`, no
 * Cloudflare account): a `build --target cloudflare --stage test-x` bundle with
 * `wranglerWorkerConfig(cloudflareWorkerSettings(…))`, a built client directory, and local D1 and
 * R2 for the bindings. Checks the routing of cloudflare.md §2 (Worker first for `/api` and
 * `/api/*`, static assets otherwise, entry-page fallback) and that the bundle's log entries reach
 * the `LOGS` binding.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy, unstable_startWorker } from "wrangler";
import { tag } from "../../../../../tests/support/tags.js";
import { buildApp } from "../../build/public.js";
import { cloudflareWorkerSettings, wranglerWorkerConfig } from "./settings.js";

const SRC = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const APP = `
import { defineApp } from ${JSON.stringify(join(SRC, "index.ts"))};
export default defineApp({
  name: "cfroute",
  config: {},
  secrets: [],
  tables: {},
  routes: (api) => {
    api.get("/hello", (c) => {
      c.var.log.write("APP", "info", "hello route");
      return c.json({ from: "worker", requestId: c.var.requestId });
    });
  },
});
`;

type Worker = Awaited<ReturnType<typeof unstable_startWorker>>;
let worker: Worker;
let dir: string;
let configPath: string;
const ORIGIN = "https://cfroute-test-x.example.workers.dev";
const INDEX = "<!doctype html><title>entry page marker</title>";

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "d01-route-"));
  const files: Record<string, string> = {
    "src/app.ts": APP,
    "config/cloudflare/test.json": JSON.stringify({ values: {}, framework: {} }),
    "dist/client/index.html": INDEX,
    "dist/client/assets/app.js": "console.log('client asset marker');\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const result = await buildApp({ appDir: dir, target: "cloudflare", stage: "test-x", runtimeImport: join(SRC, "targets", "cloudflare", "public.ts") });
  const settings = cloudflareWorkerSettings({
    workerName: "cfroute-test-x",
    bundle: result.bundle,
    assetsDirectory: join(dir, "dist", "client"),
    publicOrigin: ORIGIN,
    database: { id: "00000000-0000-0000-0000-000000000000", name: "cfroute-test-x-db-1" },
    filesBucket: "cfroute-test-x-files",
  });
  configPath = join(dir, "wrangler.json");
  writeFileSync(configPath, JSON.stringify(wranglerWorkerConfig(settings)));
  worker = await unstable_startWorker({ config: configPath, dev: { server: { port: 0 }, inspector: false, persist: join(dir, "state") } as never });
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const navigate = { headers: { "sec-fetch-mode": "navigate", accept: "text/html" } };

// The first requests into a fresh workerd take seconds on a busy host (same allowance as build.unit.test.ts).
describe("stage Worker settings under workerd", { timeout: 60_000 }, () => {
  it(tag("CF-AC-001", "local workerd: /api/* runs the Worker (app route; unknown API path is a JSON 404, also for /api itself)"), async () => {
    const hello = await worker.fetch("http://localhost/api/hello");
    expect(((await hello.json()) as { from: string }).from).toBe("worker");
    for (const path of ["/api/nope", "/api/deep/er/path", "/api"]) {
      const res = await worker.fetch(`http://localhost${path}`, navigate);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type") ?? "", path).toMatch(/application\/json/);
      expect(((await res.json()) as { error: { code: string } }).error.code, path).toBe("HTTP.NOT_FOUND");
    }
  });

  it(tag("CF-AC-001", "local workerd: other paths are static assets with fallback to the entry page"), async () => {
    const root = await worker.fetch("http://localhost/", navigate);
    expect(await root.text()).toContain("entry page marker");
    const asset = await worker.fetch("http://localhost/assets/app.js");
    expect(await asset.text()).toContain("client asset marker");
    for (const path of ["/notes/42", "/apix"]) {
      const res = await worker.fetch(`http://localhost${path}`, navigate);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain("entry page marker");
    }
  });

  it(tag("LOG-AC-004", "local workerd: the Cloudflare bundle stores a request's entry in the LOGS binding under the key layout"), async () => {
    const res = await worker.fetch("http://localhost/api/hello");
    const { requestId } = (await res.json()) as { requestId: string };
    // The same local R2 state, opened beside the running Worker.
    const proxy = await getPlatformProxy<{ LOGS: { list(o: { prefix: string }): Promise<{ objects: { key: string }[] }> } }>({ configPath, persist: { path: join(dir, "state", "v3") } });
    const logs = proxy.env.LOGS;
    let keys: string[] = [];
    try {
      // Bounded wait: the write runs in waitUntil after the response.
      for (let attempt = 0; attempt < 50 && keys.length === 0; attempt++) {
        keys = (await logs.list({ prefix: "cfroute/test-x/" })).objects.map((o) => o.key).filter((k) => k.endsWith(`-info-${requestId}.json`));
        if (keys.length === 0) await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await proxy.dispose();
    }
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^cfroute\/test-x\/\d{4}\/\d{2}\/\d{2}\/\d{6}\.\d{3}-info-/);
  });
});
