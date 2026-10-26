import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { ALLOWED_NODE_MODULES, disallowedNodeModules, nodeModulesIn, packageOfModule, PROVIDER_SDK_MARKERS, providerSdksIn } from "./inspect.js";

describe("CF-REQ-003: the Node.js modules a Worker bundle may reference (DEC-0516)", () => {
  it("allows exactly node:crypto and node:async_hooks", () => {
    expect([...ALLOWED_NODE_MODULES].sort()).toEqual(["node:async_hooks", "node:crypto"]);
  });

  it(tag("CF-AC-003", "a bundle importing only node:crypto and node:async_hooks passes, however they are referenced"), () => {
    const bundle = [
      'import{scrypt as a,randomBytes as b}from"node:crypto";',
      'const c=globalThis.process?.getBuiltinModule?.("node:async_hooks");',
      'const d=()=>import("node:async_hooks");',
      'import"crypto";',
    ].join("");
    expect(nodeModulesIn(bundle)).toEqual(["node:async_hooks", "node:crypto"]);
    expect(disallowedNodeModules(bundle)).toEqual([]);
  });

  it(tag("CF-AC-003", "any other node: specifier or bare built-in is reported, by its node: name"), () => {
    const bundle = [
      'import{readFileSync as a}from"node:fs";',
      'import*as b from"path";',
      'const c=require("child_process");',
      'const d=import("fs/promises");',
      'const e=process.getBuiltinModule("node:sqlite");',
      'export{x}from"node:worker_threads";',
    ].join("");
    expect(disallowedNodeModules(bundle)).toEqual(["node:child_process", "node:fs", "node:fs/promises", "node:path", "node:sqlite", "node:worker_threads"]);
  });

  it("ordinary strings that only resemble module names are not references", () => {
    expect(nodeModulesIn('const a="fs",b="path to file",c={crypto:1},d="nodejs_compat";')).toEqual([]);
  });
});

describe("CF-REQ-003: no provider SDK in the Worker bundle (DEC-0554)", () => {
  /** A minified bundle like esbuild writes for an app with only ordinary packages and the framework's signer. */
  const ORDINARY = [
    'var a=new AwsClient({accessKeyId:k,secretAccessKey:s,service:"s3",region:"auto"});',
    'const h={"X-Amz-Date":d,"X-Amz-Content-Sha256":"UNSIGNED-PAYLOAD"};',
    'const z=zod.object({bucket:zod.string()}),msg="upload to storage";',
  ].join("");
  const ORDINARY_MODULES = ["../../node_modules/aws4fetch/dist/aws4fetch.esm.mjs", "../../node_modules/zod/v4/core/core.js", "../../node_modules/hono/dist/hono.js", "src/app.ts"];

  it(tag("CF-AC-003", "a bundle of ordinary packages and the framework's own SigV4 signer passes"), () => {
    expect(providerSdksIn(ORDINARY, ORDINARY_MODULES)).toEqual([]);
  });

  it(tag("CF-AC-003", "a module bundled from a denied package fails, named by its package, whatever its depth"), () => {
    const modules = [...ORDINARY_MODULES, "../../node_modules/nice-uploads/node_modules/@aws-sdk/client-s3/dist-es/S3Client.js", "node_modules/@google-cloud/storage/build/esm/index.js"];
    expect(providerSdksIn(ORDINARY, modules)).toEqual(["package @aws-sdk/client-s3", "package @google-cloud/storage"]);
    expect(packageOfModule("C:\\app\\node_modules\\pg\\lib\\index.js")).toBe("pg");
    expect(packageOfModule("src/server/files.ts")).toBeUndefined();
  });

  it(tag("CF-AC-003", "a provider SDK pre-bundled inside another package is found by its marker strings"), () => {
    const vendored = `${ORDINARY}var ua="aws-sdk-js/3.700.0 ua/2.1",n="@smithy/core";`;
    expect(providerSdksIn(vendored, ORDINARY_MODULES)).toEqual(['AWS SDK for JavaScript (marker "@smithy/")']);
    const google = `${ORDINARY}headers["x-goog-api-client"]="gl-node/22 gccl/7";`;
    expect(providerSdksIn(google, ORDINARY_MODULES)).toEqual(['Google Cloud client libraries (marker "x-goog-api-client")']);
    const azure = `${ORDINARY}const ua="azsdk-js-storage-blob/12.0.0";`;
    expect(providerSdksIn(azure, ORDINARY_MODULES)).toEqual(['Azure SDK for JavaScript (marker "azsdk-js-")']);
  });

  it("every marker belongs to one SDK and is long enough not to be a word ordinary code uses", () => {
    const all = PROVIDER_SDK_MARKERS.flatMap((m) => m.markers);
    expect(new Set(all).size).toBe(all.length);
    for (const marker of all) expect(marker.length).toBeGreaterThanOrEqual(7);
  });
});
