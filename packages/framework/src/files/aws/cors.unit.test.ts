import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installAwsNetworkGuard, type AwsNetworkGuard } from "../../provision/aws/aws-network-guard.test-support.js";
import { bucketCorsPolicy } from "../cloudflare/cors.js";
import { bucketCorsArgs, checkStorageCors } from "./cors.js";
import { createS3Fake } from "./s3-fake.test-support.js";

let guard: AwsNetworkGuard;
beforeAll(() => {
  guard = installAwsNetworkGuard();
});
afterAll(() => {
  expect(guard.attempts).toEqual([]);
  guard.uninstall();
});

const ORIGIN = "https://d111111abcdef8.cloudfront.net";
const location = { bucket: "app-test-x-files", region: "us-east-1", accountId: "123456789012" };
const credentials = { accessKeyId: "ASIAEXAMPLE", secretAccessKey: crypto.randomUUID(), sessionToken: crypto.randomUUID() };

describe("the S3 bucket's CORS value for the provision program (DEC-0099, FILES-REQ-004)", () => {
  it("allows PUT and GET from the stage's public origin only, with Content-Type, max age 60 s, nothing exposed", () => {
    expect(bucketCorsArgs(ORIGIN)).toEqual({ allowOrigins: [ORIGIN], allowMethods: ["PUT", "GET"], allowHeaders: ["Content-Type"], exposeHeaders: [], maxAge: "60 seconds" });
  });

  it("is the same rule as Cloudflare's", () => {
    const [rule] = bucketCorsPolicy(ORIGIN).rules;
    const aws = bucketCorsArgs(ORIGIN);
    expect([aws.allowOrigins, aws.allowMethods, aws.allowHeaders, 60]).toEqual([rule?.allowed.origins, rule?.allowed.methods, rule?.allowed.headers, rule?.maxAgeSeconds]);
  });

  it.each(["*", "https://*.cloudfront.net", "https://x.cloudfront.net/", "https://x.cloudfront.net/path", "not a url"])("refuses %j: not exactly one origin (CORE.MISCONFIGURED)", (origin) => {
    expect(() => bucketCorsArgs(origin)).toThrow(expect.objectContaining({ code: "CORE.MISCONFIGURED" }));
  });
});

describe("deploy health step: the storage CORS preflight on AWS (provisioning.md step 7)", () => {
  it("sends one unsigned OPTIONS to the bucket's virtual-hosted URL and passes when S3 allows the origin", async () => {
    const fake = createS3Fake({ location, credentials, cors: bucketCorsArgs(ORIGIN) });
    expect(await checkStorageCors({ location, publicOrigin: ORIGIN, fetch: fake.fetch })).toEqual({ ok: true });
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.method).toBe("OPTIONS");
    expect(new URL(request?.url ?? "").origin).toBe("https://app-test-x-files.s3.us-east-1.amazonaws.com");
    expect(request?.headers["origin"]).toBe(ORIGIN);
    expect(request?.headers["access-control-request-method"]).toBe("PUT");
    expect(request?.headers["access-control-request-headers"]).toBe("content-type");
    expect(request?.headers["authorization"]).toBeUndefined();
  });

  it("fails naming the status when the bucket allows another origin, or has no CORS rules", async () => {
    for (const cors of [bucketCorsArgs("https://other.cloudfront.net"), undefined]) {
      const fake = createS3Fake({ location, credentials, ...(cors === undefined ? {} : { cors }) });
      const outcome = await checkStorageCors({ location, publicOrigin: ORIGIN, fetch: fake.fetch });
      expect(outcome).toMatchObject({ ok: false, status: 403 });
      expect(outcome.ok ? "" : outcome.message).toContain("Access-Control-Allow-Origin absent");
      expect(outcome.ok ? "" : outcome.message).not.toContain("<Error>");
    }
  });

  it("an unreachable endpoint is a failed outcome, not a throw", async () => {
    const fake = createS3Fake({ location, credentials });
    fake.failNext(new TypeError("fetch failed"));
    expect(await checkStorageCors({ location, publicOrigin: ORIGIN, fetch: fake.fetch })).toEqual({
      ok: false,
      message: "the stage's file storage could not be reached for its CORS preflight (TypeError: fetch failed)",
    });
  });
});
