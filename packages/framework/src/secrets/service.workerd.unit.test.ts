/**
 * The framework secret reader inside local workerd (Miniflare) with a real Secrets Store binding
 * (plan-v0.2.0 D7; DEC-0727): `deploy` binds a Secrets Store secret under the `SECRET_<NAME>` of the
 * Worker secret it replaces, and the Worker reads it through the same reader as a Worker secret.
 * No network.
 */
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BINDING = "SECRET_FRAMEWORK_R2_ACCESS_KEY_ID";
let mf: Miniflare;

beforeAll(async () => {
  const service = fileURLToPath(new URL("./service.ts", import.meta.url));
  const entry = `
    import { createFrameworkSecrets, envSecretReader } from ${JSON.stringify(service)};
    export default {
      async fetch(_request, env) {
        try {
          return new Response(await createFrameworkSecrets({ read: envSecretReader(env, "cloudflare") }).get("frameworkR2AccessKeyId"));
        } catch (error) {
          return new Response(error.code, { status: 500 });
        }
      },
    };`;
  const out = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: "js" }, bundle: true, format: "esm", platform: "neutral", target: "es2022", write: false, logLevel: "silent" });
  const manifest = { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: out.outputFiles[0]!.text } } };
  const env = { [BINDING]: { type: "secrets-store-secret" as const, storeId: "store1", secretName: "PROTOTYPE_R2_ACCESS_KEY_ID" } };
  mf = new Miniflare({ workers: [{ config: { name: "app", compatibilityDate: "2026-10-01", manifest, env } }] });
  await mf.ready;
}, 60_000);
afterAll(async () => {
  await mf?.dispose();
});

describe("a Secrets Store binding read by the framework in workerd (DEC-0727)", () => {
  it("before the secret exists in the store the read fails as SEC.UNAVAILABLE; once it exists the Worker reads its value", async () => {
    const before = await mf.dispatchFetch("https://app.example/");
    expect(before.status).toBe(500);
    expect(await before.text()).toBe("SEC.UNAVAILABLE");

    const value = `key-${crypto.randomUUID()}`;
    await (await mf.getSecretsStoreSecretAPI(BINDING))().create(value);
    const after = await mf.dispatchFetch("https://app.example/");
    expect(await after.text()).toBe(value);
  });
});
