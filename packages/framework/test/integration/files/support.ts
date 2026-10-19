/**
 * Shared support for the FILES integration suite (B-T3). Written from docs/components/files.md
 * and docs/contracts/ts/{files,client,core,testing}.d.ts, not from any implementation.
 *
 * Server operations run inside a real app route against `c.var.files` of a `createTestApp`
 * app (local R2 through Wrangler's getPlatformProxy, DEC-0105): the test hands the route a
 * scenario function and reads back its result or the error it threw.
 */
import { defineApp, type DefinedApp, type FilesService } from "../../../src/index.js";
import { createTestApp, type TestApp, type TestAppOptions } from "../../../src/testing/index.js";

type Scenario = (files: FilesService) => Promise<unknown>;

let pending: Scenario | undefined;
let outcome: { ok: true; value: unknown } | { ok: false; error: unknown } | undefined;

/** App with a scenario runner route and the routes the browser tests use. */
export function filesApp(): DefinedApp<{}, never> {
  return defineApp({
    name: "filessuite",
    config: {},
    secrets: [],
    tables: {},
    routes: (api) => {
      api.post("/scenario", async (c) => {
        const scenario = pending;
        pending = undefined;
        if (scenario === undefined) return c.json({ missing: true }, 500);
        try {
          outcome = { ok: true, value: await scenario(c.var.files) };
        } catch (error) {
          outcome = { ok: false, error };
        }
        return c.body(null, 204);
      });
      // Lets an uncaught FILES error reach the framework error handler.
      api.get("/head-uncaught", async (c) => c.json(await c.var.files.head(c.req.query("name") ?? "x")));
      api.post("/tickets/upload", async (c) => {
        const { name, contentType } = (await c.req.json()) as { name: string; contentType?: string };
        const ticket = await c.var.files.createUploadTicket(name, contentType === undefined ? undefined : { contentType });
        return c.json(ticket);
      });
      api.post("/tickets/download", async (c) => {
        const { name } = (await c.req.json()) as { name: string };
        return c.json(await c.var.files.createDownloadTicket(name));
      });
      api.get("/head", async (c) => c.json(await c.var.files.head(c.req.query("name") ?? "")));
    },
  });
}

const created: TestApp[] = [];

export async function newFilesApp(options?: TestAppOptions): Promise<TestApp> {
  const app = await createTestApp(filesApp(), options);
  created.push(app);
  return app;
}

export async function disposeAll(): Promise<void> {
  const apps = created.splice(0, created.length);
  await Promise.all(apps.map((a) => a.dispose()));
}

/** Runs `scenario` inside an app request and returns its value; rethrows what it threw. */
export async function withFiles<T>(app: TestApp, scenario: (files: FilesService) => Promise<T>): Promise<T> {
  pending = scenario;
  outcome = undefined;
  const res = await app.request("/api/scenario", { method: "POST" });
  if (res.status !== 204) throw new Error(`scenario route answered ${res.status}: ${await res.text()}`);
  const result = outcome as { ok: true; value: unknown } | { ok: false; error: unknown } | undefined;
  if (result === undefined) throw new Error("scenario did not run");
  if (!result.ok) throw result.error;
  return result.value as T;
}

/** Runs `scenario` and returns the error it threw (fails if it did not throw). */
export async function errorOf(app: TestApp, scenario: (files: FilesService) => Promise<unknown>): Promise<unknown> {
  try {
    await withFiles(app, scenario);
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to throw");
}

export async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Deterministic pseudo-random bytes covering every byte value. */
export function sampleBytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    if (i < 256) {
      out[i] = i;
      continue;
    }
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** Sorts strings in Unicode code point order (not UTF-16 code unit order). */
export function codePointSort(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ca = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
    const cb = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      const d = (ca[i] ?? 0) - (cb[i] ?? 0);
      if (d !== 0) return d;
    }
    return ca.length - cb.length;
  });
}
