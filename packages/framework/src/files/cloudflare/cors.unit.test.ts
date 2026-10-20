import { describe, expect, it } from "vitest";
import { bucketCorsPath, bucketCorsPolicy, checkStorageCors } from "./cors.js";

const ORIGIN = "https://app-test-x.example.workers.dev";

/** A fake `fetch` answering with `response` and recording the request. */
function fakeFetch(response: () => Response) {
  const requests: Request[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return response();
  };
  return { fn: fn as typeof fetch, requests };
}

describe("deploy health step: one CORS preflight to the stage's storage (provisioning.md step 7, DEC-0099)", () => {
  const target = { accountId: "acct", bucket: "app-test-x-files", publicOrigin: ORIGIN };

  it("sends OPTIONS to the bucket's S3 URL from the public origin, asking for PUT with Content-Type", async () => {
    const fake = fakeFetch(() => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN } }));
    await checkStorageCors({ ...target, fetch: fake.fn });
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request?.method).toBe("OPTIONS");
    expect(new URL(request?.url ?? "").origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(new URL(request?.url ?? "").pathname.startsWith("/app-test-x-files/")).toBe(true);
    expect(request?.headers.get("Origin")).toBe(ORIGIN);
    expect(request?.headers.get("Access-Control-Request-Method")).toBe("PUT");
    expect(request?.headers.get("Access-Control-Request-Headers")).toBe("content-type");
    expect(request?.headers.get("Authorization")).toBeNull();
  });

  it("passes on the allowed-origin answer A-07 recorded (N13: 204 with that origin in Access-Control-Allow-Origin)", async () => {
    const fake = fakeFetch(() => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN, "Vary": "Origin" } }));
    expect(await checkStorageCors({ ...target, fetch: fake.fn })).toEqual({ ok: true });
  });

  it("fails, naming the status, on the unrelated-origin answer A-07 recorded (N14: 403 without Access-Control-Allow-Origin)", async () => {
    const fake = fakeFetch(() => new Response("<Error><Code>Unauthorized</Code></Error>", { status: 403 }));
    const outcome = await checkStorageCors({ ...target, fetch: fake.fn });
    expect(outcome).toMatchObject({ ok: false, status: 403 });
    expect(outcome.ok ? "" : outcome.message).toMatch(/CORS preflight.*HTTP 403/);
    expect(outcome.ok ? "" : outcome.message).not.toContain("Unauthorized");
  });

  it.each([
    ["another origin", "https://other.example"],
    ["a wildcard", "*"],
  ])("fails when storage allows %s instead of the stage's origin", async (_label, allowed) => {
    const fake = fakeFetch(() => new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": allowed } }));
    const outcome = await checkStorageCors({ ...target, fetch: fake.fn });
    expect(outcome.ok).toBe(false);
  });

  it("fails without throwing when storage cannot be reached", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const outcome = await checkStorageCors({ ...target, fetch: failing });
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.ok ? "" : outcome.message).toMatch(/could not be reached.*fetch failed/);
  });
});

describe("R2 bucket CORS policy for provisioning (DEC-0099, FILES-REQ-004)", () => {
  it("is one rule: the stage's public origin only, PUT and GET, the Content-Type header, max age 60 s", () => {
    expect(bucketCorsPolicy("https://app-test-x.example.workers.dev")).toEqual({
      rules: [
        {
          allowed: { origins: ["https://app-test-x.example.workers.dev"], methods: ["PUT", "GET"], headers: ["Content-Type"] },
          maxAgeSeconds: 60,
        },
      ],
    });
  });

  it.each(["", "*", "https://a.example/", "https://a.example/path", "app.example", "https://*.example"])(
    "refuses %j, which is not exactly one origin (CORE.MISCONFIGURED)",
    (origin) => {
      expect(() => bucketCorsPolicy(origin)).toThrow(expect.objectContaining({ code: "CORE.MISCONFIGURED" }));
    },
  );

  it("is set at the Cloudflare API path of the bucket's CORS configuration", () => {
    expect(bucketCorsPath("acct", "app-test-x-files")).toBe("/accounts/acct/r2/buckets/app-test-x-files/cors");
  });
});
